/**
 * e2e — GET /pro/me/preview
 *
 * Contrat serveur :
 *   - Seuls les PRO authentifiés peuvent accéder à leur propre preview.
 *   - Le DTO retourné ne contient JAMAIS : id, userId, lat, lng, emailNotif,
 *     notificationPreferences, createdAt, updatedAt, verified, pricePerHour.
 *   - hasLocation est un booléen — jamais les coordonnées exactes.
 */
import request from 'supertest';
import { createApp } from '../../../index';
import { clientPrisma as prisma, Role } from '@blobinfini/database';
import { getAccessToken, TestSession } from '../../../tests/helpers/auth';
import { resetDb } from '../../../test-utils/resetDb';

const BIARRITZ = { lat: 43.483, lng: -1.558 };

describe('GET /pro/me/preview', () => {
  const app = createApp();

  let proSession: TestSession;
  let proUserId: string;
  let riderSession: TestSession;

  beforeEach(async () => {
    await resetDb();

    const proAuth = await getAccessToken({
      app,
      email: `pro-preview-${Date.now()}@test.com`,
      role: Role.PRO,
    });
    proSession = proAuth.session;
    proUserId = proAuth.userId;

    const riderAuth = await getAccessToken({
      app,
      email: `rider-preview-${Date.now()}@test.com`,
      role: Role.RIDER,
    });
    riderSession = riderAuth.session;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // ── Auth guards ────────────────────────────────────────────────────────────

  it('returns 401 for unauthenticated request', async () => {
    await request(app).get('/pro/me/preview').expect(401);
  });

  it('returns 403 for RIDER', async () => {
    await riderSession.get('/pro/me/preview').expect(403);
  });

  // ── DTO minimal — profil sans données ─────────────────────────────────────

  it('returns empty safe DTO when pro has no profile yet', async () => {
    const res = await proSession.get('/pro/me/preview').expect(200);

    expect(res.body).toMatchObject({
      businessName: null,
      bio: null,
      photoUrl: null,
      hasLocation: false,
    });
  });

  // ── DTO minimal — profil complet ───────────────────────────────────────────

  it('returns only public fields for a PRO with a complete profile', async () => {
    await prisma.proProfile.upsert({
      where: { userId: proUserId },
      create: {
        userId: proUserId,
        businessName: 'BlobPro School',
        bio: 'Cours de surf à Biarritz',
        photoUrl: 'https://cdn.example.com/photo.jpg',
        countryCode: 'FR',
        lat: BIARRITZ.lat,
        lng: BIARRITZ.lng,
        radiusKm: 30,
        emailNotif: true,
      },
      update: {
        businessName: 'BlobPro School',
        bio: 'Cours de surf à Biarritz',
        photoUrl: 'https://cdn.example.com/photo.jpg',
        countryCode: 'FR',
        lat: BIARRITZ.lat,
        lng: BIARRITZ.lng,
        radiusKm: 30,
        emailNotif: true,
      },
    });

    const res = await proSession.get('/pro/me/preview').expect(200);

    expect(res.body).toEqual({
      businessName: 'BlobPro School',
      bio: 'Cours de surf à Biarritz',
      photoUrl: 'https://cdn.example.com/photo.jpg',
      countryCode: 'FR',
      radiusKm: 30,
      hasLocation: true,
    });
  });

  // ── hasLocation booléen ────────────────────────────────────────────────────

  it('sets hasLocation=true when lat/lng are set', async () => {
    await prisma.proProfile.upsert({
      where: { userId: proUserId },
      create: { userId: proUserId, lat: BIARRITZ.lat, lng: BIARRITZ.lng },
      update: { lat: BIARRITZ.lat, lng: BIARRITZ.lng },
    });

    const res = await proSession.get('/pro/me/preview').expect(200);
    expect(res.body.hasLocation).toBe(true);
  });

  it('sets hasLocation=false when lat/lng are null', async () => {
    await prisma.proProfile.upsert({
      where: { userId: proUserId },
      create: { userId: proUserId, lat: null, lng: null },
      update: { lat: null, lng: null },
    });

    const res = await proSession.get('/pro/me/preview').expect(200);
    expect(res.body.hasLocation).toBe(false);
  });

  // ── Isolation des champs privés ────────────────────────────────────────────

  it('never returns id in the response body', async () => {
    const res = await proSession.get('/pro/me/preview').expect(200);
    expect(res.body).not.toHaveProperty('id');
  });

  it('never returns userId in the response body', async () => {
    const res = await proSession.get('/pro/me/preview').expect(200);
    expect(res.body).not.toHaveProperty('userId');
  });

  it('never returns lat in the response body', async () => {
    await prisma.proProfile.upsert({
      where: { userId: proUserId },
      create: { userId: proUserId, lat: BIARRITZ.lat, lng: BIARRITZ.lng },
      update: { lat: BIARRITZ.lat, lng: BIARRITZ.lng },
    });

    const res = await proSession.get('/pro/me/preview').expect(200);
    expect(res.body).not.toHaveProperty('lat');
  });

  it('never returns lng in the response body', async () => {
    await prisma.proProfile.upsert({
      where: { userId: proUserId },
      create: { userId: proUserId, lat: BIARRITZ.lat, lng: BIARRITZ.lng },
      update: { lat: BIARRITZ.lat, lng: BIARRITZ.lng },
    });

    const res = await proSession.get('/pro/me/preview').expect(200);
    expect(res.body).not.toHaveProperty('lng');
  });

  it('never returns emailNotif in the response body', async () => {
    await prisma.proProfile.upsert({
      where: { userId: proUserId },
      create: { userId: proUserId, emailNotif: true },
      update: { emailNotif: true },
    });

    const res = await proSession.get('/pro/me/preview').expect(200);
    expect(res.body).not.toHaveProperty('emailNotif');
  });

  it('never returns notificationPreferences in the response body', async () => {
    await prisma.proProfile.upsert({
      where: { userId: proUserId },
      create: { userId: proUserId, notificationPreferences: { pushEnabled: true } },
      update: { notificationPreferences: { pushEnabled: true } },
    });

    const res = await proSession.get('/pro/me/preview').expect(200);
    expect(res.body).not.toHaveProperty('notificationPreferences');
  });

  it('never returns createdAt in the response body', async () => {
    const res = await proSession.get('/pro/me/preview').expect(200);
    expect(res.body).not.toHaveProperty('createdAt');
  });

  it('never returns updatedAt in the response body', async () => {
    const res = await proSession.get('/pro/me/preview').expect(200);
    expect(res.body).not.toHaveProperty('updatedAt');
  });

  it('never returns verified in the response body', async () => {
    const res = await proSession.get('/pro/me/preview').expect(200);
    expect(res.body).not.toHaveProperty('verified');
  });

  it('never returns pricePerHour in the response body', async () => {
    const res = await proSession.get('/pro/me/preview').expect(200);
    expect(res.body).not.toHaveProperty('pricePerHour');
  });
});
