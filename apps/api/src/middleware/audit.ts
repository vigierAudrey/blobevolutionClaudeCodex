import type { Request, Response, NextFunction } from 'express';
import { clientPrisma as prisma } from '@blobinfini/database';

export type AuditResourceResolver = (req: Request, res: Response) => string;

export const audit = (action: string, resolveResource?: AuditResourceResolver) => {
  return (req: Request, res: Response, next: NextFunction) => {
    res.on('finish', () => {
      if (res.statusCode >= 500) return;
      const userId = (req as any).user?.id as string | undefined;
      const ip = ((req as any).ips?.[0]) || req.ip || (req.socket as any)?.remoteAddress || null;
      const resource = resolveResource ? resolveResource(req, res) : req.originalUrl;
      const metadata = {
        method: req.method,
        statusCode: res.statusCode,
        params: req.params,
      };
      prisma.auditLog.create({
        data: {
          userId,
          action,
          resource,
          metadata,
          ip: ip ?? undefined,
        }
      }).catch((error: unknown) => {
        console.error('Audit log error:', error);
      });
    });

    next();
  };
};
