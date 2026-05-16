/**
 * Jest config — socket integration tests only.
 *
 * Covers all socket-*.test.ts files in src/lib/__tests__/.
 * These tests bind real HTTP servers on fixed ports (4097–4129 range) and
 * require a running Postgres DB. They are timing-sensitive and must run serially.
 *
 * maxWorkers: 1 (+ --runInBand in CI) prevents port collisions and rate-limiter
 * state interference between test files.
 *
 * Usage:
 *   NODE_ENV=test pnpm --filter @blobinfini/api exec jest \
 *     --config jest.socket.config.cjs --runInBand --no-coverage
 *
 * CI: used by the socket-tests job which runs in parallel with build-and-test
 * on a dedicated Postgres service — no shared DB between the two jobs.
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
  // Matches all socket-*.test.ts files (server-bound + pure schema/guard tests).
  // When adding a socket test file, name it socket-*.test.ts — no further config needed.
  testMatch: [
    '<rootDir>/src/lib/__tests__/socket*.test.ts',
  ],
  setupFiles: ['<rootDir>/jest.setup.env.ts', '<rootDir>/jest.setup.secrets.ts'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.db.ts', '<rootDir>/jest.setup.redis.ts', '<rootDir>/jest.setup.ts'],
  // Serial execution mandatory: tests bind fixed ports and share in-process rate-limiter state.
  maxWorkers: 1,
  forceExit: true,
  detectOpenHandles: true,
};

module.exports = config;
