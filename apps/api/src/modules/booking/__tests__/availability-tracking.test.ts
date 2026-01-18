import { clientPrisma as prisma, Role } from '@blobinfini/database';
import { createApp } from '../../../index';
import { getAccessToken, TestSession } from '../../../tests/helpers/auth';
import type { CreateAvailabilityInput } from '../dto/createAvailability.dto';

const app = createApp();

describe('Availability Tracking', () => {
  let proToken = '';
  let proSession: TestSession;
  let proUserId = '';
  let riderToken = '';
  let riderSession: TestSession;
  let riderUserId = '';
  let riderToken2 = '';
  let riderSession2: TestSession;
  let riderUserId2 = '';

  const seedActors = async () => {
    await prisma.proAvailabilityInteraction.deleteMany();
    await prisma.booking.deleteMany();
    await prisma.bookingRequest.deleteMany();
    await prisma.proAvailability.deleteMany();
    await prisma.user.deleteMany({
      where: {
        email: {
          in: ['pro-tracking@test.com', 'rider-tracking@test.com', 'rider-tracking-2@test.com']
        }
      }
    });

    const proAuth = await getAccessToken({
      app,
      email: 'pro-tracking@test.com',
      role: Role.PRO
    });
    proToken = proAuth.accessToken;
    proSession = proAuth.session;
    proUserId = proAuth.userId;
    await prisma.proProfile.upsert({
      where: { userId: proUserId },
      create: { userId: proUserId, lat: 43.493, lng: -1.558, verified: true },
      update: { lat: 43.493, lng: -1.558 },
    });

    const riderAuth = await getAccessToken({
      app,
      email: 'rider-tracking@test.com',
      role: Role.RIDER
    });
    riderToken = riderAuth.accessToken;
    riderSession = riderAuth.session;
    riderUserId = riderAuth.userId;

    const riderAuth2 = await getAccessToken({
      app,
      email: 'rider-tracking-2@test.com',
      role: Role.RIDER
    });
    riderToken2 = riderAuth2.accessToken;
    riderSession2 = riderAuth2.session;
    riderUserId2 = riderAuth2.userId;
  };

  beforeEach(async () => {
    await seedActors();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const createAvailability = async (overrides: Partial<CreateAvailabilityInput> = {}) => {
    const payload: CreateAvailabilityInput = {
      sport: 'surf',
      levels: ['beginner', 'intermediate'],
      startAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      endAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      capacity: 5,
      spotName: 'Plage Test',
      spotLat: 43.493,
      spotLng: -1.558,
      ...overrides
    };

    const res = await proSession
      .post('/booking/availability')
      .set('Authorization', `Bearer ${proToken}`)
      .send(payload)
      .expect(201);

    return res.body;
  };

  describe('POST /booking/availability/:id/track', () => {
    it('allows a rider to track a VIEW event', async () => {
      const availability = await createAvailability();

      await riderSession
        .post(`/booking/availability/${availability.id}/track`)
        .set('Authorization', `Bearer ${riderToken}`)
        .send({ eventType: 'VIEW' })
        .expect(204);

      const interaction = await prisma.proAvailabilityInteraction.findFirst({
        where: {
          availabilityId: availability.id,
          riderUserId,
          eventType: 'VIEW'
        }
      });

      expect(interaction).toBeTruthy();
      expect(interaction?.eventType).toBe('VIEW');
    });

    it('allows a rider to track a CLICK event', async () => {
      const availability = await createAvailability();

      await riderSession
        .post(`/booking/availability/${availability.id}/track`)
        .set('Authorization', `Bearer ${riderToken}`)
        .send({ eventType: 'CLICK' })
        .expect(204);

      const interaction = await prisma.proAvailabilityInteraction.findFirst({
        where: {
          availabilityId: availability.id,
          riderUserId,
          eventType: 'CLICK'
        }
      });

      expect(interaction).toBeTruthy();
      expect(interaction?.eventType).toBe('CLICK');
    });

    it('is idempotent (same event tracked twice creates only one record)', async () => {
      const availability = await createAvailability();

      await riderSession
        .post(`/booking/availability/${availability.id}/track`)
        .set('Authorization', `Bearer ${riderToken}`)
        .send({ eventType: 'VIEW' })
        .expect(204);

      await riderSession
        .post(`/booking/availability/${availability.id}/track`)
        .set('Authorization', `Bearer ${riderToken}`)
        .send({ eventType: 'VIEW' })
        .expect(204);

      const interactions = await prisma.proAvailabilityInteraction.findMany({
        where: {
          availabilityId: availability.id,
          riderUserId,
          eventType: 'VIEW'
        }
      });

      expect(interactions).toHaveLength(1);
    });

    it('prevents PRO from tracking their own availability', async () => {
      const availability = await createAvailability();

      const res = await proSession
        .post(`/booking/availability/${availability.id}/track`)
        .set('Authorization', `Bearer ${proToken}`)
        .send({ eventType: 'VIEW' })
        .expect(403);

      // The ensureRole('RIDER') middleware blocks PROs before reaching the service method
      expect(res.body.error).toBe('Forbidden');

      const interaction = await prisma.proAvailabilityInteraction.findFirst({
        where: {
          availabilityId: availability.id,
          riderUserId: proUserId
        }
      });

      expect(interaction).toBeNull();
    });

    it('returns 400 for invalid event type', async () => {
      const availability = await createAvailability();

      const res = await riderSession
        .post(`/booking/availability/${availability.id}/track`)
        .set('Authorization', `Bearer ${riderToken}`)
        .send({ eventType: 'INVALID' })
        .expect(400);

      expect(res.body.error).toBe('Invalid input');
    });

    it('returns 404 for non-existent availability', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';

      const res = await riderSession
        .post(`/booking/availability/${fakeId}/track`)
        .set('Authorization', `Bearer ${riderToken}`)
        .send({ eventType: 'VIEW' })
        .expect(404);

      expect(res.body.error).toBe('Availability not found');
    });

    it('requires RIDER role', async () => {
      const availability = await createAvailability();

      await proSession
        .post(`/booking/availability/${availability.id}/track`)
        .set('Authorization', `Bearer ${proToken}`)
        .send({ eventType: 'VIEW' })
        .expect(403);
    });
  });

  describe('GET /booking/availability/me/stats', () => {
    it('returns stats for PRO with no interactions', async () => {
      await createAvailability();
      await createAvailability({
        startAt: new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString(), // +25h (next day)
        endAt: new Date(Date.now() + 26 * 60 * 60 * 1000).toISOString(), // +26h (next day)
      });

      const res = await proSession
        .get('/booking/availability/me/stats')
        .set('Authorization', `Bearer ${proToken}`)
        .expect(200);

      expect(res.body.summary).toEqual({
        totalSlots: 2,
        totalViews: 0,
        totalClicks: 0,
        averageConversionRate: '0.0'
      });

      expect(res.body.slots).toHaveLength(2);
      expect(res.body.slots[0].stats).toEqual({
        uniqueViews: 0,
        uniqueClicks: 0,
        conversionRate: '0.0',
        lastInteractionAt: null,
        lastInteractionType: null
      });
    });

    it('calculates stats correctly with interactions', async () => {
      const availability1 = await createAvailability();
      const availability2 = await createAvailability({
        startAt: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
        endAt: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
      });

      // Availability 1: 2 riders view, 1 clicks
      await riderSession
        .post(`/booking/availability/${availability1.id}/track`)
        .set('Authorization', `Bearer ${riderToken}`)
        .send({ eventType: 'VIEW' });

      await riderSession2
        .post(`/booking/availability/${availability1.id}/track`)
        .set('Authorization', `Bearer ${riderToken2}`)
        .send({ eventType: 'VIEW' });

      await riderSession
        .post(`/booking/availability/${availability1.id}/track`)
        .set('Authorization', `Bearer ${riderToken}`)
        .send({ eventType: 'CLICK' });

      // Availability 2: 1 rider views, 1 clicks
      await riderSession
        .post(`/booking/availability/${availability2.id}/track`)
        .set('Authorization', `Bearer ${riderToken}`)
        .send({ eventType: 'VIEW' });

      await riderSession
        .post(`/booking/availability/${availability2.id}/track`)
        .set('Authorization', `Bearer ${riderToken}`)
        .send({ eventType: 'CLICK' });

      const res = await proSession
        .get('/booking/availability/me/stats')
        .set('Authorization', `Bearer ${proToken}`)
        .expect(200);

      expect(res.body.summary.totalSlots).toBe(2);
      expect(res.body.summary.totalViews).toBe(3); // 2 + 1
      expect(res.body.summary.totalClicks).toBe(2); // 1 + 1

      type AvailabilityStatsSlotResponse = {
        availabilityId: string;
        stats: {
          uniqueViews: number;
          uniqueClicks: number;
          conversionRate: string;
          lastInteractionAt: string | Date | null;
          lastInteractionType: 'VIEW' | 'CLICK' | null;
        };
      };

      const slots: AvailabilityStatsSlotResponse[] = res.body.slots;

      // Find the slots in the response
      const slot1 = slots.find((s) => s.availabilityId === availability1.id)!;
      const slot2 = slots.find((s) => s.availabilityId === availability2.id)!;

      expect(slot1.stats.uniqueViews).toBe(2);
      expect(slot1.stats.uniqueClicks).toBe(1);
      expect(slot1.stats.conversionRate).toBe('50.0'); // 1/2 = 50%

      expect(slot2.stats.uniqueViews).toBe(1);
      expect(slot2.stats.uniqueClicks).toBe(1);
      expect(slot2.stats.conversionRate).toBe('100.0'); // 1/1 = 100%

      // Average conversion rate: (50 + 100) / 2 = 75
      expect(res.body.summary.averageConversionRate).toBe('75.0');
    });

    it('counts unique riders correctly', async () => {
      const availability = await createAvailability();

      // Same rider tracks VIEW twice (idempotence)
      await riderSession
        .post(`/booking/availability/${availability.id}/track`)
        .set('Authorization', `Bearer ${riderToken}`)
        .send({ eventType: 'VIEW' });

      await riderSession
        .post(`/booking/availability/${availability.id}/track`)
        .set('Authorization', `Bearer ${riderToken}`)
        .send({ eventType: 'VIEW' });

      const res = await proSession
        .get('/booking/availability/me/stats')
        .set('Authorization', `Bearer ${proToken}`)
        .expect(200);

      const slot = (res.body.slots as Array<{ availabilityId: string; stats: { uniqueViews: number } }>).find(
        (s) => s.availabilityId === availability.id
      );
      expect(slot.stats.uniqueViews).toBe(1); // Only 1 unique rider
    });

    it('includes last interaction details', async () => {
      const availability = await createAvailability();

      await riderSession
        .post(`/booking/availability/${availability.id}/track`)
        .set('Authorization', `Bearer ${riderToken}`)
        .send({ eventType: 'VIEW' });

      // Wait a bit to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, 100));

      await riderSession
        .post(`/booking/availability/${availability.id}/track`)
        .set('Authorization', `Bearer ${riderToken}`)
        .send({ eventType: 'CLICK' });

      const res = await proSession
        .get('/booking/availability/me/stats')
        .set('Authorization', `Bearer ${proToken}`)
        .expect(200);

      const slot = (res.body.slots as Array<{
        availabilityId: string;
        stats: { lastInteractionType: string | null; lastInteractionAt: string | null };
      }>).find((s) => s.availabilityId === availability.id);
      expect(slot.stats.lastInteractionType).toBe('CLICK'); // Most recent
      expect(slot.stats.lastInteractionAt).toBeTruthy();
    });

    it('requires PRO role', async () => {
      await riderSession
        .get('/booking/availability/me/stats')
        .set('Authorization', `Bearer ${riderToken}`)
        .expect(403);
    });
  });
});
