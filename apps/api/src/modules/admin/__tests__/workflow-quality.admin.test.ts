/**
 * Tests API admin — GET /admin/analytics/workflow-quality
 *
 * Couvre (Sprint C10) :
 *   1.  Auth : anonyme 401, non-admin 403, admin 200
 *   2.  0 notification → ratePct = null (pas de division par zéro)
 *   3.  1 notification non lue → readCount=0, totalCount=1, ratePct=0
 *   4.  1 notification lue → readCount=1, totalCount=1, ratePct=100
 *   5.  N notifications → taux partiel (ex. 2/10 = 20)
 *   6.  0 ContactRequest → riderResponseRate.ratePct=null, median=null
 *   7.  1 ContactRequest sans réponse → riderResponseRate=0, median=null
 *   8.  1 ContactRequest avec 1 réponse → riderResponseRate=100, median calculée
 *   9.  Réponses multiples → MIN(crr.createdAt) utilisé, pas MAX
 *   10. Anciennes notifs sans data.lessonRequestId → pas de crash
 *   11. windowDays invalide → 400
 *
 * Note : le global afterEach resetDb() de jest.setup.db.ts purge toutes les tables.
 * Les fixtures doivent être créées dans chaque it() ou dans un beforeEach local.
 */

import request from 'supertest';
import jwt from 'jsonwebtoken';
import { clientPrisma as prisma } from '@blobinfini/database';
import { createApp } from '../../../index';
import { AVAILABLE_PERMISSIONS } from '../permissions';

type Role = 'RIDER' | 'PRO' | 'ADMIN';

const app = createApp();
const ROUTE = '/admin/analytics/workflow-quality';

const EMAIL_ADMIN = 'wq-admin@test.com';
const EMAIL_RIDER = 'wq-rider@test.com';
const EMAIL_PRO   = 'wq-pro@test.com';

function ensureSecrets() {
  process.env.JWT_SECRET     ||= 'test-jwt-secret';
  process.env.SESSION_SECRET ||= 'test-session-secret';
  process.env.PRIMARY_ADMIN_EMAILS = EMAIL_ADMIN;
}

function signToken(userId: string, role: Role) {
  return jwt.sign({ sub: userId, role }, process.env.JWT_SECRET!, { expiresIn: '1h' });
}

// Crée admin + rider + pro et retourne les tokens + IDs.
async function seedBase() {
  const [adminUser, riderUser, proUser] = await Promise.all([
    prisma.user.create({ data: { email: EMAIL_ADMIN, password: 'hash', role: 'ADMIN', emailVerified: true } }),
    prisma.user.create({ data: { email: EMAIL_RIDER, password: 'hash', role: 'RIDER', emailVerified: true } }),
    prisma.user.create({ data: { email: EMAIL_PRO,   password: 'hash', role: 'PRO',   emailVerified: true } }),
  ]);
  await Promise.all([
    prisma.adminProfile.create({ data: { userId: adminUser.id, permissions: [...AVAILABLE_PERMISSIONS] } }),
    prisma.riderProfile.create({ data: { userId: riderUser.id } }),
    prisma.proProfile.create({ data: { userId: proUser.id, lat: 44.8, lng: -1.2, radiusKm: 20 } }),
  ]);
  return {
    adminToken: signToken(adminUser.id, 'ADMIN'),
    riderToken: signToken(riderUser.id, 'RIDER'),
    proToken:   signToken(proUser.id,   'PRO'),
    adminId: adminUser.id,
    riderId: riderUser.id,
    proId:   proUser.id,
  };
}

// Helper : crée une conversation entre pro et rider.
async function seedConversation(proId: string, riderId: string) {
  return prisma.conversation.create({
    data: { members: { create: [{ userId: proId }, { userId: riderId }] } },
  });
}

beforeAll(() => { ensureSecrets(); });

// ─── 1. Auth ─────────────────────────────────────────────────────────────────

describe('GET /admin/analytics/workflow-quality — auth', () => {
  it('returns 401 with no token', async () => {
    await request(app).get(ROUTE).expect(401);
  });

  it('returns 403 for a RIDER', async () => {
    const { riderToken } = await seedBase();
    await request(app).get(ROUTE).set('Authorization', `Bearer ${riderToken}`).expect(403);
  });

  it('returns 403 for a PRO', async () => {
    const { proToken } = await seedBase();
    await request(app).get(ROUTE).set('Authorization', `Bearer ${proToken}`).expect(403);
  });

  it('returns 200 for an ADMIN', async () => {
    const { adminToken } = await seedBase();
    await request(app).get(ROUTE).set('Authorization', `Bearer ${adminToken}`).expect(200);
  });
});

// ─── 11. windowDays validation ────────────────────────────────────────────────

describe('GET /admin/analytics/workflow-quality — windowDays validation', () => {
  it('returns 400 when windowDays > 30', async () => {
    const { adminToken } = await seedBase();
    await request(app)
      .get(`${ROUTE}?windowDays=31`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);
  });

  it('returns 400 when windowDays = 0', async () => {
    const { adminToken } = await seedBase();
    await request(app)
      .get(`${ROUTE}?windowDays=0`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);
  });

  it('uses default windowDays=7 when not provided', async () => {
    const { adminToken } = await seedBase();
    const res = await request(app)
      .get(ROUTE)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(res.body.windowDays).toBe(7);
  });

  it('accepts windowDays=30', async () => {
    const { adminToken } = await seedBase();
    const res = await request(app)
      .get(`${ROUTE}?windowDays=30`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(res.body.windowDays).toBe(30);
  });
});

// ─── 2. notificationReadRate — 0 notification ────────────────────────────────

describe('notificationReadRate — 0 notification', () => {
  it('returns null ratePct (no division by zero)', async () => {
    const { adminToken } = await seedBase();
    const res = await request(app)
      .get(ROUTE)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.notificationReadRate).toMatchObject({
      readCount: 0,
      totalCount: 0,
      ratePct: null,
    });
  });
});

// ─── 3. notificationReadRate — 1 notification non lue ────────────────────────

describe('notificationReadRate — 1 notification non lue', () => {
  it('returns readCount=0, totalCount=1, ratePct=0', async () => {
    const { adminToken, proId } = await seedBase();

    await prisma.notification.create({
      data: {
        userId: proId,
        type: 'LESSON_REQUEST_NEARBY',
        title: 'Nouvelle demande',
        body: 'Un rider cherche un prof.',
        readAt: null,
      },
    });

    const res = await request(app)
      .get(ROUTE)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.notificationReadRate).toMatchObject({
      readCount: 0,
      totalCount: 1,
      ratePct: 0,
    });
  });
});

// ─── 4. notificationReadRate — 1 notification lue ────────────────────────────

describe('notificationReadRate — 1 notification lue', () => {
  it('returns readCount=1, totalCount=1, ratePct=100', async () => {
    const { adminToken, proId } = await seedBase();

    await prisma.notification.create({
      data: {
        userId: proId,
        type: 'LESSON_REQUEST_NEARBY',
        title: 'Nouvelle demande',
        body: 'Un rider cherche un prof.',
        readAt: new Date(),
      },
    });

    const res = await request(app)
      .get(ROUTE)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.notificationReadRate).toMatchObject({
      readCount: 1,
      totalCount: 1,
      ratePct: 100,
    });
  });
});

// ─── 5. notificationReadRate — N notifications (taux partiel) ─────────────────

describe('notificationReadRate — N notifications partiellement lues', () => {
  it('calculates 2/10 = 20%', async () => {
    const { adminToken, proId } = await seedBase();

    // 8 non lues + 2 lues = 10 total
    await prisma.notification.createMany({
      data: Array.from({ length: 8 }, (_, i) => ({
        userId: proId,
        type: 'LESSON_REQUEST_NEARBY' as const,
        title: `Demande ${i}`,
        body: 'Corps',
        readAt: null,
      })),
    });
    await prisma.notification.createMany({
      data: Array.from({ length: 2 }, (_, i) => ({
        userId: proId,
        type: 'LESSON_REQUEST_NEARBY' as const,
        title: `Demande lue ${i}`,
        body: 'Corps',
        readAt: new Date(),
      })),
    });

    // Notifications d'autres types ne doivent pas polluer le compte.
    await prisma.notification.create({
      data: {
        userId: proId,
        type: 'NEW_MESSAGE',
        title: 'Message',
        body: 'Corps',
        readAt: new Date(),
      },
    });

    const res = await request(app)
      .get(ROUTE)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.notificationReadRate.totalCount).toBe(10);
    expect(res.body.notificationReadRate.readCount).toBe(2);
    expect(res.body.notificationReadRate.ratePct).toBe(20);
  });
});

// ─── 6. riderResponseRate — 0 ContactRequest ─────────────────────────────────

describe('riderResponseRate — 0 ContactRequest', () => {
  it('returns null ratePct and null medianMinutes', async () => {
    const { adminToken } = await seedBase();
    const res = await request(app)
      .get(ROUTE)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.riderResponseRate).toMatchObject({
      respondedContactRequests: 0,
      totalContactRequests: 0,
      ratePct: null,
    });
    expect(res.body.medianRiderResponseTime.minutes).toBeNull();
  });
});

// ─── 7. riderResponseRate — 1 ContactRequest sans réponse ────────────────────

describe('riderResponseRate — 1 ContactRequest sans réponse', () => {
  it('returns riderResponseRate=0 and medianMinutes=null', async () => {
    const { adminToken, proId, riderId } = await seedBase();
    const conv = await seedConversation(proId, riderId);
    await prisma.contactRequest.create({
      data: { proUserId: proId, conversationId: conv.id },
    });

    const res = await request(app)
      .get(ROUTE)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.riderResponseRate).toMatchObject({
      respondedContactRequests: 0,
      totalContactRequests: 1,
      ratePct: 0,
    });
    expect(res.body.medianRiderResponseTime.minutes).toBeNull();
  });
});

// ─── 8. riderResponseRate — 1 ContactRequest avec 1 réponse ──────────────────

describe('riderResponseRate — 1 ContactRequest avec 1 réponse', () => {
  it('returns riderResponseRate=100 and median calculated', async () => {
    const { adminToken, proId, riderId } = await seedBase();
    const conv = await seedConversation(proId, riderId);

    // CR créé il y a 30 min — createdAt explicite (Prisma accepte pour @default(now()))
    const crCreatedAt = new Date(Date.now() - 30 * 60 * 1000);
    const cr = await prisma.contactRequest.create({
      data: { proUserId: proId, conversationId: conv.id, createdAt: crCreatedAt },
    });

    // Réponse créée il y a 20 min → délai depuis CR = 10 min
    const crrCreatedAt = new Date(Date.now() - 20 * 60 * 1000);
    await prisma.contactRequestResponse.create({
      data: { contactRequestId: cr.id, riderUserId: riderId, response: 'ACCEPT', createdAt: crrCreatedAt },
    });

    const res = await request(app)
      .get(ROUTE)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.riderResponseRate).toMatchObject({
      respondedContactRequests: 1,
      totalContactRequests: 1,
      ratePct: 100,
    });
    // Délai ≈ 10 min — tolérance ±1 min pour l'exécution du test
    const minutes = res.body.medianRiderResponseTime.minutes as number;
    expect(minutes).toBeGreaterThan(9);
    expect(minutes).toBeLessThan(11);
  });
});

// ─── 9. Réponses multiples — MIN(crr.createdAt) utilisé ──────────────────────

describe('medianRiderResponseTime — réponses multiples', () => {
  it('uses MIN(createdAt) not MAX when multiple responses exist', async () => {
    const { adminToken, proId, riderId } = await seedBase();

    // Rider 2 supplémentaire pour la deuxième réponse (unique constraint)
    const rider2 = await prisma.user.create({
      data: { email: 'wq-rider2@test.com', password: 'hash', role: 'RIDER', emailVerified: true },
    });
    await prisma.riderProfile.create({ data: { userId: rider2.id } });

    const conv = await seedConversation(proId, riderId);

    // CR créé il y a 60 min — createdAt explicite
    const crCreatedAt = new Date(Date.now() - 60 * 60 * 1000);
    const cr = await prisma.contactRequest.create({
      data: { proUserId: proId, conversationId: conv.id, createdAt: crCreatedAt },
    });

    // Réponse 1 (PRÉCOCE) — il y a 50 min → délai depuis CR = 10 min
    const crr1CreatedAt = new Date(Date.now() - 50 * 60 * 1000);
    await prisma.contactRequestResponse.create({
      data: { contactRequestId: cr.id, riderUserId: riderId, response: 'ACCEPT', createdAt: crr1CreatedAt },
    });

    // Réponse 2 (TARDIVE) — il y a 5 min → délai depuis CR = 55 min
    const crr2CreatedAt = new Date(Date.now() - 5 * 60 * 1000);
    await prisma.contactRequestResponse.create({
      data: { contactRequestId: cr.id, riderUserId: rider2.id, response: 'ACCEPT', createdAt: crr2CreatedAt },
    });

    const res = await request(app)
      .get(ROUTE)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const minutes = res.body.medianRiderResponseTime.minutes as number;
    // MIN → délai ≈ 10 min. Si MAX était utilisé → ≈ 55 min.
    expect(minutes).toBeGreaterThan(9);
    expect(minutes).toBeLessThan(11);
  });
});

// ─── 10. Données historiques sans data.lessonRequestId ───────────────────────

describe('notificationReadRate — anciennes notifications sans lessonRequestId dans data', () => {
  it('includes them in readRate without crashing', async () => {
    const { adminToken, proId } = await seedBase();

    // Ancienne notification : data = null (pré-C10)
    await prisma.notification.create({
      data: {
        userId: proId,
        type: 'LESSON_REQUEST_NEARBY',
        title: 'Demande ancienne',
        body: 'Corps',
        data: null,
        readAt: new Date(),
      },
    });

    // Notification sans lessonRequestId dans data (data présente mais sans le champ)
    await prisma.notification.create({
      data: {
        userId: proId,
        type: 'LESSON_REQUEST_NEARBY',
        title: 'Demande intermédiaire',
        body: 'Corps',
        data: { riderProfileRef: 'some-ref', sport: 'surf' },
        readAt: null,
      },
    });

    const res = await request(app)
      .get(ROUTE)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    // Les 2 notifs sont comptées (pas de filtre sur data.lessonRequestId)
    expect(res.body.notificationReadRate.totalCount).toBe(2);
    expect(res.body.notificationReadRate.readCount).toBe(1);
    expect(res.body.notificationReadRate.ratePct).toBe(50);
  });
});

// ─── contactConversionRate — vérification de la définition ───────────────────

describe('contactConversionRate — definition: contacts_per_notification', () => {
  it('returns correct contactCount/notificationCount ratio', async () => {
    const { adminToken, proId, riderId } = await seedBase();

    // 4 notifications envoyées
    await prisma.notification.createMany({
      data: Array.from({ length: 4 }, (_, i) => ({
        userId: proId,
        type: 'LESSON_REQUEST_NEARBY' as const,
        title: `Demande ${i}`,
        body: 'Corps',
      })),
    });

    // 1 ContactRequest créé (1 pro a contacté)
    const conv = await seedConversation(proId, riderId);
    await prisma.contactRequest.create({
      data: { proUserId: proId, conversationId: conv.id },
    });

    const res = await request(app)
      .get(ROUTE)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.contactConversionRate).toMatchObject({
      contactCount: 1,
      notificationCount: 4,
      ratePct: 25,
      definition: 'contacts_per_notification',
    });
  });

  it('returns null ratePct when no notifications', async () => {
    const { adminToken, proId, riderId } = await seedBase();
    const conv = await seedConversation(proId, riderId);
    await prisma.contactRequest.create({
      data: { proUserId: proId, conversationId: conv.id },
    });

    const res = await request(app)
      .get(ROUTE)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    // 0 notif → dénominateur = 0 → ratePct null
    expect(res.body.contactConversionRate.ratePct).toBeNull();
    expect(res.body.contactConversionRate.definition).toBe('contacts_per_notification');
  });
});

// ─── 11. Pas de PII dans la réponse ──────────────────────────────────────────

describe('workflow-quality — no PII in response', () => {
  it('does not expose riderId or proUserId', async () => {
    const { adminToken, proId, riderId } = await seedBase();
    const conv = await seedConversation(proId, riderId);
    await prisma.contactRequest.create({
      data: { proUserId: proId, conversationId: conv.id },
    });
    await prisma.notification.create({
      data: {
        userId: proId,
        type: 'LESSON_REQUEST_NEARBY',
        title: 'Test',
        body: 'Corps',
        readAt: new Date(),
      },
    });

    const res = await request(app)
      .get(ROUTE)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const bodyStr = JSON.stringify(res.body);
    expect(bodyStr).not.toContain(proId);
    expect(bodyStr).not.toContain(riderId);
  });
});
