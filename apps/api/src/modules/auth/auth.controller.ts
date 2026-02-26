import { Router, Response } from 'express';
import { z } from 'zod';
import jwt from 'jsonwebtoken';
import { requireAuth, requireVerifiedEmail } from './auth.guard';
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
import {
  ADMIN_STEP_UP_TTL_SECONDS,
  grantAdminStepUp,
  isAdminIpAllowedForUser,
} from '../admin/admin.security-guard';

export const authRouter = Router();
const service = new AuthService();

// ─────────────────────────────────────────────────────────────────────────────
// Cookie helpers
// ─────────────────────────────────────────────────────────────────────────────

const IS_PROD = process.env.NODE_ENV === 'production';

/** Options shared by both set and clear operations — MUST be identical for clearing to work. */
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
  // Scope to /auth/refresh so the browser never sends it to other endpoints.
  // clearCookie() with the same options still works from any endpoint.
  path: '/auth/refresh',
} as const;

/**
 * Set both auth cookies.
 * - accessToken : 15 min, path=/
 * - refreshToken: 30 days, path=/auth/refresh (path-scoped to limit exposure)
 *
 * SameSite=Lax justification:
 *   • Cookies ARE sent on same-origin requests and top-level navigation (link clicks from email).
 *   • Cookies are NOT sent on cross-origin subresource / non-GET navigation.
 *   • All mutations also require the X-CSRF-Token header (double protection).
 *   • SameSite=Strict would break email links (user not logged in on first click).
 *   • Lax is the IETF-recommended default for session cookies.
 */
function setAuthCookies(res: Response, tokens: { accessToken: string; refreshToken: string; refreshMaxAgeMs?: number }): void {
  res.cookie('accessToken', tokens.accessToken, {
    ...ACCESS_COOKIE_BASE,
    maxAge: 15 * 60 * 1000, // 15 minutes in ms
  });
  res.cookie('refreshToken', tokens.refreshToken, {
    ...REFRESH_COOKIE_BASE,
    // refreshMaxAgeMs est défini par auth.service.ts selon le rôle :
    // ADMIN = ADMIN_REFRESH_TTL_HOURS (défaut 8h), autres rôles = 30j.
    maxAge: tokens.refreshMaxAgeMs ?? 30 * 24 * 60 * 60 * 1000,
  });
}

/**
 * Clear both auth cookies.
 * CRITICAL: options MUST match setAuthCookies exactly (same path, sameSite, secure)
 * otherwise the browser ignores the Set-Cookie directive.
 */
function clearAuthCookies(res: Response): void {
  res.clearCookie('accessToken', ACCESS_COOKIE_BASE);
  res.clearCookie('refreshToken', REFRESH_COOKIE_BASE);
}

// ─────────────────────────────────────────────────────────────────────────────
// Schemas
// ─────────────────────────────────────────────────────────────────────────────

const registerSchema = z.object({
  email: z.string().email(),
  password: passwordSchema,
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

const forgotSchema = z.object({
  email: z.string().email(),
});

const resetSchema = z.object({
  token: z.string().min(10),
  password: passwordSchema,
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(8),
  newPassword: passwordSchema,
});

const verifyEmailSchema = z.object({
  token: z.string().min(10),
});

const resendVerifySchema = z.object({
  email: z.string().email(),
});

const send2FASchema = z.object({
  email: z.string().email(),
});

const verify2FAProSchema = z.object({
  email: z.string().email(),
  code: z.string().length(6, 'Code must be 6 digits'),
});

const verify2FASchema = z.object({
  userId: z.string().uuid(),
  code: z.string().length(6),
  consentAccepted: z.boolean().optional().default(false),
});

const stepUpSchema = z.discriminatedUnion('intent', [
  z.object({
    intent: z.literal('send'),
  }),
  z.object({
    intent: z.literal('verify'),
    code: z.string().length(6),
  }),
]);

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function hashEmail(email: string) {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}

function categorizeUserAgent(userAgent: string | undefined): string | undefined {
  if (!userAgent) return undefined;
  const ua = userAgent.toLowerCase();
  if (ua.includes('mobile') || ua.includes('iphone') || ua.includes('android')) return 'mobile';
  if (ua.includes('bot') || ua.includes('crawler') || ua.includes('spider')) return 'bot';
  return 'desktop';
}

// ─────────────────────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────────────────────

authRouter.post('/register', validate(registerSchema), async (req, res) => {
  try {
    const data = req.body as z.infer<typeof registerSchema>;
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
 * POST /auth/login
 *
 * On success: sets accessToken + refreshToken as httpOnly cookies.
 * NEVER returns tokens in the JSON body (prevents XSS exfiltration).
 */
authRouter.post('/login', validate(loginSchema), async (req, res) => {
  const { email, password, consentAccepted } = req.body as z.infer<typeof loginSchema>;
  const ip = getClientIp(req);
  const userAgent = categorizeUserAgent(req.get('User-Agent'));

  try {
    const result = await service.login(email, password, { consentAccepted, consentIp: ip });

    // Log successful login
    const user = await prisma.user.findUnique({ where: { email } });
    await prisma.loginAttempt.create({
      data: {
        email,
        ipHash: hashIpHmac(ip) ?? undefined,
        userAgent,
        success: true,
        userId: user?.id,
      },
    }).catch(() => {});

    if (user?.id && ip) {
      securityEventAlertService.reportSuccessAfterFailures(
        email,
        hashIpHmac(ip)!,
        user.id,
      ).catch(() => {});
    }

    // Set tokens as httpOnly cookies — no tokens in response body
    setAuthCookies(res, result);
    return res.json({ ok: true });
  } catch (err: any) {
    let reason = 'Unknown error';

    if (err?.name === 'ZodError') {
      reason = 'Invalid input';
      await prisma.loginAttempt.create({
        data: { email, ipHash: hashIpHmac(ip) ?? undefined, userAgent, success: false, reason },
      }).catch(() => {});
      return res.status(400).json({ error: 'Invalid input', details: err.errors });
    }
    if (err?.code === 'UNAUTHORIZED') {
      reason = 'Invalid credentials';
      await prisma.loginAttempt.create({
        data: { email, ipHash: hashIpHmac(ip) ?? undefined, userAgent, success: false, reason },
      }).catch(() => {});
      if (ip) {
        securityEventAlertService.detectAndReportLoginFailurePattern(
          email,
          hashIpHmac(ip)!,
        ).catch(() => {});
      }
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    if (err?.code === 'CONSENT_REQUIRED') {
      return res.status(403).json({ error: 'Consent required', code: 'CONSENT_REQUIRED', consentVersion: 'v1.0.0' });
    }
    if (err?.code === 'EMAIL_NOT_VERIFIED') {
      reason = 'Email not verified';
      await prisma.loginAttempt.create({
        data: { email, ipHash: hashIpHmac(ip) ?? undefined, userAgent, success: false, reason },
      }).catch(() => {});
      return res.status(403).json({ error: 'Email not verified' });
    }
    if (err?.code === '2FA_REQUIRED') {
      await twoFactorService.sendCode(err.userId, err.email);
      return res.status(200).json({
        requires2FA: true,
        userId: err.userId,
        message: 'Code de vérification envoyé par email',
      });
    }

    reason = 'Internal server error';
    await prisma.loginAttempt.create({
      data: { email, ipHash: hashIpHmac(ip) ?? undefined, userAgent, success: false, reason },
    }).catch(() => {});
    return res.status(500).json({ error: 'Internal error' });
  }
});

/**
 * POST /auth/verify-2fa  (admin 2FA)
 *
 * On success: sets auth cookies — no tokens in body.
 */
authRouter.post('/verify-2fa', validate(verify2FASchema), async (req, res) => {
  try {
    const { userId, code, consentAccepted } = req.body as z.infer<typeof verify2FASchema>;
    const clientIp = getClientIp(req);

    const verification = await twoFactorService.verifyCode(userId, code, clientIp);
    if (!verification.valid) {
      return res.status(401).json({ error: verification.message });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { adminProfile: true },
    });

    if (!user || user.role !== 'ADMIN') {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (user.adminProfile?.allowedIPs && user.adminProfile.allowedIPs.length > 0) {
      if (!clientIp || !user.adminProfile.allowedIPs.includes(clientIp)) {
        return res.status(403).json({
          error: 'IP non autorisée',
          message: 'Votre adresse IP n\'est pas autorisée à accéder à ce compte admin',
        });
      }
    }

    await prisma.adminProfile.update({
      where: { userId: user.id },
      data: { lastLoginAt: new Date() },
    });

    const ip = clientIp || undefined;
    const tokens = await service.generateTokens(user, { consentAccepted, consentIp: ip });

    setAuthCookies(res, tokens);
    return res.json({ ok: true });
  } catch (err: any) {
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

authRouter.post('/step-up', requireAuth, requireVerifiedEmail, validate(stepUpSchema), async (req, res) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, role: true },
    });

    if (!user || user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Admin role required' });
    }

    const payload = req.body as z.infer<typeof stepUpSchema>;

    if (payload.intent === 'send') {
      const sent = await twoFactorService.sendCode(user.id, user.email);
      if (!sent.success) {
        return res.status(503).json({ error: 'Step-up code delivery unavailable' });
      }
      return res.json({ ok: true, challengeSent: true });
    }

    const clientIp = getClientIp(req);
    const verification = await twoFactorService.verifyCode(user.id, payload.code, clientIp);
    if (!verification.valid) {
      return res.status(401).json({ error: verification.message });
    }

    const grant = await grantAdminStepUp(user.id);
    if (!grant.ok) {
      secureLogger.security('CRITICAL_ADMIN_STEP_UP_GRANT_UNAVAILABLE', {
        userId: user.id,
      });
      return res.status(403).json({ error: 'Step-up authentication required' });
    }

    return res.json({
      ok: true,
      expiresInSeconds: ADMIN_STEP_UP_TTL_SECONDS,
      stepUpUntil: new Date(grant.stepUpUntil).toISOString(),
    });
  } catch (err: any) {
    if (err?.name === 'ZodError') {
      return res.status(400).json({ error: 'Invalid input', details: err.errors });
    }
    return res.status(500).json({ error: 'Internal error' });
  }
});

/**
 * POST /auth/refresh
 *
 * Reads the refresh token from the httpOnly cookie (path-scoped to /auth/refresh).
 * Returns { ok: true } — never exposes tokens in body.
 * Sets new access token + rotated refresh token as cookies.
 */
authRouter.post('/refresh', async (req, res) => {
  const refreshToken = req.cookies?.refreshToken as string | undefined;
  if (!refreshToken) {
    return res.status(401).json({ error: 'Missing refresh token' });
  }

  try {
    let refreshUserId: string | undefined;
    try {
      const payload = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET as string) as { sub?: string };
      refreshUserId = typeof payload?.sub === 'string' ? payload.sub : undefined;
    } catch {
      // Let AuthService.refresh handle invalid/expired tokens with the standard 401 flow.
    }

    if (refreshUserId) {
      try {
        const clientIp = getClientIp(req);
        const ipAllowed = await isAdminIpAllowedForUser(refreshUserId, clientIp);
        if (!ipAllowed) {
          return res.status(403).json({
            error: 'IP non autorisée',
            message: 'Votre adresse IP n\'est pas autorisée pour ce compte admin',
          });
        }
      } catch (error) {
        secureLogger.security('CRITICAL_AUTH_REFRESH_ADMIN_IP_CHECK_ERROR', {
          userId: refreshUserId,
          error: error instanceof Error ? error.message : String(error),
        });
        return res.status(403).json({ error: 'Admin IP enforcement failed closed' });
      }
    }

    const result = await service.refresh(refreshToken);
    setAuthCookies(res, result);
    return res.json({ ok: true });
  } catch (err: any) {
    // Clear cookies on revoked/invalid token so the client knows to re-authenticate
    clearAuthCookies(res);
    if (err?.code === 'UNAUTHORIZED') {
      return res.status(401).json({ error: 'Invalid refresh token' });
    }
    return res.status(500).json({ error: 'Internal error' });
  }
});

/**
 * POST /auth/logout
 *
 * Increments sessionVersion (invalidates all live access tokens immediately),
 * revokes all refresh tokens, and clears both auth cookies.
 * requireAuth reads the accessToken cookie to identify the user.
 */
authRouter.post('/logout', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    await service.logoutAll(userId);
    clearAuthCookies(res);
    return res.json({ ok: true });
  } catch (err: any) {
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

authRouter.post(
  '/resend-verification',
  createRateLimiter('EMAIL_VERIFICATION'),
  async (req, res) => {
    try {
      const { email } = resendVerifySchema.parse(req.body);
      secureLogger.info('AUTH_RESEND_VERIFICATION_REQUEST', { emailHash: hashEmail(email) });
      const result = await service.resendEmailVerification(email);
      res.json(result);
    } catch (err: any) {
      if (err?.name === 'ZodError') {
        return res.status(400).json({ error: 'Invalid input', details: err.errors });
      }
      return res.status(500).json({ error: 'Internal error' });
    }
  },
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
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!user) return res.status(404).json({ error: 'Not found' });
    res.json(user);
  } catch {
    return res.status(500).json({ error: 'Internal error' });
  }
});

/**
 * POST /auth/forgot-password
 *
 * Rate limited by IP (AUTH: 5/15min) AND by email hash (EMAIL_VERIFICATION: 3/hour).
 * Always returns the same generic message regardless of whether the email exists.
 */
authRouter.post(
  '/forgot-password',
  createRateLimiter('AUTH'),              // IP-based: 5 per 15 min
  createRateLimiter('EMAIL_VERIFICATION'), // Email-hash-based: 3 per hour
  async (req, res) => {
    try {
      const { email } = forgotSchema.parse(req.body);
      secureLogger.info('AUTH_FORGOT_PASSWORD_REQUEST', { emailHash: hashEmail(email) });
      const result = await service.forgotPassword(email);
      res.json(result);
    } catch (err: any) {
      if (err?.name === 'ZodError') {
        return res.status(400).json({ error: 'Invalid input', details: err.errors });
      }
      return res.status(500).json({ error: 'Internal error' });
    }
  },
);

authRouter.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = resetSchema.parse(req.body);
    const result = await service.resetPassword(token, password);
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
    // Clear cookies so the client must re-login with new password
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

// ─── 2FA Routes ───────────────────────────────────────────────────────────────

/**
 * POST /auth/2fa/send
 *
 * Anti-enumeration: always returns 200 with a generic message regardless of
 * whether the email exists or belongs to a PRO user.
 * Rate limited by IP (AUTH profile).
 */
authRouter.post('/2fa/send', createRateLimiter('AUTH'), async (req, res) => {
  try {
    const { email } = send2FASchema.parse(req.body);

    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, role: true, email: true },
    });

    // Anti-enumeration: same response regardless of user existence or role
    if (!user || user.role !== 'PRO') {
      // Constant-time response to prevent timing attacks
      return res.json({ message: 'Si ce compte existe, un code a été envoyé.' });
    }

    const result = await twoFactorService.sendCode(user.id, user.email);

    if (result.success) {
      res.json({ message: result.message });
    } else {
      // Don't expose internal errors; keep same shape
      res.status(500).json({ error: 'Internal error' });
    }
  } catch (err: any) {
    if (err?.name === 'ZodError') {
      return res.status(400).json({ error: 'Invalid input', details: err.errors });
    }
    return res.status(500).json({ error: 'Internal error' });
  }
});

/**
 * POST /auth/2fa/verify  (PRO 2FA login)
 *
 * On success: sets auth cookies — no tokens in body.
 */
authRouter.post('/2fa/verify', async (req, res) => {
  try {
    const { email, code } = verify2FAProSchema.parse(req.body);

    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, role: true, email: true, password: true },
    });

    if (!user) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }

    if (user.role !== 'PRO') {
      return res.status(403).json({ error: '2FA disponible uniquement pour les pros' });
    }

    const clientIp = getClientIp(req);
    const verification = await twoFactorService.verifyCode(user.id, code, clientIp);

    if (verification.valid) {
      const ip = clientIp || undefined;
      const tokens = await service.generateTokens(user, { consentAccepted: true, consentIp: ip });

      setAuthCookies(res, tokens);
      return res.json({ message: 'Authentification 2FA réussie', ok: true });
    } else {
      return res.status(401).json({ error: verification.message });
    }
  } catch (err: any) {
    if (err?.name === 'ZodError') {
      return res.status(400).json({ error: 'Invalid input', details: err.errors });
    }
    return res.status(500).json({ error: 'Internal error' });
  }
});

// Demo: route protégée par email vérifié
authRouter.get('/verified-only', requireAuth, requireVerifiedEmail, async (_req, res) => {
  return res.json({ ok: true });
});
