/**
 * Tests e2e — GET /pro/dashboard/stats (Sprint C9)
 *
 * Valide :
 *   1.  401 sans token
 *   2.  403 rôle RIDER
 *   3.  200 + zéro données → tous les compteurs à 0, taux null
 *   4.  200 + notifications reçues → receivedRequests correct
 *   5.  200 + notifications lues → readNotifications correct
 *   6.  200 + contacts envoyés → sentContacts correct
 *   7.  200 + contacts acceptés → acceptedContacts + acceptanceRate corrects
 *   8.  200 + acceptanceRate = null quand sentContacts = 0
 *   9.  IDOR : deux pros → chacun voit uniquement ses propres stats
 *   10. activeNearbyRequests = 0 si le pro n'a pas de localisation
 *   11. Notifications hors fenêtre 7j → exclues du compteur
 *   12. weeklyNotifications groupées par semaine ISO
 *
 * Pattern :
 *   - beforeEach + resetDb() (global afterEach dans jest.setup.db.ts fait la même chose)
 *   - getAccessToken helper pour session cookie auth
 *   - Pas de mock SQL : requêtes réelles sur DB de test
 */

import request from 'supertest';
import { clientPrisma as prisma } from '@blobinfini/database';
import { createApp } from '../../../index';
import { getAccessToken } from '../../../tests/helpers/auth';
import { resetDb } from '../../../test-utils/resetDb';

const app = createApp();

const EMAIL_PRO    = 'dashboard-pro@test.com';
const EMAIL_PRO2   = 'dashboard-pro2@test.com';
const EMAIL_RIDER  = 'dashboard-rider@test.com';

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await prisma.$disconnect();
});

// ─── 1-2 : AuthN / AuthZ ──────────────────────────────────────────────────────

describe('GET /pro/dashboard/stats — auth', () => {
  it('1. retourne 401 sans token', async () => {
    await request(app).get('/pro/dashboard/stats').expect(401);
  });

  it('2. retourne 403 pour un RIDER authentifié', async () => {
    const { session } = await getAccessToken({ app, email: EMAIL_RIDER, role: 'RIDER' });
    await session.get('/pro/dashboard/stats').expect(403);
  });
});

// ─── 3-8 : Logique métier ─────────────────────────────────────────────────────

describe('GET /pro/dashboard/stats — métier', () => {
  it('3. zéro données → tous les compteurs à 0, acceptanceRate null', async () => {
    const { session } = await getAccessToken({ app, email: EMAIL_PRO, role: 'PRO' });
    const res = await session.get('/pro/dashboard/stats').expect(200);

    expect(res.body).toMatchObject({
      receivedRequests:   0,
      readNotifications:  0,
      sentContacts:       0,
      acceptedContacts:   0,
      acceptanceRate:     null,
      weeklyNotifications: [],
      weeklyContacts:      [],
      activeNearbyRequests: 0,
    });
  });

  it('4. notifications LESSON_REQUEST_NEARBY → receivedRequests correct', async () => {
    const { session, userId } = await getAccessToken({ app, email: EMAIL_PRO, role: 'PRO' });

    await prisma.notification.createMany({
      data: [
        { userId, type: 'LESSON_REQUEST_NEARBY', title: 'T1', body: 'B1' },
        { userId, type: 'LESSON_REQUEST_NEARBY', title: 'T2', body: 'B2' },
        // Type différent — ne doit PAS être compté
        { userId, type: 'NEW_MESSAGE', title: 'T3', body: 'B3' },
      ],
    });

    const res = await session.get('/pro/dashboard/stats').expect(200);
    expect(res.body.receivedRequests).toBe(2);
    expect(res.body.readNotifications).toBe(0);
  });

  it('5. notifications lues → readNotifications correct', async () => {
    const { session, userId } = await getAccessToken({ app, email: EMAIL_PRO, role: 'PRO' });
    const now = new Date();

    await prisma.notification.createMany({
      data: [
        { userId, type: 'LESSON_REQUEST_NEARBY', title: 'T1', body: 'B1', readAt: now },
        { userId, type: 'LESSON_REQUEST_NEARBY', title: 'T2', body: 'B2', readAt: now },
        { userId, type: 'LESSON_REQUEST_NEARBY', title: 'T3', body: 'B3' },
      ],
    });

    const res = await session.get('/pro/dashboard/stats').expect(200);
    expect(res.body.receivedRequests).toBe(3);
    expect(res.body.readNotifications).toBe(2);
  });

  it('6. contacts envoyés → sentContacts correct', async () => {
    const { session, userId: proUserId } = await getAccessToken({ app, email: EMAIL_PRO, role: 'PRO' });
    const riderAuth = await getAccessToken({ app, email: EMAIL_RIDER, role: 'RIDER' });

    const conv = await prisma.conversation.create({
      data: {
        type: 'RIDER_TO_PRO',
        members: { create: [{ userId: proUserId }, { userId: riderAuth.userId }] },
      },
    });

    await prisma.contactRequest.create({
      data: { proUserId, conversationId: conv.id, status: 'PENDING', message: 'Test' },
    });

    const res = await session.get('/pro/dashboard/stats').expect(200);
    expect(res.body.sentContacts).toBe(1);
    expect(res.body.acceptedContacts).toBe(0);
    // 0 accepté / 1 envoyé = 0% (pas null : le dénominateur est non-nul)
    expect(res.body.acceptanceRate).toBe(0);
  });

  it('7. contacts acceptés → acceptedContacts + acceptanceRate corrects', async () => {
    const { session, userId: proUserId } = await getAccessToken({ app, email: EMAIL_PRO, role: 'PRO' });
    const riderAuth = await getAccessToken({ app, email: EMAIL_RIDER, role: 'RIDER' });

    const conv1 = await prisma.conversation.create({
      data: {
        type: 'RIDER_TO_PRO',
        members: { create: [{ userId: proUserId }, { userId: riderAuth.userId }] },
      },
    });
    const conv2 = await prisma.conversation.create({
      data: {
        type: 'RIDER_TO_PRO',
        members: { create: [{ userId: proUserId }, { userId: riderAuth.userId }] },
      },
    });

    await prisma.contactRequest.createMany({
      data: [
        { proUserId, conversationId: conv1.id, status: 'ACCEPTED' },
        { proUserId, conversationId: conv2.id, status: 'PENDING' },
      ],
    });

    const res = await session.get('/pro/dashboard/stats').expect(200);
    expect(res.body.sentContacts).toBe(2);
    expect(res.body.acceptedContacts).toBe(1);
    // 1/2 * 100 = 50.0
    expect(res.body.acceptanceRate).toBe(50);
  });

  it('8. acceptanceRate null quand sentContacts = 0', async () => {
    const { session } = await getAccessToken({ app, email: EMAIL_PRO, role: 'PRO' });
    const res = await session.get('/pro/dashboard/stats').expect(200);
    expect(res.body.sentContacts).toBe(0);
    expect(res.body.acceptanceRate).toBeNull();
  });

  it('11. notifications hors fenêtre 7j → exclues du compteur', async () => {
    const { session, userId } = await getAccessToken({ app, email: EMAIL_PRO, role: 'PRO' });
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);

    await prisma.notification.createMany({
      data: [
        { userId, type: 'LESSON_REQUEST_NEARBY', title: 'Récent', body: 'OK' },
        {
          userId, type: 'LESSON_REQUEST_NEARBY', title: 'Ancien', body: 'KO',
          createdAt: eightDaysAgo,
        },
      ],
    });

    const res = await session.get('/pro/dashboard/stats').expect(200);
    expect(res.body.receivedRequests).toBe(1);
  });

  it('12. weeklyNotifications groupées par semaine ISO', async () => {
    const { session, userId } = await getAccessToken({ app, email: EMAIL_PRO, role: 'PRO' });

    // Semaine courante
    await prisma.notification.create({
      data: { userId, type: 'LESSON_REQUEST_NEARBY', title: 'S0', body: 'B' },
    });
    // Semaine précédente
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    await prisma.notification.create({
      data: {
        userId, type: 'LESSON_REQUEST_NEARBY', title: 'S-1', body: 'B',
        createdAt: sevenDaysAgo,
      },
    });

    const res = await session.get('/pro/dashboard/stats').expect(200);
    expect(res.body.weeklyNotifications.length).toBeGreaterThanOrEqual(1);
    expect(res.body.weeklyNotifications.every((w: { week: string }) => /^\d{4}-\d{2}-\d{2}$/.test(w.week))).toBe(true);
  });
});

// ─── 9-10 : Sécurité ──────────────────────────────────────────────────────────

describe('GET /pro/dashboard/stats — sécurité', () => {
  it('9. IDOR : pro1 ne voit pas les stats de pro2', async () => {
    const pro1Auth = await getAccessToken({ app, email: EMAIL_PRO,  role: 'PRO' });
    const pro2Auth = await getAccessToken({ app, email: EMAIL_PRO2, role: 'PRO' });

    // Créer une notification pour pro2 uniquement
    await prisma.notification.create({
      data: { userId: pro2Auth.userId, type: 'LESSON_REQUEST_NEARBY', title: 'T', body: 'B' },
    });

    // pro1 doit voir 0 — impossibilité structurelle d'accéder aux données de pro2
    const res1 = await pro1Auth.session.get('/pro/dashboard/stats').expect(200);
    expect(res1.body.receivedRequests).toBe(0);

    // pro2 voit bien ses propres données
    const res2 = await pro2Auth.session.get('/pro/dashboard/stats').expect(200);
    expect(res2.body.receivedRequests).toBe(1);
  });

  it('10. activeNearbyRequests = 0 si le pro n\'a pas de localisation', async () => {
    const { session, userId } = await getAccessToken({ app, email: EMAIL_PRO, role: 'PRO' });

    // Profil sans localisation (lat/lng null)
    await prisma.proProfile.upsert({
      where: { userId },
      create: { userId },
      update: { lat: null, lng: null },
    });

    const res = await session.get('/pro/dashboard/stats').expect(200);
    expect(res.body.activeNearbyRequests).toBe(0);
  });
});
