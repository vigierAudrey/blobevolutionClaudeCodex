import { createClient } from 'redis';
import { resolveRedisUrl } from '../lib/redisConfig';

// Redis client for caching (separate from rate limiting)
let cacheClient: any = null;
const shouldLogCache = process.env.NODE_ENV !== 'test' || process.env.ENABLE_TEST_LOGS === 'true';
const logInfo = (...args: Parameters<typeof console.log>) => { if (shouldLogCache) console.log(...args); };
const logWarn = (...args: Parameters<typeof console.warn>) => { if (shouldLogCache) console.warn(...args); };
const logError = (...args: Parameters<typeof console.error>) => console.error(...args);

// Initialize Redis cache client
export async function initializeCache(): Promise<any> {
  // Enable cache in both development and production
  const redisUrl = resolveRedisUrl();

  if (redisUrl == null) {
    logWarn('⚠️ Redis URL not provided, cache disabled');
    return null;
  }

  logInfo('🔗 Connecting to Redis at:', redisUrl);

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
      logError('❌ Redis error:', error.message);
    });

    await client.connect();
    await client.ping();
    logInfo('✅ Redis cache connected');
    return client;
  } catch (error) {
    logError('❌ Redis cache connection failed:', error);
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

  // Generic get/set with TTL
  public async get<T>(key: string): Promise<T | null> {
    if (!this.client) return null;

    try {
      const value = await this.client.get(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      logError(`Cache get error for key ${key}:`, error);
      return null;
    }
  }

  public async set<T>(key: string, value: T, ttlSeconds: number = 300): Promise<boolean> {
    if (!this.client) return false;

    try {
      await this.client.setEx(key, ttlSeconds, JSON.stringify(value));
      return true;
    } catch (error) {
      logError(`Cache set error for key ${key}:`, error);
      return false;
    }
  }

  public async del(key: string): Promise<boolean> {
    if (!this.client) return false;

    try {
      await this.client.del(key);
      return true;
    } catch (error) {
      logError(`Cache delete error for key ${key}:`, error);
      return false;
    }
  }

  // Matching cache methods
  public async getMatchingResults(cacheKey: string): Promise<any[] | null> {
    return this.get(`matching:${cacheKey}`);
  }

  public async setMatchingResults(cacheKey: string, results: any[], ttlSeconds: number = 300): Promise<boolean> {
    return this.set(`matching:${cacheKey}`, results, ttlSeconds);
  }

  // Profile cache methods
  public async getProfile(userId: string): Promise<any | null> {
    return this.get(`profile:${userId}`);
  }

  public async setProfile(userId: string, profile: any, ttlSeconds: number = 600): Promise<boolean> {
    return this.set(`profile:${userId}`, profile, ttlSeconds);
  }

  // Availability cache methods
  public async getAvailabilities(zoneKey: string): Promise<any[] | null> {
    return this.get(`availabilities:${zoneKey}`);
  }

  public async setAvailabilities(zoneKey: string, availabilities: any[], ttlSeconds: number = 180): Promise<boolean> {
    return this.set(`availabilities:${zoneKey}`, availabilities, ttlSeconds);
  }

  // Geographic distance cache
  public async getDistance(point1: string, point2: string): Promise<number | null> {
    return this.get(`distance:${point1}:${point2}`);
  }

  public async setDistance(point1: string, point2: string, distance: number, ttlSeconds: number = 3600): Promise<boolean> {
    return this.set(`distance:${point1}:${point2}`, distance, ttlSeconds);
  }

  // Invalidate related caches
  public async invalidateMatching(sport?: string, level?: string): Promise<void> {
    if (!this.client) return;

    try {
      const pattern = sport && level
        ? `matching:${sport}:${level}:*`
        : 'matching:*';

      const keys = await this.client.keys(pattern);
      if (keys.length > 0) {
        await this.client.del(keys);
        logInfo(`🗑️ Invalidated ${keys.length} matching cache entries`);
      }
    } catch (error) {
      logError('Cache invalidation error:', error);
    }
  }

  public async invalidateAvailabilities(lat?: number, lng?: number): Promise<void> {
    if (!this.client) return;

    try {
      const hasCoordinates = typeof lat === 'number' && typeof lng === 'number';
      const pattern = hasCoordinates
        ? `availabilities:*:*:${Math.floor(lat! * 10)}:${Math.floor(lng! * 10)}:*`
        : 'availabilities:*';

      const keys = await this.client.keys(pattern);
      if (keys.length > 0) {
        await this.client.del(keys);
        logInfo(`🗑️ Invalidated ${keys.length} availability cache entries`);
      }
    } catch (error) {
      logError('Cache invalidation error:', error);
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
      logInfo('✅ Redis cache client closed');
    }
  }
}

// Export singleton instance
export const cacheService = CacheService.getInstance();

// Initialize cache on module load (except in tests)
if (process.env.NODE_ENV !== 'test') {
  cacheService.initialize().catch(console.error);
}

// Helper functions for cache key generation
export const CacheKeys = {
  // Matching cache keys
  matching: (sport: string, level: string, lat: number, lng: number, radius: number) =>
    `${sport}:${level}:${Math.floor(lat * 100)}:${Math.floor(lng * 100)}:${radius}`,

  // Profile cache keys
  profile: (userId: string) => userId,

  // Availability cache keys (zone-based)
  availabilities: (sport: string, level: string, lat: number, lng: number, radius: number) =>
    `${sport}:${level}:${Math.floor(lat * 10)}:${Math.floor(lng * 10)}:${radius}`,

  // Distance cache keys
  distance: (lat1: number, lng1: number, lat2: number, lng2: number) => {
    // Normalize coordinates for consistent caching
    const p1 = `${Math.floor(lat1 * 1000)},${Math.floor(lng1 * 1000)}`;
    const p2 = `${Math.floor(lat2 * 1000)},${Math.floor(lng2 * 1000)}`;
    return p1 < p2 ? `${p1}:${p2}` : `${p2}:${p1}`;
  }
};
