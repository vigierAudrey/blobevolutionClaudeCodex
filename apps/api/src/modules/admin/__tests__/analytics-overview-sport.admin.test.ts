/**
 * Tests API admin — GET /admin/analytics/overview — bySport breakdown (Sprint C5)
 *
 * Valide :
 *   1. Les champs globaux C4 sont conservés dans la réponse
 *   2. bySport vide si aucun fanout dans la fenêtre 7j
 *   3. SURF seul — une seule entrée bySport
 *   4. KITESURF seul — une seule entrée bySport
 *   5. SURF + KITESURF — deux entrées bySport
 *   6. contactRatePct null si requests7d = 0 pour le sport (cohérence)
 *   7. coverageRatePct null si requests7d = 0 pour le sport
 *   8. Anti double comptage par sport — plusieurs fanouts même lessonRequestId
 *   9. ContactRequest.lessonRequestId null exclu du numérateur contacted7d par sport
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

const EMAIL_ADMIN = 'sport-overview-admin@test.com';

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

async function seedContact(lessonRequestId: string): Promise<void> {
  const proUser = await prisma.user.create({
    data: { email: `pro-sport-${lessonRequestId}@test.com`, password: 'hash', role: 'PRO', emailVerified: true },
  });
  const riderUser = await prisma.user.create({
    data: { email: `rider-sport-${lessonRequestId}@test.com`, password: 'hash', role: 'RIDER', emailVerified: true },
  });
  const conv = await prisma.conversation.create({
    data: { members: { create: [{ userId: proUser.id }, { userId: riderUser.id }] } },
  });
  await prisma.contactRequest.create({
    data: { proUserId: proUser.id, conversationId: conv.id, lessonRequestId },
  });
}

beforeAll(() => { ensureSecrets(); });

describe('GET /admin/analytics/overview — bySport (C5)', () => {
  it('1. conserve les champs globaux C4 en plus de bySport', async () => {
    const token = await seedAdmin();
    const lr = makeLessonRequestId('sport-c5-global');
    await prisma.lessonFanout.create({
      data: { riderRef: 'ref-c5-global', lessonRequestId: lr, sport: 'surf', prosFound: 2, prosNotified: 2, failureCount: 0 },
    });

    const res = await request(app)
      .get('/admin/analytics/overview')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    // Champs globaux C4 présents
    expect(res.body).toHaveProperty('requests7d');
    expect(res.body).toHaveProperty('contacted7d');
    expect(res.body).toHaveProperty('contactRatePct');
    expect(res.body).toHaveProperty('covered7d');
    expect(res.body).toHaveProperty('coverageRatePct');
    // Champ C5 présent
    expect(res.body).toHaveProperty('bySport');
    expect(Array.isArray(res.body.bySport)).toBe(true);
    // Pas de PII
    expect(res.body).not.toHaveProperty('userId');
    expect(res.body).not.toHaveProperty('email');
  });

  it('2. bySport vide si aucun fanout dans la fenêtre 7j', async () => {
    const token = await seedAdmin();

    const res = await request(app)
      .get('/admin/analytics/overview')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.requests7d).toBe(0);
    expect(res.body.bySport).toEqual([]);
  });

  it('3. SURF seul — bySport contient une seule entrée surf', async () => {
    const token = await seedAdmin();

    const lr = makeLessonRequestId('sport-c5-surf-only');
    await prisma.lessonFanout.create({
      data: { riderRef: 'ref-c5-surf', lessonRequestId: lr, sport: 'surf', prosFound: 3, prosNotified: 3, failureCount: 0 },
    });
    await seedContact(lr);

    const res = await request(app)
      .get('/admin/analytics/overview')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.bySport).toHaveLength(1);
    const surf = res.body.bySport[0];
    expect(surf.sport).toBe('surf');
    expect(surf.requests7d).toBe(1);
    expect(surf.contacted7d).toBe(1);
    expect(surf.contactRatePct).toBe(100);
    expect(surf.covered7d).toBe(1);
    expect(surf.coverageRatePct).toBe(100);
  });

  it('4. KITESURF seul — bySport contient une seule entrée kitesurf', async () => {
    const token = await seedAdmin();

    const lr = makeLessonRequestId('sport-c5-kite-only');
    await prisma.lessonFanout.create({
      data: { riderRef: 'ref-c5-kite', lessonRequestId: lr, sport: 'kitesurf', prosFound: 0, prosNotified: 0, failureCount: 0 },
    });

    const res = await request(app)
      .get('/admin/analytics/overview')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.bySport).toHaveLength(1);
    const kite = res.body.bySport[0];
    expect(kite.sport).toBe('kitesurf');
    expect(kite.requests7d).toBe(1);
    expect(kite.contacted7d).toBe(0);
    expect(kite.contactRatePct).toBe(0);
    expect(kite.covered7d).toBe(0);
    expect(kite.coverageRatePct).toBe(0);
  });

  it('5. SURF + KITESURF — deux entrées bySport avec métriques correctes', async () => {
    const token = await seedAdmin();

    const lrSurf = makeLessonRequestId('sport-c5-mixed-surf');
    const lrKite = makeLessonRequestId('sport-c5-mixed-kite');

    await prisma.lessonFanout.createMany({
      data: [
        { riderRef: 'ref-c5-mixed-s', lessonRequestId: lrSurf, sport: 'surf',     prosFound: 2, prosNotified: 2, failureCount: 0 },
        { riderRef: 'ref-c5-mixed-k', lessonRequestId: lrKite, sport: 'kitesurf', prosFound: 0, prosNotified: 0, failureCount: 0 },
      ],
    });
    // Contact uniquement sur surf
    await seedContact(lrSurf);

    const res = await request(app)
      .get('/admin/analytics/overview')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.bySport).toHaveLength(2);

    const byName = Object.fromEntries(res.body.bySport.map((s: { sport: string }) => [s.sport, s]));

    expect(byName['surf'].requests7d).toBe(1);
    expect(byName['surf'].contacted7d).toBe(1);
    expect(byName['surf'].contactRatePct).toBe(100);
    expect(byName['surf'].covered7d).toBe(1);

    expect(byName['kitesurf'].requests7d).toBe(1);
    expect(byName['kitesurf'].contacted7d).toBe(0);
    expect(byName['kitesurf'].contactRatePct).toBe(0);
    expect(byName['kitesurf'].covered7d).toBe(0);
    expect(byName['kitesurf'].coverageRatePct).toBe(0);
  });

  it('6. contactRatePct null si pas de fanouts pour ce sport (aucun résultat = absent du tableau)', async () => {
    // Ce test valide que si bySport est vide (table vide), aucune entrée ne contient
    // un contactRatePct incorrect. Cohérence : 0 requests → pas d'entrée dans bySport.
    const token = await seedAdmin();

    const res = await request(app)
      .get('/admin/analytics/overview')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.bySport).toEqual([]);
    // Aucune entrée avec un taux non-null sur zéro demandes
    for (const entry of res.body.bySport) {
      if (entry.requests7d === 0) {
        expect(entry.contactRatePct).toBeNull();
      }
    }
  });

  it('7. coverageRatePct null si aucun fanout pour le sport', async () => {
    // Même logique que test 6 pour coverageRatePct.
    const token = await seedAdmin();

    const res = await request(app)
      .get('/admin/analytics/overview')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.bySport).toEqual([]);
    for (const entry of res.body.bySport) {
      if (entry.requests7d === 0) {
        expect(entry.coverageRatePct).toBeNull();
      }
    }
  });

  it('8. anti double comptage par sport — N fanouts même lessonRequestId = 1 demande', async () => {
    const token = await seedAdmin();

    const lr = makeLessonRequestId('sport-c5-dedup');
    await prisma.lessonFanout.createMany({
      data: [
        { riderRef: 'ref-c5-dedup', lessonRequestId: lr, sport: 'surf', prosFound: 0, prosNotified: 0, failureCount: 0, triggerReason: 'ACTIVATED' },
        { riderRef: 'ref-c5-dedup', lessonRequestId: lr, sport: 'surf', prosFound: 5, prosNotified: 5, failureCount: 0, triggerReason: 'LOCATION_CHANGED' },
        { riderRef: 'ref-c5-dedup', lessonRequestId: lr, sport: 'surf', prosFound: 2, prosNotified: 2, failureCount: 0, triggerReason: 'SPORT_CHANGED' },
      ],
    });

    const res = await request(app)
      .get('/admin/analytics/overview')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    // 3 fanouts surf → 1 seule demande unique
    expect(res.body.bySport).toHaveLength(1);
    const surf = res.body.bySport[0];
    expect(surf.sport).toBe('surf');
    expect(surf.requests7d).toBe(1);
    // Au moins un fanout prosFound > 0 → couverte
    expect(surf.covered7d).toBe(1);
    expect(surf.coverageRatePct).toBe(100);
  });

  it('9. ContactRequest.lessonRequestId null exclu du numérateur contacted7d par sport', async () => {
    const token = await seedAdmin();

    const lr = makeLessonRequestId('sport-c5-null-contact');
    await prisma.lessonFanout.create({
      data: { riderRef: 'ref-c5-null', lessonRequestId: lr, sport: 'kitesurf', prosFound: 1, prosNotified: 1, failureCount: 0 },
    });

    // ContactRequest sans lessonRequestId (pré-C1 — ne doit pas compter)
    const proUser = await prisma.user.create({
      data: { email: 'pro-sport-null@test.com', password: 'hash', role: 'PRO', emailVerified: true },
    });
    const riderUser = await prisma.user.create({
      data: { email: 'rider-sport-null@test.com', password: 'hash', role: 'RIDER', emailVerified: true },
    });
    const conv = await prisma.conversation.create({
      data: { members: { create: [{ userId: proUser.id }, { userId: riderUser.id }] } },
    });
    await prisma.contactRequest.create({
      data: {
        proUserId: proUser.id,
        conversationId: conv.id,
        lessonRequestId: null, // intentionnellement null
      },
    });

    const res = await request(app)
      .get('/admin/analytics/overview')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.bySport).toHaveLength(1);
    const kite = res.body.bySport[0];
    expect(kite.sport).toBe('kitesurf');
    expect(kite.requests7d).toBe(1);
    expect(kite.contacted7d).toBe(0); // null lessonRequestId exclu
    expect(kite.contactRatePct).toBe(0);
  });
});
