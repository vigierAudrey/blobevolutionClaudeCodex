/**
 * Tests API admin — GET /admin/analytics/overview (Sprint C4)
 *
 * Valide :
 *   1. 401 sans token
 *   2. 403 rôle RIDER
 *   3. 403 rôle PRO
 *   4. 200 table vide → requests7d=0, contacted7d=0, covered7d=0, taux null
 *   5. 200 fanouts sans contacts → contactRatePct=0, covered7d selon prosFound
 *   6. 200 conversion + couverture correctes (mixed fixtures)
 *   7. Anti double comptage : plusieurs fanouts sur le même lessonRequestId
 *   8. contactRatePct null quand requests7d=0
 *   9. coverageRatePct null quand requests7d=0
 *
 * Pattern : global afterEach resetDb() purge toutes les tables après chaque test.
 * Les fixtures sont créées en beforeEach ou dans le test lui-même.
 */

import request from 'supertest';
import jwt from 'jsonwebtoken';
import { clientPrisma as prisma } from '@blobinfini/database';
import { createApp } from '../../../index';
import { AVAILABLE_PERMISSIONS } from '../permissions';
import { makeLessonRequestId } from '../../../services/lesson-fanout.repository';

type Role = 'RIDER' | 'PRO' | 'ADMIN';

const app = createApp();

const EMAIL_ADMIN = 'overview-admin@test.com';
const EMAIL_RIDER = 'overview-rider@test.com';
const EMAIL_PRO   = 'overview-pro@test.com';

function ensureSecrets() {
  process.env.JWT_SECRET             ||= 'test-jwt-secret';
  process.env.SESSION_SECRET         ||= 'test-session-secret';
  process.env.PRIMARY_ADMIN_EMAILS    = EMAIL_ADMIN;
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
    proToken:   signToken(proUser.id,   'PRO'),
  };
}

beforeAll(() => { ensureSecrets(); });

// ─── 1-3 : AuthN / AuthZ ──────────────────────────────────────────────────────

describe('GET /admin/analytics/overview — auth', () => {
  it('1. returns 401 with no token', async () => {
    await request(app)
      .get('/admin/analytics/overview')
      .expect(401);
  });

  it('2. returns 403 for a RIDER', async () => {
    const { riderToken } = await seedAuth();
    await request(app)
      .get('/admin/analytics/overview')
      .set('Authorization', `Bearer ${riderToken}`)
      .expect(403);
  });

  it('3. returns 403 for a PRO', async () => {
    const { proToken } = await seedAuth();
    await request(app)
      .get('/admin/analytics/overview')
      .set('Authorization', `Bearer ${proToken}`)
      .expect(403);
  });
});

// ─── 4-9 : Métriques ──────────────────────────────────────────────────────────

describe('GET /admin/analytics/overview — metrics', () => {
  it('4. returns zero state when tables are empty', async () => {
    const { adminToken } = await seedAuth();
    const res = await request(app)
      .get('/admin/analytics/overview')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body).toMatchObject({
      requests7d: 0,
      contacted7d: 0,
      contactRatePct: null,
      covered7d: 0,
      coverageRatePct: null,
    });
    // Garantie : aucun NaN, aucune donnée personnelle
    expect(res.body.contactRatePct).toBeNull();
    expect(res.body.coverageRatePct).toBeNull();
    expect(res.body).not.toHaveProperty('userId');
    expect(res.body).not.toHaveProperty('email');
  });

  it('5. contactRatePct=0 si fanouts sans contact, coverageRatePct selon prosFound', async () => {
    const { adminToken } = await seedAuth();

    const lr = makeLessonRequestId('rider-ov-nocont');
    await prisma.lessonFanout.create({
      data: { riderRef: 'ref-ov-nocont', lessonRequestId: lr, sport: 'surf', prosFound: 3, prosNotified: 3, failureCount: 0 },
    });

    const res = await request(app)
      .get('/admin/analytics/overview')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.requests7d).toBe(1);
    expect(res.body.contacted7d).toBe(0);
    expect(res.body.contactRatePct).toBe(0);
    expect(res.body.covered7d).toBe(1); // prosFound=3 > 0
    expect(res.body.coverageRatePct).toBe(100);
  });

  it('6. conversion + couverture correctes avec fixtures mixtes', async () => {
    const { adminToken } = await seedAuth();

    // 3 demandes distinctes :
    //   lrA : contactée + couverte (prosFound > 0)
    //   lrB : non contactée + non couverte (prosFound = 0)
    //   lrC : non contactée + couverte
    const lrA = makeLessonRequestId('rider-ov-a');
    const lrB = makeLessonRequestId('rider-ov-b');
    const lrC = makeLessonRequestId('rider-ov-c');

    await prisma.lessonFanout.createMany({
      data: [
        { riderRef: 'ref-ov-a', lessonRequestId: lrA, sport: 'surf',     prosFound: 2, prosNotified: 2, failureCount: 0 },
        { riderRef: 'ref-ov-b', lessonRequestId: lrB, sport: 'kitesurf', prosFound: 0, prosNotified: 0, failureCount: 0 },
        { riderRef: 'ref-ov-c', lessonRequestId: lrC, sport: 'surf',     prosFound: 1, prosNotified: 1, failureCount: 0 },
      ],
    });

    // Contact uniquement sur lrA
    const proUser = await prisma.user.create({
      data: { email: 'pro-ov-mix@test.com', password: 'hash', role: 'PRO', emailVerified: true },
    });
    const riderUser = await prisma.user.create({
      data: { email: 'rider-ov-mix@test.com', password: 'hash', role: 'RIDER', emailVerified: true },
    });
    const conv = await prisma.conversation.create({
      data: { members: { create: [{ userId: proUser.id }, { userId: riderUser.id }] } },
    });
    await prisma.contactRequest.create({
      data: { proUserId: proUser.id, conversationId: conv.id, lessonRequestId: lrA },
    });

    const res = await request(app)
      .get('/admin/analytics/overview')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.requests7d).toBe(3);
    expect(res.body.contacted7d).toBe(1);
    // 1/3 * 100 = 33.3 %
    expect(res.body.contactRatePct).toBeCloseTo(33.3, 0);
    expect(res.body.covered7d).toBe(2); // lrA + lrC ont prosFound > 0
    // 2/3 * 100 = 66.7 %
    expect(res.body.coverageRatePct).toBeCloseTo(66.7, 0);
  });

  it('7. anti double comptage — plusieurs fanouts pour le même lessonRequestId', async () => {
    const { adminToken } = await seedAuth();

    // Même rider, même jour → même lessonRequestId (3 fanouts : ACTIVATED + LOCATION_CHANGED + SPORT_CHANGED)
    const lr = makeLessonRequestId('rider-ov-dedup');
    await prisma.lessonFanout.createMany({
      data: [
        { riderRef: 'ref-ov-dedup', lessonRequestId: lr, sport: 'surf', prosFound: 0, prosNotified: 0, failureCount: 0, triggerReason: 'ACTIVATED' },
        { riderRef: 'ref-ov-dedup', lessonRequestId: lr, sport: 'surf', prosFound: 5, prosNotified: 5, failureCount: 0, triggerReason: 'LOCATION_CHANGED' },
        { riderRef: 'ref-ov-dedup', lessonRequestId: lr, sport: 'surf', prosFound: 3, prosNotified: 3, failureCount: 0, triggerReason: 'SPORT_CHANGED' },
      ],
    });

    const res = await request(app)
      .get('/admin/analytics/overview')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    // 3 fanouts → 1 seule demande unique
    expect(res.body.requests7d).toBe(1);
    expect(res.body.contacted7d).toBe(0);
    // Au moins un fanout a prosFound > 0 → demande couverte
    expect(res.body.covered7d).toBe(1);
    expect(res.body.coverageRatePct).toBe(100);
  });

  it('8. contactRatePct est null quand requests7d = 0', async () => {
    const { adminToken } = await seedAuth();

    const res = await request(app)
      .get('/admin/analytics/overview')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.requests7d).toBe(0);
    expect(res.body.contactRatePct).toBeNull();
    expect(typeof res.body.contactRatePct === 'number').toBe(false);
  });

  it('9. coverageRatePct est null quand requests7d = 0', async () => {
    const { adminToken } = await seedAuth();

    const res = await request(app)
      .get('/admin/analytics/overview')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.requests7d).toBe(0);
    expect(res.body.coverageRatePct).toBeNull();
    expect(typeof res.body.coverageRatePct === 'number').toBe(false);
  });
});
