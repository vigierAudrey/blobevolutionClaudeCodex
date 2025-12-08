import { clientPrisma as prisma } from '@blobinfini/database';
import type { NextFunction, Request, Response } from 'express';
import { securityAlertService } from '../../services/security-alert.service';

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
      const ips = (req as any).ips as string[] | undefined;
      const ip = (ips && ips.length > 0 ? ips[0] : undefined) || req.ip || (req as any).socket?.remoteAddress || undefined;
      const userAgent = req.get('user-agent');
      // Use req.baseUrl + req.path to get full endpoint path
      const endpoint = `${req.method} ${req.baseUrl}${req.path}`;

      // Report security violation based on role
      if (dbUser?.role === 'RIDER') {
        await securityAlertService.reportRiderToProViolation(
          user.id,
          endpoint,
          dbUser.email,
          ip,
          userAgent
        );
        console.warn(`🚨 Security: RIDER user ${user.id} attempted to access PRO endpoint ${endpoint}`);
      } else if (dbUser?.role === 'ADMIN') {
        // ⚠️ CRITICAL: Even ADMIN should trigger alert (potential compromised account)
        await securityAlertService.reportAdminToProViolation(
          user.id,
          endpoint,
          dbUser.email,
          ip,
          userAgent
        );
        console.warn(`🚨 Security: ADMIN user ${user.id} attempted to access PRO endpoint ${endpoint} - Potential compromised account!`);
      } else {
        // Invalid or unknown role
        await securityAlertService.reportInvalidRoleViolation(
          user.id,
          dbUser?.role || 'UNKNOWN',
          endpoint,
          dbUser?.email,
          ip,
          userAgent
        );
        console.warn(`🚨 Security: User ${user.id} with invalid role '${dbUser?.role || 'UNKNOWN'}' attempted to access PRO endpoint ${endpoint}`);
      }

      return res.status(403).json({
        error: 'Accès refusé : Vous devez avoir un compte PRO pour accéder à cette ressource.',
        message: 'Cette tentative d\'accès a été enregistrée et l\'administrateur en a été informé.'
      });
    }

    (req as any).user.role = 'PRO';
    return next();
  } catch (error) {
    console.error('requireProRole error:', error);
    return res.status(500).json({ error: 'Internal error' });
  }
};
