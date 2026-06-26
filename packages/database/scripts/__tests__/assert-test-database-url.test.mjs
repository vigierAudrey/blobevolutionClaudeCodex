import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertSafeTestUrl,
  assertTestDatabaseUrl,
  backfillFromEnvContent,
  maskHost,
} from '../assert-test-database-url.mjs';

const LOCAL = 'postgresql://postgres:postgres@localhost:5432/blobinfini';
const LOCAL_TEST = 'postgresql://postgres:postgres@127.0.0.1:5432/blobinfini_test';

// ---------------------------------------------------------------------------
// ACCEPTED cases
// ---------------------------------------------------------------------------

test('accepts localhost + non-test db name (real CI/local convention)', () => {
  const result = assertSafeTestUrl(LOCAL);
  assert.equal(result.host, 'localhost');
  assert.equal(result.dbName, 'blobinfini');
});

test('accepts 127.0.0.1 + _test db name', () => {
  const result = assertSafeTestUrl(LOCAL_TEST);
  assert.equal(result.host, '127.0.0.1');
  assert.equal(result.dbName, 'blobinfini_test');
});

test('accepts docker-compose postgres service host', () => {
  const result = assertSafeTestUrl('postgresql://u:p@postgres:5432/blobinfini');
  assert.equal(result.host, 'postgres');
});

test('accepts non-local host when db name clearly contains test', () => {
  const result = assertSafeTestUrl('postgresql://u:p@ci-runner-7:5432/blob_test');
  assert.equal(result.dbName, 'blob_test');
});

test('assertTestDatabaseUrl accepts CI-style env (DATABASE_URL + SHADOW)', () => {
  const { database, shadow } = assertTestDatabaseUrl({
    DATABASE_URL: LOCAL,
    SHADOW_DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/blobinfini_shadow',
  });
  assert.equal(database.host, 'localhost');
  assert.equal(shadow.dbName, 'blobinfini_shadow');
});

test('TEST_DATABASE_URL takes precedence over DATABASE_URL', () => {
  const { database } = assertTestDatabaseUrl({
    TEST_DATABASE_URL: LOCAL_TEST,
    DATABASE_URL: 'postgresql://u:p@db.prod.example.com:5432/blobinfini',
  });
  assert.equal(database.dbName, 'blobinfini_test');
});

// ---------------------------------------------------------------------------
// REJECTED cases
// ---------------------------------------------------------------------------

test('rejects when DATABASE_URL is absent', () => {
  assert.throws(() => assertTestDatabaseUrl({}), /DATABASE_URL is not set/);
});

test('rejects empty DATABASE_URL', () => {
  assert.throws(() => assertSafeTestUrl(''), /not set/);
});

test('rejects invalid URL', () => {
  assert.throws(() => assertSafeTestUrl('not-a-url'), /not a valid URL/);
});

test('rejects non-local host with non-test db name', () => {
  assert.throws(
    () => assertSafeTestUrl('postgresql://u:p@some-host.internal:5432/blobinfini'),
    /not an allowed test target/
  );
});

test('rejects host containing "prod"', () => {
  assert.throws(
    () => assertSafeTestUrl('postgresql://u:p@db.prod.blobsurf.com:5432/blobinfini'),
    /NON-test environment/
  );
});

test('rejects host containing "staging"', () => {
  assert.throws(
    () => assertSafeTestUrl('postgresql://u:p@staging-db:5432/blob_test'),
    /NON-test environment/
  );
});

test('rejects managed cloud providers (neon/supabase/railway/render/vercel)', () => {
  const hosts = [
    'ep-cool-darkness-123.eu-central-1.aws.neon.tech',
    'db.abcdefg.supabase.co',
    'containers-us-west-1.railway.app',
    'dpg-abc123.onrender.com',
    'my-db.vercel-storage.com',
  ];
  for (const host of hosts) {
    assert.throws(
      () => assertSafeTestUrl(`postgresql://u:p@${host}:5432/blobinfini`),
      /NON-test environment/,
      `expected ${host} to be rejected`
    );
  }
});

test('rejects when db NAME contains a prod indicator even on localhost', () => {
  assert.throws(
    () => assertSafeTestUrl('postgresql://u:p@localhost:5432/blobinfini_prod'),
    /NON-test environment/
  );
});

test('rejects an unsafe SHADOW_DATABASE_URL even when primary is fine', () => {
  assert.throws(
    () =>
      assertTestDatabaseUrl({
        DATABASE_URL: LOCAL,
        SHADOW_DATABASE_URL: 'postgresql://u:p@db.staging.example.com:5432/shadow',
      }),
    /SHADOW_DATABASE_URL/
  );
});

// ---------------------------------------------------------------------------
// SECRECY: the full URL / credentials must never appear in error output
// ---------------------------------------------------------------------------

test('error message never leaks credentials or full URL', () => {
  const url = 'postgresql://secretuser:supersecretpw@db.prod.example.com:5432/blobinfini';
  try {
    assertSafeTestUrl(url);
    assert.fail('expected throw');
  } catch (err) {
    assert.doesNotMatch(err.message, /supersecretpw/);
    assert.doesNotMatch(err.message, /secretuser/);
    assert.doesNotMatch(err.message, /db\.prod\.example\.com/); // host is masked
    assert.match(err.message, /\*\*\*/); // masked host shown instead
  }
});

test('maskHost keeps local hosts readable but masks remote labels', () => {
  assert.equal(maskHost('localhost'), 'localhost');
  assert.equal(maskHost('127.0.0.1'), '127.0.0.1');
  assert.equal(maskHost('db.prod.example.com'), '***.***.***.com');
});

// ---------------------------------------------------------------------------
// .env backfill: makes the CLI usable as a local script prefix
// ---------------------------------------------------------------------------

test('backfill sets a missing key (quotes stripped, comments ignored)', () => {
  const env = {};
  backfillFromEnvContent(
    '# comment\nDATABASE_URL="postgresql://u:p@localhost:5432/blobinfini"\n',
    env
  );
  assert.equal(env.DATABASE_URL, 'postgresql://u:p@localhost:5432/blobinfini');
});

test('backfill NEVER overrides an already-set var (inherited prod var wins)', () => {
  const env = { DATABASE_URL: 'postgresql://u:p@db.prod.example.com:5432/x' };
  backfillFromEnvContent('DATABASE_URL=postgresql://u:p@localhost:5432/blobinfini', env);
  assert.match(env.DATABASE_URL, /prod\.example\.com/);
});
