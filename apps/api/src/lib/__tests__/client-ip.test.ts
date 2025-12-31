import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { Request } from 'express';
import {
  getClientIp,
  getTrustProxyMode,
  isTrustProxyConfigSafe,
  parseTrustedProxies,
  isIpTrusted,
  normalizeIp,
  resetTrustedProxiesCache,
} from '../client-ip';

describe('client-ip (anti-spoofing + CIDR support)', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    resetTrustedProxiesCache(); // Clear cache between tests
  });

  afterEach(() => {
    process.env = originalEnv;
    resetTrustedProxiesCache();
  });

  describe('getTrustProxyMode', () => {
    it('should default to disabled when TRUST_PROXY_MODE is not set', () => {
      delete process.env.TRUST_PROXY_MODE;
      expect(getTrustProxyMode()).toBe('disabled');
    });

    it('should return disabled for explicit "disabled" value', () => {
      process.env.TRUST_PROXY_MODE = 'disabled';
      expect(getTrustProxyMode()).toBe('disabled');
    });

    it('should return disabled for "false" value', () => {
      process.env.TRUST_PROXY_MODE = 'false';
      expect(getTrustProxyMode()).toBe('disabled');
    });

    it('should return loopback for "loopback" value', () => {
      process.env.TRUST_PROXY_MODE = 'loopback';
      expect(getTrustProxyMode()).toBe('loopback');
    });

    it('should return ips for "ips" value', () => {
      process.env.TRUST_PROXY_MODE = 'ips';
      expect(getTrustProxyMode()).toBe('ips');
    });

    it('should return true for "true" value', () => {
      process.env.TRUST_PROXY_MODE = 'true';
      expect(getTrustProxyMode()).toBe('true');
    });

    it('should be case-insensitive', () => {
      process.env.TRUST_PROXY_MODE = 'LOOPBACK';
      expect(getTrustProxyMode()).toBe('loopback');
    });

    it('should trim whitespace', () => {
      process.env.TRUST_PROXY_MODE = '  ips  ';
      expect(getTrustProxyMode()).toBe('ips');
    });

    it('should default to disabled for unknown values', () => {
      process.env.TRUST_PROXY_MODE = 'invalid-mode';
      expect(getTrustProxyMode()).toBe('disabled');
    });
  });

  describe('parseTrustedProxies (CIDR support)', () => {
    it('should parse single IP addresses', () => {
      process.env.TRUSTED_PROXY_IPS = '10.0.0.1,192.168.1.100';
      const config = parseTrustedProxies();

      expect(config).not.toBeNull();
      expect(config!.singleIps).toContain('10.0.0.1');
      expect(config!.singleIps).toContain('192.168.1.100');
      expect(config!.cidrRanges).toHaveLength(0);
    });

    it('should parse CIDR ranges', () => {
      process.env.TRUSTED_PROXY_IPS = '10.0.0.0/8,192.168.1.0/24';
      const config = parseTrustedProxies();

      expect(config).not.toBeNull();
      expect(config!.singleIps).toHaveLength(0);
      expect(config!.cidrRanges).toHaveLength(2);
    });

    it('should parse mixed IPs and CIDRs', () => {
      process.env.TRUSTED_PROXY_IPS = '10.0.0.1,192.168.0.0/16,172.16.0.5';
      const config = parseTrustedProxies();

      expect(config).not.toBeNull();
      expect(config!.singleIps).toHaveLength(2);
      expect(config!.cidrRanges).toHaveLength(1);
    });

    it('should parse IPv6 addresses and CIDRs', () => {
      process.env.TRUSTED_PROXY_IPS = '2001:db8::1,2001:db8::/32';
      const config = parseTrustedProxies();

      expect(config).not.toBeNull();
      expect(config!.singleIps).toContain('2001:db8::1');
      expect(config!.cidrRanges).toHaveLength(1);
    });

    it('should handle whitespace in CSV', () => {
      process.env.TRUSTED_PROXY_IPS = ' 10.0.0.1 , 192.168.1.0/24 , 172.16.0.5 ';
      const config = parseTrustedProxies();

      expect(config).not.toBeNull();
      expect(config!.singleIps).toHaveLength(2);
      expect(config!.cidrRanges).toHaveLength(1);
    });

    it('should return null for empty TRUSTED_PROXY_IPS', () => {
      process.env.TRUSTED_PROXY_IPS = '';
      expect(parseTrustedProxies()).toBeNull();
    });

    it('should return null when all entries are invalid', () => {
      process.env.TRUSTED_PROXY_IPS = 'not-an-ip,also-invalid';
      expect(parseTrustedProxies()).toBeNull();
    });

    it('should cache parsed result', () => {
      process.env.TRUSTED_PROXY_IPS = '10.0.0.1';
      const config1 = parseTrustedProxies();
      const config2 = parseTrustedProxies();

      expect(config1).toBe(config2); // Same object reference
    });
  });

  describe('isIpTrusted (CIDR matching)', () => {
    it('should match exact IP', () => {
      const config = parseTrustedProxies();
      process.env.TRUSTED_PROXY_IPS = '10.0.0.1,192.168.1.100';
      resetTrustedProxiesCache();
      const trustedConfig = parseTrustedProxies();

      expect(isIpTrusted('10.0.0.1', trustedConfig)).toBe(true);
      expect(isIpTrusted('192.168.1.100', trustedConfig)).toBe(true);
      expect(isIpTrusted('10.0.0.2', trustedConfig)).toBe(false);
    });

    it('should match IP in CIDR range', () => {
      process.env.TRUSTED_PROXY_IPS = '10.0.0.0/8';
      resetTrustedProxiesCache();
      const config = parseTrustedProxies();

      expect(isIpTrusted('10.0.0.1', config)).toBe(true);
      expect(isIpTrusted('10.255.255.255', config)).toBe(true);
      expect(isIpTrusted('11.0.0.1', config)).toBe(false);
    });

    it('should match /24 CIDR range', () => {
      process.env.TRUSTED_PROXY_IPS = '192.168.1.0/24';
      resetTrustedProxiesCache();
      const config = parseTrustedProxies();

      expect(isIpTrusted('192.168.1.1', config)).toBe(true);
      expect(isIpTrusted('192.168.1.254', config)).toBe(true);
      expect(isIpTrusted('192.168.2.1', config)).toBe(false);
    });

    it('should match IPv6 CIDR range', () => {
      process.env.TRUSTED_PROXY_IPS = '2001:db8::/32';
      resetTrustedProxiesCache();
      const config = parseTrustedProxies();

      expect(isIpTrusted('2001:db8::1', config)).toBe(true);
      expect(isIpTrusted('2001:db8:ffff::1', config)).toBe(true);
      expect(isIpTrusted('2001:db9::1', config)).toBe(false);
    });

    it('should return false for undefined IP', () => {
      process.env.TRUSTED_PROXY_IPS = '10.0.0.1';
      resetTrustedProxiesCache();
      const config = parseTrustedProxies();

      expect(isIpTrusted(undefined, config)).toBe(false);
    });

    it('should return false for null config', () => {
      expect(isIpTrusted('10.0.0.1', null)).toBe(false);
    });
  });

  describe('normalizeIp (IPv4-mapped IPv6)', () => {
    it('should normalize IPv4-mapped IPv6 to IPv4', () => {
      expect(normalizeIp('::ffff:192.168.1.1')).toBe('192.168.1.1');
      expect(normalizeIp('::ffff:10.0.0.1')).toBe('10.0.0.1');
    });

    it('should leave pure IPv4 unchanged', () => {
      expect(normalizeIp('192.168.1.1')).toBe('192.168.1.1');
    });

    it('should leave pure IPv6 unchanged', () => {
      expect(normalizeIp('2001:db8::1')).toBe('2001:db8::1');
    });

    it('should return undefined for undefined input', () => {
      expect(normalizeIp(undefined)).toBeUndefined();
    });
  });

  describe('getClientIp (disabled mode)', () => {
    beforeEach(() => {
      process.env.TRUST_PROXY_MODE = 'disabled';
    });

    function createMockRequest(options: {
      socketRemoteAddress?: string;
      ip?: string;
      ips?: string[];
    }): Request {
      return {
        socket: { remoteAddress: options.socketRemoteAddress },
        ip: options.ip,
        ips: options.ips,
      } as any as Request;
    }

    it('should use socket.remoteAddress only', () => {
      const req = createMockRequest({
        socketRemoteAddress: '1.2.3.4',
        ip: '5.6.7.8',
        ips: ['9.10.11.12'],
      });

      expect(getClientIp(req)).toBe('1.2.3.4');
    });

    it('should NOT trust X-Forwarded-For headers (anti-spoofing)', () => {
      const req = createMockRequest({
        socketRemoteAddress: '127.0.0.1',
        ips: ['1.2.3.4'], // Spoofed header
      });

      // Should ignore spoofed header and use socket address
      expect(getClientIp(req)).toBe('127.0.0.1');
    });

    it('should normalize IPv4-mapped IPv6', () => {
      const req = createMockRequest({
        socketRemoteAddress: '::ffff:192.168.1.1',
      });

      expect(getClientIp(req)).toBe('192.168.1.1');
    });

    it('should return undefined if socket address is missing', () => {
      const req = createMockRequest({});
      expect(getClientIp(req)).toBeUndefined();
    });
  });

  describe('getClientIp (loopback mode)', () => {
    beforeEach(() => {
      process.env.TRUST_PROXY_MODE = 'loopback';
    });

    function createMockRequest(options: {
      socketRemoteAddress?: string;
      ip?: string;
      ips?: string[];
    }): Request {
      return {
        socket: { remoteAddress: options.socketRemoteAddress },
        ip: options.ip,
        ips: options.ips,
      } as any as Request;
    }

    it('should trust proxy when socket is loopback IPv4', () => {
      const req = createMockRequest({
        socketRemoteAddress: '127.0.0.1',
        ips: ['1.2.3.4'],
      });

      expect(getClientIp(req)).toBe('1.2.3.4');
    });

    it('should trust proxy when socket is loopback IPv6', () => {
      const req = createMockRequest({
        socketRemoteAddress: '::1',
        ips: ['1.2.3.4'],
      });

      expect(getClientIp(req)).toBe('1.2.3.4');
    });

    it('should trust proxy when socket is IPv4-mapped loopback', () => {
      const req = createMockRequest({
        socketRemoteAddress: '::ffff:127.0.0.1',
        ips: ['1.2.3.4'],
      });

      expect(getClientIp(req)).toBe('1.2.3.4');
    });

    it('should NOT trust proxy when socket is not loopback (anti-spoofing)', () => {
      const req = createMockRequest({
        socketRemoteAddress: '10.0.0.1',
        ips: ['1.2.3.4'], // Potentially spoofed
      });

      // Should ignore ips and use socket address
      expect(getClientIp(req)).toBe('10.0.0.1');
    });

    it('should fallback to socket address if req.ip is missing', () => {
      const req = createMockRequest({
        socketRemoteAddress: '127.0.0.1',
      });

      expect(getClientIp(req)).toBe('127.0.0.1');
    });
  });

  describe('getClientIp (ips mode with CIDR validation)', () => {
    beforeEach(() => {
      process.env.TRUST_PROXY_MODE = 'ips';
    });

    function createMockRequest(options: {
      socketRemoteAddress?: string;
      ip?: string;
      ips?: string[];
    }): Request {
      return {
        socket: { remoteAddress: options.socketRemoteAddress },
        ip: options.ip,
        ips: options.ips,
      } as any as Request;
    }

    it('should trust proxy when socket IP is in trusted list (exact match)', () => {
      process.env.TRUSTED_PROXY_IPS = '10.0.0.1,192.168.1.1';
      resetTrustedProxiesCache();

      const req = createMockRequest({
        socketRemoteAddress: '10.0.0.1',
        ips: ['1.2.3.4'],
      });

      expect(getClientIp(req)).toBe('1.2.3.4');
    });

    it('should trust proxy when socket IP is in CIDR range', () => {
      process.env.TRUSTED_PROXY_IPS = '10.0.0.0/8';
      resetTrustedProxiesCache();

      const req = createMockRequest({
        socketRemoteAddress: '10.5.10.20', // In 10.0.0.0/8
        ips: ['1.2.3.4'],
      });

      expect(getClientIp(req)).toBe('1.2.3.4');
    });

    it('should NOT trust proxy when socket IP is NOT in trusted list (anti-spoofing)', () => {
      process.env.TRUSTED_PROXY_IPS = '10.0.0.0/8';
      resetTrustedProxiesCache();

      const req = createMockRequest({
        socketRemoteAddress: '192.168.1.1', // NOT in 10.0.0.0/8
        ips: ['1.2.3.4'], // Spoofed
      });

      // Should ignore spoofed header and use socket IP
      expect(getClientIp(req)).toBe('192.168.1.1');
    });

    it('should handle IPv6 CIDR matching', () => {
      process.env.TRUSTED_PROXY_IPS = '2001:db8::/32';
      resetTrustedProxiesCache();

      const req = createMockRequest({
        socketRemoteAddress: '2001:db8::5', // In 2001:db8::/32
        ips: ['1.2.3.4'],
      });

      expect(getClientIp(req)).toBe('1.2.3.4');
    });

    it('should fallback to socket IP when TRUSTED_PROXY_IPS is empty', () => {
      delete process.env.TRUSTED_PROXY_IPS;
      resetTrustedProxiesCache();

      const req = createMockRequest({
        socketRemoteAddress: '10.0.0.1',
        ips: ['1.2.3.4'],
      });

      // No trusted proxies configured, use socket IP
      expect(getClientIp(req)).toBe('10.0.0.1');
    });

    it('should handle IPv4-mapped IPv6 in socket address', () => {
      process.env.TRUSTED_PROXY_IPS = '10.0.0.0/8';
      resetTrustedProxiesCache();

      const req = createMockRequest({
        socketRemoteAddress: '::ffff:10.5.10.20', // IPv4-mapped, in range
        ips: ['1.2.3.4'],
      });

      expect(getClientIp(req)).toBe('1.2.3.4');
    });

    it('should handle multiple CIDR ranges', () => {
      process.env.TRUSTED_PROXY_IPS = '10.0.0.0/8,172.16.0.0/12,192.168.0.0/16';
      resetTrustedProxiesCache();

      const req1 = createMockRequest({
        socketRemoteAddress: '172.16.5.10', // In 172.16.0.0/12
        ips: ['1.2.3.4'],
      });

      const req2 = createMockRequest({
        socketRemoteAddress: '192.168.1.1', // In 192.168.0.0/16
        ips: ['5.6.7.8'],
      });

      expect(getClientIp(req1)).toBe('1.2.3.4');
      expect(getClientIp(req2)).toBe('5.6.7.8');
    });
  });

  describe('getClientIp (true mode)', () => {
    beforeEach(() => {
      process.env.TRUST_PROXY_MODE = 'true';
    });

    function createMockRequest(options: {
      socketRemoteAddress?: string;
      ip?: string;
      ips?: string[];
    }): Request {
      return {
        socket: { remoteAddress: options.socketRemoteAddress },
        ip: options.ip,
        ips: options.ips,
      } as any as Request;
    }

    it('should trust all proxies and use ips array', () => {
      const req = createMockRequest({
        socketRemoteAddress: '10.0.0.1',
        ips: ['1.2.3.4', '5.6.7.8'],
      });

      expect(getClientIp(req)).toBe('1.2.3.4');
    });

    it('should fallback through ip to socket address', () => {
      const req = createMockRequest({
        socketRemoteAddress: '10.0.0.1',
        ip: '1.2.3.4',
      });

      expect(getClientIp(req)).toBe('1.2.3.4');
    });
  });

  describe('isTrustProxyConfigSafe', () => {
    it('should return true for disabled mode in production', () => {
      process.env.NODE_ENV = 'production';
      process.env.TRUST_PROXY_MODE = 'disabled';
      expect(isTrustProxyConfigSafe()).toBe(true);
    });

    it('should return true for loopback mode in production', () => {
      process.env.NODE_ENV = 'production';
      process.env.TRUST_PROXY_MODE = 'loopback';
      expect(isTrustProxyConfigSafe()).toBe(true);
    });

    it('should return true for ips mode with valid TRUSTED_PROXY_IPS in production', () => {
      process.env.NODE_ENV = 'production';
      process.env.TRUST_PROXY_MODE = 'ips';
      process.env.TRUSTED_PROXY_IPS = '10.0.0.1,192.168.1.0/24';
      resetTrustedProxiesCache();
      expect(isTrustProxyConfigSafe()).toBe(true);
    });

    it('should return false for ips mode without TRUSTED_PROXY_IPS in production', () => {
      process.env.NODE_ENV = 'production';
      process.env.TRUST_PROXY_MODE = 'ips';
      delete process.env.TRUSTED_PROXY_IPS;
      resetTrustedProxiesCache();
      expect(isTrustProxyConfigSafe()).toBe(false);
    });

    it('should return false for true mode in production', () => {
      process.env.NODE_ENV = 'production';
      process.env.TRUST_PROXY_MODE = 'true';
      expect(isTrustProxyConfigSafe()).toBe(false);
    });

    it('should return true for true mode in development', () => {
      process.env.NODE_ENV = 'development';
      process.env.TRUST_PROXY_MODE = 'true';
      expect(isTrustProxyConfigSafe()).toBe(true);
    });
  });

  describe('Security scenarios (anti-spoofing)', () => {
    function createMockRequest(options: {
      socketRemoteAddress?: string;
      ip?: string;
      ips?: string[];
    }): Request {
      return {
        socket: { remoteAddress: options.socketRemoteAddress },
        ip: options.ip,
        ips: options.ips,
      } as any as Request;
    }

    it('CRITICAL: should prevent IP spoofing attack in disabled mode', () => {
      process.env.TRUST_PROXY_MODE = 'disabled';

      // Attacker tries to spoof IP via X-Forwarded-For
      const req = createMockRequest({
        socketRemoteAddress: '192.168.1.100', // Real attacker IP
        ips: ['1.2.3.4'], // Spoofed header
      });

      // Should use real IP, ignoring spoofed header
      expect(getClientIp(req)).toBe('192.168.1.100');
    });

    it('CRITICAL: should prevent IP spoofing when proxy is not trusted (ips mode)', () => {
      process.env.TRUST_PROXY_MODE = 'ips';
      process.env.TRUSTED_PROXY_IPS = '10.0.0.0/8'; // Only trust 10.x.x.x
      resetTrustedProxiesCache();

      // Attacker connects from non-trusted IP
      const req = createMockRequest({
        socketRemoteAddress: '192.168.1.100', // NOT in 10.0.0.0/8
        ips: ['1.2.3.4'], // Spoofed
      });

      // Should use socket address, NOT spoofed header
      expect(getClientIp(req)).toBe('192.168.1.100');
    });

    it('CRITICAL: should prevent spoofing when proxy is not loopback (loopback mode)', () => {
      process.env.TRUST_PROXY_MODE = 'loopback';

      // Attacker connects directly (not through loopback proxy)
      const req = createMockRequest({
        socketRemoteAddress: '192.168.1.100',
        ips: ['1.2.3.4'], // Spoofed
      });

      // Should use socket address, NOT spoofed header
      expect(getClientIp(req)).toBe('192.168.1.100');
    });

    it('should handle X-Forwarded-For chain correctly when trusted', () => {
      process.env.TRUST_PROXY_MODE = 'ips';
      process.env.TRUSTED_PROXY_IPS = '10.0.0.1';
      resetTrustedProxiesCache();

      // Valid proxy chain: client -> proxy (10.0.0.1)
      const req = createMockRequest({
        socketRemoteAddress: '10.0.0.1', // Trusted proxy
        ips: ['1.2.3.4', '5.6.7.8'], // Client IP is first
      });

      // Should extract client IP (first in chain)
      expect(getClientIp(req)).toBe('1.2.3.4');
    });
  });
});
