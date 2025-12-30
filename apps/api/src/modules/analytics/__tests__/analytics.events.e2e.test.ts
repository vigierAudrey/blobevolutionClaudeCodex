import request from 'supertest';
import { clientPrisma as prisma } from '@blobinfini/database';
import { createApp } from '../../../index';

process.env.ANALYTICS_RATE_LIMIT_MAX = '2';
process.env.ANALYTICS_RATE_LIMIT_WINDOW_MS = '60000';
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

  afterAll(async () => {
    await cleanup();
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
    await request(app)
      .post('/analytics/events')
      .send({
        eventType: 'BLOBOSPHERE_VIEW',
        consentHash: CONSENT_HASH,
        contentId: 'guide-surf',
      })
      .expect(202);

    await request(app)
      .post('/analytics/events')
      .send({
        eventType: 'BLOBOSPHERE_VIEW',
        consentHash: CONSENT_HASH,
        contentId: 'guide-surf',
      })
      .expect(202);

    const res = await request(app)
      .post('/analytics/events')
      .send({
        eventType: 'BLOBOSPHERE_VIEW',
        consentHash: CONSENT_HASH,
        contentId: 'guide-surf',
      })
      .expect(429);

    expect(res.body).toMatchObject({ error: 'ANALYTICS_RATE_LIMIT' });
  });
});
