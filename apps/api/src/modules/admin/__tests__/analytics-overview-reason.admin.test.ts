/**
 * Tests API admin — GET /admin/analytics/overview — reasonBreakdown (Sprint C6)
 *
 * Valide :
 *   1.  Les champs globaux C4 sont conservés dans la réponse
 *   2.  Le champ bySport C5 est conservé dans la réponse
 *   3.  reasonBreakdown vide si aucun fanout dans la fenêtre 7j
 *   4.  Une seule raison — une seule entrée reasonBreakdown
 *   5.  Plusieurs raisons — autant d'entrées que de triggerReasons distincts
 *   6.  Fanouts multiples même lessonRequestId → requests7d = 1 par raison
 *   7.  contactRatePct null si requests7d = 0 pour une raison (cohérence NULLIF)
 *   8.  coverageRatePct null si requests7d = 0 pour une raison
 *   9.  Anti double comptage — N fanouts même lessonRequestId = 1 demande
 *  10.  401 sans token
 *  11.  403 rôle RIDER
 *  12.  403 rôle PRO
 *
 * Valeurs réelles de triggerReason testées :
 *   'ACTIVATED', 'LOCATION_CHANGED', 'SPORT_CHANGED', 'MANUAL'
 *   'UNKNOWN' = COALESCE(null, 'UNKNOWN') pour les lignes legacy (triggerReason IS NULL)
 *
 * Pattern : global afterEach resetDb() purge toutes les tables après chaque test.
 */

import request from 'supertest';
import jwt from 'jsonwebtoken';
import { clientPrisma as prisma } from '@blobinfini/database';
import { createApp } from '../../../index';
import { AVAILABLE_PERMISSIONS } from '../permissions';
import { makeLessonRequestId } from '../../../services/lesson-fanout.repository';

type Role = 'RIDER' | 'PRO' | 'ADMIN';

const app = createApp();

const EMAIL_ADMIN = 'reason-overview-admin@test.com';
const EMAIL_RIDER = 'reason-overview-rider@test.com';
const EMAIL_PRO   = 'reason-overview-pro@test.com';

function ensureSecrets() {
  process.env.JWT_SECRET          ||= 'test-jwt-secret';
  process.env.SESSION_SECRET      ||= 'test-session-secret';
  process.env.PRIMARY_ADMIN_EMAILS = EMAIL_ADMIN;
}

function signToken(userId: string, role: Role) {
  return jwt.sign({ sub: userId, role }, process.env.JWT_SECRET!, { expiresIn: '1h' });
}

async function seedAdmin(): Promise<string> {
  const user = await prisma.user.create({
    data: { email: EMAIL_ADMIN, password: 'hash', role: 'ADMIN', emailVerified: true },
  });
  await prisma.adminProfile.create({
    data: { userId: user.id, permissions: [...AVAILABLE_PERMISSIONS] },
  });
  return signToken(user.id, 'ADMIN');
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

async function seedContact(lessonRequestId: string): Promise<void> {
  const proUser = await prisma.user.create({
    data: { email: `pro-reason-${lessonRequestId}@test.com`, password: 'hash', role: 'PRO', emailVerified: true },
  });
  const riderUser = await prisma.user.create({
    data: { email: `rider-reason-${lessonRequestId}@test.com`, password: 'hash', role: 'RIDER', emailVerified: true },
  });
  const conv = await prisma.conversation.create({
    data: { members: { create: [{ userId: proUser.id }, { userId: riderUser.id }] } },
  });
  await prisma.contactRequest.create({
    data: { proUserId: proUser.id, conversationId: conv.id, lessonRequestId },
  });
}

beforeAll(() => { ensureSecrets(); });

// ─── 10-12 : AuthN / AuthZ ────────────────────────────────────────────────────

describe('GET /admin/analytics/overview — reasonBreakdown auth (C6)', () => {
  it('10. returns 401 with no token', async () => {
    await request(app)
      .get('/admin/analytics/overview')
      .expect(401);
  });

  it('11. returns 403 for a RIDER', async () => {
    const { riderToken } = await seedAuth();
    await request(app)
      .get('/admin/analytics/overview')
      .set('Authorization', `Bearer ${riderToken}`)
      .expect(403);
  });

  it('12. returns 403 for a PRO', async () => {
    const { proToken } = await seedAuth();
    await request(app)
      .get('/admin/analytics/overview')
      .set('Authorization', `Bearer ${proToken}`)
      .expect(403);
  });
});

// ─── 1-9 : Métriques reasonBreakdown ─────────────────────────────────────────

describe('GET /admin/analytics/overview — reasonBreakdown (C6)', () => {
  it('1. conserve les champs globaux C4 (requests7d, contactRatePct, covered7d, coverageRatePct)', async () => {
    const token = await seedAdmin();
    const lr = makeLessonRequestId('reason-c6-c4check');
    await prisma.lessonFanout.create({
      data: { riderRef: 'ref-c6-c4', lessonRequestId: lr, sport: 'surf', prosFound: 1, prosNotified: 1, failureCount: 0, triggerReason: 'ACTIVATED' },
    });

    const res = await request(app)
      .get('/admin/analytics/overview')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body).toHaveProperty('requests7d');
    expect(res.body).toHaveProperty('contacted7d');
    expect(res.body).toHaveProperty('contactRatePct');
    expect(res.body).toHaveProperty('covered7d');
    expect(res.body).toHaveProperty('coverageRatePct');
    expect(res.body).not.toHaveProperty('userId');
    expect(res.body).not.toHaveProperty('email');
  });

  it('2. conserve le champ bySport C5', async () => {
    const token = await seedAdmin();
    const lr = makeLessonRequestId('reason-c6-c5check');
    await prisma.lessonFanout.create({
      data: { riderRef: 'ref-c6-c5', lessonRequestId: lr, sport: 'surf', prosFound: 1, prosNotified: 1, failureCount: 0, triggerReason: 'ACTIVATED' },
    });

    const res = await request(app)
      .get('/admin/analytics/overview')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body).toHaveProperty('bySport');
    expect(Array.isArray(res.body.bySport)).toBe(true);
  });

  it('3. reasonBreakdown vide si aucun fanout dans la fenêtre 7j', async () => {
    const token = await seedAdmin();

    const res = await request(app)
      .get('/admin/analytics/overview')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body).toHaveProperty('reasonBreakdown');
    expect(Array.isArray(res.body.reasonBreakdown)).toBe(true);
    expect(res.body.reasonBreakdown).toHaveLength(0);
  });

  it('4. une seule raison — une seule entrée reasonBreakdown avec métriques correctes', async () => {
    const token = await seedAdmin();

    const lr = makeLessonRequestId('reason-c6-single');
    await prisma.lessonFanout.create({
      data: { riderRef: 'ref-c6-single', lessonRequestId: lr, sport: 'surf', prosFound: 3, prosNotified: 3, failureCount: 0, triggerReason: 'ACTIVATED' },
    });
    await seedContact(lr);

    const res = await request(app)
      .get('/admin/analytics/overview')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.reasonBreakdown).toHaveLength(1);
    const entry = res.body.reasonBreakdown[0];
    expect(entry.reason).toBe('ACTIVATED');
    expect(entry.fanouts7d).toBe(1);
    expect(entry.requests7d).toBe(1);
    expect(entry.contacted7d).toBe(1);
    expect(entry.contactRatePct).toBe(100);
    expect(entry.covered7d).toBe(1);   // prosFound=3 > 0
    expect(entry.coverageRatePct).toBe(100);
  });

  it('5. plusieurs raisons — autant d\'entrées que de triggerReasons distincts', async () => {
    const token = await seedAdmin();

    const lrA = makeLessonRequestId('reason-c6-multi-a');
    const lrB = makeLessonRequestId('reason-c6-multi-b');
    const lrC = makeLessonRequestId('reason-c6-multi-c');
    const lrD = makeLessonRequestId('reason-c6-multi-d');

    await prisma.lessonFanout.createMany({
      data: [
        { riderRef: 'ref-c6-ma', lessonRequestId: lrA, sport: 'surf',     prosFound: 2, prosNotified: 2, failureCount: 0, triggerReason: 'ACTIVATED' },
        { riderRef: 'ref-c6-mb', lessonRequestId: lrB, sport: 'kitesurf', prosFound: 0, prosNotified: 0, failureCount: 0, triggerReason: 'LOCATION_CHANGED' },
        { riderRef: 'ref-c6-mc', lessonRequestId: lrC, sport: 'surf',     prosFound: 1, prosNotified: 1, failureCount: 0, triggerReason: 'SPORT_CHANGED' },
        { riderRef: 'ref-c6-md', lessonRequestId: lrD, sport: 'surf',     prosFound: 1, prosNotified: 1, failureCount: 0, triggerReason: 'MANUAL' },
      ],
    });

    const res = await request(app)
      .get('/admin/analytics/overview')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.reasonBreakdown).toHaveLength(4);

    const byReason = Object.fromEntries(
      res.body.reasonBreakdown.map((e: { reason: string }) => [e.reason, e])
    );

    // Toutes les valeurs réelles de triggerReason sont présentes
    expect(byReason).toHaveProperty('ACTIVATED');
    expect(byReason).toHaveProperty('LOCATION_CHANGED');
    expect(byReason).toHaveProperty('SPORT_CHANGED');
    expect(byReason).toHaveProperty('MANUAL');

    // Chaque raison = 1 fanout / 1 demande
    for (const reason of ['ACTIVATED', 'LOCATION_CHANGED', 'SPORT_CHANGED', 'MANUAL']) {
      expect(byReason[reason].fanouts7d).toBe(1);
      expect(byReason[reason].requests7d).toBe(1);
    }

    // ACTIVATED : prosFound=2 → couverte
    expect(byReason['ACTIVATED'].covered7d).toBe(1);
    // LOCATION_CHANGED : prosFound=0 → non couverte
    expect(byReason['LOCATION_CHANGED'].covered7d).toBe(0);
  });

  it('6. fanouts multiples même lessonRequestId → fanouts7d correct, requests7d = 1 par raison', async () => {
    const token = await seedAdmin();

    const lr = makeLessonRequestId('reason-c6-multifanout');
    // 3 fanouts, même lessonRequestId, même raison (ex: 3 re-triggers LOCATION_CHANGED dans la journée)
    await prisma.lessonFanout.createMany({
      data: [
        { riderRef: 'ref-c6-mf', lessonRequestId: lr, sport: 'surf', prosFound: 0, prosNotified: 0, failureCount: 0, triggerReason: 'LOCATION_CHANGED' },
        { riderRef: 'ref-c6-mf', lessonRequestId: lr, sport: 'surf', prosFound: 5, prosNotified: 5, failureCount: 0, triggerReason: 'LOCATION_CHANGED' },
        { riderRef: 'ref-c6-mf', lessonRequestId: lr, sport: 'surf', prosFound: 3, prosNotified: 3, failureCount: 0, triggerReason: 'LOCATION_CHANGED' },
      ],
    });

    const res = await request(app)
      .get('/admin/analytics/overview')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.reasonBreakdown).toHaveLength(1);
    const entry = res.body.reasonBreakdown[0];
    expect(entry.reason).toBe('LOCATION_CHANGED');
    expect(entry.fanouts7d).toBe(3);    // 3 fanouts bruts
    expect(entry.requests7d).toBe(1);   // 1 seule demande unique
    // Au moins un fanout prosFound > 0 → couverte
    expect(entry.covered7d).toBe(1);
    expect(entry.coverageRatePct).toBe(100);
  });

  it('7. contactRatePct null si requests7d = 0 pour une raison (via NULLIF)', async () => {
    // Ce test valide NULLIF : si reasonBreakdown est vide (table vide),
    // aucune entrée ne doit avoir un contactRatePct non-null sur 0 demandes.
    const token = await seedAdmin();

    const res = await request(app)
      .get('/admin/analytics/overview')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.reasonBreakdown).toHaveLength(0);
    for (const entry of res.body.reasonBreakdown) {
      if (entry.requests7d === 0) {
        expect(entry.contactRatePct).toBeNull();
      }
    }
  });

  it('8. coverageRatePct null si requests7d = 0 pour une raison', async () => {
    const token = await seedAdmin();

    const res = await request(app)
      .get('/admin/analytics/overview')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.reasonBreakdown).toHaveLength(0);
    for (const entry of res.body.reasonBreakdown) {
      if (entry.requests7d === 0) {
        expect(entry.coverageRatePct).toBeNull();
      }
    }
  });

  it('9. anti double comptage — même lessonRequestId dans deux raisons → requests7d=1 par raison, pas de fusion', async () => {
    const token = await seedAdmin();

    // Même lessonRequestId → rider a déclenché ACTIVATED puis LOCATION_CHANGED
    const lr = makeLessonRequestId('reason-c6-crossreason');
    await prisma.lessonFanout.createMany({
      data: [
        { riderRef: 'ref-c6-cr', lessonRequestId: lr, sport: 'surf', prosFound: 0, prosNotified: 0, failureCount: 0, triggerReason: 'ACTIVATED' },
        { riderRef: 'ref-c6-cr', lessonRequestId: lr, sport: 'surf', prosFound: 4, prosNotified: 4, failureCount: 0, triggerReason: 'LOCATION_CHANGED' },
      ],
    });
    await seedContact(lr);

    const res = await request(app)
      .get('/admin/analytics/overview')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    // 2 raisons distinctes → 2 entrées
    expect(res.body.reasonBreakdown).toHaveLength(2);
    const byReason = Object.fromEntries(
      res.body.reasonBreakdown.map((e: { reason: string }) => [e.reason, e])
    );

    // requests7d = 1 dans chaque groupe (le même lessonRequestId compté une fois par groupe)
    expect(byReason['ACTIVATED'].requests7d).toBe(1);
    expect(byReason['LOCATION_CHANGED'].requests7d).toBe(1);

    // contacted7d = 1 dans chaque groupe (le contact est attaché au lessonRequestId commun)
    expect(byReason['ACTIVATED'].contacted7d).toBe(1);
    expect(byReason['LOCATION_CHANGED'].contacted7d).toBe(1);

    // ACTIVATED : prosFound=0 → non couverte dans ce fanout
    expect(byReason['ACTIVATED'].covered7d).toBe(0);
    // LOCATION_CHANGED : prosFound=4 → couverte
    expect(byReason['LOCATION_CHANGED'].covered7d).toBe(1);

    // Les taux globaux C4 ne sont pas doublés (1 demande unique au total)
    expect(res.body.requests7d).toBe(1);
    expect(res.body.contacted7d).toBe(1);
  });
});
