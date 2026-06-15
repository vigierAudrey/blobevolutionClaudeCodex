import request from 'supertest';
import jwt from 'jsonwebtoken';
import { clientPrisma as prisma } from '@blobinfini/database';
import { createApp } from '../../../index';

type Role = 'RIDER' | 'PRO' | 'ADMIN';

const app = createApp();

function ensureSecrets() {
  process.env.JWT_SECRET ||= 'test-jwt-secret';
  process.env.SESSION_SECRET ||= 'test-session-secret';
}

function signToken(userId: string, role: Role) {
  return jwt.sign({ sub: userId, role }, process.env.JWT_SECRET!, { expiresIn: '1h' });
}

async function createUser(suffix: string, role: Role, permissions: string[] = []) {
  ensureSecrets();
  const email = `blocked-rl-${suffix}-${Date.now()}@test.com`;
  const user = await prisma.user.create({
    data: { email, password: 'hash', role, emailVerified: true },
  });

  if (role === 'ADMIN') {
    await prisma.adminProfile.create({
      data: { userId: user.id, displayName: 'BlockedReadRateLimitTest', permissions },
    });
  }

  return { userId: user.id, token: signToken(user.id, role), email };
}

async function deleteUser(userId: string) {
  await prisma.auditLog.deleteMany({ where: { userId } });
  await prisma.adminProfile.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { id: userId } });
}

describe('GET /admin/conversations/blocked — rate-limit et RBAC', () => {
  beforeAll(() => {
    process.env.ENABLE_RATE_LIMIT_IN_TESTS = 'true';
  });

  afterAll(() => {
    delete process.env.ENABLE_RATE_LIMIT_IN_TESTS;
  });

  it('autorise un admin reports.view', async () => {
    const admin = await createUser('admin-ok', 'ADMIN', ['reports.view']);
    try {
      const res = await request(app)
        .get('/admin/conversations/blocked?limit=5')
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(200);

      expect(Array.isArray(res.body.blocked)).toBe(true);
      expect(res.body.pagination).toMatchObject({ limit: 5 });
    } finally {
      await deleteUser(admin.userId);
    }
  });

  it('refuse rider, pro et anonyme', async () => {
    const rider = await createUser('rider-denied', 'RIDER');
    const pro = await createUser('pro-denied', 'PRO');
    try {
      await request(app)
        .get('/admin/conversations/blocked?limit=5')
        .set('Authorization', `Bearer ${rider.token}`)
        .expect(403);

      await request(app)
        .get('/admin/conversations/blocked?limit=5')
        .set('Authorization', `Bearer ${pro.token}`)
        .expect(403);

      await request(app)
        .get('/admin/conversations/blocked?limit=5')
        .expect(401);
    } finally {
      await deleteUser(rider.userId);
      await deleteUser(pro.userId);
    }
  });

  it('ne déclenche pas le limiter MESSAGING à 10/minute', async () => {
    const admin = await createUser('admin-messaging-bypass', 'ADMIN', ['reports.view']);
    try {
      for (let i = 0; i < 11; i++) {
        const res = await request(app)
          .get('/admin/conversations/blocked?limit=5')
          .set('Authorization', `Bearer ${admin.token}`);

        expect(res.status).toBe(200);
        expect(JSON.stringify(res.body)).not.toContain('Too many messages');
        expect(String(res.headers['ratelimit-policy'] ?? '')).not.toContain('10;w=60');
      }
    } finally {
      await deleteUser(admin.userId);
    }
  });
});
