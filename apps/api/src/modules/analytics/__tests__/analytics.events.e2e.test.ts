import request from 'supertest';
import { clientPrisma as prisma } from '@blobinfini/database';

// IMPORTANT: Set env vars BEFORE importing createApp
// so that analytics.controller constants are initialized with test values
process.env.ANALYTICS_RATE_LIMIT_MAX = '2';
process.env.ANALYTICS_RATE_LIMIT_WINDOW_MS = '60000';

import { createApp } from '../../../index';
import { clearAnalyticsRateLimit } from '../analytics.controller';

const app = createApp();

const CONSENT_HASH = 'a3f0b7c1d9e24b2c8d1f3a5b7c9d1e2f3a5b7c9d1e2f3a5b7c9d1e2f3a5b7c9d';

function ensureSecrets() {
  process.env.JWT_SECRET ||= 'test-jwt-secret';
  process.env.SESSION_SECRET ||= 'test-session-secret';
}

async function cleanup() {
  await prisma.analyticsEvent.deleteMany({});
  await prisma.analyticsDailyAgg.deleteMany({});
  await prisma.userConsent.deleteMany({ where: { userHash: CONSENT_HASH } });
}

describe('Analytics events endpoint', () => {
  beforeAll(async () => {
    ensureSecrets();
    await cleanup();
  });

  beforeEach(() => {
    clearAnalyticsRateLimit();
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it('rejects invalid payloads', async () => {
    const res = await request(app)
      .post('/analytics/events')
      .send({ eventType: 'BLOBOSPHERE_VIEW' })
      .expect(400);

    expect(res.body).toMatchObject({ error: 'Invalid analytics payload' });
  });

  it('rejects unknown event types', async () => {
    const res = await request(app)
      .post('/analytics/events')
      .send({ eventType: 'INVALID_EVENT', consentHash: CONSENT_HASH })
      .expect(400);

    expect(res.body).toMatchObject({ error: 'Invalid analytics payload' });
  });

  it('rejects when consent is missing', async () => {
    const res = await request(app)
      .post('/analytics/events')
      .send({
        eventType: 'BLOBOSPHERE_VIEW',
        consentHash: CONSENT_HASH,
        contentId: 'guide-surf',
      })
      .expect(403);

    expect(res.body).toMatchObject({ error: 'CONSENT_REQUIRED' });
  });

  it('accepts valid payloads with consent', async () => {
    await prisma.userConsent.create({
      data: {
        userHash: CONSENT_HASH,
        consentLevel: 'personalized',
        ad_storage: 'granted',
        ad_user_data: 'granted',
        ad_personalization: 'granted',
        cmpVersion: 'test',
      },
    });

    const res = await request(app)
      .post('/analytics/events')
      .send({
        eventType: 'BLOBOSPHERE_VIEW',
        consentHash: CONSENT_HASH,
        contentId: 'guide-surf',
      })
      .expect(202);

    expect(res.body).toMatchObject({ ok: true });
  });

  it('enforces rate limits', async () => {
    // afterEach resetDb() truncates UserConsent — recreate for this test
    await prisma.userConsent.upsert({
      where: { userHash: CONSENT_HASH },
      update: {},
      create: {
        userHash: CONSENT_HASH,
        consentLevel: 'personalized',
        ad_storage: 'granted',
        ad_user_data: 'granted',
        ad_personalization: 'granted',
        cmpVersion: 'test',
      },
    });

    // Use agent to maintain consistent connection and headers
    const agent = request.agent(app);
    const headers = {
      'x-forwarded-for': '192.168.1.100',
      'user-agent': 'test-agent'
    };

    await agent
      .post('/analytics/events')
      .set(headers)
      .send({
        eventType: 'BLOBOSPHERE_VIEW',
        consentHash: CONSENT_HASH,
        contentId: 'guide-surf',
      })
      .expect(202);

    await agent
      .post('/analytics/events')
      .set(headers)
      .send({
        eventType: 'BLOBOSPHERE_VIEW',
        consentHash: CONSENT_HASH,
        contentId: 'guide-surf',
      })
      .expect(202);

    const res = await agent
      .post('/analytics/events')
      .set(headers)
      .send({
        eventType: 'BLOBOSPHERE_VIEW',
        consentHash: CONSENT_HASH,
        contentId: 'guide-surf',
      })
      .expect(429);

    expect(res.body).toMatchObject({ error: 'ANALYTICS_RATE_LIMIT' });
  });
});
