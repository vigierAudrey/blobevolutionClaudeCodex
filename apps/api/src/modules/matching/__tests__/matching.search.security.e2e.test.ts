import { createApp } from '../../../index';
import { clientPrisma as prisma, Role } from '@blobinfini/database';
import { createTestSession, getAccessToken, TestSession } from '../../../tests/helpers/auth';
import { resetDb } from '../../../test-utils/resetDb';
import fs from 'fs';
import path from 'path';
import * as yaml from 'js-yaml';

describe('POST /matching/search security & safety', () => {
  const app = createApp();
  const makeUuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

  let riderSession: TestSession;
  let riderUserId = '';

  let proSession: TestSession;

  beforeEach(async () => {
    await resetDb();

    const riderEmail = `matching-search-rider-${Date.now()}@test.com`;
    const proEmail = `matching-search-pro-${Date.now()}@test.com`;

    const riderAuth = await getAccessToken({ app, email: riderEmail, role: Role.RIDER });
    riderSession = riderAuth.session;
    riderUserId = riderAuth.userId;

    const proAuth = await getAccessToken({ app, email: proEmail, role: Role.PRO });
    proSession = proAuth.session;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('auth: rejects unauthenticated access', async () => {
    const anonymousSession = await createTestSession(app);

    await anonymousSession
      .post('/matching/search')
      .send({ sport: 'surf', level: 'beginner', date: '2025-09-04' })
      .expect(401);
  });

  it('happy: returns 200 and normalized matching payload for rider', async () => {
    const res = await riderSession
      .post('/matching/search')
      .send({ sport: 'surf', level: 'beginner', date: '2025-09-04', limit: 20 })
      .expect(200);

    expect(res.body).toHaveProperty('criteria');
    expect(Array.isArray(res.body.results)).toBe(true);
    expect(res.body).toHaveProperty('hasMore');
  });

  it('returns generic empty result when profile has no lat/lng (no existence oracle)', async () => {
    const res = await riderSession
      .post('/matching/search')
      .send({ sport: 'surf', level: 'beginner', date: '2025-09-04' })
      .expect(200);

    expect(res.body.error).toBeUndefined();
    expect(Array.isArray(res.body.results)).toBe(true);
    expect(res.body.results).toHaveLength(0);
  });

  it('returns the same generic empty behavior when location is omitted, even if profile has stored lat/lng', async () => {
    await prisma.riderProfile.upsert({
      where: { userId: riderUserId },
      create: {
        userId: riderUserId,
        lat: 43.4832,
        lng: -1.5586,
      },
      update: {
        lat: 43.4832,
        lng: -1.5586,
      },
    });

    const withStoredLocation = await riderSession
      .post('/matching/search')
      .send({ sport: 'surf', level: 'beginner', date: '2025-09-04' })
      .expect(200);

    await prisma.lastSearch.deleteMany({ where: { userId: riderUserId } });
    await prisma.riderProfile.update({
      where: { userId: riderUserId },
      data: {
        lat: null,
        lng: null,
      },
    });

    const withoutStoredLocation = await riderSession
      .post('/matching/search')
      .send({ sport: 'surf', level: 'beginner', date: '2025-09-04' })
      .expect(200);

    expect(withStoredLocation.body.error).toBeUndefined();
    expect(withoutStoredLocation.body.error).toBeUndefined();
    expect(withStoredLocation.body.results).toEqual([]);
    expect(withoutStoredLocation.body.results).toEqual([]);
    expect(withStoredLocation.body.criteria?.location ?? null).toBeNull();
    expect(withoutStoredLocation.body.criteria?.location ?? null).toBeNull();
  });

  it('accepts France coordinates for geolocated matching search', async () => {
    const res = await riderSession
      .post('/matching/search')
      .send({
        sport: 'surf',
        level: 'beginner',
        date: '2025-09-04',
        location: { lat: 43.4832, lng: -1.5586 },
        distanceKm: 20,
      })
      .expect(200);

    expect(res.body.error).toBeUndefined();
    expect(res.body.criteria?.location).toEqual({ lat: 43.4832, lng: -1.5586 });

    const lastSearch = await prisma.lastSearch.findUnique({
      where: { userId: riderUserId },
      select: { lat: true, lng: true },
    });
    expect(lastSearch).toMatchObject({ lat: 43.4832, lng: -1.5586 });
  });

  it('rejects non-FR coordinates for geolocated matching search', async () => {
    const res = await riderSession
      .post('/matching/search')
      .send({
        sport: 'surf',
        level: 'beginner',
        date: '2025-09-04',
        location: { lat: 46.2044, lng: 6.1432 },
        distanceKm: 20,
      })
      .expect(403);

    expect(res.body.error).toBe('FRANCE_ONLY_RESTRICTED');
    expect(res.body.message).toContain('France');

    const lastSearchCount = await prisma.lastSearch.count({ where: { userId: riderUserId } });
    expect(lastSearchCount).toBe(0);
  });

  it('abuse/IDOR: forbids PRO role on search endpoint', async () => {
    await proSession
      .post('/matching/search')
      .send({ sport: 'surf', level: 'beginner', date: '2025-09-04' })
      .expect(403);
  });

  it('abuse/replay: same search replay does not duplicate LastSearch row', async () => {
    const payload = { sport: 'kitesurf', level: 'advanced', date: '2025-09-05', distanceKm: 25 };

    await riderSession
      .post('/matching/search')
      .send(payload)
      .expect(200);

    await riderSession
      .post('/matching/search')
      .send(payload)
      .expect(200);

    const lastSearchCount = await prisma.lastSearch.count({ where: { userId: riderUserId } });
    expect(lastSearchCount).toBe(1);

    const lastSearch = await prisma.lastSearch.findUnique({
      where: { userId: riderUserId },
      select: { sport: true, level: true, distanceKm: true },
    });
    expect(lastSearch).toMatchObject({ sport: 'kitesurf', level: 'advanced', distanceKm: 25 });
  });

  it('perf-safety: rejects limit > 100', async () => {
    await riderSession
      .post('/matching/search')
      .send({ sport: 'surf', level: 'beginner', date: '2025-09-04', limit: 101 })
      .expect(400);
  });

  it('rejects excludeIds payload larger than 200 entries', async () => {
    const tooManyExcludeIds = Array.from({ length: 201 }, (_, i) => makeUuid(i + 1));

    await riderSession
      .post('/matching/search')
      .send({
        sport: 'surf',
        level: 'beginner',
        date: '2025-09-04',
        excludeIds: tooManyExcludeIds,
      })
      .expect(400);
  });

  it('accepts excludeIds with duplicates/invalids after normalization', async () => {
    const validOne = makeUuid(1);
    const validTwo = makeUuid(2);

    await riderSession
      .post('/matching/search')
      .send({
        sport: 'kitesurf',
        level: 'advanced',
        date: '2025-09-05',
        excludeIds: [validOne, validOne, 'not-a-uuid', validTwo, 42, null],
      })
      .expect(200);

    const lastSearch = await prisma.lastSearch.findUnique({
      where: { userId: riderUserId },
      select: { sport: true, level: true, date: true },
    });
    expect(lastSearch?.sport).toBe('kitesurf');
    expect(lastSearch?.level).toBe('advanced');
    expect(lastSearch?.date).toBeTruthy();
  });

  it('perf-safety: large excludeIds array is rejected at validation layer', async () => {
    const hugeExcludeIds = Array.from({ length: 1000 }, (_, i) => makeUuid(i + 1));
    const res = await riderSession
      .post('/matching/search')
      .send({
        sport: 'surf',
        level: 'beginner',
        date: '2025-09-04',
        excludeIds: hugeExcludeIds,
      })
      .expect(400);

    expect(res.body.error).toBe('Invalid input');
    expect(Array.isArray(res.body.details)).toBe(true);
    expect(res.body.details[0]?.path).toContain('excludeIds');

    const lastSearchCount = await prisma.lastSearch.count({ where: { userId: riderUserId } });
    expect(lastSearchCount).toBe(0);
  });

  it('correctness: uppercase UUID in excludeIds is normalised to lowercase and the profile is excluded', async () => {
    // Create a second rider with coordinates + discipline so they can appear in search results
    const targetAuth = await getAccessToken({
      app,
      email: `matching-search-target-${Date.now()}@test.com`,
      role: Role.RIDER,
    });
    const targetUserId = targetAuth.userId;
    const targetProfile = await prisma.riderProfile.upsert({
      where: { userId: targetUserId },
      create: { userId: targetUserId, displayName: 'Target Rider', lat: 43.4832, lng: -1.5586 },
      update: { lat: 43.4832, lng: -1.5586 },
      select: { id: true },
    });
    await prisma.riderDiscipline.create({
      data: { profileId: targetProfile.id, sport: 'surf', level: 'beginner' },
    });

    const uppercaseExcludeId = targetProfile.id.toUpperCase();

    // Search near target's location; the target would appear if not excluded
    const res = await riderSession
      .post('/matching/search')
      .send({
        sport: 'surf',
        level: 'beginner',
        date: 'anytime',
        location: { lat: 43.4832, lng: -1.5586 },
        distanceKm: 5,
        excludeIds: [uppercaseExcludeId],
      })
      .expect(200);

    expect(res.body.error).toBeUndefined();
    const targetInResults = (res.body.results as Array<{ id: string }>).some(
      (r) => r.id === targetProfile.id,
    );
    expect(targetInResults).toBe(false);
  });

  it('pagination: keyset cursor traverses multiple pages without duplicates and ends with nextCursor=null', async () => {
    const now = Date.now();
    const centerLat = 43.4832;
    const centerLng = -1.5586;
    const bulkCount = 160;

    const users = Array.from({ length: bulkCount }, (_, i) => {
      const idx = i + 1;
      return {
        id: makeUuid(10_000 + idx),
        email: `matching-pagination-${now}-${idx}@test.com`,
        password: 'x',
        role: Role.RIDER,
        emailVerified: true,
        twoFactorEnabled: false,
      };
    });

    await prisma.user.createMany({ data: users, skipDuplicates: true });

    const profiles = users.map((u, i) => {
      const shift = (i % 40) / 5000; // <= ~8km spread around center
      return {
        id: makeUuid(20_000 + i + 1),
        userId: u.id,
        displayName: `Candidate ${i + 1}`,
        lat: centerLat + shift,
        lng: centerLng + shift,
      };
    });
    await prisma.riderProfile.createMany({ data: profiles, skipDuplicates: true });

    await prisma.riderDiscipline.createMany({
      data: profiles.map((p, i) => ({
        id: makeUuid(30_000 + i + 1),
        profileId: p.id,
        sport: 'surf',
        level: 'beginner',
      })),
      skipDuplicates: true,
    });

    let cursorToken: string | undefined;
    const collectedIds = new Set<string>();
    let reachedEnd = false;

    for (let i = 0; i < 10; i += 1) {
      const body: Record<string, unknown> = {
        sport: 'surf',
        level: 'beginner',
        date: 'anytime',
        location: { lat: centerLat, lng: centerLng },
        distanceKm: 40,
        limit: 25,
      };
      if (cursorToken) {
        body.cursor = cursorToken;
      }

      const res = await riderSession
        .post('/matching/search')
          .send(body)
        .expect(200);

      const pageIds = (res.body.results as Array<{ id: string }>).map((r) => r.id);
      pageIds.forEach((id) => {
        expect(collectedIds.has(id)).toBe(false);
        collectedIds.add(id);
      });

      if (!res.body.hasMore) {
        expect(res.body.nextCursor).toBeNull();
        reachedEnd = true;
        break;
      }

      expect(typeof res.body.nextCursor).toBe('string');
      expect(String(res.body.nextCursor)).not.toContain('offset:');
      cursorToken = res.body.nextCursor as string;
    }

    expect(reachedEnd).toBe(true);
    expect(collectedIds.size).toBeGreaterThan(100);
  });

  it('pagination: keyset stays stable when dataset changes between pages', async () => {
    const now = Date.now();
    const centerLat = 43.4832;
    const centerLng = -1.5586;
    const bulkCount = 80;

    const users = Array.from({ length: bulkCount }, (_, i) => {
      const idx = i + 1;
      return {
        id: makeUuid(40_000 + idx),
        email: `matching-pagination-stability-${now}-${idx}@test.com`,
        password: 'x',
        role: Role.RIDER,
        emailVerified: true,
        twoFactorEnabled: false,
      };
    });
    await prisma.user.createMany({ data: users, skipDuplicates: true });

    const profiles = users.map((u, i) => {
      const shift = (i % 20) / 5000;
      return {
        id: makeUuid(50_000 + i + 1),
        userId: u.id,
        displayName: `Stable ${i + 1}`,
        lat: centerLat + shift,
        lng: centerLng + shift,
      };
    });
    await prisma.riderProfile.createMany({ data: profiles, skipDuplicates: true });
    await prisma.riderDiscipline.createMany({
      data: profiles.map((p, i) => ({
        id: makeUuid(60_000 + i + 1),
        profileId: p.id,
        sport: 'surf',
        level: 'beginner',
      })),
      skipDuplicates: true,
    });

    const pageOne = await riderSession
      .post('/matching/search')
      .send({
        sport: 'surf',
        level: 'beginner',
        date: 'anytime',
        location: { lat: centerLat, lng: centerLng },
        distanceKm: 40,
        limit: 20,
        sortBy: 'distance',
      })
      .expect(200);

    expect(pageOne.body.hasMore).toBe(true);
    expect(typeof pageOne.body.nextCursor).toBe('string');

    const firstPageIds = (pageOne.body.results as Array<{ id: string }>).map((r) => r.id);
    const injectedUserId = makeUuid(70_001);
    const injectedProfileId = makeUuid(80_001);
    await prisma.user.create({
      data: {
        id: injectedUserId,
        email: `matching-injected-${now}@test.com`,
        password: 'x',
        role: Role.RIDER,
        emailVerified: true,
        twoFactorEnabled: false,
      },
    });
    await prisma.riderProfile.create({
      data: {
        id: injectedProfileId,
        userId: injectedUserId,
        displayName: 'Injected close profile',
        lat: centerLat,
        lng: centerLng,
      },
    });
    await prisma.riderDiscipline.create({
      data: {
        id: makeUuid(90_001),
        profileId: injectedProfileId,
        sport: 'surf',
        level: 'beginner',
      },
    });

    const pageTwo = await riderSession
      .post('/matching/search')
      .send({
        sport: 'surf',
        level: 'beginner',
        date: 'anytime',
        location: { lat: centerLat, lng: centerLng },
        distanceKm: 40,
        limit: 20,
        sortBy: 'distance',
        cursor: pageOne.body.nextCursor,
      })
      .expect(200);

    const secondPageIds = (pageTwo.body.results as Array<{ id: string }>).map((r) => r.id);
    secondPageIds.forEach((id) => expect(firstPageIds).not.toContain(id));
    expect(secondPageIds).not.toContain(injectedProfileId);
  });

  it('OpenAPI contract: matching search documents keyset pagination fields', () => {
    const specPath = path.resolve(process.cwd(), '../../docs/openapi/openapi.yaml');
    const doc = yaml.load(fs.readFileSync(specPath, 'utf-8')) as {
      components?: { schemas?: Record<string, any> };
    };

    const requestSchema = doc.components?.schemas?.MatchingSearchRequest;
    const responseSchema = doc.components?.schemas?.MatchingSearchResponse;

    expect(requestSchema).toBeDefined();
    expect(responseSchema).toBeDefined();
    expect(String(requestSchema.properties.cursor.description)).not.toContain('offset:');
    expect(responseSchema.properties).toHaveProperty('hasMore');
    expect(responseSchema.properties).toHaveProperty('nextCursor');
    expect(responseSchema.properties).toHaveProperty('page');
    expect(responseSchema.properties).toHaveProperty('pageSize');
    expect(responseSchema.properties.nextCursor.nullable).toBe(true);
  });

  it('returns 413 (not 500) when request body exceeds global parser limit', async () => {
    // Express json({ limit: '100kb' }) must return 413, not let Express default to 500.
    const oversizedBody = Buffer.alloc(110 * 1024, 'x').toString();
    const res = await riderSession
      .post('/matching/search')
      .set('Content-Type', 'application/json')
      .send(`{"sport":"surf","level":"beginner","date":"2025-09-04","overflow":"${oversizedBody}"}`)
      .buffer(true);
    expect(res.status).toBe(413);
  });
});
