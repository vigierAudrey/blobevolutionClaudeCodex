/**
 * Tests API admin — GET /admin/analytics/coverage
 *
 * Valide :
 *   1. 401 sans token
 *   2. 403 rôle rider
 *   3. 403 rôle pro
 *   4. 200 aucun enregistrement → requests7d=0, covered7d=0, coverageRatePct=null
 *   5. 200 demandes sans pro trouvé → coverageRatePct=0
 *   6. 200 toutes les demandes couvertes → coverageRatePct=100
 *   7. 200 couverture partielle correcte (50%)
 *   8. Absence de double comptage (plusieurs fanouts même lessonRequestId)
 *   9. Division par zéro impossible (requests7d=0 → coverageRatePct=null)
 */

import request from 'supertest';
import jwt from 'jsonwebtoken';
import { clientPrisma as prisma } from '@blobinfini/database';
import { createApp } from '../../../index';
import { AVAILABLE_PERMISSIONS } from '../permissions';
import { makeLessonRequestId } from '../../../services/lesson-fanout.repository';

type Role = 'RIDER' | 'PRO' | 'ADMIN';

const app = createApp();

const EMAIL_ADMIN = 'cov-admin@test.com';
const EMAIL_RIDER = 'cov-rider@test.com';
const EMAIL_PRO   = 'cov-pro@test.com';

function ensureSecrets() {
  process.env.JWT_SECRET         ||= 'test-jwt-secret';
  process.env.SESSION_SECRET     ||= 'test-session-secret';
  process.env.PRIMARY_ADMIN_EMAILS = EMAIL_ADMIN;
}

function signToken(userId: string, role: Role) {
  return jwt.sign({ sub: userId, role }, process.env.JWT_SECRET!, { expiresIn: '1h' });
}

async function seedAuth() {
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
    proToken:   signToken(proUser.id, 'PRO'),
  };
}

beforeAll(() => { ensureSecrets(); });

// ─── 1-3 : AuthN / AuthZ ──────────────────────────────────────────────────────

describe('GET /admin/analytics/coverage — auth', () => {
  it('1. returns 401 with no token', async () => {
    await request(app)
      .get('/admin/analytics/coverage')
      .expect(401);
  });

  it('2. returns 403 for a RIDER', async () => {
    const { riderToken } = await seedAuth();
    await request(app)
      .get('/admin/analytics/coverage')
      .set('Authorization', `Bearer ${riderToken}`)
      .expect(403);
  });

  it('3. returns 403 for a PRO', async () => {
    const { proToken } = await seedAuth();
    await request(app)
      .get('/admin/analytics/coverage')
      .set('Authorization', `Bearer ${proToken}`)
      .expect(403);
  });
});

// ─── 4-9 : Métriques ──────────────────────────────────────────────────────────

describe('GET /admin/analytics/coverage — metrics', () => {
  it('4. returns zero state when tables are empty', async () => {
    const { adminToken } = await seedAuth();
    const res = await request(app)
      .get('/admin/analytics/coverage')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body).toMatchObject({
      requests7d: 0,
      covered7d: 0,
      coverageRatePct: null,
    });
  });

  it('5. returns coverageRatePct=0 when all fanouts have prosFound=0', async () => {
    const { adminToken } = await seedAuth();

    const lr = makeLessonRequestId('rider-nocov');
    await prisma.lessonFanout.create({
      data: { riderRef: 'ref-nocov', lessonRequestId: lr, sport: 'surf', prosFound: 0, prosNotified: 0, failureCount: 0 },
    });

    const res = await request(app)
      .get('/admin/analytics/coverage')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.requests7d).toBe(1);
    expect(res.body.covered7d).toBe(0);
    expect(res.body.coverageRatePct).toBe(0);
  });

  it('6. returns coverageRatePct=100 when all requests are covered', async () => {
    const { adminToken } = await seedAuth();

    const lrA = makeLessonRequestId('rider-full-a');
    const lrB = makeLessonRequestId('rider-full-b');
    await prisma.lessonFanout.createMany({
      data: [
        { riderRef: 'ref-full-a', lessonRequestId: lrA, sport: 'surf',     prosFound: 3, prosNotified: 3, failureCount: 0 },
        { riderRef: 'ref-full-b', lessonRequestId: lrB, sport: 'kitesurf', prosFound: 1, prosNotified: 1, failureCount: 0 },
      ],
    });

    const res = await request(app)
      .get('/admin/analytics/coverage')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.requests7d).toBe(2);
    expect(res.body.covered7d).toBe(2);
    expect(res.body.coverageRatePct).toBe(100);
  });

  it('7. returns correct partial coverage (50%)', async () => {
    const { adminToken } = await seedAuth();

    const lrCov   = makeLessonRequestId('rider-partial-cov');
    const lrNoCov = makeLessonRequestId('rider-partial-nocov');
    await prisma.lessonFanout.createMany({
      data: [
        { riderRef: 'ref-pcov',   lessonRequestId: lrCov,   sport: 'surf', prosFound: 2, prosNotified: 2, failureCount: 0 },
        { riderRef: 'ref-pnocov', lessonRequestId: lrNoCov, sport: 'surf', prosFound: 0, prosNotified: 0, failureCount: 0 },
      ],
    });

    const res = await request(app)
      .get('/admin/analytics/coverage')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.requests7d).toBe(2);
    expect(res.body.covered7d).toBe(1);
    expect(res.body.coverageRatePct).toBe(50);
  });

  it('8. no double counting — multiple fanouts with same lessonRequestId count as one request', async () => {
    const { adminToken } = await seedAuth();

    // Même rider, même jour → même lessonRequestId (3 fanouts : ACTIVATED + LOCATION_CHANGED + SPORT_CHANGED)
    const lr = makeLessonRequestId('rider-dedup');
    await prisma.lessonFanout.createMany({
      data: [
        { riderRef: 'ref-dedup', lessonRequestId: lr, sport: 'surf', prosFound: 0, prosNotified: 0, failureCount: 0, triggerReason: 'ACTIVATED' },
        { riderRef: 'ref-dedup', lessonRequestId: lr, sport: 'surf', prosFound: 5, prosNotified: 5, failureCount: 0, triggerReason: 'LOCATION_CHANGED' },
        { riderRef: 'ref-dedup', lessonRequestId: lr, sport: 'surf', prosFound: 3, prosNotified: 3, failureCount: 0, triggerReason: 'SPORT_CHANGED' },
      ],
    });

    const res = await request(app)
      .get('/admin/analytics/coverage')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    // 3 fanouts → 1 seule demande unique
    expect(res.body.requests7d).toBe(1);
    // Au moins un fanout avait prosFound > 0 → couverte
    expect(res.body.covered7d).toBe(1);
    expect(res.body.coverageRatePct).toBe(100);
  });

  it('9. division by zero impossible — coverageRatePct is null when requests7d=0', async () => {
    const { adminToken } = await seedAuth();

    // Table vide → requests7d=0 → pas de division
    const res = await request(app)
      .get('/admin/analytics/coverage')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.requests7d).toBe(0);
    expect(res.body.coverageRatePct).toBeNull();
    // Vérifie que le champ est bien null (pas NaN, pas Infinity, pas undefined)
    expect(typeof res.body.coverageRatePct === 'number').toBe(false);
  });
});
