import { timingSafeEqual } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { requireAdmin, requireAuth, requireVerifiedEmail } from '../auth/auth.guard';

function matchesMonitorToken(req: Request): boolean {
  const expected = process.env.SECURITY_MONITOR_TOKEN?.trim();
  const provided = req.get('x-security-monitor-token')?.trim();

  if (!expected || !provided) {
    return false;
  }

  const expectedBuffer = Buffer.from(expected, 'utf8');
  const providedBuffer = Buffer.from(provided, 'utf8');

  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, providedBuffer);
}

function requireAdminSecurityAccess(req: Request, res: Response, next: NextFunction): void {
  requireAuth(req, res, () => {
    requireVerifiedEmail(req, res, () => {
      requireAdmin(req, res, next);
    });
  });
}

export function requireSecurityReadAccess(req: Request, res: Response, next: NextFunction): void {
  if (matchesMonitorToken(req)) {
    next();
    return;
  }

  requireAdminSecurityAccess(req, res, next);
}
