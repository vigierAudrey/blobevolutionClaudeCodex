import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

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
        store.set(key, { value, expiresAt: Date.now() + (ttlSeconds * 1000) });
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

import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../../../index';
import { clientPrisma as prisma } from '@blobinfini/database';
import { AVAILABLE_PERMISSIONS } from '../../admin/permissions';
import { getSessionData } from '../../../lib/auth-session-store';
import { cacheService } from '../../../services/cache.service';
import { twoFactorService } from '../../../services/two-factor.service';
import { ADMIN_STEP_UP_TTL_SECONDS } from '../../admin/admin.security-guard';

const mockGetSessionData = getSessionData as jest.MockedFunction<typeof getSessionData>;

async function getCsrf(app: ReturnType<typeof createApp>) {
  const res = await request(app).get('/csrf-token').expect(200);
  return {
    cookies: (res.headers['set-cookie'] as unknown as string[]) ?? [],
    csrfToken: res.body.csrfToken as string,
  };
}

async function createAdmin(opts?: { allowedIPs?: string[]; permissions?: string[] }) {
  const email = `admin-hardening-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
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
      permissions: opts?.permissions ?? [...AVAILABLE_PERMISSIONS],
      allowedIPs: opts?.allowedIPs ?? [],
    },
  });

  return { user, email, password };
}

async function loginAdmin(app: ReturnType<typeof createApp>, email: string, password: string) {
  const { cookies, csrfToken } = await getCsrf(app);
  const res = await request(app)
    .post('/auth/login')
    .set('Cookie', cookies)
    .set('X-CSRF-Token', csrfToken)
    .send({ email, password })
    .expect(200);

  return (res.headers['set-cookie'] as unknown as string[]) ?? [];
}

describe('Admin stolen-session hardening', () => {
  const originalEnv = { ...process.env };
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    process.env.AUTH_REQUIRE_VERIFIED = 'false';
    process.env.AUTH_REQUIRE_2FA = 'false';
    process.env.ADMIN_ENFORCE_ALLOWED_IPS = 'true';
    process.env.ADMIN_REQUIRE_STEP_UP = 'true';

    app = createApp();
    mockGetSessionData.mockResolvedValue({ version: 1, deletedAt: null });
    (cacheService as any).__reset?.();
    jest.spyOn(twoFactorService, 'verifyCode').mockResolvedValue({ valid: true, message: 'Code valide' });
  });

  afterEach(async () => {
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
    await prisma.refreshToken.deleteMany();
    await prisma.adminProfile.deleteMany();
    await prisma.user.deleteMany();
  });

  it('admin hors IP whitelist => 403 sur /admin/users', async () => {
    const actor = await createAdmin({ allowedIPs: ['203.0.113.8'] });
    const authCookies = await loginAdmin(app, actor.email, actor.password);

    const res = await request(app)
      .get('/admin/users')
      .set('Cookie', authCookies)
      .expect(403);

    expect(res.body.error).toBe('IP non autorisée');
  });

  it('admin hors IP whitelist => 403 sur /auth/refresh', async () => {
    const actor = await createAdmin({ allowedIPs: ['203.0.113.8'] });
    const authCookies = await loginAdmin(app, actor.email, actor.password);
    const { cookies: csrfCookies, csrfToken } = await getCsrf(app);

    const res = await request(app)
      .post('/auth/refresh')
      .set('Cookie', [...authCookies, ...csrfCookies])
      .set('X-CSRF-Token', csrfToken)
      .expect(403);

    expect(res.body.error).toBe('IP non autorisée');
  });

  it('action destructive sans step-up => 403', async () => {
    const actor = await createAdmin();
    const target = await createAdmin();
    const authCookies = await loginAdmin(app, actor.email, actor.password);
    const { cookies: csrfCookies, csrfToken } = await getCsrf(app);

    const res = await request(app)
      .patch(`/admin/admins/${target.user.id}/permissions`)
      .set('Cookie', [...authCookies, ...csrfCookies])
      .set('X-CSRF-Token', csrfToken)
      .send({ permissions: ['users.view'] })
      .expect(403);

    expect(res.body.error).toBe('Step-up authentication required');
  });

  it('apres step-up => 200 sur action destructive', async () => {
    const actor = await createAdmin();
    const target = await createAdmin();
    const authCookies = await loginAdmin(app, actor.email, actor.password);

    const stepUpCsrf = await getCsrf(app);
    await request(app)
      .post('/auth/step-up')
      .set('Cookie', [...authCookies, ...stepUpCsrf.cookies])
      .set('X-CSRF-Token', stepUpCsrf.csrfToken)
      .send({ intent: 'verify', code: '123456' })
      .expect(200);

    const actionCsrf = await getCsrf(app);
    await request(app)
      .patch(`/admin/admins/${target.user.id}/permissions`)
      .set('Cookie', [...authCookies, ...actionCsrf.cookies])
      .set('X-CSRF-Token', actionCsrf.csrfToken)
      .send({ permissions: ['users.view'] })
      .expect(200);
  });

  it('apres expiration TTL => 403', async () => {
    const actor = await createAdmin();
    const target = await createAdmin();
    const authCookies = await loginAdmin(app, actor.email, actor.password);

    const nowSpy = jest.spyOn(Date, 'now');
    const baseNow = 1_700_000_000_000;
    nowSpy.mockReturnValue(baseNow);

    const stepUpCsrf = await getCsrf(app);
    await request(app)
      .post('/auth/step-up')
      .set('Cookie', [...authCookies, ...stepUpCsrf.cookies])
      .set('X-CSRF-Token', stepUpCsrf.csrfToken)
      .send({ intent: 'verify', code: '123456' })
      .expect(200);

    nowSpy.mockReturnValue(baseNow + (ADMIN_STEP_UP_TTL_SECONDS * 1000) + 1_000);

    const actionCsrf = await getCsrf(app);
    const res = await request(app)
      .patch(`/admin/admins/${target.user.id}/permissions`)
      .set('Cookie', [...authCookies, ...actionCsrf.cookies])
      .set('X-CSRF-Token', actionCsrf.csrfToken)
      .send({ permissions: ['users.view'] })
      .expect(403);

    expect(res.body.error).toBe('Step-up authentication required');
  });
});
