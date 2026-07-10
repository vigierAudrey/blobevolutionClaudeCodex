/**
 * Tests e2e — hygiène des dates des demandes de cours (BloboMap).
 *
 * Règles produit :
 *   - Une demande dont lessonDate est passée n'apparaît plus sur la BloboMap,
 *     même si le job d'expiration n'a pas encore tourné (filtre SQL).
 *   - Une demande datée d'aujourd'hui ou dans le futur reste visible.
 *   - Une demande sans date reste visible (expirée par TTL via le job, pas ici).
 *   - PUT /profile/me refuse une lessonDate passée ou invalide → 400.
 *   - PUT /profile/me refuse wantsLesson=true sans lessonSport → 400.
 *   - Un PUT partiel (sans clé lessonDate) ne doit PAS effacer la date en DB
 *     (régression : l'ancien transform Zod renvoyait null sur clé absente).
 *
 * Les dates passées sont injectées directement en DB (l'API les refuse désormais)
 * pour simuler une demande devenue périmée avec le temps.
 */

import { createApp } from '../../../index';
import { clientPrisma as prisma, Role } from '@blobinfini/database';
import { getAccessToken, TestSession } from '../../../tests/helpers/auth';
import { resetDb } from '../../../test-utils/resetDb';

const LACANAU  = { lat: 45.003, lng: -1.198 };
const BIARRITZ = { lat: 43.483, lng: -1.558 };

const DAY_MS = 24 * 60 * 60 * 1000;
const todayUtcStr = () => new Date().toISOString().slice(0, 10);
const isoDate = (offsetDays: number) =>
  new Date(Date.now() + offsetDays * DAY_MS).toISOString().slice(0, 10);

describe('near-lessons — hygiène des dates (filtre map + validation PUT)', () => {
  const app = createApp();

  let riderSession: TestSession;
  let proSession: TestSession;
  let riderUserId: string;

  beforeEach(async () => {
    await resetDb();

    const riderAuth = await getAccessToken({
      app,
      email: `rider-datehyg-${Date.now()}@test.com`,
      role: Role.RIDER,
    });
    riderSession = riderAuth.session;
    riderUserId = riderAuth.userId;

    const proAuth = await getAccessToken({
      app,
      email: `pro-datehyg-${Date.now()}@test.com`,
      role: Role.PRO,
    });
    proSession = proAuth.session;

    await proSession.put('/pro/me').send({
      countryCode: 'FR',
      lat: BIARRITZ.lat,
      lng: BIARRITZ.lng,
      radiusKm: 200,
    }).expect(200);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const activateLesson = (extra: Record<string, unknown> = {}) =>
    riderSession.put('/profile/me').send({
      wantsLesson: true,
      lessonSport: 'surf',
      lessonLevel: 'beginner',
      lessonStudentCount: 1,
      lessonLat: LACANAU.lat,
      lessonLng: LACANAU.lng,
      ...extra,
    });

  const fetchMap = () =>
    proSession.get('/pro/near/lessons?sport=surf&radiusKm=200').expect(200);

  // ── Filtre map ──────────────────────────────────────────────────────────────

  it('exclut de la map une demande dont lessonDate est passée', async () => {
    await activateLesson().expect(200);

    // Simule le temps qui passe : la date glisse à hier, directement en DB.
    await prisma.riderProfile.update({
      where: { userId: riderUserId },
      data: { lessonDate: new Date(Date.now() - DAY_MS) },
    });

    const res = await fetchMap();
    expect(res.body.items).toHaveLength(0);
  });

  it('garde visible une demande datée d’aujourd’hui', async () => {
    await activateLesson({ lessonDate: todayUtcStr() }).expect(200);

    const res = await fetchMap();
    expect(res.body.items).toHaveLength(1);
  });

  it('garde visible une demande à date future', async () => {
    await activateLesson({ lessonDate: isoDate(15) }).expect(200);

    const res = await fetchMap();
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].lessonDate).toBeDefined();
  });

  it('garde visible une demande sans date (expiration TTL déléguée au job)', async () => {
    await activateLesson().expect(200);

    const res = await fetchMap();
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].lessonDate).toBeNull();
  });

  // ── Validation PUT ──────────────────────────────────────────────────────────

  it('rejette une lessonDate passée à l’activation (400)', async () => {
    const res = await activateLesson({ lessonDate: isoDate(-3) });

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/passé/);
  });

  it('rejette une lessonDate invalide (400, pas de 500 Prisma)', async () => {
    const res = await activateLesson({ lessonDate: 'not-a-date' });

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/invalide/);
  });

  it('accepte lessonDate null (clear explicite)', async () => {
    await activateLesson({ lessonDate: isoDate(5) }).expect(200);
    await activateLesson({ lessonDate: null }).expect(200);

    const rp = await prisma.riderProfile.findUnique({ where: { userId: riderUserId } });
    expect(rp?.lessonDate).toBeNull();
  });

  it('rejette wantsLesson=true sans lessonSport (400 LESSON_SPORT_REQUIRED)', async () => {
    const res = await riderSession.put('/profile/me').send({
      wantsLesson: true,
      lessonLevel: 'beginner',
      lessonStudentCount: 1,
      lessonLat: LACANAU.lat,
      lessonLng: LACANAU.lng,
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('LESSON_SPORT_REQUIRED');
  });

  // ── Non-régression : PUT partiel ────────────────────────────────────────────

  it('un PUT partiel sans clé lessonDate ne wipe pas la date en DB', async () => {
    await activateLesson({ lessonDate: isoDate(7) }).expect(200);

    // Update de profil sans aucun champ lesson (ex. page profil).
    await riderSession.put('/profile/me').send({ displayName: 'Rider Datehyg' }).expect(200);

    const rp = await prisma.riderProfile.findUnique({ where: { userId: riderUserId } });
    expect(rp?.lessonDate).not.toBeNull();
    expect(rp?.wantsLesson).toBe(true);
  });
});
