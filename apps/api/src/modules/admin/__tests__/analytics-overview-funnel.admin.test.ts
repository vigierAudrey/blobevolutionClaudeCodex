/**
 * Tests API admin — GET /admin/analytics/overview — marketplaceFunnel + marketplaceHealth (Sprint C8)
 *
 * Valide :
 *   1.  funnel vide (aucun fanout) → requests7d=0, taux null, HEALTHY/LOW
 *   2.  couverture nulle → covered7d=0, coverageRatePct=0, PRO_SUPPLY/HIGH
 *   3.  couverture partielle < 30 % → PRO_SUPPLY/HIGH
 *   4.  couverture partielle 30-49 % → PRO_SUPPLY/MEDIUM
 *   5.  couverture totale sans contact → PRO_RESPONSE + severity
 *   6.  couverture totale + contacts partiels < 15 % → PRO_RESPONSE/HIGH
 *   7.  couverture totale + contacts partiels 15-29 % → PRO_RESPONSE/MEDIUM
 *   8.  couverture totale + contacts élevés → HEALTHY/LOW
 *   9.  anti double comptage — N fanouts même lessonRequestId = 1 demande dans le funnel
 *  10.  auth 401 sans token
 *  11.  rider 403
 *  12.  pro 403
 *
 * Règles des bottlenecks (déterministes, sans heuristique) :
 *   PRO_SUPPLY   : coverageRatePct < 50
 *     HIGH   : coverageRatePct < 30
 *     MEDIUM : 30 <= coverageRatePct < 50
 *   PRO_RESPONSE : coverageRatePct >= 50 ET contactRatePct < 30
 *     HIGH   : contactRatePct < 15
 *     MEDIUM : 15 <= contactRatePct < 30
 *   HEALTHY      : coverageRatePct >= 50 ET contactRatePct >= 30 (ou null = 0 données)
 *     LOW
 */

import request from 'supertest';
import jwt from 'jsonwebtoken';
import { clientPrisma as prisma } from '@blobinfini/database';
import { createApp } from '../../../index';
import { AVAILABLE_PERMISSIONS } from '../permissions';
import { makeLessonRequestId } from '../../../services/lesson-fanout.repository';

type Role = 'RIDER' | 'PRO' | 'ADMIN';

const app = createApp();

const EMAIL_ADMIN = 'funnel-admin@test.com';
const EMAIL_RIDER = 'funnel-rider@test.com';
const EMAIL_PRO   = 'funnel-pro@test.com';

function ensureSecrets() {
  process.env.JWT_SECRET          ||= 'test-jwt-secret';
  process.env.SESSION_SECRET      ||= 'test-session-secret';
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
    proToken:   signToken(proUser.id,   'PRO'),
    proUserId:  proUser.id,
  };
}

// Crée un ContactRequest lié à un lessonRequestId pour simuler une conversion.
async function seedContact(proUserId: string, lessonRequestId: string) {
  const riderUser = await prisma.user.create({
    data: { email: `rider-contact-${lessonRequestId}@test.com`, password: 'hash', role: 'RIDER', emailVerified: true },
  });
  const conv = await prisma.conversation.create({
    data: { members: { create: [{ userId: proUserId }, { userId: riderUser.id }] } },
  });
  await prisma.contactRequest.create({
    data: { proUserId, conversationId: conv.id, lessonRequestId },
  });
}

beforeAll(() => { ensureSecrets(); });

// ─── Auth ─────────────────────────────────────────────────────────────────────

describe('GET /admin/analytics/overview — funnel auth', () => {
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

// ─── Métriques funnel ─────────────────────────────────────────────────────────

describe('GET /admin/analytics/overview — marketplaceFunnel', () => {
  it('1. funnel vide : requests=0, taux null, HEALTHY/LOW', async () => {
    const { adminToken } = await seedAuth();
    const res = await request(app)
      .get('/admin/analytics/overview')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.marketplaceFunnel).toMatchObject({
      requests7d: 0,
      covered7d: 0,
      contacted7d: 0,
      coverageLoss: 0,
      contactLoss: 0,
      coverageRatePct: null,
      contactRatePct: null,
    });
    expect(res.body.marketplaceHealth).toMatchObject({
      primaryBottleneck: 'HEALTHY',
      severity: 'LOW',
    });
  });

  it('2. couverture nulle : tous les fanouts avec prosFound=0 → PRO_SUPPLY/HIGH', async () => {
    const { adminToken } = await seedAuth();

    // 10 demandes, aucune couverte (prosFound=0 partout)
    for (let i = 0; i < 10; i++) {
      await prisma.lessonFanout.create({
        data: { riderRef: `ref-fn-nocov-${i}`, lessonRequestId: makeLessonRequestId(`rider-fn-nocov-${i}`), sport: 'surf', prosFound: 0, prosNotified: 0, failureCount: 0 },
      });
    }

    const res = await request(app)
      .get('/admin/analytics/overview')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.marketplaceFunnel.requests7d).toBe(10);
    expect(res.body.marketplaceFunnel.covered7d).toBe(0);
    expect(res.body.marketplaceFunnel.contacted7d).toBe(0);
    expect(res.body.marketplaceFunnel.coverageRatePct).toBe(0);
    expect(res.body.marketplaceHealth.primaryBottleneck).toBe('PRO_SUPPLY');
    expect(res.body.marketplaceHealth.severity).toBe('HIGH');
  });

  it('3. couverture partielle < 30 % → PRO_SUPPLY/HIGH', async () => {
    const { adminToken } = await seedAuth();

    // 10 demandes, 2 couvertes (20 %) → < 30 % → HIGH
    for (let i = 0; i < 10; i++) {
      await prisma.lessonFanout.create({
        data: {
          riderRef: `ref-fn-low-${i}`,
          lessonRequestId: makeLessonRequestId(`rider-fn-low-${i}`),
          sport: 'surf',
          prosFound: i < 2 ? 1 : 0,
          prosNotified: i < 2 ? 1 : 0,
          failureCount: 0,
        },
      });
    }

    const res = await request(app)
      .get('/admin/analytics/overview')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.marketplaceFunnel.requests7d).toBe(10);
    expect(res.body.marketplaceFunnel.covered7d).toBe(2);
    expect(res.body.marketplaceFunnel.coverageLoss).toBe(8);
    expect(res.body.marketplaceHealth.primaryBottleneck).toBe('PRO_SUPPLY');
    expect(res.body.marketplaceHealth.severity).toBe('HIGH');
  });

  it('4. couverture partielle 30-49 % → PRO_SUPPLY/MEDIUM', async () => {
    const { adminToken } = await seedAuth();

    // 10 demandes, 4 couvertes (40 %) → >= 30 et < 50 → MEDIUM
    for (let i = 0; i < 10; i++) {
      await prisma.lessonFanout.create({
        data: {
          riderRef: `ref-fn-med-${i}`,
          lessonRequestId: makeLessonRequestId(`rider-fn-med-${i}`),
          sport: 'surf',
          prosFound: i < 4 ? 1 : 0,
          prosNotified: i < 4 ? 1 : 0,
          failureCount: 0,
        },
      });
    }

    const res = await request(app)
      .get('/admin/analytics/overview')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.marketplaceFunnel.covered7d).toBe(4);
    expect(res.body.marketplaceHealth.primaryBottleneck).toBe('PRO_SUPPLY');
    expect(res.body.marketplaceHealth.severity).toBe('MEDIUM');
  });

  it('5. couverture totale, aucun contact → PRO_RESPONSE (contactRatePct=0 < 15 → HIGH)', async () => {
    const { adminToken } = await seedAuth();

    // 5 demandes toutes couvertes, aucun contact
    for (let i = 0; i < 5; i++) {
      await prisma.lessonFanout.create({
        data: { riderRef: `ref-fn-resp-${i}`, lessonRequestId: makeLessonRequestId(`rider-fn-resp-${i}`), sport: 'surf', prosFound: 2, prosNotified: 2, failureCount: 0 },
      });
    }

    const res = await request(app)
      .get('/admin/analytics/overview')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.marketplaceFunnel.covered7d).toBe(5);
    expect(res.body.marketplaceFunnel.contacted7d).toBe(0);
    expect(res.body.marketplaceFunnel.contactLoss).toBe(5);
    expect(res.body.marketplaceFunnel.contactRatePct).toBe(0);
    expect(res.body.marketplaceHealth.primaryBottleneck).toBe('PRO_RESPONSE');
    expect(res.body.marketplaceHealth.severity).toBe('HIGH');
  });

  it('6. couverture totale + contactRatePct < 15 % → PRO_RESPONSE/HIGH', async () => {
    const { adminToken, proUserId } = await seedAuth();

    // 10 demandes couvertes, 1 contactée → 10 % < 15 % → HIGH
    const lrs: string[] = [];
    for (let i = 0; i < 10; i++) {
      const lr = makeLessonRequestId(`rider-fn-high-resp-${i}`);
      lrs.push(lr);
      await prisma.lessonFanout.create({
        data: { riderRef: `ref-fn-high-resp-${i}`, lessonRequestId: lr, sport: 'surf', prosFound: 2, prosNotified: 2, failureCount: 0 },
      });
    }
    await seedContact(proUserId, lrs[0]);

    const res = await request(app)
      .get('/admin/analytics/overview')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.marketplaceFunnel.requests7d).toBe(10);
    expect(res.body.marketplaceFunnel.contacted7d).toBe(1);
    // 1/10 * 100 = 10 % < 15 %
    expect(res.body.marketplaceFunnel.contactRatePct).toBeCloseTo(10, 0);
    expect(res.body.marketplaceHealth.primaryBottleneck).toBe('PRO_RESPONSE');
    expect(res.body.marketplaceHealth.severity).toBe('HIGH');
  });

  it('7. couverture totale + contactRatePct 15-29 % → PRO_RESPONSE/MEDIUM', async () => {
    const { adminToken, proUserId } = await seedAuth();

    // 10 demandes couvertes, 2 contactées → 20 % → 15 <= 20 < 30 → MEDIUM
    const lrs: string[] = [];
    for (let i = 0; i < 10; i++) {
      const lr = makeLessonRequestId(`rider-fn-med-resp-${i}`);
      lrs.push(lr);
      await prisma.lessonFanout.create({
        data: { riderRef: `ref-fn-med-resp-${i}`, lessonRequestId: lr, sport: 'surf', prosFound: 2, prosNotified: 2, failureCount: 0 },
      });
    }
    await seedContact(proUserId, lrs[0]);
    await seedContact(proUserId, lrs[1]);

    const res = await request(app)
      .get('/admin/analytics/overview')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.marketplaceFunnel.contacted7d).toBe(2);
    // 2/10 * 100 = 20 %
    expect(res.body.marketplaceFunnel.contactRatePct).toBeCloseTo(20, 0);
    expect(res.body.marketplaceHealth.primaryBottleneck).toBe('PRO_RESPONSE');
    expect(res.body.marketplaceHealth.severity).toBe('MEDIUM');
  });

  it('8. couverture totale + contacts élevés → HEALTHY/LOW', async () => {
    const { adminToken, proUserId } = await seedAuth();

    // 10 demandes couvertes, 4 contactées → 40 % ≥ 30 → HEALTHY
    const lrs: string[] = [];
    for (let i = 0; i < 10; i++) {
      const lr = makeLessonRequestId(`rider-fn-healthy-${i}`);
      lrs.push(lr);
      await prisma.lessonFanout.create({
        data: { riderRef: `ref-fn-healthy-${i}`, lessonRequestId: lr, sport: 'surf', prosFound: 3, prosNotified: 3, failureCount: 0 },
      });
    }
    for (let i = 0; i < 4; i++) {
      await seedContact(proUserId, lrs[i]);
    }

    const res = await request(app)
      .get('/admin/analytics/overview')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.marketplaceFunnel.covered7d).toBe(10);
    expect(res.body.marketplaceFunnel.contacted7d).toBe(4);
    expect(res.body.marketplaceHealth.primaryBottleneck).toBe('HEALTHY');
    expect(res.body.marketplaceHealth.severity).toBe('LOW');
  });

  it('9. anti double comptage — N fanouts pour le même lessonRequestId = 1 dans le funnel', async () => {
    const { adminToken, proUserId } = await seedAuth();

    // 3 fanouts pour le même rider-jour → lessonRequestId identique
    const lr = makeLessonRequestId('rider-fn-dedup');
    await prisma.lessonFanout.createMany({
      data: [
        { riderRef: 'ref-fn-dedup', lessonRequestId: lr, sport: 'surf', prosFound: 0, prosNotified: 0, failureCount: 0, triggerReason: 'ACTIVATED' },
        { riderRef: 'ref-fn-dedup', lessonRequestId: lr, sport: 'surf', prosFound: 5, prosNotified: 5, failureCount: 0, triggerReason: 'LOCATION_CHANGED' },
        { riderRef: 'ref-fn-dedup', lessonRequestId: lr, sport: 'surf', prosFound: 3, prosNotified: 3, failureCount: 0, triggerReason: 'SPORT_CHANGED' },
      ],
    });
    await seedContact(proUserId, lr);

    const res = await request(app)
      .get('/admin/analytics/overview')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    // 3 fanouts → 1 demande unique dans le funnel
    expect(res.body.marketplaceFunnel.requests7d).toBe(1);
    // Au moins un fanout avec prosFound > 0 → couverte
    expect(res.body.marketplaceFunnel.covered7d).toBe(1);
    // ContactRequest présent → contactée
    expect(res.body.marketplaceFunnel.contacted7d).toBe(1);
    expect(res.body.marketplaceFunnel.coverageLoss).toBe(0);
    expect(res.body.marketplaceFunnel.contactLoss).toBe(0);
  });
});
