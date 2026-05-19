import { createApp } from '../../../index';
import { clientPrisma as prisma, Role } from '@blobinfini/database';
import { getAccessToken, TestSession } from '../../../tests/helpers/auth';
import { resetDb } from '../../../test-utils/resetDb';

describe('PRO France-only guard', () => {
  const app = createApp();

  let proSession: TestSession;
  let proUserId = '';

  beforeEach(async () => {
    await resetDb();

    const auth = await getAccessToken({
      app,
      email: `pro-france-only-${Date.now()}@test.com`,
      role: Role.PRO,
    });

    proSession = auth.session;
    proUserId = auth.userId;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('allows FR professional profile creation via PUT /pro/me', async () => {
    const res = await proSession
      .put('/pro/me')
      .send({
        businessName: 'Biarritz Surf School',
        countryCode: 'FR',
        lat: 43.4832,
        lng: -1.5586,
      })
      .expect(200);

    expect(res.body.countryCode).toBe('FR');
    expect(res.body.businessName).toBe('Biarritz Surf School');

    const profile = await prisma.proProfile.findUnique({
      where: { userId: proUserId },
      select: { countryCode: true, lat: true, lng: true },
    });

    expect(profile).toMatchObject({
      countryCode: 'FR',
      lat: 43.4832,
      lng: -1.5586,
    });
  });

  it('rejects non-FR professional profile creation via PUT /pro/me', async () => {
    const res = await proSession
      .put('/pro/me')
      .send({
        businessName: 'Geneva Coach',
        countryCode: 'CH',
        lat: 46.2044,
        lng: 6.1432,
      })
      .expect(403);

    expect(res.body.error).toBe('FRANCE_ONLY_RESTRICTED');
    expect(res.body.message).toContain('France');
  });

  it('allows FR professional profile updates via PATCH /pro/me', async () => {
    await prisma.proProfile.upsert({
      where: { userId: proUserId },
      create: {
        userId: proUserId,
        countryCode: 'FR',
        lat: 43.4832,
        lng: -1.5586,
        radiusKm: 25,
      },
      update: {
        countryCode: 'FR',
        lat: 43.4832,
        lng: -1.5586,
        radiusKm: 25,
      },
    });

    const res = await proSession.patch('/pro/me').send({ radiusKm: 40 }).expect(200);

    expect(res.body.countryCode).toBe('FR');
    expect(res.body.radiusKm).toBe(40);
  });

  it('rejects non-FR coordinates on PATCH /pro/me', async () => {
    await prisma.proProfile.upsert({
      where: { userId: proUserId },
      create: {
        userId: proUserId,
        countryCode: 'FR',
        lat: 43.4832,
        lng: -1.5586,
      },
      update: {
        countryCode: 'FR',
        lat: 43.4832,
        lng: -1.5586,
      },
    });

    const res = await proSession
      .patch('/pro/me')
      .send({ lat: 46.2044, lng: 6.1432 })
      .expect(403);

    expect(res.body.error).toBe('FRANCE_ONLY_RESTRICTED');
    expect(res.body.message).toContain('France');
  });
});
