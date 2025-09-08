import request from 'supertest';
import { createApp } from '../../../index';
import { prisma } from '@blobinfini/database';

describe('Profile E2E', () => {
  const app = createApp();
  let access = '';

  beforeAll(async () => {
    await prisma.refreshToken.deleteMany();
    await prisma.session.deleteMany();
    await prisma.passwordResetToken.deleteMany();
    await prisma.emailVerificationToken.deleteMany();
    await prisma.riderProfile.deleteMany();
    await prisma.user.deleteMany();

    // Register and login to get tokens
    await request(app)
      .post('/auth/register')
      .send({ email: 'p@test.com', password: 'Passw0rd!', consentAccepted: true })
      .expect(201);
    const login = await request(app).post('/auth/login').send({ email: 'p@test.com', password: 'Passw0rd!' }).expect(200);
    access = login.body.accessToken as string;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('GET /profile/me creates default profile', async () => {
    const res = await request(app).get('/profile/me').set('Authorization', `Bearer ${access}`).expect(200);
    expect(res.body).toHaveProperty('userId');
    expect(res.body).toHaveProperty('id');
  });

  it('PUT /profile/me updates simple fields', async () => {
    const res = await request(app)
      .put('/profile/me')
      .set('Authorization', `Bearer ${access}`)
      .send({ displayName: 'Blobmama', bio: 'Hello', partnerPref: 'ALL', maxDistanceKm: 30, emailNotif: true })
      .expect(200);
    expect(res.body.displayName).toBe('Blobmama');
    expect(res.body.maxDistanceKm).toBe(30);
  });

  it('POST /profile/photo/upload-url returns presigned URL', async () => {
    const res = await request(app)
      .post('/profile/photo/upload-url')
      .set('Authorization', `Bearer ${access}`)
      .send({ contentType: 'image/jpeg' })
      .expect(200);
    expect(res.body).toHaveProperty('uploadUrl');
    expect(res.body).toHaveProperty('key');
  });
});
