import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';

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

describe('Auth cookie contract (production simulation)', () => {
  const originalEnv = { ...process.env };
  let app: express.Express;

  beforeAll(() => {
    process.env.NODE_ENV = 'production';
    process.env.AUTH_REQUIRE_2FA = 'true';
    process.env.AUTH_REQUIRE_VERIFIED = 'false';
    process.env.ADMIN_ENFORCE_ALLOWED_IPS = 'false';

    process.env.JWT_SECRET = 'j'.repeat(64);
    process.env.JWT_REFRESH_SECRET = 'r'.repeat(64);
    process.env.SESSION_SECRET = 's'.repeat(64);
    process.env.TWO_FACTOR_SECRET = 'two-factor-secret-prod-very-strong-1234567890';
    process.env.IP_HASH_SECRET = 'ip-hash-secret-prod-very-strong-1234567890';
    process.env.JWT_EXPIRES_IN = '15m';
    process.env.JWT_REFRESH_EXPIRES_IN = '30d';
    process.env.DATABASE_URL = 'postgresql://user:password@localhost:5432/blobinfini?sslmode=require';

    let authRouter: express.Router | null = null;
    jest.isolateModules(() => {
      authRouter = require('../auth.controller').authRouter as express.Router;
    });

    if (!authRouter) {
      throw new Error('Failed to load authRouter');
    }

    app = express();
    app.use(cookieParser());
    app.use(express.json());
    app.use('/auth', authRouter);
  });

  afterAll(() => {
    try {
      const { stopAuthCacheCleanup } = require('../../../lib/socket-auth-cache');
      stopAuthCacheCleanup();
    } catch {
      // best effort in test cleanup
    }
    process.env = originalEnv;
  });

  it('refresh cookie clear path keeps Secure + HttpOnly + Path=/auth/refresh in production', async () => {
    const res = await request(app)
      .post('/auth/refresh')
      .set('Cookie', ['refreshToken=invalid.refresh.token'])
      .expect(401);

    const setCookies = (res.headers['set-cookie'] as unknown as string[]) ?? [];
    const accessCookie = setCookies.find((cookie) => cookie.startsWith('accessToken=')) || '';
    const refreshCookie = setCookies.find((cookie) => cookie.startsWith('refreshToken=')) || '';

    expect(accessCookie).toContain('HttpOnly');
    expect(accessCookie).toContain('Secure');

    expect(refreshCookie).toContain('HttpOnly');
    expect(refreshCookie).toContain('Secure');
    expect(refreshCookie).toContain('Path=/auth/refresh');
  });
});
