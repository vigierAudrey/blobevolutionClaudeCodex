import request from 'supertest';
import express from 'express';
import { httpAccessLog } from '../http-access-log';
import { secureLogger } from '../../utils/secure-logger';
import { withHttpLogContext } from '../../observability/log-context';

jest.mock('../../utils/secure-logger', () => ({
  secureLogger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    security: jest.fn(),
    debug: jest.fn(),
  },
}));

const mockInfo = secureLogger.info as jest.Mock;

function buildApp(handler: express.RequestHandler) {
  const app = express();
  app.use(withHttpLogContext);
  app.use((req: express.Request & { requestId?: string }, _res, next) => {
    req.requestId = 'test-req-id-123';
    next();
  });
  app.use(httpAccessLog);
  app.use(handler);
  return app;
}

beforeEach(() => {
  mockInfo.mockClear();
});

describe('httpAccessLog middleware', () => {
  it('logs 200 with method, path, status, duration_ms', async () => {
    const app = buildApp((_req, res) => res.status(200).json({ ok: true }));
    await request(app).get('/some/path').expect(200);

    const accessLog = mockInfo.mock.calls.find(([event]) => event === 'HTTP_ACCESS');
    expect(accessLog).toBeDefined();
    const [, ctx] = accessLog!;
    expect(ctx.method).toBe('GET');
    expect(ctx.path).toBe('/some/path');
    expect(ctx.status).toBe(200);
    expect(typeof ctx.duration_ms).toBe('number');
    expect(ctx.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it('logs 404 responses', async () => {
    const app = buildApp((_req, res) => res.status(404).json({ error: 'Not found' }));
    await request(app).get('/missing').expect(404);

    const accessLog = mockInfo.mock.calls.find(([event]) => event === 'HTTP_ACCESS');
    expect(accessLog).toBeDefined();
    expect(accessLog![1].status).toBe(404);
  });

  it('logs 500 responses', async () => {
    const app = buildApp((_req, res) => res.status(500).json({ error: 'Internal' }));
    await request(app).get('/boom').expect(500);

    const accessLog = mockInfo.mock.calls.find(([event]) => event === 'HTTP_ACCESS');
    expect(accessLog).toBeDefined();
    expect(accessLog![1].status).toBe(500);
  });

  it('does not log query params', async () => {
    const app = buildApp((_req, res) => res.status(200).json({}));
    await request(app).get('/search?token=secret&email=foo@bar.com').expect(200);

    const accessLog = mockInfo.mock.calls.find(([event]) => event === 'HTTP_ACCESS');
    expect(accessLog).toBeDefined();
    const serialized = JSON.stringify(accessLog![1]);
    expect(serialized).not.toContain('secret');
    expect(serialized).not.toContain('foo@bar.com');
    expect(serialized).not.toContain('token');
    // path must not include query string
    expect(accessLog![1].path).toBe('/search');
  });

  it('does not log cookie or Authorization headers', async () => {
    const app = buildApp((_req, res) => res.status(200).json({}));
    await request(app)
      .get('/protected')
      .set('Authorization', 'Bearer supersecrettoken')
      .set('Cookie', 'session=abc123')
      .expect(200);

    const accessLog = mockInfo.mock.calls.find(([event]) => event === 'HTTP_ACCESS');
    expect(accessLog).toBeDefined();
    const serialized = JSON.stringify(accessLog![1]);
    expect(serialized).not.toContain('supersecrettoken');
    expect(serialized).not.toContain('abc123');
    expect(serialized).not.toContain('Authorization');
    expect(serialized).not.toContain('Cookie');
    expect(serialized).not.toContain('cookie');
  });

  it('does not log /health (excluded path)', async () => {
    const app = buildApp((_req, res) => res.status(200).json({ status: 'ok' }));
    // Mount at /health explicitly
    const healthApp = express();
    healthApp.use(withHttpLogContext);
    healthApp.use(httpAccessLog);
    healthApp.get('/health', (_req, res) => res.status(200).json({ status: 'ok' }));

    await request(healthApp).get('/health').expect(200);

    const accessLog = mockInfo.mock.calls.find(([event]) => event === 'HTTP_ACCESS');
    expect(accessLog).toBeUndefined();
  });

  it('includes request_id when set on req', async () => {
    const app = buildApp((_req, res) => res.status(200).json({}));
    await request(app).get('/with-id').expect(200);

    const accessLog = mockInfo.mock.calls.find(([event]) => event === 'HTTP_ACCESS');
    expect(accessLog).toBeDefined();
    expect(accessLog![1].request_id).toBe('test-req-id-123');
  });

  it('does not include actor_ref for anonymous requests', async () => {
    const app = buildApp((_req, res) => res.status(200).json({}));
    await request(app).get('/anon').expect(200);

    const accessLog = mockInfo.mock.calls.find(([event]) => event === 'HTTP_ACCESS');
    expect(accessLog).toBeDefined();
    // anonymous actor_ref is omitted
    expect(accessLog![1].actor_ref).toBeUndefined();
  });
});
