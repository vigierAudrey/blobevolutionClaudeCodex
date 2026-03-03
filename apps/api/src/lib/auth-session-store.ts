/**
 * auth-session-store.ts
 *
 * Redis fast-path → DB fallback pour la validation de session.
 * Utilisé par requireAuth pour vérifier sessionVersion + deletedAt
 * sans aller en DB à chaque requête.
 *
 * Sécurité :
 * - TTL court (30s) : révocation effective ≤ 30s après incrementSessionVersion
 * - invalidateSessionCache() est idempotent — ne throw pas si Redis absent
 * - Aucun PII en log : userId loggé comme présent, pas sa valeur
 */

import { cacheService } from '../services/cache.service';
import { clientPrisma as prisma } from '@blobinfini/database';
import { secureLogger } from '../utils/secure-logger';

const SESSION_CACHE_KEY_PREFIX = 'session:data:';
/** TTL court pour garantir que la révocation est visible rapidement. */
const SESSION_CACHE_TTL_SECONDS = 30;

function sessionCacheKey(userId: string): string {
  return `${SESSION_CACHE_KEY_PREFIX}${userId}`;
}

export interface SessionData {
  version: number;
  deletedAt: Date | string | null;
}

/**
 * Retourne les données de session pour un userId.
 * Redis fast-path → DB fallback si cache miss.
 * Retourne null si l'utilisateur n'existe pas en DB.
 */
export async function getSessionData(userId: string): Promise<SessionData | null> {
  // Redis fast-path
  const cached = await cacheService.get<SessionData>(sessionCacheKey(userId));
  if (cached) return cached;

  // DB fallback
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { sessionVersion: true, deletedAt: true },
  });

  if (!user) return null;

  const data: SessionData = {
    version: user.sessionVersion,
    deletedAt: user.deletedAt,
  };

  // Cache avec TTL court pour limiter la charge DB
  await cacheService.set(sessionCacheKey(userId), data, SESSION_CACHE_TTL_SECONDS);

  return data;
}

/**
 * Invalide le cache de session d'un userId.
 * Idempotent : ne throw jamais, loggue un warning si Redis échoue.
 * À appeler après increment de sessionVersion en DB.
 */
export async function invalidateSessionCache(userId: string): Promise<void> {
  try {
    await cacheService.del(sessionCacheKey(userId));
  } catch (error) {
    secureLogger.warn('SESSION_CACHE_INVALIDATE_FAILED', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
