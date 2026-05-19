import { clientPrisma as prisma } from '@blobinfini/database';
import type { NextFunction, Request, Response } from 'express';
import { securityAlertService } from '../services/security-alert.service';
import { getClientIp } from './client-ip';
import { secureLogger } from '../utils/secure-logger';

/**
 * Type des rôles supportés par la fabrique.
 * ADMIN est exclu : le routeur admin est protégé par IP allowlist + step-up auth,
 * le fallback DB y ajouterait une requête inutile sur chaque requête légitime.
 */
export type SecuredRole = 'PRO' | 'RIDER';

/**
 * Fabrique de guard de rôle serveur.
 *
 * Comportement :
 *  1. Fast path : si le JWT contient déjà le bon rôle → next() sans DB.
 *  2. Fallback DB : si le JWT est stale ou ambigu → vérification en base.
 *  3. Violation : 403 neutre + alerte securityAlertService + log sans PII.
 *
 * Source unique de vérité pour requireProRole et requireRiderRole.
 */
export function requireRole(requiredRole: SecuredRole) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user as { id: string; role: string } | undefined;
    if (!user?.id) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (user.role === requiredRole) {
      return next();
    }

    let dbUser: { role: string; email: string } | null;
    try {
      dbUser = await prisma.user.findUnique({
        where: { id: user.id },
        select: { role: true, email: true },
      });
    } catch (error) {
      secureLogger.error('ROLE_GUARD_DB_FAILED', { error });
      return res.status(500).json({ error: 'Internal error' });
    }

    if (dbUser?.role === requiredRole) {
      (req as any).user.role = requiredRole;
      return next();
    }

    const endpoint = `${req.method} ${req.baseUrl}${req.path}`;
    const clientIp = getClientIp(req) ?? undefined;
    const userAgent = req.get('user-agent');
    const actualRole = dbUser?.role ?? 'UNKNOWN';

    try {
      await dispatchViolationAlert(
        requiredRole,
        actualRole,
        user.id,
        dbUser?.email,
        endpoint,
        clientIp,
        userAgent,
      );
    } catch (alertError) {
      secureLogger.error('ROLE_GUARD_ALERT_FAILED', { alertError });
    }

    secureLogger.security('ROLE_GUARD_VIOLATION', {
      requiredRole,
      actualRole,
      userId: user.id,
      endpoint,
    });

    return res.status(403).json({
      error: 'Accès refusé : rôle insuffisant pour accéder à cette ressource.',
      message: "Cette tentative d'accès a été enregistrée et l'administrateur en a été informé.",
    });
  };
}

async function dispatchViolationAlert(
  requiredRole: SecuredRole,
  actualRole: string,
  userId: string,
  email: string | undefined,
  endpoint: string,
  clientIp: string | undefined,
  userAgent: string | undefined,
): Promise<void> {
  if (requiredRole === 'PRO') {
    if (actualRole === 'RIDER') {
      return securityAlertService.reportRiderToProViolation(userId, endpoint, email, clientIp, userAgent);
    }
    if (actualRole === 'ADMIN') {
      return securityAlertService.reportAdminToProViolation(userId, endpoint, email, clientIp, userAgent);
    }
  }
  if (requiredRole === 'RIDER' && actualRole === 'PRO') {
    return securityAlertService.reportProToRiderViolation(userId, endpoint, email, clientIp, userAgent);
  }
  await securityAlertService.reportInvalidRoleViolation(userId, actualRole, endpoint, email, clientIp, userAgent);
}
