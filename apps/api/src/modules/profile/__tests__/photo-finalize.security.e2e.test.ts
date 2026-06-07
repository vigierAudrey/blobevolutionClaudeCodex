import { createApp } from '../../../index';
import { clientPrisma as prisma, Role } from '@blobinfini/database';
import { getAccessToken, TestSession } from '../../../tests/helpers/auth';
import { __setTestGetObjectMock } from '../../../lib/s3';
import { __resetUploadTokenStore } from '../../../lib/upload-token';

const JPEG_MAGIC = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01]);
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D]);
const WEBP_MAGIC = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);
const PHP_BYTES  = Buffer.from('<?php system($_GET["cmd"]); ?>');
const SVG_BYTES  = Buffer.from('<svg onload="alert(1)">');
const VALID_IMAGE_CASES: Array<[string, Buffer]> = [
  ['image/png', PNG_MAGIC],
  ['image/webp', WEBP_MAGIC],
];

describe('Photo Finalize Security (RIDER)', () => {
  const app = createApp();
  let token1: string;
  let session1: TestSession;
  let token2: string;
  let session2: TestSession;
  let userId1: string;
  let userId2: string;
  const email1 = `finalize-rider1-${Date.now()}@test.com`;
  const email2 = `finalize-rider2-${Date.now()}@test.com`;

  beforeEach(async () => {
    __resetUploadTokenStore();
    __setTestGetObjectMock(null);

    const auth1 = await getAccessToken({ app, email: email1, role: Role.RIDER });
    token1 = auth1.accessToken;
    session1 = auth1.session;
    const user1 = await prisma.user.findUnique({ where: { email: email1 } });
    userId1 = user1!.id;

    const auth2 = await getAccessToken({ app, email: email2, role: Role.RIDER });
    token2 = auth2.accessToken;
    session2 = auth2.session;
    const user2 = await prisma.user.findUnique({ where: { email: email2 } });
    userId2 = user2!.id;

    await prisma.riderProfile.deleteMany({ where: { userId: { in: [userId1, userId2] } } });
  });

  afterAll(async () => {
    for (const email of [email1, email2]) {
      const u = await prisma.user.findUnique({ where: { email } });
      if (u) {
        await prisma.riderProfile.deleteMany({ where: { userId: u.id } });
        await prisma.refreshToken.deleteMany({ where: { userId: u.id } });
        await prisma.session.deleteMany({ where: { userId: u.id } });
        await prisma.user.delete({ where: { id: u.id } });
      }
    }
    await prisma.$disconnect();
  });

  // Helper : obtenir une clé via le flow presign
  async function presignKey(s: TestSession, t: string, contentType = 'image/jpeg'): Promise<string> {
    const res = await s
      .post('/profile/photo/upload-url')
      .set('Authorization', `Bearer ${t}`)
      .send({ contentType })
      .expect(200);
    expect(res.body).toHaveProperty('key');
    // Bloquant 2 : fileUrl ne doit plus être retourné par le presign
    expect(res.body).not.toHaveProperty('fileUrl');
    return res.body.key as string;
  }

  it('happy path — image JPEG valide → finalize sauvegarde, PUT profil sans photoUrl préserve, GET renvoie avatar', async () => {
    __setTestGetObjectMock(JPEG_MAGIC);
    const key = await presignKey(session1, token1);

    const res = await session1
      .post('/profile/photo/finalize')
      .set('Authorization', `Bearer ${token1}`)
      .send({ key })
      .expect(200);

    // API ne retourne plus le chemin MinIO interne — retourne le proxy endpoint
    expect(res.body.hasPhoto).toBe(true);
    expect(res.body.photoEndpoint).toBe(`/media/users/${userId1}/photo`);
    expect(res.body).not.toHaveProperty('photoUrl');

    // DB conserve le chemin MinIO interne (détail serveur)
    const profile = await prisma.riderProfile.findUnique({ where: { userId: userId1 } });
    expect(profile?.photoUrl).not.toBeNull();

    const updateRes = await session1
      .put('/profile/me')
      .set('Authorization', `Bearer ${token1}`)
      .send({ displayName: 'BlobTest', bio: 'test', sex: 'MALE', emailNotif: false })
      .expect(200);
    expect(updateRes.body.hasPhoto).toBe(true);
    expect(updateRes.body.photoEndpoint).toBe(res.body.photoEndpoint);

    const getRes = await session1
      .get('/profile/me')
      .set('Authorization', `Bearer ${token1}`)
      .expect(200);
    expect(getRes.body.hasPhoto).toBe(true);
    expect(getRes.body.photoEndpoint).toBe(res.body.photoEndpoint);
  });

  it.each(VALID_IMAGE_CASES)('compat image — %s valide → finalize accepte et sauvegarde', async (contentType, magicBytes) => {
    __setTestGetObjectMock(magicBytes);
    const key = await presignKey(session1, token1, contentType);

    const res = await session1
      .post('/profile/photo/finalize')
      .set('Authorization', `Bearer ${token1}`)
      .send({ key })
      .expect(200);

    expect(res.body.hasPhoto).toBe(true);
    expect(res.body).not.toHaveProperty('photoUrl');
    const profile = await prisma.riderProfile.findUnique({ where: { userId: userId1 } });
    expect(profile?.photoUrl).not.toBeNull();
  });

  it('photoUrl null via PUT /me → supprime la photo sans accepter de string', async () => {
    __setTestGetObjectMock(JPEG_MAGIC);
    const key = await presignKey(session1, token1);

    await session1
      .post('/profile/photo/finalize')
      .set('Authorization', `Bearer ${token1}`)
      .send({ key })
      .expect(200);

    const res = await session1
      .put('/profile/me')
      .set('Authorization', `Bearer ${token1}`)
      .send({ photoUrl: null })
      .expect(200);

    expect(res.body.hasPhoto).toBe(false);
    expect(res.body.photoEndpoint).toBeNull();
    const profile = await prisma.riderProfile.findUnique({ where: { userId: userId1 } });
    expect(profile?.photoUrl).toBeNull();
  });

  it('P0 — rejette payload PHP déclaré image/jpeg → 422', async () => {
    __setTestGetObjectMock(PHP_BYTES);
    const key = await presignKey(session1, token1);

    await session1
      .post('/profile/photo/finalize')
      .set('Authorization', `Bearer ${token1}`)
      .send({ key })
      .expect(422);
  });

  it('P0 — rejette SVG déclaré image/jpeg → 422', async () => {
    __setTestGetObjectMock(SVG_BYTES);
    const key = await presignKey(session1, token1);

    await session1
      .post('/profile/photo/finalize')
      .set('Authorization', `Bearer ${token1}`)
      .send({ key })
      .expect(422);
  });

  it('P1 — double finalize sur même clé → second retourne 409', async () => {
    __setTestGetObjectMock(JPEG_MAGIC);
    const key = await presignKey(session1, token1);

    await session1
      .post('/profile/photo/finalize')
      .set('Authorization', `Bearer ${token1}`)
      .send({ key })
      .expect(200);

    await session1
      .post('/profile/photo/finalize')
      .set('Authorization', `Bearer ${token1}`)
      .send({ key })
      .expect(409);
  });

  it('P1 — user2 tente de finaliser la clé de user1 → 403 (prefix mismatch)', async () => {
    __setTestGetObjectMock(JPEG_MAGIC);
    const key = await presignKey(session1, token1); // clé = users/{userId1}/...

    // user2 envoie la clé de user1
    await session2
      .post('/profile/photo/finalize')
      .set('Authorization', `Bearer ${token2}`)
      .send({ key })
      .expect(403);

    // La photoUrl de user1 ne doit pas avoir été modifiée
    // (profil peut ne pas encore exister si aucun finalize réussi sur user1)
    const profile = await prisma.riderProfile.findUnique({ where: { userId: userId1 } });
    expect(profile?.photoUrl ?? null).toBeNull();
  });

  it('clé avec format invalide → 400', async () => {
    const invalidKeys = [
      '../../etc/passwd',
      'users/not-a-uuid/file.jpeg',
      `users/${userId1}/file.php`,     // extension non autorisée
      `users/${userId1}/file.svg`,     // extension non autorisée
      '',
    ];
    for (const key of invalidKeys) {
      const res = await session1
        .post('/profile/photo/finalize')
        .set('Authorization', `Bearer ${token1}`)
        .send({ key });
      expect(res.status).toBe(400);
    }
  });

  it('clé inconnue / expirée → 410 ou 503 selon Redis', async () => {
    const fakeKey = `users/${userId1}/00000000-0000-0000-0000-000000000000.jpeg`;
    const res = await session1
      .post('/profile/photo/finalize')
      .set('Authorization', `Bearer ${token1}`)
      .send({ key: fakeKey });
    // 410 si Redis opérationnel (clé non trouvée), 503 si Redis absent (fail-secure)
    expect([410, 503]).toContain(res.status);
  });

  const forbiddenPhotoUrlCases: Array<[string, () => string]> = [
    ['valid-looking MinIO localhost', () => `http://localhost:9002/blobinfini-dev/users/${userId1}/00000000-0000-0000-0000-000000000000.jpeg`],
    ['valid-looking prod storage', () => `https://storage.blobsurf.com/blobinfini-dev/users/${userId1}/00000000-0000-0000-0000-000000000000.jpeg`],
    ['external attacker URL', () => 'https://attacker.com/evil.jpg'],
    ['javascript URL', () => 'javascript:alert(1)'],
    ['data URL', () => 'data:image/png;base64,iVBORw0KGgo='],
    ['oversized URL payload', () => `https://storage.blobsurf.com/blobinfini-dev/users/${userId1}/${'a'.repeat(2048)}.jpeg`],
  ];

  it.each(forbiddenPhotoUrlCases)('photoUrl string via PUT /me → 400 strict: %s', async (_label, buildUrl) => {
    const candidate = buildUrl();
    const res = await session1
      .put('/profile/me')
      .set('Authorization', `Bearer ${token1}`)
      .send({ photoUrl: candidate });

    // z.null().optional() n'accepte que null | undefined — toute string reste un 400 déterministe.
    expect(res.status).toBe(400);

    const profile = await prisma.riderProfile.findUnique({ where: { userId: userId1 } });
    expect(profile?.photoUrl).not.toBe(candidate);
  });

  it('concurrence — deux finalize parallèles, au plus un seul gagne', async () => {
    __setTestGetObjectMock(JPEG_MAGIC);
    const key = await presignKey(session1, token1);

    const [r1, r2] = await Promise.all([
      session1.post('/profile/photo/finalize')
        .set('Authorization', `Bearer ${token1}`)
        .send({ key }),
      session1.post('/profile/photo/finalize')
        .set('Authorization', `Bearer ${token1}`)
        .send({ key }),
    ]);

    const statuses = [r1.status, r2.status];
    const successes = statuses.filter(s => s === 200).length;

    // En test sans Redis : les deux sont 503 (fail-secure) — aucun ne gagne
    // Avec Redis : exactement un 200, un 409
    expect(successes).toBeLessThanOrEqual(1);
    // Aucun des deux ne doit avoir retourné 500 (erreur non gérée)
    expect(statuses.every(s => s !== 500)).toBe(true);
  });
});
