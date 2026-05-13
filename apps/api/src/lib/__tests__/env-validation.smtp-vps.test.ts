import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { validateProductionEnv } from '../env-validation';

describe('validateProductionEnv — SMTP VPS hardening', () => {
  let originalEnv: NodeJS.ProcessEnv;

  const setValidVpsProductionEnv = () => {
    process.env.NODE_ENV = 'production';
    process.env.APP_ENV = 'vps';
    process.env.REDIS_PASSWORD = 'redis-password-strong-123';
    process.env.TWO_FACTOR_SECRET = 'totp-secret-strong-123';
    process.env.IP_HASH_SECRET = 'ip-hash-secret-strong-unique-123';
    process.env.EMAIL_HASH_SECRET = 'email-hash-secret-strong-unique-456';
    process.env.LOG_ACTOR_SECRET = 'log-actor-secret-strong-123';
    process.env.JWT_SECRET = 'jwt-secret-strong-123';
    process.env.JWT_REFRESH_SECRET = 'jwt-refresh-secret-strong-123';
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.DATABASE_URL = 'postgresql://user:password@postgres:5432/blobinfini';
    process.env.S3_ENDPOINT = 'http://minio:9000';
    process.env.S3_BUCKET = 'my-bucket';
    process.env.S3_ACCESS_KEY_ID = 'prod-access-key';
    process.env.S3_SECRET_ACCESS_KEY = 'prod-secret-key';
    process.env.S3_PUBLIC_URL_BASE = 'https://storage.example.com';
    process.env.S3_PRESIGN_ENDPOINT = 'https://storage.example.com';
    process.env.TRUST_PROXY_MODE = 'ips';
    process.env.TRUSTED_PROXY_IPS = '172.21.0.0/16';
    process.env.PRIMARY_ADMIN_EMAILS = 'security-admin@blobconnect.com';
    process.env.AUTH_REQUIRE_2FA = 'true';
    process.env.ALLOWED_ORIGINS = 'https://app.example.com';
    process.env.SMTP_HOST = 'smtp-relay.brevo.com';
    process.env.SMTP_PORT = '587';
    process.env.SMTP_USER = '7xxxxxx@smtp-brevo.com';
    process.env.SMTP_PASS = 'brevo-smtp-secret';
    process.env.SMTP_FROM = 'no-reply@example.com';
    process.env.SMTP_SECURE = 'false';
    delete process.env.SMTP_ALLOW_NO_AUTH;
    delete process.env.COOKIE_DOMAIN;
  };

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  it('rejects Mailpit as SMTP target in VPS', () => {
    setValidVpsProductionEnv();
    process.env.SMTP_HOST = 'mailpit';

    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${String(code)}`);
    }) as never);

    expect(() => validateProductionEnv()).toThrow('process.exit:1');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('rejects SMTP_ALLOW_NO_AUTH=true in VPS', () => {
    setValidVpsProductionEnv();
    process.env.SMTP_ALLOW_NO_AUTH = 'true';

    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${String(code)}`);
    }) as never);

    expect(() => validateProductionEnv()).toThrow('process.exit:1');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('accepts Brevo SMTP config in VPS', () => {
    setValidVpsProductionEnv();

    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${String(code)}`);
    }) as never);

    expect(() => validateProductionEnv()).not.toThrow();
    expect(exitSpy).not.toHaveBeenCalled();
  });
});
