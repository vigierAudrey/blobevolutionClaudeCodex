/**
 * Shared Redis client singleton — BlobConnect API.
 *
 * Single point of Redis client creation for the whole process.
 * Both enhanced-rate-limit.ts and brute-force-detector.ts consume this module.
 *
 * Lifecycle:
 * - test:       client stays null, redisClientInitPromise resolves immediately (no-op)
 * - dev:        optional Redis; silent throttled warn + memory fallback if unavailable
 * - production: fail-fast (process.exit(1)) if Redis unreachable — memory fallback is
 *               NOT acceptable (no cross-restart/multi-instance counter integrity)
 */

import { createClient } from 'redis';
import { resolveRedisUrl } from './redisConfig';
import { secureLogger } from '../utils/secure-logger';

type RedisClientType = ReturnType<typeof createClient>;

let redisClient: RedisClientType | null = null;

const isDevelopment = process.env.NODE_ENV === 'development';
const REDIS_DEV_HINT_THROTTLE_MS = 30_000;

type RedisDevHintState = { nextLogAtMs: number };

function shouldSuppressRedisErrorLogInDev(errorMessage: string): boolean {
  if (!isDevelopment) return false;

  const globals = globalThis as typeof globalThis & {
    __blobinfiniRedisDevHintState__?: RedisDevHintState;
  };

  if (!globals.__blobinfiniRedisDevHintState__) {
    globals.__blobinfiniRedisDevHintState__ = { nextLogAtMs: 0 };
  }

  const now = Date.now();
  const state = globals.__blobinfiniRedisDevHintState__;

  if (now >= state.nextLogAtMs) {
    state.nextLogAtMs = now + REDIS_DEV_HINT_THROTTLE_MS;
    secureLogger.warn('RATE_LIMIT_REDIS_DEV_HINT', { error: errorMessage });
  }

  return true;
}

async function initializeRedis(): Promise<RedisClientType | null> {
  const redisUrl = resolveRedisUrl();
  // Redact credentials from log (redis://:password@host → redis://***@host)
  const redactedUrl = redisUrl.replace(/\/\/:([^@]+)@/, '//***@');
  secureLogger.info('RATE_LIMIT_REDIS_CONNECTING', { redisUrl: redactedUrl });

  try {
    const client = createClient({
      url: redisUrl,
      password: process.env.REDIS_PASSWORD?.trim() || undefined,
      socket: {
        connectTimeout: 4000,
        reconnectStrategy: (retries) => Math.min(retries * 200, 2000),
      },
      commandsQueueMaxLength: 100, // P2-4: Limiter la queue de commandes
      disableOfflineQueue: true,   // P2-4: Éviter accumulation en mode offline
    });

    client.on('error', (error) => {
      if (shouldSuppressRedisErrorLogInDev(error.message)) return;
      secureLogger.error('RATE_LIMIT_REDIS_ERROR', { error: error.message });
    });

    await client.connect();
    await client.ping();
    secureLogger.info('RATE_LIMIT_REDIS_CONNECTED');
    return client;
  } catch (error) {
    if (shouldSuppressRedisErrorLogInDev(error instanceof Error ? error.message : String(error))) {
      // dev: throttled log, memory store fallback is acceptable and documented.
      return null;
    }

    if (process.env.NODE_ENV === 'production') {
      // production: memory store fallback is NOT acceptable.
      // - Restarts reset all counters (window integrity lost).
      // - Multiple instances have isolated stores (rate-limit bypass via load distribution).
      // Fail-fast so the issue is surfaced immediately rather than degrading silently.
      secureLogger.error('RATE_LIMIT_REDIS_FATAL', {
        error: error instanceof Error ? error.message : String(error),
      });
      process.exit(1);
    }

    // Non-production, non-development (e.g. staging without Redis): log and use memory store.
    secureLogger.error('RATE_LIMIT_REDIS_FALLBACK_MEMORY', { error });
    return null;
  }
}

/**
 * Returns the shared Redis client, or null if unavailable/uninitialised.
 *
 * Callers MUST handle the null case — never assume the client is present.
 * null = Redis is down, startup has not completed, or NODE_ENV=test.
 */
export function getRedisClient(): RedisClientType | null {
  return redisClient;
}

/**
 * Close the Redis client gracefully (used in shutdown handlers).
 */
export async function closeRedisClient(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
    secureLogger.info('RATE_LIMIT_REDIS_CLIENT_CLOSED');
  }
}

/**
 * Promise that resolves once Redis init completes (or resolves immediately in test).
 *
 * enhanced-rate-limit.ts chains .then() on this to rebuild rate limiters with Redis store.
 * brute-force-detector.ts reads getRedisClient() at call time — no need to await this.
 */
export let redisClientInitPromise: Promise<void> = Promise.resolve();

// Initialize Redis on module load — skip in test environment.
if (process.env.NODE_ENV !== 'test') {
  const baseInit = initializeRedis()
    .then((client) => {
      redisClient = client;
    })
    .catch((err) => {
      // In production: initializeRedis() already called process.exit(1).
      // This catch handles non-production/non-development environments.
      secureLogger.error('RATE_LIMIT_REDIS_INIT_FAILED', {
        error: err instanceof Error ? err.message : String(err),
      });
    });

  if (process.env.NODE_ENV !== 'production') {
    // In dev/staging, client.connect() never rejects when reconnectStrategy retries
    // indefinitely and Redis is unavailable. Cap init to 5 s so requests are never
    // blocked forever — memory store is an acceptable fallback in non-production.
    const settle = new Promise<void>((resolve) => {
      setTimeout(() => {
        if (!redisClient) {
          secureLogger.warn('RATE_LIMIT_REDIS_CONNECT_TIMEOUT', {
            msg: 'Redis connect timed out after 5 s, proceeding with memory store',
          });
        }
        resolve();
      }, 5000);
    });
    redisClientInitPromise = Promise.race([baseInit, settle]);
  } else {
    redisClientInitPromise = baseInit;
  }
}
