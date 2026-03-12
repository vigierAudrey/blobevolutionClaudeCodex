import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireAdmin, requireAuth, requireAuthSensitive, requireVerifiedEmail, verifyAccessToken } from './auth.guard';
import { AuthService } from './auth.service';
import { clientPrisma as prisma } from '@blobinfini/database';
import { twoFactorService } from '../../services/two-factor.service';
import { validate } from '../../middleware/validate';
import { passwordSchema } from '../../utils/password-validator';
import { createRateLimiter } from '../../middleware/enhanced-rate-limit';
import { secureLogger } from '../../utils/secure-logger';
import { createHash } from 'crypto';
import { getClientIp } from '../../lib/client-ip';
import { hashIpHmac } from '../../lib/hash-ip';
import { securityEventAlertService } from '../../services/security-event-alert.service';
import { bindAuthenticatedSessionUser, rotateAuthenticatedSession } from './auth-session-context';
import { enforceAdminAllowedIp, grantAdminStepUp, revalidateAdminRole, resolveAdminStepUpBinding } from '../admin/admin.security-guard';

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

function setAuthCookies(
  res: Response,
  tokens: { accessToken: string; refreshToken: string; refreshMaxAgeMs?: number },
): void {
  res.cookie('accessToken', tokens.accessToken, {
    ...ACCESS_COOKIE_BASE,
    maxAge: 15 * 60 * 1000,
  });
  res.cookie('refreshToken', tokens.refreshToken, {
    ...REFRESH_COOKIE_BASE,
    maxAge: tokens.refreshMaxAgeMs ?? 30 * 24 * 60 * 60 * 1000,
  });
}

function clearAuthCookies(res: Response): void {
  res.clearCookie('accessToken', ACCESS_COOKIE_BASE);
  res.clearCookie('refreshToken', REFRESH_COOKIE_BASE);
}

const registerSchema = z.object({
  email: z.string().email(),
  password: passwordSchema, // P1-3: OWASP-compliant password validation
  role: z.enum(['RIDER', 'PRO']).default('RIDER'),
  consentAccepted: z.literal(true, {
    errorMap: () => ({ message: 'Vous devez accepter la charte et l\'avertissement.' }),
  }),
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

function hashEmail(email: string) {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}

const stepUpLimiter = createRateLimiter('AUTH', {
  keyGenerator: (req: Request & { user?: { id?: string }; canonicalIp?: string }): string => {
    const userId = req.user?.id;
    const ip = req.canonicalIp ?? getClientIp(req) ?? req.socket?.remoteAddress ?? '';
    return userId ? `step_up:${userId}` : ip;
  },
});

const verifyEmailSchema = z.object({
  token: z.string().min(10),
});

const resendVerifySchema = z.object({
  email: z.string().email(),
});

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

authRouter.post('/login', validate(loginSchema), async (req, res) => {
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
        email,
        ipHash: hashIpHmac(ip) ?? undefined, // RGPD compliant: HMAC-SHA256 hash
        userAgent,
        success: true,
        userId: storedUser?.id
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

    setAuthCookies(res, result);
    return res.json({ ok: true });
  } catch (err: any) {
    // Log failed login attempt
    let reason = 'Unknown error';
    if (err?.name === 'ZodError') {
      reason = 'Invalid input';
      await prisma.loginAttempt.create({
        data: { email, ipHash: hashIpHmac(ip) ?? undefined, userAgent, success: false, reason }
      }).catch(() => {});
      return res.status(400).json({ error: 'Invalid input', details: err.errors });
    }
    if (err?.code === 'UNAUTHORIZED') {
      reason = 'Invalid credentials';
      await prisma.loginAttempt.create({
        data: { email, ipHash: hashIpHmac(ip) ?? undefined, userAgent, success: false, reason }
      }).catch(() => {});

      // Detect brute-force or targeted attack patterns (fire-and-forget)
      if (ip) {
        securityEventAlertService.detectAndReportLoginFailurePattern(
          email,
          hashIpHmac(ip)!
        ).catch(() => {}); // Never fail login flow
      }

      return res.status(401).json({ error: 'Invalid credentials' });
    }
    if (err?.code === 'CONSENT_REQUIRED') {
      // Don't log consent required as failed attempt
      return res.status(403).json({ error: 'Consent required', code: 'CONSENT_REQUIRED', consentVersion: 'v1.0.0' });
    }
    if (err?.code === 'EMAIL_NOT_VERIFIED') {
      reason = 'Email not verified';
      await prisma.loginAttempt.create({
        data: { email, ipHash: hashIpHmac(ip) ?? undefined, userAgent, success: false, reason }
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
        userId: err.userId,
        message: 'Code de vérification envoyé par email'
      });
    }

    // Log unexpected errors
    reason = 'Internal server error';
    await prisma.loginAttempt.create({
      data: { email, ipHash: hashIpHmac(ip) ?? undefined, userAgent, success: false, reason }
    }).catch(() => {});
    return res.status(500).json({ error: 'Internal error' });
  }
});

// ✅ NOUVEAU : Endpoint pour vérifier le code 2FA admin
const verify2FASchema = z.object({
  userId: z.string().uuid(),
  code: z.string().length(6),
  consentAccepted: z.boolean().optional().default(false),
}).strict();

authRouter.post('/verify-2fa', validate(verify2FASchema), async (req, res) => {
  try {
    const { userId, code, consentAccepted } = req.body as z.infer<typeof verify2FASchema>;

    // Extract client IP for rate limiting (secure extraction)
    const clientIp = getClientIp(req);

    // Vérifier le code 2FA avec rate limiting
    const verification = await twoFactorService.verifyCode(userId, code, clientIp);

    if (!verification.valid) {
      return res.status(401).json({ error: verification.message });
    }

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

    setAuthCookies(res, tokens);
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
      return res.status(401).json({ error: 'Invalid refresh token' });
    }
    const authContext = await rotateAuthenticatedSession(req);
    const result = await service.refresh(refreshToken, authContext);
    const accessTokenPayload = verifyAccessToken(result.accessToken);
    if (!accessTokenPayload?.sub) {
      return res.status(503).json({ error: 'Session binding unavailable' });
    }
    await bindAuthenticatedSessionUser(req, accessTokenPayload.sub);
    setAuthCookies(res, result);
    res.json({ ok: true });
  } catch (err: any) {
    if (err?.name === 'ZodError') {
      return res.status(400).json({ error: 'Invalid input', details: err.errors });
    }
    if (err?.code === 'UNAUTHORIZED') {
      return res.status(401).json({ error: 'Invalid refresh token' });
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
      return res.status(400).json({ error: 'Invalid input', details: err.errors });
    }
    if (err?.code === 'UNAUTHORIZED') {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    return res.status(500).json({ error: 'Internal error' });
  }
});

// Resend verification email (generic response)
// P2-5: Rate limiting to prevent email spam (3 attempts/hour per email)
authRouter.post(
  '/resend-verification',
  createRateLimiter('EMAIL_VERIFICATION'),
  async (req, res) => {
    try {
      const { email } = resendVerifySchema.parse(req.body);
      // audit.info : déclenchement d'un email transactionnel — trace légère, emailHash safe
      secureLogger.info('AUTH_RESEND_VERIFICATION_REQUEST', { emailHash: hashEmail(email) });
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

authRouter.post('/forgot-password', async (req, res) => {
  try {
    const { email } = forgotSchema.parse(req.body);
    // audit.info : demande de reset — emailHash safe (SHA-256), pas d'email brut
    secureLogger.info('AUTH_FORGOT_PASSWORD_REQUEST', { emailHash: hashEmail(email) });
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
    clearAuthCookies(res);
    res.json(result);
  } catch (err: any) {
    if (err?.name === 'ZodError') {
      return res.status(400).json({ error: 'Invalid input', details: err.errors });
    }
    if (err?.code === 'UNAUTHORIZED') {
      return res.status(401).json({ error: 'Invalid or expired token' });
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

// 2FA Routes
authRouter.post('/2fa/send', async (req, res) => {
  try {
    const { email } = send2FASchema.parse(req.body);

    // Vérifier que l'utilisateur existe et est PRO
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, role: true, email: true }
    });

    if (!user) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }

    if (user.role !== 'PRO') {
      return res.status(403).json({ error: '2FA disponible uniquement pour les pros' });
    }

    const result = await twoFactorService.sendCode(user.id, user.email);

    if (result.success) {
      res.json({ message: result.message });
    } else {
      res.status(500).json({ error: result.message });
    }
  } catch (err: any) {
    if (err?.name === 'ZodError') {
      return res.status(400).json({ error: 'Invalid input', details: err.errors });
    }
    return res.status(500).json({ error: 'Internal error' });
  }
});

authRouter.post('/2fa/verify', async (req, res) => {
  try {
    const { email, code, consentAccepted } = verify2FAProSchema.parse(req.body);

    // Vérifier que l'utilisateur existe et est PRO
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, role: true, email: true, password: true }
    });

    if (!user) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }

    if (user.role !== 'PRO') {
      return res.status(403).json({ error: '2FA disponible uniquement pour les pros' });
    }

    // Extract client IP for rate limiting (secure extraction)
    const clientIp = getClientIp(req);

    const verification = await twoFactorService.verifyCode(user.id, code, clientIp);

    if (verification.valid) {
      // Code valide - générer les tokens JWT comme pour un login normal
      const ip = clientIp || undefined;

      // Utiliser le service de login avec les données de consentement fournies par le client.
      // consentAccepted ne doit pas être hardcodé à true — on lit la valeur du body.
      const authContext = await rotateAuthenticatedSession(req, user.id);
      const tokens = await service.generateTokens(user, { consentAccepted, consentIp: ip }, authContext);
      setAuthCookies(res, tokens);
      res.json({
        message: 'Authentification 2FA réussie',
        ok: true,
      });
    } else {
      res.status(401).json({ error: verification.message });
    }
  } catch (err: any) {
    if (err?.name === 'ZodError') {
      return res.status(400).json({ error: 'Invalid input', details: err.errors });
    }
    return res.status(500).json({ error: 'Internal error' });
  }
});

// Demo: route protégée par email vérifié (à réutiliser pour modules critiques)
authRouter.get('/verified-only', requireAuth, requireVerifiedEmail, async (_req, res) => {
  return res.json({ ok: true });
});
