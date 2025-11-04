import request, { SuperAgentTest } from 'supertest';
import jwt from 'jsonwebtoken';
import { clientPrisma as prisma } from '@blobinfini/database';
import { createApp } from '../../../index';

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
let riderId = '';
let targetProfileId = '';
let proId = '';
let adminToken = '';
let riderToken = '';
let proToken = '';
let reportId = '';

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

describe('Admin Controller', () => {
  beforeAll(async () => {
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
        permissions: ['users.view', 'analytics.view']
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
});
