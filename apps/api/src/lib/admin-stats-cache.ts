import { getRedisClient } from './redis-client';
import { secureLogger } from '../utils/secure-logger';
import type { ZodType } from 'zod';

export const ADMIN_STATS_MAIN_CACHE_KEY = 'adm:stats:main';
const ADMIN_STATS_CACHE_DEFAULT_TTL_SECONDS = 120;

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off']);

export function isAdminStatsCacheEnabled(): boolean {
  const raw = process.env.ADMIN_STATS_CACHE_ENABLED;
  if (raw == null || raw.trim() === '') {
    return true;
  }

  const normalized = raw.trim().toLowerCase();
  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;
  return true;
}

export function getAdminStatsCacheTtlSeconds(): number {
  const raw = process.env.ADMIN_STATS_CACHE_TTL_SECONDS;
  if (raw == null || raw.trim() === '') {
    return ADMIN_STATS_CACHE_DEFAULT_TTL_SECONDS;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return ADMIN_STATS_CACHE_DEFAULT_TTL_SECONDS;
  }

  return parsed;
}

async function deleteAdminStatsCacheKeySilently(key: string): Promise<void> {
  const redisClient = getRedisClient();
  if (!redisClient) {
    return;
  }

  try {
    await redisClient.del(key);
  } catch {
    // Cache cleanup must never affect the HTTP handler.
  }
}

export async function getAdminStatsCache<T>(key: string, schema?: ZodType<T>): Promise<T | null> {
  if (!isAdminStatsCacheEnabled()) {
    return null;
  }

  const redisClient = getRedisClient();
  if (!redisClient) {
    secureLogger.info('ADMIN_STATS_CACHE_MISS', { key, reason: 'redis_unavailable' });
    return null;
  }

  try {
    const rawValue = await redisClient.get(key);
    if (!rawValue) {
      secureLogger.info('ADMIN_STATS_CACHE_MISS', { key, reason: 'empty' });
      return null;
    }

    const parsedValue = JSON.parse(rawValue) as unknown;
    if (schema) {
      const validatedValue = schema.safeParse(parsedValue);
      if (!validatedValue.success) {
        await deleteAdminStatsCacheKeySilently(key);
        secureLogger.info('ADMIN_STATS_CACHE_MISS', { key, reason: 'invalid_shape' });
        return null;
      }
      secureLogger.info('ADMIN_STATS_CACHE_HIT', { key });
      return validatedValue.data;
    }

    secureLogger.info('ADMIN_STATS_CACHE_HIT', { key });
    return parsedValue as T;
  } catch (error) {
    if (error instanceof SyntaxError) {
      await deleteAdminStatsCacheKeySilently(key);
    }
    secureLogger.info('ADMIN_STATS_CACHE_MISS', {
      key,
      reason: error instanceof SyntaxError ? 'invalid_json' : 'read_failed',
    });
    return null;
  }
}

export async function setAdminStatsCache<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
  if (!isAdminStatsCacheEnabled()) {
    return;
  }

  const redisClient = getRedisClient();
  if (!redisClient) {
    return;
  }

  try {
    const effectiveTtlSeconds = Number.isFinite(ttlSeconds) && ttlSeconds > 0
      ? Math.trunc(ttlSeconds)
      : ADMIN_STATS_CACHE_DEFAULT_TTL_SECONDS;
    await redisClient.setEx(key, effectiveTtlSeconds, JSON.stringify(value));
  } catch {
    // Redis is an optimization layer only — handlers must fall back to DB.
  }
}

export async function invalidateAdminStatsCache(key: string): Promise<void> {
  if (!isAdminStatsCacheEnabled()) {
    return;
  }

  const redisClient = getRedisClient();
  if (!redisClient) {
    return;
  }

  try {
    await redisClient.del(key);
    secureLogger.info('ADMIN_STATS_CACHE_INVALIDATED', { key });
  } catch {
    // Redis is an optimization layer only — handlers must keep succeeding.
  }
}
