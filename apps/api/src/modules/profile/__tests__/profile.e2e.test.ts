import { createApp } from '../../../index';
import { clientPrisma as prisma, Role } from '@blobinfini/database';
import { getAccessToken, TestSession } from '../../../tests/helpers/auth';

describe('Profile E2E', () => {
  const app = createApp();
  let accessToken = '';
  let session: TestSession;

  const seedProfileUser = async () => {
    await prisma.refreshToken.deleteMany();
    await prisma.session.deleteMany();
    await prisma.passwordResetToken.deleteMany();
    await prisma.emailVerificationToken.deleteMany();
    await prisma.riderProfile.deleteMany();
    await prisma.user.deleteMany();

    const auth = await getAccessToken({
      app,
      email: 'p@test.com',
      role: Role.RIDER,
    });
    accessToken = auth.accessToken;
    session = auth.session;
  };

  beforeEach(async () => {
    await seedProfileUser();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('GET /profile/me creates default profile', async () => {
    const res = await session
      .get('/profile/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(res.body).toHaveProperty('userId');
    expect(res.body).toHaveProperty('id');
  });

  it('PUT /profile/me updates simple fields', async () => {
    const res = await session
      .put('/profile/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ displayName: 'Blobmama', bio: 'Hello', maxDistanceKm: 30, emailNotif: true })
      .expect(200);
    expect(res.body.displayName).toBe('Blobmama');
    expect(res.body.maxDistanceKm).toBe(30);
  });

  it('POST /profile/photo/upload-url returns presigned URL', async () => {
    const res = await session
      .post('/profile/photo/upload-url')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ contentType: 'image/jpeg' })
      .expect(200);
    expect(res.body).toHaveProperty('uploadUrl');
    expect(res.body).toHaveProperty('key');
  });
});
