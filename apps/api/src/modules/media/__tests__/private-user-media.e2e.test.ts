import request from 'supertest';
import { createApp } from '../../../index';
import { clientPrisma as prisma, Role } from '@blobinfini/database';
import { getAccessToken, type TestSession } from '../../../tests/helpers/auth';
import { __setTestGetObjectBufferMock } from '../../../lib/s3';

const WEBP_MAGIC = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);
const TEXT_BYTES = Buffer.from('not an image');
const TEST_UUID = '00000000-0000-0000-0000-000000000123';

function storagePhotoUrl(userId: string, extension = 'webp') {
  return `http://test.local/test-bucket/users/${userId}/${TEST_UUID}.${extension}`;
}

describe('Private user media route', () => {
  const app = createApp();
  const emails = {
    rider1: `media-rider1-${Date.now()}@test.com`,
    rider2: `media-rider2-${Date.now()}@test.com`,
    pro: `media-pro-${Date.now()}@test.com`,
  };
  let rider1: { session: TestSession; accessToken: string; userId: string };
  let rider2: { session: TestSession; accessToken: string; userId: string };
  let pro: { session: TestSession; accessToken: string; userId: string };

  beforeEach(async () => {
    rider1 = await getAccessToken({ app, email: emails.rider1, role: Role.RIDER });
    rider2 = await getAccessToken({ app, email: emails.rider2, role: Role.RIDER });
    pro = await getAccessToken({ app, email: emails.pro, role: Role.PRO });

    __setTestGetObjectBufferMock(WEBP_MAGIC);
    await prisma.riderProfile.upsert({
      where: { userId: rider1.userId },
      create: { userId: rider1.userId, photoUrl: storagePhotoUrl(rider1.userId) },
      update: { photoUrl: storagePhotoUrl(rider1.userId) },
    });
  });

  afterEach(() => {
    __setTestGetObjectBufferMock(null);
  });

  it('rider connecté voit sa propre photo privée', async () => {
    const res = await rider1.session
      .get(`/media/users/${rider1.userId}/photo`)
      .set('Authorization', `Bearer ${rider1.accessToken}`)
      .expect(200);

    expect(res.headers['content-type']).toMatch(/^image\/webp/);
    expect(res.headers['cache-control']).toBe('private, max-age=300');
    expect(res.headers['cross-origin-resource-policy']).toBe('same-site');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.body).toEqual(WEBP_MAGIC);
  });

  it('anonyme ne voit pas users/*', async () => {
    await request(app)
      .get(`/media/users/${rider1.userId}/photo`)
      .expect(401);
  });

  it('autre rider voit la photo (contrat matching : photo visible entre riders)', async () => {
    const res = await rider2.session
      .get(`/media/users/${rider1.userId}/photo`)
      .set('Authorization', `Bearer ${rider2.accessToken}`)
      .expect(200);

    expect(res.headers['content-type']).toMatch(/^image\/webp/);
    expect(res.headers['cache-control']).toBe('private, max-age=300');
    expect(res.body).toEqual(WEBP_MAGIC);
  });

  it('pro non autorisé ne voit pas users/*', async () => {
    await pro.session
      .get(`/media/users/${rider1.userId}/photo`)
      .set('Authorization', `Bearer ${pro.accessToken}`)
      .expect(403);
  });

  it('refuse le path traversal et les identifiants invalides', async () => {
    await rider1.session
      .get('/media/users/%2e%2e%2fpros%2ffake/photo')
      .set('Authorization', `Bearer ${rider1.accessToken}`)
      .expect(404);
  });

  it('refuse une clé DB qui ne pointe pas vers users/{owner}/photo image autorisée', async () => {
    await prisma.riderProfile.update({
      where: { userId: rider1.userId },
      data: { photoUrl: `http://test.local/test-bucket/pros/${rider1.userId}/${TEST_UUID}.webp` },
    });

    await rider1.session
      .get(`/media/users/${rider1.userId}/photo`)
      .set('Authorization', `Bearer ${rider1.accessToken}`)
      .expect(404);
  });

  it('refuse un objet non image même si la photo existe en DB', async () => {
    __setTestGetObjectBufferMock(TEXT_BYTES);

    await rider1.session
      .get(`/media/users/${rider1.userId}/photo`)
      .set('Authorization', `Bearer ${rider1.accessToken}`)
      .expect(404);
  });

  it('userId inexistant → réponse neutre sans révéler existence (404, comme un rider sans photo)', async () => {
    const nonExistentId = '00000000-0000-0000-0000-000000000999';
    const res = await rider1.session
      .get(`/media/users/${nonExistentId}/photo`)
      .set('Authorization', `Bearer ${rider1.accessToken}`)
      .expect(404);
    expect(res.body).toEqual({ error: 'Not found' });
  });

  it('la réponse 403 (pro) ne contient pas de chemin MinIO ni de clé de stockage', async () => {
    const res = await pro.session
      .get(`/media/users/${rider1.userId}/photo`)
      .set('Authorization', `Bearer ${pro.accessToken}`)
      .expect(403);

    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/users\//);
    expect(body).not.toMatch(/photoUrl/i);
    expect(body).not.toMatch(/minio/i);
    expect(body).not.toMatch(/bucket/i);
  });

  it('la réponse 403 (pro) est cache private et non stockée', async () => {
    const res = await pro.session
      .get(`/media/users/${rider1.userId}/photo`)
      .set('Authorization', `Bearer ${pro.accessToken}`)
      .expect(403);

    const cc = res.headers['cache-control'] ?? '';
    expect(cc).not.toMatch(/public/i);
  });
});
