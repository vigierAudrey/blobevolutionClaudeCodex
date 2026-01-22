#!/usr/bin/env node

/**
 * SECURITY GUARD: Safe Prisma db push wrapper
 *
 * This script prevents accidental execution of `prisma db push --accept-data-loss`
 * in production or without explicit authorization flags.
 *
 * AUTHORIZATION RULES (ALL must be satisfied):
 * 1. ALLOW_ACCEPT_DATA_LOSS=true (explicit unlock)
 * 2. Running in test context: NODE_ENV=test OR APP_ENV=test OR CI_TEST=true
 * 3. HARD DENY if APP_ENV=production OR CI_PROD=true (even if NODE_ENV=test)
 *
 * @see docs/SECURITY.md
 */

import { execSync } from 'child_process';
import { exit } from 'process';

// Read environment variables
const ALLOW_ACCEPT_DATA_LOSS = process.env.ALLOW_ACCEPT_DATA_LOSS;
const NODE_ENV = process.env.NODE_ENV;
const APP_ENV = process.env.APP_ENV;
const CI_TEST = process.env.CI_TEST;
const CI_PROD = process.env.CI_PROD;

console.log('\n🔒 SECURITY GUARD: Checking authorization for db push --accept-data-loss...\n');

// RULE 1: HARD DENY if production environment detected
if (APP_ENV === 'production' || CI_PROD === 'true') {
  console.error('❌ BLOCKED: Production environment detected.');
  console.error('\n🚨 CRITICAL: prisma db push --accept-data-loss is FORBIDDEN in production.\n');
  console.error('   Use "prisma migrate deploy" for production deployments.\n');
  console.error('   Detected via: APP_ENV or CI_PROD flags.\n');
  exit(1);
}

// RULE 2: Check explicit unlock flag
if (ALLOW_ACCEPT_DATA_LOSS !== 'true') {
  console.error('❌ BLOCKED: Missing required authorization flag.\n');
  console.error('💡 To run db push in TEST environments only:\n');
  console.error('   ALLOW_ACCEPT_DATA_LOSS=true NODE_ENV=test npm run db:push\n');
  console.error('⚠️  Required: ALLOW_ACCEPT_DATA_LOSS must be set to "true".');
  console.error('⚠️  NEVER set this flag in production!\n');
  exit(1);
}

// RULE 3: Verify test context (WHITELIST: only explicit test environments)
const isTestContext = NODE_ENV === 'test' || APP_ENV === 'test' || CI_TEST === 'true';

if (!isTestContext) {
  console.error('❌ BLOCKED: Not running in explicit test context.\n');
  console.error('💡 Required: Set one of the following environment variables:\n');
  console.error('   - NODE_ENV=test');
  console.error('   - APP_ENV=test');
  console.error('   - CI_TEST=true\n');
  console.error('⚠️  This command is ONLY allowed in test environments.');
  console.error('⚠️  All other environments (including staging) are DENIED by default.\n');
  exit(1);
}

// ALL CHECKS PASSED: Execute Prisma db push
console.log('✅ AUTHORIZATION GRANTED:');
console.log('   - Required flags verified');
console.log('   - Test context confirmed');
console.log('   - Production checks passed\n');
console.log('⏳ Executing: prisma db push --skip-generate --accept-data-loss...\n');

try {
  execSync('npx prisma db push --skip-generate --accept-data-loss --schema prisma/schema.prisma', {
    stdio: 'inherit',
    env: process.env
  });
  console.log('\n✅ Database push completed successfully.\n');
} catch (error) {
  console.error('\n❌ Prisma db push failed.\n');
  exit(error.status || 1);
}
