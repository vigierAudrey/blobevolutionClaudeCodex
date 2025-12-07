import { createApp } from '../../../index';
import { clientPrisma as prisma, Role } from '@blobinfini/database';
import { getAccessToken, TestSession } from '../../../tests/helpers/auth';

describe('Profile E2E', () => {
  const app = createApp();
  let accessToken = '';
  let session: TestSession;
  const testEmail = `profile-test-${Date.now()}@test.com`;

  const seedProfileUser = async () => {
    // Nettoyage ciblé: seulement les données de ce test
    const existingUser = await prisma.user.findUnique({ where: { email: testEmail } });
    if (existingUser) {
      await prisma.refreshToken.deleteMany({ where: { userId: existingUser.id } });
      await prisma.session.deleteMany({ where: { userId: existingUser.id } });
      await prisma.riderProfile.deleteMany({ where: { userId: existingUser.id } });
      await prisma.user.delete({ where: { id: existingUser.id } });
    }

    const auth = await getAccessToken({
      app,
      email: testEmail,
      role: Role.RIDER,
    });
    accessToken = auth.accessToken;
    session = auth.session;
  };

  beforeEach(async () => {
    await seedProfileUser();
  });

  afterAll(async () => {
    const existingUser = await prisma.user.findUnique({ where: { email: testEmail } });
    if (existingUser) {
      await prisma.refreshToken.deleteMany({ where: { userId: existingUser.id } });
      await prisma.session.deleteMany({ where: { userId: existingUser.id } });
      await prisma.riderProfile.deleteMany({ where: { userId: existingUser.id } });
      await prisma.user.delete({ where: { id: existingUser.id } });
    }
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
