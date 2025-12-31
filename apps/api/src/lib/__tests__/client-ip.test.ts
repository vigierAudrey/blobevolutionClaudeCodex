import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { Request } from 'express';
import { getClientIp, getTrustProxyMode, isTrustProxyConfigSafe } from '../client-ip';

describe('client-ip', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
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

  describe('getClientIp', () => {
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

    describe('disabled mode (safe default)', () => {
      beforeEach(() => {
        process.env.TRUST_PROXY_MODE = 'disabled';
      });

      it('should use socket.remoteAddress only', () => {
        const req = createMockRequest({
          socketRemoteAddress: '1.2.3.4',
          ip: '5.6.7.8',
          ips: ['9.10.11.12'],
        });

        expect(getClientIp(req)).toBe('1.2.3.4');
      });

      it('should NOT trust X-Forwarded-For headers', () => {
        const req = createMockRequest({
          socketRemoteAddress: '127.0.0.1',
          ips: ['1.2.3.4'], // Spoofed header
        });

        // Should ignore spoofed header and use socket address
        expect(getClientIp(req)).toBe('127.0.0.1');
      });

      it('should return undefined if socket address is missing', () => {
        const req = createMockRequest({});
        expect(getClientIp(req)).toBeUndefined();
      });
    });

    describe('loopback mode', () => {
      beforeEach(() => {
        process.env.TRUST_PROXY_MODE = 'loopback';
      });

      it('should trust proxy when socket is loopback IPv4', () => {
        const req = createMockRequest({
          socketRemoteAddress: '127.0.0.1',
          ip: '1.2.3.4',
        });

        expect(getClientIp(req)).toBe('1.2.3.4');
      });

      it('should trust proxy when socket is loopback IPv6', () => {
        const req = createMockRequest({
          socketRemoteAddress: '::1',
          ip: '1.2.3.4',
        });

        expect(getClientIp(req)).toBe('1.2.3.4');
      });

      it('should trust proxy when socket is IPv4-mapped IPv6 loopback', () => {
        const req = createMockRequest({
          socketRemoteAddress: '::ffff:127.0.0.1',
          ip: '1.2.3.4',
        });

        expect(getClientIp(req)).toBe('1.2.3.4');
      });

      it('should NOT trust proxy when socket is not loopback', () => {
        const req = createMockRequest({
          socketRemoteAddress: '10.0.0.1',
          ip: '1.2.3.4', // Potentially spoofed
        });

        // Should ignore req.ip and use socket address
        expect(getClientIp(req)).toBe('10.0.0.1');
      });

      it('should fallback to socket address if req.ip is missing', () => {
        const req = createMockRequest({
          socketRemoteAddress: '127.0.0.1',
        });

        expect(getClientIp(req)).toBe('127.0.0.1');
      });
    });

    describe('ips mode (configured trusted proxies)', () => {
      beforeEach(() => {
        process.env.TRUST_PROXY_MODE = 'ips';
        process.env.TRUSTED_PROXY_IPS = '10.0.0.1,192.168.1.1';
      });

      it('should use first IP from ips array when available', () => {
        const req = createMockRequest({
          socketRemoteAddress: '10.0.0.1',
          ips: ['1.2.3.4', '5.6.7.8'],
        });

        expect(getClientIp(req)).toBe('1.2.3.4');
      });

      it('should fallback to req.ip if ips array is empty', () => {
        const req = createMockRequest({
          socketRemoteAddress: '10.0.0.1',
          ip: '1.2.3.4',
          ips: [],
        });

        expect(getClientIp(req)).toBe('1.2.3.4');
      });

      it('should fallback to socket address if both ips and ip are missing', () => {
        const req = createMockRequest({
          socketRemoteAddress: '10.0.0.1',
        });

        expect(getClientIp(req)).toBe('10.0.0.1');
      });
    });

    describe('true mode (trust all - dangerous)', () => {
      beforeEach(() => {
        process.env.TRUST_PROXY_MODE = 'true';
      });

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

    it('should return true for ips mode with TRUSTED_PROXY_IPS in production', () => {
      process.env.NODE_ENV = 'production';
      process.env.TRUST_PROXY_MODE = 'ips';
      process.env.TRUSTED_PROXY_IPS = '10.0.0.1,192.168.1.1';
      expect(isTrustProxyConfigSafe()).toBe(true);
    });

    it('should return false for ips mode without TRUSTED_PROXY_IPS in production', () => {
      process.env.NODE_ENV = 'production';
      process.env.TRUST_PROXY_MODE = 'ips';
      delete process.env.TRUSTED_PROXY_IPS;
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

    it('should return true when mode is unset (defaults to disabled)', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.TRUST_PROXY_MODE;
      expect(isTrustProxyConfigSafe()).toBe(true);
    });
  });

  describe('Security scenarios', () => {
    it('should prevent IP spoofing attack in disabled mode', () => {
      process.env.TRUST_PROXY_MODE = 'disabled';

      // Attacker tries to spoof IP via X-Forwarded-For
      const req = createMockRequest({
        socketRemoteAddress: '192.168.1.100', // Real attacker IP
        ips: ['1.2.3.4'], // Spoofed header
      });

      // Should use real IP, ignoring spoofed header
      expect(getClientIp(req)).toBe('192.168.1.100');
    });

    it('should prevent IP spoofing when proxy is not loopback in loopback mode', () => {
      process.env.TRUST_PROXY_MODE = 'loopback';

      // Attacker connects directly (not through loopback proxy)
      const req = createMockRequest({
        socketRemoteAddress: '192.168.1.100',
        ip: '1.2.3.4', // Spoofed
      });

      // Should use socket address, NOT spoofed header
      expect(getClientIp(req)).toBe('192.168.1.100');
    });
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
});
