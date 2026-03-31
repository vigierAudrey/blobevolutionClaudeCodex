import { clientPrisma as prisma, Role } from '@blobinfini/database';
import { createApp } from '../../../index';
import { getAccessToken, TestSession } from '../../../tests/helpers/auth';
import type { CreateAvailabilityInput } from '../dto/createAvailability.dto';

const app = createApp();

describe('Availability geo guard', () => {
  let proToken = '';
  let proSession: TestSession;
  let proUserId = '';

  const resetData = async () => {
    await prisma.proAvailability.deleteMany();
    await prisma.proProfile.deleteMany({ where: { userId: proUserId } });
    await prisma.user.deleteMany({ where: { id: proUserId } });
  };

  const availabilityPayload: CreateAvailabilityInput = {
    sport: 'surf',
    levels: ['beginner'],
    startAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    endAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    capacity: 4,
    spotName: 'Test spot',
    spotLat: 43.5,
    spotLng: -1.5,
  };

  beforeEach(async () => {
    await prisma.booking.deleteMany();
    await prisma.bookingRequest.deleteMany();
    await prisma.proAvailability.deleteMany();
    await prisma.proProfile.deleteMany();
    await prisma.user.deleteMany();

    const auth = await getAccessToken({
      app,
      email: 'pro-geo-guard@test.com',
      role: Role.PRO,
    });
    proToken = auth.accessToken;
    proSession = auth.session;
    proUserId = auth.userId;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('rejects availability creation if pro has no geolocation', async () => {
    const res = await proSession
      .post('/booking/availability')
      .set('Authorization', `Bearer ${proToken}`)
      .send(availabilityPayload)
      .expect(400);

    expect(res.body.error).toBe('Localisation obligatoire pour publier des créneaux. Ajoutez votre géolocalisation dans votre profil.');
  });

  it('allows availability creation when pro has geolocation', async () => {
    await prisma.proProfile.upsert({
      where: { userId: proUserId },
      create: { userId: proUserId, countryCode: 'FR', lat: 43.5, lng: -1.5, verified: true },
      update: { lat: 43.5, lng: -1.5 },
    });

    const res = await proSession
      .post('/booking/availability')
      .set('Authorization', `Bearer ${proToken}`)
      .send(availabilityPayload)
      .expect(201);

    expect(res.body).toHaveProperty('id');
  });
});
