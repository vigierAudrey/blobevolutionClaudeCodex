import { randomUUID } from 'crypto';
import { clientPrisma as prisma, Level, Role, Sport } from '@blobinfini/database';
import { createApp } from '../../../index';
import { getAccessToken } from '../../../tests/helpers/auth';
import { resetDb } from '../../../test-utils/resetDb';

const app = createApp();
const ACTIVE_LAT = 50.1234;
const ACTIVE_LNG = 1.2345;

async function createRiderProfile(userId: string, displayName: string, lat: number, lng: number) {
  const profile = await prisma.riderProfile.upsert({
    where: { userId },
    update: {
      displayName,
      bio: `${displayName} abuse fixture`,
      photoUrl: '/images/blobosphere/placeholder-surf.jpg',
      lat,
      lng,
      maxDistanceKm: 10,
      wantsLesson: false,
      emailNotif: false,
    },
    create: {
      userId,
      displayName,
      bio: `${displayName} abuse fixture`,
      photoUrl: '/images/blobosphere/placeholder-surf.jpg',
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

describe('Active user abuse controls', () => {
  afterAll(async () => {
    delete process.env.ENABLE_RATE_LIMIT_IN_TESTS;
    await prisma.$disconnect();
  });

  it('rate limits matching search burst for an authenticated rider', async () => {
    await resetDb();
    const rider = await getAccessToken({
      app,
      email: 'abuse-matching-a@test.com',
      role: Role.RIDER,
      emailVerified: true,
    });
    const other = await getAccessToken({
      app,
      email: 'abuse-matching-b@test.com',
      role: Role.RIDER,
      emailVerified: true,
    });

    await createRiderProfile(rider.userId, 'Abuse Rider A', ACTIVE_LAT, ACTIVE_LNG);
    await createRiderProfile(other.userId, 'Abuse Rider B', ACTIVE_LAT + 0.001, ACTIVE_LNG + 0.001);
    process.env.ENABLE_RATE_LIMIT_IN_TESTS = 'true';

    const statuses: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const response = await rider.session
        .post('/matching/search')
        .set('X-API-ENVELOPE', '1')
        .send({
          sport: 'surf',
          level: 'advanced',
          date: 'anytime',
          distanceKm: 10,
          location: { lat: ACTIVE_LAT, lng: ACTIVE_LNG },
          limit: 10,
        });
      statuses.push(response.status);
    }

    expect(statuses.filter((status) => status === 429).length).toBeGreaterThanOrEqual(1);
  });

  it('rate limits message burst and rejects oversized payloads', async () => {
    await resetDb();
    const riderA = await getAccessToken({
      app,
      email: 'abuse-message-a@test.com',
      role: Role.RIDER,
      emailVerified: true,
    });
    const riderB = await getAccessToken({
      app,
      email: 'abuse-message-b@test.com',
      role: Role.RIDER,
      emailVerified: true,
    });

    await createRiderProfile(riderA.userId, 'Burst Rider A', ACTIVE_LAT, ACTIVE_LNG);
    await createRiderProfile(riderB.userId, 'Burst Rider B', ACTIVE_LAT + 0.001, ACTIVE_LNG + 0.001);

    const conversation = await prisma.conversation.create({
      data: {
        id: randomUUID(),
        type: 'RIDER_TO_RIDER',
        members: {
          create: [{ userId: riderA.userId }, { userId: riderB.userId }],
        },
      },
      select: { id: true },
    });
    process.env.ENABLE_RATE_LIMIT_IN_TESTS = 'true';

    await riderA.session
      .post(`/conversations/${conversation.id}/messages`)
      .set('X-API-ENVELOPE', '1')
      .send({ type: 'TEXT', content: 'x'.repeat(1001) })
      .expect(400)
      .expect((response) => {
        expect(response.body.error.code).toBe('VALIDATION_ERROR');
      });

    const results = await Promise.all(
      Array.from({ length: 11 }, (_, index) =>
        riderA.session
          .post(`/conversations/${conversation.id}/messages`)
          .set('X-API-ENVELOPE', '1')
          .send({ type: 'TEXT', content: `burst-${index}` })
      )
    );

    const statuses = results.map((response) => response.status);
    expect(statuses.filter((status) => status === 429).length).toBeGreaterThanOrEqual(1);
  });

  it('keeps open conversation idempotent under concurrent requests with cookie auth', async () => {
    await resetDb();
    delete process.env.ENABLE_RATE_LIMIT_IN_TESTS;
    const rider = await getAccessToken({
      app,
      email: 'abuse-open-rider@test.com',
      role: Role.RIDER,
      emailVerified: true,
    });
    const pro = await getAccessToken({
      app,
      email: 'abuse-open-pro@test.com',
      role: Role.PRO,
      emailVerified: true,
    });

    await prisma.proProfile.upsert({
      where: { userId: pro.userId },
      update: {
        businessName: 'Abuse Pro',
        verified: true,
        lat: ACTIVE_LAT + 0.002,
        lng: ACTIVE_LNG + 0.002,
      },
      create: {
        userId: pro.userId,
        businessName: 'Abuse Pro',
        verified: true,
        lat: ACTIVE_LAT + 0.002,
        lng: ACTIVE_LNG + 0.002,
      },
    });

    const [first, second] = await Promise.all([
      rider.session
        .post('/conversations/open')
        .set('X-API-ENVELOPE', '1')
        .send({ targetUserId: pro.userId }),
      rider.session
        .post('/conversations/open')
        .set('X-API-ENVELOPE', '1')
        .send({ targetUserId: pro.userId }),
    ]);

    expect([first.status, second.status].sort()).toEqual([200, 201]);
    expect(first.body.data.id).toBe(second.body.data.id);

    const total = await prisma.conversation.count();
    expect(total).toBe(1);
  });

  it('does not penalize two legitimate users listing conversations behind the same test IP', async () => {
    await resetDb();
    process.env.ENABLE_RATE_LIMIT_IN_TESTS = 'true';

    const riderA = await getAccessToken({
      app,
      email: 'list-a@test.com',
      role: Role.RIDER,
      emailVerified: true,
    });
    const riderB = await getAccessToken({
      app,
      email: 'list-b@test.com',
      role: Role.RIDER,
      emailVerified: true,
    });
    const riderC = await getAccessToken({
      app,
      email: 'list-c@test.com',
      role: Role.RIDER,
      emailVerified: true,
    });

    await createRiderProfile(riderA.userId, 'List Rider A', ACTIVE_LAT, ACTIVE_LNG);
    await createRiderProfile(riderB.userId, 'List Rider B', ACTIVE_LAT + 0.001, ACTIVE_LNG + 0.001);
    await createRiderProfile(riderC.userId, 'List Rider C', ACTIVE_LAT + 0.002, ACTIVE_LNG + 0.002);

    await prisma.conversation.create({
      data: {
        id: randomUUID(),
        type: 'RIDER_TO_RIDER',
        members: {
          create: [
            { userId: riderA.userId },
            { userId: riderC.userId },
          ],
        },
      },
    });
    await prisma.conversation.create({
      data: {
        id: randomUUID(),
        type: 'RIDER_TO_RIDER',
        members: {
          create: [
            { userId: riderB.userId },
            { userId: riderC.userId },
          ],
        },
      },
    });

    const responses = await Promise.all([
      ...Array.from({ length: 6 }, () => riderA.session.get('/conversations')),
      ...Array.from({ length: 6 }, () => riderB.session.get('/conversations')),
    ]);

    expect(responses.every((response) => response.status === 200)).toBe(true);
  });
});
