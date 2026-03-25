import { beforeEach, afterEach, afterAll, beforeAll, describe, it, expect, jest } from '@jest/globals';
import { CacheService, cacheService, CacheKeys, initializeCache } from '../cache.service';

import { createClient } from 'redis';
import * as redisConfig from '../../lib/redisConfig';
import { secureLogger } from '../../utils/secure-logger';

const redisMock = (globalThis as any).__REDIS_MOCK__ as {
  instances: any[];
  createClient: jest.Mock;
  factory: () => any;
};

const mockCreateClient = createClient as jest.MockedFunction<typeof createClient>;
const mockResolveRedisUrl = jest.spyOn(redisConfig, 'resolveRedisUrl');

let mockRedisClient: ReturnType<typeof redisMock.factory>;

const prepareRedisClient = () => {
  mockRedisClient = redisMock.factory();
  redisMock.createClient.mockReturnValue(mockRedisClient);
  return mockRedisClient;
};

describe('CacheService', () => {
  let cacheServiceInstance: CacheService;
  let loggerErrorSpy: jest.SpiedFunction<typeof secureLogger.error>;

  beforeAll(() => {
    loggerErrorSpy = jest.spyOn(secureLogger, 'error').mockImplementation(() => undefined);
  });
  beforeEach(async () => {
    jest.clearAllMocks();
    mockResolveRedisUrl.mockReset();
    redisMock.createClient.mockClear();
    redisMock.instances.length = 0;
    prepareRedisClient();

    await cacheService.close();
    (cacheService as any).client = null;
    cacheServiceInstance = CacheService.getInstance();
  });

  afterEach(async () => {
    // Clean up after each test
    if (cacheServiceInstance) {
      await cacheServiceInstance.close();
    }
  });

  afterAll(async () => {
    // Final cleanup
    await cacheService.close();
    loggerErrorSpy.mockRestore();
  });

  describe('Singleton Pattern', () => {
    it('should return the same instance on multiple calls', () => {
      const instance1 = CacheService.getInstance();
      const instance2 = CacheService.getInstance();

      expect(instance1).toBe(instance2);
    });

    it('should maintain singleton pattern across different imports', () => {
      expect(cacheService).toBeInstanceOf(CacheService);
      expect(cacheService).toBe(CacheService.getInstance());
    });
  });

  describe('Redis Connection', () => {
    describe('initializeCache function', () => {
      it('should connect to Redis successfully when URL is provided', async () => {
        mockResolveRedisUrl.mockReturnValue('redis://localhost:6379');
        mockRedisClient.connect.mockResolvedValue(undefined as any);
        mockRedisClient.ping.mockResolvedValue('PONG' as any);

        const client = await initializeCache();

        expect(mockResolveRedisUrl).toHaveBeenCalled();
        expect(mockCreateClient).toHaveBeenCalledWith(expect.objectContaining({
          url: 'redis://localhost:6379'
        }));
        expect(mockRedisClient.connect).toHaveBeenCalled();
        expect(mockRedisClient.ping).toHaveBeenCalled();
        expect(client).toBe(mockRedisClient);
      });

      it('should return null when Redis connection fails', async () => {
        mockResolveRedisUrl.mockReturnValue('redis://localhost:6379');
        mockRedisClient.connect.mockRejectedValue(new Error('Connection failed'));

        const client = await initializeCache();

        expect(client).toBeNull();
        expect(mockRedisClient.connect).toHaveBeenCalled();
      });

      it('should return null when no Redis URL is provided', async () => {
        mockResolveRedisUrl.mockReturnValue(null as any);

        const client = await initializeCache();

        expect(client).toBeNull();
        expect(mockCreateClient).not.toHaveBeenCalled();
      });
    });

    describe('CacheService initialization', () => {
      it('should initialize with Redis client when available', async () => {
        mockResolveRedisUrl.mockReturnValue('redis://localhost:6379');
        mockRedisClient.connect.mockResolvedValue(undefined as any);
        mockRedisClient.ping.mockResolvedValue('PONG' as any);

        await cacheServiceInstance.initialize();

        expect(cacheServiceInstance.isAvailable()).toBe(true);
      });

      it('should handle initialization failure gracefully', async () => {
        mockResolveRedisUrl.mockReturnValue('redis://localhost:6379');
        mockRedisClient.connect.mockRejectedValue(new Error('Connection failed'));

        await cacheServiceInstance.initialize();

        expect(cacheServiceInstance.isAvailable()).toBe(false);
      });
    });
  });

  describe('Basic Cache Operations', () => {
    beforeEach(async () => {
      // Setup successful Redis connection for cache operations tests
      mockResolveRedisUrl.mockReturnValue('redis://localhost:6379');
      mockRedisClient.connect.mockResolvedValue(undefined);
      mockRedisClient.ping.mockResolvedValue('PONG');
      await cacheServiceInstance.initialize();
    });

    describe('get method', () => {
      it('should retrieve and parse cached value', async () => {
        const testData = { id: 1, name: 'Test' };
        mockRedisClient.get.mockResolvedValue(JSON.stringify(testData));

        const result = await cacheServiceInstance.get<typeof testData>('test:key');

        expect(mockRedisClient.get).toHaveBeenCalledWith('test:key');
        expect(result).toEqual(testData);
      });

      it('should return null for non-existent keys', async () => {
        mockRedisClient.get.mockResolvedValue(null);

        const result = await cacheServiceInstance.get('nonexistent:key');

        expect(result).toBeNull();
      });

      it('should return null when Redis is not available', async () => {
        // Reset to unavailable state
        (cacheServiceInstance as any).client = null;

        const result = await cacheServiceInstance.get('test:key');

        expect(result).toBeNull();
        expect(mockRedisClient.get).not.toHaveBeenCalled();
      });

      it('should handle JSON parsing errors gracefully', async () => {
        mockRedisClient.get.mockResolvedValue('invalid-json{');

        const result = await cacheServiceInstance.get('test:key');

        expect(result).toBeNull();
        expect(loggerErrorSpy).toHaveBeenCalledWith(
          'CACHE_GET_FAILED',
          expect.objectContaining({
            cacheNamespace: 'test',
            errorType: 'SyntaxError',
          })
        );
      });

      it('should handle Redis errors gracefully', async () => {
        mockRedisClient.get.mockRejectedValue(new Error('Redis error'));

        const result = await cacheServiceInstance.get('test:key');

        expect(result).toBeNull();
        expect(loggerErrorSpy).toHaveBeenCalledWith(
          'CACHE_GET_FAILED',
          expect.objectContaining({
            cacheNamespace: 'test',
            errorType: 'Error',
          })
        );
      });
    });

    describe('set method', () => {
      it('should cache value with default TTL', async () => {
        const testData = { id: 1, name: 'Test' };
        mockRedisClient.setEx.mockResolvedValue('OK' as any);

        const result = await cacheServiceInstance.set('test:key', testData);

        expect(mockRedisClient.setEx).toHaveBeenCalledWith(
          'test:key',
          300, // default TTL
          JSON.stringify(testData)
        );
        expect(result).toBe(true);
      });

      it('should cache value with custom TTL', async () => {
        const testData = { id: 1, name: 'Test' };
        mockRedisClient.setEx.mockResolvedValue('OK' as any);

        const result = await cacheServiceInstance.set('test:key', testData, 600);

        expect(mockRedisClient.setEx).toHaveBeenCalledWith(
          'test:key',
          600,
          JSON.stringify(testData)
        );
        expect(result).toBe(true);
      });

      it('should return false when Redis is not available', async () => {
        (cacheServiceInstance as any).client = null;

        const result = await cacheServiceInstance.set('test:key', { test: true });

        expect(result).toBe(false);
        expect(mockRedisClient.setEx).not.toHaveBeenCalled();
      });

      it('should handle Redis errors gracefully', async () => {
        mockRedisClient.setEx.mockRejectedValue(new Error('Redis error'));

        const result = await cacheServiceInstance.set('test:key', { test: true });

        expect(result).toBe(false);
        expect(loggerErrorSpy).toHaveBeenCalledWith(
          'CACHE_SET_FAILED',
          expect.objectContaining({
            cacheNamespace: 'test',
            errorType: 'Error',
          })
        );
      });
    });

    describe('del method', () => {
      it('should delete cached value', async () => {
        mockRedisClient.del.mockResolvedValue(1 as any);

        const result = await cacheServiceInstance.del('test:key');

        expect(mockRedisClient.del).toHaveBeenCalledWith('test:key');
        expect(result).toBe(true);
      });

      it('should return false when Redis is not available', async () => {
        (cacheServiceInstance as any).client = null;

        const result = await cacheServiceInstance.del('test:key');

        expect(result).toBe(false);
        expect(mockRedisClient.del).not.toHaveBeenCalled();
      });

      it('should handle Redis errors gracefully', async () => {
        mockRedisClient.del.mockRejectedValue(new Error('Redis error'));

        const result = await cacheServiceInstance.del('test:key');

        expect(result).toBe(false);
        expect(loggerErrorSpy).toHaveBeenCalledWith(
          'CACHE_DELETE_FAILED',
          expect.objectContaining({
            cacheNamespace: 'test',
            errorType: 'Error',
          })
        );
      });
    });
  });

  describe('Specialized Cache Methods', () => {
    beforeEach(async () => {
      mockResolveRedisUrl.mockReturnValue('redis://localhost:6379');
      mockRedisClient.connect.mockResolvedValue(undefined);
      mockRedisClient.ping.mockResolvedValue('PONG');
      await cacheServiceInstance.initialize();
    });

    describe('Matching cache methods', () => {
      it('should get matching results with versioned key', async () => {
        const matchingData = [{ id: 1, name: 'Match1' }];
        mockRedisClient.get.mockResolvedValueOnce('1'); // version
        mockRedisClient.get.mockResolvedValueOnce(JSON.stringify(matchingData)); // actual data

        const result = await cacheServiceInstance.getMatchingResults('surf:beginner:123');

        // Should fetch version first, then data with versioned key
        expect(mockRedisClient.get).toHaveBeenCalledWith('cache:version:matching');
        expect(mockRedisClient.get).toHaveBeenCalledWith('matching:v1:surf:beginner:123');
        expect(result).toEqual(matchingData);
      });

      it('should set matching results with versioned key and custom TTL', async () => {
        const matchingData = [{ id: 1, name: 'Match1' }];
        mockRedisClient.get.mockResolvedValue('1'); // version
        mockRedisClient.setEx.mockResolvedValue('OK' as any);

        const result = await cacheServiceInstance.setMatchingResults('surf:beginner:123', matchingData, 600);

        // Should include version in key
        expect(mockRedisClient.setEx).toHaveBeenCalledWith(
          'matching:v1:surf:beginner:123',
          600,
          JSON.stringify(matchingData)
        );
        expect(result).toBe(true);
      });
    });

    describe('Profile cache methods', () => {
      it('should get profile with prefixed key', async () => {
        const profileData = { id: 'user123', name: 'John Doe' };
        mockRedisClient.get.mockResolvedValue(JSON.stringify(profileData));

        const result = await cacheServiceInstance.getProfile('user123');

        expect(mockRedisClient.get).toHaveBeenCalledWith('profile:user123');
        expect(result).toEqual(profileData);
      });

      it('should set profile with prefixed key and default TTL', async () => {
        const profileData = { id: 'user123', name: 'John Doe' };
        mockRedisClient.setEx.mockResolvedValue('OK' as any);

        const result = await cacheServiceInstance.setProfile('user123', profileData);

        expect(mockRedisClient.setEx).toHaveBeenCalledWith(
          'profile:user123',
          600, // default profile TTL
          JSON.stringify(profileData)
        );
        expect(result).toBe(true);
      });
    });

    describe('Availability cache methods', () => {
      it('should get availabilities with prefixed key', async () => {
        const availabilities = [{ id: 1, startAt: '2024-01-01T10:00:00Z' }];
        mockRedisClient.get.mockResolvedValue(JSON.stringify(availabilities));

        const result = await cacheServiceInstance.getAvailabilities('zone:43:-1');

        expect(mockRedisClient.get).toHaveBeenCalledWith('availabilities:zone:43:-1');
        expect(result).toEqual(availabilities);
      });

      it('should set availabilities with prefixed key and custom TTL', async () => {
        const availabilities = [{ id: 1, startAt: '2024-01-01T10:00:00Z' }];
        mockRedisClient.setEx.mockResolvedValue('OK' as any);

        const result = await cacheServiceInstance.setAvailabilities('zone:43:-1', availabilities);

        expect(mockRedisClient.setEx).toHaveBeenCalledWith(
          'availabilities:zone:43:-1',
          180, // default availability TTL
          JSON.stringify(availabilities)
        );
        expect(result).toBe(true);
      });
    });

    describe('Distance cache methods', () => {
      it('should get distance with prefixed key', async () => {
        mockRedisClient.get.mockResolvedValue('12500.5');

        const result = await cacheServiceInstance.getDistance('43.5,-1.5', '43.6,-1.4');

        expect(mockRedisClient.get).toHaveBeenCalledWith('distance:43.5,-1.5:43.6,-1.4');
        expect(result).toBe(12500.5);
      });

      it('should set distance with prefixed key and custom TTL', async () => {
        mockRedisClient.setEx.mockResolvedValue('OK' as any);

        const result = await cacheServiceInstance.setDistance('43.5,-1.5', '43.6,-1.4', 12500.5);

        expect(mockRedisClient.setEx).toHaveBeenCalledWith(
          'distance:43.5,-1.5:43.6,-1.4',
          3600, // default distance TTL
          JSON.stringify(12500.5)
        );
        expect(result).toBe(true);
      });
    });
  });

  describe('Cache Invalidation', () => {
    beforeEach(async () => {
      mockResolveRedisUrl.mockReturnValue('redis://localhost:6379');
      mockRedisClient.connect.mockResolvedValue(undefined);
      mockRedisClient.ping.mockResolvedValue('PONG');
      await cacheServiceInstance.initialize();
    });

    describe('invalidateMatching method', () => {
      it('should invalidate using version increment (O(1) global invalidation)', async () => {
        mockRedisClient.incr.mockResolvedValue(2); // New version

        await cacheServiceInstance.invalidateMatching('surf', 'beginner');

        // Should increment version instead of using KEYS
        expect(mockRedisClient.incr).toHaveBeenCalledWith('cache:version:matching');
        // Should NOT use KEYS command
        expect(mockRedisClient.keys).not.toHaveBeenCalled();
        expect(mockRedisClient.del).not.toHaveBeenCalled();
      });

      it('should work the same with or without sport/level parameters', async () => {
        mockRedisClient.incr.mockResolvedValue(3);

        await cacheServiceInstance.invalidateMatching(); // No parameters

        // Global invalidation via version increment
        expect(mockRedisClient.incr).toHaveBeenCalledWith('cache:version:matching');
      });

      it('should handle Redis errors during invalidation', async () => {
        mockRedisClient.incr.mockRejectedValue(new Error('Redis error'));

        // Should not throw
        await expect(cacheServiceInstance.invalidateMatching('surf', 'beginner')).resolves.not.toThrow();
      });

      it('should do nothing when Redis is not available', async () => {
        (cacheServiceInstance as any).client = null;

        await cacheServiceInstance.invalidateMatching('surf', 'beginner');

        expect(mockRedisClient.incr).not.toHaveBeenCalled();
      });
    });

    describe('invalidateAvailabilities method', () => {
      it('should invalidate using tags when coordinates provided (targeted invalidation)', async () => {
        // Mock tag-based invalidation
        const mockTagKeys = [
          'availabilities:surf:beginner:g43.478:-1.572:25',
          'availabilities:kite:advanced:g43.478:-1.572:50',
        ];
        mockRedisClient.sMembers.mockResolvedValue(mockTagKeys as any);
        mockRedisClient.unlink.mockResolvedValue(mockTagKeys.length as any);
        mockRedisClient.del.mockResolvedValue(1 as any); // Delete tag itself

        await cacheServiceInstance.invalidateAvailabilities(43.5, -1.5);

        // Should use tag-based invalidation (SMEMBERS + UNLINK + DEL tag)
        expect(mockRedisClient.sMembers).toHaveBeenCalledWith(expect.stringMatching(/^tag:avail:g43\.\d+:-1\.\d+$/));
        expect(mockRedisClient.unlink).toHaveBeenCalledWith(mockTagKeys);
        expect(mockRedisClient.del).toHaveBeenCalledWith(expect.stringMatching(/^tag:avail:g43\.\d+:-1\.\d+$/));

        // Should NOT use KEYS command
        expect(mockRedisClient.keys).not.toHaveBeenCalled();
      });

      it('should use SCAN fallback when no coordinates provided (global invalidation)', async () => {
        // Mock SCAN cursor iteration
        mockRedisClient.scan.mockResolvedValueOnce({
          cursor: 10,
          keys: ['availabilities:1', 'availabilities:2']
        } as any);
        mockRedisClient.scan.mockResolvedValueOnce({
          cursor: 0, // End of scan
          keys: ['availabilities:3']
        } as any);
        mockRedisClient.unlink.mockResolvedValue(2 as any);

        await cacheServiceInstance.invalidateAvailabilities();

        // Should use SCAN instead of KEYS
        expect(mockRedisClient.scan).toHaveBeenCalled();
        expect(mockRedisClient.unlink).toHaveBeenCalled();

        // Should NOT use KEYS command
        expect(mockRedisClient.keys).not.toHaveBeenCalled();
      });

      it('should handle empty tag gracefully', async () => {
        mockRedisClient.sMembers.mockResolvedValue([] as any); // Empty tag

        await cacheServiceInstance.invalidateAvailabilities(43.5, -1.5);

        // Should check tag but not attempt deletion
        expect(mockRedisClient.sMembers).toHaveBeenCalled();
        expect(mockRedisClient.unlink).not.toHaveBeenCalled();
      });
    });
  });

  describe('Health Check', () => {
    it('should return disabled status when Redis is not available', async () => {
      (cacheServiceInstance as any).client = null;

      const health = await cacheServiceInstance.healthCheck();

      expect(health).toEqual({ status: 'disabled' });
    });

    it('should return healthy status with latency when Redis is available', async () => {
      mockResolveRedisUrl.mockReturnValue('redis://localhost:6379');
      mockRedisClient.connect.mockResolvedValue(undefined);
      mockRedisClient.ping.mockResolvedValue('PONG');
      await cacheServiceInstance.initialize();

      mockRedisClient.ping.mockResolvedValue('PONG');

      const health = await cacheServiceInstance.healthCheck();

      expect(health.status).toBe('healthy');
      expect(health.latency).toBeGreaterThanOrEqual(0);
      expect(typeof health.latency).toBe('number');
    });

    it('should return error status when Redis ping fails', async () => {
      mockResolveRedisUrl.mockReturnValue('redis://localhost:6379');
      mockRedisClient.connect.mockResolvedValue(undefined);
      mockRedisClient.ping.mockResolvedValue('PONG');
      await cacheServiceInstance.initialize();

      mockRedisClient.ping.mockRejectedValue(new Error('Ping failed'));

      const health = await cacheServiceInstance.healthCheck();

      expect(health).toEqual({ status: 'error' });
    });
  });

  describe('Cache Key Generation', () => {
    describe('CacheKeys.matching', () => {
      it('should generate consistent matching cache keys using grid cells', () => {
        const key1 = CacheKeys.matching('surf', 'beginner', 43.4832, -1.5586, 10);
        const key2 = CacheKeys.matching('surf', 'beginner', 43.4832, -1.5586, 10);

        expect(key1).toBe(key2);
        // New format: sport:level:cellId:radius (cellId format: gLAT:LNG)
        expect(key1).toMatch(/^surf:beginner:g43\.\d+:-1\.\d+:10$/);
      });

      it('should generate same key for coordinates in same grid cell (5km)', () => {
        // Two coordinates ~3km apart should map to same 5km cell
        const key1 = CacheKeys.matching('surf', 'beginner', 43.4832, -1.5586, 10);
        const key2 = CacheKeys.matching('surf', 'beginner', 43.4901, -1.5621, 10);

        // Same cell = same cache key = better cache hit rate ✓
        expect(key1).toBe(key2);
      });

      it('should generate different keys for coordinates in different cells', () => {
        // Coordinates ~10km apart should be in different 5km cells
        const key1 = CacheKeys.matching('surf', 'beginner', 43.4832, -1.5586, 10);
        const key2 = CacheKeys.matching('surf', 'beginner', 43.5732, -1.5586, 10);

        expect(key1).not.toBe(key2);
      });
    });

    describe('CacheKeys.profile', () => {
      it('should return userId as profile cache key', () => {
        const key = CacheKeys.profile('user123');
        expect(key).toBe('user123');
      });
    });

    describe('CacheKeys.availabilities', () => {
      it('should generate availability cache keys using grid cells', () => {
        const key = CacheKeys.availabilities('surf', 'beginner', 43.4832, -1.5586, 10);
        // New format: sport:level:cellId:radius (cellId format: gLAT:LNG)
        expect(key).toMatch(/^surf:beginner:g43\.\d+:-1\.\d+:10$/);
      });

      it('should generate same key for nearby coordinates (grid stability)', () => {
        const key1 = CacheKeys.availabilities('surf', 'beginner', 43.4832, -1.5586, 10);
        const key2 = CacheKeys.availabilities('surf', 'beginner', 43.4850, -1.5590, 10);

        // Coordinates ~2km apart in same 5km cell = same key
        expect(key1).toBe(key2);
      });
    });

    describe('CacheKeys.distance', () => {
      it('should generate normalized distance cache keys', () => {
        const key1 = CacheKeys.distance(43.4832, -1.5586, 43.5000, -1.4000);
        const key2 = CacheKeys.distance(43.5000, -1.4000, 43.4832, -1.5586);

        // Should be the same regardless of order
        expect(key1).toBe(key2);
      });

      it('should generate high precision distance cache keys', () => {
        const key = CacheKeys.distance(43.4832, -1.5586, 43.5000, -1.4000);
        expect(key).toMatch(/^43483,-1559:43500,-1400$|^43500,-1400:43483,-1559$/);
      });
    });
  });

  describe('Graceful Shutdown', () => {
    it('should close Redis connection gracefully', async () => {
      mockResolveRedisUrl.mockReturnValue('redis://localhost:6379');
      mockRedisClient.connect.mockResolvedValue(undefined);
      mockRedisClient.ping.mockResolvedValue('PONG');
      mockRedisClient.quit.mockResolvedValue('OK' as any);

      await cacheServiceInstance.initialize();
      await cacheServiceInstance.close();

      expect(mockRedisClient.quit).toHaveBeenCalled();
    });

    it('should handle close when Redis is not connected', async () => {
      (cacheServiceInstance as any).client = null;

      // Should not throw
      await expect(cacheServiceInstance.close()).resolves.not.toThrow();
    });
  });
});
