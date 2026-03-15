import request from 'supertest';
import { clientPrisma as prisma } from '@blobinfini/database';
import { createApp } from '../../../index';
import {
  flushLogTransport,
  resetLogTransportForTests,
  setLogWriterForTests,
} from '../../../observability/log-transport';
import { secureLogger } from '../../../utils/secure-logger';

describe('Security Controller', () => {
  const app = createApp();

  afterEach(async () => {
    setLogWriterForTests(async () => undefined);
    await flushLogTransport(200);
    resetLogTransportForTests();
    setLogWriterForTests(null);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('allows monitor-token access without admin JWT', async () => {
    const previous = process.env.SECURITY_MONITOR_TOKEN;
    process.env.SECURITY_MONITOR_TOKEN = 'monitor-token-test';

    try {
      const response = await request(app)
        .get('/security/health')
        .set('X-Security-Monitor-Token', 'monitor-token-test')
        .expect(200);

      expect(response.body).toHaveProperty('status');
      expect(response.body).toHaveProperty('checks');
    } finally {
      if (previous === undefined) {
        delete process.env.SECURITY_MONITOR_TOKEN;
      } else {
        process.env.SECURITY_MONITOR_TOKEN = previous;
      }
    }
  });

  it('reports UNSAFE when production security configuration is incomplete', async () => {
    const previousEnv = process.env.NODE_ENV;
    const previousOrigins = process.env.ALLOWED_ORIGINS;
    const previousProxies = process.env.TRUSTED_PROXY_IPS;
    const previousVerified = process.env.AUTH_REQUIRE_VERIFIED;
    const previousMonitorToken = process.env.SECURITY_MONITOR_TOKEN;

    process.env.NODE_ENV = 'production';
    process.env.ALLOWED_ORIGINS = '';
    process.env.TRUSTED_PROXY_IPS = '';
    process.env.AUTH_REQUIRE_VERIFIED = 'false';
    process.env.SECURITY_MONITOR_TOKEN = 'monitor-token-test';

    try {
      const response = await request(app)
        .get('/security/health')
        .set('X-Security-Monitor-Token', 'monitor-token-test')
        .expect(200);

      expect(response.body.status).toBe('UNSAFE');
      expect(response.body.checks.config).toBe('fail');
    } finally {
      process.env.NODE_ENV = previousEnv;
      process.env.ALLOWED_ORIGINS = previousOrigins;
      process.env.TRUSTED_PROXY_IPS = previousProxies;
      process.env.AUTH_REQUIRE_VERIFIED = previousVerified;
      process.env.SECURITY_MONITOR_TOKEN = previousMonitorToken;
    }
  });

  it('exposes real transport metrics on /security/observability', async () => {
    let releaseWriter: (() => void) | undefined;
    const writerGate = new Promise<void>((resolve) => {
      releaseWriter = resolve;
    });

    setLogWriterForTests(async () => {
      await writerGate;
    });

    const previous = process.env.SECURITY_MONITOR_TOKEN;
    process.env.SECURITY_MONITOR_TOKEN = 'monitor-token-test';

    try {
      secureLogger.warn('OBSERVABILITY_TEST_PENDING', { marker: 'queued' });
      secureLogger.warn('OBSERVABILITY_TEST_PENDING', { marker: 'queued-2' });
      secureLogger.warn('OBSERVABILITY_TEST_PENDING', { marker: 'queued-3' });

      const response = await request(app)
        .get('/security/observability')
        .set('X-Security-Monitor-Token', 'monitor-token-test')
        .expect(200);

      expect(response.body).toMatchObject({
        status: expect.stringMatching(/^(healthy|degraded|failing)$/),
        pipeline: {
          queued: expect.any(Number),
          sent: expect.any(Number),
          dropped: expect.any(Number),
          failed: expect.any(Number),
          breakerState: expect.stringMatching(/^(closed|open|half-open)$/),
        },
      });
      expect(response.body.pipeline.queued).toBeGreaterThan(0);
    } finally {
      releaseWriter?.();
      if (previous === undefined) {
        delete process.env.SECURITY_MONITOR_TOKEN;
      } else {
        process.env.SECURITY_MONITOR_TOKEN = previous;
      }
    }
  });
});
