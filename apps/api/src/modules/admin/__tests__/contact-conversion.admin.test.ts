/**
 * Tests API admin — GET /admin/analytics/contact-conversion
 *
 * Valide :
 *   - 401 sans token
 *   - 403 pour un rider ou pro non-admin
 *   - 200 table vide → requests7d=0, contacted7d=0, contactRatePct=null
 *   - 200 fanouts sans contacts → contactRatePct=0
 *   - 200 calcul correct (contacted7d / requests7d)
 *   - 200 ContactRequest avec lessonRequestId=null exclue du numérateur
 *
 * Note : le global afterEach resetDb() de jest.setup.db.ts purge toutes les tables
 * après chaque test. Les fixtures doivent donc être créées en beforeEach.
 */

import request from 'supertest';
import jwt from 'jsonwebtoken';
import { clientPrisma as prisma } from '@blobinfini/database';
import { createApp } from '../../../index';
import { AVAILABLE_PERMISSIONS } from '../permissions';
import { makeLessonRequestId } from '../../../services/lesson-fanout.repository';

type Role = 'RIDER' | 'PRO' | 'ADMIN';

const app = createApp();

const EMAIL_ADMIN = 'conv-admin@test.com';
const EMAIL_RIDER = 'conv-rider@test.com';
const EMAIL_PRO   = 'conv-pro@test.com';

function ensureSecrets() {
  process.env.JWT_SECRET            ||= 'test-jwt-secret';
  process.env.SESSION_SECRET        ||= 'test-session-secret';
  process.env.PRIMARY_ADMIN_EMAILS   = EMAIL_ADMIN;
}

function signToken(userId: string, role: Role) {
  return jwt.sign({ sub: userId, role }, process.env.JWT_SECRET!, { expiresIn: '1h' });
}

async function seedAuth() {
  const [adminUser, riderUser, proUser] = await Promise.all([
    prisma.user.create({
      data: { email: EMAIL_ADMIN, password: 'hash', role: 'ADMIN', emailVerified: true },
    }),
    prisma.user.create({
      data: { email: EMAIL_RIDER, password: 'hash', role: 'RIDER', emailVerified: true },
    }),
    prisma.user.create({
      data: { email: EMAIL_PRO, password: 'hash', role: 'PRO', emailVerified: true },
    }),
  ]);
  await Promise.all([
    prisma.adminProfile.create({
      data: { userId: adminUser.id, permissions: [...AVAILABLE_PERMISSIONS] },
    }),
    prisma.riderProfile.create({ data: { userId: riderUser.id } }),
    prisma.proProfile.create({
      data: { userId: proUser.id, lat: 44.8, lng: -1.2, radiusKm: 20 },
    }),
  ]);
  return {
    adminToken: signToken(adminUser.id, 'ADMIN'),
    riderToken: signToken(riderUser.id, 'RIDER'),
    proToken:   signToken(proUser.id,   'PRO'),
  };
}

beforeAll(() => { ensureSecrets(); });

// ─── AuthN / AuthZ ────────────────────────────────────────────────────────────

describe('GET /admin/analytics/contact-conversion — auth', () => {
  it('returns 401 with no token', async () => {
    await request(app)
      .get('/admin/analytics/contact-conversion')
      .expect(401);
  });

  it('returns 403 for a RIDER', async () => {
    const { riderToken } = await seedAuth();
    await request(app)
      .get('/admin/analytics/contact-conversion')
      .set('Authorization', `Bearer ${riderToken}`)
      .expect(403);
  });

  it('returns 403 for a PRO', async () => {
    const { proToken } = await seedAuth();
    await request(app)
      .get('/admin/analytics/contact-conversion')
      .set('Authorization', `Bearer ${proToken}`)
      .expect(403);
  });
});

// ─── Métriques ────────────────────────────────────────────────────────────────

describe('GET /admin/analytics/contact-conversion — metrics', () => {
  it('returns zero state when tables are empty', async () => {
    const { adminToken } = await seedAuth();
    const res = await request(app)
      .get('/admin/analytics/contact-conversion')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body).toMatchObject({
      requests7d: 0,
      contacted7d: 0,
      contactRatePct: null,
    });
  });

  it('returns contactRatePct=0 when fanouts exist but no contacts', async () => {
    const { adminToken } = await seedAuth();

    const lessonRequestId = makeLessonRequestId('rider-a');
    await prisma.lessonFanout.create({
      data: {
        riderRef: 'ref-a',
        lessonRequestId,
        sport: 'surf',
        prosFound: 3,
        prosNotified: 3,
        failureCount: 0,
      },
    });

    const res = await request(app)
      .get('/admin/analytics/contact-conversion')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.requests7d).toBe(1);
    expect(res.body.contacted7d).toBe(0);
    expect(res.body.contactRatePct).toBe(0);
  });

  it('calculates correct conversion rate when contacts match fanouts', async () => {
    const { adminToken, proToken: _proToken } = await seedAuth();

    // Two distinct lesson requests
    const lrA = makeLessonRequestId('rider-b');
    const lrB = makeLessonRequestId('rider-c');

    await prisma.lessonFanout.createMany({
      data: [
        { riderRef: 'ref-b', lessonRequestId: lrA, sport: 'surf',     prosFound: 2, prosNotified: 2, failureCount: 0 },
        { riderRef: 'ref-c', lessonRequestId: lrB, sport: 'kitesurf', prosFound: 1, prosNotified: 1, failureCount: 0 },
      ],
    });

    // Only lrA received a contact
    const proUser = await prisma.user.create({
      data: { email: 'pro-for-conv@test.com', password: 'hash', role: 'PRO', emailVerified: true },
    });
    const riderUser = await prisma.user.create({
      data: { email: 'rider-for-conv@test.com', password: 'hash', role: 'RIDER', emailVerified: true },
    });
    const conv = await prisma.conversation.create({
      data: {
        members: { create: [{ userId: proUser.id }, { userId: riderUser.id }] },
      },
    });
    await prisma.contactRequest.create({
      data: {
        proUserId: proUser.id,
        conversationId: conv.id,
        lessonRequestId: lrA,
      },
    });

    const res = await request(app)
      .get('/admin/analytics/contact-conversion')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.requests7d).toBe(2);
    expect(res.body.contacted7d).toBe(1);
    expect(res.body.contactRatePct).toBe(50);
  });

  it('excludes ContactRequest with lessonRequestId=null from contacted7d', async () => {
    const { adminToken } = await seedAuth();

    const lr = makeLessonRequestId('rider-d');
    await prisma.lessonFanout.create({
      data: { riderRef: 'ref-d', lessonRequestId: lr, sport: 'surf', prosFound: 1, prosNotified: 1, failureCount: 0 },
    });

    // ContactRequest pre-C1 (no lessonRequestId)
    const proUser = await prisma.user.create({
      data: { email: 'pro-null-lr@test.com', password: 'hash', role: 'PRO', emailVerified: true },
    });
    const riderUser = await prisma.user.create({
      data: { email: 'rider-null-lr@test.com', password: 'hash', role: 'RIDER', emailVerified: true },
    });
    const conv = await prisma.conversation.create({
      data: { members: { create: [{ userId: proUser.id }, { userId: riderUser.id }] } },
    });
    await prisma.contactRequest.create({
      data: {
        proUserId: proUser.id,
        conversationId: conv.id,
        lessonRequestId: null,
      },
    });

    const res = await request(app)
      .get('/admin/analytics/contact-conversion')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.requests7d).toBe(1);
    expect(res.body.contacted7d).toBe(0); // null lessonRequestId excluded
    expect(res.body.contactRatePct).toBe(0);
  });
});
