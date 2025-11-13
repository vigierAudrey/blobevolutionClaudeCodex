import request from 'supertest';
import { createApp } from '../../../index';
import { AuthService } from '../../auth/auth.service';
import { clientPrisma as prisma } from '@blobinfini/database';

describe('Security Controller', () => {
  let app: Express.Application;
  let adminToken: string;

  beforeAll(async () => {
    app = createApp();

    // Créer un utilisateur admin pour les tests
    const authService = new AuthService();
    const adminUser = await prisma.user.findFirst({
      where: { role: 'ADMIN', email: 'dev+admin@test.com' }
    });

    if (!adminUser) {
      throw new Error('Admin user not found. Run seed first.');
    }

    // Générer un token admin
    const tokens = await authService.generateTokens(adminUser);
    adminToken = tokens.accessToken;
  });

  describe('GET /api/security/health', () => {
    it('devrait rejeter les requêtes non authentifiées', async () => {
      const response = await request(app)
        .get('/api/security/health')
        .expect(401);

      expect(response.body).toHaveProperty('error');
    });

    it('devrait rejeter les utilisateurs non-admin', async () => {
      // Créer un utilisateur RIDER
      const riderUser = await prisma.user.findFirst({
        where: { role: 'RIDER' }
      });

      if (!riderUser) {
        throw new Error('Rider user not found. Run seed first.');
      }

      const authService = new AuthService();
      const tokens = await authService.generateTokens(riderUser);

      const response = await request(app)
        .get('/api/security/health')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .expect(403);

      expect(response.body).toHaveProperty('error');
    });

    it('devrait retourner le health status pour un admin', async () => {
      const response = await request(app)
        .get('/api/security/health')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('status');
      expect(response.body).toHaveProperty('helmet');
      expect(response.body).toHaveProperty('csrf');
      expect(response.body).toHaveProperty('rateLimit');
      expect(response.body).toHaveProperty('corsWhitelist');
      expect(response.body).toHaveProperty('issues');
      expect(response.body).toHaveProperty('checks');
      expect(response.body).toHaveProperty('environment');
      expect(response.body).toHaveProperty('timestamp');

      // Vérifier les valeurs
      expect(response.body.helmet).toBe(true);
      expect(response.body.csrf).toBe(true);
      expect(response.body.rateLimit).toBe(true);
      expect(Array.isArray(response.body.corsWhitelist)).toBe(true);
      expect(Array.isArray(response.body.issues)).toBe(true);
      expect(['SECURE', 'VULNERABLE']).toContain(response.body.status);
    });

    it('devrait détecter les problèmes de sécurité en production', async () => {
      // Temporairement passer en mode production
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      process.env.ALLOWED_ORIGINS = ''; // Simuler un problème CORS

      const response = await request(app)
        .get('/api/security/health')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      // Restaurer l'environnement
      process.env.NODE_ENV = originalEnv;

      expect(response.body.status).toBe('VULNERABLE');
      expect(response.body.issues.length).toBeGreaterThan(0);
    });
  });
});
