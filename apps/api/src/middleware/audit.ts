import type { Request, Response, NextFunction } from 'express';
import { clientPrisma as prisma } from '@blobinfini/database';
import { getClientIp } from '../lib/client-ip';
import { hashIpHmac } from '../lib/hash-ip';
import { secureLogger } from '../utils/secure-logger';

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
      // Privacy-by-design: hash IP before storing (RGPD compliant)
      // HMAC-SHA256 with IP_HASH_SECRET (v2) - replaces SHA-256 (v1)
      const ipHash = hashIpHmac(ip ?? undefined);

      const requestId = (req as any).requestId as string | undefined;

      const metadata = {
        method: req.method,
        statusCode: res.statusCode,
        params: req.params,
        requestId, // requestIdMiddleware stamps this; undefined if middleware not mounted
        hashVersion: 'v2', // HMAC-SHA256 (24 hex chars) for rainbow table protection
        ...(extraMetadata || {})
      };

      prisma.auditLog.create({
        data: {
          userId,
          action,
          resource,
          metadata,
          ip: ipHash ?? undefined,
        }
      }).catch((error: unknown) => {
        secureLogger.error('AUDIT_LOG_WRITE_FAILED', { error, action });
      });
    });

    next();
  };
};
