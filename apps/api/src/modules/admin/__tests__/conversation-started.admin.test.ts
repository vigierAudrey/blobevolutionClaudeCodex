/**
 * Tests API admin — GET /admin/analytics/conversations (C21)
 *
 * Conversation démarrée = ContactRequest ACCEPTED + premier Message réel
 * après l'acceptation. Les messages blancs et les messages antérieurs à la
 * mise en relation ne comptent pas.
 */

import request from 'supertest';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { clientPrisma as prisma } from '@blobinfini/database';
import { createApp } from '../../../index';
import { AVAILABLE_PERMISSIONS } from '../permissions';

type Role = 'RIDER' | 'PRO' | 'ADMIN';

const app = createApp();

const EMAIL_ADMIN = 'conversation-analytics-admin@test.com';
const EMAIL_RIDER = 'conversation-analytics-rider@test.com';
const EMAIL_PRO = 'conversation-analytics-pro@test.com';

function ensureSecrets() {
  process.env.JWT_SECRET ||= 'test-jwt-secret';
  process.env.SESSION_SECRET ||= 'test-session-secret';
  process.env.PRIMARY_ADMIN_EMAILS = EMAIL_ADMIN;
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
    prisma.proProfile.create({ data: { userId: proUser.id, lat: 44.8, lng: -1.2, radiusKm: 20 } }),
  ]);
  return {
    adminToken: signToken(adminUser.id, 'ADMIN'),
    riderToken: signToken(riderUser.id, 'RIDER'),
    proToken: signToken(proUser.id, 'PRO'),
  };
}

async function seedAcceptedRequest(options: {
  messageContent?: string;
  messageBeforeAcceptance?: boolean;
  extraMessages?: number;
  sport?: string;
  systemOnly?: boolean;
}) {
  const proUser = await prisma.user.create({
    data: { email: `conv-start-pro-${randomUUID()}@test.com`, password: 'hash', role: 'PRO', emailVerified: true },
  });
  const riderUser = await prisma.user.create({
    data: { email: `conv-start-rider-${randomUUID()}@test.com`, password: 'hash', role: 'RIDER', emailVerified: true },
  });
  const conversation = await prisma.conversation.create({
    data: {
      type: 'RIDER_TO_PRO',
      members: { create: [{ userId: proUser.id }, { userId: riderUser.id }] },
    },
  });

  const lessonRequestId = `lr-${randomUUID().slice(0, 8)}`;
  await prisma.lessonFanout.create({
    data: {
      riderRef: `ref-${lessonRequestId}`,
      lessonRequestId,
      sport: options.sport ?? 'surf',
      prosFound: 1,
      prosNotified: 1,
      failureCount: 0,
    },
  });

  const contactRequest = await prisma.contactRequest.create({
    data: {
      proUserId: proUser.id,
      conversationId: conversation.id,
      lessonRequestId,
      status: 'ACCEPTED',
    },
  });

  const acceptedAt = new Date(Date.now() - 60_000);
  await prisma.contactRequestResponse.create({
    data: {
      contactRequestId: contactRequest.id,
      riderUserId: riderUser.id,
      response: 'ACCEPT',
      createdAt: acceptedAt,
    },
  });

  if (options.messageContent !== undefined) {
    const messageAt = new Date(
      acceptedAt.getTime() + (options.messageBeforeAcceptance ? -1000 : 1000),
    );
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        senderId: riderUser.id,
        type: 'TEXT',
        content: options.messageContent,
        meta: options.systemOnly ? { kind: 'SYSTEM' } : undefined,
        createdAt: messageAt,
      },
    });
  }

  for (let index = 0; index < (options.extraMessages ?? 0); index += 1) {
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        senderId: proUser.id,
        type: 'TEXT',
        content: `extra-${index}`,
        createdAt: new Date(acceptedAt.getTime() + 2000 + index),
      },
    });
  }
}

beforeAll(() => {
  ensureSecrets();
});

describe('GET /admin/analytics/conversations — auth', () => {
  it('returns 401 with no token', async () => {
    await request(app).get('/admin/analytics/conversations').expect(401);
  });

  it('returns 403 for non-admin users', async () => {
    const { riderToken, proToken } = await seedAuth();
    await request(app).get('/admin/analytics/conversations').set('Authorization', `Bearer ${riderToken}`).expect(403);
    await request(app).get('/admin/analytics/conversations').set('Authorization', `Bearer ${proToken}`).expect(403);
  });

  it('returns 400 for an unbounded window', async () => {
    const { adminToken } = await seedAuth();
    await request(app)
      .get('/admin/analytics/conversations?windowDays=365')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);
  });
});

describe('GET /admin/analytics/conversations — metrics', () => {
  it('returns zero state when there is no accepted relation', async () => {
    const { adminToken } = await seedAuth();
    const res = await request(app)
      .get('/admin/analytics/conversations')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body).toMatchObject({
      windowDays: 7,
      connectedContactsCount: 0,
      conversationsStartedCount: 0,
      conversationStartRate: null,
      bySport: [],
      timeline: [],
    });
  });

  it('does not count accepted relations without a real post-acceptance message', async () => {
    const { adminToken } = await seedAuth();
    await seedAcceptedRequest({});
    await seedAcceptedRequest({ messageContent: '   ' });
    await seedAcceptedRequest({ messageContent: 'Avant acceptation', messageBeforeAcceptance: true });
    await seedAcceptedRequest({ messageContent: 'Invitation système', systemOnly: true });

    const res = await request(app)
      .get('/admin/analytics/conversations')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.connectedContactsCount).toBe(4);
    expect(res.body.conversationsStartedCount).toBe(0);
    expect(res.body.conversationStartRate).toBe(0);
  });

  it('counts a real first message once even when several messages exist', async () => {
    const { adminToken } = await seedAuth();
    await seedAcceptedRequest({ messageContent: 'Bonjour après acceptation', extraMessages: 2, sport: 'kitesurf' });

    const res = await request(app)
      .get('/admin/analytics/conversations')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.connectedContactsCount).toBe(1);
    expect(res.body.conversationsStartedCount).toBe(1);
    expect(res.body.conversationStartRate).toBe(100);
    expect(res.body.bySport).toEqual([
      {
        sport: 'kitesurf',
        connectedContactsCount: 1,
        conversationsStartedCount: 1,
        conversationStartRate: 100,
      },
    ]);
    expect(res.body.timeline).toHaveLength(1);
    expect(res.body.timeline[0].conversationsStartedCount).toBe(1);
  });
});
