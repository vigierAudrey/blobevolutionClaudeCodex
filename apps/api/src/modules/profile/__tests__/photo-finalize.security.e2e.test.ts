import { createApp } from '../../../index';
import { clientPrisma as prisma, Role } from '@blobinfini/database';
import { getAccessToken, TestSession } from '../../../tests/helpers/auth';
import { __setTestGetObjectMock } from '../../../lib/s3';
import { __resetUploadTokenStore } from '../../../lib/upload-token';

const JPEG_MAGIC = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01]);
const PHP_BYTES  = Buffer.from('<?php system($_GET["cmd"]); ?>');
const SVG_BYTES  = Buffer.from('<svg onload="alert(1)">');

describe('Photo Finalize Security (RIDER)', () => {
  const app = createApp();
  let token1: string;
  let session1: TestSession;
  let token2: string;
  let session2: TestSession;
  let userId1: string;
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
  async function presignKey(s: TestSession, t: string): Promise<string> {
    const res = await s
      .post('/profile/photo/upload-url')
      .set('Authorization', `Bearer ${t}`)
      .send({ contentType: 'image/jpeg' })
      .expect(200);
    expect(res.body).toHaveProperty('key');
    // Bloquant 2 : fileUrl ne doit plus être retourné par le presign
    expect(res.body).not.toHaveProperty('fileUrl');
    return res.body.key as string;
  }

  it('happy path — image JPEG valide → photoUrl mis à jour en DB', async () => {
    __setTestGetObjectMock(JPEG_MAGIC);
    const key = await presignKey(session1, token1);

    const res = await session1
      .post('/profile/photo/finalize')
      .set('Authorization', `Bearer ${token1}`)
      .send({ key })
      .expect(200);

    expect(res.body).toHaveProperty('photoUrl');
    expect(typeof res.body.photoUrl).toBe('string');

    // Vérifier que la DB a bien été mise à jour
    const profile = await prisma.riderProfile.findUnique({ where: { userId: userId1 } });
    expect(profile?.photoUrl).toBe(res.body.photoUrl);
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

  it('photoUrl externe via PUT /me → 400 strict (z.null().optional() rejette toute string)', async () => {
    const res = await session1
      .put('/profile/me')
      .set('Authorization', `Bearer ${token1}`)
      .send({ photoUrl: 'https://attacker.com/evil.jpg' });

    // z.null().optional() n'accepte que null | undefined — string → ZodError → 400 déterministe
    expect(res.status).toBe(400);

    // Vérifier que la DB n'a pas été modifiée
    const profile = await prisma.riderProfile.findUnique({ where: { userId: userId1 } });
    expect(profile?.photoUrl).not.toBe('https://attacker.com/evil.jpg');
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
