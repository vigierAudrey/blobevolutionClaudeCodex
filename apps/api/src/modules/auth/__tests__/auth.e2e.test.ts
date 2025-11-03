import { createApp } from '../../../index';
import { prisma } from '@blobinfini/database';
import { Role } from '@prisma/client';
import {
  createTestSession,
  TestSession,
  silenceConsoleErrors,
  getOrCreateUserByEmail,
  TEST_PASSWORD,
} from '../../../tests/helpers/auth';

describe('Auth E2E', () => {
  const app = createApp();
  let session: TestSession;
  let restoreConsole: () => void;

  beforeAll(async () => {
    await prisma.refreshToken.deleteMany();
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();

    session = await createTestSession(app);
    restoreConsole = silenceConsoleErrors();
  });

  afterAll(async () => {
    restoreConsole?.();
    await prisma.$disconnect();
  });

  it('registers a user', async () => {
    const res = await session
      .post('/auth/register')
      .send({ email: 'e2e@test.com', password: 'Passw0rd!', role: 'RIDER', consentAccepted: true })
      .expect(201);
    expect(res.body).toHaveProperty('message');
    expect(res.body).toHaveProperty('userId');
  });

  it('logs in and returns access + refresh tokens', async () => {
    const res = await session
      .post('/auth/login')
      .send({ email: 'e2e@test.com', password: 'Passw0rd!' })
      .expect(200);
    expect(res.body).toHaveProperty('accessToken');
    expect(res.body).toHaveProperty('refreshToken');
  });

  it('refresh rotates refresh token and returns a new access token', async () => {
    const login = await session
      .post('/auth/login')
      .send({ email: 'e2e@test.com', password: 'Passw0rd!' })
      .expect(200);
    const oldRefresh = login.body.refreshToken as string;

    const refreshRes = await session
      .post('/auth/refresh')
      .send({ refreshToken: oldRefresh })
      .expect(200);

    expect(refreshRes.body).toHaveProperty('accessToken');
    expect(refreshRes.body).toHaveProperty('refreshToken');
    const newRefresh = refreshRes.body.refreshToken as string;

    await session
      .post('/auth/refresh')
      .send({ refreshToken: oldRefresh })
      .expect(401);

    await session
      .post('/auth/refresh')
      .send({ refreshToken: newRefresh })
      .expect(200);
  });

  it('logout all devices revokes all refresh tokens', async () => {
    const login = await session
      .post('/auth/login')
      .send({ email: 'e2e@test.com', password: 'Passw0rd!' })
      .expect(200);
    const access = login.body.accessToken as string;
    const refresh = login.body.refreshToken as string;

    await session
      .post('/auth/logout')
      .set('Authorization', `Bearer ${access}`)
      .send({})
      .expect(200);

    await session
      .post('/auth/refresh')
      .send({ refreshToken: refresh })
      .expect(401);
  });

  it('logout single device revokes only provided refresh token', async () => {
    const login = await session
      .post('/auth/login')
      .send({ email: 'e2e@test.com', password: 'Passw0rd!' })
      .expect(200);
    const access = login.body.accessToken as string;
    const refresh = login.body.refreshToken as string;

    await session
      .post('/auth/logout')
      .set('Authorization', `Bearer ${access}`)
      .send({ allDevices: false, refreshToken: refresh })
      .expect(200);

    await session
      .post('/auth/refresh')
      .send({ refreshToken: refresh })
      .expect(401);
  });

  it('forgot-password issues a reset token (in test) and reset-password updates the password', async () => {
    const forgot = await session
      .post('/auth/forgot-password')
      .send({ email: 'e2e@test.com' })
      .expect(200);
    expect(forgot.body).toHaveProperty('message');
    expect(forgot.body).toHaveProperty('resetToken');

    const token = forgot.body.resetToken as string;

    await session
      .post('/auth/reset-password')
      .send({ token, password: 'NewPassw0rd!' })
      .expect(200);

    await session
      .post('/auth/login')
      .send({ email: 'e2e@test.com', password: 'Passw0rd!' })
      .expect(401);

    const loginNew = await session
      .post('/auth/login')
      .send({ email: 'e2e@test.com', password: 'NewPassw0rd!' })
      .expect(200);
    expect(loginNew.body).toHaveProperty('accessToken');
    expect(loginNew.body).toHaveProperty('refreshToken');
  });

  it('verify-email marks user as verified', async () => {
    const reg = await session
      .post('/auth/register')
      .send({ email: 'verify@test.com', password: 'Passw0rd!', role: 'RIDER', consentAccepted: true })
      .expect(201);
    expect(reg.body).toHaveProperty('verificationToken');
    const token = reg.body.verificationToken as string;

    await session
      .post('/auth/verify-email')
      .send({ token })
      .expect(200);

    const login = await session
      .post('/auth/login')
      .send({ email: 'verify@test.com', password: 'Passw0rd!' })
      .expect(200);
    const access = login.body.accessToken as string;

    const me = await session
      .get('/auth/me')
      .set('Authorization', `Bearer ${access}`)
      .expect(200);

    expect(me.body.email).toBe('verify@test.com');
    expect(me.body).toHaveProperty('emailVerified', true);
    expect(me.body).toHaveProperty('role');
    expect(me.body).not.toHaveProperty('password');
  });

  it('resend verification + enforce verified login when flag enabled', async () => {
    const prev = process.env.AUTH_REQUIRE_VERIFIED;
    try {
      process.env.AUTH_REQUIRE_VERIFIED = 'true';

      await session
        .post('/auth/register')
        .send({ email: 'blocked@test.com', password: 'Passw0rd!', role: 'RIDER', consentAccepted: true })
        .expect(201);

      await session
        .post('/auth/login')
        .send({ email: 'blocked@test.com', password: 'Passw0rd!' })
        .expect(403);

      const resend = await session
        .post('/auth/resend-verification')
        .send({ email: 'blocked@test.com' })
        .expect(200);
      expect(resend.body).toHaveProperty('message');
      expect(resend.body).toHaveProperty('verificationToken');
      const token = resend.body.verificationToken as string;

      await session
        .post('/auth/verify-email')
        .send({ token })
        .expect(200);

      const loginOk = await session
        .post('/auth/login')
        .send({ email: 'blocked@test.com', password: 'Passw0rd!' })
        .expect(200);
      expect(loginOk.body).toHaveProperty('accessToken');
      expect(loginOk.body).toHaveProperty('refreshToken');
    } finally {
      if (prev === undefined) delete process.env.AUTH_REQUIRE_VERIFIED;
      else process.env.AUTH_REQUIRE_VERIFIED = prev;
    }
  });

  it('rate limits excessive login attempts', async () => {
    const previousFlag = process.env.ENABLE_RATE_LIMIT_IN_TESTS;
    process.env.ENABLE_RATE_LIMIT_IN_TESTS = 'true';
    const rateLimitedApp = createApp();
    try {
      const rateSession = await createTestSession(rateLimitedApp);
      const email = 'ratelimit@test.com';
      await getOrCreateUserByEmail({ email, role: Role.RIDER, emailVerified: true });

      for (let i = 0; i < 5; i += 1) {
        await rateSession
          .post('/auth/login')
          .send({ email, password: TEST_PASSWORD })
          .expect(200);
      }

      const limited = await rateSession
        .post('/auth/login')
        .send({ email, password: TEST_PASSWORD })
        .expect(429);

      expect(limited.body.error).toBe('AUTH_RATE_LIMIT_EXCEEDED');
    } finally {
      if (previousFlag === undefined) {
        delete process.env.ENABLE_RATE_LIMIT_IN_TESTS;
      } else {
        process.env.ENABLE_RATE_LIMIT_IN_TESTS = previousFlag;
      }
    }
  });

  it('rejects requests with tampered JWT tokens', async () => {
    const login = await session
      .post('/auth/login')
      .send({ email: 'verify@test.com', password: 'Passw0rd!' })
      .expect(200);

    const validToken = login.body.accessToken as string;
    const invalidToken = `${validToken.slice(0, -1)}x`;

    await session
      .get('/auth/me')
      .set('Authorization', `Bearer ${invalidToken}`)
      .expect(401);
  });

  it('route-level requireVerifiedEmail denies unverified and allows after verify', async () => {
    const prev = process.env.AUTH_REQUIRE_VERIFIED;
    try {
      process.env.AUTH_REQUIRE_VERIFIED = 'false';

      const reg = await session
        .post('/auth/register')
        .send({ email: 'routeblock@test.com', password: 'Passw0rd!', role: 'RIDER', consentAccepted: true })
        .expect(201);
      const token = reg.body.verificationToken as string;

      const login = await session
        .post('/auth/login')
        .send({ email: 'routeblock@test.com', password: 'Passw0rd!' })
        .expect(200);
      const access = login.body.accessToken as string;

      await session
        .get('/auth/verified-only')
        .set('Authorization', `Bearer ${access}`)
        .expect(403);

      await session
        .post('/auth/verify-email')
        .send({ token })
        .expect(200);

      await session
        .get('/auth/verified-only')
        .set('Authorization', `Bearer ${access}`)
        .expect(200);
    } finally {
      if (prev === undefined) delete process.env.AUTH_REQUIRE_VERIFIED;
      else process.env.AUTH_REQUIRE_VERIFIED = prev;
    }
  });
});
