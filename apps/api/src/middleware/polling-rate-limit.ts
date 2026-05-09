/**
 * Polling rate limiter — protège les endpoints GET de polling (conversations list/messages)
 * contre les multi-tabs, bots et abus, sans casser l'UX normale.
 *
 * Couches :
 *   1. Burst global      : 50 req/sec  (Memory, P0)
 *   2. Par userId        : 60 req/min  (Memory, keyed by authenticated userId)
 *   3. Par IP canonique  : 300 req/min (req.canonicalIp — anti-spoofing, cf. IP hardening)
 *
 * Réponse 429 neutre — pas de PII dans les logs.
 */

import type { Request, Response, NextFunction } from 'express';
import { RateLimiterMemory, RateLimiterRes } from 'rate-limiter-flexible';
import { getClientIp } from '../lib/client-ip';

// ─── Limiter configuration (overridable for tests) ───────────────────────────

export const POLLING_LIMITS = {
  burstPoints: 50,   // req/sec — burst global
  userPoints: 60,    // req/min — per userId
  ipPoints: 300,     // req/min — per canonical IP
};

// ─── Limiters ────────────────────────────────────────────────────────────────

let burstLimiter = new RateLimiterMemory({
  keyPrefix: 'polling_burst',
  points: POLLING_LIMITS.burstPoints,
  duration: 1,
});

let userLimiter = new RateLimiterMemory({
  keyPrefix: 'polling_user',
  points: POLLING_LIMITS.userPoints,
  duration: 60,
});

let ipLimiter = new RateLimiterMemory({
  keyPrefix: 'polling_ip',
  points: POLLING_LIMITS.ipPoints,
  duration: 60,
});

export function resetPollingLimitersForTest(overrides?: {
  burstPoints?: number;
  userPoints?: number;
  ipPoints?: number;
}): void {
  burstLimiter = new RateLimiterMemory({
    keyPrefix: `polling_burst_${Date.now()}`,
    points: overrides?.burstPoints ?? POLLING_LIMITS.burstPoints,
    duration: 1,
  });
  userLimiter = new RateLimiterMemory({
    keyPrefix: `polling_user_${Date.now()}`,
    points: overrides?.userPoints ?? POLLING_LIMITS.userPoints,
    duration: 60,
  });
  ipLimiter = new RateLimiterMemory({
    keyPrefix: `polling_ip_${Date.now()}`,
    points: overrides?.ipPoints ?? POLLING_LIMITS.ipPoints,
    duration: 60,
  });
}

// ─── Helper 429 ──────────────────────────────────────────────────────────────

function send429(res: Response, rlRes: RateLimiterRes, limitLabel: string): Response {
  const retryAfterMs = rlRes.msBeforeNext ?? 60_000;
  const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));

  res.setHeader('Retry-After', String(retryAfterSeconds));
  res.setHeader('X-RateLimit-Limit', limitLabel);
  res.setHeader('X-RateLimit-Remaining', '0');
  res.setHeader('X-RateLimit-Reset', String(Math.ceil((Date.now() + retryAfterMs) / 1000)));

  return res.status(429).json({
    error: 'POLLING_RATE_LIMIT_EXCEEDED',
    message: 'Too many requests. Please slow down.',
    retryAfterSeconds,
  });
}

// ─── Middleware ───────────────────────────────────────────────────────────────

type AuthedRequest = Request & { user?: { id: string }; canonicalIp?: string };

/**
 * Applique les trois couches de rate-limiting pour les endpoints de polling.
 * Doit être placé APRÈS requireAuth (pour accéder à req.user.id).
 *
 * Utilise req.canonicalIp (stamped by canonical-ip middleware) pour la couche IP,
 * avec fallback sur getClientIp(). Ne lit jamais req.ip directement.
 */
export async function pollingRateLimit(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const isProduction = process.env.NODE_ENV === 'production';
  const isTest = process.env.NODE_ENV === 'test';
  const rateLimitExplicitlyEnabled = String(process.env.ENABLE_RATE_LIMIT_IN_TESTS || '').toLowerCase() === 'true';

  if (!isProduction && isTest && !rateLimitExplicitlyEnabled) {
    return next();
  }

  const authedReq = req as AuthedRequest;
  const userId = authedReq.user?.id;
  // P0-1 fix: use canonicalIp stamped by canonical-ip middleware, never req.ip directly
  const ip = authedReq.canonicalIp ?? getClientIp(req) ?? req.socket?.remoteAddress ?? 'unknown';

  try {
    await burstLimiter.consume('global');
  } catch (err) {
    send429(res, err as RateLimiterRes, '50/s');
    return;
  }

  if (userId) {
    try {
      await userLimiter.consume(`user:${userId}`);
    } catch (err) {
      send429(res, err as RateLimiterRes, '60/min');
      return;
    }
  }

  try {
    await ipLimiter.consume(`ip:${ip}`);
  } catch (err) {
    send429(res, err as RateLimiterRes, '300/min');
    return;
  }

  next();
}
