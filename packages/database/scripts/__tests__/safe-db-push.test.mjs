#!/usr/bin/env node

/**
 * PROOF TESTS: safe-db-push.mjs guard validation
 *
 * These tests provide reproducible proof that the security guards work correctly.
 * Each test documents expected exit codes and output patterns.
 *
 * Run all tests:
 *   node packages/database/scripts/__tests__/safe-db-push.test.mjs
 */

import { execSync } from 'child_process';
import { exit } from 'process';

const WRAPPER_PATH = 'packages/database/scripts/safe-db-push.mjs';
const RESET_ENV = '\x1b[0m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';

let passCount = 0;
let failCount = 0;

function testCase(name, fn) {
  console.log(`\n${YELLOW}TEST:${RESET_ENV} ${name}`);
  try {
    fn();
    console.log(`${GREEN}✓ PASS${RESET_ENV}`);
    passCount++;
  } catch (error) {
    console.error(`${RED}✗ FAIL:${RESET_ENV} ${error.message}`);
    failCount++;
  }
}

function runWrapper(env, expectSuccess = false) {
  try {
    const output = execSync(`node ${WRAPPER_PATH} 2>&1`, {
      env: { ...process.env, ...env },
      encoding: 'utf-8',
      stdio: 'pipe'
    });
    return { success: true, output, exitCode: 0 };
  } catch (error) {
    // Capture both stdout and stderr
    const output = (error.stdout || '') + (error.stderr || '');
    return {
      success: false,
      output,
      exitCode: error.status || 1
    };
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

console.log('\n' + '='.repeat(80));
console.log('PROOF TESTS: safe-db-push.mjs Security Guards');
console.log('='.repeat(80));

// ============================================================================
// CATEGORY 1: AUTHORIZED PATH (should succeed with exit code 0)
// ============================================================================

console.log('\n' + '-'.repeat(80));
console.log('CATEGORY 1: AUTHORIZED PATH (exit code 0 expected)');
console.log('-'.repeat(80));

testCase('Authorized: ALLOW_ACCEPT_DATA_LOSS=true + NODE_ENV=test', () => {
  // NOTE: This will actually try to run prisma, so we expect it to fail
  // because we don't have a real database setup in test.
  // We're only checking that the GUARD allows execution (doesn't block).
  const result = runWrapper({
    ALLOW_ACCEPT_DATA_LOSS: 'true',
    NODE_ENV: 'test'
  });

  // Guard should NOT block (we check for authorization message, not prisma errors)
  assert(
    result.output.includes('AUTHORIZATION GRANTED') ||
    result.output.includes('Executing: prisma db push'),
    'Expected authorization message but guard blocked execution'
  );
});

testCase('Authorized: ALLOW_ACCEPT_DATA_LOSS=true + APP_ENV=test', () => {
  const result = runWrapper({
    ALLOW_ACCEPT_DATA_LOSS: 'true',
    APP_ENV: 'test'
  });

  assert(
    result.output.includes('AUTHORIZATION GRANTED') ||
    result.output.includes('Executing: prisma db push'),
    'Expected authorization message but guard blocked execution'
  );
});

testCase('Authorized: ALLOW_ACCEPT_DATA_LOSS=true + CI_TEST=true', () => {
  const result = runWrapper({
    ALLOW_ACCEPT_DATA_LOSS: 'true',
    CI_TEST: 'true'
  });

  assert(
    result.output.includes('AUTHORIZATION GRANTED') ||
    result.output.includes('Executing: prisma db push'),
    'Expected authorization message but guard blocked execution'
  );
});

// ============================================================================
// CATEGORY 2: BLOCKED - Production environment (exit code 1)
// ============================================================================

console.log('\n' + '-'.repeat(80));
console.log('CATEGORY 2: BLOCKED - Production environment (exit code 1)');
console.log('-'.repeat(80));

testCase('Blocked: APP_ENV=production (even with flags)', () => {
  const result = runWrapper({
    ALLOW_ACCEPT_DATA_LOSS: 'true',
    NODE_ENV: 'test',
    APP_ENV: 'production'
  });

  assert(result.exitCode === 1, `Expected exit code 1, got ${result.exitCode}`);
  assert(result.output.includes('BLOCKED'), 'Expected BLOCKED message');
  assert(result.output.includes('FORBIDDEN in production'), 'Expected production warning');
});

testCase('Blocked: CI_PROD=true (even with flags)', () => {
  const result = runWrapper({
    ALLOW_ACCEPT_DATA_LOSS: 'true',
    NODE_ENV: 'test',
    CI_PROD: 'true'
  });

  assert(result.exitCode === 1, `Expected exit code 1, got ${result.exitCode}`);
  assert(result.output.includes('BLOCKED'), 'Expected BLOCKED message');
  assert(result.output.includes('FORBIDDEN in production'), 'Expected production warning');
});

// ============================================================================
// CATEGORY 3: BLOCKED - Missing ALLOW_ACCEPT_DATA_LOSS (exit code 1)
// ============================================================================

console.log('\n' + '-'.repeat(80));
console.log('CATEGORY 3: BLOCKED - Missing ALLOW_ACCEPT_DATA_LOSS (exit code 1)');
console.log('-'.repeat(80));

testCase('Blocked: Missing ALLOW_ACCEPT_DATA_LOSS flag', () => {
  const result = runWrapper({
    NODE_ENV: 'test'
  });

  assert(result.exitCode === 1, `Expected exit code 1, got ${result.exitCode}`);
  assert(result.output.includes('BLOCKED'), 'Expected BLOCKED message');
  assert(result.output.includes('authorization flag'), 'Expected flag requirement message');
});

testCase('Blocked: ALLOW_ACCEPT_DATA_LOSS=false', () => {
  const result = runWrapper({
    ALLOW_ACCEPT_DATA_LOSS: 'false',
    NODE_ENV: 'test'
  });

  assert(result.exitCode === 1, `Expected exit code 1, got ${result.exitCode}`);
  assert(result.output.includes('BLOCKED'), 'Expected BLOCKED message');
});

// ============================================================================
// CATEGORY 4: BLOCKED - Not in test context (exit code 1)
// ============================================================================

console.log('\n' + '-'.repeat(80));
console.log('CATEGORY 4: BLOCKED - Non-test environment (exit code 1)');
console.log('-'.repeat(80));

testCase('Blocked: No environment context (empty)', () => {
  const result = runWrapper({
    ALLOW_ACCEPT_DATA_LOSS: 'true'
    // No NODE_ENV, APP_ENV, or CI_TEST
  });

  assert(result.exitCode === 1, `Expected exit code 1, got ${result.exitCode}`);
  assert(result.output.includes('BLOCKED'), 'Expected BLOCKED message');
  assert(result.output.includes('test context'), 'Expected test context requirement');
});

testCase('Blocked: APP_ENV=staging (deny-by-default)', () => {
  const result = runWrapper({
    ALLOW_ACCEPT_DATA_LOSS: 'true',
    APP_ENV: 'staging'
  });

  assert(result.exitCode === 1, `Expected exit code 1, got ${result.exitCode}`);
  assert(result.output.includes('BLOCKED'), 'Expected BLOCKED message');
  assert(result.output.includes('DENIED by default'), 'Expected deny-by-default message');
});

testCase('Blocked: NODE_ENV=development', () => {
  const result = runWrapper({
    ALLOW_ACCEPT_DATA_LOSS: 'true',
    NODE_ENV: 'development'
  });

  assert(result.exitCode === 1, `Expected exit code 1, got ${result.exitCode}`);
  assert(result.output.includes('BLOCKED'), 'Expected BLOCKED message');
});

// ============================================================================
// CATEGORY 5: SECURITY - Messages must be neutral (no env values leaked)
// ============================================================================

console.log('\n' + '-'.repeat(80));
console.log('CATEGORY 5: SECURITY - Neutral error messages');
console.log('-'.repeat(80));

testCase('Security: Error messages do not leak env values', () => {
  const result = runWrapper({
    ALLOW_ACCEPT_DATA_LOSS: 'false',
    NODE_ENV: 'test'
  });

  // Should NOT contain actual values like "ALLOW_ACCEPT_DATA_LOSS: false"
  assert(
    !result.output.match(/ALLOW_ACCEPT_DATA_LOSS:\s*(true|false|[^\n]+)/),
    'Error message leaked ALLOW_ACCEPT_DATA_LOSS value'
  );
  assert(
    !result.output.match(/NODE_ENV:\s*\w+/),
    'Error message leaked NODE_ENV value'
  );
});

// ============================================================================
// SUMMARY
// ============================================================================

console.log('\n' + '='.repeat(80));
console.log('TEST SUMMARY');
console.log('='.repeat(80));
console.log(`${GREEN}PASSED:${RESET_ENV} ${passCount}`);
console.log(`${RED}FAILED:${RESET_ENV} ${failCount}`);

if (failCount > 0) {
  console.log(`\n${RED}❌ Some tests failed.${RESET_ENV}\n`);
  exit(1);
} else {
  console.log(`\n${GREEN}✅ All tests passed!${RESET_ENV}\n`);
  exit(0);
}
