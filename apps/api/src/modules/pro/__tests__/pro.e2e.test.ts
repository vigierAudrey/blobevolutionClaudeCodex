import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../../../index';
import { clientPrisma as prisma } from '@blobinfini/database';

const app = createApp();

const ensureSecrets = () => {
  process.env.JWT_SECRET ||= 'test-jwt-secret';
};

const signToken = (userId: string, role: 'RIDER' | 'PRO') => {
  return jwt.sign({ sub: userId, role }, process.env.JWT_SECRET as string, { expiresIn: '1h' });
};

describe('Pro Module', () => {
  let riderId = '';
  let proId = '';
  let riderToken = '';

  beforeEach(async () => {
    ensureSecrets();
    await prisma.proOffer.deleteMany({});
    await prisma.proProfile.deleteMany({});
    await prisma.riderProfile.deleteMany({});
    await prisma.user.deleteMany({ where: { email: { in: ['pro@test.com', 'rider@test.com'] } } });

    const proUser = await prisma.user.create({
      data: {
        email: 'pro@test.com',
        password: 'hash',
        role: 'PRO',
        emailVerified: true
      }
    });
    proId = proUser.id;
    await prisma.proProfile.create({
      data: {
        userId: proId,
        businessName: 'Surf Pro',
        lat: 48.8566,
        lng: 2.3522,
        verified: true
      }
    });

    await prisma.proOffer.create({
      data: {
        proProfileId: (await prisma.proProfile.findUnique({ where: { userId: proId } }))!.id,
        sport: 'surf',
        level: 'intermediate',
        title: 'Surf coaching',
        description: 'Session complète',
        hourlyRate: 80,
        lat: 48.8566,
        lng: 2.3522,
        isActive: true
      }
    });

    const riderUser = await prisma.user.create({
      data: {
        email: 'rider@test.com',
        password: 'hash',
        role: 'RIDER',
        emailVerified: true
      }
    });
    riderId = riderUser.id;
    riderToken = signToken(riderId, 'RIDER');
    await prisma.riderProfile.create({
      data: {
        userId: riderId,
        displayName: 'Rider One',
        lat: 48.8584,
        lng: 2.2945
      }
    });
  });

  afterAll(async () => {
    await prisma.proOffer.deleteMany({});
    await prisma.proProfile.deleteMany({});
    await prisma.riderProfile.deleteMany({});
    await prisma.user.deleteMany({ where: { email: { in: ['pro@test.com', 'rider@test.com'] } } });
  });

  it('returns PostGIS-filtered offers with distance', async () => {
    const res = await request(app)
      .get('/pro/offers/search?radiusKm=10&sport=surf&level=intermediate')
      .set('Authorization', `Bearer ${riderToken}`)
      .expect(200);

    expect(res.body.offers).toHaveLength(1);
    const offer = res.body.offers[0];
    expect(offer.pro.businessName).toBe('Surf Pro');
    expect(offer.distanceKm).toBeGreaterThan(0);
    expect(offer.distanceKm).toBeLessThan(10);
  });

  it('filters out offers outside radius', async () => {
    const res = await request(app)
      .get('/pro/offers/search?radiusKm=1&sport=surf&level=intermediate')
      .set('Authorization', `Bearer ${riderToken}`)
      .expect(200);

    expect(res.body.offers).toHaveLength(0);
  });
});
