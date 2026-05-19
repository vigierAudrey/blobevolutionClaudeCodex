import { createClient } from 'redis';
import { resolveRedisUrl } from '../lib/redisConfig';
import { gridCell, DEFAULT_GRID_CELL_KM } from '../lib/geoGrid';
import { secureLogger } from '../utils/secure-logger';

// Redis client for caching (separate from rate limiting)
let cacheClient: any = null;
const shouldLogCache = process.env.NODE_ENV !== 'test' || process.env.ENABLE_TEST_LOGS === 'true';
const logInfo = (event: string, context?: Record<string, unknown>) => {
  if (shouldLogCache) secureLogger.info(event, context);
};
const logWarn = (event: string, context?: Record<string, unknown>) => {
  if (shouldLogCache) secureLogger.warn(event, context);
};
const logError = (event: string, context?: Record<string, unknown>) => secureLogger.error(event, context);
const isDevelopment = process.env.NODE_ENV === 'development';
const REDIS_DEV_HINT_THROTTLE_MS = 30000;
const SAFE_CACHE_ID_REGEX = /^[A-Za-z0-9_-]+$/;
const SHA256_HEX_REGEX = /^[a-f0-9]{64}$/i;

export type CacheReadResult<T> =
  | { ok: true; found: true; value: T }
  | { ok: true; found: false }
  | { ok: false; reason: 'client_unavailable' | 'read_error' | 'invalid_identifier' };

export type CacheWriteResult =
  | { ok: true }
  | { ok: false; reason: 'client_unavailable' | 'write_error' | 'invalid_identifier' | 'invalid_value' };

type RedisDevHintState = {
  nextLogAtMs: number;
};

function sanitizeRedisUrl(redisUrl: string): string {
  try {
    const url = new URL(redisUrl);
    const port = url.port ? `:${url.port}` : '';
    return `${url.protocol}//${url.hostname}${port}${url.pathname}`;
  } catch {
    return 'configured';
  }
}

function sanitizeErrorDetail(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/(redis:\/\/[^:\s/]+:)[^@\s]+@/gi, '$1***@');
}

function cacheErrorType(error: unknown): string {
  if (error instanceof Error && error.name) {
    return error.name;
  }

  return 'CacheError';
}

function cacheNamespaceFromKey(key: string): string {
  const trimmed = key.trim();
  if (!trimmed) return 'unknown';

  const parts = trimmed.split(':').filter(Boolean);
  if (parts.length === 0) return 'unknown';

  const first = parts[0].replace(/[^A-Za-z0-9_-]/g, '');
  const second = parts[1]?.replace(/[^A-Za-z0-9_-]/g, '');

  if (first === 'tag' && second) {
    return `tag:${second}`;
  }

  return first || 'unknown';
}

function isSafeOpaqueCacheId(identifier: string): boolean {
  return SAFE_CACHE_ID_REGEX.test(identifier);
}

function shouldSuppressRedisErrorLogInDev(errorMessage: string): boolean {
  if (!isDevelopment) {
    return false;
  }

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
    logWarn('CACHE_REDIS_DEV_HINT', { error: errorMessage });
  }

  return true;
}

// Initialize Redis cache client
export async function initializeCache(): Promise<any> {
  // Enable cache in both development and production
  const redisUrl = resolveRedisUrl();

  if (redisUrl == null) {
    logWarn('CACHE_REDIS_URL_MISSING');
    return null;
  }

  logInfo('CACHE_REDIS_CONNECTING', { redisEndpoint: sanitizeRedisUrl(redisUrl) });

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
      if (shouldSuppressRedisErrorLogInDev(sanitizeErrorDetail(error))) {
        return;
      }
      logError('CACHE_REDIS_ERROR', { error: sanitizeErrorDetail(error) });
    });

    await client.connect();
    await client.ping();
    logInfo('CACHE_REDIS_CONNECTED');
    return client;
  } catch (error) {
    if (shouldSuppressRedisErrorLogInDev(sanitizeErrorDetail(error))) {
      return null;
    }
    logError('CACHE_REDIS_CONNECT_FAILED', { error: sanitizeErrorDetail(error) });
    return null;
  }
}

// Cache service class
export class CacheService {
  private static instance: CacheService;
  private client: any = null;

  private constructor() {}

  public static getInstance(): CacheService {
    if (!CacheService.instance) {
      CacheService.instance = new CacheService();
    }
    return CacheService.instance;
  }

  public async initialize(): Promise<void> {
    this.client = await initializeCache();
  }

  // Check if cache is available
  public isAvailable(): boolean {
    return this.client !== null;
  }

  // Get raw Redis client for advanced operations (e.g., throttling with setex)
  public getClient(): any | null {
    return this.client;
  }

  private normalizeRedisValue(value: unknown): string | null {
    return typeof value === 'string'
      ? value
      : value instanceof Uint8Array
        ? Buffer.from(value).toString('utf8')
        : null;
  }

  private async readJsonValueWithStatus<T>(key: string): Promise<CacheReadResult<T>> {
    if (!this.client) {
      return { ok: false, reason: 'client_unavailable' };
    }

    try {
      const value = await this.client.get(key);
      if (!value) {
        return { ok: true, found: false };
      }

      const normalizedValue = this.normalizeRedisValue(value);
      if (!normalizedValue) {
        throw new Error('Unexpected Redis value type');
      }

      return {
        ok: true,
        found: true,
        value: JSON.parse(normalizedValue) as T,
      };
    } catch (error) {
      logError('CACHE_GET_FAILED', {
        cacheNamespace: cacheNamespaceFromKey(key),
        errorType: cacheErrorType(error),
      });
      return { ok: false, reason: 'read_error' };
    }
  }

  private async writeRawValueWithStatus(key: string, value: string, ttlSeconds: number): Promise<CacheWriteResult> {
    if (!this.client) {
      return { ok: false, reason: 'client_unavailable' };
    }

    try {
      await this.client.setEx(key, ttlSeconds, value);
      return { ok: true };
    } catch (error) {
      logError('CACHE_2FA_RAW_WRITE_FAILED', {
        cacheNamespace: cacheNamespaceFromKey(key),
        errorType: cacheErrorType(error),
      });
      return { ok: false, reason: 'write_error' };
    }
  }

  // Generic get/set with TTL
  public async get<T>(key: string): Promise<T | null> {
    const result = await this.readJsonValueWithStatus<T>(key);
    if (!result.ok || !result.found) {
      return null;
    }

    return result.value;
  }

  public async getTwoFactorCodeHash(userId: string): Promise<CacheReadResult<string>> {
    if (!isSafeOpaqueCacheId(userId)) {
      return { ok: false, reason: 'invalid_identifier' };
    }

    const key = `2fa:${userId}`;
    if (!this.client) {
      return { ok: false, reason: 'client_unavailable' };
    }

    try {
      const value = await this.client.get(key);
      if (!value) {
        return { ok: true, found: false };
      }

      const normalizedValue = this.normalizeRedisValue(value);
      if (!normalizedValue) {
        throw new Error('Unexpected Redis value type');
      }

      return { ok: true, found: true, value: normalizedValue };
    } catch (error) {
      logError('CACHE_2FA_RAW_READ_FAILED', {
        cacheNamespace: '2fa',
        errorType: cacheErrorType(error),
      });
      return { ok: false, reason: 'read_error' };
    }
  }

  public async set<T>(key: string, value: T, ttlSeconds: number = 300): Promise<boolean> {
    if (!this.client) return false;

    try {
      await this.client.setEx(key, ttlSeconds, JSON.stringify(value));
      return true;
    } catch (error) {
      logError('CACHE_SET_FAILED', {
        cacheNamespace: cacheNamespaceFromKey(key),
        errorType: cacheErrorType(error),
      });
      return false;
    }
  }

  public async setTwoFactorCodeHash(userId: string, codeHash: string, ttlSeconds: number = 300): Promise<CacheWriteResult> {
    if (!isSafeOpaqueCacheId(userId)) {
      return { ok: false, reason: 'invalid_identifier' };
    }
    if (!SHA256_HEX_REGEX.test(codeHash)) {
      return { ok: false, reason: 'invalid_value' };
    }

    return this.writeRawValueWithStatus(`2fa:${userId}`, codeHash, ttlSeconds);
  }

  public async del(key: string): Promise<boolean> {
    if (!this.client) return false;

    try {
      await this.client.del(key);
      return true;
    } catch (error) {
      logError('CACHE_DELETE_FAILED', {
        cacheNamespace: cacheNamespaceFromKey(key),
        errorType: cacheErrorType(error),
      });
      return false;
    }
  }

  /**
   * Get current cache version for a namespace.
   * Versioning enables O(1) global invalidation without KEYS command.
   *
   * @param namespace - Cache namespace (e.g., 'matching', 'availabilities')
   * @returns Current version number (defaults to 1 if not set)
   */
  public async getVersion(namespace: string): Promise<number> {
    if (!this.client) return 1;

    try {
      const versionKey = `cache:version:${namespace}`;
      const version = await this.client.get(versionKey);
      return version ? parseInt(version, 10) : 1;
    } catch (error) {
      logError('CACHE_VERSION_GET_FAILED', { namespace, error: sanitizeErrorDetail(error) });
      return 1;
    }
  }

  /**
   * Increment cache version for a namespace (global invalidation).
   * This is O(1) and safe in production (no KEYS command).
   *
   * All cache keys include version number, so incrementing version
   * instantly invalidates all caches in that namespace.
   *
   * @param namespace - Cache namespace to invalidate
   * @returns New version number
   */
  public async incrementVersion(namespace: string): Promise<number> {
    if (!this.client) return 1;

    try {
      const versionKey = `cache:version:${namespace}`;
      const newVersion = await this.client.incr(versionKey);
      logInfo('CACHE_VERSION_INCREMENTED', { namespace, newVersion });
      return newVersion;
    } catch (error) {
      logError('CACHE_VERSION_INCREMENT_FAILED', { namespace, error: sanitizeErrorDetail(error) });
      return 1;
    }
  }

  /**
   * Add a cache key to a tag (Redis Set) for targeted invalidation.
   *
   * Tags enable O(N) invalidation where N = keys in tag (typically < 100),
   * instead of O(ALL_KEYS) with KEYS command.
   *
   * @param tagKey - Tag identifier (e.g., "tag:avail:surf:beginner:g43.5:-1.5")
   * @param cacheKey - Cache key to track
   * @param ttlSeconds - Tag expiration (should match cache TTL + buffer)
   */
  private async addToTag(tagKey: string, cacheKey: string, ttlSeconds: number): Promise<void> {
    if (!this.client) return;

    try {
      await this.client.sAdd(tagKey, cacheKey);
      // Set TTL on tag to auto-cleanup (slightly longer than cache TTL)
      await this.client.expire(tagKey, ttlSeconds + 60);
    } catch (error) {
      logError('CACHE_TAG_ADD_FAILED', {
        cacheNamespace: cacheNamespaceFromKey(tagKey),
        errorType: cacheErrorType(error),
      });
    }
  }

  /**
   * Invalidate all cache keys associated with a tag.
   *
   * Uses SMEMBERS + UNLINK (async delete) for safe, performant invalidation.
   * UNLINK is preferred over DEL for large key sets (non-blocking).
   *
   * @param tagKey - Tag to invalidate
   * @returns Number of keys invalidated
   */
  private async invalidateByTag(tagKey: string): Promise<number> {
    if (!this.client) return 0;

    try {
      // Fetch all keys in tag (typically < 100 keys per tag)
      const keys = await this.client.sMembers(tagKey);

      if (keys.length === 0) {
        return 0;
      }

      // UNLINK = async delete (non-blocking, safer for production)
      await this.client.unlink(keys);

      // Remove tag itself
      await this.client.del(tagKey);

      logInfo('CACHE_TAG_INVALIDATED', { cacheNamespace: cacheNamespaceFromKey(tagKey), count: keys.length });
      return keys.length;
    } catch (error) {
      logError('CACHE_TAG_INVALIDATE_FAILED', {
        cacheNamespace: cacheNamespaceFromKey(tagKey),
        errorType: cacheErrorType(error),
      });
      return 0;
    }
  }

  // Matching cache methods (with versioning for O(1) invalidation)
  public async getMatchingResults(cacheKey: string): Promise<any[] | null> {
    const version = await this.getVersion('matching');
    return this.get(`matching:v${version}:${cacheKey}`);
  }

  public async setMatchingResults(cacheKey: string, results: any[], ttlSeconds: number = 300): Promise<boolean> {
    const version = await this.getVersion('matching');
    return this.set(`matching:v${version}:${cacheKey}`, results, ttlSeconds);
  }

  // Profile cache methods
  public async getProfile(userId: string): Promise<any | null> {
    return this.get(`profile:${userId}`);
  }

  public async setProfile(userId: string, profile: any, ttlSeconds: number = 600): Promise<boolean> {
    return this.set(`profile:${userId}`, profile, ttlSeconds);
  }

  // Availability cache methods (with tags for targeted invalidation)
  public async getAvailabilities(zoneKey: string): Promise<any[] | null> {
    return this.get(`availabilities:${zoneKey}`);
  }

  /**
   * Set availability cache with tag tracking for targeted invalidation.
   *
   * @param zoneKey - Cache key identifier (contains sport:level:cellId:radius)
   * @param availabilities - Availability data to cache
   * @param ttlSeconds - Cache TTL (default: 180s = 3min)
   */
  public async setAvailabilities(zoneKey: string, availabilities: any[], ttlSeconds: number = 180): Promise<boolean> {
    const success = await this.set(`availabilities:${zoneKey}`, availabilities, ttlSeconds);

    if (success) {
      // Extract cellId from zoneKey format: "sport:level:cellId:radius"
      // Example: "surf:beginner:g43.478:-1.572:10"
      const parts = zoneKey.split(':');
      if (parts.length >= 4) {
        const cellId = `${parts[2]}:${parts[3]}`; // "g43.478:-1.572"
        const tagKey = `tag:avail:${cellId}`;
        await this.addToTag(tagKey, `availabilities:${zoneKey}`, ttlSeconds);
      }
    }

    return success;
  }

  // Geographic distance cache
  public async getDistance(point1: string, point2: string): Promise<number | null> {
    return this.get(`distance:${point1}:${point2}`);
  }

  public async setDistance(point1: string, point2: string, distance: number, ttlSeconds: number = 3600): Promise<boolean> {
    return this.set(`distance:${point1}:${point2}`, distance, ttlSeconds);
  }

  /**
   * Invalidate matching caches using O(1) version increment.
   *
   * This method increments the matching version number, instantly
   * invalidating ALL matching caches without scanning keys.
   *
   * Note: sport/level parameters kept for API compatibility but not used.
   * Global invalidation is sufficient and safe (O(1), no KEYS command).
   *
   * @param sport - Unused (kept for backward compatibility)
   * @param level - Unused (kept for backward compatibility)
   */
  public async invalidateMatching(sport?: string, level?: string): Promise<void> {
    if (!this.client) return;

    try {
      // O(1) global invalidation via version increment
      const newVersion = await this.incrementVersion('matching');
      logInfo('CACHE_MATCHING_INVALIDATED', { version: newVersion });
    } catch (error) {
      logError('CACHE_INVALIDATION_FAILED', { error: sanitizeErrorDetail(error), namespace: 'matching' });
    }
  }

  /**
   * Invalidate availability caches using tags (targeted) or fallback to global.
   *
   * With coordinates: O(N) where N = keys in geographic cell (typically < 50)
   * Without coordinates: Global invalidation via pattern fallback (rare case)
   *
   * @param lat - Optional latitude for targeted invalidation
   * @param lng - Optional longitude for targeted invalidation
   */
  public async invalidateAvailabilities(lat?: number, lng?: number): Promise<void> {
    if (!this.client) return;

    try {
      const hasCoordinates = typeof lat === 'number' && typeof lng === 'number';

      if (hasCoordinates) {
        // Targeted invalidation using tags (O(N) where N = keys in cell)
        const cell = gridCell(lat!, lng!, DEFAULT_GRID_CELL_KM);
        const tagKey = `tag:avail:${cell.cellId}`;
        const count = await this.invalidateByTag(tagKey);

        if (count > 0) {
          logInfo('CACHE_AVAILABILITIES_INVALIDATED_TARGETED', { cellId: cell.cellId, count });
        }
      } else {
        // Global invalidation fallback (rare case, e.g., admin bulk update)
        // Use SCAN instead of KEYS for safety
        logWarn('CACHE_AVAILABILITIES_INVALIDATED_GLOBAL');
        await this.scanAndDelete('availabilities:*');
      }
    } catch (error) {
      logError('CACHE_INVALIDATION_FAILED', { error: sanitizeErrorDetail(error), namespace: 'availabilities' });
    }
  }

  /**
   * Scan and delete keys matching pattern (safe KEYS replacement).
   *
   * Uses SCAN cursor to iterate without blocking Redis.
   * Should only be used for global invalidation (rare cases).
   *
   * @param pattern - Redis key pattern
   */
  private async scanAndDelete(pattern: string): Promise<number> {
    if (!this.client) return 0;

    try {
      let cursor = 0;
      let totalDeleted = 0;
      const batchSize = 100;

      do {
        const result = await this.client.scan(cursor, {
          MATCH: pattern,
          COUNT: batchSize
        });

        cursor = result.cursor;
        const keys = result.keys;

        if (keys.length > 0) {
          await this.client.unlink(keys);
          totalDeleted += keys.length;
        }
      } while (cursor !== 0);

      if (totalDeleted > 0) {
        logInfo('CACHE_SCAN_DELETE_COMPLETED', {
          cacheNamespace: cacheNamespaceFromKey(pattern),
          totalDeleted,
        });
      }

      return totalDeleted;
    } catch (error) {
      logError('CACHE_SCAN_DELETE_FAILED', {
        cacheNamespace: cacheNamespaceFromKey(pattern),
        errorType: cacheErrorType(error),
      });
      return 0;
    }
  }

  // Health check
  public async healthCheck(): Promise<{ status: string; latency?: number }> {
    if (!this.client) {
      return { status: 'disabled' };
    }

    try {
      const start = Date.now();
      await this.client.ping();
      const latency = Date.now() - start;
      return { status: 'healthy', latency };
    } catch (error) {
      return { status: 'error' };
    }
  }

  // Cleanup for graceful shutdown
  public async close(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      logInfo('CACHE_REDIS_CLIENT_CLOSED');
    }
  }
}

// Export singleton instance
export const cacheService = CacheService.getInstance();

// Initialize cache on module load (except in tests)
if (process.env.NODE_ENV !== 'test') {
  cacheService.initialize().catch((error) => {
    secureLogger.error('CACHE_SERVICE_INIT_FAILED', { error: sanitizeErrorDetail(error) });
  });
}

// Helper functions for cache key generation (using geographic grid for stability)
export const CacheKeys = {
  // Matching cache keys (grid-based for better cache hit rate)
  matching: (sport: string, level: string, lat: number, lng: number, radius: number) => {
    const cell = gridCell(lat, lng, DEFAULT_GRID_CELL_KM);
    return `${sport}:${level}:${cell.cellId}:${radius}`;
  },

  // Profile cache keys
  profile: (userId: string) => userId,

  // Availability cache keys (grid-based for zone consistency)
  availabilities: (sport: string, level: string, lat: number, lng: number, radius: number) => {
    const cell = gridCell(lat, lng, DEFAULT_GRID_CELL_KM);
    return `${sport}:${level}:${cell.cellId}:${radius}`;
  },

  // Distance cache keys (high precision for exact distances)
  distance: (lat1: number, lng1: number, lat2: number, lng2: number) => {
    // Normalize coordinates for consistent caching
    const p1 = `${Math.floor(lat1 * 1000)},${Math.floor(lng1 * 1000)}`;
    const p2 = `${Math.floor(lat2 * 1000)},${Math.floor(lng2 * 1000)}`;
    return p1 < p2 ? `${p1}:${p2}` : `${p2}:${p1}`;
  }
};
