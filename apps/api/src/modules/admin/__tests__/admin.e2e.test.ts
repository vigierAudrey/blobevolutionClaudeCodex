import request, { SuperAgentTest } from 'supertest';
import jwt from 'jsonwebtoken';
import { clientPrisma as prisma } from '@blobinfini/database';
import { createApp } from '../../../index';
import { gdprPurgeService } from '../../../services/gdpr-purge.service';
import { AVAILABLE_PERMISSIONS } from '../permissions';

type Role = 'RIDER' | 'PRO' | 'ADMIN';

const app = createApp();

const emails = {
  admin: 'admin-primary@test.com',
  adminTwo: 'admin-secondary@test.com',
  rider: 'admin-rider@test.com',
  target: 'admin-target@test.com',
  pro: 'admin-pro@test.com'
};

let adminId = '';
let adminTwoId = '';
let adminTwoToken = '';
let riderId = '';
let targetId = '';
let targetProfileId = '';
let proId = '';
let adminToken = '';
let riderToken = '';
let proToken = '';
let reportId = '';

function ensureSecrets() {
  process.env.JWT_SECRET ||= 'test-jwt-secret';
  process.env.SESSION_SECRET ||= 'test-session-secret';
  process.env.PRIMARY_ADMIN_EMAILS = emails.admin;
}

function signToken(userId: string, role: Role) {
  return jwt.sign({ sub: userId, role }, process.env.JWT_SECRET!, { expiresIn: '1h' });
}

async function getCsrf(agent: SuperAgentTest) {
  const res = await agent.get('/csrf-token').expect(200);
  return res.body.csrfToken as string;
}

async function cleanupFixtureData() {
  await prisma.retentionExportArtifact.deleteMany({
    where: {
      createdByAdmin: { email: { in: [emails.admin, emails.adminTwo] } }
    }
  });
  await prisma.conversationBlockEvent.deleteMany({
    where: {
      OR: [
        { user: { email: { in: [emails.rider, emails.target, emails.pro] } } },
        { actorUser: { email: { in: [emails.admin, emails.adminTwo] } } }
      ]
    }
  });
  await prisma.message.deleteMany({
    where: {
      conversation: {
        members: {
          some: {
            user: {
              email: { in: [emails.admin, emails.adminTwo, emails.rider, emails.target, emails.pro] }
            }
          }
        }
      }
    }
  });
  await prisma.conversationMember.deleteMany({
    where: {
      user: {
        email: { in: [emails.admin, emails.adminTwo, emails.rider, emails.target, emails.pro] }
      }
    }
  });
  await prisma.conversation.deleteMany({
    where: {
      members: {
        none: {}
      }
    }
  });
  await prisma.profileReport.deleteMany({
    where: {
      OR: [
        { reporter: { email: emails.rider } },
        { reportedProfile: { user: { email: emails.target } } }
      ]
    }
  });
  await prisma.session.deleteMany({ where: { user: { email: { in: [emails.rider, emails.admin, emails.adminTwo] } } } });
  await prisma.adminProfile.deleteMany({ where: { user: { email: { in: [emails.admin, emails.adminTwo] } } } });
  await prisma.proProfile.deleteMany({ where: { user: { email: emails.pro } } });
  await prisma.riderProfile.deleteMany({ where: { user: { email: { in: [emails.rider, emails.target] } } } });
  await prisma.user.deleteMany({ where: { email: { in: Object.values(emails) } } });
}

async function waitForAuditEntry(action: string, resource: string, timeoutMs = 1000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const log = await prisma.auditLog.findFirst({
      where: { action, resource },
      orderBy: { createdAt: 'desc' }
    });
    if (log) {
      return log;
    }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  return null;
}

describe('Admin Controller', () => {
  const seedAdminFixture = async () => {
    ensureSecrets();
    await cleanupFixtureData();

    const admin = await prisma.user.create({
      data: {
        email: emails.admin,
        password: 'hash',
        role: 'ADMIN',
        emailVerified: true
      }
    });
    adminId = admin.id;
    await prisma.adminProfile.create({
      data: {
        userId: admin.id,
        displayName: 'Root Admin',
        permissions: [...AVAILABLE_PERMISSIONS]
      }
    });

    const adminTwo = await prisma.user.create({
      data: {
        email: emails.adminTwo,
        password: 'hash',
        role: 'ADMIN',
        emailVerified: true
      }
    });
    adminTwoId = adminTwo.id;
    adminTwoToken = signToken(adminTwo.id, 'ADMIN');
    await prisma.adminProfile.create({
      data: {
        userId: adminTwo.id,
        displayName: 'Helper Admin'
      }
    });

    const rider = await prisma.user.create({
      data: {
        email: emails.rider,
        password: 'hash',
        role: 'RIDER',
        emailVerified: true
      }
    });
    riderId = rider.id;
    await prisma.riderProfile.create({
      data: {
        userId: rider.id,
        displayName: 'Admin Rider'
      }
    });

    const target = await prisma.user.create({
      data: {
        email: emails.target,
        password: 'hash',
        role: 'RIDER',
        emailVerified: true
      }
    });
    targetId = target.id;
    const targetProfile = await prisma.riderProfile.create({
      data: {
        userId: target.id,
        displayName: 'Target Rider'
      }
    });
    targetProfileId = targetProfile.id;

    const pro = await prisma.user.create({
      data: {
        email: emails.pro,
        password: 'hash',
        role: 'PRO',
        emailVerified: true
      }
    });
    proId = pro.id;
    await prisma.proProfile.create({
      data: {
        userId: pro.id,
        businessName: 'Admin Pro',
        lat: 43.5,
        lng: -1.5,
        verified: false
      }
    });

    await prisma.session.create({
      data: {
        userId: rider.id,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000)
      }
    });

    const report = await prisma.profileReport.create({
      data: {
        reporterUserId: rider.id,
        reportedProfileId: targetProfile.id,
        reason: 'Safety'
      }
    });
    reportId = report.id;

    adminToken = signToken(admin.id, 'ADMIN');
    riderToken = signToken(rider.id, 'RIDER');
    proToken = signToken(pro.id, 'PRO');
  };

  beforeEach(async () => {
    process.env.ADMIN_STATS_CACHE_ENABLED = 'false';
    await seedAdminFixture();
  });

  afterAll(async () => {
    delete process.env.ADMIN_STATS_CACHE_ENABLED;
    await cleanupFixtureData();
  });

  it('enforces admin guard on protected endpoints', async () => {
    await request(app)
      .get('/admin/stats')
      .set('Authorization', `Bearer ${riderToken}`)
      .expect(403);

    const res = await request(app)
      .get('/admin/stats')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.totalUsers).toBeGreaterThanOrEqual(5);
    expect(res.body.totalPros).toBeGreaterThanOrEqual(1);
    expect(res.body.totalRiders).toBeGreaterThanOrEqual(2);
    expect(res.body.reportedProfiles).toBeGreaterThanOrEqual(1);
  });

  it('rejects admins without required permissions', async () => {
    await request(app)
      .get('/admin/users')
      .set('Authorization', `Bearer ${adminTwoToken}`)
      .expect(403);
  });

  it('lists users with pagination', async () => {
    const res = await request(app)
      .get('/admin/users?page=1&limit=10')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.pagination).toMatchObject({ page: 1, totalPages: expect.any(Number) });
    const riderEntry = (res.body.users as Array<{ email: string }>).find((u) => u.email === emails.rider);
    expect(riderEntry).toBeTruthy();
  });

  it('suspends and restores riders while protecting admins', async () => {
    const agent = request.agent(app);
    const csrf = await getCsrf(agent);

    const suspendRes = await agent
      .patch(`/admin/users/${riderId}/suspend`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-CSRF-Token', csrf)
      .send({ suspended: true })
      .expect(200);
    expect(suspendRes.body.deletedAt).toBeTruthy();

    const resumeRes = await agent
      .patch(`/admin/users/${riderId}/suspend`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-CSRF-Token', csrf)
      .send({ suspended: false })
      .expect(200);
    expect(resumeRes.body.deletedAt).toBeNull();

    await agent
      .patch(`/admin/users/${adminId}/suspend`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-CSRF-Token', csrf)
      .send({ suspended: true })
      .expect(403);
  });

  it('verifies professional profiles', async () => {
    const agent = request.agent(app);
    const csrf = await getCsrf(agent);

    const res = await agent
      .patch(`/admin/pros/${proId}/verify`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-CSRF-Token', csrf)
      .send({ verified: true })
      .expect(200);

    expect(res.body).toMatchObject({ verified: true });
  });

  it('exposes available permissions and role presets', async () => {
    const res = await request(app)
      .get('/admin/permissions')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.available).toContain('users.view');
    expect(res.body.roles.MODERATOR).toContain('reports.view');
  });

  it('prevents admins from altering their own permissions but allows managing others', async () => {
    const selfAgent = request.agent(app);
    const selfCsrf = await getCsrf(selfAgent);

    await selfAgent
      .patch(`/admin/admins/${adminId}/permissions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-CSRF-Token', selfCsrf)
      .send({ permissions: ['users.view'] })
      .expect(403);

    const agent = request.agent(app);
    const csrf = await getCsrf(agent);

    const res = await agent
      .patch(`/admin/admins/${adminTwoId}/permissions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-CSRF-Token', csrf)
      .send({ permissions: ['users.view', 'analytics.view'] })
      .expect(200);

    expect(res.body.permissions).toEqual(expect.arrayContaining(['users.view', 'analytics.view']));
  });

  it('logs an audit entry when applying admin role presets', async () => {
    await prisma.auditLog.deleteMany({ where: { action: 'admin:role:apply' } });

    const agent = request.agent(app);
    const csrf = await getCsrf(agent);

    await agent
      .patch(`/admin/admins/${adminTwoId}/role`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-CSRF-Token', csrf)
      .send({ role: 'MODERATOR' })
      .expect(200);

    const log = await waitForAuditEntry('admin:role:apply', `admin:${adminTwoId}`);

    expect(log).toBeTruthy();
    expect(log?.metadata).toMatchObject({
      method: 'PATCH',
      statusCode: 200
    });
  });

  it('returns reported profiles with reporter context', async () => {
    const res = await request(app)
      .get('/admin/reports?page=1&limit=10')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.reports.length).toBeGreaterThanOrEqual(1);
    const reportEntry = (res.body.reports as Array<{ id: string; reporter: { email: string } }>).find(
      (r) => r.id === reportId
    );
    expect(reportEntry).toBeTruthy();
    expect(reportEntry.reporter.email).toBe(emails.rider);
  });

  it('logs audits when moderating user reports', async () => {
    await prisma.auditLog.deleteMany({ where: { action: 'admin:report:action' } });

    const agent = request.agent(app);
    const csrf = await getCsrf(agent);

    await agent
      .post(`/admin/reports/${reportId}/action`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-CSRF-Token', csrf)
      .send({ action: 'dismiss' })
      .expect(200);

    const log = await waitForAuditEntry('admin:report:action', `report:${reportId}`);

    expect(log).toBeTruthy();
    expect(log?.metadata).toMatchObject({
      method: 'POST',
      statusCode: 200,
      moderationAction: 'dismiss'
    });
  });

  it('retrieves audit logs with pagination and filters', async () => {
    const res = await request(app)
      .get('/admin/audit?limit=5')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.pagination).toMatchObject({ page: 1, limit: 5 });
    if (res.body.items.length > 0) {
      const entry = res.body.items[0];
      expect(entry).toHaveProperty('action');
      expect(entry).toHaveProperty('resource');
      expect(entry).toHaveProperty('createdAt');
    }
  });

  it('audits manual GDPR purges for traceability', async () => {
    await prisma.auditLog.deleteMany({ where: { action: 'admin:gdpr:run-purge' } });
    const purgeSpy = jest.spyOn(gdprPurgeService, 'performFullPurge').mockResolvedValue({
      summary: 'Test purge',
      technicalData: {
        sessionsDeleted: 0,
        tokensDeleted: 0,
        oldLogsDeleted: 0,
        analyticsEventsDeleted: 0,
        analyticsDailyAggDeleted: 0
      },
      userAnonymization: {
        phase1Anonymized: 0,
        phase2Anonymized: 0,
        phase3Purged: 0
      },
      relationalData: {
        conversationsDeleted: 0,
        matchesDeleted: 0,
        oldSearchesDeleted: 0
      }
    });

    const agent = request.agent(app);
    const csrf = await getCsrf(agent);

    const response = await agent
      .post('/admin/gdpr/run-purge')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-CSRF-Token', csrf)
      .send({ confirm: 'CONFIRMER_PURGE_RGPD' })   // F06 — confirmation obligatoire
      .expect(200);

    expect(response.body).toMatchObject({
      success: true,
      timestamp: expect.any(String),
      durationMs: expect.any(Number),
      result: expect.objectContaining({
        technicalData: expect.any(Object),
        userAnonymization: expect.any(Object),
        relationalData: expect.any(Object),
        summary: expect.any(String)
      })
    });

    const log = await waitForAuditEntry('admin:gdpr:run-purge', 'gdpr:purge');

    expect(purgeSpy).toHaveBeenCalled();
    expect(log).toBeTruthy();
    purgeSpy.mockRestore();
  });

  // F06 — Tests négatifs : sans confirmation ou mauvaise chaîne → 400
  it('F06 — POST /admin/gdpr/run-purge sans body → 400', async () => {
    const agent = request.agent(app);
    const csrf = await getCsrf(agent);

    const res = await agent
      .post('/admin/gdpr/run-purge')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-CSRF-Token', csrf)
      .send({})
      .expect(400);

    expect(res.body.error).toBe('Confirmation requise.');
  });

  it('F06 — POST /admin/gdpr/run-purge avec mauvaise chaîne → 400', async () => {
    const agent = request.agent(app);
    const csrf = await getCsrf(agent);

    const res = await agent
      .post('/admin/gdpr/run-purge')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-CSRF-Token', csrf)
      .send({ confirm: 'oui' })
      .expect(400);

    expect(res.body.error).toBe('Confirmation requise.');
  });

  it('allows admins to unblock and block conversations on demand', async () => {
    const conversation = await prisma.conversation.create({
      data: {
        type: 'RIDER_TO_RIDER',
        members: {
          create: [
            { userId: riderId, blockedAt: new Date() },
            { userId: targetId }
          ]
        }
      },
      include: {
        members: true
      }
    });

    const agent = request.agent(app);
    const csrf = await getCsrf(agent);

    await agent
      .post(`/admin/conversations/${conversation.id}/block`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-CSRF-Token', csrf)
      .send({ action: 'unblock', userId: riderId })
      .expect(200);

    const riderMember = await prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId: conversation.id, userId: riderId } }
    });
    const unblockEvents = await prisma.conversationBlockEvent.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: 'asc' }
    });

    expect(riderMember?.blockedAt).toBeNull();
    expect(unblockEvents).toHaveLength(1);
    expect(unblockEvents[0]).toMatchObject({
      userId: riderId,
      actorUserId: adminId,
      action: 'UNBLOCK',
      source: 'ADMIN_SINGLE'
    });

    await agent
      .post(`/admin/conversations/${conversation.id}/block`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-CSRF-Token', csrf)
      .send({ action: 'block' })
      .expect(200);

    const members = await prisma.conversationMember.findMany({
      where: { conversationId: conversation.id }
    });
    const blockEvents = await prisma.conversationBlockEvent.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: 'asc' }
    });

    expect(members.every((member) => member.blockedAt)).toBe(true);
    expect(blockEvents).toHaveLength(3);
    expect(blockEvents.slice(1).every((event) => event.action === 'BLOCK')).toBe(true);
  });

  it('allows admins to clear all conversation blocks', async () => {
    const conversation = await prisma.conversation.create({
      data: {
        type: 'RIDER_TO_PRO',
        members: {
          create: [
            { userId: riderId, blockedAt: new Date() },
            { userId: proId, blockedAt: new Date() }
          ]
        }
      }
    });

    const agent = request.agent(app);
    const csrf = await getCsrf(agent);

    const res = await agent
      .post('/admin/conversations/unblock-all')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-CSRF-Token', csrf)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.batchId).toEqual(expect.any(String));
    expect(res.body.processedCount).toBeGreaterThanOrEqual(2);
    expect(res.body.remainingCount).toBe(0);

    const remaining = await prisma.conversationMember.count({
      where: { conversationId: conversation.id, blockedAt: { not: null } }
    });
    const events = await prisma.conversationBlockEvent.findMany({
      where: {
        batchId: res.body.batchId
      }
    });
    expect(remaining).toBe(0);
    expect(events).toHaveLength(2);
    expect(events.every((event) => event.action === 'UNBLOCK')).toBe(true);
  });

  it('keeps unblock-all idempotent across repeated calls', async () => {
    await prisma.conversation.create({
      data: {
        type: 'RIDER_TO_RIDER',
        members: {
          create: [
            { userId: riderId, blockedAt: new Date() },
            { userId: targetId, blockedAt: new Date() }
          ]
        }
      }
    });

    const agent = request.agent(app);
    const csrf = await getCsrf(agent);

    const first = await agent
      .post('/admin/conversations/unblock-all')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-CSRF-Token', csrf)
      .expect(200);

    const second = await agent
      .post('/admin/conversations/unblock-all')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-CSRF-Token', csrf)
      .expect(200);

    expect(first.body.processedCount).toBeGreaterThanOrEqual(2);
    expect(second.body.processedCount).toBe(0);
    expect(second.body.remainingCount).toBe(0);
  });

  it('requires admin step-up for conversation block operations when enabled', async () => {
    const previous = process.env.ADMIN_REQUIRE_STEP_UP;
    process.env.ADMIN_REQUIRE_STEP_UP = 'true';

    const conversation = await prisma.conversation.create({
      data: {
        type: 'RIDER_TO_RIDER',
        members: {
          create: [
            { userId: riderId },
            { userId: targetId }
          ]
        }
      }
    });

    try {
      const agent = request.agent(app);
      const csrf = await getCsrf(agent);

      await agent
        .post(`/admin/conversations/${conversation.id}/block`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-CSRF-Token', csrf)
        .send({ action: 'block' })
        .expect(403);

      await agent
        .post('/admin/conversations/unblock-all')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-CSRF-Token', csrf)
        .expect(403);
    } finally {
      process.env.ADMIN_REQUIRE_STEP_UP = previous;
    }
  });

  it('exposes conversation block history', async () => {
    const conversation = await prisma.conversation.create({
      data: {
        type: 'RIDER_TO_RIDER',
        members: {
          create: [
            { userId: riderId },
            { userId: targetId }
          ]
        }
      }
    });

    const agent = request.agent(app);
    const csrf = await getCsrf(agent);

    await agent
      .post(`/admin/conversations/${conversation.id}/block`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-CSRF-Token', csrf)
      .send({ action: 'block' })
      .expect(200);

    const history = await request(app)
      .get('/admin/conversations/blocked/history?page=1&limit=5')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(Array.isArray(history.body.items)).toBe(true);
    expect(history.body.items.length).toBeGreaterThan(0);
    expect(history.body.historyReliability).toMatchObject({
      hasLegacyRows: false,
      reliableSinceDate: '2026-04-06',
      reliableSinceVersion: '20260406_add_conversation_block_event'
    });
    expect(history.body.items[0]).toHaveProperty('actorUser');
    expect(history.body.items[0]).toHaveProperty('conversation');
    expect(history.body.items[0]).toHaveProperty('source');
    expect(history.body.items[0]).toHaveProperty('action');
  });

  it('reads report history from ProfileReport instead of AuditLog', async () => {
    await prisma.profileReport.update({
      where: { id: reportId },
      data: {
        reviewedAt: new Date(),
        reviewedByAdminId: adminId,
        reviewedAction: 'dismiss',
      }
    });
    await prisma.auditLog.deleteMany({
      where: { action: 'admin:report:action' }
    });

    const history = await request(app)
      .get('/admin/reports/history?page=1&limit=10')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(Array.isArray(history.body.items)).toBe(true);
    expect(history.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: reportId,
          reviewedAction: 'dismiss',
          reviewedByAdminId: adminId,
          reviewedByAdmin: expect.objectContaining({
            id: adminId,
            email: emails.admin,
          }),
        })
      ])
    );
  });

  it('gates purge until a verified retention export exists', async () => {
    const previousRetention = process.env.AUDIT_LOG_RETENTION_DAYS;
    process.env.AUDIT_LOG_RETENTION_DAYS = '1';

    const oldLog = await prisma.auditLog.create({
      data: {
        userId: adminId,
        action: 'legacy:test',
        resource: 'legacy:test',
        createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      }
    });

    const agent = request.agent(app);
    const csrf = await getCsrf(agent);

    try {
      await agent
        .post('/admin/gdpr/run-purge')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-CSRF-Token', csrf)
        .send({ confirm: 'CONFIRMER_PURGE_RGPD' })
        .expect(409);

      const exportResponse = await agent
        .post('/admin/gdpr/exports')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-CSRF-Token', csrf)
        .send({
          scope: 'AUDIT_LOG',
          fromDate: '2020-01-01T00:00:00.000Z',
          toDate: new Date().toISOString(),
          format: 'NDJSON'
        })
        .expect(200);

      expect(exportResponse.body.artifact).toMatchObject({
        status: 'VERIFIED',
        rowCount: expect.any(Number),
        sha256: expect.any(String),
      });
      expect(exportResponse.body.download).toMatchObject({
        mimeType: 'application/x-ndjson',
        encoding: 'base64',
      });

      const exportsList = await request(app)
        .get('/admin/gdpr/exports?page=1&limit=10')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(exportsList.body.exports).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: exportResponse.body.artifact.id,
            status: 'VERIFIED',
            scope: 'AUDIT_LOG',
          })
        ])
      );

      const purgeSpy = jest.spyOn(gdprPurgeService, 'performFullPurge').mockResolvedValue({
        summary: 'Test purge after verified export',
        technicalData: {
          sessionsDeleted: 0,
          tokensDeleted: 0,
          oldLogsDeleted: 1,
          loginAttemptsDeleted: 0,
          analyticsEventsDeleted: 0,
          analyticsDailyAggDeleted: 0
        },
        userAnonymization: {
          phase1Anonymized: 0,
          phase2Anonymized: 0,
          phase3Purged: 0
        },
        relationalData: {
          conversationsDeleted: 0,
          matchesDeleted: 0,
          oldSearchesDeleted: 0
        }
      });

      await agent
        .post('/admin/gdpr/run-purge')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-CSRF-Token', csrf)
        .send({ confirm: 'CONFIRMER_PURGE_RGPD' })
        .expect(200);

      expect(purgeSpy).toHaveBeenCalled();
      purgeSpy.mockRestore();
    } finally {
      process.env.AUDIT_LOG_RETENTION_DAYS = previousRetention;
      await prisma.auditLog.deleteMany({ where: { id: oldLog.id } });
    }
  });

  it('sends admin broadcasts to specific emails', async () => {
    const agent = request.agent(app);
    const csrf = await getCsrf(agent);

    const res = await agent
      .post('/admin/conversations/broadcast')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-CSRF-Token', csrf)
      .send({
        message: 'Alerte admin',
        target: 'CUSTOM',
        emails: [emails.rider]
      })
      .expect(200);

    expect(res.body.sentCount).toBe(1);

    const conversation = await prisma.conversation.findFirst({
      where: {
        type: 'ADMIN_TO_USER',
        members: {
          some: { userId: riderId }
        }
      },
      include: {
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1
        }
      }
    });

    expect(conversation).toBeTruthy();
    expect(conversation?.messages[0]?.content).toContain('Alerte admin');
  });

  it('manages system alerts lifecycle', async () => {
    const agent = request.agent(app);
    const csrf = await getCsrf(agent);

    const created = await agent
      .post('/admin/alerts')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-CSRF-Token', csrf)
      .send({ type: 'test:alert', message: 'Alerte de test', severity: 'INFO' })
      .expect(201);

    const alertId = created.body.id;

    await agent
      .post(`/admin/alerts/${alertId}/ack`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-CSRF-Token', csrf)
      .expect(200);

    await agent
      .post(`/admin/alerts/${alertId}/resolve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-CSRF-Token', csrf)
      .expect(200);
  });

  it('rejects analytics access for non-admin users', async () => {
    await request(app)
      .get('/admin/analytics/engagement?period=7d')
      .set('Authorization', `Bearer ${riderToken}`)
      .expect(403);
  });

  // ─── F03: lat/lng absents de GET /admin/users/:id ───────────────────────────

  it('F03 — GET /admin/users/:id ne fuit pas lat/lng, expose hasLocation', async () => {
    const res = await request(app)
      .get(`/admin/users/${targetId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const { user } = res.body as { user: Record<string, unknown> };

    // riderProfile: pas de lat/lng, mais hasLocation présent
    const riderProfile = user.riderProfile as Record<string, unknown> | null;
    expect(riderProfile).toBeTruthy();
    expect(riderProfile!.lat).toBeUndefined();
    expect(riderProfile!.lng).toBeUndefined();
    expect(typeof riderProfile!.hasLocation).toBe('boolean');

    // lastSearch: pas de lat/lng si présent
    if (user.lastSearch) {
      const lastSearch = user.lastSearch as Record<string, unknown>;
      expect(lastSearch.lat).toBeUndefined();
      expect(lastSearch.lng).toBeUndefined();
    }
  });

  it('F03 — GET /admin/users/:id pro ne fuit pas lat/lng, expose hasLocation', async () => {
    const res = await request(app)
      .get(`/admin/users/${proId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const { user } = res.body as { user: Record<string, unknown> };
    const proProfile = user.proProfile as Record<string, unknown> | null;
    expect(proProfile).toBeTruthy();
    expect(proProfile!.lat).toBeUndefined();
    expect(proProfile!.lng).toBeUndefined();
    expect(typeof proProfile!.hasLocation).toBe('boolean');
    // Le pro a été seedé avec lat=43.5, lng=-1.5 → hasLocation doit être true
    expect(proProfile!.hasLocation).toBe(true);
  });

  // ─── F05: system.monitor séparé de system.configure ────────────────────────

  it('F05 — admin avec system.monitor peut lire GET /alerts, refusé pour POST /alerts', async () => {
    // Créer un admin avec seulement system.monitor
    const monitorUser = await prisma.user.create({
      data: { email: 'monitor-only@test.com', password: 'hash', role: 'ADMIN', emailVerified: true }
    });
    await prisma.adminProfile.create({
      data: { userId: monitorUser.id, displayName: 'Monitor Only', permissions: ['system.monitor'] }
    });
    const monitorToken = jwt.sign({ sub: monitorUser.id, role: 'ADMIN' }, process.env.JWT_SECRET!, { expiresIn: '1h' });

    try {
      // GET /alerts → 200 avec system.monitor
      await request(app)
        .get('/admin/alerts')
        .set('Authorization', `Bearer ${monitorToken}`)
        .expect(200);

      // POST /alerts → 403 sans system.configure
      const agent = request.agent(app);
      const csrf = await getCsrf(agent);
      await agent
        .post('/admin/alerts')
        .set('Authorization', `Bearer ${monitorToken}`)
        .set('X-CSRF-Token', csrf)
        .send({ type: 'test', message: 'test alert', severity: 'INFO' })
        .expect(403);

      // GET /gdpr/compliance-report → 200 avec system.monitor
      await request(app)
        .get('/admin/gdpr/compliance-report')
        .set('Authorization', `Bearer ${monitorToken}`)
        .expect(200);

      // POST /gdpr/run-purge → 403 sans system.configure
      await agent
        .post('/admin/gdpr/run-purge')
        .set('Authorization', `Bearer ${monitorToken}`)
        .set('X-CSRF-Token', csrf)
        .send({ confirm: 'CONFIRMER_PURGE_RGPD' })
        .expect(403);
    } finally {
      await prisma.adminProfile.deleteMany({ where: { userId: monitorUser.id } });
      await prisma.user.delete({ where: { id: monitorUser.id } });
    }
  });

  it('F05 — SUPER_ADMIN conserve system.configure et system.monitor', async () => {
    // AVAILABLE_PERMISSIONS importé en tête du fichier
    expect(AVAILABLE_PERMISSIONS).toContain('system.monitor');
    expect(AVAILABLE_PERMISSIONS).toContain('system.configure');

    // Le token admin courant a tous les droits → accès aux deux catégories
    const agent = request.agent(app);
    const csrf = await getCsrf(agent);

    // system.monitor
    await request(app)
      .get('/admin/alerts')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    // system.configure (write)
    const created = await agent
      .post('/admin/alerts')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-CSRF-Token', csrf)
      .send({ type: 'test:f05', message: 'Test F05', severity: 'INFO' })
      .expect(201);

    expect(created.body.id).toBeTruthy();
  });

  // ─── F07: compteurs reports + mark reviewed ─────────────────────────────────

  it('F07 — GET /admin/reports retourne summary.pending et summary.reviewed', async () => {
    const res = await request(app)
      .get('/admin/reports?page=1&limit=20')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.summary).toBeDefined();
    expect(typeof res.body.summary.pending).toBe('number');
    expect(typeof res.body.summary.reviewed).toBe('number');
    // Le report seedé est pending (reviewedAt IS NULL)
    expect(res.body.summary.pending).toBeGreaterThanOrEqual(1);
  });

  it('F07 — POST /reports/:id/action "dismiss" marque reviewedAt, ne supprime plus le report', async () => {
    const agent = request.agent(app);
    const csrf = await getCsrf(agent);

    await agent
      .post(`/admin/reports/${reportId}/action`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-CSRF-Token', csrf)
      .send({ action: 'dismiss' })
      .expect(200);

    // Le report doit toujours exister en DB, avec reviewedAt renseigné
    const report = await prisma.profileReport.findUnique({ where: { id: reportId } });
    expect(report).not.toBeNull();
    expect(report!.reviewedAt).not.toBeNull();
    expect(report!.reviewedAction).toBe('dismiss');
  });

  it('F07 — le compteur pending diminue après modération, reviewed augmente', async () => {
    // Avant action: 1 report pending
    const before = await request(app)
      .get('/admin/reports')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const pendingBefore = before.body.summary.pending as number;
    const reviewedBefore = before.body.summary.reviewed as number;

    const agent = request.agent(app);
    const csrf = await getCsrf(agent);
    await agent
      .post(`/admin/reports/${reportId}/action`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-CSRF-Token', csrf)
      .send({ action: 'approve' })
      .expect(200);

    // Après action
    const after = await request(app)
      .get('/admin/reports')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(after.body.summary.pending).toBe(pendingBefore - 1);
    expect(after.body.summary.reviewed).toBe(reviewedBefore + 1);
  });

  it('F07 — GET /admin/stats retourne uniquement les reports en attente', async () => {
    // Le report seedé est pending
    const stats = await request(app)
      .get('/admin/stats')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const pendingFromStats = stats.body.reportedProfiles as number;

    // Traiter le report
    const agent = request.agent(app);
    const csrf = await getCsrf(agent);
    await agent
      .post(`/admin/reports/${reportId}/action`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-CSRF-Token', csrf)
      .send({ action: 'dismiss' })
      .expect(200);

    // Après traitement, le compteur doit baisser
    const statsAfter = await request(app)
      .get('/admin/stats')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(statsAfter.body.reportedProfiles).toBe(pendingFromStats - 1);
  });
});
