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
    process.env.S3_ENDPOINT = 'https://s3.example.com';
    process.env.S3_BUCKET = 'my-bucket';
    process.env.S3_ACCESS_KEY_ID = 'prod-access-key';
    process.env.S3_SECRET_ACCESS_KEY = 'prod-secret-key';
    process.env.S3_PUBLIC_URL_BASE = 'https://storage.example.com';
    process.env.S3_PRESIGN_ENDPOINT = 'https://presign.example.com';
    process.env.COOKIE_DOMAIN = '.example.com';
    process.env.PRIMARY_ADMIN_EMAILS = 'security-admin@blobconnect.com';
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

  // P2-NEW-5: DATABASE_URL SSL must be a hard blocker in production
  it('[P2-NEW-5] fails fast when DATABASE_URL lacks sslmode=require', () => {
    setValidProductionEnv();
    process.env.DATABASE_URL = 'postgresql://user:password@localhost:5432/blobinfini';

    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${String(code)}`);
    }) as never);

    expect(() => validateProductionEnv()).toThrow('process.exit:1');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('[P2-NEW-5] accepts sslmode=verify-full as valid SSL mode', () => {
    setValidProductionEnv();
    process.env.DATABASE_URL = 'postgresql://user:password@host:5432/db?sslmode=verify-full';

    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${String(code)}`);
    }) as never);

    expect(() => validateProductionEnv()).not.toThrow();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('[P2-NEW-5] passes when DATABASE_URL contains sslmode=require', () => {
    setValidProductionEnv();
    // sslmode=require already set by setValidProductionEnv, confirm no exit
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${String(code)}`);
    }) as never);

    expect(() => validateProductionEnv()).not.toThrow();
    expect(exitSpy).not.toHaveBeenCalled();
  });
});
