import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('../../../lib/mailer', () => ({
  sendPasswordResetEmail: jest.fn(),
  sendVerificationEmail: jest.fn().mockResolvedValue(undefined),
  send2FACode: jest.fn().mockResolvedValue({ sent: true }),
}));

jest.mock('../../../lib/auth-session-store', () => ({
  getSessionData: jest.fn(),
  invalidateSessionCache: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../../services/cache.service', () => {
  const store = new Map<string, { value: unknown; expiresAt: number }>();
  return {
    cacheService: {
      isAvailable: jest.fn().mockReturnValue(true),
      getClient: jest.fn(() => null),
      get: jest.fn(async (key: string) => {
        const entry = store.get(key);
        if (!entry) return null;
        if (entry.expiresAt <= Date.now()) {
          store.delete(key);
          return null;
        }
        return entry.value;
      }),
      set: jest.fn(async (key: string, value: unknown, ttlSeconds: number = 300) => {
        store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
        return true;
      }),
      del: jest.fn(async (key: string) => {
        store.delete(key);
        return true;
      }),
      // Typed 2FA hash methods — client_unavailable triggers memory fallback in two-factor.service
      setTwoFactorCodeHash: jest.fn(async () => ({ ok: false, reason: 'client_unavailable' })),
      getTwoFactorCodeHash: jest.fn(async () => ({ ok: false, reason: 'client_unavailable' })),
      initialize: jest.fn(async () => undefined),
      __reset: () => store.clear(),
    },
  };
});

import bcrypt from 'bcryptjs';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { createApp } from '../../../index';
import { clientPrisma as prisma } from '@blobinfini/database';
import { AVAILABLE_PERMISSIONS } from '../../admin/permissions';
import { send2FACode } from '../../../lib/mailer';
import { cacheService } from '../../../services/cache.service';

const mockSend2FACode = send2FACode as jest.MockedFunction<typeof send2FACode>;

async function getCsrf(app: ReturnType<typeof createApp>) {
  const res = await request(app).get('/csrf-token').expect(200);
  return {
    cookies: (res.headers['set-cookie'] as unknown as string[]) ?? [],
    csrfToken: res.body.csrfToken as string,
  };
}

async function createAdmin() {
  const email = `admin-2fa-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const password = 'AdminPassw0rd!!';
  const hashed = await bcrypt.hash(password, 10);

  const user = await prisma.user.create({
    data: {
      email,
      password: hashed,
      role: 'ADMIN',
      emailVerified: true,
      consentedAt: new Date(),
      consentVersion: 'v1.0.0',
    },
  });

  await prisma.adminProfile.create({
    data: {
      userId: user.id,
      permissions: [...AVAILABLE_PERMISSIONS],
      allowedIPs: [],
    },
  });

  return { email, password, userId: user.id };
}

// Admin promu directement en base (sans adminProfile) — reproduit le cas prod réel
async function createAdminWithoutProfile() {
  const email = `admin-noprofile-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const password = 'AdminPassw0rd!!';
  const hashed = await bcrypt.hash(password, 10);

  const user = await prisma.user.create({
    data: {
      email,
      password: hashed,
      role: 'ADMIN',
      emailVerified: true,
      consentedAt: new Date(),
      consentVersion: 'v1.0.0',
    },
  });

  return { email, password, userId: user.id };
}

async function start2FALogin(app: ReturnType<typeof createApp>, email: string, password: string, ip: string) {
  const { cookies, csrfToken } = await getCsrf(app);
  return request(app)
    .post('/auth/login')
    .set('Cookie', cookies)
    .set('X-CSRF-Token', csrfToken)
    .set('X-Forwarded-For', ip)
    .send({ email, password })
    .expect(200);
}

async function verify2FA(
  app: ReturnType<typeof createApp>,
  payload: { challengeId: string; code: string } | Record<string, unknown>,
  ip: string,
) {
  const { cookies, csrfToken } = await getCsrf(app);
  return request(app)
    .post('/auth/verify-2fa')
    .set('Cookie', cookies)
    .set('X-CSRF-Token', csrfToken)
    .set('X-Forwarded-For', ip)
    .send(payload);
}

function lastSentCode(): string {
  const call = mockSend2FACode.mock.calls.at(-1);
  const code = call?.[1];
  if (!code || typeof code !== 'string') {
    throw new Error('2FA code was not sent');
  }
  return code;
}

function readCookie(setCookies: string[], cookieName: string): string {
  return setCookies.find((cookie) => cookie.startsWith(`${cookieName}=`)) || '';
}

describe('Auth verify-2fa flow', () => {
  const originalEnv = { ...process.env };
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    process.env.AUTH_REQUIRE_VERIFIED = 'false';
    process.env.AUTH_REQUIRE_2FA = 'true';
    process.env.TRUST_PROXY_MODE = 'true';
    process.env.ADMIN_ENFORCE_ALLOWED_IPS = 'false';
    process.env.ENABLE_RATE_LIMIT_IN_TESTS = 'false';
    process.env.JWT_SECRET = 'j'.repeat(64);
    process.env.JWT_REFRESH_SECRET = 'r'.repeat(64);
    process.env.SESSION_SECRET = 's'.repeat(64);
    process.env.TWO_FACTOR_SECRET = 't'.repeat(64);
    process.env.IP_HASH_SECRET = 'i'.repeat(64);

    app = createApp();
    jest.clearAllMocks();
    (cacheService as any).__reset?.();
  });

  afterEach(async () => {
    process.env = { ...originalEnv };
    await prisma.refreshToken.deleteMany();
    await prisma.adminProfile.deleteMany();
    await prisma.loginAttempt.deleteMany();
    await prisma.user.deleteMany();
  });

  it('retourne challengeId sans exposer userId ni email brut', async () => {
    const admin = await createAdmin();
    const login = await start2FALogin(app, admin.email, admin.password, '203.0.113.10');

    expect(login.body).toMatchObject({ requires2FA: true, challengeId: expect.any(String) });
    expect(login.body).toHaveProperty('message');
    expect(login.body).not.toHaveProperty('userId');
    expect(JSON.stringify(login.body)).not.toContain(admin.email);
    expect(mockSend2FACode).toHaveBeenCalledTimes(1);
  });

  it('challengeId invalide => 401', async () => {
    const admin = await createAdmin();
    await start2FALogin(app, admin.email, admin.password, '203.0.113.11');

    const res = await verify2FA(
      app,
      { challengeId: randomUUID(), code: '123456' },
      '203.0.113.11',
    );

    expect(res.status).toBe(401);
  });

  it('verification reussie => cookies httpOnly puis code non reutilisable', async () => {
    const admin = await createAdmin();
    const login = await start2FALogin(app, admin.email, admin.password, '203.0.113.12');
    const code = lastSentCode();

    const first = await verify2FA(
      app,
      { challengeId: login.body.challengeId as string, code },
      '203.0.113.12',
    );

    expect(first.status).toBe(200);
    expect(first.body).toEqual({ ok: true });
    const setCookies = (first.headers['set-cookie'] as unknown as string[]) ?? [];
    expect(readCookie(setCookies, 'accessToken')).toContain('HttpOnly');
    expect(readCookie(setCookies, 'refreshToken')).toContain('Path=/auth/refresh');

    const second = await verify2FA(
      app,
      { challengeId: login.body.challengeId as string, code },
      '203.0.113.12',
    );

    expect(second.status).toBe(401);
  });

  it('payload avec userId direct est rejete (Gate C.3)', async () => {
    const admin = await createAdmin();
    await start2FALogin(app, admin.email, admin.password, '203.0.113.13');

    const res = await verify2FA(
      app,
      { userId: admin.userId, code: '123456' },
      '203.0.113.13',
    );

    expect(res.status).toBe(400);
  });

  it('echec login ne renvoie pas email brut', async () => {
    const admin = await createAdmin();
    const { cookies, csrfToken } = await getCsrf(app);

    const res = await request(app)
      .post('/auth/login')
      .set('Cookie', cookies)
      .set('X-CSRF-Token', csrfToken)
      .set('X-Forwarded-For', '203.0.113.15')
      .send({ email: admin.email, password: 'WrongPassw0rd!' })
      .expect(401);

    expect(JSON.stringify(res.body)).not.toContain(admin.email);
  });

  // H2: adminProfile absent => doit retourner 200, jamais 500
  it('admin sans adminProfile (promu en base) => verify-2fa reussie sans 500', async () => {
    const admin = await createAdminWithoutProfile();
    const login = await start2FALogin(app, admin.email, admin.password, '203.0.113.20');
    expect(login.status).toBe(200);
    expect(login.body).toMatchObject({ requires2FA: true, challengeId: expect.any(String) });

    const code = lastSentCode();
    const res = await verify2FA(
      app,
      { challengeId: login.body.challengeId as string, code },
      '203.0.113.20',
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    // adminProfile doit avoir été créé par upsert
    const profile = await prisma.adminProfile.findUnique({ where: { userId: admin.userId } });
    expect(profile).not.toBeNull();
    expect(profile?.lastLoginAt).not.toBeNull();
  });

  // H1: code invalide => 401, jamais 500
  it('code invalide => 401 propre, pas 500', async () => {
    const admin = await createAdmin();
    const login = await start2FALogin(app, admin.email, admin.password, '203.0.113.21');

    const res = await verify2FA(
      app,
      { challengeId: login.body.challengeId as string, code: '000000' },
      '203.0.113.21',
    );

    expect(res.status).toBe(401);
    // Aucune fuite de détails internes (stack trace, code Prisma, etc.)
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/stack|P2025|PrismaClient|at Object\.|at async/i);
  });

  // Session 2FA absente => 401 propre
  it('session 2FA absente (challengeId inconnu) => 401 propre', async () => {
    const res = await verify2FA(
      app,
      { challengeId: randomUUID(), code: '123456' },
      '203.0.113.22',
    );

    expect(res.status).toBe(401);
  });

  // Payload invalide => 400 propre (strict schema)
  it('payload sans challengeId => 400 propre', async () => {
    const { cookies, csrfToken } = await getCsrf(app);
    const res = await request(app)
      .post('/auth/verify-2fa')
      .set('Cookie', cookies)
      .set('X-CSRF-Token', csrfToken)
      .send({ code: '123456' });

    expect(res.status).toBe(400);
  });

  it('verify-2fa reste limité par son limiter spécialisé avec Retry-After', async () => {
    const previousFlag = process.env.ENABLE_RATE_LIMIT_IN_TESTS;
    process.env.ENABLE_RATE_LIMIT_IN_TESTS = 'true';
    const invalidCode = String(Date.now()).slice(-6).padStart(6, '0');

    try {
      for (let i = 0; i < 10; i += 1) {
        const res = await verify2FA(
          app,
          { challengeId: randomUUID(), code: invalidCode },
          '203.0.113.200',
        );
        expect(res.status).toBe(401);
      }

      const blocked = await verify2FA(
        app,
        { challengeId: randomUUID(), code: invalidCode },
        '203.0.113.200',
      );

      expect(blocked.status).toBe(429);
      expect(blocked.body.error).toBe('TOO_MANY_2FA_ATTEMPTS');
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

  // Pas de session admin complète avant 2FA validée
  it('cookies admin_session absents tant que 2FA non validée', async () => {
    const admin = await createAdmin();
    const login = await start2FALogin(app, admin.email, admin.password, '203.0.113.23');
    // Après login initial (2FA requis), pas de cookies d'accès admin
    const loginCookies = (login.headers['set-cookie'] as unknown as string[]) ?? [];
    expect(loginCookies.find((c) => c.startsWith('accessToken='))).toBeUndefined();
    expect(loginCookies.find((c) => c.startsWith('admin_session='))).toBeUndefined();
  });

  // Aucun code/token/secret dans les réponses
  it('la réponse verify-2fa reussie n expose ni token ni code', async () => {
    const admin = await createAdmin();
    const login = await start2FALogin(app, admin.email, admin.password, '203.0.113.24');
    const code = lastSentCode();

    const res = await verify2FA(
      app,
      { challengeId: login.body.challengeId as string, code },
      '203.0.113.24',
    );

    expect(res.status).toBe(200);
    const body = JSON.stringify(res.body);
    // Aucune valeur sensible dans le body JSON
    expect(body).not.toMatch(/password|hash|token|secret|code/i);
  });
});
