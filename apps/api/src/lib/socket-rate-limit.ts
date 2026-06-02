/**
 * Rate limiting pour les événements WebSocket
 *
 * SÉCURITÉ FAIL-SAFE:
 * - Si Redis est indisponible → fallback en mémoire (RateLimiterMemory direct)
 * - Si erreur inconnue + failOpen=false → panic limiter (1 req/sec garde-fou)
 * - Si erreur inconnue + failOpen=true → bypass avec log (typing uniquement)
 *
 * FEATURE FLAG SAFE:
 * - OFF par défaut en dev/staging
 * - ON uniquement en production (NODE_ENV=production + flag explicite)
 */

import { RateLimiterRedis, RateLimiterMemory } from 'rate-limiter-flexible';
import { createClient } from 'redis';
import { resolveRedisUrl, redactRedisUrl } from './redisConfig';
import { SocketErrorCode } from './socket-schemas';
import type { SocketError } from './socket-schemas';
import { secureLogger } from '../utils/secure-logger';

/**
 * Feature flag pour activer/désactiver le rate limiting
 *
 * SÉCURITÉ P0:
 * - ON par défaut en production (fail-fast si flag explicitement désactivé)
 * - OFF uniquement si NODE_ENV !== production OU flag explicite = 'false'
 */
const isProduction = process.env.NODE_ENV === 'production';
const flagValue = process.env.ENABLE_WEBSOCKET_RATE_LIMIT;

// P0 FIX: Fail-fast en production si rate limiting explicitement désactivé
if (isProduction && flagValue === 'false') {
  throw new Error(
    'FATAL: ENABLE_WEBSOCKET_RATE_LIMIT=false is NOT allowed in production. ' +
    'Remove the flag to enable rate limiting (default ON in production).'
  );
}

// P0 FIX: ON par défaut en production (sauf si flag = 'false')
export const RATE_LIMIT_ENABLED = isProduction || flagValue === 'true';

// Log du statut au démarrage
if (RATE_LIMIT_ENABLED) {
  secureLogger.info('RATE_LIMIT_ENABLED', {
    env: process.env.NODE_ENV,
    flag: flagValue,
    mode: isProduction ? 'production (default ON)' : 'dev (explicit true)'
  });
} else {
  secureLogger.warn('RATE_LIMIT_DISABLED', {
    env: process.env.NODE_ENV,
    flag: flagValue,
    reason: 'development environment'
  });
}

/**
 * Redis client dédié au rate limiting (indépendant de cache.service.ts)
 * Créé uniquement si RL activé
 */
let rateLimitRedisClient: any = null;
let redisReady = false;

/**
 * Initialise le client Redis pour rate limiting
 * Appelé uniquement si RATE_LIMIT_ENABLED = true
 */
async function initRateLimitRedis(): Promise<any> {
  const redisUrl = resolveRedisUrl();

  if (!redisUrl) {
    secureLogger.warn('RATE_LIMIT_REDIS_DISABLED', {
      reason: 'Redis URL not configured'
    });
    return null;
  }

  try {
    const client = createClient({
      url: redisUrl,
      password: process.env.REDIS_PASSWORD?.trim() || undefined,
      socket: {
        connectTimeout: 4000,
        reconnectStrategy: (retries) => Math.min(retries * 200, 2000),
      },
    });

    client.on('error', (error: Error) => {
      secureLogger.error('RATE_LIMIT_REDIS_ERROR', {
        error: redactRedisUrl(error.message),
        errorName: error.name
      });
    });

    await client.connect();
    await client.ping();

    secureLogger.info('RATE_LIMIT_REDIS_CONNECTED');
    redisReady = true;
    return client;
  } catch (error) {
    secureLogger.error('RATE_LIMIT_REDIS_INIT_FAILED', {
      error: error instanceof Error ? error.message : String(error),
      fallback: 'memory only'
    });
    return null;
  }
}

// Initialiser Redis si RL activé
if (RATE_LIMIT_ENABLED) {
  initRateLimitRedis().then(client => {
    rateLimitRedisClient = client;
  }).catch(err => {
    secureLogger.error('RATE_LIMIT_REDIS_INIT_ERROR', {
      error: err instanceof Error ? err.message : String(err)
    });
  });
}

/**
 * Limiters en mémoire (fallback si Redis non prêt)
 */
const memoryLimiters = {
  sendMessageGlobal: new RateLimiterMemory({
    points: 30,
    duration: 60,
    blockDuration: 60
  }),
  sendMessage: new RateLimiterMemory({
    points: 10,
    duration: 60,
    blockDuration: 60
  }),
  typing: new RateLimiterMemory({
    points: 30,
    duration: 60,
    blockDuration: 10
  }),
  join: new RateLimiterMemory({
    points: 20,
    duration: 60,
    blockDuration: 30
  })
};

/**
 * Panic limiter (garde-fou minimal en cas d'erreur inconnue)
 * 1 requête par seconde maximum
 */
const panicLimiter = new RateLimiterMemory({
  points: 1,
  duration: 1,
  blockDuration: 1
});

/**
 * Cache des limiters Redis (créés à la demande)
 */
let redisLimiters: {
  sendMessageGlobal?: RateLimiterRedis;
  sendMessage?: RateLimiterRedis;
  typing?: RateLimiterRedis;
  join?: RateLimiterRedis;
} = {};

export function isRateLimitRedisReady(): boolean {
  return redisReady && !!rateLimitRedisClient;
}

export function getSendMessageGlobalLimiter(): RateLimiterRedis | RateLimiterMemory {
  if (!RATE_LIMIT_ENABLED) {
    return memoryLimiters.sendMessageGlobal;
  }

  if (redisReady && rateLimitRedisClient) {
    if (!redisLimiters.sendMessageGlobal) {
      redisLimiters.sendMessageGlobal = new RateLimiterRedis({
        storeClient: rateLimitRedisClient,
        keyPrefix: 'ws-rate:send-message-global',
        points: 30,
        duration: 60,
        blockDuration: 60,
        insuranceLimiter: memoryLimiters.sendMessageGlobal
      });
    }
    return redisLimiters.sendMessageGlobal;
  }

  return memoryLimiters.sendMessageGlobal;
}

/**
 * Getter pour send-message limiter
 * Retourne RateLimiterRedis si Redis prêt, sinon RateLimiterMemory
 */
export function getSendMessageLimiter(): RateLimiterRedis | RateLimiterMemory {
  if (!RATE_LIMIT_ENABLED) {
    return memoryLimiters.sendMessage;
  }

  if (redisReady && rateLimitRedisClient) {
    if (!redisLimiters.sendMessage) {
      redisLimiters.sendMessage = new RateLimiterRedis({
        storeClient: rateLimitRedisClient,
        keyPrefix: 'ws-rate:send-message',
        points: 10,
        duration: 60,
        blockDuration: 60,
        insuranceLimiter: memoryLimiters.sendMessage
      });
    }
    return redisLimiters.sendMessage;
  }

  return memoryLimiters.sendMessage;
}

/**
 * Getter pour typing limiter
 * Retourne RateLimiterRedis si Redis prêt, sinon RateLimiterMemory
 */
export function getTypingLimiter(): RateLimiterRedis | RateLimiterMemory {
  if (!RATE_LIMIT_ENABLED) {
    return memoryLimiters.typing;
  }

  if (redisReady && rateLimitRedisClient) {
    if (!redisLimiters.typing) {
      redisLimiters.typing = new RateLimiterRedis({
        storeClient: rateLimitRedisClient,
        keyPrefix: 'ws-rate:typing',
        points: 30,
        duration: 60,
        blockDuration: 10,
        insuranceLimiter: memoryLimiters.typing
      });
    }
    return redisLimiters.typing;
  }

  return memoryLimiters.typing;
}

/**
 * Getter pour join-conversation limiter
 * Retourne RateLimiterRedis si Redis prêt, sinon RateLimiterMemory
 */
export function getJoinLimiter(): RateLimiterRedis | RateLimiterMemory {
  if (!RATE_LIMIT_ENABLED) {
    return memoryLimiters.join;
  }

  if (redisReady && rateLimitRedisClient) {
    if (!redisLimiters.join) {
      redisLimiters.join = new RateLimiterRedis({
        storeClient: rateLimitRedisClient,
        keyPrefix: 'ws-rate:join',
        points: 20,
        duration: 60,
        blockDuration: 30,
        insuranceLimiter: memoryLimiters.join
      });
    }
    return redisLimiters.join;
  }

  return memoryLimiters.join;
}

/**
 * Throttle pour les logs RATE_LIMIT_ERROR_BYPASS
 * Évite le flood de logs si Redis flappe
 *
 * Clé: limiter -> Timestamp du dernier log
 */
const bypassLogThrottle = new Map<any, number>();
const BYPASS_LOG_THROTTLE_MS = 10000; // 1 log toutes les 10 secondes par limiter

/**
 * Options pour checkRateLimit
 */
interface RateLimitOptions {
  /**
   * Si true, autorise en cas d'erreur inconnue (fail-open)
   * Si false, applique panic limiter (1 req/sec) en cas d'erreur inconnue
   * Default: false
   */
  failOpen?: boolean;
  /**
   * Si true, toute erreur interne du limiter devient un rejet immédiat (fail-closed).
   * Utilisé sur les événements non critiques (typing) pour éviter un fanout massif.
   */
  hardFailOnError?: boolean;
}

function sanitizeRateLimitLogKey(key: string): string {
  return key
    .split(':')
    .map((part) => (part.length > 8 ? `${part.slice(0, 8)}...` : part))
    .join(':');
}

/**
 * Vérifie le rate limit pour une clé donnée
 *
 * FAIL-SAFE COMPLET:
 * - Feature flag OFF → autoriser (bypass)
 * - Rate limit dépassé → refuser avec retryAfter
 * - Redis down → utiliser insuranceLimiter (fallback mémoire automatique)
 * - Erreur inconnue:
 *   - Si failOpen=true → autoriser + log critique (typing)
 *   - Si failOpen=false → appliquer panic limiter (1 req/sec garde-fou)
 *
 * @param getLimiter - Fonction getter du rate limiter à utiliser
 * @param key - Clé unique (ex: userId ou userId:conversationId)
 * @param opts - Options (failOpen)
 * @returns { allowed: true } si autorisé, { allowed: false, error } sinon
 */
export async function checkRateLimit(
  getLimiter: () => RateLimiterRedis | RateLimiterMemory,
  key: string,
  opts: RateLimitOptions = {}
): Promise<{ allowed: true } | { allowed: false; error: SocketError }> {
  const { failOpen = false, hardFailOnError = false } = opts;

  // ✅ Si feature flag désactivé, autoriser
  if (!RATE_LIMIT_ENABLED) {
    return { allowed: true };
  }

  let limiter: RateLimiterRedis | RateLimiterMemory;

  try {
    limiter = getLimiter();
    await limiter.consume(key);
    return { allowed: true };
  } catch (error: any) {
    // Cas 1: Rate limit dépassé (erreur normale)
    if (error.msBeforeNext !== undefined) {
      const retryAfter = Math.ceil(error.msBeforeNext / 1000);

      // ✅ PR2: Log observable (debug level, pas warn)
      secureLogger.debug('RATE_LIMIT_EXCEEDED', {
        key: sanitizeRateLimitLogKey(key),
        retryAfter,
        remainingPoints: error.remainingPoints
      });

      return {
        allowed: false,
        error: {
          code: SocketErrorCode.RATE_LIMITED,
          message: `Too many requests. Retry in ${retryAfter} seconds.`,
          retryAfter
        }
      };
    }

    // Cas 2: Erreur inconnue (Redis down, etc.)
    const now = Date.now();
    const lastLog = bypassLogThrottle.get(limiter!) || 0;

    // ✅ Throttle: 1 log toutes les 10 secondes par limiter
    if (now - lastLog > BYPASS_LOG_THROTTLE_MS) {
      secureLogger.error('RATE_LIMIT_ERROR_BYPASS', {
        key: sanitizeRateLimitLogKey(key),
        error: error instanceof Error ? error.message : String(error),
        errorName: error instanceof Error ? error.name : 'Unknown',
        action: failOpen ? 'bypassed (fail-open)' : hardFailOnError ? 'blocked (hard-fail)' : 'panic limiter applied',
        throttleNote: 'Similar errors throttled for 10s'
      });
      bypassLogThrottle.set(limiter!, now);
    }

    // Si fail-open activé (typing), autoriser
    if (failOpen) {
      return { allowed: true };
    }

    if (hardFailOnError) {
      return {
        allowed: false,
        error: {
          code: SocketErrorCode.RATE_LIMITED,
          message: 'Service temporarily limited. Retry shortly.',
          retryAfter: 1
        }
      };
    }

    // Sinon, appliquer panic limiter (1 req/sec garde-fou)
    try {
      await panicLimiter.consume(key);
      return { allowed: true };
    } catch (panicError: any) {
      if (panicError.msBeforeNext !== undefined) {
        return {
          allowed: false,
          error: {
            code: SocketErrorCode.RATE_LIMITED,
            message: 'Service temporarily limited. Retry in 1 second.',
            retryAfter: 1
          }
        };
      }
      // Panic limiter a échoué de manière inattendue, FAIL-CLOSED
      return {
        allowed: false,
        error: {
          code: SocketErrorCode.RATE_LIMITED,
          message: 'Service temporarily limited. Retry shortly.',
          retryAfter: 1
        }
      };
    }
  }
}
