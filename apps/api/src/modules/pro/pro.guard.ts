import { clientPrisma as prisma } from '@blobinfini/database';
import type { NextFunction, Request, Response } from 'express';
import { securityAlertService } from '../../services/security-alert.service';
import { getClientIp } from '../../lib/client-ip';
import { secureLogger } from '../../utils/secure-logger';

/**
 * Vérifie que l'utilisateur authentifié possède bien le rôle PRO.
 *  - Si le JWT contient déjà role=PRO → autorisé immédiatement.
 *  - Sinon on vérifie en base une seule fois (cas d'un token ancien ou mal signé).
 *  - Si l'utilisateur n'est pas PRO (RIDER, ADMIN, ou autre), une alerte de sécurité est envoyée.
 *
 * IMPORTANT SÉCURITÉ :
 *  - Même un compte ADMIN doit déclencher une alerte s'il accède aux endpoints PRO
 *  - Cela permet de détecter un compte admin compromis
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
      select: { role: true, email: true }
    });

    if (dbUser?.role !== 'PRO') {
      // Extract IP and User-Agent for security audit
      const clientIp = getClientIp(req) ?? undefined;
      const userAgent = req.get('user-agent');
      // Use req.baseUrl + req.path to get full endpoint path
      const endpoint = `${req.method} ${req.baseUrl}${req.path}`;

      // Report security violation based on role
      if (dbUser?.role === 'RIDER') {
        await securityAlertService.reportRiderToProViolation(
          user.id,
          endpoint,
          dbUser.email,
          clientIp,
          userAgent
        );
        secureLogger.security('PRO_ROLE_VIOLATION_RIDER', { userId: user.id, endpoint });
      } else if (dbUser?.role === 'ADMIN') {
        // ⚠️ CRITICAL: Even ADMIN should trigger alert (potential compromised account)
        await securityAlertService.reportAdminToProViolation(
          user.id,
          endpoint,
          dbUser.email,
          clientIp,
          userAgent
        );
        secureLogger.security('PRO_ROLE_VIOLATION_ADMIN', { userId: user.id, endpoint });
      } else {
        // Invalid or unknown role
        await securityAlertService.reportInvalidRoleViolation(
          user.id,
          dbUser?.role || 'UNKNOWN',
          endpoint,
          dbUser?.email,
          clientIp,
          userAgent
        );
        secureLogger.security('PRO_ROLE_VIOLATION_INVALID_ROLE', {
          userId: user.id,
          endpoint,
          role: dbUser?.role || 'UNKNOWN'
        });
      }

      return res.status(403).json({
        error: 'Accès refusé : Vous devez avoir un compte PRO pour accéder à cette ressource.',
        message: 'Cette tentative d\'accès a été enregistrée et l\'administrateur en a été informé.'
      });
    }

    (req as any).user.role = 'PRO';
    return next();
  } catch (error) {
    secureLogger.error('PRO_ROLE_GUARD_FAILED', { error });
    return res.status(500).json({ error: 'Internal error' });
  }
};
