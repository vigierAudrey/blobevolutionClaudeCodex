import type { Request, Response, NextFunction } from 'express';
import { clientPrisma as prisma } from '@blobinfini/database';
import { getClientIp, hashIp } from '../lib/client-ip';

export type AuditResourceResolver = (req: Request, res: Response) => string;

export const audit = (action: string, resolveResource?: AuditResourceResolver) => {
  return (req: Request, res: Response, next: NextFunction) => {
    res.on('finish', () => {
      if (res.statusCode >= 500) return;
      const userId = (req as any).user?.id as string | undefined;
      const ip = getClientIp(req) || null;
      const resource = resolveResource ? resolveResource(req, res) : req.originalUrl;
      const extraMetadata = res.locals?.auditMetadata && typeof res.locals.auditMetadata === 'object'
        ? res.locals.auditMetadata
        : undefined;
      const metadata = {
        method: req.method,
        statusCode: res.statusCode,
        params: req.params,
        ...(extraMetadata || {})
      };
      // Privacy-by-design: hash IP before storing (RGPD compliant)
      // This allows correlation while preventing raw IP storage
      const ipHash = hashIp(ip ?? undefined);

      prisma.auditLog.create({
        data: {
          userId,
          action,
          resource,
          metadata,
          ip: ipHash ?? undefined,
        }
      }).catch((error: unknown) => {
        console.error('Audit log error:', error);
      });
    });

    next();
  };
};
