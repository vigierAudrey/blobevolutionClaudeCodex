import request from 'supertest';
import { createApp } from './index';
import { clientPrisma as prisma, Role } from '@blobinfini/database';
import { createTestSession, getAccessToken, TEST_PASSWORD } from './tests/helpers/auth';

describe('Health & core endpoints', () => {
  const app = createApp();
  const trackedEmails: string[] = [];

  afterAll(async () => {
    if (trackedEmails.length > 0) {
      await prisma.user.deleteMany({
        where: { email: { in: trackedEmails } },
      });
    }
    await prisma.$disconnect();
  });

  it('exposes /health and keeps Prisma connection healthy', async () => {
    const res = await request(app).get('/health').expect(200);
    expect(res.body).toEqual({ status: 'ok' });

    const [ping] = await prisma.$queryRaw<{ value: number }[]>`SELECT 1 as value`;
    expect(ping?.value).toBe(1);
  });

  it('returns expected statuses for auth and admin listing', async () => {
    const riderEmail = `health-check-${Date.now()}@test.local`;
    trackedEmails.push(riderEmail);

    const riderSession = await createTestSession(app);

    await riderSession
      .post('/auth/register')
      .send({
        email: riderEmail,
        password: TEST_PASSWORD,
        role: 'RIDER',
        consentAccepted: true,
      })
      .expect(201);

    const loginRes = await riderSession
      .post('/auth/login')
      .send({ email: riderEmail, password: TEST_PASSWORD, consentAccepted: true })
      .expect(200);
    expect(loginRes.body).toEqual({ ok: true });
    expect((loginRes.headers['set-cookie'] as string[] | undefined) ?? []).toEqual(
      expect.arrayContaining([expect.stringMatching(/^accessToken=/), expect.stringMatching(/^refreshToken=/)])
    );

    const adminEmail = `health-admin-${Date.now()}@test.local`;
    trackedEmails.push(adminEmail);

    const { accessToken, session: adminSession } = await getAccessToken({
      app,
      email: adminEmail,
      role: Role.ADMIN,
      emailVerified: true,
    });

    const usersRes = await adminSession
      .get('/admin/users')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(usersRes.body).toHaveProperty('users');
    expect(usersRes.body).toHaveProperty('pagination');
  });
});
