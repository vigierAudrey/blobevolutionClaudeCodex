import type { Request, Response, NextFunction } from 'express';
import { clientPrisma as prisma } from '@blobinfini/database';
import { cacheService } from '../../services/cache.service';
import { getClientIp } from '../../lib/client-ip';
import { secureLogger } from '../../utils/secure-logger';

export const ADMIN_STEP_UP_TTL_SECONDS = 5 * 60;
const STEP_UP_CACHE_PREFIX = 'admin:step-up';

function parseBooleanEnv(value: string | undefined, defaultValue: boolean): boolean {
  if (typeof value !== 'string' || value.trim() === '') {
    return defaultValue;
  }
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return defaultValue;
}

export function isAdminIpEnforcementEnabled(): boolean {
  return parseBooleanEnv(process.env.ADMIN_ENFORCE_ALLOWED_IPS, true);
}

export function isAdminStepUpRequiredEnabled(): boolean {
  const defaultValue = process.env.NODE_ENV === 'production';
  return parseBooleanEnv(process.env.ADMIN_REQUIRE_STEP_UP, defaultValue);
}

async function getAdminAllowedIps(userId: string): Promise<string[] | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      role: true,
      adminProfile: {
        select: {
          allowedIPs: true,
        },
      },
    },
  });

  if (!user || user.role !== 'ADMIN') {
    return null;
  }

  return user.adminProfile?.allowedIPs ?? [];
}

export async function isAdminIpAllowedForUser(userId: string, clientIp: string | undefined): Promise<boolean> {
  if (!isAdminIpEnforcementEnabled()) {
    return true;
  }

  const allowedIps = await getAdminAllowedIps(userId);
  if (allowedIps === null || allowedIps.length === 0) {
    return true;
  }

  return Boolean(clientIp && allowedIps.includes(clientIp));
}

export async function enforceAdminAllowedIp(req: Request, res: Response, next: NextFunction): Promise<void> {
  const user = (req as any).user as { id: string; role: string } | undefined;
  if (!user?.id || user.role !== 'ADMIN') {
    next();
    return;
  }

  try {
    const clientIp = getClientIp(req);
    // getAdminAllowedIps() requête la DB — retourne null si role DB ≠ ADMIN
    // (fenêtre JWT 15 min : le token dit ADMIN mais la DB peut avoir changé)
    const allowedIps = await getAdminAllowedIps(user.id);

    if (allowedIps === null) {
      // Rôle révoqué en DB depuis l'émission du JWT — rejeter immédiatement
      secureLogger.warn('ADMIN_ROLE_REVOKED_MIDREQUEST', {
        userId: user.id,
        path: req.path,
      });
      res.status(403).json({ error: 'Accès admin révoqué' });
      return;
    }

    const ipEnforced = isAdminIpEnforcementEnabled();
    const allowed = !ipEnforced || allowedIps.length === 0 || Boolean(clientIp && allowedIps.includes(clientIp));

    if (!allowed) {
      secureLogger.warn('ADMIN_ALLOWED_IP_DENIED', {
        userId: user.id,
        path: req.path,
        ip: clientIp,
      });
      res.status(403).json({
        error: 'IP non autorisée',
        message: 'Votre adresse IP n\'est pas autorisée pour ce compte admin',
      });
      return;
    }

    next();
  } catch (error) {
    secureLogger.security('CRITICAL_ADMIN_ALLOWED_IP_CHECK_ERROR', {
      userId: user.id,
      path: req.path,
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(403).json({ error: 'Admin IP enforcement failed closed' });
  }
}

function getStepUpCacheKey(userId: string): string {
  return `${STEP_UP_CACHE_PREFIX}:${userId}`;
}

export async function grantAdminStepUp(userId: string): Promise<{ ok: true; stepUpUntil: number } | { ok: false }> {
  if (!isAdminStepUpRequiredEnabled()) {
    return { ok: true, stepUpUntil: Date.now() };
  }

  if (!cacheService.isAvailable()) {
    return { ok: false };
  }

  const stepUpUntil = Date.now() + (ADMIN_STEP_UP_TTL_SECONDS * 1000);
  const saved = await cacheService.set(getStepUpCacheKey(userId), { stepUpUntil }, ADMIN_STEP_UP_TTL_SECONDS);
  if (!saved) {
    return { ok: false };
  }

  return { ok: true, stepUpUntil };
}

export async function hasValidAdminStepUp(userId: string): Promise<boolean> {
  if (!isAdminStepUpRequiredEnabled()) {
    return true;
  }

  if (!cacheService.isAvailable()) {
    return false;
  }

  const payload = await cacheService.get<{ stepUpUntil?: number }>(getStepUpCacheKey(userId));
  if (!payload || typeof payload.stepUpUntil !== 'number') {
    return false;
  }
  return payload.stepUpUntil > Date.now();
}

export async function requireAdminStepUp(req: Request, res: Response, next: NextFunction): Promise<void> {
  const user = (req as any).user as { id: string; role: string } | undefined;
  if (!user?.id || user.role !== 'ADMIN') {
    res.status(403).json({ error: 'Admin role required' });
    return;
  }

  try {
    if (!isAdminStepUpRequiredEnabled()) {
      next();
      return;
    }

    if (!cacheService.isAvailable()) {
      secureLogger.security('CRITICAL_ADMIN_STEP_UP_CACHE_UNAVAILABLE', {
        userId: user.id,
        path: req.path,
      });
      res.status(403).json({ error: 'Step-up authentication required' });
      return;
    }

    const hasStepUp = await hasValidAdminStepUp(user.id);
    if (!hasStepUp) {
      secureLogger.warn('ADMIN_STEP_UP_REQUIRED', {
        userId: user.id,
        path: req.path,
      });
      res.status(403).json({ error: 'Step-up authentication required' });
      return;
    }

    next();
  } catch (error) {
    secureLogger.security('CRITICAL_ADMIN_STEP_UP_CHECK_ERROR', {
      userId: user.id,
      path: req.path,
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(403).json({ error: 'Step-up authentication required' });
  }
}
