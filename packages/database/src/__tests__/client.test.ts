import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';

describe('Database SSL Validation', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    // Nettoyer le cache du module pour forcer la réévaluation
    jest.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should allow connection without SSL in development', () => {
    process.env.NODE_ENV = 'development';
    process.env.DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/blobinfini';

    // Ne doit PAS crasher
    expect(() => {
      require('../client');
    }).not.toThrow();
  });

  it('should throw error if DATABASE_URL is missing in production', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.DATABASE_URL;

    expect(() => {
      require('../client');
    }).toThrow('DATABASE_URL must be set in production environment');
  });

  it('should throw error if sslmode is missing in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_URL = 'postgresql://user:pass@host:5432/db';

    expect(() => {
      require('../client');
    }).toThrow('DATABASE_URL must include "?sslmode=require"');
  });

  it('should accept DATABASE_URL with sslmode=require in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_URL = 'postgresql://user:pass@host:5432/db?sslmode=require';

    expect(() => {
      require('../client');
    }).not.toThrow();
  });

  it('should accept DATABASE_URL with sslmode=verify-full in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_URL = 'postgresql://user:pass@host:5432/db?sslmode=verify-full&sslrootcert=/app/ca.crt';

    expect(() => {
      require('../client');
    }).not.toThrow();
  });

  it('should reject sslmode=prefer in production (insecure fallback)', () => {
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_URL = 'postgresql://user:pass@host:5432/db?sslmode=prefer';

    expect(() => {
      require('../client');
    }).toThrow('DATABASE_URL must include "?sslmode=require"');
  });

  it('should log success message when SSL is validated', () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

    process.env.NODE_ENV = 'production';
    process.env.DATABASE_URL = 'postgresql://user:pass@host:5432/db?sslmode=require';

    require('../client');

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[Database] SSL mode validated')
    );

    consoleSpy.mockRestore();
  });
});
