/**
 * Tests API admin — GET /admin/analytics/lesson-performance
 *
 * Valide :
 *   - 401 sans token
 *   - 403 pour un rider ou pro non-admin
 *   - 200 avec les 8 métriques pour un admin
 *   - Structure de la réponse (tous les champs présents)
 *   - Données zéro cohérentes (table vide)
 *   - Pas de PII dans la réponse
 *   - Calcul correct des métriques
 *
 * Note : le global afterEach resetDb() de jest.setup.db.ts purge toutes les tables
 * après chaque test. Les fixtures doivent donc être créées en beforeEach.
 */

import request from 'supertest';
import jwt from 'jsonwebtoken';
import { clientPrisma as prisma } from '@blobinfini/database';
import { createApp } from '../../../index';
import { AVAILABLE_PERMISSIONS } from '../permissions';

type Role = 'RIDER' | 'PRO' | 'ADMIN';

const app = createApp();

const EMAIL_ADMIN = 'lesson-perf-admin@test.com';
const EMAIL_RIDER = 'lesson-perf-rider@test.com';
const EMAIL_PRO   = 'lesson-perf-pro@test.com';

function ensureSecrets() {
  process.env.JWT_SECRET            ||= 'test-jwt-secret';
  process.env.SESSION_SECRET        ||= 'test-session-secret';
  process.env.PRIMARY_ADMIN_EMAILS   = EMAIL_ADMIN;
}

function signToken(userId: string, role: Role) {
  return jwt.sign({ sub: userId, role }, process.env.JWT_SECRET!, { expiresIn: '1h' });
}

async function seedFixtures() {
  const [adminUser, riderUser, proUser] = await Promise.all([
    prisma.user.create({
      data: { email: EMAIL_ADMIN, password: 'hash', role: 'ADMIN', emailVerified: true },
    }),
    prisma.user.create({
      data: { email: EMAIL_RIDER, password: 'hash', role: 'RIDER', emailVerified: true },
    }),
    prisma.user.create({
      data: { email: EMAIL_PRO, password: 'hash', role: 'PRO', emailVerified: true },
    }),
  ]);

  await Promise.all([
    prisma.adminProfile.create({
      data: { userId: adminUser.id, permissions: [...AVAILABLE_PERMISSIONS] },
    }),
    prisma.riderProfile.create({ data: { userId: riderUser.id } }),
    prisma.proProfile.create({
      data: { userId: proUser.id, lat: 44.8, lng: -1.2, radiusKm: 20 },
    }),
  ]);

  return {
    adminToken: signToken(adminUser.id, 'ADMIN'),
    riderToken: signToken(riderUser.id, 'RIDER'),
    proToken:   signToken(proUser.id,   'PRO'),
  };
}

beforeAll(() => {
  ensureSecrets();
});

// ─── AuthN / AuthZ ────────────────────────────────────────────────────────────

describe('GET /admin/analytics/lesson-performance — auth', () => {
  it('returns 401 with no token', async () => {
    await request(app)
      .get('/admin/analytics/lesson-performance')
      .expect(401);
  });

  it('returns 403 for a rider', async () => {
    const { riderToken } = await seedFixtures();
    await request(app)
      .get('/admin/analytics/lesson-performance')
      .set('Authorization', `Bearer ${riderToken}`)
      .expect(403);
  });

  it('returns 403 for a pro', async () => {
    const { proToken } = await seedFixtures();
    await request(app)
      .get('/admin/analytics/lesson-performance')
      .set('Authorization', `Bearer ${proToken}`)
      .expect(403);
  });

  it('returns 200 for an admin', async () => {
    const { adminToken } = await seedFixtures();
    await request(app)
      .get('/admin/analytics/lesson-performance')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
  });
});

// ─── Response structure ───────────────────────────────────────────────────────

describe('GET /admin/analytics/lesson-performance — response shape', () => {
  let adminToken: string;

  beforeEach(async () => {
    ({ adminToken } = await seedFixtures());
  });

  it('returns all required metric fields including uniqueRiders7d and bySport', async () => {
    const res = await request(app)
      .get('/admin/analytics/lesson-performance')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const body = res.body as Record<string, unknown>;
    // Champs existants
    expect(body).toHaveProperty('requestsToday');
    expect(body).toHaveProperty('requests7d');
    expect(body).toHaveProperty('prosNotifiedToday');
    expect(body).toHaveProperty('prosNotified7d');
    expect(body).toHaveProperty('avgProsPerRequest');
    expect(body).toHaveProperty('noMatchRequests');
    expect(body).toHaveProperty('notificationFailures');
    expect(body).toHaveProperty('notificationSuccessRate');
    // Nouveaux champs Sprint A
    expect(body).toHaveProperty('uniqueRiders7d');
    expect(body).toHaveProperty('bySport');
    const bySport = body.bySport as Record<string, unknown>;
    expect(bySport).toHaveProperty('surf');
    expect(bySport).toHaveProperty('kitesurf');
    expect(bySport).toHaveProperty('other');
    // Chaque entrée bySport a les 3 champs attendus
    for (const sport of ['surf', 'kitesurf', 'other']) {
      const s = bySport[sport] as Record<string, unknown>;
      expect(s).toHaveProperty('requests7d');
      expect(s).toHaveProperty('matchRate');
      expect(s).toHaveProperty('avgProsFound');
    }
  });

  it('all count fields are numbers (not bigint strings)', async () => {
    const res = await request(app)
      .get('/admin/analytics/lesson-performance')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const body = res.body as Record<string, unknown>;
    for (const key of [
      'requestsToday', 'requests7d', 'uniqueRiders7d', 'prosNotifiedToday',
      'prosNotified7d', 'avgProsPerRequest', 'noMatchRequests',
      'notificationFailures',
    ]) {
      expect(typeof body[key]).toBe('number');
    }
    // bySport fields are also numbers
    const bySport = body.bySport as Record<string, Record<string, unknown>>;
    for (const sport of ['surf', 'kitesurf', 'other']) {
      expect(typeof bySport[sport].requests7d).toBe('number');
      expect(typeof bySport[sport].avgProsFound).toBe('number');
    }
  });

  it('does not expose any PII (no email, userId, ip, token)', async () => {
    const res = await request(app)
      .get('/admin/analytics/lesson-performance')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain('@');
    expect(raw).not.toContain('userId');
    expect(raw).not.toContain('riderRef');
    expect(raw).not.toContain('token');
    expect(raw).not.toContain('email');
  });
});

// ─── Métriques réelles ────────────────────────────────────────────────────────

describe('GET /admin/analytics/lesson-performance — metrics computation', () => {
  let adminToken: string;

  beforeEach(async () => {
    ({ adminToken } = await seedFixtures());
    // LessonFanout déjà vide après resetDb() global.
  });

  it('returns zeros and null rate when table is empty', async () => {
    const res = await request(app)
      .get('/admin/analytics/lesson-performance')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const body = res.body as Record<string, unknown>;
    expect(body.requestsToday).toBe(0);
    expect(body.requests7d).toBe(0);
    expect(body.uniqueRiders7d).toBe(0);
    expect(body.prosNotifiedToday).toBe(0);
    expect(body.prosNotified7d).toBe(0);
    expect(body.avgProsPerRequest).toBe(0);
    expect(body.noMatchRequests).toBe(0);
    expect(body.notificationFailures).toBe(0);
    expect(body.notificationSuccessRate).toBeNull();
    // bySport : tous vides
    const bySport = body.bySport as Record<string, Record<string, unknown>>;
    for (const sport of ['surf', 'kitesurf', 'other']) {
      expect(bySport[sport].requests7d).toBe(0);
      expect(bySport[sport].matchRate).toBeNull();
      expect(bySport[sport].avgProsFound).toBe(0);
    }
  });

  it('counts fanouts in the 7-day window', async () => {
    await prisma.lessonFanout.createMany({
      data: [
        { id: 'f1', riderRef: 'ref-a', lessonRequestId: 'req-a', sport: 'surf',     prosFound: 3, prosNotified: 3, failureCount: 0 },
        { id: 'f2', riderRef: 'ref-b', lessonRequestId: 'req-b', sport: 'kitesurf', prosFound: 5, prosNotified: 4, failureCount: 1 },
      ],
    });

    const res = await request(app)
      .get('/admin/analytics/lesson-performance')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const body = res.body as Record<string, unknown>;
    expect(body.requests7d).toBe(2);
    expect(body.prosNotified7d).toBe(7);
    expect(body.notificationFailures).toBe(1);
  });

  it('counts noMatchRequests for fanouts where prosFound = 0', async () => {
    await prisma.lessonFanout.createMany({
      data: [
        { id: 'g1', riderRef: 'ref-c', lessonRequestId: 'req-c', sport: null,   prosFound: 0, prosNotified: 0, failureCount: 0 },
        { id: 'g2', riderRef: 'ref-d', lessonRequestId: 'req-d', sport: 'surf', prosFound: 4, prosNotified: 4, failureCount: 0 },
        { id: 'g3', riderRef: 'ref-e', lessonRequestId: 'req-e', sport: null,   prosFound: 0, prosNotified: 0, failureCount: 0 },
      ],
    });

    const res = await request(app)
      .get('/admin/analytics/lesson-performance')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const body = res.body as Record<string, unknown>;
    expect(body.noMatchRequests).toBe(2);
    expect(body.requests7d).toBe(3);
  });

  it('bySport agrège correctement par discipline', async () => {
    await prisma.lessonFanout.createMany({
      data: [
        { id: 'bs1', riderRef: 'ref-s1', lessonRequestId: 'req-s1', sport: 'surf',     prosFound: 3, prosNotified: 3, failureCount: 0 },
        { id: 'bs2', riderRef: 'ref-s2', lessonRequestId: 'req-s2', sport: 'surf',     prosFound: 0, prosNotified: 0, failureCount: 0 },
        { id: 'bs3', riderRef: 'ref-k1', lessonRequestId: 'req-k1', sport: 'kitesurf', prosFound: 5, prosNotified: 4, failureCount: 1 },
        { id: 'bs4', riderRef: 'ref-n1', lessonRequestId: 'req-n1', sport: null,       prosFound: 2, prosNotified: 2, failureCount: 0 },
      ],
    });

    const res = await request(app)
      .get('/admin/analytics/lesson-performance')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const bySport = (res.body as Record<string, Record<string, unknown>>).bySport as Record<string, Record<string, unknown>>;
    // surf : 2 demandes, 1 avec pro trouvé → matchRate = 50 %
    expect(bySport.surf.requests7d).toBe(2);
    expect(bySport.surf.matchRate).toBeCloseTo(50, 0);
    // kitesurf : 1 demande, matchRate = 100 %
    expect(bySport.kitesurf.requests7d).toBe(1);
    expect(bySport.kitesurf.matchRate).toBe(100);
    // other (sport null) : 1 demande, matchRate = 100 %
    expect(bySport.other.requests7d).toBe(1);
    expect(bySport.other.matchRate).toBe(100);
  });

  it('uniqueRiders7d < requests7d quand un rider a plusieurs fanouts sur la fenêtre', async () => {
    await prisma.lessonFanout.createMany({
      data: [
        // Même rider (même riderRef), deux jours différents → 2 lessonRequestIds mais 1 riderRef
        { id: 'ur1', riderRef: 'same-ref', lessonRequestId: 'req-day1', sport: 'surf', prosFound: 2, prosNotified: 2, failureCount: 0 },
        { id: 'ur2', riderRef: 'same-ref', lessonRequestId: 'req-day2', sport: 'surf', prosFound: 2, prosNotified: 2, failureCount: 0 },
        // Rider distinct
        { id: 'ur3', riderRef: 'other-ref', lessonRequestId: 'req-other', sport: 'kitesurf', prosFound: 1, prosNotified: 1, failureCount: 0 },
      ],
    });

    const res = await request(app)
      .get('/admin/analytics/lesson-performance')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const body = res.body as Record<string, unknown>;
    expect(body.requests7d).toBe(3);      // 3 lessonRequestIds distincts
    expect(body.uniqueRiders7d).toBe(2);  // 2 riderRefs distincts
  });

  it('calculates notificationSuccessRate correctly', async () => {
    // 8 notified + 2 failed = 10 total → 80 %
    await prisma.lessonFanout.create({
      data: { id: 'h1', riderRef: 'ref-f', lessonRequestId: 'req-f', sport: 'surf', prosFound: 10, prosNotified: 8, failureCount: 2 },
    });

    const res = await request(app)
      .get('/admin/analytics/lesson-performance')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const body = res.body as Record<string, unknown>;
    expect(typeof body.notificationSuccessRate).toBe('number');
    expect(body.notificationSuccessRate as number).toBeCloseTo(80, 0);
  });
});

// ─── Idempotence de l'observabilité ──────────────────────────────────────────
//
// Garantie : COUNT(DISTINCT lessonRequestId) déduplique au niveau SQL.
// Même si recordFanout est appelé N fois pour le même rider-jour
// (retry applicatif, race condition Redis, double appel concurrent),
// requestsToday/requests7d ne comptent ce rider qu'UNE seule fois.

describe('GET /admin/analytics/lesson-performance — idempotence de requestsToday/requests7d', () => {
  let adminToken: string;

  beforeEach(async () => {
    ({ adminToken } = await seedFixtures());
  });

  it('3 fanouts identiques (même lessonRequestId) comptent pour 1 demande unique', async () => {
    // Simule : retry après crash partiel, ou race condition Redis fail-open
    // → 3 lignes insérées dans LessonFanout avec le même lessonRequestId
    await prisma.lessonFanout.createMany({
      data: [
        { id: 'idem-1', riderRef: 'ref-idem', lessonRequestId: 'req-idem-abc', sport: 'surf', prosFound: 3, prosNotified: 3, failureCount: 0 },
        { id: 'idem-2', riderRef: 'ref-idem', lessonRequestId: 'req-idem-abc', sport: 'surf', prosFound: 3, prosNotified: 3, failureCount: 0 },
        { id: 'idem-3', riderRef: 'ref-idem', lessonRequestId: 'req-idem-abc', sport: 'surf', prosFound: 3, prosNotified: 3, failureCount: 0 },
      ],
    });

    const res = await request(app)
      .get('/admin/analytics/lesson-performance')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const body = res.body as Record<string, unknown>;
    // COUNT(DISTINCT lessonRequestId) = 1, pas 3
    expect(body.requests7d).toBe(1);
    expect(body.requestsToday).toBe(1);
    // Les autres métriques (SUM) ne sont pas déduites : elles reflètent les fanouts bruts
    expect(body.prosNotified7d).toBe(9); // 3 × 3 — intentionnel, mesure l'effort total
  });

  it('2 riders distincts le même jour restent bien comptés séparément', async () => {
    // Chaque rider a son propre lessonRequestId → COUNT(DISTINCT) = 2
    await prisma.lessonFanout.createMany({
      data: [
        { id: 'dist-1', riderRef: 'ref-rider-x', lessonRequestId: 'req-rider-x', sport: 'surf',     prosFound: 5, prosNotified: 5, failureCount: 0 },
        { id: 'dist-2', riderRef: 'ref-rider-y', lessonRequestId: 'req-rider-y', sport: 'kitesurf', prosFound: 2, prosNotified: 2, failureCount: 0 },
      ],
    });

    const res = await request(app)
      .get('/admin/analytics/lesson-performance')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const body = res.body as Record<string, unknown>;
    expect(body.requests7d).toBe(2); // 2 riders distincts = 2 demandes
  });

  it('même rider, 2 jours différents : lessonRequestIds distincts → 2 demandes', async () => {
    // sha256(riderId + 'YYYY-MM-DD')[:16] change chaque jour → IDs différents
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await prisma.lessonFanout.createMany({
      data: [
        { id: 'days-1', riderRef: 'ref-same', lessonRequestId: 'req-day-1', sport: null, prosFound: 1, prosNotified: 1, failureCount: 0, createdAt: yesterday },
        { id: 'days-2', riderRef: 'ref-same', lessonRequestId: 'req-day-2', sport: null, prosFound: 1, prosNotified: 1, failureCount: 0 },
      ],
    });

    const res = await request(app)
      .get('/admin/analytics/lesson-performance')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const body = res.body as Record<string, unknown>;
    expect(body.requests7d).toBe(2);    // 2 jours différents → 2 demandes
    expect(body.requestsToday).toBe(1); // seul le fanout d'aujourd'hui passe le FILTER
  });
});
