/**
 * Jest config — matching module tests only.
 *
 * Scoped to the matching module (search, decisions, quota, metrics, geospatial).
 * maxWorkers: 1 prevents parallel DB writes that could collide (matching decisions
 * write MatchDecision rows; reciprocal ACCEPT logic is not idempotent under parallel load).
 *
 * Usage:
 *   pnpm --filter @blobinfini/api exec jest --config jest.matching.config.cjs
 *
 * CI: used by matching-ci.yml which runs on every PR for fast matching regression detection.
 */

/** @type {import('jest').Config} */
const config = {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  globalSetup: '<rootDir>/jest.global-setup.cjs',
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
  testMatch: [
    '<rootDir>/src/modules/matching/**/*.test.ts',
    '<rootDir>/src/modules/matching/**/*.spec.ts',
  ],
  setupFiles: ['<rootDir>/jest.setup.env.ts', '<rootDir>/jest.setup.secrets.ts'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.db.ts', '<rootDir>/jest.setup.redis.ts', '<rootDir>/jest.setup.ts'],
  // Keep sequential: matching decisions involve DB transactions and reciprocal-ACCEPT
  // logic that is not safe to parallelize (P2002 collisions without runInBand).
  maxWorkers: 1,
  forceExit: true,
  detectOpenHandles: true,
};

module.exports = config;
