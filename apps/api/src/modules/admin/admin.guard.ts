import type { Request, Response, NextFunction } from 'express';
import { clientPrisma as prisma } from '@blobinfini/database';
import type { Permission } from './permissions';
import { ROLE_PERMISSIONS } from './permissions';
import { secureLogger } from '../../utils/secure-logger';

type AdminGuardRequest = Request & {
  user?: { id: string; role?: string };
  adminProfile?: {
    permissions: Permission[];
    email?: string | null;
    isPrimary?: boolean;
  };
};

const primaryAdminEmails = new Set(
  (process.env.PRIMARY_ADMIN_EMAILS || 'dev+admin@test.com')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
);

async function loadAdminProfile(req: AdminGuardRequest) {
  if (req.adminProfile) {
    return req.adminProfile;
  }

  const user = req.user;
  if (!user) {
    return null;
  }

  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: {
      email: true,
      adminProfile: {
        select: {
          permissions: true
        }
      }
    }
  });

  const email = dbUser?.email ?? null;
  const isPrimary = email ? primaryAdminEmails.has(email.toLowerCase()) : false;

  let permissions: Permission[] = (dbUser?.adminProfile?.permissions ?? []) as Permission[];

  if (isPrimary) {
    permissions = [...ROLE_PERMISSIONS.SUPER_ADMIN];
    secureLogger.info('PRIMARY_ADMIN_SYNC', {
      userId: user.id,
      email,
      permissionsCount: permissions.length,
    });
    // Synchronise la base pour éviter les divergences sur le compte principal
    await prisma.adminProfile.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        displayName: dbUser?.email || 'Primary Admin',
        permissions
      },
      update: { permissions }
    });
  }

  req.adminProfile = {
    permissions,
    email,
    isPrimary
  };

  return req.adminProfile;
}

export const requirePermissions = (...permissions: Permission[]) => {
  return async (req: AdminGuardRequest, res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user || user.role !== 'ADMIN') {
      secureLogger.warn('ADMIN_ACCESS_DENIED', {
        userId: user?.id,
        role: user?.role,
        path: req.path,
      });
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
        secureLogger.warn('ADMIN_PERMISSION_DENIED', {
          userId: user.id,
          required: permissions,
          missing,
          assigned: assignedPermissions,
        });
        return res.status(403).json({
          error: 'Forbidden: missing permissions',
          required: permissions,
          missing
        });
      }

      return next();
    } catch (error) {
      secureLogger.error('ADMIN_GUARD_ERROR', {
        error: error instanceof Error ? error.message : String(error),
        userId: user?.id,
      });
      return res.status(500).json({ error: 'Internal error' });
    }
  };
};
