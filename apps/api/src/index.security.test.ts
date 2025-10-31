import request from 'supertest';
import { createApp } from './index';
import { prisma } from '@blobinfini/database';
import { getAccessToken, TEST_PASSWORD } from './tests/helpers/auth';
import { Role } from '@prisma/client';

describe('/security/health endpoint', () => {
  const app = createApp();

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('rejects access for non authenticated users', async () => {
    await request(app).get('/security/health').expect(401);
  });

  it('rejects access for non-admin users', async () => {
    const { accessToken } = await getAccessToken({
      app,
      email: 'security-health-rider@test.com',
      password: TEST_PASSWORD,
      role: Role.RIDER,
      emailVerified: true,
    });

    await request(app)
      .get('/security/health')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(403);
  });

  it('returns status payload for admin users', async () => {
    const { accessToken } = await getAccessToken({
      app,
      email: 'security-health-admin@test.com',
      password: TEST_PASSWORD,
      role: Role.ADMIN,
      emailVerified: true,
    });

    const response = await request(app)
      .get('/security/health')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(response.body).toHaveProperty('status');
    expect(Array.isArray(response.body.issues)).toBe(true);
    expect(response.body).toMatchObject({
      helmet: true,
      csrf: true,
      rateLimit: true,
    });
  });
});
