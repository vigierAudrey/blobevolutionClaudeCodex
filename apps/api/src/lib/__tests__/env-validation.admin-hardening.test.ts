import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { validateProductionEnv } from '../env-validation';

describe('validateProductionEnv admin hardening guards', () => {
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
    process.env.TRUST_PROXY_MODE = 'disabled';
    process.env.PRIMARY_ADMIN_EMAILS = 'security-admin@blobconnect.com';
    delete process.env.AUTH_REQUIRE_2FA;
  };

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  it('production + PRIMARY_ADMIN_EMAILS absent => crash', () => {
    setValidProductionEnv();
    delete process.env.PRIMARY_ADMIN_EMAILS;

    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${String(code)}`);
    }) as never);

    expect(() => validateProductionEnv()).toThrow('process.exit:1');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('production + PRIMARY_ADMIN_EMAILS contains dev+admin@test.com => crash', () => {
    setValidProductionEnv();
    process.env.PRIMARY_ADMIN_EMAILS = 'security-admin@blobconnect.com, dev+admin@test.com';

    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${String(code)}`);
    }) as never);

    expect(() => validateProductionEnv()).toThrow('process.exit:1');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('production + AUTH_REQUIRE_2FA=false => crash', () => {
    setValidProductionEnv();
    process.env.AUTH_REQUIRE_2FA = 'false';

    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${String(code)}`);
    }) as never);

    expect(() => validateProductionEnv()).toThrow('process.exit:1');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('production + LOGINATTEMPT_STORE_PLAINTEXT_EMAIL=true => crash', () => {
    setValidProductionEnv();
    process.env.LOGINATTEMPT_STORE_PLAINTEXT_EMAIL = 'true';

    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${String(code)}`);
    }) as never);

    expect(() => validateProductionEnv()).toThrow('process.exit:1');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
