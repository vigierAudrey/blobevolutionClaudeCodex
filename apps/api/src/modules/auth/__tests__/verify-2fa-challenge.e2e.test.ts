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
import { twoFactorService } from '../../../services/two-factor.service';
import { secureLogger } from '../../../utils/secure-logger';

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

  return { email, password };
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
  payload: { challengeId: string; code: string },
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

describe('Auth verify-2fa challenge flow (P1)', () => {
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

  it('challengeId invalide => 401', async () => {
    const admin = await createAdmin();
    const login = await start2FALogin(app, admin.email, admin.password, '203.0.113.10');

    expect(login.body).toMatchObject({ requires2FA: true });
    expect(login.body).toHaveProperty('challengeId');
    expect(login.body).toHaveProperty('message');
    expect(Object.keys(login.body).sort()).toEqual(['challengeId', 'message', 'requires2FA']);
    expect(login.body).not.toHaveProperty('userId');
    expect(JSON.stringify(login.body)).not.toContain(admin.email);
    expect(mockSend2FACode).toHaveBeenCalledTimes(1);

    const res = await verify2FA(
      app,
      { challengeId: randomUUID(), code: '123456' },
      '203.0.113.10',
    );

    expect(res.status).toBe(401);
  });

  it('challengeId valide mais autre IP => 403', async () => {
    const securitySpy = jest.spyOn(secureLogger, 'security').mockImplementation(() => {});
    try {
      const admin = await createAdmin();
      const login = await start2FALogin(app, admin.email, admin.password, '203.0.113.11');

      const res = await verify2FA(
        app,
        { challengeId: login.body.challengeId as string, code: '123456' },
        '203.0.113.12',
      );

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('2FA challenge IP mismatch');
      expect(securitySpy).toHaveBeenCalledWith(
        'AUTH_2FA_CHALLENGE_IP_MISMATCH',
        expect.objectContaining({ challengeId: login.body.challengeId as string }),
      );
    } finally {
      securitySpy.mockRestore();
    }
  });

  it('reuse challenge après succès => 401', async () => {
    const verifySpy = jest.spyOn(twoFactorService, 'verifyCode').mockResolvedValue({
      valid: true,
      message: 'Code valide',
    });
    try {
      const admin = await createAdmin();
      const login = await start2FALogin(app, admin.email, admin.password, '203.0.113.13');

      const code = lastSentCode();
      const first = await verify2FA(
        app,
        { challengeId: login.body.challengeId as string, code },
        '203.0.113.13',
      );

      expect(first.status).toBe(200);
      expect(first.body).toEqual({ ok: true });

      const second = await verify2FA(
        app,
        { challengeId: login.body.challengeId as string, code },
        '203.0.113.13',
      );

      expect(second.status).toBe(401);
    } finally {
      verifySpy.mockRestore();
    }
  });

  it('brute force verify-2fa => 401/429 (verifyCode + HTTP rate limit)', async () => {
    process.env.ENABLE_RATE_LIMIT_IN_TESTS = 'true';

    const admin = await createAdmin();
    const login = await start2FALogin(app, admin.email, admin.password, '203.0.113.14');
    const validCode = lastSentCode();
    const wrongCode = validCode === '000000' ? '999999' : '000000';

    const statuses: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      const res = await verify2FA(
        app,
        { challengeId: login.body.challengeId as string, code: wrongCode },
        '203.0.113.14',
      );
      statuses.push(res.status);
    }

    expect(statuses.some((status) => status === 401 || status === 429)).toBe(true);
    expect(statuses).toContain(401);
  });

  it('les reponses auth ne renvoient pas email brut', async () => {
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

  it('payload verify-2fa avec userId est rejete (schema strict)', async () => {
    const admin = await createAdmin();
    const login = await start2FALogin(app, admin.email, admin.password, '203.0.113.16');

    const res = await verify2FA(
      app,
      {
        challengeId: login.body.challengeId as string,
        code: '123456',
        // @ts-expect-error security regression guard: extra field must be rejected
        userId: randomUUID(),
      } as any,
      '203.0.113.16',
    );

    expect(res.status).toBe(400);
  });
});
