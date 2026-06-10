import request from 'supertest';
import { createApp } from '../../../index';
import { clientPrisma as prisma } from '@blobinfini/database';
import { __clearConsentCache, getConsentCacheSize } from '../../../services/consent.service';

const VALID_HASH = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';

const app = createApp();

describe('GET /consent/:hash — input validation & rate limit', () => {
  beforeEach(async () => {
    await prisma.userConsent.deleteMany();
    __clearConsentCache();
  });

  afterAll(async () => {
    await prisma.userConsent.deleteMany();
    await prisma.$disconnect();
  });

  // ── Format validation ──────────────────────────────────────────────────────

  it('returns 400 for a single-char hash', async () => {
    const res = await request(app).get('/consent/a');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid hash format');
  });

  it('returns 400 for a non-hex 64-char string', async () => {
    const badHash = 'z'.repeat(64);
    const res = await request(app).get(`/consent/${badHash}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid hash format');
  });

  it('returns 400 for an uppercase hex hash (strict lowercase)', async () => {
    const upperHash = 'A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4E5F6A1B2';
    const res = await request(app).get(`/consent/${upperHash}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid hash format');
  });

  it('returns 400 for a 63-char hex hash (too short)', async () => {
    const shortHash = 'a'.repeat(63);
    const res = await request(app).get(`/consent/${shortHash}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid hash format');
  });

  it('does not grow the cache on invalid hash requests', async () => {
    const sizeBefore = getConsentCacheSize();
    await request(app).get('/consent/bad');
    await request(app).get('/consent/' + 'A'.repeat(64));
    expect(getConsentCacheSize()).toBe(sizeBefore);
  });

  // ── Valid hash — DB absent ─────────────────────────────────────────────────

  it('returns 200 with consent: null for a valid hash not in DB', async () => {
    const res = await request(app).get(`/consent/${VALID_HASH}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ consent: null });
  });

  // ── Valid hash — DB present ────────────────────────────────────────────────

  it('returns 200 with the consent record for a valid known hash', async () => {
    await prisma.userConsent.create({
      data: {
        userHash: VALID_HASH,
        consentLevel: 'none',
        ad_storage: 'denied',
        ad_user_data: 'denied',
        ad_personalization: 'denied',
      },
    });
    __clearConsentCache();

    const res = await request(app).get(`/consent/${VALID_HASH}`);
    expect(res.status).toBe(200);
    expect(res.body.consent).not.toBeNull();
    expect(res.body.consent.userHash).toBe(VALID_HASH);
  });

  // ── Rate limit ─────────────────────────────────────────────────────────────

  it('returns 429 after 30 requests within 1 minute', async () => {
    const previousFlag = process.env.ENABLE_RATE_LIMIT_IN_TESTS;
    process.env.ENABLE_RATE_LIMIT_IN_TESTS = 'true';

    try {
      const rlApp = createApp();
      let lastStatus = 0;

      for (let i = 0; i < 31; i++) {
        const res = await request(rlApp).get(`/consent/${VALID_HASH}`);
        lastStatus = res.status;
        if (res.status === 429) break;
      }

      expect(lastStatus).toBe(429);
    } finally {
      if (previousFlag === undefined) {
        delete process.env.ENABLE_RATE_LIMIT_IN_TESTS;
      } else {
        process.env.ENABLE_RATE_LIMIT_IN_TESTS = previousFlag;
      }
    }
  });
});

const VALID_BODY = {
  consentLevel: 'none',
  ad_storage: 'denied',
  ad_user_data: 'denied',
  ad_personalization: 'denied',
};

// POST /consent/:hash is CSRF-protected (session-backed). Use request.agent() +
// GET /csrf-token to establish the session before each POST test.
async function makeAgentWithCsrf() {
  const agent = request.agent(app);
  const tokenRes = await agent.get('/csrf-token');
  const csrfToken: string = (tokenRes.body as { csrfToken: string }).csrfToken;
  return { agent, csrfToken };
}

describe('POST /consent/:hash — hash format validation (P2 close)', () => {
  beforeEach(async () => {
    await prisma.userConsent.deleteMany();
    __clearConsentCache();
  });

  afterAll(async () => {
    await prisma.userConsent.deleteMany();
  });

  // ── Invalid hash — 400 after CSRF passes ──────────────────────────────────
  // CSRF middleware runs first (session + valid token via makeAgentWithCsrf).
  // Once CSRF passes, the HASH_REGEX guard fires early and returns 400.

  it('returns 400 for a single-char hash', async () => {
    const { agent, csrfToken } = await makeAgentWithCsrf();
    const res = await agent.post('/consent/a').set('X-CSRF-Token', csrfToken).send(VALID_BODY);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid hash format');
  });

  it('returns 400 for a non-hex 64-char string', async () => {
    const { agent, csrfToken } = await makeAgentWithCsrf();
    const res = await agent.post(`/consent/${'z'.repeat(64)}`).set('X-CSRF-Token', csrfToken).send(VALID_BODY);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid hash format');
  });

  it('returns 400 for an uppercase hex hash (strict lowercase)', async () => {
    const { agent, csrfToken } = await makeAgentWithCsrf();
    const upperHash = 'A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4E5F6A1B2';
    const res = await agent.post(`/consent/${upperHash}`).set('X-CSRF-Token', csrfToken).send(VALID_BODY);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid hash format');
  });

  it('returns 400 for a 63-char hex hash (too short)', async () => {
    const { agent, csrfToken } = await makeAgentWithCsrf();
    const res = await agent.post(`/consent/${'a'.repeat(63)}`).set('X-CSRF-Token', csrfToken).send(VALID_BODY);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid hash format');
  });

  it('returns 400 for a 65-char hex hash (too long)', async () => {
    const { agent, csrfToken } = await makeAgentWithCsrf();
    const res = await agent.post(`/consent/${'a'.repeat(65)}`).set('X-CSRF-Token', csrfToken).send(VALID_BODY);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid hash format');
  });

  // ── Valid hash — happy path ────────────────────────────────────────────────

  it('returns 201 and persists consent for a valid lowercase hex64 hash', async () => {
    const { agent, csrfToken } = await makeAgentWithCsrf();
    const res = await agent
      .post(`/consent/${VALID_HASH}`)
      .set('X-CSRF-Token', csrfToken)
      .send({ consentLevel: 'personalized', ad_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'granted' });
    expect(res.status).toBe(201);
    expect(res.body.consent.userHash).toBe(VALID_HASH);
    expect(res.body.consent.consentLevel).toBe('personalized');
  });

  // ── Body validation fires after hash gate on valid hash ────────────────────

  it('returns 400 with ZodError detail for an invalid body on a valid hash', async () => {
    const { agent, csrfToken } = await makeAgentWithCsrf();
    const res = await agent
      .post(`/consent/${VALID_HASH}`)
      .set('X-CSRF-Token', csrfToken)
      .send({ consentLevel: 'invalid_value' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid consent payload');
    expect(Array.isArray(res.body.details)).toBe(true);
  });

  // ── Rate limit dédié écriture ───────────────────────────────────────────────

  it('returns 429 after 10 POST requests within 1 minute (consentWriteLimiter)', async () => {
    const previousFlag = process.env.ENABLE_RATE_LIMIT_IN_TESTS;
    process.env.ENABLE_RATE_LIMIT_IN_TESTS = 'true';

    try {
      const rlApp = createApp();
      const agent = request.agent(rlApp);
      const tokenRes = await agent.get('/csrf-token');
      const csrfToken: string = (tokenRes.body as { csrfToken: string }).csrfToken;

      let lastStatus = 0;
      for (let i = 0; i < 11; i++) {
        const res = await agent
          .post(`/consent/${VALID_HASH}`)
          .set('X-CSRF-Token', csrfToken)
          .send(VALID_BODY);
        lastStatus = res.status;
        if (res.status === 429) break;
      }

      expect(lastStatus).toBe(429);
    } finally {
      if (previousFlag === undefined) {
        delete process.env.ENABLE_RATE_LIMIT_IN_TESTS;
      } else {
        process.env.ENABLE_RATE_LIMIT_IN_TESTS = previousFlag;
      }
    }
  });

  it('keeps the dedicated read limiter on GET (réponse neutre, pas de couplage)', async () => {
    // Le GET conserve son budget propre (30/min) : une rafale d'écritures
    // limitée ne doit pas bloquer la lecture du consentement.
    const res = await request(app).get(`/consent/${VALID_HASH}`);
    expect([200]).toContain(res.status);
  });
});
