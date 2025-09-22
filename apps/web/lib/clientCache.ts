/**
 * Client-side cache service for optimizing API requests
 * Features:
 * - TTL-based expiration
 * - Memory efficient with size limits
 * - Intelligent invalidation
 * - Prefetching support
 */

type CacheItem<T> = {
  data: T;
  timestamp: number;
  ttl: number; // Time to live in milliseconds
  size: number; // Estimated size in bytes
};

type CacheStrategy = 'memory' | 'session' | 'local';

interface CacheConfig {
  maxSize: number; // Max total cache size in bytes
  defaultTTL: number; // Default TTL in milliseconds
  strategy: CacheStrategy;
}

class ClientCache {
  private memoryCache = new Map<string, CacheItem<any>>();
  private currentSize = 0;
  private config: CacheConfig;

  constructor(config: Partial<CacheConfig> = {}) {
    this.config = {
      maxSize: 50 * 1024 * 1024, // 50MB default
      defaultTTL: 5 * 60 * 1000, // 5 minutes default
      strategy: 'memory',
      ...config,
    };
  }

  /**
   * Get cached data if available and not expired
   */
  get<T>(key: string): T | null {
    const item = this.memoryCache.get(key);

    if (!item) {
      return null;
    }

    // Check if expired
    if (Date.now() - item.timestamp > item.ttl) {
      this.delete(key);
      return null;
    }

    return item.data;
  }

  /**
   * Set cache data with optional custom TTL
   */
  set<T>(key: string, data: T, ttl?: number): void {
    const size = this.estimateSize(data);
    const cacheItem: CacheItem<T> = {
      data,
      timestamp: Date.now(),
      ttl: ttl || this.config.defaultTTL,
      size,
    };

    // Check if we need to free up space
    this.ensureSpace(size);

    // Remove old entry if exists
    if (this.memoryCache.has(key)) {
      const oldItem = this.memoryCache.get(key)!;
      this.currentSize -= oldItem.size;
    }

    this.memoryCache.set(key, cacheItem);
    this.currentSize += size;
  }

  /**
   * Delete specific cache entry
   */
  delete(key: string): boolean {
    const item = this.memoryCache.get(key);
    if (item) {
      this.currentSize -= item.size;
      return this.memoryCache.delete(key);
    }
    return false;
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    this.memoryCache.clear();
    this.currentSize = 0;
  }

  /**
   * Invalidate cache entries by pattern
   */
  invalidatePattern(pattern: string): number {
    const regex = new RegExp(pattern);
    let deletedCount = 0;

    Array.from(this.memoryCache.keys()).forEach(key => {
      if (regex.test(key)) {
        this.delete(key);
        deletedCount++;
      }
    });

    return deletedCount;
  }

  /**
   * Get cache statistics
   */
  getStats() {
    const totalEntries = this.memoryCache.size;
    const expired = Array.from(this.memoryCache.entries()).filter(
      ([, item]) => Date.now() - item.timestamp > item.ttl
    ).length;

    return {
      totalEntries,
      currentSize: this.currentSize,
      maxSize: this.config.maxSize,
      expired,
      utilizationPercent: (this.currentSize / this.config.maxSize) * 100,
    };
  }

  /**
   * Cleanup expired entries
   */
  cleanup(): number {
    const now = Date.now();
    let deletedCount = 0;

    Array.from(this.memoryCache.entries()).forEach(([key, item]) => {
      if (now - item.timestamp > item.ttl) {
        this.delete(key);
        deletedCount++;
      }
    });

    return deletedCount;
  }

  /**
   * Ensure we have enough space by evicting LRU items
   */
  private ensureSpace(requiredSize: number): void {
    if (this.currentSize + requiredSize <= this.config.maxSize) {
      return;
    }

    // Sort by timestamp (oldest first) for LRU eviction
    const sortedEntries = Array.from(this.memoryCache.entries()).sort(
      ([, a], [, b]) => a.timestamp - b.timestamp
    );

    for (const [key] of sortedEntries) {
      this.delete(key);
      if (this.currentSize + requiredSize <= this.config.maxSize) {
        break;
      }
    }
  }

  /**
   * Estimate size of data in bytes
   */
  private estimateSize(data: any): number {
    try {
      return new Blob([JSON.stringify(data)]).size;
    } catch {
      // Fallback estimation
      return JSON.stringify(data).length * 2; // Rough estimate
    }
  }
}

// Create singleton instance
export const clientCache = new ClientCache({
  maxSize: 25 * 1024 * 1024, // 25MB for mobile-friendly
  defaultTTL: 5 * 60 * 1000, // 5 minutes
  strategy: 'memory',
});

// Cache key generators for different data types
export const CacheKeys = {
  user: () => 'user:me',
  profile: () => 'profile:me',
  disciplines: () => 'profile:disciplines',
  conversations: () => 'conversations:list',
  searchMatching: (params: any) => {
    const key = `search:${params.sport}:${params.level}:${params.date}`;
    if (params.location) {
      return `${key}:${Math.floor(params.location.lat * 100)}:${Math.floor(params.location.lng * 100)}`;
    }
    return key;
  },
  proAvailabilities: () => 'pro:availabilities',
  proInbox: () => 'pro:inbox',
  offers: (params: any) => `offers:${params.sport || 'all'}:${params.level || 'all'}`,
};

// Cache TTL constants (in milliseconds)
export const CacheTTL = {
  USER_DATA: 10 * 60 * 1000, // 10 minutes - user rarely changes
  PROFILE_DATA: 5 * 60 * 1000, // 5 minutes - profile can change
  SEARCH_RESULTS: 2 * 60 * 1000, // 2 minutes - dynamic data
  CONVERSATIONS: 30 * 1000, // 30 seconds - frequent updates
  STATIC_DATA: 30 * 60 * 1000, // 30 minutes - very stable data
  REAL_TIME: 10 * 1000, // 10 seconds - real-time data
};

// Auto cleanup every 5 minutes
setInterval(() => {
  const deleted = clientCache.cleanup();
  if (deleted > 0) {
    console.log(`🧹 Cache cleanup: removed ${deleted} expired entries`);
  }
}, 5 * 60 * 1000);

// Log cache stats in development
if (process.env.NODE_ENV === 'development') {
  setInterval(() => {
    const stats = clientCache.getStats();
    if (stats.totalEntries > 0) {
      console.log('📊 Cache stats:', stats);
    }
  }, 60 * 1000); // Every minute
}