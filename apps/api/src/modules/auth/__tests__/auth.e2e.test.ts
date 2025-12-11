import { createApp } from '../../../index';
import { clientPrisma as prisma, Role } from '@blobinfini/database';
import {
  createTestSession,
  TestSession,
  silenceConsoleErrors,
  getOrCreateUserByEmail,
  TEST_PASSWORD
} from '../../../tests/helpers/auth';

const DEFAULT_EMAIL = 'e2e@test.com';
const DEFAULT_PASSWORD = 'Passw0rd!';

const wipeAuthTables = async () => {
  await prisma.refreshToken.deleteMany();
  await prisma.session.deleteMany();
  await prisma.passwordResetToken.deleteMany();
  await prisma.emailVerificationToken.deleteMany();
  await prisma.user.deleteMany();
};

describe('Auth E2E', () => {
  const app = createApp();
  let session: TestSession;
  let restoreConsole: () => void;

  const registerUser = async (overrides?: { email?: string; password?: string; role?: 'RIDER' | 'PRO' }) => {
    const payload = {
      email: overrides?.email ?? DEFAULT_EMAIL,
      password: overrides?.password ?? DEFAULT_PASSWORD,
      role: overrides?.role ?? 'RIDER',
      consentAccepted: true
    };
    const res = await session.post('/auth/register').send(payload).expect(201);
    return {
      ...payload,
      userId: res.body.userId as string | undefined,
      verificationToken: res.body.verificationToken as string | undefined
    };
  };

  beforeEach(async () => {
    await wipeAuthTables();
    session = await createTestSession(app);
    restoreConsole = silenceConsoleErrors();
  });

  afterEach(() => {
    restoreConsole?.();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('registers a user', async () => {
    const res = await session
      .post('/auth/register')
      .send({ email: DEFAULT_EMAIL, password: DEFAULT_PASSWORD, role: 'RIDER', consentAccepted: true })
      .expect(201);
    expect(res.body).toHaveProperty('message');
    expect(res.body).toHaveProperty('userId');
  });

  it('logs in and returns access + refresh tokens', async () => {
    await registerUser();
    const res = await session
      .post('/auth/login')
      .send({ email: DEFAULT_EMAIL, password: DEFAULT_PASSWORD })
      .expect(200);
    expect(res.body).toHaveProperty('accessToken');
    expect(res.body).toHaveProperty('refreshToken');
  });

  it('refresh rotates refresh token and returns a new access token', async () => {
    await registerUser();
    const login = await session
      .post('/auth/login')
      .send({ email: DEFAULT_EMAIL, password: DEFAULT_PASSWORD })
      .expect(200);
    const oldRefresh = login.body.refreshToken as string;

    const refreshRes = await session
      .post('/auth/refresh')
      .send({ refreshToken: oldRefresh })
      .expect(200);

    expect(refreshRes.body).toHaveProperty('accessToken');
    expect(refreshRes.body).toHaveProperty('refreshToken');
    const newRefresh = refreshRes.body.refreshToken as string;

    await session.post('/auth/refresh').send({ refreshToken: oldRefresh }).expect(401);
    await session.post('/auth/refresh').send({ refreshToken: newRefresh }).expect(200);
  });

  it('logout all devices revokes all refresh tokens', async () => {
    await registerUser();
    const login = await session
      .post('/auth/login')
      .send({ email: DEFAULT_EMAIL, password: DEFAULT_PASSWORD })
      .expect(200);
    const access = login.body.accessToken as string;
    const refresh = login.body.refreshToken as string;

    await session.post('/auth/logout').set('Authorization', `Bearer ${access}`).send({}).expect(200);
    await session.post('/auth/refresh').send({ refreshToken: refresh }).expect(401);
  });

  it('logout single device revokes only provided refresh token', async () => {
    await registerUser();
    const login = await session
      .post('/auth/login')
      .send({ email: DEFAULT_EMAIL, password: DEFAULT_PASSWORD })
      .expect(200);
    const access = login.body.accessToken as string;
    const refresh = login.body.refreshToken as string;

    await session
      .post('/auth/logout')
      .set('Authorization', `Bearer ${access}`)
      .send({ allDevices: false, refreshToken: refresh })
      .expect(200);

    await session.post('/auth/refresh').send({ refreshToken: refresh }).expect(401);
  });

  it('forgot-password issues a reset token (in test) and reset-password updates the password', async () => {
    await registerUser();
    const forgot = await session.post('/auth/forgot-password').send({ email: DEFAULT_EMAIL }).expect(200);
    expect(forgot.body).toHaveProperty('message');
    expect(forgot.body).toHaveProperty('resetToken');

    const token = forgot.body.resetToken as string;

    await session.post('/auth/reset-password').send({ token, password: 'NewPassw0rd!' }).expect(200);

    await session.post('/auth/login').send({ email: DEFAULT_EMAIL, password: DEFAULT_PASSWORD }).expect(401);

    const loginNew = await session
      .post('/auth/login')
      .send({ email: DEFAULT_EMAIL, password: 'NewPassw0rd!' })
      .expect(200);
    expect(loginNew.body).toHaveProperty('accessToken');
    expect(loginNew.body).toHaveProperty('refreshToken');
  });

  it('change-password updates password for authenticated users', async () => {
    await registerUser();
    const login = await session
      .post('/auth/login')
      .send({ email: DEFAULT_EMAIL, password: DEFAULT_PASSWORD })
      .expect(200);
    const access = login.body.accessToken as string;

    await session
      .post('/auth/change-password')
      .set('Authorization', `Bearer ${access}`)
      .send({ currentPassword: DEFAULT_PASSWORD, newPassword: 'BrandNew1!' })
      .expect(200);

    await session.post('/auth/login').send({ email: DEFAULT_EMAIL, password: DEFAULT_PASSWORD }).expect(401);

    await session.post('/auth/login').send({ email: DEFAULT_EMAIL, password: 'BrandNew1!' }).expect(200);
  });

  it('verify-email marks user as verified', async () => {
    const reg = await session
      .post('/auth/register')
      .send({ email: 'verify@test.com', password: DEFAULT_PASSWORD, role: 'RIDER', consentAccepted: true })
      .expect(201);
    expect(reg.body).toHaveProperty('verificationToken');
    const token = reg.body.verificationToken as string;

    await session.post('/auth/verify-email').send({ token }).expect(200);

    const login = await session.post('/auth/login').send({ email: 'verify@test.com', password: DEFAULT_PASSWORD }).expect(200);
    const access = login.body.accessToken as string;

    const me = await session.get('/auth/me').set('Authorization', `Bearer ${access}`).expect(200);

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
        .send({ email: 'blocked@test.com', password: DEFAULT_PASSWORD, role: 'RIDER', consentAccepted: true })
        .expect(201);

      await session.post('/auth/login').send({ email: 'blocked@test.com', password: DEFAULT_PASSWORD }).expect(403);

      const resend = await session.post('/auth/resend-verification').send({ email: 'blocked@test.com' }).expect(200);
      expect(resend.body).toHaveProperty('message');
      expect(resend.body).toHaveProperty('verificationToken');
      const token = resend.body.verificationToken as string;

      await session.post('/auth/verify-email').send({ token }).expect(200);

      const loginOk = await session.post('/auth/login').send({ email: 'blocked@test.com', password: DEFAULT_PASSWORD }).expect(200);
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
        await rateSession.post('/auth/login').send({ email, password: TEST_PASSWORD }).expect(200);
      }

      const limited = await rateSession.post('/auth/login').send({ email, password: TEST_PASSWORD }).expect(429);

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
    const { verificationToken } = await registerUser({ email: 'verify@test.com' });
    if (verificationToken) {
      await session.post('/auth/verify-email').send({ token: verificationToken }).expect(200);
    }

    const login = await session.post('/auth/login').send({ email: 'verify@test.com', password: DEFAULT_PASSWORD }).expect(200);

    const validToken = login.body.accessToken as string;
    const invalidToken = `${validToken.slice(0, -1)}x`;

    await session.get('/auth/me').set('Authorization', `Bearer ${invalidToken}`).expect(401);
  });

  it('route-level requireVerifiedEmail denies unverified and allows after verify', async () => {
    const prev = process.env.AUTH_REQUIRE_VERIFIED;
    try {
      process.env.AUTH_REQUIRE_VERIFIED = 'false';

      const reg = await session
        .post('/auth/register')
        .send({ email: 'routeblock@test.com', password: DEFAULT_PASSWORD, role: 'RIDER', consentAccepted: true })
        .expect(201);
      const token = reg.body.verificationToken as string;

      const login = await session.post('/auth/login').send({ email: 'routeblock@test.com', password: DEFAULT_PASSWORD }).expect(200);
      const access = login.body.accessToken as string;

      await session.get('/auth/verified-only').set('Authorization', `Bearer ${access}`).expect(403);

      await session.post('/auth/verify-email').send({ token }).expect(200);

      await session.get('/auth/verified-only').set('Authorization', `Bearer ${access}`).expect(200);
    } finally {
      if (prev === undefined) delete process.env.AUTH_REQUIRE_VERIFIED;
      else process.env.AUTH_REQUIRE_VERIFIED = prev;
    }
  });

  it('booking endpoints reject unverified riders even if login flag is disabled', async () => {
    const prev = process.env.AUTH_REQUIRE_VERIFIED;
    try {
      process.env.AUTH_REQUIRE_VERIFIED = 'false';

      const email = 'unverified-booking@test.com';
      await getOrCreateUserByEmail({ email, role: Role.RIDER, emailVerified: false });

      const login = await session.post('/auth/login').send({ email, password: TEST_PASSWORD }).expect(200);
      const access = login.body.accessToken as string;

      const res = await session.get('/booking/requests/me').set('Authorization', `Bearer ${access}`).expect(403);
      expect(res.body).toHaveProperty('error', 'Email not verified');
    } finally {
      if (prev === undefined) delete process.env.AUTH_REQUIRE_VERIFIED;
      else process.env.AUTH_REQUIRE_VERIFIED = prev;
    }
  });

  // P1-3: Password validation tests (OWASP-compliant)
  describe('Password Validation (P1-3)', () => {
    const expectValidationMessage = (body: any, substring: string) => {
      expect(body.error).toBe('Invalid input');
      const details = Array.isArray(body.details) ? body.details : [];
      const hasMessage = details.some(
        (detail: any) => typeof detail?.message === 'string' && detail.message.includes(substring)
      );
      expect(hasMessage).toBe(true);
    };

    it('should reject password without lowercase', async () => {
      const res = await session
        .post('/auth/register')
        .send({
          email: `test-${Date.now()}@example.com`,
          password: 'PASSWORD123!',
          role: 'RIDER',
          consentAccepted: true
        })
        .expect(400);

      expectValidationMessage(res.body, 'minuscule');
    });

    it('should reject password without uppercase', async () => {
      const res = await session
        .post('/auth/register')
        .send({
          email: `test-${Date.now()}@example.com`,
          password: 'password123!',
          role: 'RIDER',
          consentAccepted: true
        })
        .expect(400);

      expectValidationMessage(res.body, 'majuscule');
    });

    it('should reject password without digit', async () => {
      const res = await session
        .post('/auth/register')
        .send({
          email: `test-${Date.now()}@example.com`,
          password: 'Password!',
          role: 'RIDER',
          consentAccepted: true
        })
        .expect(400);

      expectValidationMessage(res.body, 'chiffre');
    });

    it('should reject password without special character', async () => {
      const res = await session
        .post('/auth/register')
        .send({
          email: `test-${Date.now()}@example.com`,
          password: 'Password123',
          role: 'RIDER',
          consentAccepted: true
        })
        .expect(400);

      expectValidationMessage(res.body, 'spécial');
    });

    it('should reject password shorter than 8 characters', async () => {
      const res = await session
        .post('/auth/register')
        .send({
          email: `test-${Date.now()}@example.com`,
          password: 'Pass1!',
          role: 'RIDER',
          consentAccepted: true
        })
        .expect(400);

      expectValidationMessage(res.body, '8 caractères');
    });

    it('should reject common passwords', async () => {
      const commonPasswords = ['Password123!', 'Motdepasse1!', 'Azerty123!'];

      for (const pwd of commonPasswords) {
        const res = await session
          .post('/auth/register')
          .send({
            email: `test-${Date.now()}-${Math.random()}@example.com`,
            password: pwd,
            role: 'RIDER',
            consentAccepted: true
          })
          .expect(400);

        expectValidationMessage(res.body, 'commun');
      }
    });

    it('should accept strong password', async () => {
      const res = await session
        .post('/auth/register')
        .send({
          email: `strong-${Date.now()}@example.com`,
          password: 'MyS3cur3!Pass',
          role: 'RIDER',
          consentAccepted: true
        })
        .expect(201);

      expect(res.body).toHaveProperty('userId');
    });

    it('should enforce password validation on reset-password', async () => {
      const userEmail = `reset-test-${Date.now()}@example.com`;
      await session
        .post('/auth/register')
        .send({
          email: userEmail,
          password: 'ValidPass123!',
          role: 'RIDER',
          consentAccepted: true
        })
        .expect(201);

      const forgot = await session.post('/auth/forgot-password').send({ email: userEmail }).expect(200);

      const resetToken = forgot.body.resetToken as string | undefined;
      expect(resetToken).toBeDefined();

      const resWeak = await session
        .post('/auth/reset-password')
        .send({
          token: resetToken,
          password: 'weak'
        })
        .expect(400);

      expect(resWeak.body.error).toBeDefined();

      const resStrong = await session
        .post('/auth/reset-password')
        .send({
          token: resetToken,
          password: 'NewS3cur3!Pass'
        })
        .expect(200);

      expect(resStrong.body.message).toContain('Password updated');
    });
  });

  describe('Rate Limiting (P2-5)', () => {
    it('should apply rate limiting on /resend-verification', async () => {
      const testEmail = `rate-limit-test-${Date.now()}@example.com`;

      const originalEnv = process.env.ENABLE_RATE_LIMIT_IN_TESTS;
      process.env.ENABLE_RATE_LIMIT_IN_TESTS = 'true';

      try {
        for (let i = 0; i < 3; i++) {
          const res = await session.post('/auth/resend-verification').send({ email: testEmail });
          expect([200, 404]).toContain(res.status);
        }

        const res = await session.post('/auth/resend-verification').send({ email: testEmail }).expect(429);
        expect(res.body.error).toContain('EMAIL_VERIFICATION_RATE_LIMIT_EXCEEDED');
      } finally {
        if (originalEnv === undefined) {
          delete process.env.ENABLE_RATE_LIMIT_IN_TESTS;
        } else {
          process.env.ENABLE_RATE_LIMIT_IN_TESTS = originalEnv;
        }
      }
    });
  });
});
