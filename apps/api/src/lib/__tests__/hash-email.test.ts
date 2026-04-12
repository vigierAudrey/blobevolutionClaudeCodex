/**
 * Tests unitaires — hash-email.ts (HMAC-SHA256 email hashing)
 *
 * Couvre :
 *   - Fail-fast si EMAIL_HASH_SECRET absent
 *   - Format de sortie (32 hex chars)
 *   - Déterminisme (même email + secret → même hash)
 *   - Isolation secret (secrets différents → hashes différents)
 *   - Normalisation (case-insensitive)
 *   - Preuve que HMAC ≠ SHA-256 legacy (migration effective)
 *   - Safe wrapper (hashEmailHmacSafe ne throw pas)
 *   - detectEmailHashVersion (v1=64, v2=32, unknown=autre)
 */
import { beforeEach, afterEach, describe, expect, it } from '@jest/globals';
import { createHash } from 'crypto';
import { hashEmailHmac, hashEmailHmacSafe, detectEmailHashVersion } from '../hash-email';

describe('hashEmailHmac', () => {
  const TEST_SECRET = 'test-email-hash-secret-min-32-chars-xxxx';
  let savedSecret: string | undefined;

  beforeEach(() => {
    savedSecret = process.env.EMAIL_HASH_SECRET;
    process.env.EMAIL_HASH_SECRET = TEST_SECRET;
  });

  afterEach(() => {
    if (savedSecret === undefined) {
      delete process.env.EMAIL_HASH_SECRET;
    } else {
      process.env.EMAIL_HASH_SECRET = savedSecret;
    }
  });

  it('throw si EMAIL_HASH_SECRET absent', () => {
    delete process.env.EMAIL_HASH_SECRET;
    expect(() => hashEmailHmac('user@example.com')).toThrow('EMAIL_HASH_SECRET');
  });

  it('throw si EMAIL_HASH_SECRET ne contient que des espaces', () => {
    process.env.EMAIL_HASH_SECRET = '   ';
    expect(() => hashEmailHmac('user@example.com')).toThrow('EMAIL_HASH_SECRET');
  });

  it('retourne exactement 32 hex chars', () => {
    const hash = hashEmailHmac('user@example.com');
    expect(hash).toMatch(/^[a-f0-9]{32}$/);
    expect(hash).toHaveLength(32);
  });

  it('déterministe : même email + secret → même hash', () => {
    const h1 = hashEmailHmac('user@example.com');
    const h2 = hashEmailHmac('user@example.com');
    expect(h1).toBe(h2);
  });

  it('secrets différents → hashes différents (isolation)', () => {
    const h1 = hashEmailHmac('user@example.com');
    process.env.EMAIL_HASH_SECRET = 'completely-different-secret-min-32-chars';
    const h2 = hashEmailHmac('user@example.com');
    expect(h1).not.toBe(h2);
  });

  it('case-insensitive : User@Example.COM = user@example.com', () => {
    const h1 = hashEmailHmac('User@Example.COM');
    const h2 = hashEmailHmac('user@example.com');
    expect(h1).toBe(h2);
  });

  it('whitespace stripped : " user@example.com " = "user@example.com"', () => {
    const h1 = hashEmailHmac('  user@example.com  ');
    const h2 = hashEmailHmac('user@example.com');
    expect(h1).toBe(h2);
  });

  it('HMAC ≠ SHA-256 legacy : preuve que la migration est effective', () => {
    const hmacHash = hashEmailHmac('user@example.com');
    const sha256Full = createHash('sha256').update('user@example.com').digest('hex');
    const sha256Truncated = sha256Full.substring(0, 32);
    // HMAC avec un secret ne peut pas produire le même résultat que SHA-256 sans secret
    expect(hmacHash).not.toBe(sha256Full);
    expect(hmacHash).not.toBe(sha256Truncated);
  });
});

describe('hashEmailHmacSafe', () => {
  let savedSecret: string | undefined;

  beforeEach(() => {
    savedSecret = process.env.EMAIL_HASH_SECRET;
  });

  afterEach(() => {
    if (savedSecret === undefined) {
      delete process.env.EMAIL_HASH_SECRET;
    } else {
      process.env.EMAIL_HASH_SECRET = savedSecret;
    }
  });

  it('retourne undefined au lieu de throw si secret absent', () => {
    delete process.env.EMAIL_HASH_SECRET;
    expect(() => hashEmailHmacSafe('user@example.com')).not.toThrow();
    expect(hashEmailHmacSafe('user@example.com')).toBeUndefined();
  });

  it('retourne undefined si secret whitespace-only', () => {
    process.env.EMAIL_HASH_SECRET = '   ';
    expect(hashEmailHmacSafe('user@example.com')).toBeUndefined();
  });

  it('retourne le hash si secret présent', () => {
    process.env.EMAIL_HASH_SECRET = 'test-email-hash-secret-min-32-chars-xxxx';
    const result = hashEmailHmacSafe('user@example.com');
    expect(result).toMatch(/^[a-f0-9]{32}$/);
  });
});

describe('detectEmailHashVersion', () => {
  it('v1 : 64 hex chars (SHA-256 legacy)', () => {
    const sha256 = createHash('sha256').update('user@example.com').digest('hex'); // 64 chars
    expect(detectEmailHashVersion(sha256)).toBe('v1');
  });

  it('v2 : 32 hex chars (HMAC-SHA256)', () => {
    expect(detectEmailHashVersion('a'.repeat(32))).toBe('v2');
  });

  it('unknown : longueur incorrecte', () => {
    expect(detectEmailHashVersion('abc123')).toBe('unknown');
    expect(detectEmailHashVersion('a'.repeat(16))).toBe('unknown');
    expect(detectEmailHashVersion('a'.repeat(48))).toBe('unknown');
  });

  it('unknown : null ou undefined', () => {
    expect(detectEmailHashVersion(null)).toBe('unknown');
    expect(detectEmailHashVersion(undefined)).toBe('unknown');
    expect(detectEmailHashVersion('')).toBe('unknown');
  });

  it('unknown : caractères non-hex dans 64 chars', () => {
    expect(detectEmailHashVersion('g'.repeat(64))).toBe('unknown');
  });
});
