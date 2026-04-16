import { createApp } from '../../../index';
import { clientPrisma as prisma, Role } from '@blobinfini/database';
import { getAccessToken, TestSession } from '../../../tests/helpers/auth';
import { resetDb } from '../../../test-utils/resetDb';

describe('PRO France-only guards', () => {
  const app = createApp();

  let proSession: TestSession;
  let proToken = '';
  let proUserId = '';

  beforeEach(async () => {
    await resetDb();

    const auth = await getAccessToken({
      app,
      email: `pro-france-only-${Date.now()}@test.com`,
      role: Role.PRO,
    });

    proSession = auth.session;
    proToken = auth.accessToken;
    proUserId = auth.userId;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('accepts a French pro profile location', async () => {
    const res = await proSession
      .put('/pro/me')
      .set('Authorization', `Bearer ${proToken}`)
      .send({
        countryCode: 'FR',
        businessName: 'Blob Connect Hossegor',
        lat: 43.665,
        lng: -1.428,
        radiusKm: 25,
      })
      .expect(200);

    expect(res.body).toMatchObject({
      businessName: 'Blob Connect Hossegor',
      countryCode: 'FR',
      lat: 43.665,
      lng: -1.428,
      radiusKm: 25,
    });

    const profile = await prisma.proProfile.findUnique({ where: { userId: proUserId } });
    expect(profile?.countryCode).toBe('FR');
    expect(profile?.lat).toBe(43.665);
    expect(profile?.lng).toBe(-1.428);
  });

  it('rejects a non-French country code on pro profile update', async () => {
    const res = await proSession
      .patch('/pro/me')
      .set('Authorization', `Bearer ${proToken}`)
      .send({
        countryCode: 'ES',
        lat: 43.665,
        lng: -1.428,
      })
      .expect(403);

    expect(res.body).toMatchObject({
      error: 'FRANCE_ONLY',
      message: 'Le profil professionnel doit être localisé en France.',
    });

    const profile = await prisma.proProfile.findUnique({ where: { userId: proUserId } });
    expect(profile?.countryCode ?? null).toBeNull();
  });

  it('rejects inconsistent FR coordinates outside France and preserves the last valid profile state', async () => {
    await proSession
      .put('/pro/me')
      .set('Authorization', `Bearer ${proToken}`)
      .send({
        countryCode: 'FR',
        lat: 43.665,
        lng: -1.428,
        radiusKm: 25,
      })
      .expect(200);

    const res = await proSession
      .patch('/pro/me')
      .set('Authorization', `Bearer ${proToken}`)
      .send({
        countryCode: 'FR',
        lat: 41.3874,
        lng: 2.1686,
      })
      .expect(403);

    expect(res.body).toMatchObject({
      error: 'FRANCE_ONLY',
      message: 'Le profil professionnel doit être localisé en France.',
    });

    const profile = await prisma.proProfile.findUnique({ where: { userId: proUserId } });
    expect(profile).toMatchObject({
      countryCode: 'FR',
      lat: 43.665,
      lng: -1.428,
      radiusKm: 25,
    });
  });

  it('rejects nearby lesson lookup when a legacy pro profile is outside France', async () => {
    await prisma.proProfile.upsert({
      where: { userId: proUserId },
      create: {
        userId: proUserId,
        countryCode: 'FR',
        lat: 41.3874,
        lng: 2.1686,
        radiusKm: 25,
      },
      update: {
        countryCode: 'FR',
        lat: 41.3874,
        lng: 2.1686,
        radiusKm: 25,
      },
    });

    const res = await proSession
      .get('/pro/near/lessons?radiusKm=25&sport=surf')
      .set('Authorization', `Bearer ${proToken}`)
      .expect(403);

    expect(res.body).toMatchObject({
      error: 'FRANCE_ONLY',
      message: 'Cette fonctionnalité est actuellement disponible uniquement en France.',
    });
  });
});
