import { clientPrisma as prisma, Role } from '@blobinfini/database';
import { createApp } from '../../../index';
import { getAccessToken, TestSession } from '../../../tests/helpers/auth';

const app = createApp();

describe('GET /booking/pros/nearby', () => {
  let riderToken = '';
  let riderSession: TestSession;

  const testEmails = {
    rider: 'rider-nearby@test.com',
    proA: 'pro-a-nearby@test.com',
    proB: 'pro-b-nearby@test.com',
    proC: 'pro-c-nearby@test.com',
  };

  const resetData = async () => {
    await prisma.proAvailabilityInteraction.deleteMany();
    await prisma.booking.deleteMany();
    await prisma.bookingRequest.deleteMany();
    await prisma.proAvailability.deleteMany();
    await prisma.proProfile.deleteMany();
    await prisma.user.deleteMany({ where: { role: Role.PRO } });
    await prisma.user.deleteMany({ where: { email: testEmails.rider } });
  };

  const createPro = async (options: {
    email: string;
    lat: number | null;
    lng: number | null;
    sport?: 'surf' | 'kitesurf';
  }) => {
    const auth = await getAccessToken({
      app,
      email: options.email,
      role: Role.PRO,
    });

    await prisma.proProfile.upsert({
      where: { userId: auth.userId },
      create: {
        userId: auth.userId,
        lat: options.lat,
        lng: options.lng,
        verified: true,
      },
      update: {
        lat: options.lat,
        lng: options.lng,
        verified: true,
      },
    });

    if (options.sport) {
      await prisma.proAvailability.create({
        data: {
          proUserId: auth.userId,
          sport: options.sport,
          levels: ['beginner'],
          startAt: new Date(Date.now() + 60 * 60 * 1000),
          endAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
          capacity: 4,
          bookedCount: 0,
          status: 'OPEN',
        },
      });
    }

    const profile = await prisma.proProfile.findUnique({
      where: { userId: auth.userId },
      select: { id: true },
    });

    if (!profile?.id) {
      throw new Error('Pro profile not found after creation');
    }

    return profile.id;
  };

  beforeEach(async () => {
    await resetData();
    const riderAuth = await getAccessToken({
      app,
      email: testEmails.rider,
      role: Role.RIDER,
    });
    riderToken = riderAuth.accessToken;
    riderSession = riderAuth.session;
  });

  afterAll(async () => {
    await resetData();
    await prisma.$disconnect();
  });

  it('excludes pros without geolocation', async () => {
    await createPro({ email: testEmails.proA, lat: 43.5, lng: -1.5 });
    await createPro({ email: testEmails.proB, lat: null, lng: null });

    const res = await riderSession
      .get('/booking/pros/nearby')
      .set('Authorization', `Bearer ${riderToken}`)
      .query({ lat: 43.5, lng: -1.5, radiusKm: 30 })
      .expect(200);

    expect(res.body.pros).toHaveLength(1);
    expect(res.body.pros[0]).toMatchObject({
      proPublicId: expect.any(String),
      distanceBucket: expect.any(String),
    });
    expect(res.body.pros[0]).not.toHaveProperty('lat');
    expect(res.body.pros[0]).not.toHaveProperty('lng');
    expect(res.body.pros[0]).not.toHaveProperty('proId');
  });

  it('sorts pros by distance', async () => {
    const nearPublicId = await createPro({ email: testEmails.proA, lat: 43.5, lng: -1.5 });
    await createPro({ email: testEmails.proB, lat: 44.0, lng: -1.2 });

    const res = await riderSession
      .get('/booking/pros/nearby')
      .set('Authorization', `Bearer ${riderToken}`)
      .query({ lat: 43.5, lng: -1.5, radiusKm: 150 })
      .expect(200);

    expect(res.body.pros).toHaveLength(2);
    expect(res.body.pros[0].proPublicId).toBe(nearPublicId);
    expect(res.body.pros[0].distanceBucket).toBeDefined();
    expect(res.body.pros[1].distanceBucket).toBeDefined();
    expect(res.body.pros[0]).not.toHaveProperty('distanceKm');
    expect(res.body.pros[1]).not.toHaveProperty('distanceKm');
  });

  it('filters by sport when available but still returns pros without slots', async () => {
    const surfId = await createPro({ email: testEmails.proA, lat: 43.5, lng: -1.5, sport: 'surf' });
    const kiteId = await createPro({ email: testEmails.proB, lat: 43.55, lng: -1.48, sport: 'kitesurf' });
    const noSlotId = await createPro({ email: testEmails.proC, lat: 43.6, lng: -1.47 });

    const res = await riderSession
      .get('/booking/pros/nearby')
      .set('Authorization', `Bearer ${riderToken}`)
      .query({ lat: 43.5, lng: -1.5, radiusKm: 50, sport: 'surf' })
      .expect(200);

    const ids = res.body.pros.map((p: { proPublicId: string }) => p.proPublicId);
    expect(ids).toContain(surfId);
    expect(ids).toContain(noSlotId);
    expect(ids).not.toContain(kiteId);
    expect(res.body.pros.every((p: { sports: string[] }) => p.sports?.includes('surf') || (p.sports ?? []).length === 0)).toBe(true);
  });

  it('privacy: no precise distance leak across repeated nearby probes', async () => {
    await createPro({ email: testEmails.proA, lat: 43.5, lng: -1.5, sport: 'surf' });

    const first = await riderSession
      .get('/booking/pros/nearby')
      .set('Authorization', `Bearer ${riderToken}`)
      .query({ lat: 43.5, lng: -1.5, radiusKm: 30 })
      .expect(200);

    const second = await riderSession
      .get('/booking/pros/nearby')
      .set('Authorization', `Bearer ${riderToken}`)
      .query({ lat: 43.5006, lng: -1.5006, radiusKm: 30 })
      .expect(200);

    expect(first.body.pros).toHaveLength(1);
    expect(second.body.pros).toHaveLength(1);

    const firstPro = first.body.pros[0];
    const secondPro = second.body.pros[0];

    expect(firstPro.proPublicId).toBe(secondPro.proPublicId);
    expect(firstPro.distanceBucket).toBeDefined();
    expect(secondPro.distanceBucket).toBeDefined();
    expect(firstPro).not.toHaveProperty('distanceKm');
    expect(secondPro).not.toHaveProperty('distanceKm');
    expect(firstPro).not.toHaveProperty('lat');
    expect(firstPro).not.toHaveProperty('lng');
    expect(secondPro).not.toHaveProperty('lat');
    expect(secondPro).not.toHaveProperty('lng');
  });
});
