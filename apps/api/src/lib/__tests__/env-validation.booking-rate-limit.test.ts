import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { validateProductionEnv } from '../env-validation';

describe('validateProductionEnv booking request rate limit guard', () => {
  let originalEnv: NodeJS.ProcessEnv;

  const setValidProductionEnv = () => {
    process.env.NODE_ENV = 'production';
    process.env.REDIS_PASSWORD = 'redis-password-strong-123';
    process.env.TWO_FACTOR_SECRET = 'totp-secret-strong-123';
    process.env.IP_HASH_SECRET = 'ip-hash-secret-strong-123';
    process.env.JWT_SECRET = 'jwt-secret-strong-123';
    process.env.JWT_REFRESH_SECRET = 'jwt-refresh-secret-strong-123';
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.DATABASE_URL = 'postgresql://user:password@localhost:5432/blobinfini?sslmode=require';
    process.env.TRUST_PROXY_MODE = 'disabled';
  };

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  it('fails fast when booking request rate limiter is disabled in production', () => {
    setValidProductionEnv();
    process.env.RATE_LIMIT_DISABLED_FOR_BOOKING_REQUESTS = 'true';

    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${String(code)}`);
    }) as never);

    expect(() => validateProductionEnv()).toThrow('process.exit:1');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
