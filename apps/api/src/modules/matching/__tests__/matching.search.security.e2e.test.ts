import { createApp } from '../../../index';
import { clientPrisma as prisma, Role } from '@blobinfini/database';
import { getAccessToken, TestSession } from '../../../tests/helpers/auth';
import { resetDb } from '../../../test-utils/resetDb';

describe('POST /matching/search security & safety', () => {
  const app = createApp();
  const makeUuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

  let riderSession: TestSession;
  let riderAccessToken = '';
  let riderUserId = '';

  let proSession: TestSession;
  let proAccessToken = '';

  beforeEach(async () => {
    await resetDb();

    const riderEmail = `matching-search-rider-${Date.now()}@test.com`;
    const proEmail = `matching-search-pro-${Date.now()}@test.com`;

    const riderAuth = await getAccessToken({
      app,
      email: riderEmail,
      role: Role.RIDER,
    });
    riderSession = riderAuth.session;
    riderAccessToken = riderAuth.accessToken;
    riderUserId = riderAuth.userId;

    const proAuth = await getAccessToken({
      app,
      email: proEmail,
      role: Role.PRO,
    });
    proSession = proAuth.session;
    proAccessToken = proAuth.accessToken;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('happy: returns 200 and normalized matching payload for rider', async () => {
    const res = await riderSession
      .post('/matching/search')
      .set('Authorization', `Bearer ${riderAccessToken}`)
      .send({ sport: 'surf', level: 'beginner', date: '2025-09-04', limit: 20 })
      .expect(200);

    expect(res.body).toHaveProperty('criteria');
    expect(Array.isArray(res.body.results)).toBe(true);
    expect(res.body).toHaveProperty('hasMore');
  });

  it('returns generic empty result when profile has no lat/lng (no existence oracle)', async () => {
    const res = await riderSession
      .post('/matching/search')
      .set('Authorization', `Bearer ${riderAccessToken}`)
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
      .set('Authorization', `Bearer ${riderAccessToken}`)
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
      .set('Authorization', `Bearer ${riderAccessToken}`)
      .send({ sport: 'surf', level: 'beginner', date: '2025-09-04' })
      .expect(200);

    expect(withStoredLocation.body.error).toBeUndefined();
    expect(withoutStoredLocation.body.error).toBeUndefined();
    expect(withStoredLocation.body.results).toEqual([]);
    expect(withoutStoredLocation.body.results).toEqual([]);
    expect(withStoredLocation.body.criteria?.location ?? null).toBeNull();
    expect(withoutStoredLocation.body.criteria?.location ?? null).toBeNull();
  });

  it('abuse/IDOR: forbids PRO role on search endpoint', async () => {
    await proSession
      .post('/matching/search')
      .set('Authorization', `Bearer ${proAccessToken}`)
      .send({ sport: 'surf', level: 'beginner', date: '2025-09-04' })
      .expect(403);
  });

  it('abuse/replay: same search replay does not duplicate LastSearch row', async () => {
    const payload = { sport: 'kitesurf', level: 'advanced', date: '2025-09-05', distanceKm: 25 };

    await riderSession
      .post('/matching/search')
      .set('Authorization', `Bearer ${riderAccessToken}`)
      .send(payload)
      .expect(200);

    await riderSession
      .post('/matching/search')
      .set('Authorization', `Bearer ${riderAccessToken}`)
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
      .set('Authorization', `Bearer ${riderAccessToken}`)
      .send({ sport: 'surf', level: 'beginner', date: '2025-09-04', limit: 101 })
      .expect(400);
  });

  it('rejects excludeIds payload larger than 200 entries', async () => {
    const tooManyExcludeIds = Array.from({ length: 201 }, (_, i) => makeUuid(i + 1));

    await riderSession
      .post('/matching/search')
      .set('Authorization', `Bearer ${riderAccessToken}`)
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
      .set('Authorization', `Bearer ${riderAccessToken}`)
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
      .set('Authorization', `Bearer ${riderAccessToken}`)
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
      .set('Authorization', `Bearer ${riderAccessToken}`)
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

  it.todo('returns 413 (not 500) when request body exceeds global parser limit');
});
