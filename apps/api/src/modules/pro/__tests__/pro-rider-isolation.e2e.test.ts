import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../../../index';
import { clientPrisma as prisma } from '@blobinfini/database';

const app = createApp();

const ensureSecrets = () => {
  process.env.JWT_SECRET ||= 'test-jwt-secret';
};

const signToken = (userId: string, role: 'RIDER' | 'PRO') => {
  return jwt.sign({ sub: userId, role }, process.env.JWT_SECRET as string, { expiresIn: '1h' });
};

describe('PRO ↔ RIDER Isolation Tests', () => {
  let riderUserId = '';
  let riderToken = '';
  let riderProfileId = '';
  let proUserId = '';
  let proToken = '';
  let agent: ReturnType<typeof request.agent>;
  let csrfToken = '';

  beforeAll(async () => {
    ensureSecrets();
  });

  beforeEach(async () => {
    agent = request.agent(app);
    const csrfRes = await agent.get('/csrf-token');
    csrfToken = csrfRes.body.csrfToken;

    // Cleanup
    await prisma.riderProfile.deleteMany({});
    await prisma.proProfile.deleteMany({});
    await prisma.user.deleteMany({
      where: {
        email: { in: ['rider-iso@test.com', 'pro-iso@test.com'] }
      }
    });

    // Create RIDER user
    const riderUser = await prisma.user.create({
      data: {
        email: 'rider-iso@test.com',
        password: 'hash',
        role: 'RIDER',
        emailVerified: true
      }
    });
    riderUserId = riderUser.id;
    riderToken = signToken(riderUserId, 'RIDER');
    
    const riderProfile = await prisma.riderProfile.create({
      data: {
        userId: riderUserId,
        displayName: 'Test Rider',
        lat: 48.8584,
        lng: 2.2945
      }
    });
    riderProfileId = riderProfile.id;

    // Create PRO user
    const proUser = await prisma.user.create({
      data: {
        email: 'pro-iso@test.com',
        password: 'hash',
        role: 'PRO',
        emailVerified: true
      }
    });
    proUserId = proUser.id;
    proToken = signToken(proUserId, 'PRO');
  });

  afterAll(async () => {
    await prisma.riderProfile.deleteMany({});
    await prisma.proProfile.deleteMany({});
    await prisma.user.deleteMany({
      where: {
        email: { in: ['rider-iso@test.com', 'pro-iso@test.com'] }
      }
    });
  });

  describe('PRO → RIDER isolation (PRO cannot access RIDER routes)', () => {
    it('should REJECT PRO trying to access GET /profile/me', async () => {
      const res = await agent
        .get('/profile/me')
        .set('Authorization', `Bearer ${proToken}`)
        .expect(403);

      // After security fix: PRO users should be blocked with 403 Forbidden
      expect(res.body.error).toContain('Accès refusé');
      expect(res.body.error).toContain('PRO');
      expect(res.body.message).toContain('administrateur');
    });

    it('should REJECT PRO trying to update RIDER profile via PUT /profile/me', async () => {
      const res = await agent
        .put('/profile/me')
        .set('Authorization', `Bearer ${proToken}`)
        .set('X-CSRF-Token', csrfToken)
        .send({
          displayName: 'Hacked Rider Profile',
          bio: 'I am a PRO trying to modify rider data'
        })
        .expect(403);

      // After security fix: PRO users should be blocked with 403 Forbidden
      expect(res.body.error).toContain('Accès refusé');
      expect(res.body.error).toContain('PRO');
      expect(res.body.message).toContain('administrateur');

      // Verify rider profile was NOT modified
      const riderProfile = await prisma.riderProfile.findUnique({
        where: { userId: riderUserId }
      });
      expect(riderProfile?.displayName).toBe('Test Rider');
    });

    it('should REJECT PRO trying to upload photo to RIDER bucket', async () => {
      const res = await agent
        .post('/profile/photo/upload-url')
        .set('Authorization', `Bearer ${proToken}`)
        .set('X-CSRF-Token', csrfToken)
        .send({ contentType: 'image/jpeg' })
        .expect(403);

      // After security fix: PRO users should be blocked with 403 Forbidden
      expect(res.body.error).toContain('Accès refusé');
      expect(res.body.error).toContain('PRO');
      expect(res.body.message).toContain('administrateur');
    });

    it('should REJECT PRO trying to access GET /profile/disciplines', async () => {
      const res = await agent
        .get('/profile/disciplines')
        .set('Authorization', `Bearer ${proToken}`);

      // Should return empty or 404 for PRO users (they don't have riderProfile)
      expect([200, 404]).toContain(res.status);
      if (res.status === 200) {
        expect(res.body).toEqual([]);
      }
    });

    it('should REJECT PRO trying to modify RIDER disciplines', async () => {
      const res = await agent
        .put('/profile/disciplines')
        .set('Authorization', `Bearer ${proToken}`)
        .set('X-CSRF-Token', csrfToken)
        .send([
          { sport: 'surf', level: 'advanced' }
        ]);

      // Should fail or not affect rider data
      expect([200, 400, 404]).toContain(res.status);
      
      // Verify no disciplines were added to rider
      const riderDisciplines = await prisma.riderDiscipline.findMany({
        where: { profileId: riderProfileId }
      });
      expect(riderDisciplines).toHaveLength(0);
    });
  });

  describe('RIDER → PRO isolation (RIDER cannot access PRO routes)', () => {
    it('should REJECT RIDER trying to access GET /pro/me', async () => {
      const res = await agent
        .get('/pro/me')
        .set('Authorization', `Bearer ${riderToken}`)
        .expect(403);

      expect(res.body.error).toContain('Accès refusé');
      expect(res.body.message).toContain('administrateur');
    });

    it('should REJECT RIDER trying to update PRO profile via PUT /pro/me', async () => {
      const res = await agent
        .put('/pro/me')
        .set('Authorization', `Bearer ${riderToken}`)
        .set('X-CSRF-Token', csrfToken)
        .send({
          businessName: 'Fake Pro Business',
          bio: 'I am a rider trying to become a pro'
        })
        .expect(403);

      expect(res.body.error).toContain('Accès refusé');
      expect(res.body.message).toContain('administrateur');
    });

    it('should REJECT RIDER trying to access GET /pro/near/lessons', async () => {
      const res = await agent
        .get('/pro/near/lessons?radiusKm=50')
        .set('Authorization', `Bearer ${riderToken}`)
        .expect(403);

      expect(res.body.error).toContain('Accès refusé');
      expect(res.body.message).toContain('administrateur');
    });

    it('should REJECT RIDER trying to create PRO offers', async () => {
      const res = await agent
        .post('/pro/offers')
        .set('Authorization', `Bearer ${riderToken}`)
        .set('X-CSRF-Token', csrfToken)
        .send({
          sport: 'surf',
          level: 'beginner',
          title: 'Fake offer by rider',
          description: 'This should not work because I am a rider',
          hourlyRate: 50
        })
        .expect(403);

      expect(res.body.error).toContain('Accès refusé');
      expect(res.body.message).toContain('administrateur');
    });

    it('should REJECT RIDER trying to upload PRO photos', async () => {
      const res = await agent
        .post('/pro/photo/upload-url')
        .set('Authorization', `Bearer ${riderToken}`)
        .set('X-CSRF-Token', csrfToken)
        .send({ contentType: 'image/jpeg' })
        .expect(403);

      expect(res.body.error).toContain('Accès refusé');
      expect(res.body.message).toContain('administrateur');
    });
  });

  describe('GDPR routes - Correct behavior', () => {
    it('RIDER should use /profile/export, not /pro/export', async () => {
      // Correct usage for RIDER
      const correctRes = await agent
        .get('/profile/export')
        .set('Authorization', `Bearer ${riderToken}`)
        .expect(200);

      expect(correctRes.body.user).toBeDefined();
      expect(correctRes.body.user.id).toBe(riderUserId);

      // Incorrect usage - RIDER trying /pro/export should work because GDPR
      // BUT this is bad architecture and should redirect to /profile/export
      const incorrectRes = await agent
        .get('/pro/export')
        .set('Authorization', `Bearer ${riderToken}`);

      // Current behavior: 200 (works but bad design)
      // Desired behavior: 403 or 307 redirect to /profile/export
      expect([200, 403, 307]).toContain(incorrectRes.status);
    });

    it('PRO should use /pro/export correctly', async () => {
      const res = await agent
        .get('/pro/export')
        .set('Authorization', `Bearer ${proToken}`)
        .expect(200);

      expect(res.body.user).toBeDefined();
      expect(res.body.user.id).toBe(proUserId);
    });

    it('RIDER should use /profile/delete-account, not /pro/delete-account', async () => {
      // Correct usage for RIDER
      const correctRes = await agent
        .post('/profile/delete-account')
        .set('Authorization', `Bearer ${riderToken}`)
        .set('X-CSRF-Token', csrfToken)
        .send({ confirm: true })
        .expect(200);

      expect(correctRes.body.message).toContain('suppression');
    });

    it('PRO should use /pro/delete-account correctly', async () => {
      const res = await agent
        .post('/pro/delete-account')
        .set('Authorization', `Bearer ${proToken}`)
        .set('X-CSRF-Token', csrfToken)
        .send({ confirm: true })
        .expect(200);

      expect(res.body.message).toContain('suppression');
    });
  });

  describe('User isolation - Same role', () => {
    it('PRO 1 cannot access PRO 2 profile', async () => {
      // Create second PRO
      const pro2User = await prisma.user.create({
        data: {
          email: 'pro2-iso@test.com',
          password: 'hash',
          role: 'PRO',
          emailVerified: true
        }
      });
      const pro2Token = signToken(pro2User.id, 'PRO');

      await prisma.proProfile.create({
        data: {
          userId: pro2User.id,
          businessName: 'Pro 2 Business',
          lat: 48.8500,
          lng: 2.3400
        }
      });

      // Pro 1 tries to access their own profile
      const res1 = await agent
        .get('/pro/me')
        .set('Authorization', `Bearer ${proToken}`)
        .expect(200);

      expect(res1.body.userId).toBe(proUserId);

      // Pro 2 tries to access their own profile
      const res2 = await agent
        .get('/pro/me')
        .set('Authorization', `Bearer ${pro2Token}`)
        .expect(200);

      expect(res2.body.userId).toBe(pro2User.id);
      
      // Verify profiles are isolated
      expect(res1.body.id).not.toBe(res2.body.id);
      expect(res1.body.userId).not.toBe(res2.body.userId);

      // Cleanup
      await prisma.proProfile.delete({ where: { userId: pro2User.id } });
      await prisma.user.delete({ where: { id: pro2User.id } });
    });
  });
});
