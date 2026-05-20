/**
 * Tests d'intégration — guard re-fanout dans PUT /profile/me
 *
 * Valide :
 *   - Fanout NON déclenché si coords inchangées (distance < 100 m)
 *   - Fanout déclenché si déplacement > 100 m (triggerReason = LOCATION_CHANGED)
 *   - Fanout déclenché si changement de sport (triggerReason = SPORT_CHANGED)
 *   - Fanout déclenché si wantsLesson false → true (triggerReason = ACTIVATED)
 *   - Fanout NON déclenché si lessonSport absent/null (log LESSON_FANOUT_SKIPPED_NO_SPORT)
 *   - Fanout NON déclenché si seuls les champs non-lesson changent (bio, etc.)
 *
 * Stratégie : mock notifyNearbyProsForLessonSilent à module-level via jest.mock.
 * Auth : getAccessToken (login réel) + session object (CSRF auto).
 * Coordonnées : côte aquitaine (France) pour passer assertFranceLaunchLocationInput.
 */

import { clientPrisma as prisma, Role } from '@blobinfini/database';
import { createApp } from '../../../index';
import { getAccessToken, TestSession } from '../../../tests/helpers/auth';
import { resetDb } from '../../../test-utils/resetDb';

// ─── Mock du service fanout ───────────────────────────────────────────────────

const mockFanoutSilent = jest.fn();

jest.mock('../../../services/lesson-notification.service', () => {
  const original = jest.requireActual(
    '../../../services/lesson-notification.service',
  ) as typeof import('../../../services/lesson-notification.service');
  return {
    ...original,
    notifyNearbyProsForLessonSilent: (...args: unknown[]) => mockFanoutSilent(...args),
  };
});

// ─── App + helpers ────────────────────────────────────────────────────────────

const app = createApp();

/** Coordonnées de référence (Lacanau, France) — passent assertFranceLaunchLocationInput. */
const BASE_LAT = 45.0037;
const BASE_LNG = -1.0786;

/**
 * Décale de ~200 m vers le nord (> seuil 100 m Haversine).
 * Δlat ≈ 200m / 111_000 ≈ 0.0018°
 */
const FAR_LAT = BASE_LAT + 0.002;
const FAR_LNG = BASE_LNG;

/**
 * Décale de ~10 m vers le nord (< seuil 100 m Haversine).
 * Δlat ≈ 10m / 111_000 ≈ 0.00009°
 */
const NEAR_LAT = BASE_LAT + 0.00009;
const NEAR_LNG = BASE_LNG;

let riderSession: TestSession;
let riderId: string;

beforeEach(async () => {
  await resetDb();
  jest.clearAllMocks();

  const ts = Date.now();
  const auth = await getAccessToken({
    app,
    email: `fanout-guard-${ts}@test.com`,
    role: Role.RIDER,
  });
  riderSession = auth.session;
  riderId = auth.userId;
});

afterAll(async () => {
  await prisma.$disconnect();
});

// ─── Cas 1 — wantsLesson false → true ────────────────────────────────────────

describe('Fanout — activation initiale (false → true)', () => {
  it('déclenche le fanout avec triggerReason ACTIVATED', async () => {
    const res = await riderSession.put('/profile/me').send({
      wantsLesson: true,
      lessonLat: BASE_LAT,
      lessonLng: BASE_LNG,
      lessonSport: 'surf',
    });

    expect(res.status).toBe(200);
    expect(mockFanoutSilent).toHaveBeenCalledTimes(1);
    expect(mockFanoutSilent).toHaveBeenCalledWith(
      expect.objectContaining({ triggerReason: 'ACTIVATED' }),
    );
  });

  it('ne déclenche PAS le fanout si wantsLesson=true sans sport', async () => {
    const res = await riderSession.put('/profile/me').send({
      wantsLesson: true,
      lessonLat: BASE_LAT,
      lessonLng: BASE_LNG,
      lessonSport: null,
    });

    expect(res.status).toBe(200);
    expect(mockFanoutSilent).not.toHaveBeenCalled();
  });
});

// ─── Cas 2 — Coordonnées inchangées → pas de fanout ──────────────────────────

describe('Fanout — coordonnées inchangées (< 100 m)', () => {
  it('ne déclenche PAS le fanout si PUT répété avec mêmes coords et même sport', async () => {
    // Seed : profil déjà actif avec coords de référence
    await prisma.riderProfile.upsert({
      where: { userId: riderId },
      create: {
        userId: riderId,
        wantsLesson: true,
        lessonLat: BASE_LAT,
        lessonLng: BASE_LNG,
        lessonSport: 'surf',
      },
      update: {
        wantsLesson: true,
        lessonLat: BASE_LAT,
        lessonLng: BASE_LNG,
        lessonSport: 'surf',
      },
    });

    // Second PUT avec mêmes valeurs → guard bloque
    const res = await riderSession.put('/profile/me').send({
      wantsLesson: true,
      lessonLat: BASE_LAT,
      lessonLng: BASE_LNG,
      lessonSport: 'surf',
    });

    expect(res.status).toBe(200);
    expect(mockFanoutSilent).not.toHaveBeenCalled();
  });

  it('ne déclenche PAS le fanout si déplacement < 100 m (~10 m)', async () => {
    await prisma.riderProfile.upsert({
      where: { userId: riderId },
      create: { userId: riderId, wantsLesson: true, lessonLat: BASE_LAT, lessonLng: BASE_LNG, lessonSport: 'surf' },
      update: { wantsLesson: true, lessonLat: BASE_LAT, lessonLng: BASE_LNG, lessonSport: 'surf' },
    });

    const res = await riderSession.put('/profile/me').send({
      wantsLesson: true,
      lessonLat: NEAR_LAT,  // ~10 m de BASE_LAT
      lessonLng: NEAR_LNG,
      lessonSport: 'surf',
    });

    expect(res.status).toBe(200);
    expect(mockFanoutSilent).not.toHaveBeenCalled();
  });
});

// ─── Cas 3 — Déplacement > 100 m ─────────────────────────────────────────────

describe('Fanout — déplacement géographique > 100 m', () => {
  it('déclenche le fanout avec triggerReason LOCATION_CHANGED', async () => {
    await prisma.riderProfile.upsert({
      where: { userId: riderId },
      create: { userId: riderId, wantsLesson: true, lessonLat: BASE_LAT, lessonLng: BASE_LNG, lessonSport: 'surf' },
      update: { wantsLesson: true, lessonLat: BASE_LAT, lessonLng: BASE_LNG, lessonSport: 'surf' },
    });

    const res = await riderSession.put('/profile/me').send({
      wantsLesson: true,
      lessonLat: FAR_LAT,  // ~220 m de BASE_LAT
      lessonLng: FAR_LNG,
      lessonSport: 'surf',
    });

    expect(res.status).toBe(200);
    expect(mockFanoutSilent).toHaveBeenCalledTimes(1);
    expect(mockFanoutSilent).toHaveBeenCalledWith(
      expect.objectContaining({ triggerReason: 'LOCATION_CHANGED' }),
    );
  });
});

// ─── Cas 4 — Changement de sport ─────────────────────────────────────────────

describe('Fanout — changement de sport', () => {
  it('déclenche le fanout avec triggerReason SPORT_CHANGED si surf → kitesurf', async () => {
    await prisma.riderProfile.upsert({
      where: { userId: riderId },
      create: { userId: riderId, wantsLesson: true, lessonLat: BASE_LAT, lessonLng: BASE_LNG, lessonSport: 'surf' },
      update: { wantsLesson: true, lessonLat: BASE_LAT, lessonLng: BASE_LNG, lessonSport: 'surf' },
    });

    const res = await riderSession.put('/profile/me').send({
      wantsLesson: true,
      lessonLat: BASE_LAT,
      lessonLng: BASE_LNG,
      lessonSport: 'kitesurf', // changement
    });

    expect(res.status).toBe(200);
    expect(mockFanoutSilent).toHaveBeenCalledTimes(1);
    expect(mockFanoutSilent).toHaveBeenCalledWith(
      expect.objectContaining({ triggerReason: 'SPORT_CHANGED' }),
    );
  });

  it('ne déclenche PAS le fanout si lessonSport est null même avec coords nouvelles', async () => {
    await prisma.riderProfile.upsert({
      where: { userId: riderId },
      create: { userId: riderId, wantsLesson: true, lessonLat: BASE_LAT, lessonLng: BASE_LNG, lessonSport: 'surf' },
      update: { wantsLesson: true, lessonLat: BASE_LAT, lessonLng: BASE_LNG, lessonSport: 'surf' },
    });

    const res = await riderSession.put('/profile/me').send({
      wantsLesson: true,
      lessonLat: FAR_LAT,
      lessonLng: FAR_LNG,
      lessonSport: null, // sport absent → fanout bloqué quelle que soit la distance
    });

    expect(res.status).toBe(200);
    expect(mockFanoutSilent).not.toHaveBeenCalled();
  });
});

// ─── Cas 5 — Champs non-lesson inchangés ─────────────────────────────────────

describe('Fanout — mise à jour hors-lesson (bio, displayName, etc.)', () => {
  it('ne déclenche PAS le fanout si seul le displayName change', async () => {
    await prisma.riderProfile.upsert({
      where: { userId: riderId },
      create: { userId: riderId, wantsLesson: true, lessonLat: BASE_LAT, lessonLng: BASE_LNG, lessonSport: 'surf' },
      update: { wantsLesson: true, lessonLat: BASE_LAT, lessonLng: BASE_LNG, lessonSport: 'surf' },
    });

    const res = await riderSession.put('/profile/me').send({
      displayName: 'Nouveau prénom',
      // pas de champs lesson → wantsLesson non soumis → lessonNowActive = false
    });

    expect(res.status).toBe(200);
    expect(mockFanoutSilent).not.toHaveBeenCalled();
  });
});

// ─── Cas 6 — fanout passe le bon lessonSport au service ──────────────────────

describe('Fanout — payload transmis au service', () => {
  it('passe riderId, lessonLat, lessonLng et lessonSport corrects', async () => {
    const res = await riderSession.put('/profile/me').send({
      wantsLesson: true,
      lessonLat: BASE_LAT,
      lessonLng: BASE_LNG,
      lessonSport: 'kitesurf',
    });

    expect(res.status).toBe(200);
    expect(mockFanoutSilent).toHaveBeenCalledWith(
      expect.objectContaining({
        riderId: riderId,
        lessonLat: BASE_LAT,
        lessonLng: BASE_LNG,
        lessonSport: 'kitesurf',
        triggerReason: 'ACTIVATED',
      }),
    );
  });
});
