/**
 * Proofs that Redis credentials are never emitted in logs.
 *
 * These tests exercise three layers of defense:
 *   1. redactRedisUrl() — primary sanitizer used at connection time
 *   2. sanitizeLogString() — serializer-level defense-in-depth
 *   3. RATE_LIMIT_REDIS_CONNECTING — end-to-end: the connect log never leaks
 */

import { redactRedisUrl } from '../redisConfig';
import { sanitizeLogString } from '../../observability/log-serializer';

describe('Redis credential redaction', () => {
  describe('redactRedisUrl()', () => {
    it('redacts user:password format (VPS format — was the P0)', () => {
      // This is the exact format docker-compose.vps.yml builds:
      //   redis://default:${REDIS_PASSWORD}@redis:6379/0
      const url = 'redis://default:super-secret@redis:6379/0';
      const result = redactRedisUrl(url);

      expect(result).not.toContain('super-secret');
      expect(result).not.toContain('default:super');
      expect(result).toContain('redis:6379');
      expect(result).toContain('/0');
    });

    it('redacts password-only format (redis://:pass@host)', () => {
      const url = 'redis://:my-password@localhost:6379/0';
      const result = redactRedisUrl(url);

      expect(result).not.toContain('my-password');
      expect(result).toContain('localhost:6379');
    });

    it('leaves credential-free URLs untouched', () => {
      const url = 'redis://redis:6379/0';
      const result = redactRedisUrl(url);

      expect(result).toBe('redis://redis:6379/0');
    });

    it('redacts credentials embedded in error messages (fallback path)', () => {
      // The redis npm package sometimes includes the URL in connection error messages
      const errorMsg = 'connect ECONNREFUSED redis://default:super-secret@redis:6379/0';
      const result = redactRedisUrl(errorMsg);

      expect(result).not.toContain('super-secret');
      expect(result).toContain('redis:6379');
    });

    it('handles rediss:// (TLS) URLs', () => {
      const url = 'rediss://user:tls-secret@redis.example.com:6380/1';
      // redactRedisUrl uses URL API which parses rediss:// correctly
      const result = redactRedisUrl(url);

      expect(result).not.toContain('tls-secret');
      expect(result).toContain('redis.example.com:6380');
    });
  });

  describe('sanitizeLogString() — defense-in-depth layer', () => {
    it('redacts redis://user:pass@host in any string value (c)', () => {
      // This covers the case where a Redis URL leaks as a string value
      // in a log context object, bypassing explicit redactRedisUrl() calls
      const msg = 'RATE_LIMIT_REDIS_CONNECTING redisUrl=redis://default:super-secret@redis:6379/0';
      const result = sanitizeLogString(msg);

      expect(result).not.toContain('super-secret');
    });

    it('redacts redis://:pass@host (password-only) in strings (c)', () => {
      const msg = 'connecting to redis://:hunter2@localhost:6379/0 ...';
      const result = sanitizeLogString(msg);

      expect(result).not.toContain('hunter2');
    });

    it('an Error containing redis://user:secret@host never leaks the secret (b)', () => {
      // serializeLogValue processes Error objects through sanitizeLogString on message field
      const { serializeLogValue } = require('../../observability/log-serializer');
      const err = new Error('Failed to connect: redis://default:super-secret@redis:6379/0');
      const serialized = serializeLogValue(err) as Record<string, unknown>;

      expect(serialized.message as string).not.toContain('super-secret');
    });
  });

  describe('RATE_LIMIT_REDIS_CONNECTING log — end-to-end (a)', () => {
    it('does not log the Redis URL, password, or host from the real client bootstrap', async () => {
      const previousNodeEnv = process.env.NODE_ENV;
      const previousRedisUrl = process.env.REDIS_URL;
      const captured: Array<{ event: string; context?: Record<string, unknown> }> = [];
      let redisErrorListener: ((error: Error) => void) | undefined;
      const redisClient = {
        on: jest.fn((event: string, listener: (error: Error) => void) => {
          if (event === 'error') redisErrorListener = listener;
        }),
        connect: jest.fn().mockResolvedValue(undefined),
        ping: jest.fn().mockResolvedValue('PONG'),
        quit: jest.fn().mockResolvedValue(undefined),
      };

      try {
        jest.resetModules();
        process.env.NODE_ENV = 'production';
        process.env.REDIS_URL = 'redis://:SUPER_SECRET@example:6379/0';

        jest.doMock('redis', () => ({
          createClient: jest.fn(() => redisClient),
        }));
        jest.doMock('../../utils/secure-logger', () => ({
          secureLogger: {
            info: (event: string, context?: Record<string, unknown>) => captured.push({ event, context }),
            warn: jest.fn(),
            error: (event: string, context?: Record<string, unknown>) => captured.push({ event, context }),
            security: jest.fn(),
          },
        }));

        const { redisClientInitPromise } = require('../redis-client');
        await redisClientInitPromise;
        redisErrorListener?.(
          new Error('authentication failed: SUPER_SECRET redis://:SUPER_SECRET@example:6379/0'),
        );

        const connectingLog = captured.find(({ event }) => event === 'RATE_LIMIT_REDIS_CONNECTING');
        expect(connectingLog).toBeDefined();
        expect(connectingLog?.context).toEqual({
          connecting: true,
          redisConfigured: true,
          tlsEnabled: false,
          dbIndex: '0',
        });

        const serializedLog = JSON.stringify(connectingLog);
        expect(serializedLog).not.toContain('SUPER_SECRET');
        expect(serializedLog).not.toContain('redis://');
        expect(serializedLog).not.toContain('example');
        expect(serializedLog).not.toContain('redisUrl');

        const serializedLogs = JSON.stringify(captured);
        expect(serializedLogs).not.toContain('SUPER_SECRET');
        expect(serializedLogs).not.toContain('redis://:');
      } finally {
        if (previousNodeEnv === undefined) {
          delete process.env.NODE_ENV;
        } else {
          process.env.NODE_ENV = previousNodeEnv;
        }
        if (previousRedisUrl === undefined) {
          delete process.env.REDIS_URL;
        } else {
          process.env.REDIS_URL = previousRedisUrl;
        }
        jest.dontMock('redis');
        jest.dontMock('../../utils/secure-logger');
        jest.resetModules();
      }
    });
  });
});
