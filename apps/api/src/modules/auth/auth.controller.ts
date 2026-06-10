import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireAdmin, requireAuth, requireAuthSensitive, requireVerifiedEmail, verifyAccessToken } from './auth.guard';
import { AuthService } from './auth.service';
import { clientPrisma as prisma } from '@blobinfini/database';
import { twoFactorService, verifyChallengeAndCode } from '../../services/two-factor.service';
import { validate } from '../../middleware/validate';
import { passwordSchema } from '../../utils/password-validator';
import { createLazyCustomRateLimiter, createLazyRateLimiter } from '../../middleware/enhanced-rate-limit';
import { secureLogger } from '../../utils/secure-logger';
import { getClientIp } from '../../lib/client-ip';
import { hashIpHmac } from '../../lib/hash-ip';
import { hashEmailHmac } from '../../lib/hash-email';
import { securityEventAlertService } from '../../services/security-event-alert.service';
import { bindAuthenticatedSessionUser, rotateAuthenticatedSession } from './auth-session-context';
import { enforceAdminAllowedIp, grantAdminStepUp, revalidateAdminRole, resolveAdminStepUpBinding } from '../admin/admin.security-guard';
import { ipKeyGenerator } from 'express-rate-limit';
import { FRANCE_ONLY_COUNTRY_CODE, isFranceLaunchGuardError } from '../../lib/france-launch-guard';
import { buildLoginAttemptData } from './login-attempt.util';
import { disconnectUserSockets } from '../../lib/socket';
import { invalidateCachedAuth } from '../../lib/socket-auth-cache';
import * as bfDetector from '../../lib/brute-force-detector';

export const authRouter = Router();
const service = new AuthService();

const IS_PROD = process.env.NODE_ENV === 'production';

const ACCESS_COOKIE_BASE = {
  httpOnly: true,
  secure: IS_PROD,
  sameSite: 'lax' as const,
  path: '/',
} as const;

const REFRESH_COOKIE_BASE = {
  httpOnly: true,
  secure: IS_PROD,
  sameSite: 'lax' as const,
  path: '/auth/refresh',
} as const;

// Cookie de gate UX pour le middleware Next.js (/admin/*).
// IMPORTANT : ce cookie n'est PAS la sécurité réelle — la vraie protection
// est l'accessToken httpOnly validé par l'API à chaque requête.
// Ce cookie empêche un non-admin de voir les pages admin UI (elles seraient vides).
// Il est posé httpOnly pour ne pas être lisible/falsifiable via JS ou XSS.
// En prod, COOKIE_DOMAIN doit être défini (ex: ".blobinfini.app") pour que le cookie
// posé par l'API soit visible du middleware Next.js sur le domaine frontend.
// Exported for contract tests only.
export const ADMIN_SESSION_COOKIE_BASE = {
  httpOnly: true,
  secure: IS_PROD,
  sameSite: 'lax' as const,
  path: '/',
  ...(IS_PROD && process.env.COOKIE_DOMAIN ? { domain: process.env.COOKIE_DOMAIN } : {}),
};

function setAuthCookies(
  res: Response,
  tokens: { accessToken: string; refreshToken: string; refreshMaxAgeMs?: number },
  role?: string,
): void {
  res.cookie('accessToken', tokens.accessToken, {
    ...ACCESS_COOKIE_BASE,
    maxAge: 15 * 60 * 1000,
  });
  res.cookie('refreshToken', tokens.refreshToken, {
    ...REFRESH_COOKIE_BASE,
    maxAge: tokens.refreshMaxAgeMs ?? 30 * 24 * 60 * 60 * 1000,
  });
  if (role === 'ADMIN') {
    res.cookie('admin_session', '1', {
      ...ADMIN_SESSION_COOKIE_BASE,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
  }
}

function clearAuthCookies(res: Response): void {
  res.clearCookie('accessToken', ACCESS_COOKIE_BASE);
  res.clearCookie('refreshToken', REFRESH_COOKIE_BASE);
  res.clearCookie('admin_session', ADMIN_SESSION_COOKIE_BASE);
}

const registerSchema = z
  .object({
    email: z.string().email(),
    password: passwordSchema, // P1-3: OWASP-compliant password validation
    role: z.enum(['RIDER', 'PRO']).default('RIDER'),
    countryCode: z.string().trim().length(2).transform((value) => value.toUpperCase()).optional(),
    consentAccepted: z.literal(true, {
      errorMap: () => ({ message: 'Vous devez accepter les règles de sécurité des sessions.' }),
    }),
  })
  .superRefine((value, ctx) => {
    if (value.role === 'PRO' && !value.countryCode) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['countryCode'],
        message: `Le pays du compte professionnel doit être renseigné et fixé à ${FRANCE_ONLY_COUNTRY_CODE}.`,
      });
    }
  });

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  consentAccepted: z.boolean().optional().default(false),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(10).optional(),
});

const logoutSchema = z.object({
  allDevices: z.boolean().optional().default(true),
  refreshToken: z.string().optional(),
});

const forgotSchema = z.object({
  email: z.string().email(),
});

const resetSchema = z.object({
  token: z.string().min(10),
  password: passwordSchema, // P1-3: OWASP-compliant password validation
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(8),
  newPassword: passwordSchema,
});

const adminStepUpSchema = z.discriminatedUnion('intent', [
  z.object({
    intent: z.literal('send'),
  }),
  z.object({
    intent: z.literal('verify'),
    code: z.string().trim().length(6),
  }),
]);

function extractLoginEmail(req: Request) {
  return typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
}

const loginIpLimiter = createLazyCustomRateLimiter(
  {
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    // skipSuccessfulRequests intentionally omitted: a successful login must consume the counter
    // so that an attacker cannot reset their budget by interleaving valid credentials.
    keyGenerator: (req: Request) => {
      const ip = (req as Request & { canonicalIp?: string }).canonicalIp ?? getClientIp(req) ?? req.socket?.remoteAddress ?? '';
      return `auth_login:ip:${ipKeyGenerator(ip)}`;
    },
    handler: (req: Request, res: Response) => {
      const retryAfter = res.get('Retry-After');
      secureLogger.warn('RATE_LIMIT_EXCEEDED', {
        profile: 'AUTH_LOGIN_IP',
        ipHash: hashIpHmac(getClientIp(req)) ?? undefined,
        userAgent: req.get('User-Agent'),
        path: req.path,
        method: req.method,
        emailHash: extractLoginEmail(req) ? hashEmailHmac(extractLoginEmail(req)) : undefined,
        retryAfter,
      });
      res.status(429).json({
        error: 'AUTH_RATE_LIMIT_EXCEEDED',
        message: 'Too many authentication attempts from this network. Please try again later.',
        retryAfter: '15 minutes',
        timestamp: new Date().toISOString(),
        endpoint: '/login',
        retryAfterSeconds: retryAfter,
      });
    },
  },
  'auth_login_ip',
);

const loginAccountIpLimiter = createLazyCustomRateLimiter(
  {
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    // skipSuccessfulRequests intentionally omitted: same rationale as loginIpLimiter.
    keyGenerator: (req: Request) => {
      const ip = (req as Request & { canonicalIp?: string }).canonicalIp ?? getClientIp(req) ?? req.socket?.remoteAddress ?? '';
      const ipToken = ipKeyGenerator(ip);
      const email = extractLoginEmail(req);
      return email ? `auth_login:email:${hashEmailHmac(email)}:ip:${ipToken}` : `auth_login:ip:${ipToken}`;
    },
    handler: (req: Request, res: Response) => {
      const retryAfter = res.get('Retry-After');
      secureLogger.warn('RATE_LIMIT_EXCEEDED', {
        profile: 'AUTH_LOGIN_ACCOUNT_IP',
        ipHash: hashIpHmac(getClientIp(req)) ?? undefined,
        userAgent: req.get('User-Agent'),
        path: req.path,
        method: req.method,
        emailHash: extractLoginEmail(req) ? hashEmailHmac(extractLoginEmail(req)) : undefined,
        retryAfter,
      });
      res.status(429).json({
        error: 'AUTH_RATE_LIMIT_EXCEEDED',
        message: 'Too many authentication attempts for this account from this network. Please try again later.',
        retryAfter: '15 minutes',
        timestamp: new Date().toISOString(),
        endpoint: '/login',
        retryAfterSeconds: retryAfter,
      });
    },
  },
  'auth_login_account_ip',
);

// Distributed credential stuffing: N IPs attacking the same account.
// loginIpLimiter (20/15min/IP) and loginAccountIpLimiter (5/15min/email+IP) don't catch it.
// loginEmailLimiter blocks at the 10th attempt across any IP on the same email.
//
// Security properties:
//   - Key = HMAC(email) — no plaintext email in Redis keys
//   - skip in tests (unless ENABLE_RATE_LIMIT_IN_TESTS=true) — keyGenerator never called when skip=true
//   - Response is intentionally identical to the other 429s — no oracle
//
// MUST be module-level (ERR_ERL_CREATED_IN_REQUEST_HANDLER if inside handler)
const loginEmailLimiter = createLazyCustomRateLimiter(
  {
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: Request) => {
      const email = extractLoginEmail(req);
      if (!email) {
        // No email in body: charge against IP only (no double-cost on loginIpLimiter key)
        const ip = (req as Request & { canonicalIp?: string }).canonicalIp ?? getClientIp(req) ?? req.socket?.remoteAddress ?? '';
        return `auth_login:noemail:${ipKeyGenerator(ip)}`;
      }
      return `auth_login:email_only:${hashEmailHmac(email)}`;
    },
    handler: (req: Request, res: Response) => {
      const retryAfter = res.get('Retry-After');
      secureLogger.warn('RATE_LIMIT_EXCEEDED', {
        profile: 'AUTH_LOGIN_EMAIL',
        emailHash: extractLoginEmail(req) ? hashEmailHmac(extractLoginEmail(req)) : undefined,
        userAgent: req.get('User-Agent'),
        path: req.path,
        method: req.method,
        retryAfter,
      });
      // Generic — identical to loginIpLimiter/loginAccountIpLimiter response (no oracle)
      res.status(429).json({
        error: 'AUTH_RATE_LIMIT_EXCEEDED',
        message: 'Too many authentication attempts from this network. Please try again later.',
        retryAfter: '15 minutes',
        timestamp: new Date().toISOString(),
        endpoint: '/login',
        retryAfterSeconds: retryAfter,
      });
    },
    skip: () => process.env.NODE_ENV === 'test' && !process.env.ENABLE_RATE_LIMIT_IN_TESTS,
  },
  'auth_login_email',
);

const stepUpLimiter = createLazyRateLimiter('AUTH', {
  keyGenerator: (req: Request & { user?: { id?: string }; canonicalIp?: string }): string => {
    const userId = req.user?.id;
    const ip = req.canonicalIp ?? getClientIp(req) ?? req.socket?.remoteAddress ?? '';
    return userId ? `step_up:${userId}` : `step_up:ip:${ipKeyGenerator(ip)}`;
  },
});

const verifyEmailSchema = z.object({
  token: z.string().min(10),
});

const resendVerifySchema = z.object({
  email: z.string().email(),
});

const resendVerificationIpLimiter = createLazyCustomRateLimiter(
  {
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: Request) => {
      const ip = (req as Request & { canonicalIp?: string }).canonicalIp ?? getClientIp(req) ?? req.socket?.remoteAddress ?? '';
      return `resend_verification:ip:${ipKeyGenerator(ip)}`;
    },
    handler: (_req: Request, res: Response) => {
      res.status(429).json({
        error: 'EMAIL_VERIFICATION_IP_RATE_LIMIT_EXCEEDED',
        message: 'Too many verification requests from this IP. Please try again later.',
        retryAfter: '15 minutes',
      });
    },
    skip: (req: Request) => process.env.NODE_ENV === 'test' && req.get('x-enable-ip-rate-limit') !== 'true',
  },
  'resend_verification_ip',
);

// 2FA Schemas
const send2FASchema = z.object({
  email: z.string().email(),
});

const verify2FAProSchema = z.object({
  email: z.string().email(),
  code: z.string().length(6, 'Code must be 6 digits'),
  consentAccepted: z.boolean().optional().default(false),
}).strict();

authRouter.post('/register', validate(registerSchema), async (req, res) => {
  try {
    const data = req.body as z.infer<typeof registerSchema>;
    // Use secure IP extraction (prevents spoofing)
    const ip = getClientIp(req);
    const result = await service.register(data, { consentIp: ip });
    res.status(201).json(result);
  } catch (err: any) {
    if (err?.name === 'ZodError') {
      return res.status(400).json({ error: 'Invalid input', details: err.errors });
    }
    if (isFranceLaunchGuardError(err)) {
      return res.status(err.status).json({
        error: err.code,
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
      });
    }
    if (err?.code === 'EMAIL_ALREADY_EXISTS') {
      return res.status(409).json({ error: 'Email already registered' });
    }
    return res.status(500).json({ error: 'Internal error' });
  }
});

/**
 * Catégorise un User-Agent pour minimiser les données stockées (RGPD Article 5.1.c)
 * Au lieu de stocker le UA complet, on stocke seulement : mobile/desktop/bot
 */
function categorizeUserAgent(userAgent: string | undefined): string | undefined {
  if (!userAgent) return undefined;

  const ua = userAgent.toLowerCase();
  if (ua.includes('mobile') || ua.includes('iphone') || ua.includes('android')) {
    return 'mobile';
  }
  if (ua.includes('bot') || ua.includes('crawler') || ua.includes('spider')) {
    return 'bot';
  }
  return 'desktop';
}

// Middleware chain order (cheapest rejection first):
//   1. loginIpLimiter        — broad IP check, no body parsing required
//   2. loginEmailLimiter     — email-only across IPs (distributed stuffing)
//   3. loginAccountIpLimiter — email+IP combo (tightest, most specific)
authRouter.post('/login', loginIpLimiter, loginEmailLimiter, loginAccountIpLimiter, validate(loginSchema), async (req, res) => {
  const { email, password, consentAccepted } = req.body as z.infer<typeof loginSchema>;
  const ip = getClientIp(req);
  const userAgent = categorizeUserAgent(req.get('User-Agent'));

  try {
    const user = await service.authenticateLogin(email, password);
    const authContext = await rotateAuthenticatedSession(req, user.id);
    const result = await service.generateTokens(user, { consentAccepted, consentIp: ip }, authContext);

    // Log successful login attempt
    const storedUser = await prisma.user.findUnique({ where: { email } });
    await prisma.loginAttempt.create({
      data: {
        ...buildLoginAttemptData({
          email,
          ipHash: hashIpHmac(ip) ?? undefined,
          userAgent,
          success: true,
        }),
        userId: storedUser?.id,
      }
    }).catch(() => {}); // Ignore logging errors

    // Check for suspicious pattern: successful login after multiple failures (possible brute-force success)
    if (storedUser?.id && ip) {
      securityEventAlertService.reportSuccessAfterFailures(
        email,
        hashIpHmac(ip)!,
        storedUser.id
      ).catch(() => {}); // Fire-and-forget, never fail login flow
    }

    setAuthCookies(res, result, user.role);
    return res.json({ ok: true });
  } catch (err: any) {
    // Log failed login attempt
    let reason = 'Unknown error';
    if (err?.name === 'ZodError') {
      reason = 'Invalid input';
      await prisma.loginAttempt.create({
        data: buildLoginAttemptData({ email, ipHash: hashIpHmac(ip) ?? undefined, userAgent, success: false, reason })
      }).catch(() => {});
      return res.status(400).json({ error: 'Invalid input', details: err.errors });
    }
    if (err?.code === 'UNAUTHORIZED') {
      reason = 'Invalid credentials';
      await prisma.loginAttempt.create({
        data: buildLoginAttemptData({ email, ipHash: hashIpHmac(ip) ?? undefined, userAgent, success: false, reason })
      }).catch(() => {});

      // Detect brute-force or targeted attack patterns — DB-based alert (fire-and-forget)
      if (ip) {
        securityEventAlertService.detectAndReportLoginFailurePattern(
          email,
          hashIpHmac(ip)!
        ).catch(() => {}); // Never fail login flow
      }

      // LOT 4: Redis brute-force counter — long-window (24h) signal (fire-and-forget)
      // Branché UNIQUEMENT sur UNAUTHORIZED. Pas sur succès, pas sur 429, pas sur d'autres branches.
      void bfDetector.onLoginFailure({ ip: ip ?? undefined, email }).catch(() => {});

      return res.status(401).json({ error: 'Invalid credentials' });
    }
    if (err?.code === 'CONSENT_REQUIRED') {
      // Don't log consent required as failed attempt
      return res.status(403).json({ error: 'Consent required', code: 'CONSENT_REQUIRED', consentVersion: 'v1.0.0' });
    }
    if (err?.code === 'EMAIL_NOT_VERIFIED') {
      reason = 'Email not verified';
      await prisma.loginAttempt.create({
        data: buildLoginAttemptData({ email, ipHash: hashIpHmac(ip) ?? undefined, userAgent, success: false, reason })
      }).catch(() => {});
      return res.status(403).json({ error: 'Email not verified' });
    }
    // ✅ NOUVEAU : Gestion 2FA admin
    if (err?.code === '2FA_REQUIRED') {
      // Envoyer le code 2FA par email
      const sendResult = await twoFactorService.sendCode(err.userId, err.email);
      if (!sendResult.success) {
        if (sendResult.tooManyChallenges) {
          return res.status(429).json({ error: sendResult.message });
        }
        return res.status(503).json({ error: '2FA service unavailable' });
      }
      return res.status(200).json({
        requires2FA: true,
        challengeId: sendResult.challengeId,
        message: 'Code de vérification envoyé par email'
      });
    }

    // Log unexpected errors
    reason = 'Internal server error';
    await prisma.loginAttempt.create({
      data: buildLoginAttemptData({ email, ipHash: hashIpHmac(ip) ?? undefined, userAgent, success: false, reason })
    }).catch(() => {});
    return res.status(500).json({ error: 'Internal error' });
  }
});

// ✅ Endpoint pour vérifier le code 2FA admin — userId résolu côté serveur via challengeId
const verify2FASchema = z.object({
  challengeId: z.string().uuid(),
  code: z.string().length(6),
  consentAccepted: z.boolean().optional().default(false),
}).strict();

authRouter.post('/verify-2fa', validate(verify2FASchema), async (req, res) => {
  try {
    const { challengeId, code, consentAccepted } = req.body as z.infer<typeof verify2FASchema>;

    // Extract client IP for rate limiting (secure extraction)
    const clientIp = getClientIp(req);

    // Resolve challengeId → userId and verify code (userId never comes from client body)
    const verification = await verifyChallengeAndCode(challengeId, code, clientIp);

    if (!verification.valid || !verification.userId) {
      return res.status(401).json({ error: verification.message });
    }

    const userId = verification.userId;

    // Code valide - récupérer l'utilisateur et générer les tokens
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { adminProfile: true }
    });

    if (!user || user.role !== 'ADMIN') {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Vérifier IP whitelisting si configuré (reuse clientIp from 2FA verification)
    if (user.adminProfile?.allowedIPs && user.adminProfile.allowedIPs.length > 0) {
      if (!clientIp || !user.adminProfile.allowedIPs.includes(clientIp)) {
        return res.status(403).json({
          error: 'IP non autorisée',
          message: 'Votre adresse IP n\'est pas autorisée à accéder à ce compte admin'
        });
      }
    }

    // Mettre à jour lastLoginAt
    await prisma.adminProfile.update({
      where: { userId: user.id },
      data: { lastLoginAt: new Date() }
    });

    // Générer les tokens
    const ip = clientIp || undefined;
    const authContext = await rotateAuthenticatedSession(req, user.id);
    const tokens = await service.generateTokens(user, { consentAccepted, consentIp: ip }, authContext);

    setAuthCookies(res, tokens, user.role);
    return res.json({ ok: true });
  } catch (err: any) {
    // system.error : erreur inattendue dans le flow 2FA — pas de code ni token dans les data
    secureLogger.error('2FA_VERIFICATION_ERROR', {
      error: err?.message,
      name: err?.name,
      userId: req.body?.userId,
    });
    if (err?.name === 'ZodError') {
      return res.status(400).json({ error: 'Invalid input', details: err.errors });
    }
    return res.status(500).json({ error: 'Internal error' });
  }
});

authRouter.post('/refresh', validate(refreshSchema), async (req, res) => {
  try {
    const { refreshToken: bodyRefreshToken } = req.body as z.infer<typeof refreshSchema>;
    const refreshToken = bodyRefreshToken ?? req.cookies?.refreshToken;
    if (typeof refreshToken !== 'string' || refreshToken.trim().length < 10) {
      return res.status(401).json({ error: 'Invalid refresh credential' });
    }
    const authContext = await rotateAuthenticatedSession(req);
    const result = await service.refresh(refreshToken, authContext);
    const accessTokenPayload = verifyAccessToken(result.accessToken);
    if (!accessTokenPayload?.sub) {
      return res.status(503).json({ error: 'Session binding unavailable' });
    }
    await bindAuthenticatedSessionUser(req, accessTokenPayload.sub);
    setAuthCookies(res, result, accessTokenPayload.role);
    res.json({ ok: true });
  } catch (err: any) {
    if (err?.name === 'ZodError') {
      return res.status(400).json({ error: 'Invalid input', details: err.errors });
    }
    if (err?.code === 'UNAUTHORIZED') {
      // Clear stale cookies so they don't linger on the client after a failed refresh.
      clearAuthCookies(res);
      return res.status(401).json({ error: 'Invalid refresh credential' });
    }
    return res.status(500).json({ error: 'Internal error' });
  }
});

authRouter.post('/logout', requireAuth, async (req, res) => {
  try {
    const { allDevices, refreshToken: bodyRefreshToken } = logoutSchema.parse(req.body ?? {});
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const refreshToken = bodyRefreshToken ?? req.cookies?.refreshToken;

    if (allDevices || !refreshToken) {
      const result = await service.logoutAll(userId);
      // P1-WS: Kill all active WebSocket connections immediately on full logout.
      // sessionVersion is incremented by logoutAll; we also flush the in-process
      // socket auth cache so no reconnect is allowed within the 30 s TTL window.
      disconnectUserSockets(userId, 'logout');
      invalidateCachedAuth(userId);
      await rotateAuthenticatedSession(req);
      clearAuthCookies(res);
      return res.json(result);
    }
    const result = await service.logoutSingle(userId, refreshToken);
    await rotateAuthenticatedSession(req);
    clearAuthCookies(res);
    return res.json(result);
  } catch (err: any) {
    if (err?.name === 'ZodError') {
      return res.status(400).json({ error: 'Invalid input', details: err.errors });
    }
    return res.status(500).json({ error: 'Internal error' });
  }
});

authRouter.post('/verify-email', async (req, res) => {
  try {
    const { token } = verifyEmailSchema.parse(req.body);
    const result = await service.verifyEmail(token);
    res.json(result);
  } catch (err: any) {
    if (err?.name === 'ZodError') {
      // No `details` on this endpoint — token format must not be disclosed.
      return res.status(400).json({ error: 'Invalid input' });
    }
    if (err?.code === 'UNAUTHORIZED') {
      return res.status(401).json({ error: 'Invalid or expired link' });
    }
    return res.status(500).json({ error: 'Internal error' });
  }
});

// Resend verification email (generic response)
// R5: 3-layer rate limit — IP (5/15min), cooldown (1/60s/email), quota (5/hour/email)
authRouter.post(
  '/resend-verification',
  resendVerificationIpLimiter,
  createLazyRateLimiter('EMAIL_VERIFICATION_COOLDOWN'),
  createLazyRateLimiter('EMAIL_VERIFICATION'),
  async (req, res) => {
    try {
      const { email } = resendVerifySchema.parse(req.body);
      // audit.info : déclenchement d'un email transactionnel — trace légère, emailHash safe
      secureLogger.info('AUTH_RESEND_VERIFICATION_REQUEST', { emailHash: hashEmailHmac(email) });
      const result = await service.resendEmailVerification(email);
      res.json(result);
    } catch (err: any) {
      if (err?.name === 'ZodError') {
        return res.status(400).json({ error: 'Invalid input', details: err.errors });
      }
      return res.status(500).json({ error: 'Internal error' });
    }
  }
);

authRouter.get('/me', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        emailVerified: true,
        twoFactorEnabled: true,
        consentedAt: true,
        consentVersion: true,
        // RGPD: consentIp excluded from API response (privacy-by-design)
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!user) return res.status(404).json({ error: 'Not found' });
    res.json(user);
  } catch (err) {
    return res.status(500).json({ error: 'Internal error' });
  }
});

const forgotPasswordLimiter = createLazyRateLimiter('PASSWORD_RESET_EMAIL');
const forgotPasswordIpLimiter = createLazyCustomRateLimiter(
  {
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: Request) => {
      const ip = (req as Request & { canonicalIp?: string }).canonicalIp ?? getClientIp(req) ?? req.socket?.remoteAddress ?? '';
      return `forgot_password:ip:${ipKeyGenerator(ip)}`;
    },
    handler: (_req: Request, res: Response) => {
      res.status(429).json({
        error: 'PASSWORD_RESET_IP_RATE_LIMIT_EXCEEDED',
        message: 'Too many password reset requests from this IP. Please try again later.',
        retryAfter: '15 minutes',
      });
    },
    skip: (req: Request) => process.env.NODE_ENV === 'test' && req.get('x-enable-ip-rate-limit') !== 'true',
  },
  'forgot_password_ip',
);

authRouter.post('/forgot-password', forgotPasswordIpLimiter, forgotPasswordLimiter, async (req, res) => {
  try {
    const { email } = forgotSchema.parse(req.body);
    // audit.info : demande de reset — emailHash safe (SHA-256), pas d'email brut
    secureLogger.info('AUTH_FORGOT_PASSWORD_REQUEST', { emailHash: hashEmailHmac(email) });
    const result = await service.forgotPassword(email);
    res.json(result);
  } catch (err: any) {
    if (err?.name === 'ZodError') {
      return res.status(400).json({ error: 'Invalid input', details: err.errors });
    }
    return res.status(500).json({ error: 'Internal error' });
  }
});

authRouter.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = resetSchema.parse(req.body);
    const result = await service.resetPassword(token, password);
    // P1-WS: Kill sockets for the user whose password was just reset.
    // userId is returned internally but must NOT be forwarded to the client.
    disconnectUserSockets(result.userId, 'password-reset');
    invalidateCachedAuth(result.userId);
    clearAuthCookies(res);
    res.json({ message: result.message });
  } catch (err: any) {
    if (err?.name === 'ZodError') {
      return res.status(400).json({ error: 'Invalid input', details: err.errors });
    }
    if (err?.code === 'UNAUTHORIZED') {
      return res.status(401).json({ error: 'Invalid or expired link' });
    }
    return res.status(500).json({ error: 'Internal error' });
  }
});

authRouter.post('/change-password', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
    const result = await service.changePassword(userId, currentPassword, newPassword);
    // P1-WS: Kill sockets on password change (sessionVersion is incremented by changePassword).
    disconnectUserSockets(userId, 'password-change');
    invalidateCachedAuth(userId);
    await rotateAuthenticatedSession(req);
    clearAuthCookies(res);
    res.json(result);
  } catch (err: any) {
    if (err?.name === 'ZodError') {
      return res.status(400).json({ error: 'Invalid input', details: err.errors });
    }
    if (err?.code === 'UNAUTHORIZED') {
      return res.status(401).json({ error: err?.message || 'Unauthorized' });
    }
    return res.status(500).json({ error: 'Internal error' });
  }
});

authRouter.post(
  '/step-up',
  requireAuth,
  requireVerifiedEmail,
  requireAuthSensitive(),
  requireAdmin,
  revalidateAdminRole,
  enforceAdminAllowedIp,
  stepUpLimiter,
  async (req, res) => {
    try {
      const user = (req as Request & { user?: { id: string; role: string } }).user;
      if (!user?.id || user.role !== 'ADMIN') {
        return res.status(403).json({ error: 'Admin role required' });
      }

      const currentUser = await prisma.user.findUnique({
        where: { id: user.id },
        select: {
          id: true,
          email: true,
          role: true,
          deletedAt: true,
        },
      });

      if (!currentUser || currentUser.role !== 'ADMIN' || currentUser.deletedAt) {
        return res.status(403).json({ error: 'Admin role required' });
      }

      const body = adminStepUpSchema.parse(req.body ?? {});

      if (body.intent === 'send') {
        const sendResult = await twoFactorService.sendCode(currentUser.id, currentUser.email);
        if (!sendResult.success) {
          if (sendResult.tooManyChallenges) {
            return res.status(429).json({
              error: 'ADMIN_STEP_UP_CHALLENGE_RATE_LIMITED',
              message: sendResult.message,
            });
          }

          return res.status(503).json({ error: 'Admin step-up unavailable' });
        }

        return res.json({ message: sendResult.message });
      }

      const clientIp = getClientIp(req);
      const verification = await twoFactorService.verifyCode(currentUser.id, body.code, clientIp);
      if (!verification.valid) {
        return res.status(401).json({ error: verification.message });
      }

      const result = await grantAdminStepUp(currentUser.id, resolveAdminStepUpBinding(req));
      if (!result.ok) {
        if (result.reason === 'STORAGE_UNAVAILABLE') {
          return res.status(503).json({ error: 'Admin step-up unavailable' });
        }

        return res.status(401).json({ error: 'Reauthentication required' });
      }

      return res.json({
        message: 'Admin step-up granted',
        stepUpUntil: result.stepUpUntil,
      });
    } catch (err: any) {
      if (err?.name === 'ZodError') {
        return res.status(400).json({ error: 'Invalid input', details: err.errors });
      }

      secureLogger.error('ADMIN_STEP_UP_ERROR', {
        error: err instanceof Error ? err.message : String(err),
      });
      return res.status(500).json({ error: 'Internal error' });
    }
  },
);

// Rate limit for 2FA send — prevents mail flooding and user enumeration via timing/status divergence
const twoFaSendLimiter = createLazyCustomRateLimiter(
  {
    windowMs: 10 * 60 * 1000, // 10 minutes
    max: 3,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: Request) => {
      // Key on email hash so each account has its own budget, regardless of IP rotation
      const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      if (email) {
        return `2fa_send:email:${hashEmailHmac(email)}`;
      }
      const ip = (req as Request & { canonicalIp?: string }).canonicalIp ?? getClientIp(req) ?? req.socket?.remoteAddress ?? '';
      return `2fa_send:ip:${ipKeyGenerator(ip)}`;
    },
    handler: (_req: Request, res: Response) => {
      res.status(429).json({
        error: 'TOO_MANY_2FA_REQUESTS',
        message: 'Trop de demandes de code. Réessaie dans quelques minutes.',
        retryAfter: '10 minutes',
      });
    },
  },
  '2fa_send',
);

const twoFaSendIpLimiter = createLazyCustomRateLimiter(
  {
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: Request) => {
      const ip = (req as Request & { canonicalIp?: string }).canonicalIp ?? getClientIp(req) ?? req.socket?.remoteAddress ?? '';
      return `2fa_send:ip:${ipKeyGenerator(ip)}`;
    },
    handler: (_req: Request, res: Response) => {
      res.status(429).json({
        error: 'TOO_MANY_2FA_IP_REQUESTS',
        message: 'Too many 2FA requests from this IP. Please try again later.',
        retryAfter: '15 minutes',
      });
    },
    skip: (req: Request) => process.env.NODE_ENV === 'test' && req.get('x-enable-ip-rate-limit') !== 'true',
  },
  '2fa_send_ip',
);

// 2FA Routes
authRouter.post('/2fa/send', twoFaSendIpLimiter, twoFaSendLimiter, async (req, res) => {
  try {
    const { email } = send2FASchema.parse(req.body);

    // Look up user — return generic 200 in all non-PRO cases to avoid user enumeration.
    // An attacker must not be able to distinguish "no account" from "account with wrong role"
    // via HTTP status codes.
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, role: true, email: true }
    });

    if (!user || user.role !== 'PRO') {
      // Generic response: same status and body regardless of whether the user exists
      return res.json({ message: 'Si un compte PRO correspondant existe, un code a été envoyé.' });
    }

    const result = await twoFactorService.sendCode(user.id, user.email);

    if (result.success || result.tooManyChallenges) {
      // Réponse générique dans les deux cas : un attaquant ne peut pas distinguer
      // "code envoyé" de "trop de challenges actifs" pour énumérer les comptes PRO.
      return res.json({ message: 'Si un compte PRO correspondant existe, un code a été envoyé.' });
    }
    res.status(503).json({ error: '2FA service unavailable' });
  } catch (err: any) {
    if (err?.name === 'ZodError') {
      return res.status(400).json({ error: 'Invalid input', details: err.errors });
    }
    return res.status(500).json({ error: 'Internal error' });
  }
});

// Réponse générique réutilisée pour les cas non-PRO : empêche l'énumération d'emails.
// Un attaquant ne peut pas distinguer "compte inexistant" de "mauvais code"
// car les deux retournent 401 { error: '2FA_INVALID' }.
const VERIFY_2FA_INVALID_RESPONSE = { error: '2FA_INVALID', message: 'Code invalide ou expiré.' } as const;

authRouter.post('/2fa/verify', async (req, res) => {
  try {
    const { email, code, consentAccepted } = verify2FAProSchema.parse(req.body);

    const clientIp = getClientIp(req);

    // Lookup user — anti-énumération : on ne révèle jamais si l'email existe ou le rôle.
    // Si user inexistant ou non-PRO : même 401 que mauvais code.
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, role: true, email: true, password: true, sessionVersion: true, credentialsVersion: true, consentedAt: true, consentVersion: true }
    });

    if (!user || user.role !== 'PRO') {
      return res.status(401).json(VERIFY_2FA_INVALID_RESPONSE);
    }

    const verification = await twoFactorService.verifyCode(user.id, code, clientIp);

    if (verification.valid) {
      const ip = clientIp || undefined;
      const authContext = await rotateAuthenticatedSession(req, user.id);
      const tokens = await service.generateTokens(user, { consentAccepted, consentIp: ip }, authContext);
      setAuthCookies(res, tokens);
      return res.json({
        message: 'Authentification 2FA réussie',
        ok: true,
      });
    }

    return res.status(401).json(VERIFY_2FA_INVALID_RESPONSE);
  } catch (err: any) {
    if (err?.name === 'ZodError') {
      return res.status(400).json({ error: 'Invalid input', details: err.errors });
    }
    if (err?.code === 'CONSENT_REQUIRED') {
      return res.status(403).json({ error: 'Consent required', code: 'CONSENT_REQUIRED', consentVersion: 'v1.0.0' });
    }
    return res.status(500).json({ error: 'Internal error' });
  }
});

// Demo: route protégée par email vérifié (à réutiliser pour modules critiques)
authRouter.get('/verified-only', requireAuth, requireVerifiedEmail, async (_req, res) => {
  return res.json({ ok: true });
});
