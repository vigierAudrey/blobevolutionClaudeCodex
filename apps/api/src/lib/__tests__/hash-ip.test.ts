import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { normalizeIp, hashIpHmac, hashIpLegacy, detectHashVersion } from '../hash-ip';

describe('hash-ip (HMAC-SHA256 privacy-preserving)', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    // Set test secret
    process.env.IP_HASH_SECRET = 'test-secret-key-for-unit-tests-min-32-chars';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('normalizeIp', () => {
    it('should normalize IPv4 address', () => {
      expect(normalizeIp('192.168.1.1')).toBe('192.168.1.1');
      expect(normalizeIp('10.0.0.1')).toBe('10.0.0.1');
    });

    it('should normalize IPv4-mapped IPv6 to IPv4', () => {
      expect(normalizeIp('::ffff:192.168.1.1')).toBe('192.168.1.1');
      expect(normalizeIp('::ffff:10.0.0.1')).toBe('10.0.0.1');
      expect(normalizeIp('::ffff:127.0.0.1')).toBe('127.0.0.1');
    });

    it('should normalize pure IPv6 addresses', () => {
      expect(normalizeIp('2001:db8::1')).toBe('2001:db8::1');
      expect(normalizeIp('::1')).toBe('::1');
      expect(normalizeIp('fe80::1')).toBe('fe80::1');
    });

    it('should trim whitespace', () => {
      expect(normalizeIp('  192.168.1.1  ')).toBe('192.168.1.1');
      expect(normalizeIp('\t10.0.0.1\n')).toBe('10.0.0.1');
    });

    it('should return null for invalid IPs', () => {
      expect(normalizeIp('invalid')).toBeNull();
      expect(normalizeIp('999.999.999.999')).toBeNull();
      expect(normalizeIp('localhost')).toBeNull();
      expect(normalizeIp('')).toBeNull();
    });

    it('should return null for null/undefined', () => {
      expect(normalizeIp(null)).toBeNull();
      expect(normalizeIp(undefined)).toBeNull();
    });

    it('should handle edge cases', () => {
      expect(normalizeIp('   ')).toBeNull(); // Whitespace only
      expect(normalizeIp('0.0.0.0')).toBe('0.0.0.0');
      expect(normalizeIp('255.255.255.255')).toBe('255.255.255.255');
    });
  });

  describe('hashIpHmac', () => {
    it('should hash IPv4 address with HMAC-SHA256', () => {
      const hash = hashIpHmac('192.168.1.1');

      expect(hash).not.toBeNull();
      expect(hash).toHaveLength(24); // 24 hex chars (96 bits)
      expect(hash).toMatch(/^[a-f0-9]{24}$/); // Valid hex
    });

    it('should produce consistent hash for same IP', () => {
      const hash1 = hashIpHmac('192.168.1.1');
      const hash2 = hashIpHmac('192.168.1.1');

      expect(hash1).toBe(hash2);
    });

    it('should produce different hashes for different IPs', () => {
      const hash1 = hashIpHmac('192.168.1.1');
      const hash2 = hashIpHmac('192.168.1.2');

      expect(hash1).not.toBe(hash2);
    });

    it('should normalize before hashing (IPv4-mapped IPv6)', () => {
      const hashIPv4 = hashIpHmac('192.168.1.1');
      const hashIPv6Mapped = hashIpHmac('::ffff:192.168.1.1');

      // Same IP after normalization → same hash
      expect(hashIPv4).toBe(hashIPv6Mapped);
    });

    it('should hash pure IPv6 addresses', () => {
      const hash = hashIpHmac('2001:db8::1');

      expect(hash).not.toBeNull();
      expect(hash).toHaveLength(24);
      expect(hash).toMatch(/^[a-f0-9]{24}$/);
    });

    it('should return null for invalid IPs', () => {
      expect(hashIpHmac('invalid')).toBeNull();
      expect(hashIpHmac('999.999.999.999')).toBeNull();
      expect(hashIpHmac('')).toBeNull();
      expect(hashIpHmac(null)).toBeNull();
      expect(hashIpHmac(undefined)).toBeNull();
    });

    it('should throw if IP_HASH_SECRET is not configured', () => {
      delete process.env.IP_HASH_SECRET;

      expect(() => hashIpHmac('192.168.1.1')).toThrow(/IP_HASH_SECRET/);
    });

    it('should produce different hashes with different secrets', () => {
      const hash1 = hashIpHmac('192.168.1.1');

      process.env.IP_HASH_SECRET = 'different-secret-key';
      const hash2 = hashIpHmac('192.168.1.1');

      // Same IP, different secret → different hash (HMAC property)
      expect(hash1).not.toBe(hash2);
    });

    it('should handle whitespace in IP before hashing', () => {
      const hash1 = hashIpHmac('192.168.1.1');
      const hash2 = hashIpHmac('  192.168.1.1  ');

      // Whitespace trimmed during normalization → same hash
      expect(hash1).toBe(hash2);
    });

    it('should produce 24 hex chars (96 bits) for low collision rate', () => {
      const hashes = new Set<string>();
      const ips = [
        '192.168.1.1',
        '192.168.1.2',
        '10.0.0.1',
        '172.16.0.1',
        '2001:db8::1',
        '2001:db8::2'
      ];

      for (const ip of ips) {
        const hash = hashIpHmac(ip);
        expect(hash).toHaveLength(24);
        hashes.add(hash!);
      }

      // All hashes unique (no collisions in small sample)
      expect(hashes.size).toBe(ips.length);
    });
  });

  describe('hashIpLegacy (backward compatibility)', () => {
    it('should hash IPv4 with SHA-256 (16 chars)', () => {
      const hash = hashIpLegacy('192.168.1.1');

      expect(hash).not.toBeNull();
      expect(hash).toHaveLength(16); // 16 hex chars (64 bits)
      expect(hash).toMatch(/^[a-f0-9]{16}$/);
    });

    it('should produce consistent hash for same IP', () => {
      const hash1 = hashIpLegacy('192.168.1.1');
      const hash2 = hashIpLegacy('192.168.1.1');

      expect(hash1).toBe(hash2);
    });

    it('should normalize before hashing', () => {
      const hashIPv4 = hashIpLegacy('192.168.1.1');
      const hashIPv6Mapped = hashIpLegacy('::ffff:192.168.1.1');

      expect(hashIPv4).toBe(hashIPv6Mapped);
    });

    it('should return null for invalid IPs', () => {
      expect(hashIpLegacy('invalid')).toBeNull();
      expect(hashIpLegacy(null)).toBeNull();
      expect(hashIpLegacy(undefined)).toBeNull();
    });

    it('should produce different hash than HMAC (no secret)', () => {
      const legacyHash = hashIpLegacy('192.168.1.1');
      const hmacHash = hashIpHmac('192.168.1.1');

      // Different algorithms → different hashes
      expect(legacyHash).not.toBe(hmacHash);
      expect(legacyHash).toHaveLength(16);
      expect(hmacHash).toHaveLength(24);
    });
  });

  describe('detectHashVersion', () => {
    it('should detect v1 hash (16 hex chars)', () => {
      const v1Hash = 'a1b2c3d4e5f6a7b8'; // 16 hex chars
      expect(detectHashVersion(v1Hash)).toBe('v1');
    });

    it('should detect v2 hash (24 hex chars)', () => {
      const v2Hash = 'a1b2c3d4e5f6a7b8c9d0e1f2'; // 24 hex chars
      expect(detectHashVersion(v2Hash)).toBe('v2');
    });

    it('should return unknown for invalid formats', () => {
      expect(detectHashVersion('invalid')).toBe('unknown');
      expect(detectHashVersion('a1b2')).toBe('unknown'); // Too short
      expect(detectHashVersion('a'.repeat(32))).toBe('unknown'); // Too long
      expect(detectHashVersion('')).toBe('unknown');
      expect(detectHashVersion(null)).toBe('unknown');
      expect(detectHashVersion(undefined)).toBe('unknown');
    });

    it('should reject non-hex characters', () => {
      expect(detectHashVersion('g1b2c3d4e5f6a7b8')).toBe('unknown'); // 'g' not hex
      expect(detectHashVersion('a1b2c3d4e5f6a7b8c9d0e1fZ')).toBe('unknown'); // 'Z' not hex
    });

    it('should work with real hash outputs', () => {
      const legacyHash = hashIpLegacy('192.168.1.1');
      const hmacHash = hashIpHmac('192.168.1.1');

      expect(detectHashVersion(legacyHash)).toBe('v1');
      expect(detectHashVersion(hmacHash)).toBe('v2');
    });
  });

  describe('Integration scenarios', () => {
    it('should handle complete flow: normalize → hash → detect', () => {
      const rawIp = '  ::ffff:192.168.1.1  '; // Whitespace + IPv6-mapped

      const normalized = normalizeIp(rawIp);
      expect(normalized).toBe('192.168.1.1');

      const hash = hashIpHmac(normalized);
      expect(hash).toHaveLength(24);

      const version = detectHashVersion(hash);
      expect(version).toBe('v2');
    });

    it('should correlate same IP from different sources', () => {
      // Simulate same IP arriving from different request formats
      const hash1 = hashIpHmac('192.168.1.1'); // Direct IPv4
      const hash2 = hashIpHmac('::ffff:192.168.1.1'); // IPv6-mapped
      const hash3 = hashIpHmac('  192.168.1.1  '); // With whitespace

      // All should produce same hash (correlation)
      expect(hash1).toBe(hash2);
      expect(hash2).toBe(hash3);
    });

    it('should never leak raw IP in hash output', () => {
      const ip = '192.168.1.1';
      const hash = hashIpHmac(ip);

      // Hash should not contain any part of raw IP
      expect(hash).not.toContain('192');
      expect(hash).not.toContain('168');
      expect(hash).not.toContain(ip);
    });
  });
});
