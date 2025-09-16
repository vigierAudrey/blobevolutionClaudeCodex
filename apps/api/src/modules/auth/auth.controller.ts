import { Router } from 'express';
import { z } from 'zod';
import { rateLimit } from '../../middleware/rate-limit';
import { requireAuth, requireVerifiedEmail } from './auth.guard';
import { AuthService } from './auth.service';
import { prisma } from '@blobinfini/database';

export const authRouter = Router();
const service = new AuthService();

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(['RIDER', 'PRO', 'ADMIN']).default('RIDER'),
  consentAccepted: z.literal(true, {
    errorMap: () => ({ message: 'Vous devez accepter la charte et l’avertissement.' }),
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
  password: z.string().min(8),
});

const verifyEmailSchema = z.object({
  token: z.string().min(10),
});

const resendVerifySchema = z.object({
  email: z.string().email(),
});

authRouter.post('/register', async (req, res) => {
  try {
    const data = registerSchema.parse(req.body);
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

authRouter.post('/login', async (req, res) => {
  // Rate limit (par IP) – config élevée pour ne pas gêner les tests
  rateLimit({ key: 'auth:login', limit: 100, windowMs: 60_000 })(req, res, async () => {
    try {
      const { email, password, consentAccepted } = loginSchema.parse(req.body);
      const ips = (req as any).ips as string[] | undefined;
      const ip = (ips && ips.length > 0 ? ips[0] : undefined) || req.ip || (req as any).socket?.remoteAddress || undefined;
      const result = await service.login(email, password, { consentAccepted, consentIp: ip });
      res.json(result);
    } catch (err: any) {
      if (err?.name === 'ZodError') {
        return res.status(400).json({ error: 'Invalid input', details: err.errors });
      }
      if (err?.code === 'UNAUTHORIZED') {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      if (err?.code === 'CONSENT_REQUIRED') {
        return res.status(403).json({ error: 'Consent required', code: 'CONSENT_REQUIRED', consentVersion: 'v1.0.0' });
      }
      if (err?.code === 'EMAIL_NOT_VERIFIED') {
        return res.status(403).json({ error: 'Email not verified' });
      }
      return res.status(500).json({ error: 'Internal error' });
    }
  });
});

authRouter.post('/refresh', async (req, res) => {
  // Rate limit (par IP) – config élevée pour ne pas gêner les tests
  rateLimit({ key: 'auth:refresh', limit: 100, windowMs: 60_000 })(req, res, async () => {
    try {
      const { refreshToken } = refreshSchema.parse(req.body);
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
authRouter.post('/resend-verification', async (req, res) => {
  // Rate limit pour éviter l'abus
  rateLimit({ key: 'auth:resend', limit: 30, windowMs: 60_000 })(req, res, async () => {
    try {
      const { email } = resendVerifySchema.parse(req.body);
      const result = await service.resendEmailVerification(email);
      res.json(result);
    } catch (err: any) {
      if (err?.name === 'ZodError') {
        return res.status(400).json({ error: 'Invalid input', details: err.errors });
      }
      return res.status(500).json({ error: 'Internal error' });
    }
  });
});

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

// Demo: route protégée par email vérifié (à réutiliser pour modules critiques)
authRouter.get('/verified-only', requireAuth, requireVerifiedEmail, async (_req, res) => {
  return res.json({ ok: true });
});
