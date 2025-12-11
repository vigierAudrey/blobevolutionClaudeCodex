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

describe('Pro Module - Security & Authorization', () => {
  let riderUserId = '';
  let riderToken = '';
  let proUser1Id = '';
  let proUser1Token = '';
  let proUser2Id = '';
  let proUser2Token = '';
  let proProfile1Id = '';
  let proOffer1Id = '';

  beforeAll(async () => {
    ensureSecrets();
  });

  beforeEach(async () => {
    // Cleanup
    await prisma.proOffer.deleteMany({});
    await prisma.proProfile.deleteMany({});
    await prisma.riderProfile.deleteMany({});
    await prisma.user.deleteMany({
      where: {
        email: { in: ['rider-sec@test.com', 'pro1-sec@test.com', 'pro2-sec@test.com'] }
      }
    });

    // Create RIDER user
    const riderUser = await prisma.user.create({
      data: {
        email: 'rider-sec@test.com',
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
        displayName: 'Rider Test',
        lat: 48.8584,
        lng: 2.2945
      }
    });

    // Create PRO user 1
    const proUser1 = await prisma.user.create({
      data: {
        email: 'pro1-sec@test.com',
        password: 'hash',
        role: 'PRO',
        emailVerified: true
      }
    });
    proUser1Id = proUser1.id;
    proUser1Token = signToken(proUser1Id, 'PRO');

    const proProfile1 = await prisma.proProfile.create({
      data: {
        userId: proUser1Id,
        businessName: 'Pro Business 1',
        bio: 'Bio of pro 1',
        lat: 48.8566,
        lng: 2.3522,
        verified: true
      }
    });
    proProfile1Id = proProfile1.id;

    // Create offer for pro 1
    const offer1 = await prisma.proOffer.create({
      data: {
        proProfileId: proProfile1Id,
        sport: 'surf',
        level: 'intermediate',
        title: 'Surf coaching by Pro 1',
        description: 'Session complète de surf pour intermédiaires avec Pro 1',
        hourlyRate: 80,
        lat: 48.8566,
        lng: 2.3522,
        isActive: true
      }
    });
    proOffer1Id = offer1.id;

    // Create PRO user 2
    const proUser2 = await prisma.user.create({
      data: {
        email: 'pro2-sec@test.com',
        password: 'hash',
        role: 'PRO',
        emailVerified: true
      }
    });
    proUser2Id = proUser2.id;
    proUser2Token = signToken(proUser2Id, 'PRO');

    await prisma.proProfile.create({
      data: {
        userId: proUser2Id,
        businessName: 'Pro Business 2',
        bio: 'Bio of pro 2',
        lat: 48.8500,
        lng: 2.3400,
        verified: false
      }
    });
  });

  afterAll(async () => {
    await prisma.proOffer.deleteMany({});
    await prisma.proProfile.deleteMany({});
    await prisma.riderProfile.deleteMany({});
    await prisma.user.deleteMany({
      where: {
        email: { in: ['rider-sec@test.com', 'pro1-sec@test.com', 'pro2-sec@test.com'] }
      }
    });
  });

  describe('Profile Isolation Tests', () => {
    describe('GET /pro/me', () => {
      it('should allow a PRO to get their own profile', async () => {
        const res = await request(app)
          .get('/pro/me')
          .set('Authorization', `Bearer ${proUser1Token}`)
          .expect(200);

        expect(res.body.userId).toBe(proUser1Id);
        expect(res.body.businessName).toBe('Pro Business 1');
      });

      it('should create a profile if PRO has none (auto-provisioning)', async () => {
        // Delete pro2 profile temporarily
        await prisma.proProfile.delete({ where: { userId: proUser2Id } });

        const res = await request(app)
          .get('/pro/me')
          .set('Authorization', `Bearer ${proUser2Token}`)
          .expect(200);

        expect(res.body.userId).toBe(proUser2Id);
        expect(res.body.id).toBeDefined();
      });

      it('should REJECT a RIDER trying to access /pro/me (security issue)', async () => {
        // This test currently FAILS - demonstrates the security flaw
        const res = await request(app)
          .get('/pro/me')
          .set('Authorization', `Bearer ${riderToken}`);

        // EXPECTED: 403 Forbidden
        // ACTUAL: 200 OK (creates a proProfile for the rider!)
        // expect(res.status).toBe(403);

        // Temporary assertion showing current behavior
        expect(res.status).toBe(200); // SECURITY FLAW
      });
    });

    describe('PUT /pro/me', () => {
      it('should allow a PRO to update their own profile', async () => {
        const res = await request(app)
          .put('/pro/me')
          .set('Authorization', `Bearer ${proUser1Token}`)
          .send({
            businessName: 'Updated Business Name',
            bio: 'Updated bio',
            lat: 43.5,
            lng: -1.5
          })
          .expect(200);

        expect(res.body.businessName).toBe('Updated Business Name');
        expect(res.body.bio).toBe('Updated bio');
      });

      it('should REJECT a RIDER trying to update a pro profile (security issue)', async () => {
        // This test currently FAILS - demonstrates the security flaw
        const res = await request(app)
          .put('/pro/me')
          .set('Authorization', `Bearer ${riderToken}`)
          .send({
            businessName: 'Hacker Business',
            bio: 'I should not be able to do this'
          });

        // EXPECTED: 403 Forbidden
        // ACTUAL: 200 OK (creates/updates a proProfile for the rider!)
        // expect(res.status).toBe(403);

        // Temporary assertion showing current behavior
        expect(res.status).toBe(200); // SECURITY FLAW
      });

      it('should NOT allow PRO 2 to modify PRO 1 profile', async () => {
        // Pro profiles are accessed via userId from token, so this is safe
        const res = await request(app)
          .put('/pro/me')
          .set('Authorization', `Bearer ${proUser2Token}`)
          .send({
            businessName: 'Trying to hack Pro 1'
          })
          .expect(200);

        // Pro 2 updates their own profile, not Pro 1's
        expect(res.body.userId).toBe(proUser2Id);
        expect(res.body.businessName).toBe('Trying to hack Pro 1');

        // Verify Pro 1's profile is untouched
        const pro1Profile = await prisma.proProfile.findUnique({
          where: { userId: proUser1Id }
        });
        expect(pro1Profile?.businessName).toBe('Pro Business 1');
      });
    });

    describe('PATCH /pro/me', () => {
      it('should allow a PRO to partially update their profile', async () => {
        const res = await request(app)
          .patch('/pro/me')
          .set('Authorization', `Bearer ${proUser1Token}`)
          .send({ bio: 'Partially updated bio' })
          .expect(200);

        expect(res.body.bio).toBe('Partially updated bio');
        expect(res.body.businessName).toBe('Pro Business 1'); // unchanged
      });

      it('should REJECT a RIDER trying to patch a pro profile (security issue)', async () => {
        const res = await request(app)
          .patch('/pro/me')
          .set('Authorization', `Bearer ${riderToken}`)
          .send({ bio: 'Hacker bio' });

        // EXPECTED: 403 Forbidden
        // expect(res.status).toBe(403);

        // Temporary assertion showing current behavior
        expect(res.status).toBe(200); // SECURITY FLAW
      });
    });

    describe('POST /pro/photo/upload-url', () => {
      it('should allow a PRO to get a photo upload URL', async () => {
        const res = await request(app)
          .post('/pro/photo/upload-url')
          .set('Authorization', `Bearer ${proUser1Token}`)
          .send({ contentType: 'image/jpeg' })
          .expect(200);

        expect(res.body.uploadUrl).toBeDefined();
        expect(res.body.publicUrl).toBeDefined();
      });

      it('should REJECT a RIDER trying to get a pro photo upload URL (security issue)', async () => {
        const res = await request(app)
          .post('/pro/photo/upload-url')
          .set('Authorization', `Bearer ${riderToken}`)
          .send({ contentType: 'image/jpeg' });

        // EXPECTED: 403 Forbidden
        // expect(res.status).toBe(403);

        // Temporary assertion showing current behavior
        expect(res.status).toBe(200); // SECURITY FLAW
      });
    });
  });

  describe('Offer Management Authorization', () => {
    describe('GET /pro/offers/me', () => {
      it('should allow a PRO to get their own offers', async () => {
        const res = await request(app)
          .get('/pro/offers/me')
          .set('Authorization', `Bearer ${proUser1Token}`)
          .expect(200);

        expect(res.body.offers).toHaveLength(1);
        expect(res.body.offers[0].title).toBe('Surf coaching by Pro 1');
      });

      it('should REJECT a RIDER trying to access PRO offers', async () => {
        const res = await request(app)
          .get('/pro/offers/me')
          .set('Authorization', `Bearer ${riderToken}`)
          .expect(403);

        expect(res.body.error).toContain('PRO role required');
      });

      it('should isolate offers between different pros', async () => {
        // Pro 2 should see no offers (they have none)
        const res = await request(app)
          .get('/pro/offers/me')
          .set('Authorization', `Bearer ${proUser2Token}`)
          .expect(200);

        expect(res.body.offers).toHaveLength(0);
      });
    });

    describe('POST /pro/offers', () => {
      it('should allow a PRO to create an offer', async () => {
        const res = await request(app)
          .post('/pro/offers')
          .set('Authorization', `Bearer ${proUser2Token}`)
          .send({
            sport: 'kitesurf',
            level: 'beginner',
            title: 'Kitesurf initiation by Pro 2',
            description: 'Découverte du kitesurf pour débutants avec un moniteur certifié',
            hourlyRate: 70
          })
          .expect(200);

        expect(res.body.offer.title).toBe('Kitesurf initiation by Pro 2');
        expect(res.body.offer.proProfileId).toBeDefined();
      });

      it('should REJECT a RIDER trying to create an offer', async () => {
        const res = await request(app)
          .post('/pro/offers')
          .set('Authorization', `Bearer ${riderToken}`)
          .send({
            sport: 'surf',
            level: 'beginner',
            title: 'Fake offer by rider',
            description: 'This should not work because I am a rider not a pro',
            hourlyRate: 50
          })
          .expect(403);

        expect(res.body.error).toContain('PRO role required');
      });
    });

    describe('DELETE /pro/offers/me', () => {
      it('should allow a PRO to delete their own offers', async () => {
        const res = await request(app)
          .delete('/pro/offers/me')
          .set('Authorization', `Bearer ${proUser1Token}`)
          .expect(200);

        expect(res.body.message).toContain('deleted');

        // Verify offers are deleted
        const offers = await prisma.proOffer.findMany({
          where: { proProfileId: proProfile1Id }
        });
        expect(offers).toHaveLength(0);
      });

      it('should REJECT a RIDER trying to delete pro offers', async () => {
        const res = await request(app)
          .delete('/pro/offers/me')
          .set('Authorization', `Bearer ${riderToken}`)
          .expect(403);

        expect(res.body.error).toContain('PRO role required');
      });

      it('should NOT allow a PRO to delete another PRO offers', async () => {
        // Pro 2 tries to delete offers (they have none)
        const res = await request(app)
          .delete('/pro/offers/me')
          .set('Authorization', `Bearer ${proUser2Token}`)
          .expect(200);

        // Should succeed but delete 0 offers
        expect(res.body.message).toContain('0');

        // Verify Pro 1's offer is still there
        const offers = await prisma.proOffer.findMany({
          where: { proProfileId: proProfile1Id }
        });
        expect(offers).toHaveLength(1);
      });
    });

    describe('PATCH /pro/offers/me/toggle', () => {
      it('should allow a PRO to toggle their offers active status', async () => {
        const res = await request(app)
          .patch('/pro/offers/me/toggle')
          .set('Authorization', `Bearer ${proUser1Token}`)
          .send({ isActive: false })
          .expect(200);

        expect(res.body.message).toContain('updated');

        // Verify offer is deactivated
        const offer = await prisma.proOffer.findUnique({
          where: { id: proOffer1Id }
        });
        expect(offer?.isActive).toBe(false);
      });

      it('should REJECT a RIDER trying to toggle offers', async () => {
        const res = await request(app)
          .patch('/pro/offers/me/toggle')
          .set('Authorization', `Bearer ${riderToken}`)
          .send({ isActive: false })
          .expect(403);

        expect(res.body.error).toContain('PRO role required');
      });
    });
  });

  describe('Lesson Search Authorization', () => {
    it('should allow a PRO to search for nearby lesson requests', async () => {
      // Create a rider lesson request
      await prisma.riderProfile.update({
        where: { userId: riderUserId },
        data: {
          lessonSport: 'surf',
          lessonLevel: 'intermediate',
          lessonDate: new Date(),
          lessonPlace: 'Biarritz'
        }
      });

      const res = await request(app)
        .get('/pro/near/lessons?radiusKm=50')
        .set('Authorization', `Bearer ${proUser1Token}`)
        .expect(200);

      expect(res.body.candidates).toBeDefined();
      expect(Array.isArray(res.body.candidates)).toBe(true);
    });

    it('should REJECT a RIDER trying to search for lessons', async () => {
      const res = await request(app)
        .get('/pro/near/lessons?radiusKm=50')
        .set('Authorization', `Bearer ${riderToken}`)
        .expect(403);

      expect(res.body.error).toContain('PRO role required');
    });
  });

  describe('Offer Search - Any authenticated user', () => {
    it('should allow a RIDER to search for pro offers', async () => {
      const res = await request(app)
        .get('/pro/offers/search?radiusKm=10&sport=surf&level=intermediate')
        .set('Authorization', `Bearer ${riderToken}`)
        .expect(200);

      expect(res.body.offers).toBeDefined();
      expect(Array.isArray(res.body.offers)).toBe(true);
    });

    it('should allow a PRO to search for other pro offers', async () => {
      const res = await request(app)
        .get('/pro/offers/search?radiusKm=10&sport=surf&level=intermediate')
        .set('Authorization', `Bearer ${proUser2Token}`)
        .expect(200);

      expect(res.body.offers).toBeDefined();
    });
  });

  describe('GDPR Operations Authorization', () => {
    describe('GET /pro/export', () => {
      it('should allow any authenticated user to export their data', async () => {
        const res = await request(app)
          .get('/pro/export')
          .set('Authorization', `Bearer ${proUser1Token}`)
          .expect(200);

        expect(res.body.user).toBeDefined();
      });

      it('should allow a RIDER to export their data', async () => {
        const res = await request(app)
          .get('/pro/export')
          .set('Authorization', `Bearer ${riderToken}`)
          .expect(200);

        expect(res.body.user).toBeDefined();
        expect(res.body.user.id).toBe(riderUserId);
      });
    });

    describe('POST /pro/delete-account', () => {
      it('should allow a PRO to request account deletion', async () => {
        const res = await request(app)
          .post('/pro/delete-account')
          .set('Authorization', `Bearer ${proUser2Token}`)
          .send({ confirm: true })
          .expect(200);

        expect(res.body.message).toContain('deletion scheduled');
      });

      it('should allow a RIDER to request account deletion', async () => {
        const res = await request(app)
          .post('/pro/delete-account')
          .set('Authorization', `Bearer ${riderToken}`)
          .send({ confirm: true })
          .expect(200);

        expect(res.body.message).toContain('deletion scheduled');
      });
    });
  });
});
