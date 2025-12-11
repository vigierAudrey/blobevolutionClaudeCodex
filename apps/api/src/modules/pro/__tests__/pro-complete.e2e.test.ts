import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../../../index';
import { clientPrisma as prisma } from '@blobinfini/database';
import { createTestSession, type TestSession } from '../../../tests/helpers/auth';

const app = createApp();

const ensureSecrets = () => {
  process.env.JWT_SECRET ||= 'test-jwt-secret';
};

const signToken = (userId: string, role: 'RIDER' | 'PRO') => {
  return jwt.sign({ sub: userId, role }, process.env.JWT_SECRET as string, { expiresIn: '1h' });
};

describe('Pro Module - Complete Functional Tests', () => {
  let riderUserId = '';
  let riderToken = '';
  let proUserId = '';
  let proToken = '';
  let proProfileId = '';
  let proSession: TestSession;
  let riderSession: TestSession;

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
        email: { in: ['rider-func@test.com', 'pro-func@test.com'] }
      }
    });

    // Create RIDER user
    const riderUser = await prisma.user.create({
      data: {
        email: 'rider-func@test.com',
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
        displayName: 'Functional Rider',
        lat: 43.4832,
        lng: -1.5586,
        wantsLesson: true,
        lessonSport: 'surf',
        lessonLevel: 'beginner',
        lessonDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
        lessonPlace: 'Biarritz',
        lessonStudentCount: 2
      }
    });

    // Create PRO user
    const proUser = await prisma.user.create({
      data: {
        email: 'pro-func@test.com',
        password: 'hash',
        role: 'PRO',
        emailVerified: true
      }
    });
    proUserId = proUser.id;
    proToken = signToken(proUserId, 'PRO');

    const proProfile = await prisma.proProfile.create({
      data: {
        userId: proUserId,
        businessName: 'Biarritz Surf School',
        bio: 'École de surf professionnelle depuis 2010',
        lat: 43.4920,
        lng: -1.5560,
        radiusKm: 30,
        verified: true,
        emailNotif: true
      }
    });
    proProfileId = proProfile.id;

    proSession = await createTestSession(app);
    riderSession = await createTestSession(app);
  });

  afterAll(async () => {
    await prisma.proOffer.deleteMany({});
    await prisma.proProfile.deleteMany({});
    await prisma.riderProfile.deleteMany({});
    await prisma.user.deleteMany({
      where: {
        email: { in: ['rider-func@test.com', 'pro-func@test.com'] }
      }
    });
  });

  describe('Profile Management', () => {
    describe('GET /pro/me', () => {
      it('should retrieve the pro profile', async () => {
        const res = await request(app)
          .get('/pro/me')
          .set('Authorization', `Bearer ${proToken}`)
          .expect(200);

        expect(res.body.userId).toBe(proUserId);
        expect(res.body.businessName).toBe('Biarritz Surf School');
        expect(res.body.bio).toBe('École de surf professionnelle depuis 2010');
        expect(res.body.lat).toBe(43.4920);
        expect(res.body.lng).toBe(-1.5560);
        expect(res.body.radiusKm).toBe(30);
        expect(res.body.verified).toBe(true);
      });

      it('should auto-create profile if it does not exist', async () => {
        await prisma.proProfile.delete({ where: { userId: proUserId } });

        const res = await request(app)
          .get('/pro/me')
          .set('Authorization', `Bearer ${proToken}`)
          .expect(200);

        expect(res.body.userId).toBe(proUserId);
        expect(res.body.id).toBeDefined();
      });
    });

    describe('PUT /pro/me', () => {
      it('should create/update the full profile', async () => {
        const res = await proSession
          .put('/pro/me')
          .set('Authorization', `Bearer ${proToken}`)
          .send({
            businessName: 'Updated Surf School',
            bio: 'Updated bio with more details',
            emailNotif: false,
            lat: 43.5,
            lng: -1.6,
            radiusKm: 50
          })
          .expect(200);

        expect(res.body.businessName).toBe('Updated Surf School');
        expect(res.body.bio).toBe('Updated bio with more details');
        expect(res.body.emailNotif).toBe(false);
        expect(res.body.lat).toBe(43.5);
        expect(res.body.lng).toBe(-1.6);
        expect(res.body.radiusKm).toBe(50);
      });

      it('should validate input schema', async () => {
        const res = await proSession
          .put('/pro/me')
          .set('Authorization', `Bearer ${proToken}`)
          .send({
            businessName: 'a'.repeat(150), // exceeds max 120
            lat: 100, // exceeds max 90
            radiusKm: 300 // exceeds max 200
          })
          .expect(400);

        expect(res.body.error).toBe('Invalid input');
      });

      it('should handle optional fields', async () => {
        const res = await proSession
          .put('/pro/me')
          .set('Authorization', `Bearer ${proToken}`)
          .send({
            businessName: 'Minimal Update'
          })
          .expect(200);

        expect(res.body.businessName).toBe('Minimal Update');
      });
    });

    describe('PATCH /pro/me', () => {
      it('should partially update the profile', async () => {
        const res = await proSession
          .patch('/pro/me')
          .set('Authorization', `Bearer ${proToken}`)
          .send({
            bio: 'Just updating the bio'
          })
          .expect(200);

        expect(res.body.bio).toBe('Just updating the bio');
        expect(res.body.businessName).toBe('Biarritz Surf School'); // unchanged
      });

      it('should update only location', async () => {
        const res = await proSession
          .patch('/pro/me')
          .set('Authorization', `Bearer ${proToken}`)
          .send({
            lat: 43.6,
            lng: -1.7
          })
          .expect(200);

        expect(res.body.lat).toBe(43.6);
        expect(res.body.lng).toBe(-1.7);
        expect(res.body.bio).toBe('École de surf professionnelle depuis 2010'); // unchanged
      });
    });

    describe('POST /pro/photo/upload-url', () => {
      it('should generate a presigned URL for JPEG upload', async () => {
        const res = await proSession
          .post('/pro/photo/upload-url')
          .set('Authorization', `Bearer ${proToken}`)
          .send({ contentType: 'image/jpeg' })
          .expect(200);

        expect(res.body.uploadUrl).toBeDefined();
        expect(res.body.fileUrl).toBeDefined();
        expect(res.body.fileUrl).toContain('pros/');
        expect(res.body.fileUrl).toContain(proUserId);
        expect(res.body.fileUrl).toMatch(/\.jpeg$/);
      });

      it('should generate a presigned URL for PNG upload', async () => {
        const res = await proSession
          .post('/pro/photo/upload-url')
          .set('Authorization', `Bearer ${proToken}`)
          .send({ contentType: 'image/png' })
          .expect(200);

        expect(res.body.uploadUrl).toBeDefined();
        expect(res.body.fileUrl).toBeDefined();
        expect(res.body.fileUrl).toMatch(/\.png$/);
      });

      it('should generate a presigned URL for WEBP upload', async () => {
        const res = await proSession
          .post('/pro/photo/upload-url')
          .set('Authorization', `Bearer ${proToken}`)
          .send({ contentType: 'image/webp' })
          .expect(200);

        expect(res.body.uploadUrl).toBeDefined();
        expect(res.body.fileUrl).toBeDefined();
        expect(res.body.fileUrl).toMatch(/\.webp$/);
      });

      it('should reject unsupported content types', async () => {
        const res = await proSession
          .post('/pro/photo/upload-url')
          .set('Authorization', `Bearer ${proToken}`)
          .send({ contentType: 'image/gif' })
          .expect(400);

        expect(res.body.error).toBe('Unsupported content type');
      });

      it('should reject non-image content types', async () => {
        const res = await proSession
          .post('/pro/photo/upload-url')
          .set('Authorization', `Bearer ${proToken}`)
          .send({ contentType: 'application/pdf' })
          .expect(400);

        expect(res.body.error).toBe('Unsupported content type');
      });
    });
  });

  describe('Offer Management', () => {
    describe('GET /pro/offers/me', () => {
      it('should return empty array when no offers exist', async () => {
        const res = await request(app)
          .get('/pro/offers/me')
          .set('Authorization', `Bearer ${proToken}`)
          .expect(200);

        expect(res.body.offers).toEqual([]);
      });

      it('should return all offers for the pro', async () => {
        // Create multiple offers
        await prisma.proOffer.createMany({
          data: [
            {
              proProfileId,
              sport: 'surf',
              level: 'beginner',
              title: 'Surf initiation',
              description: 'Cours de surf pour débutants avec moniteur diplômé. Matériel fourni.',
              hourlyRate: 60,
              lat: 43.4920,
              lng: -1.5560,
              isActive: true
            },
            {
              proProfileId,
              sport: 'kitesurf',
              level: 'intermediate',
              title: 'Kitesurf perfectionnement',
              description: 'Perfectionnez votre technique avec des cours personnalisés de kitesurf.',
              hourlyRate: 90,
              lat: 43.4920,
              lng: -1.5560,
              isActive: false
            }
          ]
        });

        const res = await request(app)
          .get('/pro/offers/me')
          .set('Authorization', `Bearer ${proToken}`)
          .expect(200);

        expect(res.body.offers).toHaveLength(2);
        expect(res.body.offers[0].title).toBeDefined();
        expect(res.body.offers[1].title).toBeDefined();
      });
    });

    describe('POST /pro/offers', () => {
      it('should create a new offer for surf', async () => {
        const res = await proSession
          .post('/pro/offers')
          .set('Authorization', `Bearer ${proToken}`)
          .send({
            sport: 'surf',
            level: 'beginner',
            title: 'Cours de surf débutant',
            description: 'Apprenez les bases du surf dans une ambiance conviviale et sécurisée.',
            hourlyRate: 55
          })
          .expect(201);

        const offer = res.body;
        expect(offer.id).toBeDefined();
        expect(offer.sport).toBe('surf');
        expect(offer.level).toBe('beginner');
        expect(offer.title).toBe('Cours de surf débutant');
        expect(Number(offer.hourlyRate)).toBe(55);
        expect(offer.isActive).toBe(true);
        expect(offer.lat).toBe(43.4920);
        expect(offer.lng).toBe(-1.5560);
      });

      it('should create a new offer for kitesurf', async () => {
        const res = await proSession
          .post('/pro/offers')
          .set('Authorization', `Bearer ${proToken}`)
          .send({
            sport: 'kitesurf',
            level: 'advanced',
            title: 'Kitesurf avancé tricks',
            description: 'Maîtrisez les tricks avancés et les sauts en kitesurf avec un coach expert.',
            hourlyRate: 120,
            isActive: false
          })
          .expect(201);

        const offer = res.body;
        expect(offer.sport).toBe('kitesurf');
        expect(offer.level).toBe('advanced');
        expect(offer.isActive).toBe(false);
      });

      it('should validate title length (min 10)', async () => {
        const res = await proSession
          .post('/pro/offers')
          .set('Authorization', `Bearer ${proToken}`)
          .send({
            sport: 'surf',
            level: 'beginner',
            title: 'Short', // too short
            description: 'A'.repeat(60),
            hourlyRate: 50
          })
          .expect(400);

        expect(res.body.error).toBe('Invalid input');
      });

      it('should validate title length (max 200)', async () => {
        const res = await proSession
          .post('/pro/offers')
          .set('Authorization', `Bearer ${proToken}`)
          .send({
            sport: 'surf',
            level: 'beginner',
            title: 'A'.repeat(250), // too long
            description: 'B'.repeat(60),
            hourlyRate: 50
          })
          .expect(400);

        expect(res.body.error).toBe('Invalid input');
      });

      it('should validate description length (min 50)', async () => {
        const res = await proSession
          .post('/pro/offers')
          .set('Authorization', `Bearer ${proToken}`)
          .send({
            sport: 'surf',
            level: 'beginner',
            title: 'Valid title for offer',
            description: 'Too short', // too short
            hourlyRate: 50
          })
          .expect(400);

        expect(res.body.error).toBe('Invalid input');
      });

      it('should validate hourly rate (min 10)', async () => {
        const res = await proSession
          .post('/pro/offers')
          .set('Authorization', `Bearer ${proToken}`)
          .send({
            sport: 'surf',
            level: 'beginner',
            title: 'Valid title for offer',
            description: 'A'.repeat(60),
            hourlyRate: 5 // too low
          })
          .expect(400);

        expect(res.body.error).toBe('Invalid input');
      });

      it('should validate hourly rate (max 200)', async () => {
        const res = await proSession
          .post('/pro/offers')
          .set('Authorization', `Bearer ${proToken}`)
          .send({
            sport: 'surf',
            level: 'beginner',
            title: 'Valid title for offer',
            description: 'A'.repeat(60),
            hourlyRate: 300 // too high
          })
          .expect(400);

        expect(res.body.error).toBe('Invalid input');
      });

      it('should reject invalid sport', async () => {
        const res = await proSession
          .post('/pro/offers')
          .set('Authorization', `Bearer ${proToken}`)
          .send({
            sport: 'skateboarding', // invalid
            level: 'beginner',
            title: 'Valid title for offer',
            description: 'A'.repeat(60),
            hourlyRate: 50
          })
          .expect(400);

        expect(res.body.error).toBe('Invalid input');
      });

      it('should reject invalid level', async () => {
        const res = await proSession
          .post('/pro/offers')
          .set('Authorization', `Bearer ${proToken}`)
          .send({
            sport: 'surf',
            level: 'expert', // invalid
            title: 'Valid title for offer',
            description: 'A'.repeat(60),
            hourlyRate: 50
          })
          .expect(400);

        expect(res.body.error).toBe('Invalid input');
      });
    });

    describe('DELETE /pro/offers/me', () => {
      it('should delete all offers for the pro', async () => {
        // Create offers
        await prisma.proOffer.createMany({
          data: [
            {
              proProfileId,
              sport: 'surf',
              level: 'beginner',
              title: 'Offer 1 to be deleted',
              description: 'A'.repeat(60),
              hourlyRate: 60,
              lat: 43.4920,
              lng: -1.5560,
              isActive: true
            },
            {
              proProfileId,
              sport: 'kitesurf',
              level: 'intermediate',
              title: 'Offer 2 to be deleted',
              description: 'B'.repeat(60),
              hourlyRate: 80,
              lat: 43.4920,
              lng: -1.5560,
              isActive: true
            }
          ]
        });

        await proSession
          .delete('/pro/offers/me')
          .set('Authorization', `Bearer ${proToken}`)
          .expect(204);

        // Verify deletion
        const offers = await prisma.proOffer.findMany({
          where: { proProfileId }
        });
        expect(offers).toHaveLength(0);
      });

      it('should return 0 deleted when no offers exist', async () => {
        const res = await proSession
          .delete('/pro/offers/me')
          .set('Authorization', `Bearer ${proToken}`)
          .expect(404);

        expect(res.body.error).toContain('No offer found');
      });
    });

    describe('PATCH /pro/offers/me/toggle', () => {
      beforeEach(async () => {
        // Create test offers
        await prisma.proOffer.createMany({
          data: [
            {
              proProfileId,
              sport: 'surf',
              level: 'beginner',
              title: 'Active offer',
              description: 'A'.repeat(60),
              hourlyRate: 60,
              lat: 43.4920,
              lng: -1.5560,
              isActive: true
            },
            {
              proProfileId,
              sport: 'kitesurf',
              level: 'intermediate',
              title: 'Inactive offer',
              description: 'B'.repeat(60),
              hourlyRate: 80,
              lat: 43.4920,
              lng: -1.5560,
              isActive: false
            }
          ]
        });
      });

      it('should deactivate all offers', async () => {
        const res = await proSession
          .patch('/pro/offers/me/toggle')
          .set('Authorization', `Bearer ${proToken}`)
          .send({ isActive: false })
          .expect(200);

        expect(res.body.isActive).toBe(false);

        const updated = await prisma.proOffer.findUnique({ where: { id: res.body.id } });
        expect(updated?.isActive).toBe(false);
      });

      it('should activate all offers', async () => {
        await proSession
          .patch('/pro/offers/me/toggle')
          .set('Authorization', `Bearer ${proToken}`)
          .send({ isActive: true })
          .expect(200);

        const res = await proSession
          .patch('/pro/offers/me/toggle')
          .set('Authorization', `Bearer ${proToken}`)
          .send({ isActive: true })
          .expect(200);

        expect(res.body.isActive).toBe(true);

        const updated = await prisma.proOffer.findUnique({ where: { id: res.body.id } });
        expect(updated?.isActive).toBe(true);
      });
    });
  });

  describe('Lesson Candidates Search', () => {
    describe('GET /pro/near/lessons', () => {
      it('should find nearby riders looking for lessons', async () => {
        const res = await request(app)
          .get('/pro/near/lessons?radiusKm=50')
          .set('Authorization', `Bearer ${proToken}`)
          .expect(200);

        expect(res.body.items).toBeDefined();
        expect(Array.isArray(res.body.items)).toBe(true);
        expect(res.body.items.length).toBeGreaterThan(0);

        const candidate = res.body.items[0];
        expect(candidate.displayName).toBe('Functional Rider');
        expect(candidate.lessonSport).toBe('surf');
        expect(candidate.lessonLevel).toBe('beginner');
        expect(candidate.lessonPlace).toBe('Biarritz');
        expect(candidate.distanceKm).toBeLessThan(50);
      });

      it('should not find riders outside the radius', async () => {
        const res = await request(app)
          .get('/pro/near/lessons?radiusKm=1')
          .set('Authorization', `Bearer ${proToken}`)
          .expect(200);

        expect(res.body.items).toHaveLength(0);
      });

      it('should filter by sport', async () => {
        // Create another rider with kitesurf lesson request
        const kitesurfRider = await prisma.user.create({
          data: {
            email: 'kitesurf-rider@test.com',
            password: 'hash',
            role: 'RIDER',
            emailVerified: true
          }
        });

        await prisma.riderProfile.create({
          data: {
            userId: kitesurfRider.id,
            displayName: 'Kitesurf Rider',
            lat: 43.4850,
            lng: -1.5600,
            wantsLesson: true,
            lessonSport: 'kitesurf',
            lessonLevel: 'intermediate',
            lessonDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            lessonPlace: 'Anglet'
          }
        });

        // Search for surf only
        const res = await request(app)
          .get('/pro/near/lessons?radiusKm=50&sport=surf')
          .set('Authorization', `Bearer ${proToken}`)
          .expect(200);

        expect(res.body.items.length).toBeGreaterThan(0);
        expect(res.body.items.every((c: any) => c.lessonSport === 'surf')).toBe(true);

        // Cleanup
        await prisma.riderProfile.delete({ where: { userId: kitesurfRider.id } });
        await prisma.user.delete({ where: { id: kitesurfRider.id } });
      });

      it('should filter by level', async () => {
        const res = await request(app)
          .get('/pro/near/lessons?radiusKm=50&level=beginner')
          .set('Authorization', `Bearer ${proToken}`)
          .expect(200);

        expect(res.body.items.length).toBeGreaterThan(0);
        expect(res.body.items.every((c: any) => c.lessonLevel === 'beginner')).toBe(true);
      });

      it('should apply default radius if not provided', async () => {
        const res = await request(app)
          .get('/pro/near/lessons')
          .set('Authorization', `Bearer ${proToken}`)
          .expect(200);

        expect(res.body.items).toBeDefined();
      });
    });
  });

  describe('Offer Search by Riders', () => {
    beforeEach(async () => {
      // Create offers for searching
      await prisma.proOffer.createMany({
        data: [
          {
            proProfileId,
            sport: 'surf',
            level: 'beginner',
            title: 'Surf for beginners',
            description: 'A'.repeat(60),
            hourlyRate: 60,
            lat: 43.4920,
            lng: -1.5560,
            isActive: true
          },
          {
            proProfileId,
            sport: 'surf',
            level: 'intermediate',
            title: 'Surf intermediate',
            description: 'B'.repeat(60),
            hourlyRate: 75,
            lat: 43.4920,
            lng: -1.5560,
            isActive: true
          },
          {
            proProfileId,
            sport: 'kitesurf',
            level: 'beginner',
            title: 'Kitesurf initiation',
            description: 'C'.repeat(60),
            hourlyRate: 85,
            lat: 43.4920,
            lng: -1.5560,
            isActive: true
          }
        ]
      });
    });

    describe('GET /pro/offers/search', () => {
      it('should find offers matching sport and level', async () => {
        const res = await request(app)
          .get('/pro/offers/search?radiusKm=50&sport=surf&level=beginner')
          .set('Authorization', `Bearer ${riderToken}`)
          .expect(200);

        expect(res.body.offers).toBeDefined();
        expect(res.body.offers.length).toBeGreaterThan(0);
        const offer = res.body.offers[0];
        expect(offer.sport).toBe('surf');
        expect(offer.level).toBe('beginner');
        expect(offer.pro.businessName).toBe('Biarritz Surf School');
      });

      it('should filter by sport only', async () => {
        const res = await request(app)
          .get('/pro/offers/search?radiusKm=50&sport=surf')
          .set('Authorization', `Bearer ${riderToken}`)
          .expect(200);

        expect(res.body.offers.length).toBe(2); // beginner + intermediate
        expect(res.body.offers.every((o: any) => o.sport === 'surf')).toBe(true);
      });

      it('should filter by level only', async () => {
        const res = await request(app)
          .get('/pro/offers/search?radiusKm=50&level=beginner')
          .set('Authorization', `Bearer ${riderToken}`)
          .expect(200);

        expect(res.body.offers.length).toBe(2); // surf + kitesurf
        expect(res.body.offers.every((o: any) => o.level === 'beginner')).toBe(true);
      });

      it('should respect radius filter', async () => {
        const res = await request(app)
          .get('/pro/offers/search?radiusKm=1&sport=surf&level=beginner')
          .set('Authorization', `Bearer ${riderToken}`)
          .expect(200);

        expect(res.body.offers).toHaveLength(0);
      });

      it('should only return active offers', async () => {
        // Deactivate all offers
        await prisma.proOffer.updateMany({
          where: { proProfileId },
          data: { isActive: false }
        });

        const res = await request(app)
          .get('/pro/offers/search?radiusKm=50&sport=surf')
          .set('Authorization', `Bearer ${riderToken}`)
          .expect(200);

        expect(res.body.offers).toHaveLength(0);
      });

      it('should calculate distance correctly', async () => {
        const res = await request(app)
          .get('/pro/offers/search?radiusKm=50&sport=surf&level=beginner')
          .set('Authorization', `Bearer ${riderToken}`)
          .expect(200);

        expect(res.body.offers.length).toBeGreaterThan(0);
        const offer = res.body.offers[0];
        expect(offer.distanceKm).toBeDefined();
        expect(offer.distanceKm).toBeGreaterThan(0);
        expect(offer.distanceKm).toBeLessThan(50);
      });
    });
  });

  describe('GDPR Operations', () => {
    describe('GET /pro/export', () => {
      it('should export all pro data', async () => {
        // Create offer for export test
        await prisma.proOffer.create({
          data: {
            proProfileId,
            sport: 'surf',
            level: 'beginner',
            title: 'Export test offer',
            description: 'A'.repeat(60),
            hourlyRate: 60,
            lat: 43.4920,
            lng: -1.5560,
            isActive: true
          }
        });

        const res = await request(app)
          .get('/pro/export')
          .set('Authorization', `Bearer ${proToken}`)
          .expect(200);

        expect(res.body.user).toBeDefined();
        expect(res.body.user.id).toBe(proUserId);
        expect(res.body.user.email).toBe('pro-func@test.com');
        expect(res.body.profile).toBeDefined();
        expect(res.body.profile.businessName).toBe('Biarritz Surf School');
        expect(Array.isArray(res.body.proOffers)).toBe(true);
        expect(res.body.proOffers.length).toBeGreaterThan(0);
      });

      it('should export rider data', async () => {
        const res = await request(app)
          .get('/pro/export')
          .set('Authorization', `Bearer ${riderToken}`)
          .expect(200);

        expect(res.body.user).toBeDefined();
        expect(res.body.user.id).toBe(riderUserId);
        expect(res.body.profile).toBeDefined();
        expect(res.body.profile.displayName).toBe('Functional Rider');
      });
    });

    describe('POST /pro/delete-account', () => {
      it('should schedule account deletion for pro', async () => {
        const res = await proSession
          .post('/pro/delete-account')
          .set('Authorization', `Bearer ${proToken}`)
          .send({ confirm: true })
          .expect(200);

        expect(res.body.message).toContain('suppression');
        expect(res.body.deletionDate).toBeDefined();

        // Verify deletion is scheduled
        const user = await prisma.user.findUnique({
          where: { id: proUserId }
        });
        expect(user?.deletedAt).toBeDefined();
      });

      it('should require confirmation', async () => {
        const res = await proSession
          .post('/pro/delete-account')
          .set('Authorization', `Bearer ${proToken}`)
          .send({ confirm: false })
          .expect(400);

        expect(res.body.error.toLowerCase()).toContain('confirmation required');
      });
    });

    describe('POST /pro/cancel-deletion', () => {
      it('should cancel scheduled deletion', async () => {
        // Schedule deletion first
        await proSession
          .post('/pro/delete-account')
          .set('Authorization', `Bearer ${proToken}`)
          .send({ confirm: true })
          .expect(200);

        // Cancel it
        const res = await proSession
          .post('/pro/cancel-deletion')
          .set('Authorization', `Bearer ${proToken}`)
          .expect(200);

        expect(res.body.message).toContain('annulée');

        // Verify cancellation
        const user = await prisma.user.findUnique({
          where: { id: proUserId }
        });
        expect(user?.deletedAt).toBeNull();
      });

      it('should return error if no deletion scheduled', async () => {
        const res = await proSession
          .post('/pro/cancel-deletion')
          .set('Authorization', `Bearer ${proToken}`)
          .expect(400);

        expect(res.body.error).toContain('No deletion scheduled');
      });
    });

    describe('GET /pro/deletion-status', () => {
      it('should return deletion status when scheduled', async () => {
        // Schedule deletion
        await proSession
          .post('/pro/delete-account')
          .set('Authorization', `Bearer ${proToken}`)
          .send({ confirm: true })
          .expect(200);

        const res = await request(app)
          .get('/pro/deletion-status')
          .set('Authorization', `Bearer ${proToken}`)
          .expect(200);

        expect(res.body.isScheduled).toBe(true);
        expect(res.body.deletionDate).toBeDefined();
      });

      it('should return no deletion when not scheduled', async () => {
        const res = await request(app)
          .get('/pro/deletion-status')
          .set('Authorization', `Bearer ${proToken}`)
          .expect(200);

        expect(res.body.isScheduled).toBe(false);
        expect(res.body.deletionDate).toBeUndefined();
      });
    });
  });
});
