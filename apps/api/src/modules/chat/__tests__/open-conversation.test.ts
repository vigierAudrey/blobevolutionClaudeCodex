import { clientPrisma as prisma, Role } from '@blobinfini/database';
import { createApp } from '../../../index';
import { getAccessToken, TestSession } from '../../../tests/helpers/auth';

const app = createApp();

describe('Conversations open endpoint', () => {
  let riderToken = '';
  let riderSession: TestSession;
  let riderId = '';
  let proId = '';

  beforeEach(async () => {
    await prisma.message.deleteMany();
    await prisma.conversationMember.deleteMany();
    await prisma.conversation.deleteMany();
    await prisma.proProfile.deleteMany();
    await prisma.user.deleteMany();

    const riderAuth = await getAccessToken({
      app,
      email: 'rider-conv@test.com',
      role: Role.RIDER,
    });
    riderToken = riderAuth.accessToken;
    riderSession = riderAuth.session;
    riderId = riderAuth.userId;

    const proAuth = await getAccessToken({
      app,
      email: 'pro-conv@test.com',
      role: Role.PRO,
    });
    proId = proAuth.userId;

    await prisma.proProfile.upsert({
      where: { userId: proId },
      create: { userId: proId, lat: 43.5, lng: -1.5, verified: true },
      update: { lat: 43.5, lng: -1.5, verified: true },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('returns the same conversation id when opening twice', async () => {
    const first = await riderSession
      .post('/conversations/open')
      .set('Authorization', `Bearer ${riderToken}`)
      .send({ targetUserId: proId })
      .expect(201);

    const second = await riderSession
      .post('/conversations/open')
      .set('Authorization', `Bearer ${riderToken}`)
      .send({ targetUserId: proId })
      .expect(200);

    expect(first.body.id).toBeDefined();
    expect(second.body.id).toBe(first.body.id);

    const total = await prisma.conversation.count();
    expect(total).toBe(1);
  });

  it('applies cooldown when sending messages too quickly', async () => {
    const { body: conv } = await riderSession
      .post('/conversations/open')
      .set('Authorization', `Bearer ${riderToken}`)
      .send({ targetUserId: proId })
      .expect(201);

    const msg = await riderSession
      .post(`/conversations/${conv.id}/messages`)
      .set('Authorization', `Bearer ${riderToken}`)
      .send({ type: 'TEXT', content: 'Hello pro' })
      .expect(201);

    await riderSession
      .post('/conversations/open')
      .set('Authorization', `Bearer ${riderToken}`)
      .send({ targetUserId: proId })
      .expect(429)
      .expect((res) => {
        expect(res.body.retryAfterSeconds).toBeGreaterThan(0);
        expect(res.body.code).toBe('CONVERSATION_COOLDOWN');
      });

    await prisma.message.update({
      where: { id: msg.body.id as string },
      data: { createdAt: new Date(Date.now() - 60_000) },
    });

    await riderSession
      .post('/conversations/open')
      .set('Authorization', `Bearer ${riderToken}`)
      .send({ targetUserId: proId })
      .expect(200);
  });

  it('respects rate limit on /conversations/open', async () => {
    for (let i = 0; i < 10; i++) {
      await riderSession
        .post('/conversations/open')
        .set('Authorization', `Bearer ${riderToken}`)
        .send({ targetUserId: proId })
        .expect(i === 0 ? 201 : 200);
    }

    await riderSession
      .post('/conversations/open')
      .set('Authorization', `Bearer ${riderToken}`)
      .send({ targetUserId: proId })
      .expect(429)
      .expect((res) => {
        expect(res.body.code).toBe('RATE_LIMIT');
        expect(res.body.retryAfterSeconds).toBeGreaterThan(0);
      });
  });

  it('is idempotent under concurrent calls', async () => {
    const results = await Promise.allSettled([
      riderSession.post('/conversations/open').set('Authorization', `Bearer ${riderToken}`).send({ targetUserId: proId }),
      riderSession.post('/conversations/open').set('Authorization', `Bearer ${riderToken}`).send({ targetUserId: proId }),
    ]);

    const ids = results
      .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled')
      .map((r) => r.value.body.id);
    expect(new Set(ids).size).toBe(1);

    const count = await prisma.conversation.count();
    expect(count).toBe(1);
  });
});
