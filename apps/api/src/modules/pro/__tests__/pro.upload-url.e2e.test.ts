/**
 * e2e — POST /pro/photo/upload-url
 *
 * Contrat :
 *   - 401 si non authentifié
 *   - 403 si rôle RIDER
 *   - 400 si contentType manquant ou non supporté (gif inclus)
 *   - 200 avec { uploadUrl, key } pour un PRO avec contentType valide
 *   - IDOR : clé générée pour userId A ne peut pas être utilisée par userId B via finalize
 */
import request from 'supertest';
import { createApp } from '../../../index';
import { clientPrisma as prisma, Role } from '@blobinfini/database';
import { getAccessToken, TestSession } from '../../../tests/helpers/auth';
import { resetDb } from '../../../test-utils/resetDb';
import { __setTestGetObjectMock } from '../../../lib/s3';
import { __resetUploadTokenStore } from '../../../lib/upload-token';

const JPEG_MAGIC = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01]);

describe('POST /pro/photo/upload-url — sécurité', () => {
  const app = createApp();

  let proSession: TestSession;
  let proToken: string;
  let proUserId: string;
  let pro2Session: TestSession;
  let pro2Token: string;
  let riderSession: TestSession;

  beforeEach(async () => {
    await resetDb();
    __resetUploadTokenStore();
    __setTestGetObjectMock(null);

    const ts = Date.now();

    const proAuth = await getAccessToken({
      app,
      email: `pro-upload-url-${ts}@test.com`,
      role: Role.PRO,
    });
    proSession = proAuth.session;
    proToken = proAuth.accessToken;
    const proUser = await prisma.user.findUnique({ where: { email: `pro-upload-url-${ts}@test.com` } });
    proUserId = proUser!.id;

    const pro2Auth = await getAccessToken({
      app,
      email: `pro2-upload-url-${ts}@test.com`,
      role: Role.PRO,
    });
    pro2Session = pro2Auth.session;
    pro2Token = pro2Auth.accessToken;

    const riderAuth = await getAccessToken({
      app,
      email: `rider-upload-url-${ts}@test.com`,
      role: Role.RIDER,
    });
    riderSession = riderAuth.session;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // ── Auth ───────────────────────────────────────────────────────────────────

  it('401 ou 403 — non authentifié (CSRF peut intercepter avant auth sur les POST)', async () => {
    const res = await request(app)
      .post('/pro/photo/upload-url')
      .send({ contentType: 'image/jpeg' });
    expect([401, 403]).toContain(res.status);
  });

  it('403 — RIDER ne peut pas obtenir une upload URL PRO', async () => {
    await riderSession
      .post('/pro/photo/upload-url')
      .send({ contentType: 'image/jpeg' })
      .expect(403);
  });

  // ── Validation entrée ─────────────────────────────────────────────────────

  it('400 — contentType manquant', async () => {
    const res = await proSession
      .post('/pro/photo/upload-url')
      .set('Authorization', `Bearer ${proToken}`)
      .send({})
      .expect(400);
    expect(res.body).toHaveProperty('error');
  });

  it('400 — contentType vide', async () => {
    await proSession
      .post('/pro/photo/upload-url')
      .set('Authorization', `Bearer ${proToken}`)
      .send({ contentType: '' })
      .expect(400);
  });

  it('400 — image/gif refusé (non supporté côté API)', async () => {
    const res = await proSession
      .post('/pro/photo/upload-url')
      .set('Authorization', `Bearer ${proToken}`)
      .send({ contentType: 'image/gif' })
      .expect(400);
    expect(res.body).toHaveProperty('error');
  });

  it('400 — application/pdf refusé', async () => {
    await proSession
      .post('/pro/photo/upload-url')
      .set('Authorization', `Bearer ${proToken}`)
      .send({ contentType: 'application/pdf' })
      .expect(400);
  });

  it('400 — text/html refusé', async () => {
    await proSession
      .post('/pro/photo/upload-url')
      .set('Authorization', `Bearer ${proToken}`)
      .send({ contentType: 'text/html' })
      .expect(400);
  });

  // ── Happy path ────────────────────────────────────────────────────────────

  it('200 — image/jpeg → retourne uploadUrl + key', async () => {
    const res = await proSession
      .post('/pro/photo/upload-url')
      .set('Authorization', `Bearer ${proToken}`)
      .send({ contentType: 'image/jpeg' })
      .expect(200);

    expect(res.body).toHaveProperty('uploadUrl');
    expect(res.body).toHaveProperty('key');
    expect(typeof res.body.uploadUrl).toBe('string');
    expect(typeof res.body.key).toBe('string');
    // La clé doit être scopée à l'userId (pas de fuite cross-user)
    expect(res.body.key).toContain(proUserId);
  });

  it('200 — image/png accepté', async () => {
    const res = await proSession
      .post('/pro/photo/upload-url')
      .set('Authorization', `Bearer ${proToken}`)
      .send({ contentType: 'image/png' })
      .expect(200);
    expect(res.body.key).toMatch(/\.png$/);
  });

  it('200 — image/webp accepté', async () => {
    const res = await proSession
      .post('/pro/photo/upload-url')
      .set('Authorization', `Bearer ${proToken}`)
      .send({ contentType: 'image/webp' })
      .expect(200);
    expect(res.body.key).toMatch(/\.webp$/);
  });

  it('la réponse ne contient pas de fileUrl (sécurité)', async () => {
    const res = await proSession
      .post('/pro/photo/upload-url')
      .set('Authorization', `Bearer ${proToken}`)
      .send({ contentType: 'image/jpeg' })
      .expect(200);
    expect(res.body).not.toHaveProperty('fileUrl');
  });

  // ── IDOR : clé d'un autre user ne peut pas être finalisée ────────────────

  it('IDOR — PRO B ne peut pas finaliser la clé uploadée par PRO A', async () => {
    // PRO A obtient une clé upload
    const uploadRes = await proSession
      .post('/pro/photo/upload-url')
      .set('Authorization', `Bearer ${proToken}`)
      .send({ contentType: 'image/jpeg' })
      .expect(200);
    const keyA = uploadRes.body.key as string;

    // Simuler un contenu JPEG valide côté S3 mock
    __setTestGetObjectMock(JPEG_MAGIC);

    // PRO B essaie de finaliser avec la clé de PRO A → doit échouer
    const finalizeRes = await pro2Session
      .post('/pro/photo/finalize')
      .set('Authorization', `Bearer ${pro2Token}`)
      .send({ key: keyA });

    // L'IDOR protection vérifie que le token est scopé à l'userId
    // → 403 (token pas pour cet user) ou 422 (token introuvable)
    expect([403, 422]).toContain(finalizeRes.status);
  });

  // ── Un seul appel par soumission (pas de double-submit) ──────────────────

  it('deux appels séquentiels successifs fonctionnent (pas de blocage artificiel)', async () => {
    const res1 = await proSession
      .post('/pro/photo/upload-url')
      .set('Authorization', `Bearer ${proToken}`)
      .send({ contentType: 'image/jpeg' })
      .expect(200);

    const res2 = await proSession
      .post('/pro/photo/upload-url')
      .set('Authorization', `Bearer ${proToken}`)
      .send({ contentType: 'image/jpeg' })
      .expect(200);

    // Deux clés distinctes générées
    expect(res1.body.key).not.toBe(res2.body.key);
  });
});
