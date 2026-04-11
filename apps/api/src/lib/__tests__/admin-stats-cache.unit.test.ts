import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { z } from 'zod';

jest.mock('../redis-client', () => ({
  getRedisClient: jest.fn(),
}));

jest.mock('../../utils/secure-logger', () => ({
  secureLogger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    security: jest.fn(),
  },
}));

import {
  ADMIN_STATS_MAIN_CACHE_KEY,
  getAdminStatsCache,
  getAdminStatsCacheTtlSeconds,
  invalidateAdminStatsCache,
  isAdminStatsCacheEnabled,
  setAdminStatsCache,
} from '../admin-stats-cache';
import { getRedisClient } from '../redis-client';

const mockGetRedisClient = getRedisClient as jest.MockedFunction<typeof getRedisClient>;

function createRedisClientMock() {
  return {
    get: jest.fn(async () => null),
    setEx: jest.fn(async () => 'OK'),
    del: jest.fn(async () => 1),
  };
}

describe('admin-stats-cache', () => {
  let redisClient: ReturnType<typeof createRedisClientMock>;
  const adminStatsSchema = z.object({
    totalUsers: z.number().int().nonnegative(),
    totalRiders: z.number().int().nonnegative(),
    totalPros: z.number().int().nonnegative(),
    totalAdmins: z.number().int().nonnegative(),
    totalConversations: z.number().int().nonnegative(),
    activeUsers: z.number().int().nonnegative(),
    reportedProfiles: z.number().int().nonnegative(),
  }).strict();

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.ADMIN_STATS_CACHE_ENABLED;
    delete process.env.ADMIN_STATS_CACHE_TTL_SECONDS;

    redisClient = createRedisClientMock();
    mockGetRedisClient.mockReturnValue(redisClient as any);
  });

  afterEach(() => {
    delete process.env.ADMIN_STATS_CACHE_ENABLED;
    delete process.env.ADMIN_STATS_CACHE_TTL_SECONDS;
  });

  it('returns null on cache miss', async () => {
    redisClient.get.mockResolvedValue(null);

    await expect(getAdminStatsCache(ADMIN_STATS_MAIN_CACHE_KEY)).resolves.toBeNull();
  });

  it('returns parsed JSON on cache hit', async () => {
    redisClient.get.mockResolvedValue(JSON.stringify({ totalUsers: 4 }));

    await expect(getAdminStatsCache<{ totalUsers: number }>(ADMIN_STATS_MAIN_CACHE_KEY)).resolves.toEqual({
      totalUsers: 4,
    });
  });

  it('returns null and deletes the key when JSON is invalid', async () => {
    redisClient.get.mockResolvedValue('{oops');

    await expect(getAdminStatsCache(ADMIN_STATS_MAIN_CACHE_KEY, adminStatsSchema)).resolves.toBeNull();
    expect(redisClient.del).toHaveBeenCalledWith(ADMIN_STATS_MAIN_CACHE_KEY);
  });

  it('returns null and deletes the key when JSON shape is invalid', async () => {
    redisClient.get.mockResolvedValue(JSON.stringify({ totalUsers: 999, bogus: true }));

    await expect(getAdminStatsCache(ADMIN_STATS_MAIN_CACHE_KEY, adminStatsSchema)).resolves.toBeNull();
    expect(redisClient.del).toHaveBeenCalledWith(ADMIN_STATS_MAIN_CACHE_KEY);
  });

  it('returns parsed JSON when the schema matches exactly', async () => {
    const validPayload = {
      totalUsers: 4,
      totalRiders: 2,
      totalPros: 1,
      totalAdmins: 1,
      totalConversations: 3,
      activeUsers: 2,
      reportedProfiles: 1,
    };
    redisClient.get.mockResolvedValue(JSON.stringify(validPayload));

    await expect(getAdminStatsCache(ADMIN_STATS_MAIN_CACHE_KEY, adminStatsSchema)).resolves.toEqual(validPayload);
  });

  it('returns null when Redis is unavailable', async () => {
    mockGetRedisClient.mockReturnValue(null);

    await expect(getAdminStatsCache(ADMIN_STATS_MAIN_CACHE_KEY)).resolves.toBeNull();
    await expect(setAdminStatsCache(ADMIN_STATS_MAIN_CACHE_KEY, { totalUsers: 1 }, 120)).resolves.toBeUndefined();
    await expect(invalidateAdminStatsCache(ADMIN_STATS_MAIN_CACHE_KEY)).resolves.toBeUndefined();
  });

  it('writes the key with setEx ttl', async () => {
    await setAdminStatsCache(ADMIN_STATS_MAIN_CACHE_KEY, { totalUsers: 2 }, 240);

    expect(redisClient.setEx).toHaveBeenCalledWith(
      ADMIN_STATS_MAIN_CACHE_KEY,
      240,
      JSON.stringify({ totalUsers: 2 }),
    );
  });

  it('deletes the key on invalidation', async () => {
    await invalidateAdminStatsCache(ADMIN_STATS_MAIN_CACHE_KEY);

    expect(redisClient.del).toHaveBeenCalledWith(ADMIN_STATS_MAIN_CACHE_KEY);
  });

  it('bypasses Redis completely when kill-switch is false', async () => {
    process.env.ADMIN_STATS_CACHE_ENABLED = 'false';

    expect(isAdminStatsCacheEnabled()).toBe(false);
    await expect(getAdminStatsCache(ADMIN_STATS_MAIN_CACHE_KEY)).resolves.toBeNull();
    await expect(setAdminStatsCache(ADMIN_STATS_MAIN_CACHE_KEY, { totalUsers: 2 }, 120)).resolves.toBeUndefined();
    await expect(invalidateAdminStatsCache(ADMIN_STATS_MAIN_CACHE_KEY)).resolves.toBeUndefined();

    expect(redisClient.get).not.toHaveBeenCalled();
    expect(redisClient.setEx).not.toHaveBeenCalled();
    expect(redisClient.del).not.toHaveBeenCalled();
  });

  it('never propagates Redis or serialization exceptions', async () => {
    redisClient.get.mockRejectedValue(new Error('redis down'));
    redisClient.setEx.mockRejectedValue(new Error('write failed'));
    redisClient.del.mockRejectedValue(new Error('delete failed'));

    const circular: Record<string, unknown> = {};
    circular.self = circular;

    await expect(getAdminStatsCache(ADMIN_STATS_MAIN_CACHE_KEY)).resolves.toBeNull();
    await expect(setAdminStatsCache(ADMIN_STATS_MAIN_CACHE_KEY, circular, 120)).resolves.toBeUndefined();
    await expect(invalidateAdminStatsCache(ADMIN_STATS_MAIN_CACHE_KEY)).resolves.toBeUndefined();
  });

  it('falls back to the default ttl when env ttl is invalid', () => {
    process.env.ADMIN_STATS_CACHE_TTL_SECONDS = 'nope';

    expect(getAdminStatsCacheTtlSeconds()).toBe(120);
  });
});
