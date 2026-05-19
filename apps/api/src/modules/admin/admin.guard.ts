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

function getPrimaryAdminEmailsFromEnv(): Set<string> {
  return new Set(
    String(process.env.PRIMARY_ADMIN_EMAILS ?? '')
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  );
}

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
  const primaryAdminEmails = getPrimaryAdminEmailsFromEnv();
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

/**
 * Requires that the admin has AT LEAST ONE of the listed permissions (OR semantics).
 *
 * Use this for endpoints that accept multiple permission paths, e.g. backward compat:
 *   requireAnyPermission('security.read', 'system.configure')
 *
 * Contrast with requirePermissions() which requires ALL (AND semantics).
 *
 * Safe-default: if permissions list is empty → 403.
 * This is intentionally the OPPOSITE of requirePermissions (which allows if empty).
 */
export const requireAnyPermission = (...permissions: Permission[]) => {
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

    // Safe-default: empty list = deny (caller bug, not ambiguity)
    if (permissions.length === 0) {
      secureLogger.warn('ADMIN_PERMISSION_DENIED', {
        userId: user.id,
        reason: 'requireAnyPermission called with empty permissions list',
        path: req.path,
      });
      return res.status(403).json({ error: 'Forbidden: no permissions specified' });
    }

    try {
      const profile = await loadAdminProfile(req as AdminGuardRequest);
      const assignedPermissions = profile?.permissions ?? [];
      const hasAny = permissions.some((p) => assignedPermissions.includes(p));

      if (!hasAny) {
        secureLogger.warn('ADMIN_PERMISSION_DENIED', {
          userId: user.id,
          requiredAny: permissions,
          assigned: assignedPermissions,
        });
        return res.status(403).json({
          error: 'Forbidden: missing permissions',
          requiredAny: permissions,
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
