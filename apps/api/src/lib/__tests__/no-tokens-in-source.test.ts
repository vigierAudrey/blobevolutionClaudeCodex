/**
 * Gate C — No tokens in JSON responses / localStorage (anti-regression CI)
 *
 * This is a static source analysis test — no DB, no HTTP, fast and deterministic.
 *
 * Part 1 (frontend): Scans web source for localStorage.setItem calls that store
 *   raw access or refresh tokens. Tokens must live in httpOnly cookies only.
 *
 * Part 2 (backend): Scans auth controller source to verify response bodies
 *   never include accessToken/refreshToken/token fields.
 *
 * HOW TO LEGITIMATELY HANDLE TOKENS — see docs/security-gates.md#gate-c
 */

import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Utility: walk a directory tree and collect .ts / .tsx file paths
// ---------------------------------------------------------------------------

// Directories skipped during source scan (non-production code)
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', '__pycache__', 'tests', '__tests__']);

function walkFiles(dir: string, ext: string[] = ['.ts', '.tsx']): string[] {
  if (!fs.existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip non-production directories (test files, build output, deps)
      if (SKIP_DIRS.has(entry.name)) continue;
      results.push(...walkFiles(full, ext));
    } else if (ext.some((e) => entry.name.endsWith(e))) {
      // Also skip Playwright/Cypress e2e spec files (they inject tokens for test setup)
      if (entry.name.endsWith('.spec.ts') || entry.name.endsWith('.spec.tsx')) continue;
      results.push(full);
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Utility: find pattern occurrences with line numbers
// ---------------------------------------------------------------------------

type Match = { file: string; line: number; text: string };

function grepSource(files: string[], pattern: RegExp): Match[] {
  const matches: Match[] = [];
  for (const file of files) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((text, idx) => {
      if (pattern.test(text)) {
        matches.push({ file, line: idx + 1, text: text.trim() });
      }
    });
  }
  return matches;
}

function formatMatches(matches: Match[]): string {
  return matches.map((m) => `  ${m.file}:${m.line}: ${m.text}`).join('\n');
}

// ---------------------------------------------------------------------------
// Root paths (relative to repo root)
// ---------------------------------------------------------------------------

const REPO_ROOT = path.resolve(__dirname, '../../../../..');
const WEB_SRC = path.join(REPO_ROOT, 'apps/web');
const AUTH_CONTROLLER = path.join(
  REPO_ROOT,
  'apps/api/src/modules/auth/auth.controller.ts'
);
const API_CLIENT = path.join(REPO_ROOT, 'apps/web/lib/apiClient.ts');
const AUTH_FORM = path.join(REPO_ROOT, 'apps/web/components/AuthForm.tsx');

// ---------------------------------------------------------------------------
// Gate C — Part 1: Frontend — no raw token in localStorage
// ---------------------------------------------------------------------------

describe('Gate C.1 — frontend: no raw token in localStorage', () => {
  let webFiles: string[];

  beforeAll(() => {
    webFiles = walkFiles(WEB_SRC);
    expect(webFiles.length).toBeGreaterThan(0); // sanity: found files
  });

  it('no localStorage.setItem("accessToken", ...) in web source', () => {
    const pattern = /localStorage\.setItem\s*\(\s*['"`]accessToken['"`]/;
    const matches = grepSource(webFiles, pattern);
    expect(matches).toEqual(
      [],
      `Found ${matches.length} violation(s). Tokens must be stored in httpOnly cookies, not localStorage:\n` +
        formatMatches(matches)
    );
  });

  it('no localStorage.setItem("refreshToken", ...) in web source', () => {
    const pattern = /localStorage\.setItem\s*\(\s*['"`]refreshToken['"`]/;
    const matches = grepSource(webFiles, pattern);
    expect(matches).toEqual(
      [],
      `Found ${matches.length} violation(s). Refresh tokens must be httpOnly cookies only:\n` +
        formatMatches(matches)
    );
  });

  it('no localStorage.setItem("token", ...) in web source (generic token key)', () => {
    // Only the exact key "token" — not keys like "consent_token_hash"
    const pattern = /localStorage\.setItem\s*\(\s*['"`]token['"`]/;
    const matches = grepSource(webFiles, pattern);
    expect(matches).toEqual(
      [],
      `Found ${matches.length} violation(s). Generic "token" key in localStorage is forbidden:\n` +
        formatMatches(matches)
    );
  });

  it('apiClient.ts uses the session hint key (blob_session_hint) not raw tokens', () => {
    expect(fs.existsSync(API_CLIENT)).toBe(true);
    const content = fs.readFileSync(API_CLIENT, 'utf8');
    // The allowed localStorage key — a non-sensitive session hint
    expect(content).toContain('blob_session_hint');
    // Must NOT store actual JWT values
    expect(content).not.toMatch(/localStorage\.setItem\s*\(\s*['"`]accessToken['"`]/);
    expect(content).not.toMatch(/localStorage\.setItem\s*\(\s*['"`]refreshToken['"`]/);
  });
});

// ---------------------------------------------------------------------------
// Gate D — No S3 secrets / infra env vars in console.log calls
// ---------------------------------------------------------------------------

describe('Gate D — no S3 secrets in console.log', () => {
  const API_SRC = path.join(REPO_ROOT, 'apps/api/src');
  let apiFiles: string[];

  beforeAll(() => {
    apiFiles = walkFiles(API_SRC);
    expect(apiFiles.length).toBeGreaterThan(0);
  });

  it('no console.log exposing S3_ACCESS_KEY_ID or S3_SECRET_ACCESS_KEY', () => {
    // Match console.log/console.warn/console.error lines that reference secret env vars
    const pattern = /console\.(log|warn|error|info)\s*\([^)]*(?:S3_ACCESS_KEY|S3_SECRET|SECRET_ACCESS_KEY|accessKeyId|secretAccessKey)/;
    const matches = grepSource(apiFiles, pattern);
    expect(matches).toEqual(
      [],
      `Found ${matches.length} violation(s) — S3 credentials must never appear in console output:\n` +
        formatMatches(matches)
    );
  });

  it('no console.log containing raw S3_ENDPOINT or S3_BUCKET env reads', () => {
    // Detect: console.log('S3 env check', { endpoint: process.env.S3_ENDPOINT, ... })
    // The danger is exposing infrastructure topology. Endpoint/bucket are not credentials
    // but should not be logged either (reduces attack surface recon).
    const pattern = /console\.(log|warn|error|info)\s*\([^)]*process\.env\.S3_/;
    const matches = grepSource(apiFiles, pattern);
    expect(matches).toEqual(
      [],
      `Found ${matches.length} violation(s) — S3 env vars must not appear in console output:\n` +
        formatMatches(matches)
    );
  });
});

// ---------------------------------------------------------------------------
// Gate D.3 — METRICS_INTERNAL_TOKEN must not leak into logs or JSON responses
// ---------------------------------------------------------------------------

describe('Gate D.3 — METRICS_INTERNAL_TOKEN not logged or returned in responses', () => {
  const INDEX_TS = path.join(REPO_ROOT, 'apps/api/src/index.ts');
  let indexSource: string;

  beforeAll(() => {
    expect(fs.existsSync(INDEX_TS)).toBe(true);
    indexSource = fs.readFileSync(INDEX_TS, 'utf8');
  });

  it('metrics endpoint does not log the provided token value', () => {
    // Scan the metrics route section for any logging of the `provided` header value.
    // Allowed: secureLogger.security('METRICS_INTERNAL_TOKEN_ACCESS', { ip: ... })
    // Forbidden: secureLogger.*(...provided...) or console.*(...provided...)
    const metricsRouteIdx = indexSource.indexOf('/internal/metrics');
    expect(metricsRouteIdx).not.toBe(-1);

    // Extract ~600 chars of the metrics route handler for targeted analysis
    const metricsSection = indexSource.slice(metricsRouteIdx, metricsRouteIdx + 600);

    // The raw `provided` variable must NOT be passed to any logger
    const logWithProvided = /(?:secureLogger|console)\.[a-z]+\s*\([^)]*\bprovided\b/;
    expect(metricsSection).not.toMatch(logWithProvided);
  });

  it('metrics endpoint does not include the provided token value in res.json responses', () => {
    const metricsRouteIdx = indexSource.indexOf('/internal/metrics');
    const metricsSection = indexSource.slice(metricsRouteIdx, metricsRouteIdx + 600);

    // The raw `provided` value must NOT be serialised in any response body
    const jsonWithProvided = /res\.json\s*\([^)]*\bprovided\b/;
    expect(metricsSection).not.toMatch(jsonWithProvided);
  });

  it('process.env.METRICS_INTERNAL_TOKEN value is never passed directly to a logger', () => {
    // Walk all API source files — the env var value must not be expanded inline in any log call
    const API_SRC = path.join(REPO_ROOT, 'apps/api/src');
    const apiFiles = walkFiles(API_SRC);

    const pattern =
      /(?:secureLogger|console)\.[a-z]+\s*\([^)]*process\.env\.METRICS_INTERNAL_TOKEN/;
    const matches = grepSource(apiFiles, pattern);
    expect(matches).toEqual(
      [],
      `Found ${matches.length} violation(s) — METRICS_INTERNAL_TOKEN env var must never appear in log calls:\n` +
        formatMatches(matches)
    );
  });
});

// ---------------------------------------------------------------------------
// Gate C — Part 2: Backend — no tokens in auth response bodies
// ---------------------------------------------------------------------------

describe('Gate C.2 — backend: no tokens in auth response bodies', () => {
  let authSource: string;

  beforeAll(() => {
    expect(fs.existsSync(AUTH_CONTROLLER)).toBe(true);
    authSource = fs.readFileSync(AUTH_CONTROLLER, 'utf8');
  });

  it('auth controller does not send accessToken in json body', () => {
    // res.json({...accessToken...}) or res.status(...).json({...accessToken...})
    const dangerousPattern = /(?:res\.json|res\.status\([^)]*\)\.json)\s*\(\s*\{[^}]*accessToken/;
    expect(authSource).not.toMatch(dangerousPattern);
  });

  it('auth controller does not send refreshToken in json body', () => {
    const dangerousPattern = /(?:res\.json|res\.status\([^)]*\)\.json)\s*\(\s*\{[^}]*refreshToken/;
    expect(authSource).not.toMatch(dangerousPattern);
  });

  it('tokens are set via cookie (not body) — cookie calls present', () => {
    // Verify the secure pattern: res.cookie('accessToken', ...) with httpOnly
    expect(authSource).toContain("res.cookie('accessToken'");
    expect(authSource).toContain('httpOnly: true');
  });

  it('login endpoint returns { ok: true } not { accessToken, refreshToken }', () => {
    // Use the route marker, not '/login' string (appears in many comments/imports)
    const marker = "authRouter.post('/login',";
    const idx = authSource.indexOf(marker);
    expect(idx).not.toBe(-1);
    const loginSection = authSource.slice(idx, idx + 3500);
    expect(loginSection).toContain('ok: true');
    expect(loginSection).not.toMatch(/json\s*\(\s*\{[^}]*accessToken/);
    expect(loginSection).not.toMatch(/json\s*\(\s*\{[^}]*refreshToken/);
  });

  it('refresh endpoint returns { ok: true } not a token payload', () => {
    // Use the route handler marker, not just '/refresh' (which appears in cookie config too)
    const marker = "authRouter.post('/refresh',";
    const idx = authSource.indexOf(marker);
    expect(idx).not.toBe(-1);
    const refreshSection = authSource.slice(idx, idx + 2000);
    expect(refreshSection).toContain('ok: true');
    expect(refreshSection).not.toMatch(/json\s*\(\s*\{[^}]*accessToken/);
    expect(refreshSection).not.toMatch(/json\s*\(\s*\{[^}]*refreshToken/);
  });

  it('verify-2fa endpoint returns { ok: true } not a token payload', () => {
    const marker = "authRouter.post('/verify-2fa',";
    const idx = authSource.indexOf(marker);
    expect(idx).not.toBe(-1);
    const verifySection = authSource.slice(idx, idx + 2500);
    expect(verifySection).toContain('return res.json({ ok: true })');
    expect(verifySection).not.toMatch(/json\s*\(\s*\{[^}]*accessToken/);
    expect(verifySection).not.toMatch(/json\s*\(\s*\{[^}]*refreshToken/);
    expect(verifySection).not.toMatch(/json\s*\(\s*\{[^}]*\btoken\b/);
  });
});

describe('Gate C.3 — verify-2fa request body must not include userId', () => {
  it('backend verify-2fa handler never reads userId from req.body', () => {
    expect(fs.existsSync(AUTH_CONTROLLER)).toBe(true);
    const authSource = fs.readFileSync(AUTH_CONTROLLER, 'utf8');
    const marker = "authRouter.post('/verify-2fa',";
    const idx = authSource.indexOf(marker);
    expect(idx).not.toBe(-1);
    const verifySection = authSource.slice(idx, idx + 2500);

    expect(verifySection).not.toMatch(/req\.body\.(?:\w+\.)*userId/);
    expect(verifySection).not.toMatch(/\{[^}]*userId[^}]*\}\s*=\s*req\.body/);
  });

  it('frontend verify-2fa payload uses challengeId/code only (no userId)', () => {
    expect(fs.existsSync(API_CLIENT)).toBe(true);
    const apiClientSource = fs.readFileSync(API_CLIENT, 'utf8');

    const verifyFnIdx = apiClientSource.indexOf('verify2FA:');
    expect(verifyFnIdx).not.toBe(-1);
    const verifyFnSection = apiClientSource.slice(verifyFnIdx, verifyFnIdx + 600);

    expect(verifyFnSection).toContain("JSON.stringify({ challengeId, code, consentAccepted })");
    expect(verifyFnSection).not.toMatch(/JSON\.stringify\s*\(\s*\{[^}]*userId/);
  });

  it('AuthForm never sends userId to verify2FA call', () => {
    expect(fs.existsSync(AUTH_FORM)).toBe(true);
    const authFormSource = fs.readFileSync(AUTH_FORM, 'utf8');

    expect(authFormSource).toContain('apiClient.verify2FA(');
    expect(authFormSource).not.toMatch(/apiClient\.verify2FA\s*\(\s*[^,]+,\s*[^,]+,\s*[^)]*userId/);
  });
});
