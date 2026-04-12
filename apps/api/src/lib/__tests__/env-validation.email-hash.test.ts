/**
 * Tests env-validation — EMAIL_HASH_SECRET (LOT 3)
 *
 * Couvre :
 *   - Absent en production → process.exit(1)
 *   - Valeur insecure default → process.exit(1)
 *   - EMAIL_HASH_SECRET === IP_HASH_SECRET → process.exit(1) (isolation)
 *   - Cas valide : passe sans erreur
 */
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { validateProductionEnv } from '../env-validation';

describe('validateProductionEnv — EMAIL_HASH_SECRET', () => {
  let originalEnv: NodeJS.ProcessEnv;

  const setValidProductionEnv = () => {
    process.env.NODE_ENV = 'production';
    process.env.REDIS_PASSWORD = 'redis-password-strong-123';
    process.env.TWO_FACTOR_SECRET = 'totp-secret-strong-123';
    process.env.IP_HASH_SECRET = 'ip-hash-secret-strong-unique-123';
    process.env.EMAIL_HASH_SECRET = 'email-hash-secret-strong-unique-456';
    process.env.LOG_ACTOR_SECRET = 'log-actor-secret-strong-123';
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

  it('EMAIL_HASH_SECRET absent => process.exit(1)', () => {
    setValidProductionEnv();
    delete process.env.EMAIL_HASH_SECRET;

    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${String(code)}`);
    }) as never);

    expect(() => validateProductionEnv()).toThrow('process.exit:1');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('EMAIL_HASH_SECRET = valeur insecure default => process.exit(1)', () => {
    setValidProductionEnv();
    process.env.EMAIL_HASH_SECRET = 'change-me-strong-email-hash-secret-production-min-32-chars';

    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${String(code)}`);
    }) as never);

    expect(() => validateProductionEnv()).toThrow('process.exit:1');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('EMAIL_HASH_SECRET whitespace-only => process.exit(1)', () => {
    setValidProductionEnv();
    process.env.EMAIL_HASH_SECRET = '   ';

    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${String(code)}`);
    }) as never);

    expect(() => validateProductionEnv()).toThrow('process.exit:1');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('EMAIL_HASH_SECRET === IP_HASH_SECRET => process.exit(1) (isolation)', () => {
    setValidProductionEnv();
    // Same value for both = forbidden
    process.env.EMAIL_HASH_SECRET = process.env.IP_HASH_SECRET!;

    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${String(code)}`);
    }) as never);

    expect(() => validateProductionEnv()).toThrow('process.exit:1');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('EMAIL_HASH_SECRET valide et distinct => pas de crash', () => {
    setValidProductionEnv();
    // Valid: different from IP_HASH_SECRET, not an insecure default

    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${String(code)}`);
    }) as never);

    expect(() => validateProductionEnv()).not.toThrow();
    expect(exitSpy).not.toHaveBeenCalled();
  });
});
