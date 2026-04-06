/**
 * Tests e2e — dissociation localisation profil vs localisation demande de cours.
 *
 * Stratégie : MODE STRICT RÉEL.
 * wantsLesson=true sans lessonLat/lessonLng → 400 LESSON_COORDS_REQUIRED.
 * Pas de silently-excluded, pas de legacy silencieux.
 *
 * Règle produit :
 * - lessonPlace (texte) = label d'affichage uniquement, n'est PAS géocodé.
 * - Le pin BloboMap Pro est positionné sur lessonLat/lessonLng.
 * - Sans coords → rejet 400 à l'activation.
 *
 * Couvre :
 *  1. happy path : wantsLesson=true avec coords valides → visible sur la map
 *  2. strict : wantsLesson=true sans lessonLat ni lessonLng → 400
 *  3. strict : wantsLesson=true avec lessonLat seul (sans lessonLng) → 400
 *  4. strict : wantsLesson=true avec lessonLng seul (sans lessonLat) → 400
 *  5. rejet lessonLat hors bornes → 400
 *  6. rejet lessonLng hors bornes → 400
 *  7. coords hors France → 403 FRANCE_ONLY_RESTRICTED
 *  8. le pin utilise lessonLatApprox/lessonLngApprox (lieu cours), pas profile.lat/lng
 *  9. legacy en DB (wantsLesson=true, lessonLat=null) → absent de la map
 * 10. wantsLesson=false → coords effacées en DB + absent de la map
 * 11. France-only pro : pas de régression (coords pro hors France → 403)
 * 12. arrondi 3 décimales : lessonLatApprox/lessonLngApprox cohérents
 */

import { createApp } from '../../../index';
import { clientPrisma as prisma, Role } from '@blobinfini/database';
import { getAccessToken, TestSession } from '../../../tests/helpers/auth';
import { resetDb } from '../../../test-utils/resetDb';

// Spots réels en France — valides pour les tests
const LACANAU  = { lat: 45.003, lng: -1.198 }; // Lacanau Océan
const BIARRITZ = { lat: 43.483, lng: -1.558 }; // Pro position

// Hors France
const LONDON = { lat: 51.507, lng: -0.128 };

describe('near-lessons — lesson coords dissociation (mode strict)', () => {
  const app = createApp();

  let riderSession: TestSession;
  let proSession: TestSession;
  let riderUserId: string;

  beforeEach(async () => {
    await resetDb();

    const riderAuth = await getAccessToken({
      app,
      email: `rider-lesson-${Date.now()}@test.com`,
      role: Role.RIDER,
    });
    riderSession = riderAuth.session;
    riderUserId = riderAuth.userId;

    const proAuth = await getAccessToken({
      app,
      email: `pro-lesson-${Date.now()}@test.com`,
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

  // ── 1. Happy path ──────────────────────────────────────────────────────────
  it('affiche un rider sur la map avec coords valides', async () => {
    await riderSession.put('/profile/me').send({
      wantsLesson: true,
      lessonSport: 'surf',
      lessonLevel: 'beginner',
      lessonStudentCount: 1,
      lessonLat: LACANAU.lat,
      lessonLng: LACANAU.lng,
    }).expect(200);

    const res = await proSession
      .get('/pro/near/lessons?sport=surf&radiusKm=200')
      .expect(200);

    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].lessonLatApprox).toBeDefined();
    expect(res.body.items[0].lessonLngApprox).toBeDefined();
  });

  // ── 2. Strict : wantsLesson=true sans aucune coord → 400 ──────────────────
  it('rejette wantsLesson=true sans lessonLat ni lessonLng', async () => {
    const res = await riderSession.put('/profile/me').send({
      wantsLesson: true,
      lessonSport: 'surf',
      lessonLevel: 'beginner',
      lessonStudentCount: 1,
      // Cas "juste une ville" : lessonPlace sans coords → 400
      lessonPlace: 'Lacanau',
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('LESSON_COORDS_REQUIRED');
  });

  // ── 3. Strict : lessonLat sans lessonLng → 400 (both-or-none) ─────────────
  it('rejette lessonLat sans lessonLng', async () => {
    const res = await riderSession.put('/profile/me').send({
      wantsLesson: true,
      lessonSport: 'surf',
      lessonLevel: 'beginner',
      lessonStudentCount: 1,
      lessonLat: LACANAU.lat,
      // lessonLng absent
    });

    expect(res.status).toBe(400);
    // L'erreur vient du superRefine Zod (both-or-none)
    expect(JSON.stringify(res.body)).toMatch(/lessonLng/);
  });

  // ── 4. Strict : lessonLng sans lessonLat → 400 (both-or-none) ─────────────
  it('rejette lessonLng sans lessonLat', async () => {
    const res = await riderSession.put('/profile/me').send({
      wantsLesson: true,
      lessonSport: 'surf',
      lessonLevel: 'beginner',
      lessonStudentCount: 1,
      // lessonLat absent
      lessonLng: LACANAU.lng,
    });

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/lessonLat/);
  });

  // ── 5. lessonLat hors bornes ───────────────────────────────────────────────
  it('rejette lessonLat > 90', async () => {
    await riderSession.put('/profile/me').send({
      wantsLesson: true,
      lessonSport: 'surf',
      lessonLevel: 'beginner',
      lessonStudentCount: 1,
      lessonLat: 91,
      lessonLng: LACANAU.lng,
    }).expect(400);
  });

  it('rejette lessonLat < -90', async () => {
    await riderSession.put('/profile/me').send({
      wantsLesson: true,
      lessonSport: 'surf',
      lessonLevel: 'beginner',
      lessonStudentCount: 1,
      lessonLat: -91,
      lessonLng: LACANAU.lng,
    }).expect(400);
  });

  // ── 6. lessonLng hors bornes ───────────────────────────────────────────────
  it('rejette lessonLng > 180', async () => {
    await riderSession.put('/profile/me').send({
      wantsLesson: true,
      lessonSport: 'surf',
      lessonLevel: 'beginner',
      lessonStudentCount: 1,
      lessonLat: LACANAU.lat,
      lessonLng: 181,
    }).expect(400);
  });

  it('rejette lessonLng < -180', async () => {
    await riderSession.put('/profile/me').send({
      wantsLesson: true,
      lessonSport: 'surf',
      lessonLevel: 'beginner',
      lessonStudentCount: 1,
      lessonLat: LACANAU.lat,
      lessonLng: -181,
    }).expect(400);
  });

  // ── 7. Hors France → 403 ───────────────────────────────────────────────────
  it('rejette les coordonnées de cours hors France', async () => {
    const res = await riderSession.put('/profile/me').send({
      wantsLesson: true,
      lessonSport: 'surf',
      lessonLevel: 'beginner',
      lessonStudentCount: 1,
      lessonLat: LONDON.lat,
      lessonLng: LONDON.lng,
    });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/FRANCE_ONLY/);
  });

  // ── 8. Le pin est positionné sur le lieu cours, PAS sur profile.lat/lng ────
  it('le pin correspond au lieu cours, pas au profil rider', async () => {
    // Profil rider positionné à Biarritz, cours demandé à Lacanau
    await riderSession.put('/profile/me').send({
      lat: BIARRITZ.lat,
      lng: BIARRITZ.lng,
      wantsLesson: true,
      lessonSport: 'surf',
      lessonLevel: 'beginner',
      lessonStudentCount: 1,
      lessonLat: LACANAU.lat,
      lessonLng: LACANAU.lng,
    }).expect(200);

    const res = await proSession
      .get('/pro/near/lessons?sport=surf&radiusKm=200')
      .expect(200);

    expect(res.body.items).toHaveLength(1);
    const item = res.body.items[0];

    // Pin proche de Lacanau (±0.001 dû à l'arrondi 3 décimales)
    expect(Math.abs(item.lessonLatApprox - LACANAU.lat)).toBeLessThanOrEqual(0.001);
    expect(Math.abs(item.lessonLngApprox - LACANAU.lng)).toBeLessThanOrEqual(0.001);

    // Coordonnées brutes du profil NON exposées
    expect(item.lat).toBeUndefined();
    expect(item.lng).toBeUndefined();
  });

  // ── 9. Legacy en DB : wantsLesson=true sans lessonLat → absent de la map ──
  // (les riders existants ne sont pas bloqués par la migration — colonnes nullable
  // — mais leurs demandes n'apparaissent pas sur la map tant qu'ils ne re-soumettent
  // pas avec des coords. Comportement documenté et testé ici.)
  it('exclut de la map les riders legacy sans lessonLat/lessonLng', async () => {
    // Injection directe en DB pour simuler un rider pré-migration
    await prisma.riderProfile.upsert({
      where: { userId: riderUserId },
      create: {
        userId: riderUserId,
        wantsLesson: true,
        lessonSport: 'surf',
        lessonLevel: 'beginner',
        lessonStudentCount: 1,
        lat: LACANAU.lat,
        lng: LACANAU.lng,
        // lessonLat/lessonLng intentionnellement null — cas legacy
      },
      update: {
        wantsLesson: true,
        lessonSport: 'surf',
        lessonLevel: 'beginner',
        lessonStudentCount: 1,
        lat: LACANAU.lat,
        lng: LACANAU.lng,
        lessonLat: null,
        lessonLng: null,
      },
    });

    const res = await proSession
      .get('/pro/near/lessons?sport=surf&radiusKm=200')
      .expect(200);

    // Absent de la map — mode strict, pas de fallback sur profile.lat/lng
    expect(res.body.items).toHaveLength(0);
  });

  // ── 10. wantsLesson=false efface les coords + retire du map ────────────────
  it('efface lessonLat/lessonLng quand wantsLesson=false', async () => {
    await riderSession.put('/profile/me').send({
      wantsLesson: true,
      lessonSport: 'surf',
      lessonLevel: 'beginner',
      lessonStudentCount: 1,
      lessonLat: LACANAU.lat,
      lessonLng: LACANAU.lng,
    }).expect(200);

    await riderSession.put('/profile/me').send({
      wantsLesson: false,
      lessonSport: null,
      lessonLevel: null,
      lessonDate: null,
      lessonPlace: null,
      lessonStudentCount: null,
    }).expect(200);

    const rp = await prisma.riderProfile.findUnique({ where: { userId: riderUserId } });
    expect(rp?.wantsLesson).toBe(false);
    expect(rp?.lessonLat).toBeNull();
    expect(rp?.lessonLng).toBeNull();

    const res = await proSession
      .get('/pro/near/lessons?sport=surf&radiusKm=200')
      .expect(200);
    expect(res.body.items).toHaveLength(0);
  });

  // ── 11. France-only pro : pas de régression ────────────────────────────────
  it('le garde-fou France-only pro reste intact', async () => {
    await proSession.put('/pro/me').send({
      countryCode: 'FR',
      lat: LONDON.lat,
      lng: LONDON.lng,
    }).expect(403);
  });

  // ── 12. Arrondi 3 décimales ─────────────────────────────────────────────────
  it('retourne lessonLatApprox/lessonLngApprox arrondis à 3 décimales', async () => {
    // Coords avec plus de 3 décimales
    const preciseLat = 45.00347;
    const preciseLng = -1.19823;

    await riderSession.put('/profile/me').send({
      wantsLesson: true,
      lessonSport: 'surf',
      lessonLevel: 'beginner',
      lessonStudentCount: 1,
      lessonLat: preciseLat,
      lessonLng: preciseLng,
    }).expect(200);

    const res = await proSession
      .get('/pro/near/lessons?sport=surf&radiusKm=200')
      .expect(200);

    expect(res.body.items).toHaveLength(1);
    const { lessonLatApprox, lessonLngApprox } = res.body.items[0];

    // Doit être arrondi à 3 décimales
    expect(lessonLatApprox).toBe(Math.round(preciseLat * 1000) / 1000);
    expect(lessonLngApprox).toBe(Math.round(preciseLng * 1000) / 1000);

    // Ne doit PAS exposer plus de 3 décimales
    expect(String(lessonLatApprox).replace(/^\d+\.?/, '').length).toBeLessThanOrEqual(3);
    expect(String(lessonLngApprox).replace(/^-?\d+\.?/, '').length).toBeLessThanOrEqual(3);
  });
});
