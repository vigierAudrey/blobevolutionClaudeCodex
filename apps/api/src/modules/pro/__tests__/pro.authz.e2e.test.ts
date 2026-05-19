/**
 * e2e — AuthZ serveur proRouter
 *
 * Contrat :
 *   - Toutes les routes PRO_ONLY renvoient 403 pour un RIDER authentifié + email vérifié.
 *   - Toutes les routes PRO_ONLY renvoient 401 pour un utilisateur non authentifié.
 *   - Un PRO authentifié + email vérifié peut accéder aux routes PRO_ONLY.
 *
 * Routes testées (11) :
 *   PRO_ONLY_READ  : GET /pro/me, GET /pro/me/preview, GET /pro/near/lessons,
 *                    GET /pro/export, GET /pro/deletion-status
 *   PRO_ONLY_WRITE : PUT /pro/me, PATCH /pro/me, POST /pro/photo/upload-url,
 *                    POST /pro/photo/finalize, POST /pro/delete-account,
 *                    POST /pro/cancel-deletion
 */
import request from 'supertest';
import { createApp } from '../../../index';
import { clientPrisma as prisma, Role } from '@blobinfini/database';
import { getAccessToken, TestSession } from '../../../tests/helpers/auth';
import { resetDb } from '../../../test-utils/resetDb';

describe('proRouter — AuthZ (RIDER cannot access PRO_ONLY routes)', () => {
  const app = createApp();

  let proSession: TestSession;
  let riderSession: TestSession;

  beforeEach(async () => {
    await resetDb();

    const ts = Date.now();

    const proAuth = await getAccessToken({
      app,
      email: `pro-authz-${ts}@test.com`,
      role: Role.PRO,
    });
    proSession = proAuth.session;

    const riderAuth = await getAccessToken({
      app,
      email: `rider-authz-${ts}@test.com`,
      role: Role.RIDER,
    });
    riderSession = riderAuth.session;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // ── Unauthenticated → 401 ──────────────────────────────────────────────────

  it('GET /pro/me — unauthenticated → 401', async () => {
    await request(app).get('/pro/me').expect(401);
  });

  it('PUT /pro/me — unauthenticated → 401 ou 403 (CSRF avant auth)', async () => {
    const res = await request(app).put('/pro/me').send({});
    expect([401, 403]).toContain(res.status);
  });

  it('GET /pro/export — unauthenticated → 401', async () => {
    await request(app).get('/pro/export').expect(401);
  });

  it('POST /pro/delete-account — unauthenticated → 401 ou 403 (CSRF avant auth)', async () => {
    const res = await request(app).post('/pro/delete-account').send({ confirm: true });
    expect([401, 403]).toContain(res.status);
  });

  it('POST /pro/cancel-deletion — unauthenticated → 401 ou 403 (CSRF avant auth)', async () => {
    const res = await request(app).post('/pro/cancel-deletion').send({});
    expect([401, 403]).toContain(res.status);
  });

  it('GET /pro/deletion-status — unauthenticated → 401', async () => {
    await request(app).get('/pro/deletion-status').expect(401);
  });

  // ── RIDER → 403 ───────────────────────────────────────────────────────────

  it('GET /pro/me — RIDER → 403', async () => {
    await riderSession.get('/pro/me').expect(403);
  });

  it('GET /pro/me/preview — RIDER → 403', async () => {
    await riderSession.get('/pro/me/preview').expect(403);
  });

  it('PUT /pro/me — RIDER → 403', async () => {
    await riderSession.put('/pro/me').send({}).expect(403);
  });

  it('PATCH /pro/me — RIDER → 403', async () => {
    await riderSession.patch('/pro/me').send({}).expect(403);
  });

  it('POST /pro/photo/upload-url — RIDER → 403', async () => {
    await riderSession
      .post('/pro/photo/upload-url')
      .send({ filename: 'test.jpg', contentType: 'image/jpeg' })
      .expect(403);
  });

  it('POST /pro/photo/finalize — RIDER → 403', async () => {
    await riderSession
      .post('/pro/photo/finalize')
      .send({ token: 'fake-token', key: 'fake-key' })
      .expect(403);
  });

  it('GET /pro/near/lessons — RIDER → 403', async () => {
    await riderSession.get('/pro/near/lessons?lat=43.483&lng=-1.558&radiusKm=30').expect(403);
  });

  it('GET /pro/export — RIDER → 403', async () => {
    await riderSession.get('/pro/export').expect(403);
  });

  it('POST /pro/delete-account — RIDER → 403', async () => {
    await riderSession.post('/pro/delete-account').send({ confirm: true }).expect(403);
  });

  it('POST /pro/cancel-deletion — RIDER → 403', async () => {
    await riderSession.post('/pro/cancel-deletion').send({}).expect(403);
  });

  it('GET /pro/deletion-status — RIDER → 403', async () => {
    await riderSession.get('/pro/deletion-status').expect(403);
  });

  // ── PRO → accès autorisé ──────────────────────────────────────────────────

  it('GET /pro/me — PRO → 200', async () => {
    await proSession.get('/pro/me').expect(200);
  });

  it('GET /pro/deletion-status — PRO → 200', async () => {
    const res = await proSession.get('/pro/deletion-status').expect(200);
    expect(res.body).toHaveProperty('isScheduled', false);
  });

  it('GET /pro/export — PRO → 200', async () => {
    const res = await proSession.get('/pro/export').expect(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });

  it('PUT /pro/me — PRO → 200 avec payload france-launch valide', async () => {
    await proSession
      .put('/pro/me')
      .send({ bio: 'Instructeur surf Biarritz', countryCode: 'FR', lat: 43.483, lng: -1.558 })
      .expect(200);
  });

  it('PATCH /pro/me — PRO → 200 avec payload france-launch valide', async () => {
    await proSession
      .patch('/pro/me')
      .send({ bio: 'Instructeur surf Biarritz', countryCode: 'FR', lat: 43.483, lng: -1.558 })
      .expect(200);
  });
});
