#!/usr/bin/env node

/**
 * SECURITY GUARD: Safe Prisma db push wrapper
 *
 * This script prevents accidental execution of `prisma db push --accept-data-loss`
 * in production or without explicit authorization flags.
 *
 * AUTHORIZATION RULES (ALL must be satisfied):
 * 1. ALLOW_ACCEPT_DATA_LOSS=true (explicit unlock)
 * 2. Running in test context: NODE_ENV=test OR CI_TEST_DB=true
 * 3. HARD DENY if APP_ENV=production OR CI_PROD=true (even if NODE_ENV=test)
 *
 * @see docs/SECURITY.md
 */

import { execSync } from 'child_process';
import { exit } from 'process';
import { pathToFileURL } from 'url';

function createGuardError(message) {
  const error = new Error(message);
  error.code = 'DB_PUSH_GUARD';
  return error;
}

export function evaluateDbPushGuard(env = process.env) {
  const {
    ALLOW_ACCEPT_DATA_LOSS,
    APP_ENV,
    CI_PROD,
    CI_TEST_DB,
    NODE_ENV
  } = env;

  if (APP_ENV === 'production' || CI_PROD === 'true') {
    throw createGuardError(
      '❌ BLOCKED: Production environment detected!\n' +
      `   APP_ENV: ${APP_ENV || '(not set)'}\n` +
      `   CI_PROD: ${CI_PROD || '(not set)'}\n\n` +
      '🚨 CRITICAL: prisma db push --accept-data-loss is FORBIDDEN in production.\n\n' +
      '   Use "prisma migrate deploy" for production deployments.'
    );
  }

  if (ALLOW_ACCEPT_DATA_LOSS !== 'true') {
    throw createGuardError(
      '❌ BLOCKED: Missing authorization flag.\n' +
      `   ALLOW_ACCEPT_DATA_LOSS: ${ALLOW_ACCEPT_DATA_LOSS || '(not set)'}\n\n` +
      '💡 To run db push in TEST environments only:\n\n' +
      '   ALLOW_ACCEPT_DATA_LOSS=true NODE_ENV=test npm run db:push\n' +
      '   ALLOW_ACCEPT_DATA_LOSS=true CI_TEST_DB=true npm run db:push\n\n' +
      '⚠️  NEVER set ALLOW_ACCEPT_DATA_LOSS=true in production!'
    );
  }

  const isNodeTest = NODE_ENV === 'test';
  const isCiTestDb = CI_TEST_DB === 'true';

  if (!isNodeTest && !isCiTestDb) {
    throw createGuardError(
      '❌ BLOCKED: Not running in an authorized test context.\n' +
      `   NODE_ENV: ${NODE_ENV || '(not set)'}\n` +
      `   CI_TEST_DB: ${CI_TEST_DB || '(not set)'}\n\n` +
      '💡 Set one of the following to authorize test context:\n\n' +
      '   - NODE_ENV=test\n' +
      '   - CI_TEST_DB=true\n\n' +
      '⚠️  This command is ONLY allowed in local test runs or CI test databases.'
    );
  }

  return {
    testContext: isNodeTest ? 'NODE_ENV=test' : 'CI_TEST_DB=true'
  };
}

export function main(env = process.env) {
  console.log('\n🔒 SECURITY GUARD: Checking authorization for db push --accept-data-loss...\n');

  try {
    const result = evaluateDbPushGuard(env);

    console.log('✅ Authorization granted:');
    console.log('   - ALLOW_ACCEPT_DATA_LOSS: true');
    console.log(`   - Test context verified: ${result.testContext}`);
    console.log('   - Production flags: none detected\n');
    console.log('⏳ Executing: prisma db push --skip-generate --accept-data-loss...\n');

    execSync('npx prisma db push --skip-generate --accept-data-loss --schema prisma/schema.prisma', {
      stdio: 'inherit',
      env
    });

    console.log('\n✅ Database push completed successfully.\n');
  } catch (error) {
    if (error?.code === 'DB_PUSH_GUARD') {
      console.error(`\n${error.message}\n`);
      exit(1);
    }

    console.error('\n❌ Prisma db push failed.\n');
    exit(error?.status || 1);
  }
}

const isMain = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isMain) {
  main();
}
