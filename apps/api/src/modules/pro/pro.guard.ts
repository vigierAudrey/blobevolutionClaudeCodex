import { clientPrisma as prisma } from '@blobinfini/database';
import type { NextFunction, Request, Response } from 'express';

/**
 * Vérifie que l'utilisateur authentifié possède bien le rôle PRO.
 *  - Si le JWT contient déjà role=PRO → autorisé immédiatement.
 *  - Sinon on vérifie en base une seule fois (cas d'un token ancien ou mal signé).
 */
export const requireProRole = async (req: Request, res: Response, next: NextFunction) => {
  const user = (req as any).user as { id: string; role: string } | undefined;
  if (!user?.id) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (user.role === 'PRO') {
    return next();
  }

  try {
    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { role: true }
    });

    if (dbUser?.role !== 'PRO') {
      return res.status(403).json({ error: 'Forbidden: PRO role required' });
    }

    (req as any).user.role = 'PRO';
    return next();
  } catch (error) {
    console.error('requireProRole error:', error);
    return res.status(500).json({ error: 'Internal error' });
  }
};
