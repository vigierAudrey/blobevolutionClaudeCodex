import { Router } from 'express';
import { z } from 'zod';
import { rateLimit } from '../../middleware/rate-limit';
import { requireAuth } from './auth.guard';
import { AuthService } from './auth.service';

export const authRouter = Router();
const service = new AuthService();

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(['RIDER', 'PRO']).default('RIDER'),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
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

authRouter.post('/register', async (req, res) => {
  try {
    const data = registerSchema.parse(req.body);
    const result = await service.register(data);
    res.status(201).json(result);
  } catch (err: any) {
    if (err?.name === 'ZodError') {
      return res.status(400).json({ error: 'Invalid input', details: err.errors });
    }
    return res.status(500).json({ error: 'Internal error' });
  }
});

authRouter.post('/login', async (req, res) => {
  // Rate limit (par IP) – config élevée pour ne pas gêner les tests
  rateLimit({ key: 'auth:login', limit: 100, windowMs: 60_000 })(req, res, async () => {
    try {
      const { email, password } = loginSchema.parse(req.body);
      const result = await service.login(email, password);
      res.json(result);
    } catch (err: any) {
      if (err?.name === 'ZodError') {
        return res.status(400).json({ error: 'Invalid input', details: err.errors });
      }
      if (err?.code === 'UNAUTHORIZED') {
        return res.status(401).json({ error: 'Invalid credentials' });
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
