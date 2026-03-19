import { randomUUID } from 'crypto';
import { createApp } from '../../../index';
import { clientPrisma as prisma, Level, Role, Sport } from '@blobinfini/database';
import { resetDb } from '../../../test-utils/resetDb';
import { getAccessToken } from '../../../tests/helpers/auth';

const app = createApp();
const ACTIVE_LAT = 50.1234;
const ACTIVE_LNG = 1.2345;

type AuthFixture = Awaited<ReturnType<typeof getAccessToken>>;

async function createRiderFixture(auth: AuthFixture, displayName: string, lat: number, lng: number) {
  const profile = await prisma.riderProfile.upsert({
    where: { userId: auth.userId },
    update: {
      displayName,
      bio: `${displayName} fixture`,
      lat,
      lng,
      maxDistanceKm: 10,
      wantsLesson: false,
      emailNotif: false,
    },
    create: {
      userId: auth.userId,
      displayName,
      bio: `${displayName} fixture`,
      lat,
      lng,
      maxDistanceKm: 10,
      wantsLesson: false,
      emailNotif: false,
    },
  });

  await prisma.riderDiscipline.createMany({
    data: [{ profileId: profile.id, sport: Sport.surf, level: Level.advanced }],
    skipDuplicates: true,
  });

  return profile;
}

async function seedConversationFixture() {
  await resetDb();

  const riderASession = await getAccessToken({
    app,
    email: 'sim-rider-a@test.com',
    role: Role.RIDER,
    emailVerified: true,
  });
  const riderBSession = await getAccessToken({
    app,
    email: 'sim-rider-b@test.com',
    role: Role.RIDER,
    emailVerified: true,
  });
  const intruderSession = await getAccessToken({
    app,
    email: 'sim-rider-intruder@test.com',
    role: Role.RIDER,
    emailVerified: true,
  });

  const riderAProfile = await createRiderFixture(riderASession, 'Sim Rider A', ACTIVE_LAT, ACTIVE_LNG);
  const riderBProfile = await createRiderFixture(riderBSession, 'Sim Rider B', ACTIVE_LAT + 0.001, ACTIVE_LNG + 0.001);
  await createRiderFixture(intruderSession, 'Sim Intruder', ACTIVE_LAT + 1, ACTIVE_LNG + 1);

  await prisma.matchDecision.upsert({
    where: {
      actorUserId_targetProfileId: {
        actorUserId: riderBSession.userId,
        targetProfileId: riderAProfile.id,
      } as any,
    },
    update: { decision: 'ACCEPT' },
    create: {
      actorUserId: riderBSession.userId,
      targetProfileId: riderAProfile.id,
      decision: 'ACCEPT',
    },
  });

  const searchResponse = await riderASession.session
    .post('/matching/search')
    .set('X-API-ENVELOPE', '1')
    .send({
      sport: 'surf',
      level: 'advanced',
      date: 'anytime',
      distanceKm: 10,
      location: { lat: ACTIVE_LAT, lng: ACTIVE_LNG },
      limit: 10,
    })
    .expect(200);

  const results = searchResponse.body?.data?.results ?? [];
  const candidate = results.find((item: { id: string }) => item.id === riderBProfile.id);
  expect(candidate).toBeDefined();

  const decisionsResponse = await riderASession.session
    .post('/matching/decisions')
    .set('X-API-ENVELOPE', '1')
    .send({
      items: [{ targetProfileId: riderBProfile.id, decision: 'ACCEPT' }],
    })
    .expect(200);

  const conversationId = decisionsResponse.body?.data?.createdConversations?.[0]?.conversationId as string | undefined;
  expect(conversationId).toBeDefined();

  return {
    conversationId: conversationId as string,
    riderA: riderASession,
    riderB: riderBSession,
    intruder: intruderSession,
  };
}

describe('Simulation utilisateurs actifs API', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('couvre login réel, matching, conversation, message et réception', async () => {
    const { conversationId, riderA, riderB } = await seedConversationFixture();
    const message = `api-active-${Date.now()}`;

    await riderA.session
      .get('/conversations')
      .expect(200)
      .expect((response) => {
        expect(response.body.items.some((item: { id: string }) => item.id === conversationId)).toBe(true);
      });

    await riderA.session
      .get(`/conversations/${conversationId}/messages`)
      .expect(200);

    const sendResponse = await riderA.session
      .post(`/conversations/${conversationId}/messages`)
      .set('X-API-ENVELOPE', '1')
      .send({ type: 'TEXT', content: message })
      .expect(201);

    expect(sendResponse.body.data.id).toBeDefined();

    await riderB.session
      .get(`/conversations/${conversationId}/messages`)
      .expect(200)
      .expect((response) => {
        const items = response.body.items as Array<{ content: string; senderName: string }>;
        expect(items.some((item) => item.content === message)).toBe(true);
      });
  });

  it('bloque un utilisateur non membre en lecture et en écriture', async () => {
    const { conversationId, intruder } = await seedConversationFixture();

    await intruder.session
      .get(`/conversations/${conversationId}/messages`)
      .expect(404);

    await intruder.session
      .post(`/conversations/${conversationId}/messages`)
      .set('X-API-ENVELOPE', '1')
      .send({ type: 'TEXT', content: 'intrusion' })
      .expect(403)
      .expect((response) => {
        expect(response.body.error.code).toBe('FORBIDDEN');
      });
  });

  it('rejette les payloads invalides sur matching et message', async () => {
    await resetDb();
    const rider = await getAccessToken({
      app,
      email: 'sim-validation@test.com',
      role: Role.RIDER,
      emailVerified: true,
    });

    await createRiderFixture(rider, 'Validation Rider', ACTIVE_LAT, ACTIVE_LNG);

    await rider.session
      .post('/matching/search')
      .set('X-API-ENVELOPE', '1')
      .send({
        sport: 'surf',
        level: 'advanced',
        date: 'invalid-date',
        distanceKm: 9999,
        location: { lat: ACTIVE_LAT, lng: ACTIVE_LNG },
      })
      .expect(400)
      .expect((response) => {
        expect(response.body.error.code).toBe('VALIDATION_ERROR');
      });

    const conversation = await prisma.conversation.create({
      data: {
        id: randomUUID(),
        type: 'RIDER_TO_RIDER',
        members: {
          create: [{ userId: rider.userId }],
        },
      },
      select: { id: true },
    });

    await rider.session
      .post(`/conversations/${conversation.id}/messages`)
      .set('X-API-ENVELOPE', '1')
      .send({ type: 'TEXT', content: '' })
      .expect(400)
      .expect((response) => {
        expect(response.body.error.code).toBe('VALIDATION_ERROR');
      });
  });

  it('reste idempotent en concurrence basique sur send-message', async () => {
    const { conversationId, riderA } = await seedConversationFixture();
    const clientMsgId = randomUUID();

    const results = await Promise.all([
      riderA.session
        .post(`/conversations/${conversationId}/messages`)
        .set('X-API-ENVELOPE', '1')
        .send({ type: 'TEXT', content: 'same payload', clientMsgId }),
      riderA.session
        .post(`/conversations/${conversationId}/messages`)
        .set('X-API-ENVELOPE', '1')
        .send({ type: 'TEXT', content: 'same payload', clientMsgId }),
    ]);

    const statuses = results.map((response) => response.status).sort();
    expect(statuses).toEqual([200, 201]);

    const stored = await prisma.message.findMany({
      where: { conversationId, clientMsgId },
      select: { id: true },
    });
    expect(stored).toHaveLength(1);
  });
});
