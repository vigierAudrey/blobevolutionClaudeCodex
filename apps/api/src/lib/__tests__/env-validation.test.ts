import { validateProductionEnv } from '../env-validation';
import { resetTrustedProxiesCache } from '../client-ip';

describe('validateProductionEnv', () => {
  const ORIGINAL_ENV = process.env;
  let envSnapshot: Record<string, string | undefined> = {};

  const buildValidEnv = (): NodeJS.ProcessEnv => ({
    NODE_ENV: 'production',
    TRUST_PROXY_MODE: 'ips',
    ALLOWED_ORIGINS: 'https://example.com',
    TRUSTED_PROXY_IPS: '10.0.0.1',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/db?sslmode=require',
    REDIS_URL: 'redis://:redis-strong-password-123456@localhost:6379',
    REDIS_PASSWORD: 'redis-strong-password-123456',
    TWO_FACTOR_SECRET: 'super-strong-two-factor-secret-32-chars!!',
    IP_HASH_SECRET: 'super-strong-ip-hash-secret-32-chars!!',
    JWT_SECRET: 'jwt-secret-strong-1234567890123456',
    JWT_REFRESH_SECRET: 'jwt-refresh-secret-strong-1234567890',
  });

  const mockProcessExit = () =>
    jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${code}`);
    }) as (code?: number) => never);

  const collectConsoleErrors = (errorSpy: jest.SpyInstance) =>
    errorSpy.mock.calls.flat().join(' ');

  const expectNoLeak = (output: string, secrets: string[]) => {
    secrets.forEach((secret) => {
      expect(output).not.toContain(secret);
    });
  };

  beforeEach(() => {
    const env = buildValidEnv();
    envSnapshot = {};
    Object.keys(env).forEach((key) => {
      envSnapshot[key] = process.env[key];
    });
    Object.assign(ORIGINAL_ENV, env);
    resetTrustedProxiesCache();
  });

  afterEach(() => {
    Object.keys(envSnapshot).forEach((key) => {
      const value = envSnapshot[key];
      if (value === undefined) {
        delete ORIGINAL_ENV[key];
      } else {
        ORIGINAL_ENV[key] = value;
      }
    });
    envSnapshot = {};
    jest.restoreAllMocks();
  });

  it('fails when ALLOWED_ORIGINS is missing', () => {
    process.env.ALLOWED_ORIGINS = '';
    const exitSpy = mockProcessExit();
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(() => validateProductionEnv()).toThrow('process.exit:1');
    expect(exitSpy).toHaveBeenCalledWith(1);
    const output = collectConsoleErrors(errorSpy);
    expect(output).toContain('ALLOWED_ORIGINS');
  });

  it('fails when TRUSTED_PROXY_IPS is missing', () => {
    process.env.TRUSTED_PROXY_IPS = '';
    resetTrustedProxiesCache();
    const exitSpy = mockProcessExit();
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(() => validateProductionEnv()).toThrow('process.exit:1');
    expect(exitSpy).toHaveBeenCalledWith(1);
    const output = collectConsoleErrors(errorSpy);
    expect(output).toContain('TRUSTED_PROXY_IPS');
  });

  it('fails when DATABASE_URL lacks sslmode=require', () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';
    const exitSpy = mockProcessExit();
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(() => validateProductionEnv()).toThrow('process.exit:1');
    expect(exitSpy).toHaveBeenCalledWith(1);
    const output = collectConsoleErrors(errorSpy);
    expect(output).toContain('sslmode=require');
  });

  it('fails when REDIS_PASSWORD is default and does not leak it', () => {
    process.env.REDIS_URL = 'redis://:change-me-strong@localhost:6379';
    process.env.REDIS_PASSWORD = 'change-me-strong';
    const exitSpy = mockProcessExit();
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(() => validateProductionEnv()).toThrow('process.exit:1');
    expect(exitSpy).toHaveBeenCalledWith(1);
    const output = collectConsoleErrors(errorSpy);
    expect(output).toContain('Redis password is set to an insecure default value');
    expectNoLeak(output, ['change-me-strong']);
  });

  it('fails when TWO_FACTOR_SECRET is shorter than 32 chars and does not leak it', () => {
    process.env.TWO_FACTOR_SECRET = 'short-secret';
    const exitSpy = mockProcessExit();
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(() => validateProductionEnv()).toThrow('process.exit:1');
    expect(exitSpy).toHaveBeenCalledWith(1);
    const output = collectConsoleErrors(errorSpy);
    expect(output).toContain('TWO_FACTOR_SECRET must be at least 32 characters long');
    expect(output).not.toContain('current length');
    expectNoLeak(output, ['short-secret']);
  });

  it('fails when IP_HASH_SECRET is shorter than 32 chars', () => {
    process.env.IP_HASH_SECRET = 'short-secret';
    const exitSpy = mockProcessExit();
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(() => validateProductionEnv()).toThrow('process.exit:1');
    expect(exitSpy).toHaveBeenCalledWith(1);
    const output = collectConsoleErrors(errorSpy);
    expect(output).toContain('IP_HASH_SECRET must be at least 32 characters long');
    expectNoLeak(output, ['short-secret']);
  });

  it('fails when JWT secrets are shorter than 32 chars', () => {
    process.env.JWT_SECRET = 'short-jwt';
    process.env.JWT_REFRESH_SECRET = 'short-refresh';
    const exitSpy = mockProcessExit();
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(() => validateProductionEnv()).toThrow('process.exit:1');
    expect(exitSpy).toHaveBeenCalledWith(1);
    const output = collectConsoleErrors(errorSpy);
    expect(output).toContain('JWT_SECRET must be at least 32 characters long');
    expect(output).toContain('JWT_REFRESH_SECRET must be at least 32 characters long');
    expectNoLeak(output, ['short-jwt', 'short-refresh']);
  });

  it('fails when JWT_SECRET is default and does not leak it', () => {
    process.env.JWT_SECRET = 'please-change-in-dev';
    const exitSpy = mockProcessExit();
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(() => validateProductionEnv()).toThrow('process.exit:1');
    expect(exitSpy).toHaveBeenCalledWith(1);
    const output = collectConsoleErrors(errorSpy);
    expect(output).toContain('JWT_SECRET is set to an insecure default value');
    expectNoLeak(output, ['please-change-in-dev']);
  });

  it('fails when Redis password is missing in URL and env', () => {
    process.env.REDIS_URL = 'redis://localhost:6379';
    delete process.env.REDIS_PASSWORD;
    const exitSpy = mockProcessExit();
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(() => validateProductionEnv()).toThrow('process.exit:1');
    expect(exitSpy).toHaveBeenCalledWith(1);
    const output = collectConsoleErrors(errorSpy);
    expect(output).toContain('Redis password must be set via REDIS_URL or REDIS_PASSWORD');
  });

  it('fails when Redis URL password does not match REDIS_PASSWORD', () => {
    process.env.REDIS_URL = 'redis://:p%40ss%3Aw0rd-strong-1234@localhost:6379';
    process.env.REDIS_PASSWORD = 'redis-env-password-123456';
    const exitSpy = mockProcessExit();
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(() => validateProductionEnv()).toThrow('process.exit:1');
    expect(exitSpy).toHaveBeenCalledWith(1);
    const output = collectConsoleErrors(errorSpy);
    expect(output).toContain('REDIS_URL password does not match REDIS_PASSWORD');
    expectNoLeak(output, [
      'p%40ss%3Aw0rd-strong-1234',
      'p@ss:w0rd-strong-1234',
      'redis-env-password-123456',
    ]);
  });

  it('accepts Redis password from URL when REDIS_PASSWORD is missing', () => {
    process.env.REDIS_URL = 'redis://:redis-strong-password-123456@localhost:6379';
    delete process.env.REDIS_PASSWORD;
    const exitSpy = mockProcessExit();

    expect(() => validateProductionEnv()).not.toThrow();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('accepts Redis password from REDIS_PASSWORD when URL has no password', () => {
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.REDIS_PASSWORD = 'redis-strong-password-123456';
    const exitSpy = mockProcessExit();

    expect(() => validateProductionEnv()).not.toThrow();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('accepts encoded Redis URL password', () => {
    process.env.REDIS_URL = 'redis://:p%40ss%3Aw0rd-strong-1234@localhost:6379';
    delete process.env.REDIS_PASSWORD;
    const exitSpy = mockProcessExit();

    expect(() => validateProductionEnv()).not.toThrow();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('accepts rediss:// scheme', () => {
    process.env.REDIS_URL = 'rediss://:redis-strong-password-123456@localhost:6379';
    delete process.env.REDIS_PASSWORD;
    const exitSpy = mockProcessExit();

    expect(() => validateProductionEnv()).not.toThrow();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('accepts matching Redis URL and REDIS_PASSWORD', () => {
    process.env.REDIS_URL = 'redis://:redis-strong-password-123456@localhost:6379';
    process.env.REDIS_PASSWORD = 'redis-strong-password-123456';
    const exitSpy = mockProcessExit();

    expect(() => validateProductionEnv()).not.toThrow();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('fails on http:// origin in production', () => {
    process.env.ALLOWED_ORIGINS = 'http://example.com';
    const exitSpy = mockProcessExit();
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(() => validateProductionEnv()).toThrow('process.exit:1');
    expect(exitSpy).toHaveBeenCalledWith(1);
    const output = collectConsoleErrors(errorSpy);
    expect(output).toContain('ALLOWED_ORIGINS must use https:// in production');
  });

  it('fails when Redis password from URL is too short', () => {
    process.env.REDIS_URL = 'redis://:weak@localhost:6379';
    delete process.env.REDIS_PASSWORD;
    const exitSpy = mockProcessExit();
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(() => validateProductionEnv()).toThrow('process.exit:1');
    expect(exitSpy).toHaveBeenCalledWith(1);
    const output = collectConsoleErrors(errorSpy);
    expect(output).toContain('Redis password must be at least 16 characters long');
    expectNoLeak(output, ['weak']);
  });

  it('accepts URL-encoded password matching REDIS_PASSWORD after decode', () => {
    process.env.REDIS_URL = 'redis://:p%40ss%3Aw0rd-strong-1234@localhost:6379';
    process.env.REDIS_PASSWORD = 'p@ss:w0rd-strong-1234';
    const exitSpy = mockProcessExit();

    expect(() => validateProductionEnv()).not.toThrow();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('accepts REDIS_PASSWORD with surrounding whitespace', () => {
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.REDIS_PASSWORD = '  redis-strong-password-123456  ';
    const exitSpy = mockProcessExit();

    expect(() => validateProductionEnv()).not.toThrow();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('fails when REDIS_PASSWORD is only whitespace', () => {
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.REDIS_PASSWORD = '   ';
    const exitSpy = mockProcessExit();
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(() => validateProductionEnv()).toThrow('process.exit:1');
    expect(exitSpy).toHaveBeenCalledWith(1);
    const output = collectConsoleErrors(errorSpy);
    expect(output).toContain('Redis password must be set via REDIS_URL or REDIS_PASSWORD');
  });

  it('reports all errors when passwords mismatch and are weak', () => {
    process.env.REDIS_URL = 'redis://:weak@localhost:6379';
    process.env.REDIS_PASSWORD = 'other';
    const exitSpy = mockProcessExit();
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(() => validateProductionEnv()).toThrow('process.exit:1');
    expect(exitSpy).toHaveBeenCalledWith(1);
    const output = collectConsoleErrors(errorSpy);
    expect(output).toContain('REDIS_URL password does not match REDIS_PASSWORD');
    expect(output).toContain('Redis password must be at least 16 characters long');
    expectNoLeak(output, ['weak', 'other']);
  });
});
