import request from 'supertest';
import { createApp } from '../../../index';
import { prisma } from '@blobinfini/database';

describe('Matching search E2E', () => {
  const app = createApp();
  let access = '';

  beforeAll(async () => {
    await prisma.refreshToken.deleteMany();
    await prisma.session.deleteMany();
    await prisma.passwordResetToken.deleteMany();
    await prisma.emailVerificationToken.deleteMany();
    await prisma.riderProfile.deleteMany();
    await prisma.user.deleteMany();

    // Create user and login
    await request(app).post('/auth/register').send({ email: 'match@test.com', password: 'Passw0rd!' }).expect(201);
    const login = await request(app)
      .post('/auth/login')
      .send({ email: 'match@test.com', password: 'Passw0rd!' })
      .expect(200);
    access = login.body.accessToken as string;

    // Update profile preferences to non-default to assert they're used
    const user = await prisma.user.findFirstOrThrow({ where: { email: 'match@test.com' } });
    await prisma.riderProfile.upsert({
      where: { userId: user.id },
      create: { userId: user.id, maxDistanceKm: 35, partnerPref: 'WOMEN', emailNotif: true },
      update: { maxDistanceKm: 35, partnerPref: 'WOMEN', emailNotif: true },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('returns criteria merged with profile preferences', async () => {
    const res = await request(app)
      .post('/matching/search')
      .set('Authorization', `Bearer ${access}`)
      .send({ sport: 'surf', level: 'beginner', date: '2025-09-04' })
      .expect(200);

    expect(res.body).toHaveProperty('criteria');
    expect(res.body.criteria).toMatchObject({
      sport: 'surf',
      level: 'beginner',
      date: '2025-09-04',
      maxDistanceKm: 35,
      partnerPref: 'WOMEN',
      emailNotif: true,
    });
    expect(Array.isArray(res.body.results)).toBe(true);
  });

  it('allows overriding partner preference via request body', async () => {
    const res = await request(app)
      .post('/matching/search')
      .set('Authorization', `Bearer ${access}`)
      .send({ sport: 'kitesurf', level: 'advanced', date: '2025-09-05', partner: 'MEN' })
      .expect(200);

    expect(res.body.criteria.partnerPref).toBe('MEN');
  });
});
