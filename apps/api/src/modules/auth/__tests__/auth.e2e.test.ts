import request from 'supertest';
import { createApp } from '../../../index';
import { prisma } from '@blobinfini/database';

describe('Auth E2E', () => {
  const app = createApp();

  beforeAll(async () => {
    // S'assurer que la DB est propre
    await prisma.refreshToken.deleteMany();
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('registers a user', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ email: 'e2e@test.com', password: 'Passw0rd!', role: 'RIDER' })
      .expect(201);
    expect(res.body).toHaveProperty('message');
    expect(res.body).toHaveProperty('userId');
  });

  it('logs in and returns access + refresh tokens', async () => {
    // login user created in previous test
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'e2e@test.com', password: 'Passw0rd!' })
      .expect(200);
    expect(res.body).toHaveProperty('accessToken');
    expect(res.body).toHaveProperty('refreshToken');
  });

  it('refresh rotates refresh token and returns a new access token', async () => {
    // Login again to get a fresh pair
    const login = await request(app)
      .post('/auth/login')
      .send({ email: 'e2e@test.com', password: 'Passw0rd!' })
      .expect(200);
    const oldRefresh = login.body.refreshToken as string;

    const refreshRes = await request(app)
      .post('/auth/refresh')
      .send({ refreshToken: oldRefresh })
      .expect(200);

    expect(refreshRes.body).toHaveProperty('accessToken');
    expect(refreshRes.body).toHaveProperty('refreshToken');
    const newRefresh = refreshRes.body.refreshToken as string;

    // Old refresh is now revoked: using it again should fail
    await request(app)
      .post('/auth/refresh')
      .send({ refreshToken: oldRefresh })
      .expect(401);

    // New refresh should still work (once); this also rotates again
    await request(app)
      .post('/auth/refresh')
      .send({ refreshToken: newRefresh })
      .expect(200);
  });

  it('logout all devices revokes all refresh tokens', async () => {
    // Login to obtain tokens
    const login = await request(app)
      .post('/auth/login')
      .send({ email: 'e2e@test.com', password: 'Passw0rd!' })
      .expect(200);
    const access = login.body.accessToken as string;
    const refresh = login.body.refreshToken as string;

    // Logout all devices
    await request(app)
      .post('/auth/logout')
      .set('Authorization', `Bearer ${access}`)
      .send({})
      .expect(200);

    // Refresh should now be invalid
    await request(app)
      .post('/auth/refresh')
      .send({ refreshToken: refresh })
      .expect(401);
  });

  it('logout single device revokes only provided refresh token', async () => {
    // Login → get access + refresh
    const login = await request(app)
      .post('/auth/login')
      .send({ email: 'e2e@test.com', password: 'Passw0rd!' })
      .expect(200);
    const access = login.body.accessToken as string;
    const refresh = login.body.refreshToken as string;

    // Logout only this device
    await request(app)
      .post('/auth/logout')
      .set('Authorization', `Bearer ${access}`)
      .send({ allDevices: false, refreshToken: refresh })
      .expect(200);

    // That refresh should now be invalid
    await request(app)
      .post('/auth/refresh')
      .send({ refreshToken: refresh })
      .expect(401);
  });

  it('forgot-password issues a reset token (in test) and reset-password updates the password', async () => {
    // Request a reset for the existing user
    const forgot = await request(app)
      .post('/auth/forgot-password')
      .send({ email: 'e2e@test.com' })
      .expect(200);
    expect(forgot.body).toHaveProperty('message');
    expect(forgot.body).toHaveProperty('resetToken'); // exposed in test env

    const token = forgot.body.resetToken as string;

    // Reset with a new password
    await request(app)
      .post('/auth/reset-password')
      .send({ token, password: 'NewPassw0rd!' })
      .expect(200);

    // Old password should fail now
    await request(app)
      .post('/auth/login')
      .send({ email: 'e2e@test.com', password: 'Passw0rd!' })
      .expect(401);

    // New password should work
    const loginNew = await request(app)
      .post('/auth/login')
      .send({ email: 'e2e@test.com', password: 'NewPassw0rd!' })
      .expect(200);
    expect(loginNew.body).toHaveProperty('accessToken');
    expect(loginNew.body).toHaveProperty('refreshToken');
  });

  it('verify-email marks user as verified', async () => {
    // Register a new user and get verification token (exposed in test env)
    const reg = await request(app)
      .post('/auth/register')
      .send({ email: 'verify@test.com', password: 'Passw0rd!', role: 'RIDER' })
      .expect(201);
    expect(reg.body).toHaveProperty('verificationToken');
    const token = reg.body.verificationToken as string;

    // Verify the email
    await request(app)
      .post('/auth/verify-email')
      .send({ token })
      .expect(200);

    // Check in DB
    const u = await prisma.user.findUnique({ where: { email: 'verify@test.com' } });
    expect(u?.emailVerified).toBe(true);
  });

  it('GET /auth/me returns current profile', async () => {
    // Login with the verified user
    const login = await request(app)
      .post('/auth/login')
      .send({ email: 'verify@test.com', password: 'Passw0rd!' })
      .expect(200);
    const access = login.body.accessToken as string;

    const me = await request(app)
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

      // Register a new unverified user
      await request(app)
        .post('/auth/register')
        .send({ email: 'blocked@test.com', password: 'Passw0rd!', role: 'RIDER' })
        .expect(201);

      // Login should be blocked
      await request(app)
        .post('/auth/login')
        .send({ email: 'blocked@test.com', password: 'Passw0rd!' })
        .expect(403);

      // Resend verification to get a token
      const resend = await request(app)
        .post('/auth/resend-verification')
        .send({ email: 'blocked@test.com' })
        .expect(200);
      expect(resend.body).toHaveProperty('message');
      expect(resend.body).toHaveProperty('verificationToken');
      const token = resend.body.verificationToken as string;

      // Verify
      await request(app)
        .post('/auth/verify-email')
        .send({ token })
        .expect(200);

      // Login should now work
      const loginOk = await request(app)
        .post('/auth/login')
        .send({ email: 'blocked@test.com', password: 'Passw0rd!' })
        .expect(200);
      expect(loginOk.body).toHaveProperty('accessToken');
      expect(loginOk.body).toHaveProperty('refreshToken');
    } finally {
      if (prev === undefined) delete process.env.AUTH_REQUIRE_VERIFIED; else process.env.AUTH_REQUIRE_VERIFIED = prev;
    }
  });

  it('route-level requireVerifiedEmail denies unverified and allows after verify', async () => {
    const prev = process.env.AUTH_REQUIRE_VERIFIED;
    try {
      process.env.AUTH_REQUIRE_VERIFIED = 'false'; // ensure login not blocked

      // Register an unverified user and login
      const reg = await request(app)
        .post('/auth/register')
        .send({ email: 'routeblock@test.com', password: 'Passw0rd!', role: 'RIDER' })
        .expect(201);
      const token = reg.body.verificationToken as string;

      const login = await request(app)
        .post('/auth/login')
        .send({ email: 'routeblock@test.com', password: 'Passw0rd!' })
        .expect(200);
      const access = login.body.accessToken as string;

      // Access verified-only should be forbidden
      await request(app)
        .get('/auth/verified-only')
        .set('Authorization', `Bearer ${access}`)
        .expect(403);

      // Verify email, then access should succeed
      await request(app)
        .post('/auth/verify-email')
        .send({ token })
        .expect(200);

      await request(app)
        .get('/auth/verified-only')
        .set('Authorization', `Bearer ${access}`)
        .expect(200);
    } finally {
      if (prev === undefined) delete process.env.AUTH_REQUIRE_VERIFIED; else process.env.AUTH_REQUIRE_VERIFIED = prev;
    }
  });
});
