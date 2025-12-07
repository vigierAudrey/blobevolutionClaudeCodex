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
        businessName: 'Admin Pro'
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
    await seedAdminFixture();
  });

  afterAll(async () => {
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
    const riderEntry = res.body.users.find((u: any) => u.email === emails.rider);
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
    const reportEntry = res.body.reports.find((r: any) => r.id === reportId);
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
        oldLogsDeleted: 0
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
      .send({})
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

    expect(riderMember?.blockedAt).toBeNull();

    await agent
      .post(`/admin/conversations/${conversation.id}/block`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-CSRF-Token', csrf)
      .send({ action: 'block' })
      .expect(200);

    const members = await prisma.conversationMember.findMany({
      where: { conversationId: conversation.id }
    });

    expect(members.every((member) => member.blockedAt)).toBe(true);
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
    expect(res.body.count).toBeGreaterThanOrEqual(2);

    const remaining = await prisma.conversationMember.count({
      where: { conversationId: conversation.id, blockedAt: { not: null } }
    });
    expect(remaining).toBe(0);
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
});
