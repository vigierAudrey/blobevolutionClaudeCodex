/**
 * Tests e2e — /admin/security/login-attempts (GET + POST /purge)
 *
 * Couvre :
 *   - Pagination cursor (createdAt DESC, id DESC, limit max 100)
 *   - suspiciousOnly (plus de full scan mémoire)
 *   - Purge batchée avec rétention différenciée (success=7j, failure=30j)
 *   - Endpoint purge (dryRun, confirm, RBAC)
 *   - Limites de sécurité (cursor invalide, limit > 100, non-admin)
 */
import request, { SuperAgentTest } from 'supertest';
import jwt from 'jsonwebtoken';
import { clientPrisma as prisma } from '@blobinfini/database';
import { createApp } from '../../../index';
import { detectEmailHashVersion } from '../../../lib/hash-email';
import { gdprPurgeService } from '../../../services/gdpr-purge.service';
import { AVAILABLE_PERMISSIONS } from '../permissions';

const app = createApp();

type Role = 'RIDER' | 'PRO' | 'ADMIN';

const emails = {
  admin: 'la-admin@test-login-attempts.com',
  rider: 'la-rider@test-login-attempts.com',
};

let adminId = '';
let riderId = '';
let adminToken = '';
let riderToken = '';

function ensureSecrets() {
  process.env.JWT_SECRET ||= 'test-jwt-secret';
  process.env.SESSION_SECRET ||= 'test-session-secret';
  process.env.PRIMARY_ADMIN_EMAILS = emails.admin;
}

function signToken(userId: string, role: Role) {
  return jwt.sign({ sub: userId, role }, process.env.JWT_SECRET!, { expiresIn: '1h' });
}

/**
 * csrfProtection is mounted before adminRouter in index.ts.
 * POST requests without a session CSRF secret return 403 CSRF_NO_SECRET.
 * Use a session agent + GET /csrf-token to obtain a valid CSRF token for every POST test.
 */
async function makeCsrfAgent(): Promise<{ agent: SuperAgentTest; csrf: string }> {
  const agent = request.agent(app);
  const res = await agent.get('/csrf-token').expect(200);
  return { agent, csrf: res.body.csrfToken as string };
}

async function seedFixtures() {
  ensureSecrets();
  await cleanupFixtures();

  const admin = await prisma.user.create({
    data: { email: emails.admin, password: 'hash', role: 'ADMIN', emailVerified: true },
  });
  adminId = admin.id;
  adminToken = signToken(admin.id, 'ADMIN');
  await prisma.adminProfile.create({
    data: { userId: admin.id, displayName: 'Test Admin', permissions: [...AVAILABLE_PERMISSIONS] },
  });

  const rider = await prisma.user.create({
    data: { email: emails.rider, password: 'hash', role: 'RIDER', emailVerified: true },
  });
  riderId = rider.id;
  riderToken = signToken(rider.id, 'RIDER');
  await prisma.riderProfile.create({ data: { userId: rider.id, displayName: 'Test Rider' } });
}

async function cleanupFixtures() {
  await prisma.loginAttempt.deleteMany({
    where: {
      emailHash: {
        in: ['test-hash-1', 'test-hash-2', 'test-hash-3', 'test-hash-suspicious', 'a'.repeat(64), 'b'.repeat(32)],
      },
    },
  });
  await prisma.session.deleteMany({ where: { user: { email: { in: Object.values(emails) } } } });
  await prisma.adminProfile.deleteMany({ where: { user: { email: emails.admin } } });
  await prisma.riderProfile.deleteMany({ where: { user: { email: emails.rider } } });
  await prisma.user.deleteMany({ where: { email: { in: Object.values(emails) } } });
}

async function seedLoginAttempts(count: number, overrides: Partial<{
  success: boolean;
  emailHash: string;
  ipHash: string;
  createdAt: Date;
}> = {}) {
  const now = new Date();
  const records = Array.from({ length: count }, (_, i) => ({
    emailHash: overrides.emailHash ?? `test-hash-${i}`,
    ipHash: overrides.ipHash ?? `ip-hash-${i}`,
    success: overrides.success ?? (i % 3 === 0),
    createdAt: overrides.createdAt ?? new Date(now.getTime() - i * 1000),
  }));

  await prisma.loginAttempt.createMany({ data: records });
  return records;
}

// ---------------------------------------------------------------------------

describe('GET /admin/security/login-attempts', () => {
  beforeEach(seedFixtures);
  afterEach(cleanupFixtures);

  it('401 — non authentifié', async () => {
    await request(app).get('/admin/security/login-attempts').expect(401);
  });

  it('403 — RIDER ne peut pas accéder', async () => {
    await request(app)
      .get('/admin/security/login-attempts')
      .set('Authorization', `Bearer ${riderToken}`)
      .expect(403);
  });

  it('200 — retourne les tentatives pour un admin', async () => {
    await prisma.loginAttempt.createMany({
      data: [
        { emailHash: 'test-hash-1', success: false, ipHash: 'ip1' },
        { emailHash: 'test-hash-2', success: true, ipHash: 'ip2' },
      ],
    });

    const res = await request(app)
      .get('/admin/security/login-attempts')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(Array.isArray(res.body.attempts)).toBe(true);
    expect(res.body.stats).toMatchObject({
      total: expect.any(Number),
      failed: expect.any(Number),
      successRate: expect.any(String),
    });
    // RGPD: email brut jamais exposé
    for (const a of res.body.attempts) {
      expect(a.email).toBeNull();
      expect(a.ip).toBeUndefined();
    }
  });

  it('200 — coexistence legacy v1 64 chars et v2 32 chars sans casser la lecture admin', async () => {
    await prisma.loginAttempt.createMany({
      data: [
        { emailHash: 'a'.repeat(64), success: false, ipHash: 'ip-legacy' },
        { emailHash: 'b'.repeat(32), success: true, ipHash: 'ip-v2' },
      ],
    });

    const res = await request(app)
      .get('/admin/security/login-attempts?limit=10')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const returnedHashes = res.body.attempts.map((attempt: { emailHash: string }) => attempt.emailHash);
    expect(returnedHashes).toContain('a'.repeat(64));
    expect(returnedHashes).toContain('b'.repeat(32));
    expect(detectEmailHashVersion('a'.repeat(64))).toBe('v1');
    expect(detectEmailHashVersion('b'.repeat(32))).toBe('v2');
  });

  it('400 — limit > 100 est refusé', async () => {
    const res = await request(app)
      .get('/admin/security/login-attempts?limit=500')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);

    expect(res.body.error).toMatch(/query parameters/i);
  });

  it('400 — cursor invalide (non base64)', async () => {
    const res = await request(app)
      .get('/admin/security/login-attempts?cursor=!!!INVALID!!!')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);

    expect(res.body.error).toMatch(/cursor/i);
  });

  it('400 — cursor avec date invalide', async () => {
    const badCursor = Buffer.from(JSON.stringify({ createdAt: 'not-a-date', id: '00000000-0000-0000-0000-000000000001' })).toString('base64url');
    const res = await request(app)
      .get(`/admin/security/login-attempts?cursor=${badCursor}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);

    expect(res.body.error).toMatch(/cursor/i);
  });

  it('400 — cursor avec id non-UUID', async () => {
    const badCursor = Buffer.from(JSON.stringify({ createdAt: new Date().toISOString(), id: 'not-a-uuid' })).toString('base64url');
    const res = await request(app)
      .get(`/admin/security/login-attempts?cursor=${badCursor}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);

    expect(res.body.error).toMatch(/cursor/i);
  });

  // --- cursor pagination ---

  it('cursor pagination — nextCursor absent si résultats < limit', async () => {
    await prisma.loginAttempt.createMany({
      data: [
        { emailHash: 'test-hash-1', success: false, ipHash: 'ip1' },
        { emailHash: 'test-hash-2', success: false, ipHash: 'ip2' },
      ],
    });

    const res = await request(app)
      .get('/admin/security/login-attempts?limit=10')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    // 2 résultats < limit=10 → pas de nextCursor
    expect(res.body.nextCursor).toBeNull();
  });

  it('cursor pagination — nextCursor présent si résultats = limit', async () => {
    // Créer exactement limit=3 tentatives
    const now = new Date();
    await prisma.loginAttempt.createMany({
      data: [
        { emailHash: 'test-hash-1', success: false, ipHash: 'ip1', createdAt: new Date(now.getTime() - 1000) },
        { emailHash: 'test-hash-2', success: false, ipHash: 'ip2', createdAt: new Date(now.getTime() - 2000) },
        { emailHash: 'test-hash-3', success: false, ipHash: 'ip3', createdAt: new Date(now.getTime() - 3000) },
      ],
    });

    const res = await request(app)
      .get('/admin/security/login-attempts?limit=3')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.attempts).toHaveLength(3);
    expect(typeof res.body.nextCursor).toBe('string');
    expect(res.body.nextCursor).not.toBeNull();
  });

  it('cursor pagination — page 2 ne contient pas les éléments de page 1', async () => {
    const now = new Date();
    // Créer 5 tentatives avec timestamps distincts
    await prisma.loginAttempt.createMany({
      data: Array.from({ length: 5 }, (_, i) => ({
        emailHash: `test-hash-${i + 1}`,
        success: false,
        ipHash: `ip-${i}`,
        createdAt: new Date(now.getTime() - i * 10000),
      })),
    });

    // Page 1
    const page1 = await request(app)
      .get('/admin/security/login-attempts?limit=3&onlyFailed=true')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(page1.body.attempts).toHaveLength(3);
    const cursor = page1.body.nextCursor;
    expect(cursor).toBeTruthy();

    const page1Ids = new Set(page1.body.attempts.map((a: any) => a.id));

    // Page 2
    const page2 = await request(app)
      .get(`/admin/security/login-attempts?limit=3&onlyFailed=true&cursor=${cursor}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    // Les IDs de page 2 ne doivent pas chevaucher page 1
    for (const attempt of page2.body.attempts) {
      expect(page1Ids.has(attempt.id)).toBe(false);
    }
    // Page 2 a les 2 restants → nextCursor null
    expect(page2.body.attempts.length).toBeLessThanOrEqual(3);
    expect(page2.body.nextCursor).toBeNull();
  });

  it('cursor pagination — ordre stable (createdAt DESC)', async () => {
    const now = new Date();
    await prisma.loginAttempt.createMany({
      data: Array.from({ length: 4 }, (_, i) => ({
        emailHash: `test-hash-${i + 1}`,
        success: false,
        ipHash: `ip-${i}`,
        createdAt: new Date(now.getTime() - i * 5000),
      })),
    });

    const res = await request(app)
      .get('/admin/security/login-attempts?limit=100&onlyFailed=true')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const dates = res.body.attempts.map((a: any) => new Date(a.createdAt).getTime());
    for (let i = 1; i < dates.length; i++) {
      expect(dates[i]).toBeLessThanOrEqual(dates[i - 1]);
    }
  });

  // --- onlyFailed ---

  it('onlyFailed=true — ne retourne que les échecs', async () => {
    await prisma.loginAttempt.createMany({
      data: [
        { emailHash: 'test-hash-1', success: false, ipHash: 'ip1' },
        { emailHash: 'test-hash-2', success: true, ipHash: 'ip2' },
        { emailHash: 'test-hash-3', success: false, ipHash: 'ip3' },
      ],
    });

    const res = await request(app)
      .get('/admin/security/login-attempts?onlyFailed=true')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    for (const a of res.body.attempts) {
      expect(a.success).toBe(false);
    }
  });

  // --- suspiciousOnly ---

  it('suspiciousOnly=true — retourne uniquement les hash suspects (GROUP BY HAVING côté SQL)', async () => {
    const now = new Date();
    // 4 échecs depuis ipHash "suspicious-ip" (seuil = 3)
    await prisma.loginAttempt.createMany({
      data: Array.from({ length: 4 }, (_, i) => ({
        emailHash: `test-hash-suspicious-email-${i}`,
        ipHash: 'test-ip-hash-suspicious',
        success: false,
        createdAt: new Date(now.getTime() - i * 1000),
      })),
    });
    // 1 seul échec depuis un autre IP (pas suspect)
    await prisma.loginAttempt.create({
      data: { emailHash: 'test-hash-1', ipHash: 'normal-ip-hash', success: false },
    });

    const res = await request(app)
      .get('/admin/security/login-attempts?suspiciousOnly=true&limit=50')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(Array.isArray(res.body.attempts)).toBe(true);
    // Tous les résultats doivent avoir l'ipHash suspect
    for (const a of res.body.attempts) {
      expect(a.ipHash).toBe('test-ip-hash-suspicious');
    }
    // Le normal-ip ne doit PAS apparaître
    const normalIpAttempt = res.body.attempts.find((a: any) => a.ipHash === 'normal-ip-hash');
    expect(normalIpAttempt).toBeUndefined();
  });

  it('suspiciousOnly=true — retourne vide si rien de suspect', async () => {
    await prisma.loginAttempt.createMany({
      data: [
        { emailHash: 'test-hash-1', ipHash: 'ip1', success: false },
        { emailHash: 'test-hash-2', ipHash: 'ip2', success: false },
      ],
    });

    const res = await request(app)
      .get('/admin/security/login-attempts?suspiciousOnly=true')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.attempts).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------

describe('POST /admin/security/login-attempts/purge', () => {
  beforeEach(seedFixtures);
  afterEach(async () => {
    await prisma.loginAttempt.deleteMany({});
    await cleanupFixtures();
    delete process.env.LOGIN_ATTEMPT_SUCCESS_RETENTION_DAYS;
    delete process.env.LOGIN_ATTEMPT_FAILURE_RETENTION_DAYS;
  });

  // CSRF note: csrfProtection fires before adminRouter.
  // All POST tests must use request.agent(app) + GET /csrf-token.
  // Tests that expect early rejection (401, 403 RBAC) still need a valid CSRF
  // secret in the session so the CSRF check passes and the auth check fires.

  it('401 — non authentifié (CSRF valide, pas de token auth)', async () => {
    const { agent, csrf } = await makeCsrfAgent();
    await agent
      .post('/admin/security/login-attempts/purge')
      .set('X-CSRF-Token', csrf)
      .send({ dryRun: true })
      .expect(401);
  });

  it('403 — RIDER ne peut pas purger', async () => {
    const { agent, csrf } = await makeCsrfAgent();
    await agent
      .post('/admin/security/login-attempts/purge')
      .set('Authorization', `Bearer ${riderToken}`)
      .set('X-CSRF-Token', csrf)
      .send({ dryRun: true })
      .expect(403);
  });

  it('400 — dryRun=false sans confirm refuse', async () => {
    const { agent, csrf } = await makeCsrfAgent();
    const res = await agent
      .post('/admin/security/login-attempts/purge')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-CSRF-Token', csrf)
      .send({ dryRun: false })
      .expect(400);

    expect(res.body.error).toMatch(/CONFIRM/i);
  });

  it('400 — dryRun=false avec confirm="YES" refuse', async () => {
    const { agent, csrf } = await makeCsrfAgent();
    const res = await agent
      .post('/admin/security/login-attempts/purge')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-CSRF-Token', csrf)
      .send({ dryRun: false, confirm: 'YES' })
      .expect(400);

    expect(res.body.error).toMatch(/CONFIRM/i);
  });

  it('400 — dryRun=false avec confirm="confirm" (minuscule) refuse', async () => {
    const { agent, csrf } = await makeCsrfAgent();
    const res = await agent
      .post('/admin/security/login-attempts/purge')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-CSRF-Token', csrf)
      .send({ dryRun: false, confirm: 'confirm' })
      .expect(400);

    expect(res.body.error).toMatch(/CONFIRM/i);
  });

  it('200 dryRun=true (défaut via corps vide) — ne supprime rien', async () => {
    await prisma.loginAttempt.createMany({
      data: [
        { emailHash: 'test-hash-1', success: false, ipHash: 'ip1' },
        { emailHash: 'test-hash-2', success: true, ipHash: 'ip2' },
      ],
    });

    const before = await prisma.loginAttempt.count();
    const { agent, csrf } = await makeCsrfAgent();
    const res = await agent
      .post('/admin/security/login-attempts/purge')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-CSRF-Token', csrf)
      .send({})  // dryRun defaults to true via Zod
      .expect(200);

    expect(res.body.dryRun).toBe(true);
    expect(res.body.deleted).toBe(0);

    const after = await prisma.loginAttempt.count();
    expect(after).toBe(before);
  });

  it('200 dryRun=true — wouldDelete reflète les lignes expirées (pas récentes)', async () => {
    process.env.LOGIN_ATTEMPT_SUCCESS_RETENTION_DAYS = '7';
    process.env.LOGIN_ATTEMPT_FAILURE_RETENTION_DAYS = '30';

    const oldSuccess = new Date(Date.now() - 8 * 86400_000);
    const oldFailure = new Date(Date.now() - 31 * 86400_000);
    const recent = new Date(Date.now() - 1000);

    await prisma.loginAttempt.createMany({
      data: [
        { emailHash: 'test-hash-1', success: true, ipHash: 'ip1', createdAt: oldSuccess },
        { emailHash: 'test-hash-2', success: false, ipHash: 'ip2', createdAt: oldFailure },
        { emailHash: 'test-hash-3', success: false, ipHash: 'ip3', createdAt: recent },
      ],
    });

    const { agent, csrf } = await makeCsrfAgent();
    const res = await agent
      .post('/admin/security/login-attempts/purge')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-CSRF-Token', csrf)
      .send({ dryRun: true })
      .expect(200);

    expect(res.body.wouldDelete).toBe(2);
    expect(res.body.deleted).toBe(0);
    expect(res.body.dryRun).toBe(true);
  });

  it('200 dryRun=false + confirm=CONFIRM — supprime réellement les expirés', async () => {
    process.env.LOGIN_ATTEMPT_SUCCESS_RETENTION_DAYS = '7';
    process.env.LOGIN_ATTEMPT_FAILURE_RETENTION_DAYS = '30';

    const oldSuccess = new Date(Date.now() - 8 * 86400_000);
    const recentFailure = new Date(Date.now() - 1000);

    await prisma.loginAttempt.createMany({
      data: [
        { emailHash: 'test-hash-1', success: true, ipHash: 'ip1', createdAt: oldSuccess },
        { emailHash: 'test-hash-2', success: false, ipHash: 'ip2', createdAt: recentFailure },
      ],
    });

    const { agent, csrf } = await makeCsrfAgent();
    const res = await agent
      .post('/admin/security/login-attempts/purge')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-CSRF-Token', csrf)
      .send({ dryRun: false, confirm: 'CONFIRM' })
      .expect(200);

    expect(res.body.dryRun).toBe(false);
    expect(res.body.deleted).toBe(1);

    const remaining = await prisma.loginAttempt.findMany({ where: { emailHash: 'test-hash-2' } });
    expect(remaining).toHaveLength(1);

    const purged = await prisma.loginAttempt.findMany({ where: { emailHash: 'test-hash-1' } });
    expect(purged).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------

describe('purgeOldLoginAttemptsBatched (unit-style)', () => {
  beforeEach(seedFixtures);
  afterEach(async () => {
    await prisma.loginAttempt.deleteMany({});
    await cleanupFixtures();
    delete process.env.LOGIN_ATTEMPT_SUCCESS_RETENTION_DAYS;
    delete process.env.LOGIN_ATTEMPT_FAILURE_RETENTION_DAYS;
  });

  it('ne supprime pas les tentatives récentes', async () => {
    process.env.LOGIN_ATTEMPT_SUCCESS_RETENTION_DAYS = '7';
    process.env.LOGIN_ATTEMPT_FAILURE_RETENTION_DAYS = '30';

    await prisma.loginAttempt.createMany({
      data: [
        { emailHash: 'test-hash-1', success: false, ipHash: 'ip1', createdAt: new Date(Date.now() - 1000) },
        { emailHash: 'test-hash-2', success: true, ipHash: 'ip2', createdAt: new Date(Date.now() - 1000) },
      ],
    });

    const result = await gdprPurgeService.purgeOldLoginAttemptsBatched({ dryRun: false });
    expect(result.deleted).toBe(0);

    const remaining = await prisma.loginAttempt.count();
    expect(remaining).toBe(2);
  });

  it('rétention différenciée — success=7j supprimé avant failure=30j', async () => {
    process.env.LOGIN_ATTEMPT_SUCCESS_RETENTION_DAYS = '7';
    process.env.LOGIN_ATTEMPT_FAILURE_RETENTION_DAYS = '30';

    // Succès de 8 jours → doit être supprimé
    const oldSuccess = new Date(Date.now() - 8 * 86400_000);
    // Échec de 15 jours → NE doit PAS être supprimé (< 30j)
    const recentFailure = new Date(Date.now() - 15 * 86400_000);

    await prisma.loginAttempt.createMany({
      data: [
        { emailHash: 'test-hash-1', success: true, ipHash: 'ip1', createdAt: oldSuccess },
        { emailHash: 'test-hash-2', success: false, ipHash: 'ip2', createdAt: recentFailure },
      ],
    });

    const result = await gdprPurgeService.purgeOldLoginAttemptsBatched({ dryRun: false });
    expect(result.deleted).toBe(1);

    const remaining = await prisma.loginAttempt.findMany();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].success).toBe(false);
  });

  it('dryRun=true — wouldDelete correct sans supprimer', async () => {
    process.env.LOGIN_ATTEMPT_SUCCESS_RETENTION_DAYS = '7';
    process.env.LOGIN_ATTEMPT_FAILURE_RETENTION_DAYS = '30';

    const oldSuccess = new Date(Date.now() - 8 * 86400_000);
    const oldFailure = new Date(Date.now() - 31 * 86400_000);

    await prisma.loginAttempt.createMany({
      data: [
        { emailHash: 'test-hash-1', success: true, ipHash: 'ip1', createdAt: oldSuccess },
        { emailHash: 'test-hash-2', success: false, ipHash: 'ip2', createdAt: oldFailure },
        { emailHash: 'test-hash-3', success: false, ipHash: 'ip3', createdAt: new Date() },
      ],
    });

    const result = await gdprPurgeService.purgeOldLoginAttemptsBatched({ dryRun: true });
    expect(result.dryRun).toBe(true);
    expect(result.deleted).toBe(0);
    expect(result.wouldDelete).toBe(2);

    // Rien n'a été supprimé
    const count = await prisma.loginAttempt.count();
    expect(count).toBe(3);
  });

  it('batches — purge par lots (simule table volumineuse)', async () => {
    process.env.LOGIN_ATTEMPT_SUCCESS_RETENTION_DAYS = '1';
    process.env.LOGIN_ATTEMPT_FAILURE_RETENTION_DAYS = '1';

    const threshold = new Date(Date.now() - 2 * 86400_000);
    // Insérer 10 lignes expirées
    await prisma.loginAttempt.createMany({
      data: Array.from({ length: 10 }, (_, i) => ({
        emailHash: `test-hash-${i}`,
        success: false,
        ipHash: `ip-${i}`,
        createdAt: new Date(threshold.getTime() - i * 1000),
      })),
    });

    const result = await gdprPurgeService.purgeOldLoginAttemptsBatched({ dryRun: false });
    expect(result.deleted).toBe(10);
    expect(result.batches).toBeGreaterThanOrEqual(1);

    const remaining = await prisma.loginAttempt.count();
    expect(remaining).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// LOT 3 — requestId + auditMetadata enrichment
// ---------------------------------------------------------------------------

describe('requestId — x-request-id header (LOT 3)', () => {
  beforeEach(seedFixtures);
  afterEach(cleanupFixtures);

  const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  it('GET /login-attempts — x-request-id réponse est un UUID v4 valide', async () => {
    const res = await request(app)
      .get('/admin/security/login-attempts')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.headers['x-request-id']).toBeDefined();
    expect(res.headers['x-request-id']).toMatch(UUID_V4_REGEX);
  });

  it('x-request-id entrant valide est renvoyé tel quel', async () => {
    const clientId = '550e8400-e29b-41d4-a716-446655440000';
    const res = await request(app)
      .get('/admin/security/login-attempts')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-request-id', clientId)
      .expect(200);

    expect(res.headers['x-request-id']).toBe(clientId);
  });

  it('x-request-id entrant invalide (non UUID v4) → généré côté serveur', async () => {
    const res = await request(app)
      .get('/admin/security/login-attempts')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-request-id', 'NOT-A-UUID')
      .expect(200);

    expect(res.headers['x-request-id']).not.toBe('NOT-A-UUID');
    expect(res.headers['x-request-id']).toMatch(UUID_V4_REGEX);
  });

  it('x-request-id entrant UUID valide mais non-v4 → remplacé par un UUID v4 serveur', async () => {
    const nonV4ClientId = '550e8400-e29b-11d4-a716-446655440000';
    const res = await request(app)
      .get('/admin/security/login-attempts')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-request-id', nonV4ClientId)
      .expect(200);

    expect(res.headers['x-request-id']).not.toBe(nonV4ClientId);
    expect(res.headers['x-request-id']).toMatch(UUID_V4_REGEX);
  });
});

describe('AuditLog purge — metadata enrichie (LOT 3)', () => {
  beforeEach(seedFixtures);
  afterEach(async () => {
    await prisma.loginAttempt.deleteMany({});
    await cleanupFixtures();
    delete process.env.LOGIN_ATTEMPT_SUCCESS_RETENTION_DAYS;
    delete process.env.LOGIN_ATTEMPT_FAILURE_RETENTION_DAYS;
  });

  it('POST /purge dryRun=true — AuditLog contient dryRun, deleted, wouldDelete, batches, requestId', async () => {
    const { agent, csrf } = await makeCsrfAgent();
    const res = await agent
      .post('/admin/security/login-attempts/purge')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-CSRF-Token', csrf)
      .send({ dryRun: true })
      .expect(200);

    const requestId = res.headers['x-request-id'];
    expect(requestId).toBeDefined();

    // AuditLog is written async (res.on('finish')).
    // Poll until it appears (max 2s) to avoid a fixed sleep.
    let auditLog: any = null;
    const deadline = Date.now() + 2000;
    while (!auditLog && Date.now() < deadline) {
      auditLog = await prisma.auditLog.findFirst({
        where: { action: 'admin:security:login-attempts:purge', userId: adminId },
        orderBy: { createdAt: 'desc' },
      });
      if (!auditLog) await new Promise((r) => setTimeout(r, 100));
    }

    expect(auditLog).not.toBeNull();
    expect(auditLog.metadata).toMatchObject({
      dryRun: true,
      deleted: 0,
      wouldDelete: expect.any(Number),
      batches: expect.any(Number),
      requestId: requestId,
    });
  });
});
