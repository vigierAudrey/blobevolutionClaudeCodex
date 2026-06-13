/**
 * Tests unitaires des primitives de healthcheck — déterministes, sans réseau ni DB.
 */
import {
  buildLiveness,
  buildReadiness,
  resolveOverall,
  checkStorage,
  checkRedis,
  type ReadinessChecks,
} from '../health.checks';

// Mock du cache service pour piloter le check Redis sans Redis réel.
jest.mock('../../../services/cache.service', () => ({
  cacheService: {
    healthCheck: jest.fn(),
  },
}));
import { cacheService } from '../../../services/cache.service';
const mockedHealthCheck = cacheService.healthCheck as jest.Mock;

describe('resolveOverall', () => {
  const base: ReadinessChecks = { database: 'ok', redis: 'ok', storage: 'ok' };

  it('ok quand tout est ok', () => {
    expect(resolveOverall(base)).toBe('ok');
  });

  it('critical dès que la DB est critical', () => {
    expect(resolveOverall({ ...base, database: 'critical' })).toBe('critical');
  });

  it('degraded si la DB est degraded', () => {
    expect(resolveOverall({ ...base, database: 'degraded' })).toBe('degraded');
  });

  it('degraded si Redis est en panne mais la DB est ok', () => {
    expect(resolveOverall({ ...base, redis: 'degraded' })).toBe('degraded');
  });

  it('degraded si le storage est en panne mais la DB est ok', () => {
    expect(resolveOverall({ ...base, storage: 'degraded' })).toBe('degraded');
  });

  it('ignore not_configured (reste ok)', () => {
    expect(resolveOverall({ database: 'ok', redis: 'not_configured', storage: 'not_configured' })).toBe('ok');
  });

  it('priorise critical sur degraded', () => {
    expect(resolveOverall({ database: 'critical', redis: 'degraded', storage: 'degraded' })).toBe('critical');
  });
});

describe('buildLiveness', () => {
  it('retourne un payload stable sans dépendance', () => {
    const res = buildLiveness();
    expect(res.status).toBe('ok');
    expect(res.service).toBe('api');
    expect(typeof res.uptimeSeconds).toBe('number');
    expect(res.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(() => new Date(res.timestamp).toISOString()).not.toThrow();
    expect(res.timestamp).toBe(new Date(res.timestamp).toISOString());
  });
});

describe('buildReadiness (deps injectées)', () => {
  it('compose les statuts et calcule le verdict global', async () => {
    const res = await buildReadiness({
      database: async () => 'ok',
      redis: async () => 'degraded',
      storage: async () => 'not_configured',
    });
    expect(res.checks).toEqual({ database: 'ok', redis: 'degraded', storage: 'not_configured' });
    expect(res.status).toBe('degraded');
    expect(res.timestamp).toBe(new Date(res.timestamp).toISOString());
  });

  it('verdict critical si la DB est down', async () => {
    const res = await buildReadiness({
      database: async () => 'critical',
      redis: async () => 'ok',
      storage: async () => 'ok',
    });
    expect(res.status).toBe('critical');
  });

  it("n'expose QUE les clés de statut attendues (anti-fuite)", async () => {
    const res = await buildReadiness({
      database: async () => 'ok',
      redis: async () => 'ok',
      storage: async () => 'ok',
    });
    expect(Object.keys(res).sort()).toEqual(['checks', 'status', 'timestamp']);
    expect(Object.keys(res.checks).sort()).toEqual(['database', 'redis', 'storage']);
  });
});

describe('checkStorage', () => {
  const original = process.env.S3_BUCKET;
  afterEach(() => {
    if (original === undefined) delete process.env.S3_BUCKET;
    else process.env.S3_BUCKET = original;
  });

  it('not_configured sans bucket', async () => {
    delete process.env.S3_BUCKET;
    await expect(checkStorage(50)).resolves.toBe('not_configured');
  });

  it('ok en test quand un bucket est configuré (pas d\'appel réseau)', async () => {
    process.env.S3_BUCKET = 'test-bucket';
    await expect(checkStorage(50)).resolves.toBe('ok');
  });
});

describe('checkRedis — timeout borné', () => {
  const originalUrl = process.env.REDIS_URL;
  const originalDocker = process.env.DOCKER;

  afterEach(() => {
    mockedHealthCheck.mockReset();
    if (originalUrl === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = originalUrl;
    if (originalDocker === undefined) delete process.env.DOCKER;
    else process.env.DOCKER = originalDocker;
  });

  it('ok quand le ping réussit', async () => {
    mockedHealthCheck.mockResolvedValue({ status: 'healthy', latency: 1 });
    await expect(checkRedis(200)).resolves.toBe('ok');
  });

  it('degraded quand le ping échoue (client présent)', async () => {
    mockedHealthCheck.mockResolvedValue({ status: 'error' });
    await expect(checkRedis(200)).resolves.toBe('degraded');
  });

  it('not_configured si non attendu et disabled', async () => {
    delete process.env.REDIS_URL;
    delete process.env.DOCKER;
    mockedHealthCheck.mockResolvedValue({ status: 'disabled' });
    await expect(checkRedis(200)).resolves.toBe('not_configured');
  });

  it('retombe sur le fallback si la dépendance dépasse le timeout', async () => {
    process.env.REDIS_URL = 'redis://localhost:6379';
    // healthCheck qui ne résout jamais → doit retomber sur le fallback (degraded car attendu)
    mockedHealthCheck.mockImplementation(() => new Promise(() => {}));
    const start = Date.now();
    await expect(checkRedis(60)).resolves.toBe('degraded');
    expect(Date.now() - start).toBeLessThan(1000);
  });
});
