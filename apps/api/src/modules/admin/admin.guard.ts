import type { Request, Response, NextFunction } from 'express';
import { clientPrisma as prisma } from '@blobinfini/database';
import type { Permission } from './permissions';

type AdminGuardRequest = Request & {
  adminProfile?: {
    permissions: string[];
  };
};

async function loadAdminProfile(req: AdminGuardRequest) {
  if (req.adminProfile) {
    return req.adminProfile;
  }

  const user = (req as any).user as { id: string; role: string } | undefined;
  if (!user) {
    return null;
  }

  const profile = await prisma.adminProfile.findUnique({
    where: { userId: user.id },
    select: {
      permissions: true
    }
  });

  req.adminProfile = profile ?? { permissions: [] };
  return req.adminProfile;
}

export const requirePermissions = (...permissions: Permission[]) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user as { id: string; role: string } | undefined;
    if (!user || user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Admin role required' });
    }

    if (permissions.length === 0) {
      return next();
    }

    try {
      const profile = await loadAdminProfile(req as AdminGuardRequest);
      const assignedPermissions = profile?.permissions ?? [];

      const missing = permissions.filter(permission => !assignedPermissions.includes(permission));
      if (missing.length > 0) {
        return res.status(403).json({
          error: 'Forbidden: missing permissions',
          required: permissions,
          missing
        });
      }

      return next();
    } catch (error) {
      console.error('Admin permissions guard error:', error);
      return res.status(500).json({ error: 'Internal error' });
    }
  };
};
