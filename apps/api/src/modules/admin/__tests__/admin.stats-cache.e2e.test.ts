import request, { SuperAgentTest } from 'supertest';
import jwt from 'jsonwebtoken';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { clientPrisma as prisma } from '@blobinfini/database';

jest.mock('../../../lib/redis-client', () => ({
  getRedisClient: jest.fn(),
}));

import { createApp } from '../../../index';
import { secureLogger } from '../../../utils/secure-logger';
import { AVAILABLE_PERMISSIONS } from '../permissions';
import { getRedisClient } from '../../../lib/redis-client';
import { gdprPurgeService } from '../../../services/gdpr-purge.service';
import { ADMIN_STATS_MAIN_CACHE_KEY } from '../../../lib/admin-stats-cache';

type Role = 'RIDER' | 'ADMIN';

type MemoryRedisClient = {
  store: Map<string, string>;
  get: jest.MockedFunction<(key: string) => Promise<string | null>>;
  setEx: jest.MockedFunction<(key: string, ttl: number, value: string) => Promise<string>>;
  del: jest.MockedFunction<(key: string) => Promise<number>>;
};

const app = createApp();
const mockGetRedisClient = getRedisClient as jest.MockedFunction<typeof getRedisClient>;

const emails = {
  admin: 'stats-cache-admin@test.com',
  rider: 'stats-cache-rider@test.com',
  target: 'stats-cache-target@test.com',
  extra: 'stats-cache-extra@test.com',
};

let adminId = '';
let adminToken = '';
let riderId = '';
let targetProfileId = '';

function ensureSecrets() {
  process.env.JWT_SECRET ||= 'test-jwt-secret';
  process.env.SESSION_SECRET ||= 'test-session-secret';
  process.env.PRIMARY_ADMIN_EMAILS = emails.admin;
}

function signToken(userId: string, role: Role) {
  return jwt.sign({ sub: userId, role }, process.env.JWT_SECRET!, { expiresIn: '1h' });
}

function createMemoryRedisClient(): MemoryRedisClient {
  const store = new Map<string, string>();

  return {
    store,
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    setEx: jest.fn(async (key: string, _ttl: number, value: string) => {
      store.set(key, value);
      return 'OK';
    }),
    del: jest.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
  };
}

async function getCsrf(agent: SuperAgentTest) {
  const res = await agent.get('/csrf-token').expect(200);
  return res.body.csrfToken as string;
}

async function cleanupFixtureData() {
  await prisma.profileReport.deleteMany({
    where: {
      OR: [
        { reporter: { email: emails.rider } },
        { reportedProfile: { user: { email: { in: [emails.target, emails.extra] } } } },
      ],
    },
  });
  await prisma.session.deleteMany({
    where: { user: { email: { in: [emails.admin, emails.rider, emails.target, emails.extra] } } },
  });
  await prisma.adminProfile.deleteMany({ where: { user: { email: emails.admin } } });
  await prisma.riderProfile.deleteMany({
    where: { user: { email: { in: [emails.rider, emails.target, emails.extra] } } },
  });
  await prisma.user.deleteMany({ where: { email: { in: Object.values(emails) } } });
}

async function seedAdminStatsFixture() {
  ensureSecrets();
  await cleanupFixtureData();

  const admin = await prisma.user.create({
    data: {
      email: emails.admin,
      password: 'hash',
      role: 'ADMIN',
      emailVerified: true,
    },
  });
  adminId = admin.id;
  adminToken = signToken(admin.id, 'ADMIN');

  await prisma.adminProfile.create({
    data: {
      userId: admin.id,
      displayName: 'Stats Cache Admin',
      permissions: [...AVAILABLE_PERMISSIONS],
    },
  });

  const rider = await prisma.user.create({
    data: {
      email: emails.rider,
      password: 'hash',
      role: 'RIDER',
      emailVerified: true,
    },
  });
  riderId = rider.id;

  await prisma.riderProfile.create({
    data: {
      userId: rider.id,
      displayName: 'Stats Cache Rider',
    },
  });

  const target = await prisma.user.create({
    data: {
      email: emails.target,
      password: 'hash',
      role: 'RIDER',
      emailVerified: true,
    },
  });

  const targetProfile = await prisma.riderProfile.create({
    data: {
      userId: target.id,
      displayName: 'Stats Cache Target',
    },
  });
  targetProfileId = targetProfile.id;

  await prisma.session.create({
    data: {
      userId: rider.id,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });

  await prisma.profileReport.create({
    data: {
      reporterUserId: rider.id,
      reportedProfileId: targetProfile.id,
      reason: 'Safety',
    },
  });
}

describe('Admin stats cache e2e', () => {
  let infoSpy: jest.SpiedFunction<typeof secureLogger.info>;

  beforeEach(async () => {
    process.env.ADMIN_STATS_CACHE_ENABLED = 'true';
    process.env.ADMIN_STATS_CACHE_TTL_SECONDS = '120';
    jest.clearAllMocks();
    infoSpy = jest.spyOn(secureLogger, 'info').mockImplementation(() => undefined);
    await seedAdminStatsFixture();
  });

  afterEach(async () => {
    infoSpy.mockRestore();
    delete process.env.ADMIN_STATS_CACHE_ENABLED;
    delete process.env.ADMIN_STATS_CACHE_TTL_SECONDS;
    jest.restoreAllMocks();
    await cleanupFixtureData();
  });

  it('uses Redis cache for GET /admin/stats and stores no PII in the serialized value', async () => {
    const redisClient = createMemoryRedisClient();
    mockGetRedisClient.mockReturnValue(redisClient as any);

    const first = await request(app)
      .get('/admin/stats')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(first.body).toMatchObject({
      totalUsers: expect.any(Number),
      totalRiders: expect.any(Number),
      totalPros: expect.any(Number),
      totalAdmins: expect.any(Number),
      totalConversations: expect.any(Number),
      activeUsers: expect.any(Number),
      reportedProfiles: expect.any(Number),
    });
    expect(infoSpy).toHaveBeenCalledWith('ADMIN_STATS_CACHE_MISS', expect.objectContaining({
      key: ADMIN_STATS_MAIN_CACHE_KEY,
    }));

    const cachedRaw = redisClient.store.get(ADMIN_STATS_MAIN_CACHE_KEY);
    expect(cachedRaw).toBeDefined();
    expect(cachedRaw).not.toMatch(/@/);
    expect(cachedRaw).not.toContain(adminId);
    expect(cachedRaw).not.toContain(riderId);
    expect(cachedRaw).not.toContain('eyJ');
    expect(cachedRaw).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(JSON.parse(cachedRaw!)).toEqual(first.body);

    await prisma.user.create({
      data: {
        email: emails.extra,
        password: 'hash',
        role: 'RIDER',
        emailVerified: true,
        riderProfile: {
          create: {
            displayName: 'Extra Rider',
          },
        },
      },
    });

    const second = await request(app)
      .get('/admin/stats')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(second.body).toEqual(first.body);
    expect(infoSpy).toHaveBeenCalledWith('ADMIN_STATS_CACHE_HIT', { key: ADMIN_STATS_MAIN_CACHE_KEY });
  });

  it('ignores a valid JSON cache payload with the wrong shape and recomputes from DB', async () => {
    const redisClient = createMemoryRedisClient();
    redisClient.store.set(ADMIN_STATS_MAIN_CACHE_KEY, JSON.stringify({ totalUsers: 999, bogus: true }));
    mockGetRedisClient.mockReturnValue(redisClient as any);

    const response = await request(app)
      .get('/admin/stats')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body).toMatchObject({
      totalUsers: expect.any(Number),
      totalRiders: expect.any(Number),
      totalPros: expect.any(Number),
      totalAdmins: expect.any(Number),
      totalConversations: expect.any(Number),
      activeUsers: expect.any(Number),
      reportedProfiles: expect.any(Number),
    });
    expect(response.body.totalUsers).not.toBe(999);
    expect((response.body as Record<string, unknown>).bogus).toBeUndefined();
    expect(infoSpy).toHaveBeenCalledWith('ADMIN_STATS_CACHE_MISS', {
      key: ADMIN_STATS_MAIN_CACHE_KEY,
      reason: 'invalid_shape',
    });
    expect(redisClient.del).toHaveBeenCalledWith(ADMIN_STATS_MAIN_CACHE_KEY);
    expect(redisClient.setEx).toHaveBeenCalled();
    expect(JSON.parse(redisClient.store.get(ADMIN_STATS_MAIN_CACHE_KEY)!)).toEqual(response.body);
  });

  it('falls back to DB with Redis down and still returns 200', async () => {
    mockGetRedisClient.mockReturnValue(null);

    const first = await request(app)
      .get('/admin/stats')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    await prisma.user.create({
      data: {
        email: emails.extra,
        password: 'hash',
        role: 'RIDER',
        emailVerified: true,
        riderProfile: {
          create: {
            displayName: 'Extra Rider Fallback',
          },
        },
      },
    });

    const second = await request(app)
      .get('/admin/stats')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(second.body.totalUsers).toBe(first.body.totalUsers + 1);
    expect(infoSpy).toHaveBeenCalledWith('ADMIN_STATS_CACHE_MISS', {
      key: ADMIN_STATS_MAIN_CACHE_KEY,
      reason: 'redis_unavailable',
    });
  });

  it('bypasses Redis entirely when the kill-switch is false', async () => {
    process.env.ADMIN_STATS_CACHE_ENABLED = 'false';
    const redisClient = createMemoryRedisClient();
    redisClient.store.set(ADMIN_STATS_MAIN_CACHE_KEY, JSON.stringify({ totalUsers: 999, bogus: true }));
    mockGetRedisClient.mockReturnValue(redisClient as any);

    const response = await request(app)
      .get('/admin/stats')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body.totalUsers).not.toBe(999);
    expect((response.body as Record<string, unknown>).bogus).toBeUndefined();
    expect(redisClient.get).not.toHaveBeenCalled();
    expect(redisClient.setEx).not.toHaveBeenCalled();
    expect(redisClient.del).not.toHaveBeenCalled();
  });

  it('invalidates stats cache after GDPR purge so the next GET recomputes', async () => {
    const redisClient = createMemoryRedisClient();
    mockGetRedisClient.mockReturnValue(redisClient as any);

    const first = await request(app)
      .get('/admin/stats')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const purgeSpy = jest.spyOn(gdprPurgeService, 'performFullPurge').mockImplementation(async () => {
      await prisma.user.create({
        data: {
          email: emails.extra,
          password: 'hash',
          role: 'RIDER',
          emailVerified: true,
          riderProfile: {
            create: {
              displayName: 'Extra Rider After Purge',
            },
          },
        },
      });

      return {
        summary: 'Test purge',
        technicalData: {
          sessionsDeleted: 0,
          tokensDeleted: 0,
          oldLogsDeleted: 0,
          analyticsEventsDeleted: 0,
          analyticsDailyAggDeleted: 0,
        },
        userAnonymization: {
          phase1Anonymized: 0,
          phase2Anonymized: 0,
          phase3Purged: 0,
        },
        relationalData: {
          conversationsDeleted: 0,
          matchesDeleted: 0,
          oldSearchesDeleted: 0,
        },
      };
    });

    const agent = request.agent(app);
    const csrf = await getCsrf(agent);

    await agent
      .post('/admin/gdpr/run-purge')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-CSRF-Token', csrf)
      .send({ confirm: 'CONFIRMER_PURGE_RGPD' })
      .expect(200);

    expect(infoSpy).toHaveBeenCalledWith('ADMIN_STATS_CACHE_INVALIDATED', { key: ADMIN_STATS_MAIN_CACHE_KEY });

    const second = await request(app)
      .get('/admin/stats')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(second.body.totalUsers).toBe(first.body.totalUsers + 1);
    expect(redisClient.del).toHaveBeenCalledWith(ADMIN_STATS_MAIN_CACHE_KEY);
    purgeSpy.mockRestore();
  });
});
