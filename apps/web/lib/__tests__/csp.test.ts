/**
 * Unit tests for CSP utilities (lib/csp.ts)
 *
 * These tests validate that:
 * - Nonces are unique per request
 * - script-src never allows unsafe-inline / unsafe-eval
 * - Critical blocking directives are present
 * - Environment variable overrides are respected
 */

import { generateNonce, buildCsp } from '../csp';

// ---------------------------------------------------------------------------
// generateNonce
// ---------------------------------------------------------------------------

describe('generateNonce', () => {
  it('returns a non-empty string', () => {
    const nonce = generateNonce();
    expect(typeof nonce).toBe('string');
    expect(nonce.length).toBeGreaterThan(0);
  });

  it('generates unique values across calls', () => {
    const nonces = new Set(Array.from({ length: 50 }, () => generateNonce()));
    expect(nonces.size).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// buildCsp
// ---------------------------------------------------------------------------

describe('buildCsp', () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    // Restore env between tests
    Object.keys(process.env).forEach((k) => {
      if (!(k in ORIGINAL_ENV)) delete process.env[k];
    });
    Object.assign(process.env, ORIGINAL_ENV);
  });

  // Helpers
  function directive(csp: string, name: string): string | undefined {
    return csp.split(';').find((d) => d.trim().startsWith(`${name} `))?.trim();
  }

  // --- Nonce embedding ---

  it('embeds the nonce in script-src', () => {
    const nonce = 'test-nonce-abc123';
    expect(buildCsp(nonce)).toContain(`'nonce-${nonce}'`);
  });

  it('each nonce produces a distinct CSP string', () => {
    const csp1 = buildCsp('nonce-AAA');
    const csp2 = buildCsp('nonce-BBB');
    expect(csp1).not.toBe(csp2);
  });

  // --- script-src must NOT allow unsafe execution ---

  it('does not include unsafe-inline in script-src', () => {
    const scriptSrc = directive(buildCsp('test'), 'script-src');
    expect(scriptSrc).toBeDefined();
    expect(scriptSrc).not.toContain('unsafe-inline');
  });

  it('does not include unsafe-eval in script-src', () => {
    const scriptSrc = directive(buildCsp('test'), 'script-src');
    expect(scriptSrc).not.toContain('unsafe-eval');
  });

  it('can add route-scoped script and connect sources without changing the default policy', () => {
    const defaultCsp = buildCsp('test');
    const decapCsp = buildCsp('test', {
      scriptSrcExtra: ['https://unpkg.com'],
      connectSrcExtra: ['https://api.github.com', 'https://api.netlify.com'],
    });

    expect(directive(defaultCsp, 'script-src')).not.toContain('https://unpkg.com');
    expect(directive(decapCsp, 'script-src')).toContain('https://unpkg.com');
    expect(directive(decapCsp, 'connect-src')).toContain('https://api.github.com');
    expect(directive(decapCsp, 'connect-src')).toContain('https://api.netlify.com');
  });

  // --- Hard blocking directives ---

  it("blocks all plugins via object-src 'none'", () => {
    expect(buildCsp('test')).toContain("object-src 'none'");
  });

  it("prevents framing via frame-ancestors 'none'", () => {
    expect(buildCsp('test')).toContain("frame-ancestors 'none'");
  });

  it("restricts base-uri to 'self'", () => {
    expect(buildCsp('test')).toContain("base-uri 'self'");
  });

  it("restricts form-action to 'self'", () => {
    expect(buildCsp('test')).toContain("form-action 'self'");
  });

  // --- connect-src: API origin ---

  it('includes default API origin in connect-src when env var is absent', () => {
    delete process.env.NEXT_PUBLIC_API_URL;
    const csp = buildCsp('test');
    // Default fallback is localhost:4000
    expect(csp).toContain('localhost:4000');
  });

  it('includes HTTPS API origin in connect-src', () => {
    process.env.NEXT_PUBLIC_API_URL = 'https://api.example.com';
    const csp = buildCsp('test');
    expect(csp).toContain('https://api.example.com');
  });

  it('converts HTTPS API URL to WSS in connect-src', () => {
    process.env.NEXT_PUBLIC_API_URL = 'https://api.example.com';
    const csp = buildCsp('test');
    expect(csp).toContain('wss://api.example.com');
  });

  it('converts HTTP API URL to WS in connect-src', () => {
    process.env.NEXT_PUBLIC_API_URL = 'http://localhost:4000';
    const csp = buildCsp('test');
    expect(csp).toContain('ws://localhost:4000');
  });

  it('does not crash when NEXT_PUBLIC_API_URL is malformed', () => {
    process.env.NEXT_PUBLIC_API_URL = 'not-a-url';
    expect(() => buildCsp('test')).not.toThrow();
  });

  // --- img-src: CDN and media origins ---

  it('includes cdnjs.cloudflare.com in img-src (Leaflet icons)', () => {
    const imgSrc = directive(buildCsp('test'), 'img-src');
    expect(imgSrc).toContain('cdnjs.cloudflare.com');
  });

  it('includes *.tile.openstreetmap.org in img-src (Leaflet map tiles)', () => {
    const imgSrc = directive(buildCsp('test'), 'img-src');
    expect(imgSrc).toContain('*.tile.openstreetmap.org');
  });

  it('includes localhost:9000 in img-src (MinIO dev)', () => {
    const imgSrc = directive(buildCsp('test'), 'img-src');
    expect(imgSrc).toContain('localhost:9000');
  });

  it('includes data: and blob: in img-src', () => {
    const imgSrc = directive(buildCsp('test'), 'img-src');
    expect(imgSrc).toContain('data:');
    expect(imgSrc).toContain('blob:');
  });

  it('includes NEXT_PUBLIC_MEDIA_URL origin in img-src when set', () => {
    process.env.NEXT_PUBLIC_MEDIA_URL = 'https://cdn.example.com';
    const imgSrc = directive(buildCsp('test'), 'img-src');
    expect(imgSrc).toContain('https://cdn.example.com');
  });

  it('does not add anything to img-src when NEXT_PUBLIC_MEDIA_URL is unset', () => {
    delete process.env.NEXT_PUBLIC_MEDIA_URL;
    // Should not throw and should not contain "undefined" or "null"
    const imgSrc = directive(buildCsp('test'), 'img-src');
    expect(imgSrc).not.toContain('undefined');
    expect(imgSrc).not.toContain('null');
  });

  it('does not crash when NEXT_PUBLIC_MEDIA_URL is invalid', () => {
    process.env.NEXT_PUBLIC_MEDIA_URL = 'bad-url';
    expect(() => buildCsp('test')).not.toThrow();
    // Should silently ignore the invalid value
    const imgSrc = directive(buildCsp('test'), 'img-src');
    expect(imgSrc).not.toContain('bad-url');
  });

  // --- style-src: Leaflet CSS ---

  it('includes unpkg.com in style-src (Leaflet CSS)', () => {
    const styleSrc = directive(buildCsp('test'), 'style-src');
    expect(styleSrc).toContain('unpkg.com');
  });

  // --- Output format ---

  it('produces a single string with semicolon-separated directives', () => {
    const csp = buildCsp('test');
    expect(csp).toContain('; ');
    expect(csp.split(';').length).toBeGreaterThanOrEqual(8);
  });
});
