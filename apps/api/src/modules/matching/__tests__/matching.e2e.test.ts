import { createApp } from '../../../index';
import { prisma } from '@blobinfini/database';
import { Role } from '@prisma/client';
import { getAccessToken, TestSession } from '../../../tests/helpers/auth';

describe('Matching search E2E', () => {
  const app = createApp();
  let accessToken = '';
  let session: TestSession;

  beforeAll(async () => {
    await prisma.refreshToken.deleteMany();
    await prisma.session.deleteMany();
    await prisma.passwordResetToken.deleteMany();
    await prisma.emailVerificationToken.deleteMany();
    await prisma.riderProfile.deleteMany();
    await prisma.user.deleteMany();

    const auth = await getAccessToken({
      app,
      email: 'match@test.com',
      role: Role.RIDER,
    });
    accessToken = auth.accessToken;
    session = auth.session;

    const user = await prisma.user.findFirstOrThrow({ where: { email: 'match@test.com' } });
    await prisma.riderProfile.upsert({
      where: { userId: user.id },
      create: { userId: user.id, maxDistanceKm: 35, emailNotif: true },
      update: { maxDistanceKm: 35, emailNotif: true },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('returns criteria merged with profile preferences', async () => {
    const res = await session
      .post('/matching/search')
      .set('Authorization', `Bearer ${accessToken}`)
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
    const res = await session
      .post('/matching/search')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ sport: 'kitesurf', level: 'advanced', date: '2025-09-05', partner: 'MEN' })
      .expect(200);

    expect(res.body.criteria.partnerPref).toBe('MEN');
  });
});
