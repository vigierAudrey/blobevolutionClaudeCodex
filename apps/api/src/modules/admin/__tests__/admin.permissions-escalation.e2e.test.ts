/**
 * Tests e2e — F01 (escalade de privilèges) + F02 (audit before/after)
 *
 * Vérifie que :
 * - Un admin ne peut pas accorder des permissions qu'il ne possède pas (F01)
 * - Un admin ne peut pas appliquer un rôle contenant des permissions hors de son scope (F01)
 * - SUPER_ADMIN peut tout accorder (F01 — pas de régression)
 * - Chaque PATCH permissions laisse un diff before/after exploitable dans l'AuditLog (F02)
 */

import request, { SuperAgentTest } from 'supertest';
import jwt from 'jsonwebtoken';
import { clientPrisma as prisma } from '@blobinfini/database';
import { createApp } from '../../../index';
import { AVAILABLE_PERMISSIONS, ROLE_PERMISSIONS } from '../permissions';

type Role = 'RIDER' | 'PRO' | 'ADMIN';

const app = createApp();

const emails = {
  superAdmin: 'escalation-super@test.com',
  moderator: 'escalation-mod@test.com',
  target: 'escalation-target@test.com',
};

let superAdminId = '';
let moderatorId = '';
let targetAdminId = '';
let superAdminToken = '';
let moderatorToken = '';

function ensureSecrets() {
  process.env.JWT_SECRET ||= 'test-jwt-secret';
  process.env.SESSION_SECRET ||= 'test-session-secret';
  // superAdmin est PRIMARY_ADMIN → reçoit SUPER_ADMIN permissions via sync
  process.env.PRIMARY_ADMIN_EMAILS = emails.superAdmin;
}

function signToken(userId: string, role: Role) {
  return jwt.sign({ sub: userId, role }, process.env.JWT_SECRET!, { expiresIn: '1h' });
}

async function getCsrf(agent: SuperAgentTest) {
  const res = await agent.get('/csrf-token').expect(200);
  return res.body.csrfToken as string;
}

// Permissions que MODERATOR ne possède PAS
const MODERATOR_PERMS = new Set(ROLE_PERMISSIONS.MODERATOR);
const PERMS_OUTSIDE_MODERATOR = AVAILABLE_PERMISSIONS.filter((p) => !MODERATOR_PERMS.has(p));
// ex: ['permissions.manage', 'system.configure', 'users.delete', 'pros.manage']

async function cleanupFixtures() {
  await prisma.adminProfile.deleteMany({
    where: { user: { email: { in: Object.values(emails) } } },
  });
  await prisma.user.deleteMany({
    where: { email: { in: Object.values(emails) } },
  });
}

async function waitForAuditEntry(action: string, resource: string, timeoutMs = 1500) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const log = await prisma.auditLog.findFirst({
      where: { action, resource },
      orderBy: { createdAt: 'desc' },
    });
    if (log) return log;
    await new Promise((r) => setTimeout(r, 30));
  }
  return null;
}

describe('Admin — F01 escalade + F02 audit', () => {
  beforeEach(async () => {
    ensureSecrets();
    await cleanupFixtures();

    const superAdmin = await prisma.user.create({
      data: { email: emails.superAdmin, password: 'hash', role: 'ADMIN', emailVerified: true },
    });
    superAdminId = superAdmin.id;
    await prisma.adminProfile.create({
      data: {
        userId: superAdmin.id,
        displayName: 'Super',
        permissions: [...AVAILABLE_PERMISSIONS],
      },
    });
    superAdminToken = signToken(superAdmin.id, 'ADMIN');

    const moderator = await prisma.user.create({
      data: { email: emails.moderator, password: 'hash', role: 'ADMIN', emailVerified: true },
    });
    moderatorId = moderator.id;
    await prisma.adminProfile.create({
      data: {
        userId: moderator.id,
        displayName: 'Mod',
        permissions: [...ROLE_PERMISSIONS.MODERATOR, 'permissions.manage'],
      },
    });
    moderatorToken = signToken(moderator.id, 'ADMIN');

    const target = await prisma.user.create({
      data: { email: emails.target, password: 'hash', role: 'ADMIN', emailVerified: true },
    });
    targetAdminId = target.id;
    await prisma.adminProfile.create({
      data: { userId: target.id, displayName: 'Target', permissions: [] },
    });
  });

  afterAll(async () => {
    await cleanupFixtures();
  });

  // ─── F01 : MODERATOR ne peut pas accorder hors de son scope ────────────────

  it('F01 — MODERATOR → grant system.configure → 403 + forbidden listé', async () => {
    const agent = request.agent(app);
    const csrf = await getCsrf(agent);

    const res = await agent
      .patch(`/admin/admins/${targetAdminId}/permissions`)
      .set('Authorization', `Bearer ${moderatorToken}`)
      .set('X-CSRF-Token', csrf)
      .send({ permissions: ['system.configure'] })
      .expect(403);

    expect(res.body.error).toMatch(/ne pouvez pas accorder/);
    expect(res.body.forbidden).toContain('system.configure');
  });

  it('F01 — MODERATOR → grant permissions qu\'il possède → 200', async () => {
    const agent = request.agent(app);
    const csrf = await getCsrf(agent);

    const safePerms = ['users.view', 'reports.view'];

    const res = await agent
      .patch(`/admin/admins/${targetAdminId}/permissions`)
      .set('Authorization', `Bearer ${moderatorToken}`)
      .set('X-CSRF-Token', csrf)
      .send({ permissions: safePerms })
      .expect(200);

    expect(res.body.permissions).toEqual(expect.arrayContaining(safePerms));
  });

  it('F01 — MODERATOR → apply SUPER_ADMIN role → 403 + forbidden listé', async () => {
    const agent = request.agent(app);
    const csrf = await getCsrf(agent);

    const res = await agent
      .patch(`/admin/admins/${targetAdminId}/role`)
      .set('Authorization', `Bearer ${moderatorToken}`)
      .set('X-CSRF-Token', csrf)
      .send({ role: 'SUPER_ADMIN' })
      .expect(403);

    expect(res.body.error).toMatch(/SUPER_ADMIN/);
    expect(Array.isArray(res.body.forbidden)).toBe(true);
    expect(res.body.forbidden.length).toBeGreaterThan(0);
    // system.configure doit faire partie des forbidden
    expect(res.body.forbidden).toContain('system.configure');
  });

  it('F01 — MODERATOR → apply ANALYTICS role (subset compatible) → 200', async () => {
    // ANALYTICS = ['users.view', 'analytics.view'] — les deux sont dans MODERATOR
    const agent = request.agent(app);
    const csrf = await getCsrf(agent);

    const res = await agent
      .patch(`/admin/admins/${targetAdminId}/role`)
      .set('Authorization', `Bearer ${moderatorToken}`)
      .set('X-CSRF-Token', csrf)
      .send({ role: 'ANALYTICS' })
      .expect(200);

    expect(res.body.permissions).toEqual(
      expect.arrayContaining(ROLE_PERMISSIONS.ANALYTICS),
    );
  });

  it('F01 — SUPER_ADMIN → grant system.configure → 200', async () => {
    const agent = request.agent(app);
    const csrf = await getCsrf(agent);

    const res = await agent
      .patch(`/admin/admins/${targetAdminId}/permissions`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .set('X-CSRF-Token', csrf)
      .send({ permissions: ['system.configure', 'users.delete'] })
      .expect(200);

    expect(res.body.permissions).toContain('system.configure');
  });

  it('F01 — sans permissions.manage → 403 (guard existant non cassé)', async () => {
    // Token d'un admin sans permissions.manage
    const noManageToken = jwt.sign(
      { sub: targetAdminId, role: 'ADMIN' },
      process.env.JWT_SECRET!,
      { expiresIn: '1h' },
    );
    const agent = request.agent(app);
    const csrf = await getCsrf(agent);

    await agent
      .patch(`/admin/admins/${superAdminId}/permissions`)
      .set('Authorization', `Bearer ${noManageToken}`)
      .set('X-CSRF-Token', csrf)
      .send({ permissions: ['users.view'] })
      .expect(403);
  });

  // ─── F02 : diff before/after dans AuditLog ─────────────────────────────────

  it('F02 — PATCH permissions écrit before/after/added/removed dans AuditLog', async () => {
    await prisma.auditLog.deleteMany({ where: { action: 'admin:permissions:update' } });

    const agent = request.agent(app);
    const csrf = await getCsrf(agent);

    await agent
      .patch(`/admin/admins/${targetAdminId}/permissions`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .set('X-CSRF-Token', csrf)
      .send({ permissions: ['users.view', 'analytics.view'] })
      .expect(200);

    const log = await waitForAuditEntry('admin:permissions:update', `admin:${targetAdminId}`);
    expect(log).toBeTruthy();
    expect(log?.metadata).toMatchObject({
      before: expect.any(Array),
      after: expect.arrayContaining(['users.view', 'analytics.view']),
      added: expect.arrayContaining(['users.view', 'analytics.view']),
      removed: expect.any(Array),
    });
  });

  it('F02 — PATCH permissions : cas "premier grant" — before = [] correctement géré', async () => {
    await prisma.auditLog.deleteMany({ where: { action: 'admin:permissions:update' } });
    // targetAdminId a permissions: [] en DB
    const agent = request.agent(app);
    const csrf = await getCsrf(agent);

    await agent
      .patch(`/admin/admins/${targetAdminId}/permissions`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .set('X-CSRF-Token', csrf)
      .send({ permissions: ['users.view'] })
      .expect(200);

    const log = await waitForAuditEntry('admin:permissions:update', `admin:${targetAdminId}`);
    expect(log?.metadata).toMatchObject({
      before: [],
      after: ['users.view'],
      added: ['users.view'],
      removed: [],
    });
  });

  it('F02 — PATCH role écrit before/after/appliedRole dans AuditLog', async () => {
    await prisma.auditLog.deleteMany({ where: { action: 'admin:role:apply' } });

    const agent = request.agent(app);
    const csrf = await getCsrf(agent);

    await agent
      .patch(`/admin/admins/${targetAdminId}/role`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .set('X-CSRF-Token', csrf)
      .send({ role: 'ANALYTICS' })
      .expect(200);

    const log = await waitForAuditEntry('admin:role:apply', `admin:${targetAdminId}`);
    expect(log).toBeTruthy();
    expect(log?.metadata).toMatchObject({
      before: expect.any(Array),
      after: expect.arrayContaining(ROLE_PERMISSIONS.ANALYTICS),
      added: expect.any(Array),
      removed: expect.any(Array),
      appliedRole: 'ANALYTICS',
    });
  });

  // ─── Combiné F01+F02 : la tentative d'escalade est auditée (403) mais sans diff ───
  // Le middleware audit() logue tous les non-5xx. Un 403 escalade est donc tracé,
  // mais sans before/after/added/removed (on retourne avant de les calculer).

  it('F01+F02 — tentative d\'escalade → 403 loggué sans before/after (diff non calculé)', async () => {
    await prisma.auditLog.deleteMany({ where: { action: 'admin:permissions:update', resource: `admin:${targetAdminId}` } });

    const agent = request.agent(app);
    const csrf = await getCsrf(agent);

    await agent
      .patch(`/admin/admins/${targetAdminId}/permissions`)
      .set('Authorization', `Bearer ${moderatorToken}`)
      .set('X-CSRF-Token', csrf)
      .send({ permissions: ['system.configure'] })
      .expect(403);

    const log = await waitForAuditEntry('admin:permissions:update', `admin:${targetAdminId}`);
    // L'entrée existe (403 est loggué par le middleware)
    expect(log).toBeTruthy();
    // Mais elle ne contient pas de diff — on a retourné avant de calculer before/after
    expect((log?.metadata as Record<string, unknown>)?.before).toBeUndefined();
    expect((log?.metadata as Record<string, unknown>)?.after).toBeUndefined();
    // Le statusCode 403 est tracé — exploitable post-incident
    expect(log?.metadata).toMatchObject({ statusCode: 403 });
  });
});
