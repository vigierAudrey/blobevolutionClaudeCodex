/**
 * Tests RBAC — Endpoints /admin/security/* (LOT 3)
 *
 * Couvre :
 *   - security.read : accès GET login-attempts, events, logs/summary
 *   - security.read : INTERDIT POST /purge → 403
 *   - security.write : accès POST /purge
 *   - system.configure : backward compat (GET + POST)
 *   - system.monitor : backward compat GET /logs/summary
 *   - requireAnyPermission() sans argument → 403 (safe-default)
 *   - Non-admin → 403
 *
 * Chaque test utilise un admin distinct avec des permissions précises.
 * PRIMARY_ADMIN_EMAILS n'est PAS setté → aucun admin n'est SUPER_ADMIN par email.
 * Les permissions viennent exclusivement de adminProfile.permissions.
 */
import express from 'express';
import request, { SuperAgentTest } from 'supertest';
import jwt from 'jsonwebtoken';
import { clientPrisma as prisma } from '@blobinfini/database';
import { createApp } from '../../../index';
import { requireAnyPermission } from '../admin.guard';
import type { Permission } from '../permissions';

const app = createApp();

type Role = 'RIDER' | 'ADMIN';

// Emails uniques pour éviter les collisions avec d'autres suites
const EMAIL_BASE = 'rbac-test';
const emails = {
  securityRead:    `${EMAIL_BASE}-security-read@test-rbac.com`,
  securityWrite:   `${EMAIL_BASE}-security-write@test-rbac.com`,
  sysConfigure:    `${EMAIL_BASE}-sys-configure@test-rbac.com`,
  sysMonitor:      `${EMAIL_BASE}-sys-monitor@test-rbac.com`,
  noPerms:         `${EMAIL_BASE}-no-perms@test-rbac.com`,
  rider:           `${EMAIL_BASE}-rider@test-rbac.com`,
};

function ensureSecrets() {
  process.env.JWT_SECRET ||= 'test-jwt-secret';
  process.env.SESSION_SECRET ||= 'test-session-secret';
}

function signToken(userId: string, role: Role) {
  return jwt.sign({ sub: userId, role }, process.env.JWT_SECRET!, { expiresIn: '1h' });
}

async function createAdminWithPermissions(email: string, permissions: Permission[]): Promise<string> {
  const user = await prisma.user.create({
    data: { email, password: 'hash', role: 'ADMIN', emailVerified: true },
  });
  await prisma.adminProfile.create({
    data: { userId: user.id, displayName: `Test ${email}`, permissions },
  });
  return signToken(user.id, 'ADMIN');
}

async function makeCsrfAgent(): Promise<{ agent: SuperAgentTest; csrf: string }> {
  const agent = request.agent(app);
  const res = await agent.get('/csrf-token').expect(200);
  return { agent, csrf: res.body.csrfToken as string };
}

async function cleanupRbacFixtures() {
  const emailList = Object.values(emails);
  await prisma.adminProfile.deleteMany({ where: { user: { email: { in: emailList } } } });
  await prisma.riderProfile.deleteMany({ where: { user: { email: { in: emailList } } } });
  await prisma.user.deleteMany({ where: { email: { in: emailList } } });
}

let tokenSecurityRead: string;
let tokenSecurityWrite: string;
let tokenSysConfigure: string;
let tokenSysMonitor: string;
let tokenNoPerms: string;
let tokenRider: string;
let previousPrimaryAdminEmails: string | undefined;

beforeEach(async () => {
  ensureSecrets();
  // PRIMARY_ADMIN_EMAILS must NOT include any of our test emails
  // (otherwise they'd get SUPER_ADMIN, bypassing the test)
  previousPrimaryAdminEmails = process.env.PRIMARY_ADMIN_EMAILS;
  process.env.PRIMARY_ADMIN_EMAILS = 'unrelated@production.com';

  await cleanupRbacFixtures();

  tokenSecurityRead  = await createAdminWithPermissions(emails.securityRead,  ['security.read']);
  tokenSecurityWrite = await createAdminWithPermissions(emails.securityWrite, ['security.write']);
  tokenSysConfigure  = await createAdminWithPermissions(emails.sysConfigure,  ['system.configure']);
  tokenSysMonitor    = await createAdminWithPermissions(emails.sysMonitor,    ['system.monitor']);
  tokenNoPerms       = await createAdminWithPermissions(emails.noPerms,       []);

  const rider = await prisma.user.create({
    data: { email: emails.rider, password: 'hash', role: 'RIDER', emailVerified: true },
  });
  await prisma.riderProfile.create({ data: { userId: rider.id, displayName: 'Test Rider' } });
  tokenRider = signToken(rider.id, 'RIDER');
});

afterEach(async () => {
  process.env.PRIMARY_ADMIN_EMAILS = previousPrimaryAdminEmails ?? '';
  await cleanupRbacFixtures();
});

// ─── GET /admin/security/login-attempts ─────────────────────────────────────

describe('GET /admin/security/login-attempts', () => {
  it('security.read → 200', async () => {
    await request(app)
      .get('/admin/security/login-attempts')
      .set('Authorization', `Bearer ${tokenSecurityRead}`)
      .expect(200);
  });

  it('system.configure → 200 (backward compat)', async () => {
    await request(app)
      .get('/admin/security/login-attempts')
      .set('Authorization', `Bearer ${tokenSysConfigure}`)
      .expect(200);
  });

  it('system.monitor → 403 (lecture sécurité, pas de monitor sur cet endpoint)', async () => {
    await request(app)
      .get('/admin/security/login-attempts')
      .set('Authorization', `Bearer ${tokenSysMonitor}`)
      .expect(403);
  });

  it('security.write seul → 403 (write ne donne pas la lecture)', async () => {
    await request(app)
      .get('/admin/security/login-attempts')
      .set('Authorization', `Bearer ${tokenSecurityWrite}`)
      .expect(403);
  });

  it('non-admin (RIDER) → 403', async () => {
    await request(app)
      .get('/admin/security/login-attempts')
      .set('Authorization', `Bearer ${tokenRider}`)
      .expect(403);
  });

  it('aucune permission → 403', async () => {
    await request(app)
      .get('/admin/security/login-attempts')
      .set('Authorization', `Bearer ${tokenNoPerms}`)
      .expect(403);
  });
});

// ─── GET /admin/security/events ─────────────────────────────────────────────

describe('GET /admin/security/events', () => {
  it('security.read → 200', async () => {
    await request(app)
      .get('/admin/security/events')
      .set('Authorization', `Bearer ${tokenSecurityRead}`)
      .expect(200);
  });

  it('system.configure → 200 (backward compat)', async () => {
    await request(app)
      .get('/admin/security/events')
      .set('Authorization', `Bearer ${tokenSysConfigure}`)
      .expect(200);
  });

  it('security.write seul → 403', async () => {
    await request(app)
      .get('/admin/security/events')
      .set('Authorization', `Bearer ${tokenSecurityWrite}`)
      .expect(403);
  });
});

// ─── GET /admin/security/logs/summary ───────────────────────────────────────

describe('GET /admin/security/logs/summary', () => {
  it('security.read → 200', async () => {
    await request(app)
      .get('/admin/security/logs/summary')
      .set('Authorization', `Bearer ${tokenSecurityRead}`)
      .expect(200);
  });

  it('system.monitor → 200 (backward compat)', async () => {
    await request(app)
      .get('/admin/security/logs/summary')
      .set('Authorization', `Bearer ${tokenSysMonitor}`)
      .expect(200);
  });

  it('system.configure → 403 (system.configure ne couvre pas /logs/summary)', async () => {
    // /logs/summary uses requireAnyPermission('security.read', 'system.monitor')
    // system.configure is not in that list — correct behaviour
    await request(app)
      .get('/admin/security/logs/summary')
      .set('Authorization', `Bearer ${tokenSysConfigure}`)
      .expect(403);
  });
});

// ─── POST /admin/security/login-attempts/purge ──────────────────────────────

describe('POST /admin/security/login-attempts/purge', () => {
  it('security.write → 200 (dryRun=true par défaut)', async () => {
    const { agent, csrf } = await makeCsrfAgent();
    await agent
      .post('/admin/security/login-attempts/purge')
      .set('Authorization', `Bearer ${tokenSecurityWrite}`)
      .set('X-CSRF-Token', csrf)
      .send({ dryRun: true })
      .expect(200);
  });

  it('system.configure → 200 (backward compat)', async () => {
    const { agent, csrf } = await makeCsrfAgent();
    await agent
      .post('/admin/security/login-attempts/purge')
      .set('Authorization', `Bearer ${tokenSysConfigure}`)
      .set('X-CSRF-Token', csrf)
      .send({ dryRun: true })
      .expect(200);
  });

  it('security.read → 403 (lecture ne peut pas purger)', async () => {
    const { agent, csrf } = await makeCsrfAgent();
    await agent
      .post('/admin/security/login-attempts/purge')
      .set('Authorization', `Bearer ${tokenSecurityRead}`)
      .set('X-CSRF-Token', csrf)
      .send({ dryRun: true })
      .expect(403);
  });

  it('system.monitor → 403 (monitor ne peut pas purger)', async () => {
    const { agent, csrf } = await makeCsrfAgent();
    await agent
      .post('/admin/security/login-attempts/purge')
      .set('Authorization', `Bearer ${tokenSysMonitor}`)
      .set('X-CSRF-Token', csrf)
      .send({ dryRun: true })
      .expect(403);
  });

  it('non-admin → 403', async () => {
    const { agent, csrf } = await makeCsrfAgent();
    await agent
      .post('/admin/security/login-attempts/purge')
      .set('Authorization', `Bearer ${tokenRider}`)
      .set('X-CSRF-Token', csrf)
      .send({ dryRun: true })
      .expect(403);
  });
});

// ─── requireAnyPermission safe-default ──────────────────────────────────────

describe('requireAnyPermission — safe-default', () => {
  it('admin avec permissions mais requireAnyPermission() vide → 403', async () => {
    const directApp = express();
    directApp.get(
      '/deny-empty',
      (req, _res, next) => {
        (req as any).user = { id: 'admin-test', role: 'ADMIN' };
        next();
      },
      requireAnyPermission(),
      (_req, res) => res.status(204).end(),
    );

    await request(directApp)
      .get('/deny-empty')
      .expect(403);
  });
});
