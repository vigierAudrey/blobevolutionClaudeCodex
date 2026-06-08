/**
 * Jest config — active-user-simulation only.
 *
 * This test is too heavy for per-PR CI (creates many users, measures fan-out
 * timing). It runs nightly in full isolation with a fresh DB.
 *
 * Usage:
 *   NODE_ENV=test JEST_DB_PREPARED=true NIGHTLY_ISOLATION=true \
 *   pnpm --filter @blobinfini/api exec jest \
 *     --config jest.simulation.config.cjs --runInBand --forceExit
 *
 * CI: nightly.yml simulation-tests job.
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
    '<rootDir>/src/modules/chat/__tests__/active-user-simulation.e2e.test.ts',
  ],
  setupFiles: ['<rootDir>/jest.setup.env.ts', '<rootDir>/jest.setup.secrets.ts'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.db.ts', '<rootDir>/jest.setup.redis.ts', '<rootDir>/jest.setup.ts'],
  maxWorkers: 1,
  forceExit: true,
  detectOpenHandles: true,
};

module.exports = config;
