import { clientPrisma as prisma, Role } from '@blobinfini/database';
import { createApp } from '../../../index';
import { getAccessToken, TestSession } from '../../../tests/helpers/auth';
import { cacheService } from '../../../services/cache.service';
import { bookingService } from '../booking.service';
import type { CreateAvailabilityInput } from '../dto/createAvailability.dto';

const app = createApp();

describe('Booking France-only guards', () => {
  let proToken = '';
  let proSession: TestSession;
  let proUserId = '';
  let riderToken = '';
  let riderSession: TestSession;

  const testEmails = {
    pro: 'pro-booking-france-only@test.com',
    rider: 'rider-booking-france-only@test.com',
  };

  const biarritz = { lat: 43.4832, lng: -1.5586 };
  const hossegor = { lat: 43.6657, lng: -1.4438 };
  const geneva = { lat: 46.2044, lng: 6.1432 };

  const resetData = async () => {
    await prisma.proAvailabilityInteraction.deleteMany();
    await prisma.booking.deleteMany();
    await prisma.bookingRequest.deleteMany();
    await prisma.proAvailability.deleteMany();

    const users = await prisma.user.findMany({
      where: {
        email: { in: Object.values(testEmails) },
      },
      select: { id: true },
    });
    const userIds = users.map((user) => user.id);

    if (userIds.length > 0) {
      await prisma.proProfile.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.riderProfile.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
  };

  const buildAvailabilityPayload = (overrides: Partial<CreateAvailabilityInput> = {}): CreateAvailabilityInput => ({
    sport: 'surf',
    levels: ['beginner'],
    startAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    endAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    capacity: 4,
    spotName: 'Cote des Basques',
    spotLat: biarritz.lat,
    spotLng: biarritz.lng,
    ...overrides,
  });

  const createAvailability = async (overrides: Partial<CreateAvailabilityInput> = {}) => {
    const res = await proSession
      .post('/booking/availability')
      .set('Authorization', `Bearer ${proToken}`)
      .send(buildAvailabilityPayload(overrides))
      .expect(201);

    return res.body;
  };

  beforeEach(async () => {
    jest.restoreAllMocks();
    await resetData();

    const proAuth = await getAccessToken({
      app,
      email: testEmails.pro,
      role: Role.PRO,
    });
    proToken = proAuth.accessToken;
    proSession = proAuth.session;
    proUserId = proAuth.userId;

    await prisma.proProfile.upsert({
      where: { userId: proUserId },
      create: {
        userId: proUserId,
        countryCode: 'FR',
        lat: biarritz.lat,
        lng: biarritz.lng,
        verified: true,
      },
      update: {
        countryCode: 'FR',
        lat: biarritz.lat,
        lng: biarritz.lng,
        verified: true,
      },
    });

    const riderAuth = await getAccessToken({
      app,
      email: testEmails.rider,
      role: Role.RIDER,
    });
    riderToken = riderAuth.accessToken;
    riderSession = riderAuth.session;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await resetData();
    await prisma.$disconnect();
  });

  it('accepts FR coordinates for GET /booking/availability/search', async () => {
    const availability = await createAvailability();

    const res = await riderSession
      .get('/booking/availability/search')
      .set('Authorization', `Bearer ${riderToken}`)
      .query({
        sport: 'surf',
        level: 'beginner',
        lat: biarritz.lat,
        lng: biarritz.lng,
        radiusKm: 40,
        page: 1,
        pageSize: 20,
      })
      .expect(200);

    expect(res.body.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: availability.id,
        }),
      ]),
    );
  });

  it('accepts FR coordinates for GET /booking/pros/nearby', async () => {
    const res = await riderSession
      .get('/booking/pros/nearby')
      .set('Authorization', `Bearer ${riderToken}`)
      .query({ lat: biarritz.lat, lng: biarritz.lng, radiusKm: 40 })
      .expect(200);

    expect(res.body.pros).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          proPublicId: expect.any(String),
        }),
      ]),
    );
  });

  it('rejects out-of-France search coordinates before calling the booking search service', async () => {
    const searchSpy = jest.spyOn(bookingService, 'searchAvailabilities');

    const res = await riderSession
      .get('/booking/availability/search')
      .set('Authorization', `Bearer ${riderToken}`)
      .query({
        sport: 'surf',
        level: 'beginner',
        lat: geneva.lat,
        lng: geneva.lng,
        radiusKm: 40,
      })
      .expect(403);

    expect(res.body.error).toBe('FRANCE_ONLY_RESTRICTED');
    expect(res.body.message).toContain('France');
    expect(searchSpy).not.toHaveBeenCalled();
  });

  it('rejects incomplete search coordinates before calling the booking search service', async () => {
    const searchSpy = jest.spyOn(bookingService, 'searchAvailabilities');

    const res = await riderSession
      .get('/booking/availability/search')
      .set('Authorization', `Bearer ${riderToken}`)
      .query({
        sport: 'surf',
        level: 'beginner',
        lat: biarritz.lat,
        radiusKm: 40,
      })
      .expect(400);

    expect(res.body.error).toBe('FRANCE_ONLY_INCOMPLETE_LOCATION');
    expect(searchSpy).not.toHaveBeenCalled();
  });

  it('rejects out-of-France nearby searches before calling the nearby-pro service', async () => {
    const nearbySpy = jest.spyOn(bookingService, 'listNearbyPros');

    const res = await riderSession
      .get('/booking/pros/nearby')
      .set('Authorization', `Bearer ${riderToken}`)
      .query({ lat: geneva.lat, lng: geneva.lng, radiusKm: 40 })
      .expect(403);

    expect(res.body.error).toBe('FRANCE_ONLY_RESTRICTED');
    expect(nearbySpy).not.toHaveBeenCalled();
  });

  it('rejects incomplete nearby search coordinates before calling the nearby-pro service', async () => {
    const nearbySpy = jest.spyOn(bookingService, 'listNearbyPros');

    const res = await riderSession
      .get('/booking/pros/nearby')
      .set('Authorization', `Bearer ${riderToken}`)
      .query({ lng: biarritz.lng, radiusKm: 40 })
      .expect(400);

    expect(res.body.error).toBe('FRANCE_ONLY_INCOMPLETE_LOCATION');
    expect(nearbySpy).not.toHaveBeenCalled();
  });

  it('keeps non-geolocated booking routes unchanged', async () => {
    const res = await riderSession
      .get('/booking/requests/me')
      .set('Authorization', `Bearer ${riderToken}`)
      .expect(200);

    expect(res.body).toEqual({ requests: [] });
  });

  it('rejects direct availability creation outside France before opening a write transaction', async () => {
    const transactionSpy = jest.spyOn(prisma, '$transaction');

    const res = await proSession
      .post('/booking/availability')
      .set('Authorization', `Bearer ${proToken}`)
      .send(buildAvailabilityPayload({ spotLat: geneva.lat, spotLng: geneva.lng }))
      .expect(403);

    expect(res.body.error).toBe('FRANCE_ONLY_RESTRICTED');
    expect(transactionSpy).not.toHaveBeenCalled();
  });

  it('rejects direct availability creation when the pro countryCode is non-FR', async () => {
    await prisma.proProfile.update({
      where: { userId: proUserId },
      data: { countryCode: 'CH', lat: biarritz.lat, lng: biarritz.lng },
    });

    const res = await proSession
      .post('/booking/availability')
      .set('Authorization', `Bearer ${proToken}`)
      .send(buildAvailabilityPayload())
      .expect(403);

    expect(res.body.error).toBe('FRANCE_ONLY_RESTRICTED');
    expect(res.body.details).toMatchObject({
      actualCountryCode: 'CH',
      expectedCountryCode: 'FR',
    });
  });

  describe('PATCH /booking/availability/:id France-only', () => {
    it('accepts FR coordinates', async () => {
      const availability = await createAvailability();

      const res = await proSession
        .patch(`/booking/availability/${availability.id}`)
        .set('Authorization', `Bearer ${proToken}`)
        .send({
          spotName: 'La Nord',
          spotLat: hossegor.lat,
          spotLng: hossegor.lng,
        })
        .expect(200);

      expect(res.body).toMatchObject({
        id: availability.id,
        spotName: 'La Nord',
        spotLat: hossegor.lat,
        spotLng: hossegor.lng,
      });

      const updatedAvailability = await prisma.proAvailability.findUnique({
        where: { id: availability.id },
        select: { spotName: true, spotLat: true, spotLng: true },
      });

      expect(updatedAvailability).toMatchObject({
        spotName: 'La Nord',
        spotLat: hossegor.lat,
        spotLng: hossegor.lng,
      });
    });

    it('rejects out-of-France coordinates before write or cache invalidation', async () => {
      const availability = await createAvailability();
      const transactionSpy = jest.spyOn(prisma, '$transaction');
      const invalidateSpy = jest.spyOn(cacheService, 'invalidateAvailabilities');

      const beforeUpdate = await prisma.proAvailability.findUnique({
        where: { id: availability.id },
        select: { spotName: true, spotLat: true, spotLng: true },
      });

      const res = await proSession
        .patch(`/booking/availability/${availability.id}`)
        .set('Authorization', `Bearer ${proToken}`)
        .send({
          spotName: 'Geneve',
          spotLat: geneva.lat,
          spotLng: geneva.lng,
        })
        .expect(403);

      expect(res.body.error).toBe('FRANCE_ONLY_RESTRICTED');
      expect(res.body.message).toContain('France');
      expect(transactionSpy).not.toHaveBeenCalled();
      expect(invalidateSpy).not.toHaveBeenCalled();

      const afterUpdate = await prisma.proAvailability.findUnique({
        where: { id: availability.id },
        select: { spotName: true, spotLat: true, spotLng: true },
      });

      expect(afterUpdate).toEqual(beforeUpdate);
    });

    it('rejects incomplete coordinates before write or cache invalidation', async () => {
      const availability = await createAvailability();
      const transactionSpy = jest.spyOn(prisma, '$transaction');
      const invalidateSpy = jest.spyOn(cacheService, 'invalidateAvailabilities');

      const res = await proSession
        .patch(`/booking/availability/${availability.id}`)
        .set('Authorization', `Bearer ${proToken}`)
        .send({
          spotLat: hossegor.lat,
        })
        .expect(400);

      expect(res.body.error).toBe('FRANCE_ONLY_INCOMPLETE_LOCATION');
      expect(transactionSpy).not.toHaveBeenCalled();
      expect(invalidateSpy).not.toHaveBeenCalled();

      const unchangedAvailability = await prisma.proAvailability.findUnique({
        where: { id: availability.id },
        select: { spotName: true, spotLat: true, spotLng: true },
      });

      expect(unchangedAvailability).toMatchObject({
        spotName: 'Cote des Basques',
        spotLat: biarritz.lat,
        spotLng: biarritz.lng,
      });
    });

    it('rejects updates on legacy outside-France availability even without coordinate changes', async () => {
      const availability = await createAvailability();
      await prisma.proAvailability.update({
        where: { id: availability.id },
        data: {
          spotLat: geneva.lat,
          spotLng: geneva.lng,
        },
      });

      const invalidateSpy = jest.spyOn(cacheService, 'invalidateAvailabilities');

      const res = await proSession
        .patch(`/booking/availability/${availability.id}`)
        .set('Authorization', `Bearer ${proToken}`)
        .send({
          spotName: 'Toujours bloque',
        })
        .expect(403);

      expect(res.body.error).toBe('FRANCE_ONLY_RESTRICTED');
      expect(res.body.message).toContain('France');
      expect(invalidateSpy).not.toHaveBeenCalled();

      const unchangedAvailability = await prisma.proAvailability.findUnique({
        where: { id: availability.id },
        select: { spotName: true, spotLat: true, spotLng: true },
      });

      expect(unchangedAvailability).toMatchObject({
        spotName: 'Cote des Basques',
        spotLat: geneva.lat,
        spotLng: geneva.lng,
      });
    });
  });
});
