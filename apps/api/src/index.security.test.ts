import request from 'supertest';
import { createApp } from './index';
import { clientPrisma as prisma, Role } from '@blobinfini/database';
import { getAccessToken, TEST_PASSWORD } from './tests/helpers/auth';
import type { SecurityHealthResponse } from './modules/security/security.contract';

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

  it('does not expose legacy /api/security/health alias', async () => {
    await request(app).get('/api/security/health').expect(404);
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

    const body = response.body as SecurityHealthResponse;
    expect(['SECURE', 'DEGRADED', 'UNSAFE']).toContain(body.status);
    expect(typeof body.timestamp).toBe('string');
    expect(body.checks).toEqual({
      config: expect.stringMatching(/^(ok|fail)$/),
      env: expect.stringMatching(/^(ok|fail)$/),
      db: expect.stringMatching(/^(ok|fail)$/),
      redis: expect.stringMatching(/^(ok|fail)$/),
    });
  });
});
