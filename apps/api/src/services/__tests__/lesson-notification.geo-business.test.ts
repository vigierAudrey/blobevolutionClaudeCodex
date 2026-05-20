/**
 * Tests métier géographiques — notifyNearbyProsForLesson
 *
 * Trois pros avec des rayons de service distincts sur la côte aquitaine :
 *
 *   Pro A — Lacanau   : lat=45.0037 N  lng=1.0786 W   rayon=30 km
 *   Pro B — Arcachon  : lat=44.6608 N  lng=1.1683 W   rayon=15 km
 *   Pro C — Hossegor  : lat=43.6667 N  lng=1.4167 W   rayon=20 km
 *
 * Stratégie : même structure de mocks que lesson-notification.unit.test.ts.
 * La distance réelle est calculée via Haversine dans chaque test pour déterminer
 * l'ensemble exact de pros éligibles, puis mockQueryRaw simule ce que PostGIS
 * retournerait. On vérifie que seuls ces pros reçoivent une notification.
 *
 * Tableau de validation (distances arrondies au km) :
 *
 * ┌──────────────────────┬────────────┬────────────┬────────────┬───────────────┐
 * │ Lieu demande (rider) │ A (30 km)  │ B (15 km)  │ C (20 km)  │ Notifiés      │
 * ├──────────────────────┼────────────┼────────────┼────────────┼───────────────┤
 * │ Lacanau              │  0 km  ✓   │ 39 km  ✗   │ 151 km ✗   │ A             │
 * │ Arcachon             │ 39 km  ✗   │  0 km  ✓   │ 112 km ✗   │ B             │
 * │ Hossegor             │ 151 km ✗   │ 112 km ✗   │  0 km  ✓   │ C             │
 * │ Lège-Cap-Ferret      │ 25 km  ✓   │ 14 km  ✓   │ 125 km ✗   │ A et B        │
 * │ Biscarrosse          │ 68 km  ✗   │ 30 km  ✗   │  80 km ✗   │ ∅ (personne)  │
 * │ Capbreton            │ 152 km ✗   │ 114 km ✗   │  3 km  ✓   │ C             │
 * │ Hourtin              │ 19 km  ✓   │ 58 km  ✗   │ 168 km ✗   │ A             │
 * └──────────────────────┴────────────┴────────────┴────────────┴───────────────┘
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { notifyNearbyProsForLesson } from '../lesson-notification.service';

// ─── Mocks (identique au fichier unit) ───────────────────────────────────────

const mockQueryRaw = jest.fn();

jest.mock('@blobinfini/database', () => ({
  clientPrisma: {
    $queryRaw: (...args: unknown[]) => mockQueryRaw(...args),
  },
  Prisma: {
    sql: jest.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
      strings,
      values,
      __prismaRawSql: true,
    })),
  },
}));

const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn();

jest.mock('../cache.service', () => ({
  cacheService: {
    getClient: jest.fn(() => ({
      get: (...args: unknown[]) => mockRedisGet(...args),
      set: (...args: unknown[]) => mockRedisSet(...args),
    })),
  },
}));

const mockCreateNotif = jest.fn();

jest.mock('../notification.service', () => ({
  NotificationType: {
    LESSON_REQUEST_NEARBY: 'LESSON_REQUEST_NEARBY',
  },
  createNotification: (...args: unknown[]) => mockCreateNotif(...args),
}));

jest.mock('../lesson-fanout.repository', () => ({
  hashRiderRef: (id: string) => `hash-${id}`,
  makeLessonRequestId: (id: string) => `req-${id}`,
  recordFanout: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../utils/secure-logger', () => ({
  secureLogger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// ─── Profils pros ─────────────────────────────────────────────────────────────

interface ProProfile {
  id: string;
  name: string;
  lat: number;
  lng: number;
  radiusKm: number;
}

const PRO_A: ProProfile = { id: 'pro-a-lacanau',  name: 'Pro A — Lacanau',  lat: 45.0037, lng: -1.0786, radiusKm: 30 };
const PRO_B: ProProfile = { id: 'pro-b-arcachon', name: 'Pro B — Arcachon', lat: 44.6608, lng: -1.1683, radiusKm: 15 };
const PRO_C: ProProfile = { id: 'pro-c-hossegor', name: 'Pro C — Hossegor', lat: 43.6667, lng: -1.4167, radiusKm: 20 };

const ALL_PROS = [PRO_A, PRO_B, PRO_C];

// ─── Haversine ────────────────────────────────────────────────────────────────

/** Distance géodésique en kilomètres (formule de Haversine). */
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Simule le filtre PostGIS ST_DWithin :
 * retourne les pros dont la distance au point de cours ≤ leur radiusKm.
 * Produit exactement ce que la query SQL retournerait.
 */
function eligiblePros(
  lessonLat: number,
  lessonLng: number,
): Array<{ userId: string; distanceKm: number }> {
  return ALL_PROS.filter((pro) => {
    const d = haversineKm(pro.lat, pro.lng, lessonLat, lessonLng);
    return d <= pro.radiusKm;
  }).map((pro) => ({
    userId: pro.id,
    distanceKm: Math.round(haversineKm(pro.lat, pro.lng, lessonLat, lessonLng)),
  }));
}

/** Déduit les userIds notifiés depuis les appels à createNotification. */
function notifiedIds(): string[] {
  return (mockCreateNotif.mock.calls as Array<[{ userId: string }]>).map(
    ([notif]) => notif.userId,
  );
}

// ─── Setup commun ─────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  mockRedisGet.mockResolvedValue(null); // pas de cooldown
  mockRedisSet.mockResolvedValue('OK');
  mockCreateNotif.mockResolvedValue({ id: 'notif-1', createdAt: new Date() });
});

// ─── Validation des distances de référence ────────────────────────────────────

describe('distances géographiques de référence (Haversine)', () => {
  it('Lacanau → Arcachon ≈ 39 km', () => {
    expect(haversineKm(PRO_A.lat, PRO_A.lng, PRO_B.lat, PRO_B.lng)).toBeCloseTo(39, 0);
  });

  it('Lacanau → Hossegor ≈ 151 km', () => {
    expect(haversineKm(PRO_A.lat, PRO_A.lng, PRO_C.lat, PRO_C.lng)).toBeCloseTo(151, 0);
  });

  it('Arcachon → Hossegor ≈ 112 km', () => {
    expect(haversineKm(PRO_B.lat, PRO_B.lng, PRO_C.lat, PRO_C.lng)).toBeCloseTo(112, 0);
  });

  it('Lège-Cap-Ferret est à ~25 km de Lacanau et ~14 km d\'Arcachon (zone de chevauchement A+B)', () => {
    const legeLat = 44.784;
    const legeLng = -1.136;
    expect(haversineKm(PRO_A.lat, PRO_A.lng, legeLat, legeLng)).toBeCloseTo(25, 0);
    expect(haversineKm(PRO_B.lat, PRO_B.lng, legeLat, legeLng)).toBeCloseTo(14, 0);
  });

  it('Biscarrosse est à ~30 km d\'Arcachon (juste hors rayon B=15 km)', () => {
    const bisLat = 44.388;
    const bisLng = -1.172;
    expect(haversineKm(PRO_B.lat, PRO_B.lng, bisLat, bisLng)).toBeGreaterThan(15);
    expect(haversineKm(PRO_B.lat, PRO_B.lng, bisLat, bisLng)).toBeCloseTo(30, 0);
  });
});

// ─── Scénarios métier ─────────────────────────────────────────────────────────

describe('Scénario 1 — Rider à Lacanau (sur place de Pro A)', () => {
  const lessonLat = 45.0037;
  const lessonLng = -1.0786;

  /**
   * Tableau attendu :
   * Pro A : 0 km  < 30 km → NOTIFIÉ
   * Pro B : 39 km > 15 km → non notifié
   * Pro C : 151 km > 20 km → non notifié
   */
  it('seul Pro A est notifié — aucun faux positif ni faux négatif', async () => {
    mockQueryRaw.mockResolvedValue(eligiblePros(lessonLat, lessonLng));

    await notifyNearbyProsForLesson({
      riderId: 'rider-test',
      lessonLat,
      lessonLng,
      lessonSport: 'surf',
    });

    expect(notifiedIds()).toEqual([PRO_A.id]);
    expect(mockCreateNotif).toHaveBeenCalledTimes(1);
  });
});

describe('Scénario 2 — Rider à Arcachon (sur place de Pro B)', () => {
  const lessonLat = 44.6608;
  const lessonLng = -1.1683;

  /**
   * Tableau attendu :
   * Pro A : 39 km > 30 km → non notifié
   * Pro B : 0 km  < 15 km → NOTIFIÉ
   * Pro C : 112 km > 20 km → non notifié
   */
  it('seul Pro B est notifié — aucun faux positif ni faux négatif', async () => {
    mockQueryRaw.mockResolvedValue(eligiblePros(lessonLat, lessonLng));

    await notifyNearbyProsForLesson({
      riderId: 'rider-test',
      lessonLat,
      lessonLng,
      lessonSport: 'surf',
    });

    expect(notifiedIds()).toEqual([PRO_B.id]);
    expect(mockCreateNotif).toHaveBeenCalledTimes(1);
  });
});

describe('Scénario 3 — Rider à Hossegor (sur place de Pro C)', () => {
  const lessonLat = 43.6667;
  const lessonLng = -1.4167;

  /**
   * Tableau attendu :
   * Pro A : 151 km > 30 km → non notifié
   * Pro B : 112 km > 15 km → non notifié
   * Pro C : 0 km   < 20 km → NOTIFIÉ
   */
  it('seul Pro C est notifié — aucun faux positif ni faux négatif', async () => {
    mockQueryRaw.mockResolvedValue(eligiblePros(lessonLat, lessonLng));

    await notifyNearbyProsForLesson({
      riderId: 'rider-test',
      lessonLat,
      lessonLng,
      lessonSport: 'kitesurf',
    });

    expect(notifiedIds()).toEqual([PRO_C.id]);
    expect(mockCreateNotif).toHaveBeenCalledTimes(1);
  });
});

describe('Scénario 4 — Rider à Lège-Cap-Ferret (zone de chevauchement A + B)', () => {
  const lessonLat = 44.784;
  const lessonLng = -1.136;

  /**
   * Tableau attendu :
   * Pro A : ~25 km < 30 km → NOTIFIÉ
   * Pro B : ~14 km < 15 km → NOTIFIÉ
   * Pro C : ~125 km > 20 km → non notifié
   *
   * Prouve qu'un rider peut notifier plusieurs pros simultanément
   * quand leurs zones se chevauchent.
   */
  it('Pro A et Pro B sont notifiés — Pro C absent (faux positif impossible)', async () => {
    const eligible = eligiblePros(lessonLat, lessonLng);
    mockQueryRaw.mockResolvedValue(eligible);

    await notifyNearbyProsForLesson({
      riderId: 'rider-test',
      lessonLat,
      lessonLng,
      lessonSport: 'surf',
    });

    const ids = notifiedIds();
    expect(ids).toContain(PRO_A.id);
    expect(ids).toContain(PRO_B.id);
    expect(ids).not.toContain(PRO_C.id);
    expect(mockCreateNotif).toHaveBeenCalledTimes(2);
  });

  it('les distances réelles confirment l\'éligibilité des deux pros', () => {
    const dA = haversineKm(PRO_A.lat, PRO_A.lng, lessonLat, lessonLng);
    const dB = haversineKm(PRO_B.lat, PRO_B.lng, lessonLat, lessonLng);
    const dC = haversineKm(PRO_C.lat, PRO_C.lng, lessonLat, lessonLng);

    expect(dA).toBeLessThan(PRO_A.radiusKm);   // 25 < 30 ✓
    expect(dB).toBeLessThan(PRO_B.radiusKm);   // 14 < 15 ✓
    expect(dC).toBeGreaterThan(PRO_C.radiusKm); // 125 > 20 ✓
  });
});

describe('Scénario 5 — Rider à Biscarrosse (zone morte — aucun pro)', () => {
  const lessonLat = 44.388;
  const lessonLng = -1.172;

  /**
   * Tableau attendu :
   * Pro A : ~68 km > 30 km → non notifié
   * Pro B : ~30 km > 15 km → non notifié  ← hors rayon malgré la proximité relative
   * Pro C : ~80 km > 20 km → non notifié
   *
   * Prouve qu'être "proche" géographiquement ne suffit pas :
   * seul le rayon configuré par le pro fait foi.
   */
  it('aucun pro n\'est notifié — zéro faux positif', async () => {
    mockQueryRaw.mockResolvedValue(eligiblePros(lessonLat, lessonLng)); // doit retourner []

    await notifyNearbyProsForLesson({
      riderId: 'rider-test',
      lessonLat,
      lessonLng,
      lessonSport: null,
    });

    expect(mockCreateNotif).not.toHaveBeenCalled();
  });

  it('confirme que Biscarrosse est bien hors de tous les rayons', () => {
    const dA = haversineKm(PRO_A.lat, PRO_A.lng, lessonLat, lessonLng);
    const dB = haversineKm(PRO_B.lat, PRO_B.lng, lessonLat, lessonLng);
    const dC = haversineKm(PRO_C.lat, PRO_C.lng, lessonLat, lessonLng);

    expect(dA).toBeGreaterThan(PRO_A.radiusKm); // 68 > 30
    expect(dB).toBeGreaterThan(PRO_B.radiusKm); // 30 > 15
    expect(dC).toBeGreaterThan(PRO_C.radiusKm); // 80 > 20
  });
});

describe('Scénario 6 — Rider à Capbreton (voisin immédiat de Hossegor)', () => {
  const lessonLat = 43.641;
  const lessonLng = -1.433;

  /**
   * Tableau attendu :
   * Pro A : ~152 km > 30 km → non notifié
   * Pro B : ~114 km > 15 km → non notifié
   * Pro C : ~3 km   < 20 km → NOTIFIÉ
   */
  it('seul Pro C est notifié — Lacanau et Arcachon trop loin', async () => {
    mockQueryRaw.mockResolvedValue(eligiblePros(lessonLat, lessonLng));

    await notifyNearbyProsForLesson({
      riderId: 'rider-test',
      lessonLat,
      lessonLng,
      lessonSport: 'kitesurf',
    });

    expect(notifiedIds()).toEqual([PRO_C.id]);
    expect(mockCreateNotif).toHaveBeenCalledTimes(1);
  });

  it('distance Capbreton → Hossegor est de ~3 km, bien dans le rayon 20 km', () => {
    const d = haversineKm(PRO_C.lat, PRO_C.lng, lessonLat, lessonLng);
    expect(d).toBeLessThan(PRO_C.radiusKm); // 3 < 20
    expect(d).toBeCloseTo(3, 0);
  });
});

describe('Scénario 7 — Rider à Hourtin (nord de Lacanau)', () => {
  const lessonLat = 45.1756;
  const lessonLng = -1.0638;

  /**
   * Tableau attendu :
   * Pro A : ~19 km < 30 km → NOTIFIÉ
   * Pro B : ~58 km > 15 km → non notifié
   * Pro C : ~168 km > 20 km → non notifié
   */
  it('seul Pro A est notifié depuis le nord', async () => {
    mockQueryRaw.mockResolvedValue(eligiblePros(lessonLat, lessonLng));

    await notifyNearbyProsForLesson({
      riderId: 'rider-test',
      lessonLat,
      lessonLng,
      lessonSport: 'surf',
    });

    expect(notifiedIds()).toEqual([PRO_A.id]);
    expect(mockCreateNotif).toHaveBeenCalledTimes(1);
  });

  it('distance Hourtin → Lacanau est de ~19 km, bien dans le rayon 30 km', () => {
    const d = haversineKm(PRO_A.lat, PRO_A.lng, lessonLat, lessonLng);
    expect(d).toBeLessThan(PRO_A.radiusKm); // 19 < 30
    expect(d).toBeCloseTo(19, 0);
  });
});

// ─── Invariants transversaux ──────────────────────────────────────────────────

describe('invariants transversaux — aucune fuite de coordonnées exactes', () => {
  const scenarios = [
    { name: 'Lacanau',          lat: 45.0037, lng: -1.0786 },
    { name: 'Arcachon',         lat: 44.6608, lng: -1.1683 },
    { name: 'Hossegor',         lat: 43.6667, lng: -1.4167 },
    { name: 'Lège-Cap-Ferret',  lat: 44.784,  lng: -1.136  },
    { name: 'Capbreton',        lat: 43.641,  lng: -1.433  },
  ];

  it.each(scenarios)(
    '$name — aucune coordonnée GPS ni distanceKm exacte dans la notification',
    async ({ lat, lng }) => {
      const eligible = eligiblePros(lat, lng);
      if (eligible.length === 0) return; // zone morte, rien à vérifier

      mockQueryRaw.mockResolvedValue(eligible);

      await notifyNearbyProsForLesson({
        riderId: 'rider-privacy-test',
        lessonLat: lat,
        lessonLng: lng,
        lessonSport: 'surf',
      });

      for (const [notif] of mockCreateNotif.mock.calls as Array<[{
        data?: Record<string, unknown>;
        body: string;
      }]>) {
        const data = notif.data ?? {};
        // Pas de coordonnées GPS exactes
        expect(data).not.toHaveProperty('lat');
        expect(data).not.toHaveProperty('lng');
        expect(data).not.toHaveProperty('lessonLat');
        expect(data).not.toHaveProperty('lessonLng');
        expect(data).not.toHaveProperty('distanceKm');
        // Seulement le bucket flou
        expect(data).toHaveProperty('distanceBucket');
        // Body textuel sans coordonnées numériques
        expect(notif.body).not.toMatch(/\d{2}\.\d+/);
      }
    },
  );
});

describe('invariant — distanceBucket cohérent avec la distance Haversine', () => {
  /**
   * Pour chaque pro notifié, le bucket dans la notification doit correspondre
   * à la distance réelle calculée par Haversine.
   */
  function expectedBucket(km: number): string {
    if (km < 5) return '<5km';
    if (km < 15) return '5-15km';
    if (km < 30) return '15-30km';
    return '>30km';
  }

  it('Lège-Cap-Ferret : Pro A bucket=15-30km, Pro B bucket=5-15km', async () => {
    const lessonLat = 44.784;
    const lessonLng = -1.136;

    mockQueryRaw.mockResolvedValue(eligiblePros(lessonLat, lessonLng));

    await notifyNearbyProsForLesson({
      riderId: 'rider-test',
      lessonLat,
      lessonLng,
      lessonSport: 'surf',
    });

    const calls = mockCreateNotif.mock.calls as Array<[{
      userId: string;
      data?: { distanceBucket?: string };
    }]>;

    const byUserId = Object.fromEntries(
      calls.map(([n]) => [n.userId, n.data?.distanceBucket]),
    );

    const dA = haversineKm(PRO_A.lat, PRO_A.lng, lessonLat, lessonLng);
    const dB = haversineKm(PRO_B.lat, PRO_B.lng, lessonLat, lessonLng);

    expect(byUserId[PRO_A.id]).toBe(expectedBucket(dA)); // ~25km → '15-30km'
    expect(byUserId[PRO_B.id]).toBe(expectedBucket(dB)); // ~14km → '5-15km'
  });

  it('Capbreton : Pro C bucket=<5km', async () => {
    const lessonLat = 43.641;
    const lessonLng = -1.433;

    mockQueryRaw.mockResolvedValue(eligiblePros(lessonLat, lessonLng));

    await notifyNearbyProsForLesson({
      riderId: 'rider-test',
      lessonLat,
      lessonLng,
      lessonSport: 'kitesurf',
    });

    const [[notif]] = mockCreateNotif.mock.calls as Array<[{
      data?: { distanceBucket?: string };
    }]>;
    const dC = haversineKm(PRO_C.lat, PRO_C.lng, lessonLat, lessonLng);
    expect(notif.data?.distanceBucket).toBe(expectedBucket(dC)); // ~3km → '<5km'
  });
});

describe('invariant — service accepte lessonSport=null (restriction dans le controller, pas le service)', () => {
  it('notifie les pros éligibles même sans sport spécifié (comportement service)', async () => {
    const lessonLat = 45.0037;
    const lessonLng = -1.0786;
    mockQueryRaw.mockResolvedValue(eligiblePros(lessonLat, lessonLng));

    await notifyNearbyProsForLesson({
      riderId: 'rider-null-sport',
      lessonLat,
      lessonLng,
      lessonSport: null,
    });

    // Pro A est éligible → doit être notifié même sans sport
    expect(notifiedIds()).toContain(PRO_A.id);
  });
});

describe('invariant — la query SQL reçoit bien les coordonnées du rider, pas celles du pro', () => {
  it('les coordonnées transmises à $queryRaw correspondent à la position du cours', async () => {
    const lessonLat = 44.784;
    const lessonLng = -1.136;

    mockQueryRaw.mockResolvedValue([]);

    await notifyNearbyProsForLesson({
      riderId: 'rider-test',
      lessonLat,
      lessonLng,
      lessonSport: 'surf',
    });

    expect(mockQueryRaw).toHaveBeenCalledTimes(1);
    const [sqlArg] = mockQueryRaw.mock.calls[0] as [{ values: unknown[] }];
    // La query Prisma.sql contient les valeurs bindées [lessonLng, lessonLat, lessonLng, lessonLat, ...]
    const vals = sqlArg.values;
    expect(vals).toContain(lessonLng);
    expect(vals).toContain(lessonLat);
    // Ne contient pas les coordonnées d'un pro (absence de fuite)
    expect(vals).not.toContain(PRO_A.lat);
    expect(vals).not.toContain(PRO_A.lng);
  });
});
