/**
 * Jest config — pure unit tests only.
 *
 * Matches files named *.unit.test.ts. These tests must not touch the DB or
 * Redis (they mock those dependencies). No globalSetup, no seed, no Postgres
 * service required → can run in parallel (maxWorkers: auto) and without a
 * running database.
 *
 * Usage:
 *   pnpm --filter @blobinfini/api exec jest --config jest.unit.config.cjs
 *
 * CI: intended as a fast-feedback job that runs in parallel with lint/type-check,
 * before build-and-test spins up Postgres.
 */

/** @type {import('jest').Config} */
const config = {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  transform: {
    '^.+\\.(ts|tsx)$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: 'tsconfig.json',
      },
    ],
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^@blobinfini/database$': '<rootDir>/../../packages/database/src/index.ts',
    '^.*/services/push-notification\\.service$':
      '<rootDir>/src/services/__mocks__/push-notification.service.ts',
  },
  roots: ['<rootDir>/src'],
  // *.unit.test.ts + pure-unit tests confirmed DB-free (no createApp, no Prisma queries, no Redis).
  // When adding a file here, also add it to testPathIgnorePatterns in jest.config.cjs.
  testMatch: [
    '**/*.unit.test.ts',
    '<rootDir>/src/lib/__tests__/geoGrid.test.ts',
    '<rootDir>/src/lib/__tests__/hash-email.test.ts',
    '<rootDir>/src/lib/__tests__/hash-ip.test.ts',
    '<rootDir>/src/lib/__tests__/client-ip.test.ts',
    '<rootDir>/src/lib/__tests__/france-launch-guard.test.ts',
    '<rootDir>/src/lib/__tests__/env-validation.admin-hardening.test.ts',
    '<rootDir>/src/lib/__tests__/env-validation.email-hash.test.ts',
    '<rootDir>/src/lib/__tests__/env-validation.smtp-vps.test.ts',
    '<rootDir>/src/observability/__tests__/log-serializer.test.ts',
    '<rootDir>/src/observability/__tests__/log-transport.test.ts',
    '<rootDir>/src/lib/__tests__/no-tokens-in-source.test.ts',
    '<rootDir>/src/middleware/__tests__/validate.test.ts',
    '<rootDir>/src/middleware/__tests__/http-access-log.test.ts',
    '<rootDir>/src/modules/auth/__tests__/login-attempt.util.test.ts',
  ],
  // No globalSetup: unit tests must not require a running Postgres or migrations.
  // No setupFilesAfterEnv targeting jest.setup.db.ts (would call resetDb on each test).
  setupFiles: ['<rootDir>/jest.setup.env.ts', '<rootDir>/jest.setup.secrets.ts'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.redis.ts', '<rootDir>/jest.setup.ts'],
  // Unit tests are DB-free → can safely run in parallel.
  maxWorkers: 'auto',
  forceExit: true,
  detectOpenHandles: true,
};

module.exports = config;
