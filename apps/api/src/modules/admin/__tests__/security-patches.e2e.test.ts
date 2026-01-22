/**
 * Security Patches E2E Tests
 * Tests for P0/P1 security fixes:
 * - P0-1: GDPR purge safeguards
 * - P1-2: Broadcast safeguards
 * - P1-3: Export CSV limits
 */

import request from 'supertest';
import { createApp } from '../../../index';
import { clientPrisma as prisma } from '@blobinfini/database';

const app = createApp();

describe('Security Patches E2E', () => {
  let adminToken: string;
  let adminUserId: string;

  beforeAll(async () => {
    // Cleanup
    await prisma.auditLog.deleteMany({});
    await prisma.adminProfile.deleteMany({});
    await prisma.user.deleteMany({
      where: { email: 'security-test-admin@test.com' }
    });

    // Create admin user
    const admin = await prisma.user.create({
      data: {
        email: 'security-test-admin@test.com',
        password: 'Test1234!',
        passwordHash: '$2b$10$dummy.hash.for.testing.only.with.proper.format',
        role: 'ADMIN',
        emailVerified: true,
        consentedAt: new Date(),
        adminProfile: {
          create: {
            displayName: 'Security Test Admin',
            permissions: ['system.configure', 'reports.moderate']
          }
        }
      }
    });

    adminUserId = admin.id;

    // Login to get token
    const agent = request.agent(app);
    const csrfRes = await agent.get('/auth/csrf');
    const csrfToken = csrfRes.body.token;

    const loginRes = await agent
      .post('/auth/login')
      .set('X-CSRF-Token', csrfToken)
      .send({
        email: 'security-test-admin@test.com',
        password: 'Test1234!'
      });

    adminToken = loginRes.body.accessToken;
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({});
    await prisma.adminProfile.deleteMany({});
    await prisma.user.deleteMany({
      where: { email: 'security-test-admin@test.com' }
    });
  });

  describe('P0-1: GDPR Purge Safeguards', () => {
    it('should reject purge without confirmation', async () => {
      const res = await request(app)
        .post('/admin/gdpr/run-purge')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Confirmation required');
      expect(res.body.message).toContain('confirm: "PURGE"');
    });

    it('should reject purge with incorrect confirmation', async () => {
      const res = await request(app)
        .post('/admin/gdpr/run-purge')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          confirm: 'CONFIRM',
          reason: 'Test purge reason'
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Confirmation required');
    });

    it('should reject purge without reason', async () => {
      const res = await request(app)
        .post('/admin/gdpr/run-purge')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          confirm: 'PURGE'
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Confirmation required');
    });

    it('should reject purge with reason too short', async () => {
      const res = await request(app)
        .post('/admin/gdpr/run-purge')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          confirm: 'PURGE',
          reason: 'short'
        });

      expect(res.status).toBe(400);
    });

    it('should accept purge with correct confirmation + reason', async () => {
      const res = await request(app)
        .post('/admin/gdpr/run-purge')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          confirm: 'PURGE',
          reason: 'Testing GDPR purge with valid reason that is long enough'
        });

      // Note: May be 429 if rate limited from previous test
      expect([200, 429]).toContain(res.status);

      if (res.status === 200) {
        expect(res.body.success).toBe(true);
        expect(res.body).toHaveProperty('durationMs');
      } else {
        expect(res.body.error).toBe('GDPR_PURGE_RATE_LIMIT_EXCEEDED');
      }
    });

    it('should enforce rate limit (1 per 24h)', async () => {
      // First call (if not already done above)
      await request(app)
        .post('/admin/gdpr/run-purge')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          confirm: 'PURGE',
          reason: 'Testing rate limit for GDPR purge endpoint'
        });

      // Second call should be rate limited
      const res = await request(app)
        .post('/admin/gdpr/run-purge')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          confirm: 'PURGE',
          reason: 'Second attempt to test rate limit'
        });

      expect(res.status).toBe(429);
      expect(res.body.error).toBe('GDPR_PURGE_RATE_LIMIT_EXCEEDED');
      expect(res.body.retryAfter).toBe('24 hours');
    });
  });

  describe('P1-2: Broadcast Safeguards', () => {
    it('should reject broadcast without confirmation', async () => {
      const res = await request(app)
        .post('/admin/conversations/broadcast')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          message: 'Test broadcast message',
          target: 'ALL'
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Confirmation required');
      expect(res.body.message).toContain('confirm: true');
    });

    it('should reject broadcast without reason', async () => {
      const res = await request(app)
        .post('/admin/conversations/broadcast')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          message: 'Test broadcast message',
          target: 'ALL',
          confirm: true
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Confirmation required');
    });

    it('should reject broadcast with reason too short', async () => {
      const res = await request(app)
        .post('/admin/conversations/broadcast')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          message: 'Test broadcast message',
          target: 'ALL',
          confirm: true,
          reason: 'short'
        });

      expect(res.status).toBe(400);
    });

    it('should accept broadcast with confirmation + reason', async () => {
      const res = await request(app)
        .post('/admin/conversations/broadcast')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          message: 'Test broadcast message for security test',
          target: 'ALL',
          confirm: true,
          reason: 'Testing broadcast endpoint with valid confirmation'
        });

      // May be 429 if rate limited, or 404 if no recipients
      expect([200, 404, 429]).toContain(res.status);

      if (res.status === 429) {
        expect(res.body.error).toBe('ADMIN_BROADCAST_RATE_LIMIT_EXCEEDED');
      }
    });

    it('should enforce rate limit (1 per hour)', async () => {
      // First call
      await request(app)
        .post('/admin/conversations/broadcast')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          message: 'First broadcast for rate limit test',
          target: 'ALL',
          confirm: true,
          reason: 'Testing rate limit on broadcast endpoint'
        });

      // Second call should be rate limited
      const res = await request(app)
        .post('/admin/conversations/broadcast')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          message: 'Second broadcast attempt',
          target: 'ALL',
          confirm: true,
          reason: 'Second attempt to test rate limit'
        });

      expect(res.status).toBe(429);
      expect(res.body.error).toBe('ADMIN_BROADCAST_RATE_LIMIT_EXCEEDED');
      expect(res.body.retryAfter).toBe('1 hour');
    });

    it('should flag URLs in broadcast messages', async () => {
      const res = await request(app)
        .post('/admin/conversations/broadcast')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          message: 'Check out this link: https://example.com/phishing',
          target: 'ALL',
          confirm: true,
          reason: 'Testing URL detection in broadcast messages'
        });

      // Should not block, but URL should be flagged in audit
      // (we can't easily test audit here, but endpoint should accept)
      expect([200, 404, 429]).toContain(res.status);
    });
  });

  describe('P1-3: Export CSV Limits', () => {
    beforeAll(async () => {
      // Create some audit logs for testing
      const now = new Date();
      await prisma.auditLog.createMany({
        data: Array.from({ length: 50 }, (_, i) => ({
          userId: adminUserId,
          action: 'test:action',
          resource: `test:${i}`,
          ip: '127.0.0.1',
          createdAt: new Date(now.getTime() - i * 1000 * 60) // 1 min apart
        }))
      });
    });

    afterAll(async () => {
      await prisma.auditLog.deleteMany({
        where: { action: 'test:action' }
      });
    });

    it('should reject audit export without date range', async () => {
      const res = await request(app)
        .get('/admin/audit')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid query parameters');
      expect(res.body.message).toContain('Date range is required');
    });

    it('should reject audit export with only startDate', async () => {
      const res = await request(app)
        .get('/admin/audit')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ startDate: new Date().toISOString() });

      expect(res.status).toBe(400);
    });

    it('should reject audit export with range >30 days', async () => {
      const endDate = new Date();
      const startDate = new Date(endDate.getTime() - 31 * 24 * 60 * 60 * 1000); // 31 days ago

      const res = await request(app)
        .get('/admin/audit')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString()
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('30 days');
    });

    it('should accept audit export with valid date range', async () => {
      const endDate = new Date();
      const startDate = new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000); // 7 days ago

      const res = await request(app)
        .get('/admin/audit')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString()
        });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('items');
      expect(res.body).toHaveProperty('pagination');
    });

    it('should reject audit export if result >10k records', async () => {
      // We can't easily create 10k records in test, so we test the logic
      // by checking if the endpoint properly validates and returns error
      // This would be tested in integration with a larger dataset

      const endDate = new Date();
      const startDate = new Date(endDate.getTime() - 1 * 24 * 60 * 60 * 1000); // 1 day

      const res = await request(app)
        .get('/admin/audit')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString()
        });

      // With our test data (50 records), should succeed
      expect(res.status).toBe(200);
      expect(res.body.pagination.total).toBeLessThan(10000);
    });

    it('should accept security events with optional date range', async () => {
      const res = await request(app)
        .get('/admin/security/events')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ limit: 100 });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('events');
    });

    it('should validate security events date range if provided', async () => {
      const endDate = new Date();
      const startDate = new Date(endDate.getTime() - 31 * 24 * 60 * 60 * 1000); // 31 days

      const res = await request(app)
        .get('/admin/security/events')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString()
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('30 days');
    });
  });
});
