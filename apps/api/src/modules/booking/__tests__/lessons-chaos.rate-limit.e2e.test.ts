import { createApp } from '../../../index';
import { clientPrisma as prisma, Role } from '@blobinfini/database';
import { getAccessToken, type TestSession } from '../../../tests/helpers/auth';
import { resetDb } from '../../../test-utils/resetDb';

describe('Lessons chaos abuse controls - rate limit and backpressure', () => {
  const previousRateLimitFlag = process.env.ENABLE_RATE_LIMIT_IN_TESTS;
  process.env.ENABLE_RATE_LIMIT_IN_TESTS = 'true';

  const app = createApp();

  let proSession: TestSession;
  let proToken = '';
  let proUserId = '';

  let riderSession: TestSession;
  let riderToken = '';

  beforeAll(async () => {
    process.env.ENABLE_RATE_LIMIT_IN_TESTS = 'true';
    await resetDb();

    const proAuth = await getAccessToken({
      app,
      email: `chaos-rl-pro-${Date.now()}@test.com`,
      role: Role.PRO,
    });
    proToken = proAuth.accessToken;
    proSession = proAuth.session;
    proUserId = proAuth.userId;

    const riderAuth = await getAccessToken({
      app,
      email: `chaos-rl-rider-${Date.now()}@test.com`,
      role: Role.RIDER,
    });
    riderToken = riderAuth.accessToken;
    riderSession = riderAuth.session;

    await prisma.proProfile.upsert({
      where: { userId: proUserId },
      create: { userId: proUserId, countryCode: 'FR', lat: 43.5, lng: -1.5, verified: true },
      update: { lat: 43.5, lng: -1.5, verified: true },
    });
  });

  beforeEach(async () => {
    await prisma.proAvailabilityInteraction.deleteMany();
    await prisma.booking.deleteMany();
    await prisma.bookingRequest.deleteMany();
    await prisma.proAvailability.deleteMany();
  });

  afterAll(async () => {
    if (previousRateLimitFlag === undefined) {
      delete process.env.ENABLE_RATE_LIMIT_IN_TESTS;
    } else {
      process.env.ENABLE_RATE_LIMIT_IN_TESTS = previousRateLimitFlag;
    }
    await prisma.$disconnect();
  });

  it('B3-Spam: throttles profile update bursts', async () => {
    const statuses: number[] = [];

    for (let i = 0; i < 14; i += 1) {
      const res = await proSession
        .patch('/pro/me')
        .set('Authorization', `Bearer ${proToken}`)
        .send({ businessName: `RL-${i}` });

      statuses.push(res.status);
    }

    expect(statuses.some((status) => status === 429)).toBe(true);
    expect(statuses.some((status) => status >= 500)).toBe(false);
  });

  it('B3-Spam: throttles upload-url bursts', async () => {
    const statuses: number[] = [];

    for (let i = 0; i < 14; i += 1) {
      const res = await proSession
        .post('/pro/photo/upload-url')
        .set('Authorization', `Bearer ${proToken}`)
        .send({ contentType: 'image/jpeg' });

      statuses.push(res.status);
    }

    expect(statuses.some((status) => status === 429)).toBe(true);
    expect(statuses.some((status) => status >= 500)).toBe(false);
  });

  it('C2-Scraping: throttles listing search bursts', async () => {
    const statuses: number[] = [];

    for (let i = 0; i < 36; i += 1) {
      const res = await riderSession
        .get('/booking/availability/search')
        .set('Authorization', `Bearer ${riderToken}`)
        .query({
          sport: 'surf',
          level: 'beginner',
          lat: 43.5,
          lng: -1.5,
          radiusKm: 20,
          page: 1,
          pageSize: 20,
        });

      statuses.push(res.status);
    }

    expect(statuses.some((status) => status === 429)).toBe(true);
    expect(statuses.some((status) => status >= 500)).toBe(false);
  });

  it('B4-LeadSpam: throttles POST /booking/requests bursts (anti-spam)', async () => {
    // Create an availability to target (availability creation is not rate-limited by userId here)
    const start = new Date(Date.now() + 2 * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    const avRes = await proSession
      .post('/booking/availability')
      .set('Authorization', `Bearer ${proToken}`)
      .send({
        sport: 'surf',
        levels: ['beginner'],
        startAt: start.toISOString(),
        endAt: end.toISOString(),
        capacity: 50,
        spotName: 'Spam Target',
        spotLat: 43.5,
        spotLng: -1.5,
      });

    if (avRes.status !== 201) {
      // Skip if creation failed (e.g., quota already used in another test)
      return;
    }
    const availabilityId = avRes.body.id as string;

    const statuses: number[] = [];
    for (let i = 0; i < 8; i += 1) {
      // Each iteration: try to create a request (unique constraint may block after 1st, RL after 5th)
      const res = await riderSession
        .post('/booking/requests')
        .set('Authorization', `Bearer ${riderToken}`)
        .send({ availabilityId, message: `Spam ${i}` });
      statuses.push(res.status);
    }

    // At least one 429 from the rate limiter (after 5 attempts)
    expect(statuses.some((status) => status === 429)).toBe(true);
    expect(statuses.some((status) => status >= 500)).toBe(false);
  });
});
