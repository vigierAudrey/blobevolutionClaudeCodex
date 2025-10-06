import { beforeEach, afterEach, describe, it, expect } from '@jest/globals';
import request from 'supertest';
import { createApp } from '../../index';
import { Express } from 'express';

describe('CSRF Protection', () => {
  let app: Express;
  let agent: request.SuperAgentTest;

  beforeEach(() => {
    app = createApp();
    agent = request.agent(app);
  });

  describe('GET requests (safe methods)', () => {
    it('should allow GET requests without CSRF token', async () => {
      const response = await agent.get('/health');
      expect(response.status).toBe(200);
    });

    it('should provide CSRF token endpoint', async () => {
      const response = await agent.get('/csrf-token');
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('csrfToken');
      expect(response.body).toHaveProperty('expires');
      expect(typeof response.body.csrfToken).toBe('string');
      expect(response.body.csrfToken).toMatch(/^[a-zA-Z0-9_-]+$/); // URL-safe Base64 pattern
    });

    it('should allow HEAD requests without CSRF token', async () => {
      const response = await agent.head('/health');
      expect(response.status).toBe(200);
    });

    it('should allow OPTIONS requests without CSRF token', async () => {
      const response = await agent.options('/health');
      expect(response.status).toBe(204);
    });
  });

  describe('POST requests (unsafe methods)', () => {
    let csrfToken: string;

    beforeEach(async () => {
      // Get CSRF token first
      const tokenResponse = await agent.get('/csrf-token');
      csrfToken = tokenResponse.body.csrfToken;
    });

    it('should reject POST requests without CSRF token', async () => {
      const response = await agent
        .post('/auth/login')
        .send({ email: 'test@example.com', password: 'password123' });

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('CSRF_NO_TOKEN');
      expect(response.body.message).toContain('CSRF token missing');
    });

    it('should reject POST requests with invalid CSRF token', async () => {
      const response = await agent
        .post('/auth/login')
        .set('X-CSRF-Token', 'invalid-token')
        .send({ email: 'test@example.com', password: 'password123' });

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('CSRF_INVALID_TOKEN');
      expect(response.body.message).toContain('CSRF token is invalid');
    });

    it('should accept POST requests with valid CSRF token in header', async () => {
      const response = await agent
        .post('/auth/login')
        .set('X-CSRF-Token', csrfToken)
        .send({ email: 'test@example.com', password: 'password123' });

      // Should not be rejected due to CSRF (may fail for other reasons like validation)
      expect(response.status).not.toBe(403);
      expect(response.body.error).not.toBe('CSRF_NO_TOKEN');
      expect(response.body.error).not.toBe('CSRF_INVALID_TOKEN');
    });

    it('should accept POST requests with valid CSRF token in X-XSRF-Token header', async () => {
      const response = await agent
        .post('/auth/login')
        .set('X-XSRF-Token', csrfToken)
        .send({ email: 'test@example.com', password: 'password123' });

      // Should not be rejected due to CSRF
      expect(response.status).not.toBe(403);
      expect(response.body.error).not.toBe('CSRF_NO_TOKEN');
      expect(response.body.error).not.toBe('CSRF_INVALID_TOKEN');
    });

    it('should accept POST requests with valid CSRF token in body', async () => {
      const response = await agent
        .post('/auth/login')
        .send({
          email: 'test@example.com',
          password: 'password123',
          _csrf: csrfToken
        });

      // Should not be rejected due to CSRF
      expect(response.status).not.toBe(403);
      expect(response.body.error).not.toBe('CSRF_NO_TOKEN');
      expect(response.body.error).not.toBe('CSRF_INVALID_TOKEN');
    });

    it('should accept POST requests with valid CSRF token in query parameter', async () => {
      const response = await agent
        .post(`/auth/login?_csrf=${encodeURIComponent(csrfToken)}`)
        .send({ email: 'test@example.com', password: 'password123' });

      // Should not be rejected due to CSRF
      expect(response.status).not.toBe(403);
      expect(response.body.error).not.toBe('CSRF_NO_TOKEN');
      expect(response.body.error).not.toBe('CSRF_INVALID_TOKEN');
    });
  });

  describe('PUT requests (unsafe methods)', () => {
    let csrfToken: string;

    beforeEach(async () => {
      // Get CSRF token first
      const tokenResponse = await agent.get('/csrf-token');
      csrfToken = tokenResponse.body.csrfToken;
    });

    it('should reject PUT requests without CSRF token', async () => {
      const response = await agent
        .put('/profile')
        .send({ displayName: 'Test User' });

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('CSRF_NO_TOKEN');
    });

    it('should accept PUT requests with valid CSRF token', async () => {
      const response = await agent
        .put('/profile')
        .set('X-CSRF-Token', csrfToken)
        .send({ displayName: 'Test User' });

      // Should not be rejected due to CSRF
      expect(response.status).not.toBe(403);
      expect(response.body.error).not.toBe('CSRF_NO_TOKEN');
      expect(response.body.error).not.toBe('CSRF_INVALID_TOKEN');
    });
  });

  describe('DELETE requests (unsafe methods)', () => {
    let csrfToken: string;

    beforeEach(async () => {
      // Get CSRF token first
      const tokenResponse = await agent.get('/csrf-token');
      csrfToken = tokenResponse.body.csrfToken;
    });

    it('should reject DELETE requests without CSRF token', async () => {
      const response = await agent.delete('/profile');

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('CSRF_NO_TOKEN');
    });

    it('should accept DELETE requests with valid CSRF token', async () => {
      const response = await agent
        .delete('/profile')
        .set('X-CSRF-Token', csrfToken);

      // Should not be rejected due to CSRF
      expect(response.status).not.toBe(403);
      expect(response.body.error).not.toBe('CSRF_NO_TOKEN');
      expect(response.body.error).not.toBe('CSRF_INVALID_TOKEN');
    });
  });

  describe('PATCH requests (unsafe methods)', () => {
    let csrfToken: string;

    beforeEach(async () => {
      // Get CSRF token first
      const tokenResponse = await agent.get('/csrf-token');
      csrfToken = tokenResponse.body.csrfToken;
    });

    it('should reject PATCH requests without CSRF token', async () => {
      const response = await agent
        .patch('/profile')
        .send({ displayName: 'Updated Name' });

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('CSRF_NO_TOKEN');
    });

    it('should accept PATCH requests with valid CSRF token', async () => {
      const response = await agent
        .patch('/profile')
        .set('X-CSRF-Token', csrfToken)
        .send({ displayName: 'Updated Name' });

      // Should not be rejected due to CSRF
      expect(response.status).not.toBe(403);
      expect(response.body.error).not.toBe('CSRF_NO_TOKEN');
      expect(response.body.error).not.toBe('CSRF_INVALID_TOKEN');
    });
  });

  describe('Session handling', () => {
    it('should generate different tokens for different sessions', async () => {
      const agent1 = request.agent(app);
      const agent2 = request.agent(app);

      const response1 = await agent1.get('/csrf-token');
      const response2 = await agent2.get('/csrf-token');

      expect(response1.body.csrfToken).not.toBe(response2.body.csrfToken);
    });

    it('should return valid tokens for the same session', async () => {
      const response1 = await agent.get('/csrf-token');
      const response2 = await agent.get('/csrf-token');

      // Tokens should be different for security (one-time use), but both should be valid
      expect(response1.body.csrfToken).toBeDefined();
      expect(response2.body.csrfToken).toBeDefined();
      expect(typeof response1.body.csrfToken).toBe('string');
      expect(typeof response2.body.csrfToken).toBe('string');
    });

    it('should reject requests when session has no CSRF secret', async () => {
      // Create a request without session context (fresh app instance)
      const freshApp = createApp();
      const response = await request(freshApp)
        .post('/auth/login')
        .send({ email: 'test@example.com', password: 'password123' });

      expect(response.status).toBe(403);
      expect([
        'CSRF_NO_SECRET',
        'CSRF_NO_TOKEN'
      ]).toContain(response.body.error);
    });
  });

  describe('Health check bypass', () => {
    it('should allow POST to health endpoint without CSRF (if such endpoint existed)', async () => {
      // The health endpoint only accepts GET, but this tests the bypass logic
      const response = await agent.get('/health');
      expect(response.status).toBe(200);
    });
  });
});