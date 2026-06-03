import request from 'supertest';
import { createApp } from '../../../index';
import { clientPrisma as prisma, Role } from '@blobinfini/database';
import { createTestSession, getAccessToken, getOrCreateUserByEmail } from '../../../tests/helpers/auth';
import { resetDb } from '../../../test-utils/resetDb';

describe('pushRouter — feature flag OFF by default', () => {
  const app = createApp();
  const originalFlag = process.env.PUSH_NOTIFICATIONS_ENABLED;

  beforeEach(async () => {
    await resetDb();
    delete process.env.PUSH_NOTIFICATIONS_ENABLED;
  });

  afterAll(async () => {
    if (originalFlag === undefined) {
      delete process.env.PUSH_NOTIFICATIONS_ENABLED;
    } else {
      process.env.PUSH_NOTIFICATIONS_ENABLED = originalFlag;
    }
    await prisma.$disconnect();
  });

  it('POST /push/subscribe — sans session authentifiée → 401 avant le flag OFF', async () => {
    const session = await createTestSession(app);

    await session
      .post('/push/subscribe')
      .send({ token: 'fcm-token' })
      .expect(401);
  });

  it('POST /push/subscribe — utilisateur non vérifié → 403 avant le flag OFF', async () => {
    const auth = await getAccessToken({
      app,
      email: 'push-unverified@test.local',
      role: Role.RIDER,
      emailVerified: true,
    });

    await prisma.user.update({
      where: { id: auth.userId },
      data: { emailVerified: false },
    });

    await auth.session
      .post('/push/subscribe')
      .send({ token: 'fcm-token' })
      .expect(403);
  });

  it('routes /push/* — flag OFF → 404 et aucun token stocké', async () => {
    const auth = await getAccessToken({
      app,
      email: 'push-off@test.local',
      role: Role.RIDER,
    });

    await auth.session.post('/push/subscribe').send({ token: 'fcm-token' }).expect(404);
    await auth.session.post('/push/register').send({ token: 'fcm-token' }).expect(404);
    await auth.session.post('/push/unsubscribe').send({ token: 'fcm-token' }).expect(404);
    await auth.session.post('/push/unregister').send({ token: 'fcm-token' }).expect(404);
    await auth.session.post('/push/test').send({ title: 'T', body: 'B' }).expect(404);
    await auth.session
      .post('/push/send')
      .send({ userId: auth.userId, title: 'T', body: 'B', type: 'general' })
      .expect(404);
    await auth.session.get('/push/status').expect(404);

    await expect(prisma.pushToken.count({ where: { userId: auth.userId } })).resolves.toBe(0);
  });

  it('POST /push/test — flag ON reste réservé aux admins', async () => {
    process.env.PUSH_NOTIFICATIONS_ENABLED = 'true';
    const auth = await getAccessToken({
      app,
      email: 'push-test-rider@test.local',
      role: Role.RIDER,
    });

    await auth.session
      .post('/push/test')
      .send({ title: 'T', body: 'B' })
      .expect(403);
  });

  it('POST /push/send — flag ON reste réservé aux admins', async () => {
    process.env.PUSH_NOTIFICATIONS_ENABLED = 'true';
    const auth = await getAccessToken({
      app,
      email: 'push-send-rider@test.local',
      role: Role.RIDER,
    });

    await auth.session
      .post('/push/send')
      .send({ userId: auth.userId, title: 'T', body: 'B', type: 'general' })
      .expect(403);
  });

  it('POST /push/subscribe — flag ON rejette userId client et empêche l\'IDOR', async () => {
    process.env.PUSH_NOTIFICATIONS_ENABLED = 'true';
    const auth = await getAccessToken({
      app,
      email: 'push-attacker@test.local',
      role: Role.RIDER,
    });
    const victim = await getOrCreateUserByEmail({
      email: 'push-victim@test.local',
      role: Role.RIDER,
      emailVerified: true,
    });

    await auth.session
      .post('/push/subscribe')
      .send({ token: 'fcm-token', userId: victim.id })
      .expect(400);

    await expect(prisma.pushToken.count({ where: { userId: victim.id } })).resolves.toBe(0);
    await expect(prisma.pushToken.count({ where: { userId: auth.userId } })).resolves.toBe(0);
  });

  it('POST /push/subscribe — flag ON refuse un compte supprimé', async () => {
    process.env.PUSH_NOTIFICATIONS_ENABLED = 'true';
    const auth = await getAccessToken({
      app,
      email: 'push-deleted@test.local',
      role: Role.RIDER,
    });

    await prisma.user.update({
      where: { id: auth.userId },
      data: { deletedAt: new Date() },
    });

    await auth.session
      .post('/push/subscribe')
      .send({ token: 'fcm-token' })
      .expect(403);

    await expect(prisma.pushToken.count({ where: { userId: auth.userId } })).resolves.toBe(0);
  });

  it('POST /push/subscribe — flag ON refuse les payloads trop volumineux', async () => {
    process.env.PUSH_NOTIFICATIONS_ENABLED = 'true';
    const auth = await getAccessToken({
      app,
      email: 'push-large-payload@test.local',
      role: Role.RIDER,
    });

    await auth.session
      .post('/push/subscribe')
      .send({ token: 'x'.repeat(4097) })
      .expect(400);

    await expect(prisma.pushToken.count({ where: { userId: auth.userId } })).resolves.toBe(0);
  });
});
