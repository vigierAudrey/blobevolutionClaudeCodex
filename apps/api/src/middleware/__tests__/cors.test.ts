import request from 'supertest';

const ORIGINAL_ENV = { ...process.env };
const STRONG_SESSION_SECRET = 's'.repeat(64);
const STRONG_JWT_SECRET = 'j'.repeat(64);
const STRONG_REFRESH_SECRET = 'r'.repeat(64);

describe('CORS middleware', () => {
  const allowedOrigin = 'https://app.blobinfini.test';
  const blockedOrigin = 'https://evil.example.com';

  beforeEach(() => {
    jest.resetModules();
    process.env.NODE_ENV = 'test';
    process.env.ALLOWED_ORIGINS = allowedOrigin;
    process.env.SESSION_SECRET = STRONG_SESSION_SECRET;
    process.env.JWT_SECRET = STRONG_JWT_SECRET;
    process.env.JWT_REFRESH_SECRET = STRONG_REFRESH_SECRET;
    process.env.CSP_REPORT_ONLY = 'false';
  });

  afterEach(() => {
    jest.resetModules();
    Object.entries(ORIGINAL_ENV).forEach(([key, value]) => {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    });
    Object.keys(process.env).forEach((key) => {
      if (!(key in ORIGINAL_ENV)) {
        delete process.env[key];
      }
    });
  });

  const buildApp = async () => {
    const module = await import('../../index');
    return module.createApp();
  };

  it('allows configured origins and sets the response headers', async () => {
    const app = await buildApp();

    const response = await request(app).get('/health').set('Origin', allowedOrigin);

    expect(response.status).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBe(allowedOrigin);
    expect(response.headers.vary).toContain('Origin');
  });

  it('blocks origins that are not configured', async () => {
    const app = await buildApp();

    const response = await request(app).get('/health').set('Origin', blockedOrigin);

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: 'Origin not allowed' });
  });

  it('handles preflight requests correctly', async () => {
    const app = await buildApp();

    const response = await request(app)
      .options('/health')
      .set('Origin', allowedOrigin)
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'Content-Type,X-Test-Header');

    expect(response.status).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe(allowedOrigin);
    expect(response.headers['access-control-allow-headers']).toBe('Content-Type,X-Test-Header');
  });

  it('emits a strict CSP header with nonces', async () => {
    const app = await buildApp();

    const response = await request(app).get('/health');

    const cspHeader = response.headers['content-security-policy'] ?? response.headers['content-security-policy-report-only'];
    expect(cspHeader).toBeDefined();
    expect(cspHeader).toContain("script-src 'self'");
    expect(cspHeader).toContain("'nonce-");
    expect(cspHeader).not.toContain("'unsafe-inline'");
    expect(cspHeader).not.toContain("'unsafe-eval'");
  });

  it('injects CSP nonces into the Swagger UI HTML', async () => {
    const app = await buildApp();

    const response = await request(app).get('/api/docs/');

    expect(response.status).toBe(200);
    expect(response.text).toContain('nonce="');
    expect(response.text).toContain('<style nonce="');
  });
});
