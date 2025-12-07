import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireVerifiedEmail } from './auth.guard';
import { AuthService } from './auth.service';
import { clientPrisma as prisma } from '@blobinfini/database';
import { twoFactorService } from '../../services/two-factor.service';
import { validate } from '../../middleware/validate';
import { passwordSchema } from '../../utils/password-validator';
import { createRateLimiter } from '../../middleware/enhanced-rate-limit';
import { secureLogger } from '../../utils/secure-logger';
import { createHash } from 'crypto';

export const authRouter = Router();
const service = new AuthService();

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
  refreshToken: z.string().min(10),
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

function hashEmail(email: string) {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}

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
});

authRouter.post('/register', validate(registerSchema), async (req, res) => {
  try {
    const data = req.body as z.infer<typeof registerSchema>;
    // Extraire la meilleure IP disponible
    // Si trust proxy est activé (voir apps/api/src/index.ts), req.ips[0] reflète le premier IP client
    const ips = (req as any).ips as string[] | undefined;
    const ip = (ips && ips.length > 0 ? ips[0] : undefined) || req.ip || (req as any).socket?.remoteAddress || undefined;
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
  const ips = (req as any).ips as string[] | undefined;
  const ip = (ips && ips.length > 0 ? ips[0] : undefined) || req.ip || (req as any).socket?.remoteAddress || undefined;
  const userAgent = categorizeUserAgent(req.get('User-Agent'));

  try {
    const result = await service.login(email, password, { consentAccepted, consentIp: ip });

    // Log successful login attempt
    const user = await prisma.user.findUnique({ where: { email } });
    await prisma.loginAttempt.create({
      data: {
        email,
        ip,
        userAgent,
        success: true,
        userId: user?.id
      }
    }).catch(() => {}); // Ignore logging errors

    res.json(result);
  } catch (err: any) {
    // Log failed login attempt
    let reason = 'Unknown error';
    if (err?.name === 'ZodError') {
      reason = 'Invalid input';
      await prisma.loginAttempt.create({
        data: { email, ip, userAgent, success: false, reason }
      }).catch(() => {});
      return res.status(400).json({ error: 'Invalid input', details: err.errors });
    }
    if (err?.code === 'UNAUTHORIZED') {
      reason = 'Invalid credentials';
      await prisma.loginAttempt.create({
        data: { email, ip, userAgent, success: false, reason }
      }).catch(() => {});
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    if (err?.code === 'CONSENT_REQUIRED') {
      // Don't log consent required as failed attempt
      return res.status(403).json({ error: 'Consent required', code: 'CONSENT_REQUIRED', consentVersion: 'v1.0.0' });
    }
    if (err?.code === 'EMAIL_NOT_VERIFIED') {
      reason = 'Email not verified';
      await prisma.loginAttempt.create({
        data: { email, ip, userAgent, success: false, reason }
      }).catch(() => {});
      return res.status(403).json({ error: 'Email not verified' });
    }
    // ✅ NOUVEAU : Gestion 2FA admin
    if (err?.code === '2FA_REQUIRED') {
      // Envoyer le code 2FA par email
      await twoFactorService.sendCode(err.userId, err.email);
      return res.status(200).json({
        requires2FA: true,
        userId: err.userId,
        message: 'Code de vérification envoyé par email'
      });
    }

    // Log unexpected errors
    reason = 'Internal server error';
    await prisma.loginAttempt.create({
      data: { email, ip, userAgent, success: false, reason }
    }).catch(() => {});
    return res.status(500).json({ error: 'Internal error' });
  }
});

// ✅ NOUVEAU : Endpoint pour vérifier le code 2FA admin
const verify2FASchema = z.object({
  userId: z.string().uuid(),
  code: z.string().length(6),
  consentAccepted: z.boolean().optional().default(false),
});

authRouter.post('/verify-2fa', validate(verify2FASchema), async (req, res) => {
  try {
    const { userId, code, consentAccepted } = req.body as z.infer<typeof verify2FASchema>;

    // Vérifier le code 2FA
    const verification = await twoFactorService.verifyCode(userId, code);

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

    // Vérifier IP whitelisting si configuré
    const ips = (req as any).ips as string[] | undefined;
    const clientIP = (ips && ips.length > 0 ? ips[0] : undefined) || req.ip || (req as any).socket?.remoteAddress;

    if (user.adminProfile?.allowedIPs && user.adminProfile.allowedIPs.length > 0) {
      if (!clientIP || !user.adminProfile.allowedIPs.includes(clientIP)) {
        return res.status(403).json({
          error: 'IP non autorisée',
          clientIP,
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
    const ip = clientIP || undefined;
    const tokens = await service.generateTokens(user, { consentAccepted, consentIp: ip });

    return res.json(tokens);
  } catch (err: any) {
    secureLogger.error('2FA_VERIFICATION_ERROR', {
      error: err?.message,
      name: err?.name,
      userId: req.body?.userId
    });
    if (err?.name === 'ZodError') {
      return res.status(400).json({ error: 'Invalid input', details: err.errors });
    }
    return res.status(500).json({ error: 'Internal error' });
  }
});

authRouter.post('/refresh', validate(refreshSchema), async (req, res) => {
  try {
    const { refreshToken } = req.body as z.infer<typeof refreshSchema>;
    const result = await service.refresh(refreshToken);
    res.json(result);
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
    const { allDevices, refreshToken } = logoutSchema.parse(req.body ?? {});
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    if (allDevices || !refreshToken) {
      const result = await service.logoutAll(userId);
      return res.json(result);
    }
    const result = await service.logoutSingle(userId, refreshToken);
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
        consentIp: true,
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
    const { email, code } = verify2FAProSchema.parse(req.body);

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

    const verification = await twoFactorService.verifyCode(user.id, code);

    if (verification.valid) {
      // Code valide - générer les tokens JWT comme pour un login normal
      const ips = (req as any).ips as string[] | undefined;
      const ip = (ips && ips.length > 0 ? ips[0] : undefined) || req.ip || (req as any).socket?.remoteAddress || undefined;

      // Utiliser le service de login avec des données simulées (pas besoin de re-vérifier password)
      const tokens = await service.generateTokens(user, { consentAccepted: true, consentIp: ip });

      res.json({
        message: 'Authentification 2FA réussie',
        ...tokens
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
