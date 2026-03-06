import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

type ConnectMode = 'ready' | 'down' | 'manual';

type LoadResult = {
  module: typeof import('../enhanced-rate-limit');
  createdOptions: Array<Record<string, unknown>>;
  executions: Array<{ store: unknown }>;
  next: jest.Mock;
  req: Record<string, unknown>;
  res: Record<string, unknown>;
  resolveConnect?: () => void;
  RedisStoreMock: new (...args: any[]) => unknown;
};

const originalEnv = process.env;

const flushAsync = async () => {
  await Promise.resolve();
  await new Promise<void>((resolve) => setImmediate(resolve));
};

function loadModuleWithRedisMode(mode: ConnectMode, nodeEnv: 'production' | 'development'): LoadResult {
  jest.resetModules();
  process.env = {
    ...originalEnv,
    NODE_ENV: nodeEnv,
  };

  let resolveConnect: (() => void) | undefined;

  const connectPromise =
    mode === 'ready'
      ? Promise.resolve()
      : mode === 'down'
        ? new Promise<void>((_resolve, reject) => {
            setImmediate(() => reject(new Error('redis unavailable')));
          })
        : new Promise<void>((resolve, _reject) => {
            resolveConnect = () => resolve();
          });

  const redisClient = {
    connect: jest.fn(() => connectPromise),
    ping: jest.fn(async () => 'PONG'),
    on: jest.fn(),
    quit: jest.fn(async () => undefined),
    sendCommand: jest.fn(async () => null),
  };

  const createdOptions: Array<Record<string, unknown>> = [];
  const executions: Array<{ store: unknown }> = [];
  const rateLimitMock = jest.fn((options: Record<string, unknown>) => {
    createdOptions.push(options);
    return (_req: unknown, _res: unknown, next: () => void) => {
      executions.push({ store: options.store });
      next();
    };
  });

  class RedisStoreMock {
    options: Record<string, unknown>;
    constructor(options: Record<string, unknown>) {
      this.options = options;
    }
  }

  jest.doMock('express-rate-limit', () => ({
    __esModule: true,
    default: rateLimitMock,
    ipKeyGenerator: (ip: string) => `ip:${ip}`,
  }));
  jest.doMock('rate-limit-redis', () => ({
    __esModule: true,
    default: RedisStoreMock,
  }));
  jest.doMock('redis', () => ({
    __esModule: true,
    createClient: jest.fn(() => redisClient),
  }));
  jest.doMock('../../lib/redisConfig', () => ({
    __esModule: true,
    resolveRedisUrl: () => 'redis://localhost:6379',
  }));

  const module =
    jest.requireActual<typeof import('../enhanced-rate-limit')>('../enhanced-rate-limit');

  return {
    module,
    createdOptions,
    executions,
    next: jest.fn(),
    req: {
      ip: '127.0.0.1',
      path: '/matching/search',
      method: 'POST',
      headers: {},
      socket: { remoteAddress: '127.0.0.1' },
      get: () => '',
      user: { id: 'user-1' },
    },
    res: {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      get: jest.fn(() => null),
    },
    resolveConnect,
    RedisStoreMock,
  };
}

describe('createLazyRateLimiter bootstrap behavior', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('defers request until Redis settles then uses Redis store when ready', async () => {
    const loaded = loadModuleWithRedisMode('manual', 'production');
    const limiter = loaded.module.createLazyRateLimiter('AUTH');

    limiter(loaded.req as any, loaded.res as any, loaded.next as any);
    await flushAsync();

    // Still waiting for Redis init to settle
    expect(loaded.next).not.toHaveBeenCalled();

    loaded.resolveConnect?.();
    await flushAsync();
    await flushAsync();

    expect(loaded.next).toHaveBeenCalledTimes(1);
    const lastExec = loaded.executions[loaded.executions.length - 1];
    expect(lastExec.store).toBeInstanceOf(loaded.RedisStoreMock);
  });

  it('falls back to memory store when Redis is unavailable', async () => {
    const loaded = loadModuleWithRedisMode('down', 'development');
    const limiter = loaded.module.createLazyRateLimiter('AUTH');

    limiter(loaded.req as any, loaded.res as any, loaded.next as any);
    await flushAsync();
    await flushAsync();

    expect(loaded.next).toHaveBeenCalledTimes(1);
    const lastExec = loaded.executions[loaded.executions.length - 1];
    expect(lastExec.store).toBeUndefined();
  });

  it('creates the limiter only once (idempotent after Redis ready)', async () => {
    const loaded = loadModuleWithRedisMode('manual', 'production');
    const limiter = loaded.module.createLazyRateLimiter('SEARCH');

    // First request — deferred
    limiter(loaded.req as any, loaded.res as any, loaded.next as any);

    loaded.resolveConnect?.();
    await flushAsync();
    await flushAsync();

    const countAfterFirst = loaded.createdOptions.length;
    expect(loaded.next).toHaveBeenCalledTimes(1);

    // Second request — Redis already settled, redisLimiter already created
    limiter(loaded.req as any, loaded.res as any, loaded.next as any);
    await flushAsync();

    expect(loaded.next).toHaveBeenCalledTimes(2);
    // No additional rateLimit() call — same limiter instance reused
    expect(loaded.createdOptions.length).toBe(countAfterFirst);
  });
});

describe('createLazyCustomRateLimiter bootstrap behavior', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('defers request until Redis settles then uses Redis store with correct prefix', async () => {
    const loaded = loadModuleWithRedisMode('manual', 'production');
    const options = {
      windowMs: 60_000,
      max: 5,
      standardHeaders: true,
      legacyHeaders: false,
    };
    const limiter = loaded.module.createLazyCustomRateLimiter(options, 'my_endpoint');

    limiter(loaded.req as any, loaded.res as any, loaded.next as any);
    await flushAsync();

    expect(loaded.next).not.toHaveBeenCalled();

    loaded.resolveConnect?.();
    await flushAsync();
    await flushAsync();

    expect(loaded.next).toHaveBeenCalledTimes(1);
    const lastExec = loaded.executions[loaded.executions.length - 1];
    expect(lastExec.store).toBeInstanceOf(loaded.RedisStoreMock);
    // Verify correct prefix was used
    const redisCreatedOptions = loaded.createdOptions.find(
      (o) => o.store instanceof loaded.RedisStoreMock && o.windowMs === 60_000 && o.max === 5,
    );
    expect(redisCreatedOptions).toBeDefined();
    expect((redisCreatedOptions?.store as any).options?.prefix).toBe('rl:my_endpoint:');
  });

  it('falls back to memory store (no store option) when Redis is unavailable', async () => {
    const loaded = loadModuleWithRedisMode('down', 'development');
    const options = { windowMs: 30_000, max: 10, standardHeaders: true, legacyHeaders: false };
    const limiter = loaded.module.createLazyCustomRateLimiter(options, 'consent_write');

    limiter(loaded.req as any, loaded.res as any, loaded.next as any);
    await flushAsync();
    await flushAsync();

    expect(loaded.next).toHaveBeenCalledTimes(1);
    const lastExec = loaded.executions[loaded.executions.length - 1];
    expect(lastExec.store).toBeUndefined();
  });

  it('creates the custom limiter only once (idempotent after Redis ready)', async () => {
    const loaded = loadModuleWithRedisMode('manual', 'production');
    const options = { windowMs: 60_000, max: 20, standardHeaders: true, legacyHeaders: false };
    const limiter = loaded.module.createLazyCustomRateLimiter(options, 'open_conversation');

    limiter(loaded.req as any, loaded.res as any, loaded.next as any);
    loaded.resolveConnect?.();
    await flushAsync();
    await flushAsync();

    const countAfterFirst = loaded.createdOptions.length;
    expect(loaded.next).toHaveBeenCalledTimes(1);

    // Second request — no new rateLimit() call
    limiter(loaded.req as any, loaded.res as any, loaded.next as any);
    await flushAsync();

    expect(loaded.next).toHaveBeenCalledTimes(2);
    expect(loaded.createdOptions.length).toBe(countAfterFirst);
  });
});

describe('Geo rate-limit Redis bootstrap behavior', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('uses Redis store for geo limiter when Redis becomes ready after bootstrap', async () => {
    const loaded = loadModuleWithRedisMode('manual', 'production');
    const limiter = loaded.module.createGeoEndpointLimiter('matching_search', 'GEO_HEAVY_BURST');
    const baselineCalls = loaded.createdOptions.length;

    limiter(loaded.req as any, loaded.res as any, loaded.next as any);
    await flushAsync();

    expect(loaded.next).not.toHaveBeenCalled();
    expect(loaded.createdOptions.length).toBe(baselineCalls);
    expect(loaded.executions).toHaveLength(0);

    loaded.resolveConnect?.();
    await flushAsync();
    await flushAsync();

    expect(loaded.next).toHaveBeenCalledTimes(1);
    expect(loaded.executions[loaded.executions.length - 1].store).toBeInstanceOf(loaded.RedisStoreMock);
  });

  it('falls back to memory store when Redis is unavailable', async () => {
    const loaded = loadModuleWithRedisMode('down', 'development');
    const limiter = loaded.module.createGeoEndpointLimiter('booking_pros_nearby', 'GEO_HEAVY_BURST');

    limiter(loaded.req as any, loaded.res as any, loaded.next as any);
    await flushAsync();
    await flushAsync();

    expect(loaded.next).toHaveBeenCalledTimes(1);
    expect(loaded.executions[loaded.executions.length - 1].store).toBeUndefined();
  });

  it('does not create a fake Redis-backed limiter on memory fallback', async () => {
    const loaded = loadModuleWithRedisMode('down', 'development');
    const limiter = loaded.module.createGeoEndpointLimiter('pro_near_lessons', 'GEO_HEAVY_MINUTE');

    limiter(loaded.req as any, loaded.res as any, loaded.next as any);
    await flushAsync();
    await flushAsync();

    const lastExecution = loaded.executions[loaded.executions.length - 1];
    expect(lastExecution.store).toBeUndefined();
    const geoMinuteOptions = loaded.createdOptions.find(
      (options) => String((options.message as any)?.error ?? '') === 'GEO_HEAVY_MINUTE_RATE_LIMIT_EXCEEDED',
    );
    expect(geoMinuteOptions).toBeDefined();
    expect(geoMinuteOptions?.store).toBeUndefined();
  });
});
