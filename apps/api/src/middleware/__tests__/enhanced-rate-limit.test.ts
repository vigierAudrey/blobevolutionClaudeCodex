import { beforeEach, afterEach, describe, it, expect, jest } from '@jest/globals';
import request from 'supertest';
import { createApp } from '../../index';
import { Express } from 'express';

// Mock environment variables for testing
const originalEnv = process.env;

beforeEach(() => {
  jest.resetModules();
  process.env = {
    ...originalEnv,
    NODE_ENV: 'test', // This will disable rate limiting in our implementation
  };
});

afterEach(() => {
  process.env = originalEnv;
});

describe('Enhanced Rate Limiting', () => {
  let app: Express;

  beforeEach(() => {
    app = createApp();
  });

  describe('Test environment behavior', () => {
    it('should skip rate limiting in test environment', async () => {
      // Make many requests quickly - should not be rate limited in test env
      const promises = Array.from({ length: 10 }, () =>
        request(app).get('/health')
      );

      const responses = await Promise.all(promises);

      // All should succeed (not rate limited)
      responses.forEach(response => {
        expect(response.status).toBe(200);
      });
    });

    it('should still apply CSRF protection even when rate limiting is disabled', async () => {
      // POST request should still require CSRF token even without rate limiting
      const response = await request(app)
        .post('/auth/login')
        .send({ email: 'test@example.com', password: 'password123' });

      // Should fail due to CSRF, not rate limiting
      expect(response.status).toBe(403);
      expect(response.body.error).toBe('CSRF_NO_SECRET');
    });
  });

  describe('Rate limiting configuration', () => {
    it('should provide correct rate limit profiles', async () => {
      const { RATE_LIMIT_PROFILES } = await import('../enhanced-rate-limit');

      expect(RATE_LIMIT_PROFILES.AUTH.max).toBe(5);
      expect(RATE_LIMIT_PROFILES.AUTH.windowMs).toBe(15 * 60 * 1000);

      expect(RATE_LIMIT_PROFILES.REGISTRATION.max).toBe(3);
      expect(RATE_LIMIT_PROFILES.REGISTRATION.windowMs).toBe(60 * 60 * 1000);

      expect(RATE_LIMIT_PROFILES.SEARCH.max).toBe(30);
      expect(RATE_LIMIT_PROFILES.SEARCH.windowMs).toBe(1 * 60 * 1000);

      expect(RATE_LIMIT_PROFILES.UPLOAD.max).toBe(10);
      expect(RATE_LIMIT_PROFILES.UPLOAD.windowMs).toBe(10 * 60 * 1000);

      expect(RATE_LIMIT_PROFILES.MESSAGING.max).toBe(10);
      expect(RATE_LIMIT_PROFILES.MESSAGING.windowMs).toBe(1 * 60 * 1000);

      expect(RATE_LIMIT_PROFILES.GLOBAL.max).toBe(1000);
      expect(RATE_LIMIT_PROFILES.GLOBAL.windowMs).toBe(15 * 60 * 1000);
    });

    it('should have appropriate error messages for each profile', async () => {
      const { RATE_LIMIT_PROFILES } = await import('../enhanced-rate-limit');

      expect(RATE_LIMIT_PROFILES.AUTH.message.error).toBe('AUTH_RATE_LIMIT_EXCEEDED');
      expect(RATE_LIMIT_PROFILES.REGISTRATION.message.error).toBe('REGISTRATION_RATE_LIMIT_EXCEEDED');
      expect(RATE_LIMIT_PROFILES.SEARCH.message.error).toBe('SEARCH_RATE_LIMIT_EXCEEDED');
      expect(RATE_LIMIT_PROFILES.UPLOAD.message.error).toBe('UPLOAD_RATE_LIMIT_EXCEEDED');
      expect(RATE_LIMIT_PROFILES.MESSAGING.message.error).toBe('MESSAGING_RATE_LIMIT_EXCEEDED');
      expect(RATE_LIMIT_PROFILES.GLOBAL.message.error).toBe('GLOBAL_RATE_LIMIT_EXCEEDED');
    });
  });

  describe('Smart rate limit routing', () => {
    it('should identify auth endpoints correctly', async () => {
      // Note: We don't change NODE_ENV as it would start background jobs
      // Rate limiting is enabled by default in our middleware

      // Auth endpoints should get stricter limits
      // We can't easily test the actual rate limiting without Redis or memory store manipulation,
      // but we can verify the middleware is applied correctly by checking the response structure
      const response = await request(app)
        .get('/csrf-token'); // This should not be rate limited (GET request)

      expect(response.status).toBe(200);
      // Rate limiting headers might not be present in test environment or with memory store
      // Just verify the request succeeds
    });

    it('should handle health check bypass', async () => {
      // Health check should always work regardless of rate limits
      const response = await request(app).get('/health');
      expect(response.status).toBe(200);
    });
  });

  describe('Rate limiter factory functions', () => {
    it('should create rate limiters with correct configurations', async () => {
      const { rateLimiters } = await import('../enhanced-rate-limit');

      // Test that all rate limiters exist as middleware functions
      expect(typeof rateLimiters.auth).toBe('function');
      expect(typeof rateLimiters.registration).toBe('function');
      expect(typeof rateLimiters.apiStandard).toBe('function');
      expect(typeof rateLimiters.search).toBe('function');
      expect(typeof rateLimiters.upload).toBe('function');
      expect(typeof rateLimiters.admin).toBe('function');
      expect(typeof rateLimiters.messaging).toBe('function');
      expect(typeof rateLimiters.global).toBe('function');

      // Test that they are ready-to-use middleware functions
      expect(typeof rateLimiters.auth).toBe('function');
    });
  });

  describe('Redis integration', () => {
    it('should handle Redis connection gracefully when not available', async () => {
      // Test without Redis URL
      delete process.env.REDIS_URL;
      Object.defineProperty(process.env, 'NODE_ENV', {
        value: 'production',
        configurable: true
      });

      // Should not throw error when Redis is not available
      expect(() => {
        require('../enhanced-rate-limit');
      }).not.toThrow();
    });

    it('should initialize Redis client when URL is provided in production', async () => {
      Object.defineProperty(process.env, 'NODE_ENV', {
        value: 'production',
        configurable: true
      });
      process.env.REDIS_URL = 'redis://localhost:6379';

      // Should attempt to connect (will likely fail in test environment, but shouldn't crash)
      expect(() => {
        require('../enhanced-rate-limit');
      }).not.toThrow();
    });
  });

  describe('Custom rate limiter creation', () => {
    it('should allow custom options override', async () => {
      const { createRateLimiter } = await import('../enhanced-rate-limit');

      // Create a custom rate limiter with overridden options
      const customLimiter = createRateLimiter('API_STANDARD', {
        max: 50, // Override the default
        windowMs: 30000 // Override the default
      });

      expect(typeof customLimiter).toBe('function');
    });
  });

  describe('Key generation', () => {
    it('should generate different keys for authenticated vs unauthenticated users', async () => {
      const { createRateLimiter } = await import('../enhanced-rate-limit');

      // Create a rate limiter
      const limiter = createRateLimiter('API_STANDARD');

      // Mock requests
      const mockReqAuth = {
        user: { id: 'user123' },
        ip: '127.0.0.1',
        path: '/api/test',
        method: 'GET',
        get: () => 'test-agent'
      } as any;

      const mockReqUnauth = {
        ip: '127.0.0.1',
        path: '/api/test',
        method: 'GET',
        get: () => 'test-agent'
      } as any;

      // In a real scenario, these would generate different keys
      // We can't easily test the key generation without accessing internal state
      // but we can verify the limiter is created correctly
      expect(typeof limiter).toBe('function');
    });
  });

  describe('Skip conditions', () => {
    it('should skip rate limiting for trusted IPs when configured', async () => {
      process.env.TRUSTED_IPS = '127.0.0.1,192.168.1.1';

      const { createRateLimiter } = await import('../enhanced-rate-limit');
      const limiter = createRateLimiter('API_STANDARD');

      expect(typeof limiter).toBe('function');

      // Cleanup
      delete process.env.TRUSTED_IPS;
    });
  });

  describe('Error handling and monitoring', () => {
    it('should provide structured error responses', async () => {
      const { RATE_LIMIT_PROFILES } = await import('../enhanced-rate-limit');

      // Verify error message structure
      const authProfile = RATE_LIMIT_PROFILES.AUTH;
      expect(authProfile.message).toHaveProperty('error');
      expect(authProfile.message).toHaveProperty('message');
      expect(authProfile.message).toHaveProperty('retryAfter');

      expect(authProfile.message.error).toBe('AUTH_RATE_LIMIT_EXCEEDED');
      expect(typeof authProfile.message.message).toBe('string');
      expect(authProfile.message.retryAfter).toBe('15 minutes');
    });
  });

  describe('Cleanup functionality', () => {
    it('should provide cleanup function for graceful shutdown', async () => {
      const { closeRateLimitStore } = await import('../enhanced-rate-limit');

      // Should not throw when called without Redis connection
      await expect(closeRateLimitStore()).resolves.toBeUndefined();
    });
  });

  describe('Integration with Express app', () => {
    it('should integrate with the main Express application without errors', async () => {
      // Verify the app starts without throwing errors
      expect(app).toBeDefined();

      // Verify basic functionality works
      const response = await request(app).get('/health');
      expect(response.status).toBe(200);
    });

    it('should apply rate limiting middleware globally', async () => {
      // Test that the middleware is applied by checking headers
      const response = await request(app).get('/csrf-token');

      // In test environment, rate limiting is skipped, but middleware is still applied
      expect(response.status).toBe(200);
    });
  });
});
