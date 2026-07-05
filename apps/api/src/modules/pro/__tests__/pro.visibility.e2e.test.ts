/**
 * e2e — PATCH /pro/me/visibility
 *
 * Contrat serveur :
 *   - Aucune activation sans consent:true (opt-in RGPD explicite).
 *   - Activation refusée si le profil est incomplet (businessName/bio manquants)
 *     ou si publicCity est invalide.
 *   - Le slug est généré une seule fois puis reste stable, même si le
 *     businessName change ensuite.
 *   - La désactivation repasse immédiatement l'endpoint public à 404.
 */
import request from 'supertest';
import { createApp } from '../../../index';
import { clientPrisma as prisma, Role } from '@blobinfini/database';
import { getAccessToken, TestSession } from '../../../tests/helpers/auth';
import { resetDb } from '../../../test-utils/resetDb';

describe('PATCH /pro/me/visibility', () => {
  const app = createApp();

  let proSession: TestSession;
  let proUserId: string;
  let riderSession: TestSession;

  beforeEach(async () => {
    await resetDb();

    const proAuth = await getAccessToken({
      app,
      email: `pro-visibility-${Date.now()}@test.com`,
      role: Role.PRO,
    });
    proSession = proAuth.session;
    proUserId = proAuth.userId;

    const riderAuth = await getAccessToken({
      app,
      email: `rider-visibility-${Date.now()}@test.com`,
      role: Role.RIDER,
    });
    riderSession = riderAuth.session;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const completeProfile = () =>
    prisma.proProfile.upsert({
      where: { userId: proUserId },
      create: { userId: proUserId, businessName: 'Blob Surf School', bio: 'Cours tous niveaux' },
      update: { businessName: 'Blob Surf School', bio: 'Cours tous niveaux' },
    });

  // ── Auth guards ────────────────────────────────────────────────────────────

  it('returns 401 or 403 for unauthenticated request (CSRF before auth)', async () => {
    const res = await request(app).patch('/pro/me/visibility').send({ publicEnabled: true });
    expect([401, 403]).toContain(res.status);
  });

  it('returns 403 for RIDER', async () => {
    await riderSession
      .patch('/pro/me/visibility')
      .send({ publicEnabled: true })
      .expect(403);
  });

  // ── Garde-fous d'activation ─────────────────────────────────────────────────

  it('refuses activation without explicit consent', async () => {
    await completeProfile();
    const res = await proSession
      .patch('/pro/me/visibility')
      .send({ publicEnabled: true, publicCity: 'Lacanau' })
      .expect(400);
    expect(res.body.error).toBe('CONSENT_REQUIRED');
  });

  it('refuses activation when businessName/bio are missing', async () => {
    const res = await proSession
      .patch('/pro/me/visibility')
      .send({ publicEnabled: true, publicCity: 'Lacanau', consent: true })
      .expect(400);
    expect(res.body.error).toBe('PROFILE_INCOMPLETE');
  });

  it('refuses activation with an invalid publicCity', async () => {
    await completeProfile();
    const res = await proSession
      .patch('/pro/me/visibility')
      .send({ publicEnabled: true, publicCity: '<script>alert(1)</script>', consent: true })
      .expect(400);
    expect(res.body.error).toBe('INVALID_CITY');
  });

  it('refuses activation when no publicCity is provided and none stored yet', async () => {
    await completeProfile();
    const res = await proSession
      .patch('/pro/me/visibility')
      .send({ publicEnabled: true, consent: true })
      .expect(400);
    expect(res.body.error).toBe('INVALID_CITY');
  });

  // ── Activation nominale ──────────────────────────────────────────────────────

  it('activates the profile, generates a slug, and exposes it publicly', async () => {
    await completeProfile();

    const res = await proSession
      .patch('/pro/me/visibility')
      .send({ publicEnabled: true, publicCity: 'Lacanau', consent: true })
      .expect(200);

    expect(res.body).toEqual({
      publicEnabled: true,
      publicCity: 'Lacanau',
      slug: 'blob-surf-school',
    });

    await request(app).get('/public/pros/blob-surf-school').expect(200);
  });

  it('keeps the slug stable across a businessName change', async () => {
    await completeProfile();
    await proSession
      .patch('/pro/me/visibility')
      .send({ publicEnabled: true, publicCity: 'Lacanau', consent: true })
      .expect(200);

    await prisma.proProfile.update({
      where: { userId: proUserId },
      data: { businessName: 'Nouveau Nom Complètement Différent' },
    });

    const res = await proSession
      .patch('/pro/me/visibility')
      .send({ publicEnabled: true, consent: true })
      .expect(200);

    expect(res.body.slug).toBe('blob-surf-school');
  });

  // ── Désactivation ────────────────────────────────────────────────────────────

  it('deactivation immediately 404s the public endpoint', async () => {
    await completeProfile();
    await proSession
      .patch('/pro/me/visibility')
      .send({ publicEnabled: true, publicCity: 'Lacanau', consent: true })
      .expect(200);
    await request(app).get('/public/pros/blob-surf-school').expect(200);

    const res = await proSession
      .patch('/pro/me/visibility')
      .send({ publicEnabled: false })
      .expect(200);
    expect(res.body.publicEnabled).toBe(false);

    await request(app).get('/public/pros/blob-surf-school').expect(404);
  });

  it('deactivation requires no consent field', async () => {
    await completeProfile();
    await proSession
      .patch('/pro/me/visibility')
      .send({ publicEnabled: false })
      .expect(200);
  });
});
