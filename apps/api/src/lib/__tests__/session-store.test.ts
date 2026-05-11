/**
 * Tests unitaires pour buildSessionStore()
 *
 * Règles vérifiées :
 * - test       : MemoryStore (undefined) si Redis absent
 * - prod       : throw si Redis absent
 * - dev        : MemoryStore (undefined) avec warning si Redis absent
 * - RedisStore si Redis disponible (tous modes)
 */

import { secureLogger } from '../../utils/secure-logger';

jest.mock('../../utils/secure-logger', () => ({
  secureLogger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    security: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('../redis-client', () => ({
  getRedisClient: jest.fn(),
}));

jest.mock('connect-redis', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({ __redis: true })),
}));

const { getRedisClient } = require('../redis-client') as { getRedisClient: jest.Mock };
const mockWarn = secureLogger.warn as jest.Mock;
const mockInfo = secureLogger.info as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('buildSessionStore()', () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    Object.defineProperty(process.env, 'NODE_ENV', { value: originalEnv, writable: true });
  });

  it('returns undefined (MemoryStore) in test env without Redis', () => {
    // NODE_ENV=test is the current env
    getRedisClient.mockReturnValue(null);
    const { buildSessionStore } = require('../session-store');
    const store = buildSessionStore();
    expect(store).toBeUndefined();
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it('returns RedisStore when Redis client is available', () => {
    const fakeClient = { fake: true };
    getRedisClient.mockReturnValue(fakeClient);
    jest.resetModules();
    jest.mock('../redis-client', () => ({ getRedisClient: jest.fn().mockReturnValue(fakeClient) }));
    jest.mock('connect-redis', () => ({
      __esModule: true,
      default: jest.fn().mockImplementation(() => ({ __redis: true })),
    }));
    jest.mock('../../utils/secure-logger', () => ({
      secureLogger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), security: jest.fn(), debug: jest.fn() },
    }));

    const { buildSessionStore } = require('../session-store');
    const store = buildSessionStore();
    expect(store).not.toBeUndefined();
    expect(store).toEqual({ __redis: true });
  });

  it('throws in production when Redis is unavailable', () => {
    getRedisClient.mockReturnValue(null);
    // Simulate production
    const origEnv = process.env.NODE_ENV;
    (process.env as NodeJS.ProcessEnv).NODE_ENV = 'production';
    try {
      jest.resetModules();
      jest.mock('../redis-client', () => ({ getRedisClient: jest.fn().mockReturnValue(null) }));
      const { buildSessionStore } = require('../session-store');
      expect(() => buildSessionStore()).toThrow(/SESSION_STORE_REDIS_UNAVAILABLE/);
    } finally {
      (process.env as NodeJS.ProcessEnv).NODE_ENV = origEnv;
    }
  });

  it('warns (not throws) in dev when Redis is unavailable', () => {
    const origEnv = process.env.NODE_ENV;
    (process.env as NodeJS.ProcessEnv).NODE_ENV = 'development';
    try {
      jest.resetModules();
      jest.mock('../redis-client', () => ({ getRedisClient: jest.fn().mockReturnValue(null) }));
      jest.mock('../../utils/secure-logger', () => ({
        secureLogger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), security: jest.fn(), debug: jest.fn() },
      }));
      const { buildSessionStore } = require('../session-store');
      const store = buildSessionStore();
      expect(store).toBeUndefined();
      const { secureLogger: sl } = require('../../utils/secure-logger');
      expect(sl.warn).toHaveBeenCalledWith('SESSION_STORE_MEMORY_FALLBACK', expect.any(Object));
    } finally {
      (process.env as NodeJS.ProcessEnv).NODE_ENV = origEnv;
    }
  });
});
