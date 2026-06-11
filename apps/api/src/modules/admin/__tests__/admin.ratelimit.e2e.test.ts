/**
 * Tests e2e — rate limits ciblés sur actions admin sensibles
 *
 * Vérifie que :
 * - POST /admin/gdpr/run-purge          : max 3/heure → 4e requête bloquée (429)
 * - POST /admin/alerts                  : max 10/heure → 11e requête bloquée (429)
 * - POST /admin/conversations/broadcast : max 3/heure → 4e requête bloquée (429)
 * - Les protections existantes (requirePermissions, requireAdminStepUp) ne sont pas altérées
 *
 * Chaque test utilise un userId distinct pour isoler les compteurs mémoire
 * (clé = `admin_gdpr_purge:${userId}` / `admin_alert_create:${userId}` / `admin_broadcast:${userId}`).
 *
 * ENABLE_RATE_LIMIT_IN_TESTS=true active les limiteurs en NODE_ENV=test.
 */

import request, { SuperAgentTest } from 'supertest';
import jwt from 'jsonwebtoken';
import { clientPrisma as prisma } from '@blobinfini/database';
import { createApp } from '../../../index';

type Role = 'ADMIN';

const app = createApp();

function ensureSecrets() {
  process.env.JWT_SECRET ||= 'test-jwt-secret';
  process.env.SESSION_SECRET ||= 'test-session-secret';
}

function signToken(userId: string, role: Role) {
  return jwt.sign({ sub: userId, role }, process.env.JWT_SECRET!, { expiresIn: '1h' });
}

async function getCsrf(agent: SuperAgentTest) {
  const res = await agent.get('/csrf-token').expect(200);
  return res.body.csrfToken as string;
}

// Crée un admin minimal sans permission system.configure
// → les requêtes passent le rate limiter mais échouent sur requirePermissions (403)
// → assure que le compteur s'incrémente sans nécessiter step-up ni payload valide
async function createTestAdmin(suffix: string) {
  ensureSecrets();
  const email = `ratelimit-${suffix}-${Date.now()}@test.com`;
  const user = await prisma.user.create({
    data: { email, password: 'hash', role: 'ADMIN', emailVerified: true },
  });
  await prisma.adminProfile.create({
    data: { userId: user.id, displayName: 'RateLimitTest', permissions: [] },
  });
  return { userId: user.id, token: signToken(user.id, 'ADMIN'), email };
}

async function deleteTestAdmin(userId: string) {
  await prisma.adminProfile.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } });
}

describe('Admin — rate limits ciblés', () => {
  beforeAll(() => {
    // Active les rate limiters en NODE_ENV=test pour cette suite uniquement
    process.env.ENABLE_RATE_LIMIT_IN_TESTS = 'true';
  });

  afterAll(() => {
    delete process.env.ENABLE_RATE_LIMIT_IN_TESTS;
  });

  // ─── POST /admin/gdpr/run-purge — max 3/heure ────────────────────────────

  describe('POST /admin/gdpr/run-purge', () => {
    it('3 requêtes sous le seuil → aucune 429 (403 car pas de permission)', async () => {
      const admin = await createTestAdmin('purge-under');
      const agent = request.agent(app);
      const csrf = await getCsrf(agent);

      for (let i = 0; i < 3; i++) {
        const res = await agent
          .post('/admin/gdpr/run-purge')
          .set('Authorization', `Bearer ${admin.token}`)
          .set('X-CSRF-Token', csrf)
          .send({ confirm: 'CONFIRMER_PURGE_RGPD' });
        // Le rate limiter laisse passer, requirePermissions rejette — jamais 429
        expect(res.status).not.toBe(429);
        expect(res.status).toBe(403);
      }

      await deleteTestAdmin(admin.userId);
    });

    it('4e requête → 429 ADMIN_GDPR_PURGE_RATE_LIMIT_EXCEEDED', async () => {
      const admin = await createTestAdmin('purge-over');
      const agent = request.agent(app);
      const csrf = await getCsrf(agent);

      // 3 requêtes : passent le limiter (retournent 403 — pas de permission)
      for (let i = 0; i < 3; i++) {
        const res = await agent
          .post('/admin/gdpr/run-purge')
          .set('Authorization', `Bearer ${admin.token}`)
          .set('X-CSRF-Token', csrf)
          .send({ confirm: 'CONFIRMER_PURGE_RGPD' });
        expect(res.status).not.toBe(429);
      }

      // 4e requête : bloquée par le rate limiter
      const blocked = await agent
        .post('/admin/gdpr/run-purge')
        .set('Authorization', `Bearer ${admin.token}`)
        .set('X-CSRF-Token', csrf)
        .send({ confirm: 'CONFIRMER_PURGE_RGPD' });

      expect(blocked.status).toBe(429);
      expect(blocked.body.error).toBe('ADMIN_GDPR_PURGE_RATE_LIMIT_EXCEEDED');
      expect(typeof blocked.body.retryAfter).toBe('number');

      await deleteTestAdmin(admin.userId);
    });

    it('non-admin → 401 même sous le seuil (protection auth non dégradée)', async () => {
      const agent = request.agent(app);
      const csrf = await getCsrf(agent);

      const res = await agent
        .post('/admin/gdpr/run-purge')
        .set('Authorization', 'Bearer invalid-token')
        .set('X-CSRF-Token', csrf)
        .send({ confirm: 'CONFIRMER_PURGE_RGPD' });

      // L'auth guard rejette avant même d'atteindre le rate limiter
      expect(res.status).toBe(401);
    });
  });

  // ─── POST /admin/alerts — max 10/heure ───────────────────────────────────

  describe('POST /admin/alerts', () => {
    it('10 requêtes sous le seuil → aucune 429 (403 car pas de permission)', async () => {
      const admin = await createTestAdmin('alert-under');
      const agent = request.agent(app);
      const csrf = await getCsrf(agent);

      for (let i = 0; i < 10; i++) {
        const res = await agent
          .post('/admin/alerts')
          .set('Authorization', `Bearer ${admin.token}`)
          .set('X-CSRF-Token', csrf)
          .send({ type: 'RATE_LIMIT_TEST', message: `test ${i}`, severity: 'INFO' });
        expect(res.status).not.toBe(429);
        expect(res.status).toBe(403);
      }

      await deleteTestAdmin(admin.userId);
    });

    it('11e requête → 429 ADMIN_ALERT_CREATE_RATE_LIMIT_EXCEEDED', async () => {
      const admin = await createTestAdmin('alert-over');
      const agent = request.agent(app);
      const csrf = await getCsrf(agent);

      // 10 requêtes : passent le limiter (retournent 403 — pas de permission)
      for (let i = 0; i < 10; i++) {
        const res = await agent
          .post('/admin/alerts')
          .set('Authorization', `Bearer ${admin.token}`)
          .set('X-CSRF-Token', csrf)
          .send({ type: 'RATE_LIMIT_TEST', message: `test ${i}`, severity: 'INFO' });
        expect(res.status).not.toBe(429);
      }

      // 11e requête : bloquée par le rate limiter
      const blocked = await agent
        .post('/admin/alerts')
        .set('Authorization', `Bearer ${admin.token}`)
        .set('X-CSRF-Token', csrf)
        .send({ type: 'RATE_LIMIT_TEST', message: 'over limit', severity: 'INFO' });

      expect(blocked.status).toBe(429);
      expect(blocked.body.error).toBe('ADMIN_ALERT_CREATE_RATE_LIMIT_EXCEEDED');
      expect(typeof blocked.body.retryAfter).toBe('number');

      await deleteTestAdmin(admin.userId);
    });
  });

  // ─── POST /admin/conversations/broadcast — max 3/heure ───────────────────
  //
  // Contrainte : le smartRateLimit global MESSAGING (10/min/IP) compte aussi les
  // requêtes sur ce path. Le total de requêtes broadcast de cette suite doit
  // rester ≤ 10 pour ne tester QUE adminBroadcastLimiter — d'où la fusion du
  // scénario d'isolation par adminId dans le test over-quota.

  describe('POST /admin/conversations/broadcast', () => {
    it('3 requêtes sous le seuil → aucune 429 (403 car pas de permission)', async () => {
      const admin = await createTestAdmin('broadcast-under');
      const agent = request.agent(app);
      const csrf = await getCsrf(agent);

      for (let i = 0; i < 3; i++) {
        const res = await agent
          .post('/admin/conversations/broadcast')
          .set('Authorization', `Bearer ${admin.token}`)
          .set('X-CSRF-Token', csrf)
          .send({ message: 'diffusion test', target: 'ALL' });
        // Le rate limiter laisse passer, requirePermissions rejette — jamais 429
        expect(res.status).not.toBe(429);
        expect(res.status).toBe(403);
      }

      await deleteTestAdmin(admin.userId);
    });

    it('4e requête → 429 neutre, compteur isolé par adminId (pas par IP)', async () => {
      const admin = await createTestAdmin('broadcast-over');
      const adminOther = await createTestAdmin('broadcast-other');
      const agent = request.agent(app);
      const csrf = await getCsrf(agent);

      // 3 requêtes : passent le limiter (retournent 403 — pas de permission)
      for (let i = 0; i < 3; i++) {
        const res = await agent
          .post('/admin/conversations/broadcast')
          .set('Authorization', `Bearer ${admin.token}`)
          .set('X-CSRF-Token', csrf)
          .send({ message: 'diffusion test', target: 'ALL' });
        expect(res.status).not.toBe(429);
      }

      // 4e requête : bloquée par le rate limiter
      const blocked = await agent
        .post('/admin/conversations/broadcast')
        .set('Authorization', `Bearer ${admin.token}`)
        .set('X-CSRF-Token', csrf)
        .send({ message: 'diffusion test', target: 'ALL' });

      expect(blocked.status).toBe(429);
      expect(blocked.body.error).toBe('ADMIN_BROADCAST_RATE_LIMIT_EXCEEDED');
      expect(typeof blocked.body.retryAfter).toBe('number');
      // Message public neutre : aucun détail interne (stack, requête, identifiants)
      const publicBody = JSON.stringify(blocked.body);
      expect(publicBody).not.toContain(admin.userId);
      expect(publicBody).not.toContain(admin.email);
      expect(blocked.body).not.toHaveProperty('stack');

      // Un autre admin (même IP de test) reste sous quota — clé userId, pas IP
      const other = await agent
        .post('/admin/conversations/broadcast')
        .set('Authorization', `Bearer ${adminOther.token}`)
        .set('X-CSRF-Token', csrf)
        .send({ message: 'diffusion test', target: 'ALL' });
      expect(other.status).not.toBe(429);
      expect(other.status).toBe(403);

      await deleteTestAdmin(admin.userId);
      await deleteTestAdmin(adminOther.userId);
    });

    it('non-admin → 401 même sous le seuil (protection auth non dégradée)', async () => {
      const agent = request.agent(app);
      const csrf = await getCsrf(agent);

      const res = await agent
        .post('/admin/conversations/broadcast')
        .set('Authorization', 'Bearer invalid-token')
        .set('X-CSRF-Token', csrf)
        .send({ message: 'diffusion test', target: 'ALL' });

      expect(res.status).toBe(401);
    });
  });
});
