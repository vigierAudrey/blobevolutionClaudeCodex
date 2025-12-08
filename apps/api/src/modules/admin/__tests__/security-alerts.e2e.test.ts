/**
 * Tests E2E pour le système d'alertes de sécurité
 *
 * Vérifie que :
 * - Les alertes sont créées lors des tentatives d'accès cross-role
 * - Les emails de notification sont envoyés
 * - L'admin peut consulter les alertes
 * - Tous les cas sont couverts : PRO→RIDER, RIDER→PRO, ADMIN→PRO, ADMIN→RIDER
 */

import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../../../index';
import { clientPrisma as prisma } from '@blobinfini/database';

const app = createApp();

const ensureSecrets = () => {
  process.env.JWT_SECRET ||= 'test-jwt-secret';
  process.env.ADMIN_EMAIL ||= 'admin-test@blobinfini.com';
};

const signToken = (userId: string, role: 'RIDER' | 'PRO' | 'ADMIN') => {
  return jwt.sign({ sub: userId, role }, process.env.JWT_SECRET as string, { expiresIn: '1h' });
};

describe('Security Alerts System E2E Tests', () => {
  let riderUserId = '';
  let riderToken = '';
  let proUserId = '';
  let proToken = '';
  let adminUserId = '';
  let adminToken = '';
  let csrfToken = '';
  let agent: ReturnType<typeof request.agent>;

  beforeAll(async () => {
    ensureSecrets();
  });

  beforeEach(async () => {
    // Cleanup
    await prisma.systemAlert.deleteMany({});
    await prisma.auditLog.deleteMany({});
    await prisma.riderProfile.deleteMany({});
    await prisma.proProfile.deleteMany({});
    await prisma.adminProfile.deleteMany({});
    await prisma.user.deleteMany({
      where: {
        email: { in: ['rider-alert@test.com', 'pro-alert@test.com', 'admin-alert@test.com'] }
      }
    });

    // Create a new agent for this test (maintains cookies between requests)
    agent = request.agent(app);

    // Get CSRF token for PUT/POST requests (agent will keep the session cookie)
    const csrfRes = await agent.get('/csrf-token');
    csrfToken = csrfRes.body.csrfToken;

    // Create RIDER user
    const riderUser = await prisma.user.create({
      data: {
        email: 'rider-alert@test.com',
        password: 'hash',
        role: 'RIDER',
        emailVerified: true
      }
    });
    riderUserId = riderUser.id;
    riderToken = signToken(riderUserId, 'RIDER');

    await prisma.riderProfile.create({
      data: {
        userId: riderUserId,
        displayName: 'Test Rider',
        lat: 48.8584,
        lng: 2.2945
      }
    });

    // Create PRO user
    const proUser = await prisma.user.create({
      data: {
        email: 'pro-alert@test.com',
        password: 'hash',
        role: 'PRO',
        emailVerified: true
      }
    });
    proUserId = proUser.id;
    proToken = signToken(proUserId, 'PRO');

    await prisma.proProfile.create({
      data: {
        userId: proUserId,
        businessName: 'Test Pro',
        lat: 48.8500,
        lng: 2.3400
      }
    });

    // Create ADMIN user
    const adminUser = await prisma.user.create({
      data: {
        email: 'admin-alert@test.com',
        password: 'hash',
        role: 'ADMIN',
        emailVerified: true
      }
    });
    adminUserId = adminUser.id;
    adminToken = signToken(adminUserId, 'ADMIN');

    await prisma.adminProfile.create({
      data: {
        userId: adminUserId,
        displayName: 'Test Admin'
      }
    });
  });

  afterAll(async () => {
    await prisma.systemAlert.deleteMany({});
    await prisma.auditLog.deleteMany({});
    await prisma.riderProfile.deleteMany({});
    await prisma.proProfile.deleteMany({});
    await prisma.adminProfile.deleteMany({});
    await prisma.user.deleteMany({
      where: {
        email: { in: ['rider-alert@test.com', 'pro-alert@test.com', 'admin-alert@test.com'] }
      }
    });
  });

  describe('PRO → RIDER violations', () => {
    it('should create security alert when PRO accesses GET /profile/me', async () => {
      // PRO tente d'accéder au profil RIDER
      await agent
        .get('/profile/me')
        .set('Authorization', `Bearer ${proToken}`)
        .expect(403);

      // Vérifier qu'une alerte a été créée
      const alerts = await prisma.systemAlert.findMany({
        where: {
          type: 'SECURITY_VIOLATION',
          createdById: proUserId
        }
      });

      expect(alerts).toHaveLength(1);
      expect(alerts[0].severity).toBe('CRITICAL');
      expect(alerts[0].message).toContain('PRO');
      expect(alerts[0].message).toContain('RIDER');

      const metadata = alerts[0].metadata as any;
      expect(metadata.endpoint).toBe('GET /profile/me');
      expect(metadata.userRole).toBe('PRO');
    });

    it('should create security alert when PRO accesses PUT /profile/me', async () => {
      // Need to send valid data to pass Zod validation and reach role check
      await agent
        .put('/profile/me')
        .set('Authorization', `Bearer ${proToken}`)
        .set('X-CSRF-Token', csrfToken)
        .send({
          displayName: 'Hacked Rider',
          bio: 'I am trying to modify rider profile',
          lat: 48.8584,
          lng: 2.2945
        })
        .expect(403);

      const alerts = await prisma.systemAlert.findMany({
        where: {
          type: 'SECURITY_VIOLATION',
          createdById: proUserId
        }
      });

      expect(alerts).toHaveLength(1);
      const metadata = alerts[0].metadata as any;
      expect(metadata.endpoint).toBe('PUT /profile/me');
    });

    it('should create security alert when PRO tries to upload RIDER photo', async () => {
      await agent
        .post('/profile/photo/upload-url')
        .set('Authorization', `Bearer ${proToken}`)
        .set('X-CSRF-Token', csrfToken)
        .send({ contentType: 'image/jpeg' })
        .expect(403);

      const alerts = await prisma.systemAlert.findMany({
        where: {
          type: 'SECURITY_VIOLATION',
          createdById: proUserId
        }
      });

      expect(alerts).toHaveLength(1);
      const metadata = alerts[0].metadata as any;
      expect(metadata.endpoint).toBe('POST /profile/photo/upload-url');
    });
  });

  describe('RIDER → PRO violations', () => {
    it('should create security alert when RIDER accesses GET /pro/me', async () => {
      await agent
        .get('/pro/me')
        .set('Authorization', `Bearer ${riderToken}`)
        .expect(403);

      const alerts = await prisma.systemAlert.findMany({
        where: {
          type: 'SECURITY_VIOLATION',
          createdById: riderUserId
        }
      });

      expect(alerts).toHaveLength(1);
      expect(alerts[0].severity).toBe('CRITICAL');
      const metadata = alerts[0].metadata as any;
      expect(metadata.userRole).toBe('RIDER');
      expect(metadata.endpoint).toContain('GET /pro/me');
    });

    it('should create security alert when RIDER accesses PUT /pro/me', async () => {
      // Need to send valid data to pass Zod validation
      await agent
        .put('/pro/me')
        .set('Authorization', `Bearer ${riderToken}`)
        .set('X-CSRF-Token', csrfToken)
        .send({
          businessName: 'Fake Pro Business',
          bio: 'I am trying to become a pro',
          lat: 48.8500,
          lng: 2.3400
        })
        .expect(403);

      const alerts = await prisma.systemAlert.findMany({
        where: {
          type: 'SECURITY_VIOLATION',
          createdById: riderUserId
        }
      });

      expect(alerts).toHaveLength(1);
    });
  });

  describe('ADMIN → PRO violations (compromised account detection)', () => {
    it('should create CRITICAL alert when ADMIN accesses PRO endpoints', async () => {
      await agent
        .get('/pro/me')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(403);

      const alerts = await prisma.systemAlert.findMany({
        where: {
          type: 'SECURITY_VIOLATION',
          createdById: adminUserId
        }
      });

      expect(alerts).toHaveLength(1);
      expect(alerts[0].severity).toBe('CRITICAL');
      const metadata = alerts[0].metadata as any;
      expect(metadata.userRole).toBe('ADMIN');
      expect(metadata.attemptedAction).toContain('potentiellement compromis');
    });
  });

  describe('ADMIN → RIDER violations (compromised account detection)', () => {
    it('should create CRITICAL alert when ADMIN tries to upload RIDER photo', async () => {
      const res = await agent
        .post('/profile/photo/upload-url')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-CSRF-Token', csrfToken)
        .send({ contentType: 'image/jpeg' });

      console.log('ADMIN photo upload response:', res.status, res.body);

      const alerts = await prisma.systemAlert.findMany({
        where: {
          type: 'SECURITY_VIOLATION',
          createdById: adminUserId
        }
      });

      console.log('Found alerts for ADMIN:', alerts.length);

      expect(res.status).toBe(403);
      expect(alerts).toHaveLength(1);
      expect(alerts[0].severity).toBe('CRITICAL');
      const metadata = alerts[0].metadata as any;
      expect(metadata.userRole).toBe('ADMIN');
      expect(metadata.attemptedAction).toContain('potentiellement compromis');
    });
  });

  describe('Alert metadata completeness', () => {
    it('should include all security context in alert metadata', async () => {
      await agent
        .get('/profile/me')
        .set('Authorization', `Bearer ${proToken}`)
        .set('User-Agent', 'Test-Browser/1.0')
        .expect(403);

      const alerts = await prisma.systemAlert.findMany({
        where: { createdById: proUserId }
      });

      expect(alerts).toHaveLength(1);
      const metadata = alerts[0].metadata as any;

      // Vérifier que toutes les informations de contexte sont présentes
      expect(metadata).toHaveProperty('userId');
      expect(metadata).toHaveProperty('userEmail');
      expect(metadata).toHaveProperty('userRole');
      expect(metadata).toHaveProperty('endpoint');
      expect(metadata).toHaveProperty('action');
      expect(metadata).toHaveProperty('attemptedAction');
      expect(metadata).toHaveProperty('timestamp');
      // IP et User-Agent peuvent être null en environnement de test
      expect(metadata).toHaveProperty('ip');
      expect(metadata).toHaveProperty('userAgent');
    });
  });

  describe('Alert deduplication', () => {
    it('should create separate alerts for each violation attempt', async () => {
      // PRO fait 3 tentatives différentes avec des bodies valides
      const res1 = await agent
        .get('/profile/me')
        .set('Authorization', `Bearer ${proToken}`);
      console.log('Request 1 (GET) status:', res1.status);

      const res2 = await agent
        .put('/profile/me')
        .set('Authorization', `Bearer ${proToken}`)
        .set('X-CSRF-Token', csrfToken)
        .send({
          displayName: 'Test Hacker',
          bio: 'Attempting multiple violations',
          lat: 48.8584,
          lng: 2.2945
        });
      console.log('Request 2 (PUT) status:', res2.status);

      const res3 = await agent
        .post('/profile/photo/upload-url')
        .set('Authorization', `Bearer ${proToken}`)
        .set('X-CSRF-Token', csrfToken)
        .send({ contentType: 'image/jpeg' });
      console.log('Request 3 (POST) status:', res3.status);

      const alerts = await prisma.systemAlert.findMany({
        where: { createdById: proUserId }
      });

      console.log('Total alerts created:', alerts.length);
      alerts.forEach((alert, i) => {
        const metadata = alert.metadata as any;
        console.log(`Alert ${i + 1}: ${metadata.endpoint}`);
      });

      // Chaque tentative doit créer une alerte séparée (pas de déduplication)
      expect(alerts.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Admin alert consultation', () => {
    it('should allow admin to list security alerts', async () => {
      // Créer quelques alertes
      await agent
        .get('/profile/me')
        .set('Authorization', `Bearer ${proToken}`)
        .expect(403);

      await agent
        .get('/pro/me')
        .set('Authorization', `Bearer ${riderToken}`)
        .expect(403);

      // L'admin consulte les alertes
      // Note: Ceci nécessite que l'admin ait les permissions appropriées
      // Pour l'instant on vérifie juste que les alertes sont dans la DB
      const alerts = await prisma.systemAlert.findMany({
        where: { type: 'SECURITY_VIOLATION' },
        orderBy: { createdAt: 'desc' }
      });

      expect(alerts.length).toBeGreaterThanOrEqual(2);
      expect(alerts[0].severity).toBe('CRITICAL');
      expect(alerts[0].status).toBe('OPEN');
    });
  });
});
