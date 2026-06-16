import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { createApp } from '../../../index';
import { clientPrisma as prisma, Role } from '@blobinfini/database';
import { cacheService } from '../../../services/cache.service';
import { twoFactorService } from '../../../services/two-factor.service';
import { gdprPurgeService } from '../../../services/gdpr-purge.service';
import {
  createTestSession,
  getAccessToken,
  getOrCreateUserByEmail,
  readCookieValue,
  TEST_PASSWORD,
  type TestSession,
} from '../../../tests/helpers/auth';

const redisMock = (globalThis as typeof globalThis & {
  __REDIS_MOCK__?: {
    createClient: jest.Mock;
    instances: any[];
  };
}).__REDIS_MOCK__;

process.env.AUTH_REQUIRE_2FA = 'false';
process.env.AUTH_REQUIRE_VERIFIED = 'false';
process.env.ADMIN_REQUIRE_STEP_UP = 'true';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379/15';
process.env.REDIS_PASSWORD = '';

const appA = createApp();
const appB = createApp();

type RedisTestClient = {
  sendCommand: (args: string[]) => Promise<unknown>;
};

type StatefulRedisClient = RedisTestClient & {
  connect: jest.Mock<Promise<void>, []>;
  quit: jest.Mock<Promise<void>, []>;
  on: jest.Mock;
  ping: jest.Mock<Promise<string>, []>;
  get: jest.Mock<Promise<string | null>, [string]>;
  setEx: jest.Mock<Promise<'OK'>, [string, number, string]>;
  del: jest.Mock<Promise<number>, [string]>;
  sAdd: jest.Mock<Promise<number>, [string, string]>;
  sMembers: jest.Mock<Promise<string[]>, [string]>;
  expire: jest.Mock<Promise<number>, [string, number]>;
};

type LoggedAdmin = {
  accessToken: string;
  refreshToken: string;
  userId: string;
  session: TestSession;
};

function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
}

function uniqueAlertType(prefix: string): string {
  return `test:admin-step-up:${prefix}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

function createStatefulRedisClient(): StatefulRedisClient {
  const values = new Map<string, string>();
  const expirations = new Map<string, number>();
  const sets = new Map<string, Set<string>>();

  const cleanupExpired = () => {
    const now = Date.now();
    for (const [key, expiresAt] of expirations.entries()) {
      if (expiresAt > now) {
        continue;
      }
      expirations.delete(key);
      values.delete(key);
      sets.delete(key);
    }
  };

  const setExpiry = (key: string, ttlSeconds: number) => {
    expirations.set(key, Date.now() + (ttlSeconds * 1000));
  };

  const deleteKeys = (...keys: string[]) => {
    let deleted = 0;
    for (const key of keys) {
      const existed = values.delete(key) || sets.delete(key) || expirations.delete(key);
      if (existed) {
        deleted += 1;
      }
    }
    return deleted;
  };

  const client = {
    connect: jest.fn(async () => undefined),
    quit: jest.fn(async () => undefined),
    on: jest.fn(),
    ping: jest.fn(async () => 'PONG'),
    get: jest.fn(async (key: string) => {
      cleanupExpired();
      return values.get(key) ?? null;
    }),
    setEx: jest.fn(async (key: string, ttlSeconds: number, value: string) => {
      values.set(key, value);
      sets.delete(key);
      setExpiry(key, ttlSeconds);
      return 'OK' as const;
    }),
    del: jest.fn(async (key: string) => {
      cleanupExpired();
      return deleteKeys(key);
    }),
    sAdd: jest.fn(async (key: string, member: string) => {
      cleanupExpired();
      const current = sets.get(key) ?? new Set<string>();
      current.add(member);
      sets.set(key, current);
      values.delete(key);
      return 1;
    }),
    sMembers: jest.fn(async (key: string) => {
      cleanupExpired();
      return Array.from(sets.get(key) ?? []);
    }),
    expire: jest.fn(async (key: string, ttlSeconds: number) => {
      cleanupExpired();
      if (!values.has(key) && !sets.has(key)) {
        return 0;
      }
      setExpiry(key, ttlSeconds);
      return 1;
    }),
    sendCommand: jest.fn(async (args: string[]) => {
      cleanupExpired();
      const [command, ...rest] = args;
      switch (command?.toUpperCase()) {
        case 'FLUSHDB':
          values.clear();
          expirations.clear();
          sets.clear();
          return 'OK';
        case 'SADD':
          return client.sAdd(rest[0] ?? '', rest[1] ?? '');
        case 'SMEMBERS':
          return client.sMembers(rest[0] ?? '');
        case 'EXPIRE':
          return client.expire(rest[0] ?? '', Number(rest[1] ?? '0'));
        case 'DEL':
          return deleteKeys(...rest);
        case 'GET':
          return values.get(rest[0] ?? '') ?? null;
        case 'KEYS': {
          const pattern = rest[0] ?? '*';
          if (pattern === '*') {
            return Array.from(new Set([...values.keys(), ...sets.keys()]));
          }
          const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
          const regex = new RegExp(`^${escaped}$`);
          return Array.from(new Set([...values.keys(), ...sets.keys()])).filter((key) => regex.test(key));
        }
        default:
          return null;
      }
    }),
  } satisfies StatefulRedisClient;

  return client;
}

async function cleanupUser(email: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return;
  }

  await prisma.systemAlert.deleteMany({ where: { createdById: user.id } });
  await prisma.auditLog.deleteMany({ where: { userId: user.id } });
  await prisma.refreshToken.deleteMany({ where: { userId: user.id } });
  await prisma.session.deleteMany({ where: { userId: user.id } });
  await prisma.passwordResetToken.deleteMany({ where: { userId: user.id } });
  await prisma.emailVerificationToken.deleteMany({ where: { userId: user.id } });
  await prisma.loginAttempt.deleteMany({ where: { userId: user.id } });
  await prisma.adminProfile.deleteMany({ where: { userId: user.id } });
  await prisma.proProfile.deleteMany({ where: { userId: user.id } });
  await prisma.riderProfile.deleteMany({ where: { userId: user.id } });
  await prisma.user.delete({ where: { id: user.id } });
}

function getRedisClientOrThrow(): RedisTestClient {
  const redisClient = cacheService.getClient() as RedisTestClient | null;
  if (!redisClient) {
    throw new Error('Redis is required for admin step-up hostile tests');
  }
  return redisClient;
}

async function flushSecurityRedis(): Promise<void> {
  await getRedisClientOrThrow().sendCommand(['FLUSHDB']);
}

async function loginAdmin(app: ReturnType<typeof createApp>, email: string, session?: TestSession): Promise<LoggedAdmin> {
  await getOrCreateUserByEmail({
    email,
    password: TEST_PASSWORD,
    role: Role.ADMIN,
    emailVerified: true,
  });

  return getAccessToken({
    app,
    email,
    password: TEST_PASSWORD,
    role: Role.ADMIN,
    session,
  });
}

async function createRiderTarget(prefix: string, emailsToCleanup: Set<string>): Promise<string> {
  const email = uniqueEmail(prefix);
  emailsToCleanup.add(email);
  const user = await getOrCreateUserByEmail({
    email,
    password: TEST_PASSWORD,
    role: Role.RIDER,
    emailVerified: true,
  });
  return user.id;
}

async function createProTarget(
  prefix: string,
  emailsToCleanup: Set<string>,
  location: { lat: number | null; lng: number | null } = { lat: 43.5, lng: -1.5 },
): Promise<string> {
  const email = uniqueEmail(prefix);
  emailsToCleanup.add(email);
  const user = await getOrCreateUserByEmail({
    email,
    password: TEST_PASSWORD,
    role: Role.PRO,
    emailVerified: true,
  });
  await prisma.proProfile.create({
    data: {
      userId: user.id,
      businessName: 'Step-up Pro',
      lat: location.lat,
      lng: location.lng,
      verified: false,
    },
  });
  return user.id;
}

async function grantAdminStepUp(auth: LoggedAdmin): Promise<void> {
  const response = await auth.session
    .post('/auth/step-up')
    .set('Authorization', `Bearer ${auth.accessToken}`)
    .send({ intent: 'verify', code: '123456' })
    .expect(200);

  expect(response.body.stepUpUntil).toEqual(expect.any(Number));
}

function postSensitiveAdminRoute(auth: LoggedAdmin, targetUserId: string, accessToken = auth.accessToken) {
  return auth.session
    .patch(`/admin/users/${targetUserId}/suspend`)
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ suspended: true });
}

function patchVerifyProRoute(
  auth: Pick<LoggedAdmin, 'accessToken' | 'session'>,
  targetUserId: string,
  verified = true,
  accessToken = auth.accessToken,
) {
  return auth.session
    .patch(`/admin/pros/${targetUserId}/verify`)
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ verified });
}

describe('Admin step-up session-bound hostile hardening', () => {
  const emailsToCleanup = new Set<string>();

  beforeAll(async () => {
    if (!redisMock) {
      throw new Error('Global redis mock is required for admin step-up tests');
    }
    redisMock.createClient.mockImplementation(() => {
      const client = createStatefulRedisClient();
      redisMock.instances.push(client);
      return client;
    });
    await cacheService.initialize();
    await flushSecurityRedis();
  });

  beforeEach(async () => {
    await flushSecurityRedis();
    jest.spyOn(twoFactorService, 'verifyCode').mockResolvedValue({
      valid: true,
      message: 'Code valide',
    });
    jest.spyOn(gdprPurgeService, 'performFullPurge').mockResolvedValue({
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
    });
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await flushSecurityRedis();

    for (const email of emailsToCleanup) {
      await cleanupUser(email);
    }
    emailsToCleanup.clear();
  });

  afterAll(async () => {
    await flushSecurityRedis();
    await prisma.$disconnect();
  });

  it('session A grant -> session A action sensible OK; session B -> refus', async () => {
    const email = uniqueEmail('admin-step-up-session');
    emailsToCleanup.add(email);

    const authA = await loginAdmin(appA, email);
    const authB = await loginAdmin(appB, email);
    const targetUserId = await createRiderTarget('admin-step-up-target-session', emailsToCleanup);

    await grantAdminStepUp(authA);
    await postSensitiveAdminRoute(authA, targetUserId).expect(200);

    const denied = await postSensitiveAdminRoute(authB, targetUserId).expect(403);
    expect(denied.body.error).toBe('Step-up authentication required');
  });

  it('token A grant -> token B via refresh -> action sensible refusée', async () => {
    const email = uniqueEmail('admin-step-up-refresh');
    emailsToCleanup.add(email);

    const auth = await loginAdmin(appA, email);
    const targetUserId = await createRiderTarget('admin-step-up-target-refresh', emailsToCleanup);
    await grantAdminStepUp(auth);

    const refreshed = await auth.session
      .post('/auth/refresh')
      .send({ refreshToken: auth.refreshToken })
      .expect(200);

    const refreshedAccessToken = readCookieValue(
      ((refreshed.headers['set-cookie'] as string[] | undefined) ?? []),
      'accessToken',
    );

    const denied = await postSensitiveAdminRoute(auth, targetUserId, refreshedAccessToken).expect(403);
    expect(denied.body.error).toBe('Step-up authentication required');
  });

  it('relogin après grant -> ancienne preuve refusée', async () => {
    const email = uniqueEmail('admin-step-up-relogin');
    emailsToCleanup.add(email);

    const auth = await loginAdmin(appA, email);
    const targetUserId = await createRiderTarget('admin-step-up-target-relogin', emailsToCleanup);
    await grantAdminStepUp(auth);

    const relogin = await auth.session
      .post('/auth/login')
      .send({ email, password: TEST_PASSWORD, consentAccepted: true })
      .expect(200);

    const reloginAccessToken = readCookieValue(
      ((relogin.headers['set-cookie'] as string[] | undefined) ?? []),
      'accessToken',
    );

    const denied = await postSensitiveAdminRoute(auth, targetUserId, reloginAccessToken).expect(403);
    expect(denied.body.error).toBe('Step-up authentication required');
  });

  it('logoutAll après grant -> ancienne preuve refusée après relogin', async () => {
    const email = uniqueEmail('admin-step-up-logout-all');
    emailsToCleanup.add(email);

    const auth = await loginAdmin(appA, email);
    const targetUserId = await createRiderTarget('admin-step-up-target-logout-all', emailsToCleanup);
    await grantAdminStepUp(auth);

    await auth.session
      .post('/auth/logout')
      .set('Authorization', `Bearer ${auth.accessToken}`)
      .send({ allDevices: true })
      .expect(200);

    const relogin = await auth.session
      .post('/auth/login')
      .send({ email, password: TEST_PASSWORD, consentAccepted: true })
      .expect(200);

    const reloginAccessToken = readCookieValue(
      ((relogin.headers['set-cookie'] as string[] | undefined) ?? []),
      'accessToken',
    );

    const denied = await postSensitiveAdminRoute(auth, targetUserId, reloginAccessToken).expect(403);
    expect(denied.body.error).toBe('Step-up authentication required');
  });

  it('Redis down avant grant -> fail-closed', async () => {
    const email = uniqueEmail('admin-step-up-grant-down');
    emailsToCleanup.add(email);

    const auth = await loginAdmin(appA, email);
    const getClientSpy = jest.spyOn(cacheService, 'getClient').mockReturnValue(null);

    const denied = await auth.session
      .post('/auth/step-up')
      .set('Authorization', `Bearer ${auth.accessToken}`)
      .send({ intent: 'verify', code: '123456' })
      .expect(503);

    expect(denied.body.error).toBe('Admin step-up unavailable');
    getClientSpy.mockRestore();
  });

  it('Redis down avant check -> fail-closed', async () => {
    const email = uniqueEmail('admin-step-up-check-down');
    emailsToCleanup.add(email);

    const auth = await loginAdmin(appA, email);
    await grantAdminStepUp(auth);
    const targetUserId = await createRiderTarget('admin-step-up-target-check-down', emailsToCleanup);

    const getClientSpy = jest.spyOn(cacheService, 'getClient').mockReturnValue(null);

    const denied = await postSensitiveAdminRoute(auth, targetUserId).expect(503);
    expect(denied.body.error).toBe('Admin step-up unavailable');

    getClientSpy.mockRestore();
  });

  it('route admin sensible sans preuve -> refus', async () => {
    const email = uniqueEmail('admin-step-up-no-proof');
    emailsToCleanup.add(email);

    const auth = await loginAdmin(appA, email);
    const targetUserId = await createRiderTarget('admin-step-up-target-no-proof', emailsToCleanup);

    const denied = await postSensitiveAdminRoute(auth, targetUserId).expect(403);
    expect(denied.body.error).toBe('Step-up authentication required');
  });

  it('non-admin ne peut pas utiliser le step-up admin', async () => {
    const email = uniqueEmail('admin-step-up-non-admin');
    emailsToCleanup.add(email);

    const riderAuth = await getAccessToken({
      app: appA,
      email,
      password: TEST_PASSWORD,
      role: Role.RIDER,
    });

    const denied = await riderAuth.session
      .post('/auth/step-up')
      .set('Authorization', `Bearer ${riderAuth.accessToken}`)
      .send({ intent: 'send' })
      .expect(403);

    expect(denied.body.error).toBe('Forbidden');
  });

  it('step-up admin reste limité par son limiter dédié avec Retry-After', async () => {
    const previousFlag = process.env.ENABLE_RATE_LIMIT_IN_TESTS;
    process.env.ENABLE_RATE_LIMIT_IN_TESTS = 'true';

    const email = uniqueEmail('admin-step-up-dedicated-limit');
    emailsToCleanup.add(email);
    const auth = await loginAdmin(appA, email);

    try {
      for (let i = 0; i < 5; i += 1) {
        await grantAdminStepUp(auth);
      }

      const blocked = await auth.session
        .post('/auth/step-up')
        .set('Authorization', `Bearer ${auth.accessToken}`)
        .send({ intent: 'verify', code: TEST_PASSWORD.replace(/\D/g, '').padEnd(6, '0').slice(0, 6) })
        .expect(429);

      expect(blocked.body.error).toBe('AUTH_RATE_LIMIT_EXCEEDED');
      expect(blocked.headers['retry-after']).toBeDefined();
      expect(JSON.stringify(blocked.body)).not.toMatch(/token|secret/i);
    } finally {
      if (previousFlag === undefined) {
        delete process.env.ENABLE_RATE_LIMIT_IN_TESTS;
      } else {
        process.env.ENABLE_RATE_LIMIT_IN_TESTS = previousFlag;
      }
    }
  });

  it('validation pro exige une step-up puis ne modifie pas emailVerified', async () => {
    const email = uniqueEmail('admin-step-up-pro-verify');
    emailsToCleanup.add(email);

    const auth = await loginAdmin(appA, email);
    const targetUserId = await createProTarget('admin-step-up-pro-target', emailsToCleanup);

    const denied = await patchVerifyProRoute(auth, targetUserId).expect(403);
    expect(denied.body.error).toBe('Step-up authentication required');

    await grantAdminStepUp(auth);
    const verified = await patchVerifyProRoute(auth, targetUserId).expect(200);
    expect(verified.body).toMatchObject({ verified: true });

    const user = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { emailVerified: true, proProfile: { select: { verified: true, verifiedAt: true } } },
    });
    expect(user?.emailVerified).toBe(true);
    expect(user?.proProfile?.verified).toBe(true);
    expect(user?.proProfile?.verifiedAt).toBeTruthy();
  });

  it('validation pro refuse rider, pro, anonyme et profil incohérent', async () => {
    const adminEmail = uniqueEmail('admin-step-up-pro-authz');
    const riderEmail = uniqueEmail('admin-step-up-rider-authz');
    const proEmail = uniqueEmail('admin-step-up-pro-authz-user');
    emailsToCleanup.add(adminEmail);
    emailsToCleanup.add(riderEmail);
    emailsToCleanup.add(proEmail);

    const adminAuth = await loginAdmin(appA, adminEmail);
    const targetUserId = await createProTarget('admin-step-up-pro-authz-target', emailsToCleanup);
    const riderAuth = await getAccessToken({
      app: appA,
      email: riderEmail,
      password: TEST_PASSWORD,
      role: Role.RIDER,
      emailVerified: true,
    });
    const proAuth = await getAccessToken({
      app: appA,
      email: proEmail,
      password: TEST_PASSWORD,
      role: Role.PRO,
      emailVerified: true,
    });

    await patchVerifyProRoute(riderAuth, targetUserId).expect(403);
    await patchVerifyProRoute(proAuth, targetUserId).expect(403);

    const anonymous = await createTestSession(appA);
    await anonymous
      .patch(`/admin/pros/${targetUserId}/verify`)
      .send({ verified: true })
      .expect(401);

    const incoherentUserId = await createRiderTarget('admin-step-up-incoherent-target', emailsToCleanup);
    await prisma.proProfile.create({
      data: {
        userId: incoherentUserId,
        businessName: 'Incoherent Rider ProProfile',
        lat: 43.5,
        lng: -1.5,
      },
    });

    await grantAdminStepUp(adminAuth);
    const rejected = await patchVerifyProRoute(adminAuth, incoherentUserId).expect(400);
    expect(rejected.body.error).toBe('Invalid pro account');
  });

  it('validation pro avec step-up refuse un profil sans géolocalisation', async () => {
    const email = uniqueEmail('admin-step-up-pro-location');
    emailsToCleanup.add(email);

    const auth = await loginAdmin(appA, email);
    const targetUserId = await createProTarget('admin-step-up-pro-no-location', emailsToCleanup, { lat: null, lng: null });

    await grantAdminStepUp(auth);
    const rejected = await patchVerifyProRoute(auth, targetUserId).expect(400);
    expect(rejected.body.error).toBe('Missing pro location');
    expect(rejected.body.message).toBe('La géolocalisation est requise pour rendre un profil pro visible.');
  });

  it('route admin moins sensible sans preuve -> comportement documenté', async () => {
    const email = uniqueEmail('admin-step-up-alerts');
    emailsToCleanup.add(email);

    const auth = await loginAdmin(appA, email);
    const alertType = uniqueAlertType('less-sensitive');

    const created = await auth.session
      .post('/admin/alerts')
      .set('Authorization', `Bearer ${auth.accessToken}`)
      .send({
        type: alertType,
        message: 'Alerte opérationnelle de test',
        severity: 'INFO',
      })
      .expect(201);

    expect(created.body.type).toBe(alertType);
  });

  it('reruns stables des scénarios critiques', async () => {
    for (const run of [1, 2]) {
      const email = uniqueEmail(`admin-step-up-rerun-${run}`);
      emailsToCleanup.add(email);

      const authA = await loginAdmin(appA, email);
      const authB = await loginAdmin(appB, email);
      const targetUserId = await createRiderTarget(`admin-step-up-target-rerun-${run}`, emailsToCleanup);

      await grantAdminStepUp(authA);
      await postSensitiveAdminRoute(authA, targetUserId).expect(200);

      const denied = await postSensitiveAdminRoute(authB, targetUserId).expect(403);
      expect(denied.body.error).toBe('Step-up authentication required');
    }
  });
});
