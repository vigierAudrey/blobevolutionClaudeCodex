#!/usr/bin/env node

/**
 * SECURITY GUARD: Assert the DATABASE_URL used by tests is a TEST database.
 *
 * WHY:
 *   Jest globalSetup runs `prisma migrate deploy` + seed once per run. The
 *   pre-existing guards only checked NODE_ENV / APP_ENV / CI_PROD — they never
 *   looked at WHERE DATABASE_URL points. An inherited / misconfigured
 *   DATABASE_URL (prod, staging, a managed cloud DB) would have been migrated
 *   and seeded silently. This guard closes that gap.
 *
 * RULES (a URL is allowed only if ALL are satisfied):
 *   1. DATABASE_URL (or TEST_DATABASE_URL) is present and parseable.
 *   2. Neither the host nor the database name contains a prod / staging /
 *      managed-cloud indicator (deny-list below).
 *   3. The host is a known-local / CI host (localhost, 127.0.0.1, ::1, the
 *      docker-compose `postgres`/`db` service names) OR the database name
 *      clearly looks like a test database (contains "test").
 *
 * NON-GOALS:
 *   - This does NOT touch `prisma migrate deploy` for real production deploys.
 *     It is only wired into the TEST/dev paths (Jest globalSetup, test scripts).
 *
 * SECRECY:
 *   - The full DATABASE_URL is NEVER printed (it carries credentials).
 *   - Errors expose only a masked host + the database name.
 *
 * @see packages/database/scripts/safe-db-push.mjs (sibling db-push guard)
 */

import fs from 'node:fs';
import path from 'node:path';
import { exit } from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Substrings that, if found in the host or database name, mark the target as a
 * non-test environment. Kept lowercase; matching is case-insensitive.
 */
export const DENY_INDICATORS = [
  'prod',
  'staging',
  'preprod',
  'pre-prod',
  'vps',
  'clever',
  'railway',
  'render.com',
  'onrender',
  'neon.tech',
  'neon.build',
  'supabase',
  'vercel',
  'amazonaws',
  'rds.',
  'azure',
  'digitalocean',
  'ondigitalocean',
  'heroku',
  'planetscale',
  'cockroachlabs',
  'timescale',
  'scalingo',
  'ovh',
];

/**
 * Hosts considered safe local / CI Postgres endpoints.
 * Exact-match only — a prod FQDN like `db.postgres.example.com` must NOT pass.
 */
export const ALLOWED_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '0.0.0.0',
  'postgres', // docker-compose service name
  'db', // docker-compose service name
]);

function createGuardError(message) {
  const error = new Error(message);
  error.code = 'TEST_DB_GUARD';
  return error;
}

/**
 * Mask a host so error output never reveals a precise infra endpoint.
 * Local hosts are shown as-is (no secret, helps debugging); remote hosts keep
 * only their last label (TLD-ish) and mask everything else.
 */
export function maskHost(host) {
  if (!host) return '(empty)';
  if (ALLOWED_HOSTS.has(host)) return host;
  const labels = host.split('.');
  if (labels.length <= 1) return '***';
  return labels.map((label, i) => (i === labels.length - 1 ? label : '***')).join('.');
}

function dbLooksLikeTest(dbName) {
  // "test", "blob_test", "blobinfini_test", "blobinfini-test", "test_db"...
  return /(^|[._-])test([._-]|$)/.test(dbName) || dbName.includes('test');
}

/**
 * Validate a single connection string.
 *
 * @param {string} rawUrl   The connection string to validate.
 * @param {string} label    Human label for error messages (e.g. "DATABASE_URL").
 * @returns {{ host: string, maskedHost: string, dbName: string }}
 * @throws {Error} with code "TEST_DB_GUARD" when the URL is unsafe/invalid.
 */
export function assertSafeTestUrl(rawUrl, label = 'DATABASE_URL') {
  if (!rawUrl || typeof rawUrl !== 'string' || rawUrl.trim() === '') {
    throw createGuardError(
      `❌ BLOCKED: ${label} is not set.\n` +
        '   Refusing to run test-context Prisma commands without an explicit test database.'
    );
  }

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw createGuardError(
      `❌ BLOCKED: ${label} is not a valid URL.\n` +
        '   (value is hidden — it may contain credentials)'
    );
  }

  const host = parsed.hostname.toLowerCase();
  const dbName = decodeURIComponent(parsed.pathname.replace(/^\//, '')).toLowerCase();
  const maskedHost = maskHost(host);

  // Scan only host + db name (never username/password) to avoid leaking or
  // false-positiving on credentials.
  const haystack = `${host} ${dbName}`;
  const hit = DENY_INDICATORS.find((needle) => haystack.includes(needle));
  if (hit) {
    throw createGuardError(
      `❌ BLOCKED: ${label} looks like a NON-test environment.\n` +
        `   host: ${maskedHost}\n` +
        `   db:   ${dbName || '(none)'}\n` +
        `   matched forbidden indicator: "${hit}"\n\n` +
        '🚨 Tests must NEVER migrate/seed a prod, staging or managed-cloud database.'
    );
  }

  const hostIsLocal = ALLOWED_HOSTS.has(host);
  const dbIsTest = dbLooksLikeTest(dbName);

  if (!hostIsLocal && !dbIsTest) {
    throw createGuardError(
      `❌ BLOCKED: ${label} is not an allowed test target.\n` +
        `   host: ${maskedHost}\n` +
        `   db:   ${dbName || '(none)'}\n\n` +
        '💡 Allowed only when EITHER:\n' +
        `   - host ∈ {${[...ALLOWED_HOSTS].join(', ')}}\n` +
        '   - OR the database name clearly contains "test" (e.g. blobinfini_test).'
    );
  }

  return { host, maskedHost, dbName };
}

/**
 * Validate the test database environment.
 * Checks DATABASE_URL (required) and SHADOW_DATABASE_URL (optional).
 *
 * @param {NodeJS.ProcessEnv} env
 * @returns {{ database: object, shadow: object | null }}
 */
export function assertTestDatabaseUrl(env = process.env) {
  const primary = env.TEST_DATABASE_URL || env.DATABASE_URL;
  const database = assertSafeTestUrl(primary, env.TEST_DATABASE_URL ? 'TEST_DATABASE_URL' : 'DATABASE_URL');

  let shadow = null;
  if (env.SHADOW_DATABASE_URL && env.SHADOW_DATABASE_URL.trim() !== '') {
    shadow = assertSafeTestUrl(env.SHADOW_DATABASE_URL, 'SHADOW_DATABASE_URL');
  }

  return { database, shadow };
}

/**
 * Minimal, zero-dependency .env parser. Only backfills keys that are NOT already
 * set in the target env (same non-override semantics as dotenv) → a real env var
 * (CI, or an inherited DATABASE_URL) always wins and is never masked by .env.
 */
export function backfillFromEnvContent(content, env) {
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const key = match[1];
    if (env[key] !== undefined) continue; // never override an already-set var
    let value = match[2].trim();
    // Strip a single layer of surrounding quotes.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
}

function backfillFromEnvFile(filePath, env) {
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return;
  }
  backfillFromEnvContent(content, env);
}

/**
 * Best-effort load of the repo-root test env files so the CLI works as a script
 * prefix locally (where DATABASE_URL lives in .env, not the shell). Pure
 * validation functions stay env-injected and are unaffected by this.
 */
function loadEnvFilesBestEffort(env = process.env) {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(scriptDir, '..', '..', '..');
  for (const filename of ['.env.test', '.env']) {
    backfillFromEnvFile(path.join(repoRoot, filename), env);
  }
}

export function main(env = process.env) {
  if (env === process.env) {
    loadEnvFilesBestEffort();
  }
  try {
    const { database, shadow } = assertTestDatabaseUrl(env);
    console.log('🔒 [test-db-guard] DATABASE_URL verified as a test target.');
    console.log(`   host: ${database.maskedHost}  db: ${database.dbName}`);
    if (shadow) {
      console.log(`   shadow host: ${shadow.maskedHost}  db: ${shadow.dbName}`);
    }
    return 0;
  } catch (error) {
    if (error?.code === 'TEST_DB_GUARD') {
      console.error(`\n${error.message}\n`);
      exit(1);
    }
    console.error('\n❌ [test-db-guard] Unexpected error while validating DATABASE_URL.\n');
    exit(1);
  }
}

const isMain = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isMain) {
  main();
}
