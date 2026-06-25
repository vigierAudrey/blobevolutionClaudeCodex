/**
 * e2e — AuthZ serveur profileRouter (symétrie RIDER_ONLY)
 *
 * Contrat :
 *   - Routes RIDER_ONLY renvoient 403 pour un PRO authentifié + email vérifié.
 *   - Routes RIDER_ONLY renvoient 401 (ou 403 si CSRF) pour un utilisateur non authentifié.
 *   - Un RIDER authentifié + email vérifié peut accéder aux routes RIDER_ONLY.
 *   - Routes AUTHENTICATED_ANY (notifications, export) restent accessibles aux deux rôles.
 *
 * Routes RIDER_ONLY testées (5) :
 *   GET  /profile/disciplines
 *   PUT  /profile/disciplines
 *   POST /profile/delete-account
 *   POST /profile/cancel-deletion
 *   GET  /profile/deletion-status
 *
 * Routes AUTHENTICATED_ANY vérifiées (2) :
 *   GET  /profile/notifications
 *   PUT  /profile/notifications
 */
import request from 'supertest';
import { createApp } from '../../../index';
import { clientPrisma as prisma, Role } from '@blobinfini/database';
import { getAccessToken, TestSession } from '../../../tests/helpers/auth';
import { resetDb } from '../../../test-utils/resetDb';

describe('profileRouter — AuthZ (PRO cannot access RIDER_ONLY routes)', () => {
  const app = createApp();

  let proSession: TestSession;
  let riderSession: TestSession;
  let proUserId: string;
  let riderUserId: string;

  beforeEach(async () => {
    await resetDb();

    const ts = Date.now();

    const proAuth = await getAccessToken({
      app,
      email: `pro-profauthz-${ts}@test.com`,
      role: Role.PRO,
    });
    proSession = proAuth.session;
    proUserId = proAuth.userId;

    const riderAuth = await getAccessToken({
      app,
      email: `rider-profauthz-${ts}@test.com`,
      role: Role.RIDER,
    });
    riderSession = riderAuth.session;
    riderUserId = riderAuth.userId;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // ── Unauthenticated → 401 (GET) / 401 ou 403 (mutation avec CSRF) ──────────

  it('GET /profile/disciplines — unauthenticated → 401', async () => {
    await request(app).get('/profile/disciplines').expect(401);
  });

  it('GET /profile/deletion-status — unauthenticated → 401', async () => {
    await request(app).get('/profile/deletion-status').expect(401);
  });

  it('PUT /profile/disciplines — unauthenticated → 401 ou 403 (CSRF avant auth)', async () => {
    const res = await request(app).put('/profile/disciplines').send([]);
    expect([401, 403]).toContain(res.status);
  });

  it('POST /profile/delete-account — unauthenticated → 401 ou 403 (CSRF avant auth)', async () => {
    const res = await request(app).post('/profile/delete-account').send({ confirm: true });
    expect([401, 403]).toContain(res.status);
  });

  it('POST /profile/cancel-deletion — unauthenticated → 401 ou 403 (CSRF avant auth)', async () => {
    const res = await request(app).post('/profile/cancel-deletion').send({});
    expect([401, 403]).toContain(res.status);
  });

  // ── PRO → 403 sur toutes les routes RIDER_ONLY ────────────────────────────

  it('GET /profile/disciplines — PRO → 403', async () => {
    await proSession.get('/profile/disciplines').expect(403);
  });

  it('PUT /profile/disciplines — PRO → 403', async () => {
    await proSession.put('/profile/disciplines').send([]).expect(403);
  });

  it('POST /profile/delete-account — PRO → 403', async () => {
    await proSession.post('/profile/delete-account').send({ confirm: true }).expect(403);
  });

  it('POST /profile/cancel-deletion — PRO → 403', async () => {
    await proSession.post('/profile/cancel-deletion').send({}).expect(403);
  });

  it('GET /profile/deletion-status — PRO → 403', async () => {
    await proSession.get('/profile/deletion-status').expect(403);
  });

  // ── RIDER → accès autorisé ────────────────────────────────────────────────

  it('GET /profile/disciplines — RIDER → 200', async () => {
    const res = await riderSession.get('/profile/disciplines').expect(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('PUT /profile/disciplines — RIDER → 200', async () => {
    const res = await riderSession
      .put('/profile/disciplines')
      .send([{ sport: 'surf', level: 'beginner' }])
      .expect(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('GET /profile/deletion-status — RIDER → 200', async () => {
    const res = await riderSession.get('/profile/deletion-status').expect(200);
    expect(res.body).toHaveProperty('scheduled', false);
  });

  // ── Routes AUTHENTICATED_ANY : accessibles aux deux rôles ─────────────────

  it('GET /profile/notifications — RIDER → 200 sans écriture implicite', async () => {
    await prisma.notificationPreferences.deleteMany({ where: { userId: riderUserId } });

    const res = await riderSession.get('/profile/notifications').expect(200);

    expect(res.body.preferences).toEqual(expect.objectContaining({
      inAppEnabled: true,
      pushEnabled: true,
    }));
    expect(res.headers['cache-control']).toContain('private');
    expect(res.headers['cache-control']).toContain('no-store');
    await expect(
      prisma.notificationPreferences.count({ where: { userId: riderUserId } }),
    ).resolves.toBe(0);
  });

  it('GET /profile/notifications — PRO → 200', async () => {
    await proSession.get('/profile/notifications').expect(200);
  });

  it('PUT /profile/notifications — RIDER → 200', async () => {
    await riderSession
      .put('/profile/notifications')
      .send({ pushEnabled: true })
      .expect(200);
  });

  it('PUT /profile/notifications — PRO → 200', async () => {
    await proSession
      .put('/profile/notifications')
      .send({ pushEnabled: true })
      .expect(200);
  });

  it('PUT /profile/notifications rejette userId client et ne modifie aucun compte', async () => {
    await prisma.notificationPreferences.create({
      data: {
        userId: riderUserId,
        pushEnabled: true,
        notifyMessages: true,
      },
    });

    await proSession
      .put('/profile/notifications')
      .send({
        userId: riderUserId,
        pushEnabled: false,
        notifyProMessages: false,
        notifyMessages: false,
      })
      .expect(400);

    const proPrefs = await prisma.notificationPreferences.findUnique({
      where: { userId: proUserId },
    });
    const riderPrefs = await prisma.notificationPreferences.findUnique({
      where: { userId: riderUserId },
    });

    expect(proPrefs).toBeNull();
    expect(riderPrefs?.pushEnabled).toBe(true);
    expect(riderPrefs?.notifyMessages).toBe(true);
  });

  // ── Routes déjà protégées inline : régression ────────────────────────────

  it('GET /profile/me — PRO → 403 (inline guard existant)', async () => {
    await proSession.get('/profile/me').expect(403);
  });

  it('GET /profile/me — RIDER → 200 (régression)', async () => {
    await riderSession.get('/profile/me').expect(200);
  });
});
