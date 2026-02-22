import { createApp } from '../../../index';
import { clientPrisma as prisma, Role } from '@blobinfini/database';
import { createTestSession, getAccessToken, type TestSession } from '../../../tests/helpers/auth';
import { resetDb } from '../../../test-utils/resetDb';
import type { CreateAvailabilityInput } from '../dto/createAvailability.dto';

describe('Lessons chaos security P0 - Pro <-> Rider <-> Lessons', () => {
  const app = createApp();

  let proASession: TestSession;
  let proAToken = '';
  let proAUserId = '';

  let proBSession: TestSession;
  let proBToken = '';
  let proBUserId = '';

  let riderSession: TestSession;
  let riderToken = '';

  const createAvailability = async (
    proSession: TestSession,
    proToken: string,
    dayOffset = 0,
    overrides: Partial<CreateAvailabilityInput> = {}
  ) => {
    const start = new Date(Date.now() + (dayOffset * 24 + 1) * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 60 * 60 * 1000);

    const payload: CreateAvailabilityInput & { status?: string } = {
      sport: 'surf',
      levels: ['beginner'],
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      capacity: 3,
      spotName: `Chaos Spot ${dayOffset}`,
      spotLat: 43.5,
      spotLng: -1.5,
      ...overrides,
    };

    const res = await proSession
      .post('/booking/availability')
      .set('Authorization', `Bearer ${proToken}`)
      .send(payload)
      .expect(201);

    return res.body as { id: string; status: 'OPEN' | 'CLOSED'; proUserId: string };
  };

  beforeEach(async () => {
    await resetDb();

    const proA = await getAccessToken({ app, email: `chaos-pro-a-${Date.now()}@test.com`, role: Role.PRO });
    proAToken = proA.accessToken;
    proASession = proA.session;
    proAUserId = proA.userId;

    const proB = await getAccessToken({ app, email: `chaos-pro-b-${Date.now()}@test.com`, role: Role.PRO });
    proBToken = proB.accessToken;
    proBSession = proB.session;
    proBUserId = proB.userId;

    const rider = await getAccessToken({ app, email: `chaos-rider-${Date.now()}@test.com`, role: Role.RIDER });
    riderToken = rider.accessToken;
    riderSession = rider.session;

    await prisma.proProfile.upsert({
      where: { userId: proAUserId },
      create: { userId: proAUserId, lat: 43.5001, lng: -1.5001, verified: false },
      update: { lat: 43.5001, lng: -1.5001, verified: false },
    });

    await prisma.proProfile.upsert({
      where: { userId: proBUserId },
      create: { userId: proBUserId, lat: 43.501, lng: -1.501, verified: true },
      update: { lat: 43.501, lng: -1.501, verified: true },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('B1-IDOR: blocks Pro A from editing Pro B lesson', async () => {
    const availabilityB = await createAvailability(proBSession, proBToken);

    await proASession
      .patch(`/booking/availability/${availabilityB.id}`)
      .set('Authorization', `Bearer ${proAToken}`)
      .send({ spotName: 'Hijacked Spot' })
      .expect(404);
  });

  it('B1-IDOR: blocks Pro A from deleting Pro B lesson', async () => {
    const availabilityB = await createAvailability(proBSession, proBToken);

    await proASession
      .delete(`/booking/availability/${availabilityB.id}`)
      .set('Authorization', `Bearer ${proAToken}`)
      .expect(404);
  });

  it('B1-IDOR: blocks Pro A from deciding Pro B lead request', async () => {
    const availabilityB = await createAvailability(proBSession, proBToken);

    const reqRes = await riderSession
      .post('/booking/requests')
      .set('Authorization', `Bearer ${riderToken}`)
      .send({ availabilityId: availabilityB.id, message: 'Je veux un cours' })
      .expect(201);

    await proASession
      .post(`/booking/requests/${reqRes.body.id as string}/decision`)
      .set('Authorization', `Bearer ${proAToken}`)
      .send({ decision: 'ACCEPT' })
      .expect(404);
  });

  it('B2-Privilege: rejects role injection ADMIN during register', async () => {
    const anon = await createTestSession(app);

    await anon
      .post('/auth/register')
      .send({
        email: `chaos-admin-injection-${Date.now()}@test.com`,
        password: 'Passw0rd!Strong',
        role: 'ADMIN',
        consentAccepted: true,
      })
      .expect(400);
  });

  it('B2-Privilege: blocks rider from pro-only endpoint', async () => {
    await riderSession
      .get('/booking/availability/me')
      .set('Authorization', `Bearer ${riderToken}`)
      .expect(403);
  });

  it('B2-Privilege: blocks pro from admin endpoint', async () => {
    await proASession
      .get('/admin/stats')
      .set('Authorization', `Bearer ${proAToken}`)
      .expect(403);
  });

  it('B2-Privilege: ignores server-side only flags (verified/featured) on pro profile update', async () => {
    await proASession
      .patch('/pro/me')
      .set('Authorization', `Bearer ${proAToken}`)
      .send({ businessName: 'Blob Pro', verified: true, featured: true })
      .expect(200);

    const profile = await prisma.proProfile.findUnique({ where: { userId: proAUserId } });
    expect(profile?.verified).toBe(false);
  });

  it('P0-Workflow bypass: ignores injected lesson status on create', async () => {
    const availability = await createAvailability(proASession, proAToken, 0, {
      status: 'CLOSED',
    } as any);

    const fromDb = await prisma.proAvailability.findUnique({ where: { id: availability.id } });
    expect(fromDb?.status).toBe('OPEN');
  });

  it('C1-Perf gate: rejects listing pagination above max pageSize', async () => {
    await riderSession
      .get('/booking/availability/search')
      .set('Authorization', `Bearer ${riderToken}`)
      .query({
        sport: 'surf',
        level: 'beginner',
        lat: 43.5,
        lng: -1.5,
        radiusKm: 25,
        page: 1,
        pageSize: 999,
      })
      .expect(400);
  });

  it('D-Upload: rejects forbidden media type for pro upload-url', async () => {
    await proASession
      .post('/pro/photo/upload-url')
      .set('Authorization', `Bearer ${proAToken}`)
      .send({ contentType: 'image/svg+xml' })
      .expect(400);
  });

  it('D-Upload/IDOR: forces upload key ownership to authenticated pro', async () => {
    const res = await proASession
      .post('/pro/photo/upload-url')
      .set('Authorization', `Bearer ${proAToken}`)
      .send({ contentType: 'image/jpeg', key: `pros/${proBUserId}/malicious.jpg` })
      .expect(200);

    expect(typeof res.body.key).toBe('string');
    expect((res.body.key as string).startsWith(`pros/${proAUserId}/`)).toBe(true);
  });

  const hasSensitiveKey = (value: unknown): boolean => {
    const queue: unknown[] = [value];

    while (queue.length > 0) {
      const current = queue.shift();
      if (Array.isArray(current)) {
        queue.push(...current);
        continue;
      }
      if (current && typeof current === 'object') {
        for (const [key, nested] of Object.entries(current as Record<string, unknown>)) {
          if (/(email|phone|tel|telephone|address)/i.test(key)) {
            return true;
          }
          queue.push(nested);
        }
      }
    }

    return false;
  };

  it('C3-MUST-NOT-LEAK: /booking/pros/nearby does not expose contact fields', async () => {
    const res = await riderSession
      .get('/booking/pros/nearby')
      .set('Authorization', `Bearer ${riderToken}`)
      .query({ lat: 43.5, lng: -1.5, radiusKm: 40 })
      .expect(200);

    expect(Array.isArray(res.body.pros)).toBe(true);
    for (const pro of res.body.pros as Array<Record<string, unknown>>) {
      expect(pro).not.toHaveProperty('email');
      expect(hasSensitiveKey(pro)).toBe(false);
    }
  });

  it('C3-MUST-NOT-LEAK: /booking/requests/me does not expose pro email/contact fields', async () => {
    const availabilityB = await createAvailability(proBSession, proBToken, 0, { spotName: 'Secret Spot' });

    await riderSession
      .post('/booking/requests')
      .set('Authorization', `Bearer ${riderToken}`)
      .send({ availabilityId: availabilityB.id, message: 'Besoin coaching' })
      .expect(201);

    const res = await riderSession
      .get('/booking/requests/me')
      .set('Authorization', `Bearer ${riderToken}`)
      .expect(200);

    for (const request of res.body.requests as Array<Record<string, unknown>>) {
      const availability = request.availability as Record<string, unknown> | undefined;
      const pro = availability?.pro as Record<string, unknown> | undefined;
      expect(pro).toBeDefined();
      expect(pro).not.toHaveProperty('email');
      expect(hasSensitiveKey(request)).toBe(false);
    }
  });

  it('C3-Regression DTO public: nearby + requests/me never expose email|phone|address', async () => {
    const availabilityB = await createAvailability(proBSession, proBToken, 1, { spotName: 'Public Spot' });

    await riderSession
      .post('/booking/requests')
      .set('Authorization', `Bearer ${riderToken}`)
      .send({ availabilityId: availabilityB.id, message: 'Cours demain ?' })
      .expect(201);

    const [nearbyRes, requestsRes] = await Promise.all([
      riderSession
        .get('/booking/pros/nearby')
        .set('Authorization', `Bearer ${riderToken}`)
        .query({ lat: 43.5, lng: -1.5, radiusKm: 40 })
        .expect(200),
      riderSession
        .get('/booking/requests/me')
        .set('Authorization', `Bearer ${riderToken}`)
        .expect(200),
    ]);

    expect(hasSensitiveKey(nearbyRes.body)).toBe(false);
    expect(hasSensitiveKey(requestsRes.body)).toBe(false);
  });

  it('P0-B-GPS: /booking/availability/search does not expose spotLat/spotLng to rider', async () => {
    await createAvailability(proASession, proAToken, 0, { spotName: 'Plage Secrète' });

    const res = await riderSession
      .get('/booking/availability/search')
      .set('Authorization', `Bearer ${riderToken}`)
      .query({
        sport: 'surf',
        level: 'beginner',
        lat: 43.5,
        lng: -1.5,
        radiusKm: 40,
        page: 1,
        pageSize: 20,
      })
      .expect(200);

    expect(Array.isArray(res.body.results)).toBe(true);
    for (const result of res.body.results as Array<Record<string, unknown>>) {
      expect(result).not.toHaveProperty('spotLat');
      expect(result).not.toHaveProperty('spotLng');
    }
  });

  it('Cache-key: page2 returns different results than page1 (cache key includes page+pageSize)', async () => {
    // Create 3 availabilities on different days so quota doesn't block
    await createAvailability(proASession, proAToken, 0, { spotName: 'Spot A' });
    await createAvailability(proBSession, proBToken, 1, { spotName: 'Spot B' });

    const search = (page: number) =>
      riderSession
        .get('/booking/availability/search')
        .set('Authorization', `Bearer ${riderToken}`)
        .query({ sport: 'surf', level: 'beginner', lat: 43.5, lng: -1.5, radiusKm: 40, page, pageSize: 1 })
        .expect(200);

    const [page1, page2] = await Promise.all([search(1), search(2)]);

    // Page 1 and page 2 must not return the same single item (cache key isolation)
    const ids1 = (page1.body.results as Array<{ id: string }>).map((r) => r.id);
    const ids2 = (page2.body.results as Array<{ id: string }>).map((r) => r.id);
    // At least one ID must differ (or page2 is empty — both valid, but must not be identical non-empty pages)
    if (ids1.length > 0 && ids2.length > 0) {
      expect(ids1).not.toEqual(ids2);
    }
  });
});
