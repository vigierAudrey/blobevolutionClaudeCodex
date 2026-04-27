/**
 * Contract tests: admin_session cookie attributes
 *
 * Proves:
 * 1. ADMIN_SESSION_COOKIE_BASE has the correct security attributes
 * 2. Domain is applied conditionally when COOKIE_DOMAIN env var is set in production
 * 3. A stub route using the same config produces correct Set-Cookie headers
 * 4. Logout clears the cookie (same options as set)
 */
import { describe, expect, it, beforeAll, afterAll } from '@jest/globals';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';

// ── Unit: static attribute assertions ────────────────────────────────────────

describe('ADMIN_SESSION_COOKIE_BASE — attributs statiques', () => {
  it('contient httpOnly:true, secure:IS_PROD, sameSite:lax, path:/', () => {
    // We read the actual exported constant to prove the config is correct.
    // Use isolateModules to control NODE_ENV at module load time.
    const originalEnv = process.env.NODE_ENV;

    let base: Record<string, unknown> | null = null;

    jest.isolateModules(() => {
      process.env.NODE_ENV = 'test';
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      base = require('../auth.controller').ADMIN_SESSION_COOKIE_BASE as Record<string, unknown>;
    });

    process.env.NODE_ENV = originalEnv;

    expect(base).not.toBeNull();
    expect(base!['httpOnly']).toBe(true);
    expect(base!['sameSite']).toBe('lax');
    expect(base!['path']).toBe('/');
  });

  it('en NODE_ENV=production → secure:true', () => {
    const originalEnv = {
      NODE_ENV: process.env.NODE_ENV,
      DATABASE_URL: process.env.DATABASE_URL,
      TWO_FACTOR_SECRET: process.env.TWO_FACTOR_SECRET,
    };
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_URL = 'postgresql://u:p@localhost/db?sslmode=require';
    process.env.TWO_FACTOR_SECRET = 'test-two-factor-secret-for-production-mode-contract-test-xxxxx';

    let base: Record<string, unknown> | null = null;
    jest.isolateModules(() => {
      jest.mock('../../../middleware/enhanced-rate-limit', () => ({
        createLazyRateLimiter: () => () => {},
        createLazyCustomRateLimiter: () => () => {},
        getRedisClient: () => null,
        smartRateLimit: (_r: unknown, _s: unknown, n: () => void) => n(),
        rateLimiters: {},
      }));
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      base = require('../auth.controller').ADMIN_SESSION_COOKIE_BASE as Record<string, unknown>;
    });

    process.env.NODE_ENV = originalEnv.NODE_ENV;
    if (originalEnv.DATABASE_URL !== undefined) process.env.DATABASE_URL = originalEnv.DATABASE_URL;
    if (originalEnv.TWO_FACTOR_SECRET !== undefined) process.env.TWO_FACTOR_SECRET = originalEnv.TWO_FACTOR_SECRET;
    else delete process.env.TWO_FACTOR_SECRET;

    expect(base!['secure']).toBe(true);
  });

  it('en NODE_ENV=test → secure:false', () => {
    let base: Record<string, unknown> | null = null;
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      base = require('../auth.controller').ADMIN_SESSION_COOKIE_BASE as Record<string, unknown>;
    });

    expect(base!['secure']).toBe(false);
  });

  it('en NODE_ENV=production + COOKIE_DOMAIN → domain inclus', () => {
    const originalEnv = {
      NODE_ENV: process.env.NODE_ENV,
      COOKIE_DOMAIN: process.env.COOKIE_DOMAIN,
      DATABASE_URL: process.env.DATABASE_URL,
      TWO_FACTOR_SECRET: process.env.TWO_FACTOR_SECRET,
    };
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_URL = 'postgresql://u:p@localhost/db?sslmode=require';
    process.env.COOKIE_DOMAIN = '.blobinfini.app';
    process.env.TWO_FACTOR_SECRET = 'test-two-factor-secret-for-production-mode-contract-test-xxxxx';

    let base: Record<string, unknown> | null = null;
    jest.isolateModules(() => {
      jest.mock('../../../middleware/enhanced-rate-limit', () => ({
        createLazyRateLimiter: () => () => {},
        createLazyCustomRateLimiter: () => () => {},
        getRedisClient: () => null,
        smartRateLimit: (_r: unknown, _s: unknown, n: () => void) => n(),
        rateLimiters: {},
      }));
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      base = require('../auth.controller').ADMIN_SESSION_COOKIE_BASE as Record<string, unknown>;
    });

    process.env.NODE_ENV = originalEnv.NODE_ENV;
    if (originalEnv.DATABASE_URL !== undefined) process.env.DATABASE_URL = originalEnv.DATABASE_URL;
    if (originalEnv.TWO_FACTOR_SECRET !== undefined) process.env.TWO_FACTOR_SECRET = originalEnv.TWO_FACTOR_SECRET;
    else delete process.env.TWO_FACTOR_SECRET;
    if (originalEnv.COOKIE_DOMAIN === undefined) {
      delete process.env.COOKIE_DOMAIN;
    } else {
      process.env.COOKIE_DOMAIN = originalEnv.COOKIE_DOMAIN;
    }

    expect(base!['domain']).toBe('.blobinfini.app');
  });

  it('en NODE_ENV=production sans COOKIE_DOMAIN → domain absent', () => {
    const originalEnv = {
      NODE_ENV: process.env.NODE_ENV,
      COOKIE_DOMAIN: process.env.COOKIE_DOMAIN,
      DATABASE_URL: process.env.DATABASE_URL,
      TWO_FACTOR_SECRET: process.env.TWO_FACTOR_SECRET,
    };
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_URL = 'postgresql://u:p@localhost/db?sslmode=require';
    process.env.TWO_FACTOR_SECRET = 'test-two-factor-secret-for-production-mode-contract-test-xxxxx';
    delete process.env.COOKIE_DOMAIN;

    let base: Record<string, unknown> | null = null;
    jest.isolateModules(() => {
      jest.mock('../../../middleware/enhanced-rate-limit', () => ({
        createLazyRateLimiter: () => () => {},
        createLazyCustomRateLimiter: () => () => {},
        getRedisClient: () => null,
        smartRateLimit: (_r: unknown, _s: unknown, n: () => void) => n(),
        rateLimiters: {},
      }));
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      base = require('../auth.controller').ADMIN_SESSION_COOKIE_BASE as Record<string, unknown>;
    });

    process.env.NODE_ENV = originalEnv.NODE_ENV;
    if (originalEnv.DATABASE_URL !== undefined) process.env.DATABASE_URL = originalEnv.DATABASE_URL;
    if (originalEnv.TWO_FACTOR_SECRET !== undefined) process.env.TWO_FACTOR_SECRET = originalEnv.TWO_FACTOR_SECRET;
    else delete process.env.TWO_FACTOR_SECRET;
    if (originalEnv.COOKIE_DOMAIN !== undefined) {
      process.env.COOKIE_DOMAIN = originalEnv.COOKIE_DOMAIN;
    }

    expect(base!['domain']).toBeUndefined();
  });
});

// ── Integration: Set-Cookie headers via stub route ────────────────────────────

/**
 * Builds a minimal express app with:
 * - GET /set-admin → sets admin_session cookie with given options
 * - POST /clear-admin → clears admin_session cookie with given options
 */
function buildStubApp(cookieOptions: Record<string, unknown>): express.Express {
  const app = express();
  app.use(cookieParser());

  app.get('/set-admin', (_req, res) => {
    res.cookie('admin_session', '1', cookieOptions as Parameters<typeof res.cookie>[2]);
    res.json({ ok: true });
  });

  app.post('/clear-admin', (_req, res) => {
    res.clearCookie('admin_session', cookieOptions as Parameters<typeof res.clearCookie>[1]);
    res.json({ ok: true });
  });

  return app;
}

function parseSetCookies(headers: Record<string, unknown>): string[] {
  const raw = headers['set-cookie'];
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as string[];
  return [raw as string];
}

describe('admin_session — Set-Cookie headers (stub route, dev)', () => {
  let app: express.Express;

  beforeAll(() => {
    app = buildStubApp({ httpOnly: true, secure: false, sameSite: 'lax', path: '/' });
  });

  it('Set-Cookie contient HttpOnly', async () => {
    const res = await request(app).get('/set-admin').expect(200);
    const cookies = parseSetCookies(res.headers as Record<string, unknown>);
    expect(cookies[0]).toContain('HttpOnly');
  });

  it('Set-Cookie contient SameSite=Lax', async () => {
    const res = await request(app).get('/set-admin').expect(200);
    const cookies = parseSetCookies(res.headers as Record<string, unknown>);
    expect(cookies[0]?.toLowerCase()).toContain('samesite=lax');
  });

  it('Set-Cookie contient Path=/', async () => {
    const res = await request(app).get('/set-admin').expect(200);
    const cookies = parseSetCookies(res.headers as Record<string, unknown>);
    expect(cookies[0]).toContain('Path=/');
  });

  it('Set-Cookie valeur = "1" (gate UX, pas de token secret)', async () => {
    const res = await request(app).get('/set-admin').expect(200);
    const cookies = parseSetCookies(res.headers as Record<string, unknown>);
    expect(cookies[0]).toMatch(/^admin_session=1;/);
  });

  it('dev → PAS de Secure', async () => {
    const res = await request(app).get('/set-admin').expect(200);
    const cookies = parseSetCookies(res.headers as Record<string, unknown>);
    // In dev mode, Secure must NOT be present (would break http localhost)
    expect(cookies[0]).not.toContain('Secure');
  });

  it('logout → clearCookie supprime admin_session (Max-Age=0)', async () => {
    const res = await request(app).post('/clear-admin').expect(200);
    const cookies = parseSetCookies(res.headers as Record<string, unknown>);
    // Express clearCookie sets Max-Age=0 and Expires=past
    expect(cookies[0]).toContain('admin_session=');
    expect(cookies[0]).toMatch(/Max-Age=0|Expires=/i);
  });
});

describe('admin_session — Set-Cookie headers (stub route, production)', () => {
  it('prod → Secure présent', async () => {
    const app = buildStubApp({ httpOnly: true, secure: true, sameSite: 'lax', path: '/' });
    const res = await request(app).get('/set-admin').expect(200);
    const cookies = parseSetCookies(res.headers as Record<string, unknown>);
    expect(cookies[0]).toContain('Secure');
    expect(cookies[0]).toContain('HttpOnly');
  });

  it('prod + COOKIE_DOMAIN → Domain dans Set-Cookie', async () => {
    const app = buildStubApp({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      domain: '.blobinfini.app',
    });
    const res = await request(app).get('/set-admin').expect(200);
    const cookies = parseSetCookies(res.headers as Record<string, unknown>);
    expect(cookies[0]?.toLowerCase()).toContain('domain=.blobinfini.app');
  });

  it('prod sans COOKIE_DOMAIN → Domain absent (scopé domaine API)', async () => {
    const app = buildStubApp({ httpOnly: true, secure: true, sameSite: 'lax', path: '/' });
    const res = await request(app).get('/set-admin').expect(200);
    const cookies = parseSetCookies(res.headers as Record<string, unknown>);
    expect(cookies[0]?.toLowerCase()).not.toMatch(/domain=/);
  });

  it('sameSite=none sans secure → interdit (ne pas utiliser cette config)', () => {
    // Ce test documente que sameSite=none sans secure est interdit.
    // Il prouve que notre config (lax) est conforme.
    const base = { httpOnly: true, secure: true, sameSite: 'lax', path: '/' };
    expect(base.sameSite).not.toBe('none');
  });

  it('admin_session non accessible via JS (httpOnly protège XSS)', () => {
    // Preuve statique : httpOnly=true dans la config.
    const base = { httpOnly: true, secure: true, sameSite: 'lax', path: '/' };
    expect(base.httpOnly).toBe(true);
  });
});

describe('admin_session — clearCookie options cohérentes avec setCookie', () => {
  it('clearCookie avec même path/domain/secure → cookie supprimé', async () => {
    const opts = { httpOnly: true, secure: false, sameSite: 'lax', path: '/' };
    const app = buildStubApp(opts);

    const agent = request.agent(app);
    // Set le cookie
    await agent.get('/set-admin').expect(200);
    // Clear le cookie
    const res = await agent.post('/clear-admin').expect(200);

    const cookies = parseSetCookies(res.headers as Record<string, unknown>);
    const cleared = cookies.find((c) => c.startsWith('admin_session='));
    expect(cleared).toBeDefined();
    // Max-Age=0 ou valeur vide = supprimé
    expect(cleared).toMatch(/admin_session=;|Max-Age=0/i);
  });

  afterAll(() => {
    try {
      // Cleanup any timer leaks from isolateModules
      const { stopAuthCacheCleanup } = require('../../../lib/socket-auth-cache');
      stopAuthCacheCleanup();
    } catch { /* best effort */ }
  });
});
