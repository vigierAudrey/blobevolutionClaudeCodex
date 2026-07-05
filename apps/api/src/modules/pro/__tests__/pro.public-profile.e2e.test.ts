/**
 * e2e — GET /public/pros/:slug + GET /public/pros/slugs
 *
 * Contrat serveur (page publique /pros/[slug], aucune auth) :
 *   - Seuls les profils publicEnabled=true, avec slug + businessName,
 *     d'un compte non supprimé, sont servis — sinon 404 uniforme.
 *   - Le DTO ne contient JAMAIS : id, userId, lat, lng, email, emailNotif,
 *     notificationPreferences, countryCode, radiusKm, createdAt, updatedAt.
 *     publicCity est la seule localisation exposée.
 *   - Seules les offres actives sortent, sans lat/lng ni description.
 */
import request from 'supertest';
import { createApp } from '../../../index';
import { clientPrisma as prisma, Role } from '@blobinfini/database';
import { getAccessToken } from '../../../tests/helpers/auth';
import { resetDb } from '../../../test-utils/resetDb';

const BIARRITZ = { lat: 43.483, lng: -1.558 };

// Champs qui ne doivent apparaître à AUCUN niveau de la réponse publique.
const BANNED_KEYS = [
  'id',
  'userId',
  'lat',
  'lng',
  'email',
  'emailNotif',
  'notificationPreferences',
  'countryCode',
  'radiusKm',
  'createdAt',
  'updatedAt',
  'description',
] as const;

function collectKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, keys);
  } else if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      keys.add(key);
      collectKeys(nested, keys);
    }
  }
  return keys;
}

function expectNoBannedKeys(body: unknown, allowed: readonly string[] = []): void {
  const keys = collectKeys(body);
  for (const banned of BANNED_KEYS) {
    if (allowed.includes(banned)) continue;
    expect(keys.has(banned)).toBe(false);
  }
}

async function createPublishedPro(app: ReturnType<typeof createApp>, suffix: string) {
  const { userId } = await getAccessToken({
    app,
    email: `pro-public-${suffix}-${Date.now()}@test.com`,
    role: Role.PRO,
  });

  const profile = await prisma.proProfile.create({
    data: {
      userId,
      businessName: `Blob Surf ${suffix}`,
      bio: 'Cours de surf tous niveaux',
      photoUrl: 'https://cdn.example.com/photo.jpg',
      countryCode: 'FR',
      lat: BIARRITZ.lat,
      lng: BIARRITZ.lng,
      radiusKm: 30,
      emailNotif: true,
      slug: `blob-surf-${suffix}`,
      publicEnabled: true,
      publicCity: 'Biarritz',
    },
  });

  return { userId, profile };
}

describe('public pro profile endpoints', () => {
  const app = createApp();

  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // ── GET /public/pros/:slug ─────────────────────────────────────────────────

  it('returns 404 for an unknown slug', async () => {
    await request(app).get('/public/pros/inconnu-total').expect(404);
  });

  it('returns 404 for a malformed slug', async () => {
    await request(app).get('/public/pros/__PAS-un-slug__').expect(404);
  });

  it('returns 404 when the profile is not opted in (publicEnabled=false)', async () => {
    const { profile } = await createPublishedPro(app, 'optout');
    await prisma.proProfile.update({
      where: { id: profile.id },
      data: { publicEnabled: false },
    });

    await request(app).get(`/public/pros/${profile.slug}`).expect(404);
  });

  it('returns 404 when the account is soft-deleted', async () => {
    const { userId, profile } = await createPublishedPro(app, 'deleted');
    await prisma.user.update({ where: { id: userId }, data: { deletedAt: new Date() } });

    await request(app).get(`/public/pros/${profile.slug}`).expect(404);
  });

  it('serves a published profile without auth and without any banned field', async () => {
    const { profile } = await createPublishedPro(app, 'ok');
    await prisma.proOffer.create({
      data: {
        proProfileId: profile.id,
        sport: 'surf',
        level: 'beginner',
        title: 'Cours débutant',
        description: 'Adresse du spot : ne doit jamais sortir',
        hourlyRate: 45.5,
        lat: BIARRITZ.lat,
        lng: BIARRITZ.lng,
        isActive: true,
      },
    });

    const res = await request(app).get(`/public/pros/${profile.slug}`).expect(200);

    expect(res.body).toEqual({
      slug: profile.slug,
      businessName: 'Blob Surf ok',
      bio: 'Cours de surf tous niveaux',
      photoUrl: 'https://cdn.example.com/photo.jpg',
      publicCity: 'Biarritz',
      pricePerHour: null,
      verified: false,
      offers: [
        { sport: 'surf', level: 'beginner', title: 'Cours débutant', hourlyRate: 45.5 },
      ],
    });
    expectNoBannedKeys(res.body);
  });

  it('excludes inactive offers', async () => {
    const { profile } = await createPublishedPro(app, 'inactive');
    await prisma.proOffer.create({
      data: {
        proProfileId: profile.id,
        sport: 'kitesurf',
        level: 'advanced',
        title: 'Offre désactivée',
        description: 'x',
        hourlyRate: 80,
        lat: BIARRITZ.lat,
        lng: BIARRITZ.lng,
        isActive: false,
      },
    });

    const res = await request(app).get(`/public/pros/${profile.slug}`).expect(200);
    expect(res.body.offers).toEqual([]);
  });

  // ── GET /public/pros/slugs ─────────────────────────────────────────────────

  it('lists only published profiles of active accounts, minimal fields', async () => {
    const published = await createPublishedPro(app, 'listed');

    const hidden = await createPublishedPro(app, 'hidden');
    await prisma.proProfile.update({
      where: { id: hidden.profile.id },
      data: { publicEnabled: false },
    });

    const gone = await createPublishedPro(app, 'gone');
    await prisma.user.update({
      where: { id: gone.userId },
      data: { deletedAt: new Date() },
    });

    const res = await request(app).get('/public/pros/slugs').expect(200);

    expect(res.body.nextCursor).toBeNull();
    expect(res.body.items).toEqual([
      { slug: published.profile.slug, updatedAt: expect.any(String) },
    ]);
    // updatedAt est le seul champ toléré ici : c'est le lastModified du sitemap.
    expectNoBannedKeys(res.body, ['updatedAt']);
  });

  it('rejects a malformed cursor', async () => {
    await request(app).get('/public/pros/slugs?cursor=__nope__').expect(400);
  });
});
