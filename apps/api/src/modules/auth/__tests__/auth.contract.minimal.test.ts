import { afterEach, beforeAll, describe, expect, it, jest } from '@jest/globals';

jest.mock('../../../lib/mailer', () => ({
  sendPasswordResetEmail: jest.fn(),
  sendVerificationEmail: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../../lib/auth-session-store', () => ({
  getSessionData: jest.fn(),
  invalidateSessionCache: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../../services/cache.service', () => ({
  cacheService: {
    isAvailable: jest.fn().mockReturnValue(true),
    getClient: jest.fn(() => null),
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(true),
    del: jest.fn().mockResolvedValue(true),
    initialize: jest.fn().mockResolvedValue(undefined),
  },
}));

import bcrypt from 'bcryptjs';
import request from 'supertest';
import { createApp } from '../../../index';
import { clientPrisma as prisma } from '@blobinfini/database';

const app = createApp();

async function getCsrf() {
  const res = await request(app).get('/csrf-token').expect(200);
  return {
    cookies: (res.headers['set-cookie'] as unknown as string[]) ?? [],
    csrfToken: res.body.csrfToken as string,
  };
}

function findCookie(setCookies: string[], cookieName: string): string {
  return setCookies.find((cookie) => cookie.startsWith(`${cookieName}=`)) || '';
}

async function createUser(email: string, password: string) {
  const hashed = await bcrypt.hash(password, 10);
  await prisma.user.create({
    data: {
      email,
      password: hashed,
      role: 'RIDER',
      emailVerified: true,
      consentedAt: new Date(),
      consentVersion: 'v1.0.0',
    },
  });
}

describe('Auth contract minimal', () => {
  beforeAll(() => {
    process.env.NODE_ENV = 'test';
    process.env.AUTH_REQUIRE_VERIFIED = 'false';
    process.env.AUTH_REQUIRE_2FA = 'false';
    process.env.ADMIN_ENFORCE_ALLOWED_IPS = 'false';
    process.env.JWT_SECRET = 'j'.repeat(64);
    process.env.JWT_REFRESH_SECRET = 'r'.repeat(64);
    process.env.SESSION_SECRET = 's'.repeat(64);
    process.env.IP_HASH_SECRET = process.env.IP_HASH_SECRET || 'i'.repeat(64);
  });

  afterEach(async () => {
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany();
  });

  it('/auth/login => { ok:true } + Set-Cookie', async () => {
    const email = `contract-login-${Date.now()}@example.com`;
    const password = 'Passw0rd!';
    await createUser(email, password);

    const { cookies, csrfToken } = await getCsrf();
    const res = await request(app)
      .post('/auth/login')
      .set('Cookie', cookies)
      .set('X-CSRF-Token', csrfToken)
      .send({ email, password })
      .expect(200);

    expect(res.body).toEqual({ ok: true });
    const setCookies = (res.headers['set-cookie'] as unknown as string[]) ?? [];
    const accessCookie = findCookie(setCookies, 'accessToken');
    const refreshCookie = findCookie(setCookies, 'refreshToken');

    expect(accessCookie).toContain('HttpOnly');
    expect(refreshCookie).toContain('HttpOnly');
    expect(refreshCookie).toContain('Path=/auth/refresh');
  });

  it('/auth/refresh => { ok:true } + Set-Cookie', async () => {
    const email = `contract-refresh-${Date.now()}@example.com`;
    const password = 'Passw0rd!';
    await createUser(email, password);

    const csrf1 = await getCsrf();
    const login = await request(app)
      .post('/auth/login')
      .set('Cookie', csrf1.cookies)
      .set('X-CSRF-Token', csrf1.csrfToken)
      .send({ email, password })
      .expect(200);

    const authCookies = (login.headers['set-cookie'] as unknown as string[]) ?? [];
    const csrf2 = await getCsrf();

    const refresh = await request(app)
      .post('/auth/refresh')
      .set('Cookie', [...authCookies, ...csrf2.cookies])
      .set('X-CSRF-Token', csrf2.csrfToken)
      .expect(200);

    expect(refresh.body).toEqual({ ok: true });
    const setCookies = (refresh.headers['set-cookie'] as unknown as string[]) ?? [];
    const accessCookie = findCookie(setCookies, 'accessToken');
    const refreshCookie = findCookie(setCookies, 'refreshToken');

    expect(accessCookie).toContain('HttpOnly');
    expect(refreshCookie).toContain('HttpOnly');
    expect(refreshCookie).toContain('Path=/auth/refresh');
  });
});
