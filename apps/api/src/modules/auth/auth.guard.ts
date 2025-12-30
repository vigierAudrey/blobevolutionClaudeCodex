import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { clientPrisma as prisma } from '@blobinfini/database';

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing token' });
  }
  const token = auth.slice('Bearer '.length);
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET as string) as any;
    (req as any).user = { id: payload.sub, role: payload.role };
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) {
    return next();
  }
  const token = auth.slice('Bearer '.length);
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET as string) as any;
    (req as any).user = { id: payload.sub, role: payload.role };
  } catch {
    // Ignore invalid tokens for optional auth routes.
  }
  next();
}

export function requireRole(role: 'RIDER' | 'PRO' | 'ADMIN') {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user as { id: string; role: string } | undefined;
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    if (user.role !== role) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
}

export async function requireVerifiedEmail(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).user as { id: string } | undefined;
  if (!user?.id) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const found = await prisma.user.findUnique({ where: { id: user.id }, select: { emailVerified: true } });
    if (!found) return res.status(401).json({ error: 'Unauthorized' });
    if (!found.emailVerified) return res.status(403).json({ error: 'Email not verified' });
    return next();
  } catch {
    return res.status(500).json({ error: 'Internal error' });
  }
}

// Helper pour les middlewares admin
export const requireAdmin = requireRole('ADMIN');
export const requirePro = requireRole('PRO');
export const requireRider = requireRole('RIDER');
