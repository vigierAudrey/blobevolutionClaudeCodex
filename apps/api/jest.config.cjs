/** @type {import('jest').Config} */
const config = {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  // Global setup: DB schema prepared ONCE per Jest run
  globalSetup: '<rootDir>/jest.global-setup.cjs',
  transform: {
    '^.+\\.(ts|tsx)$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: 'tsconfig.json'
      }
    ]
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^@blobinfini/database$': '<rootDir>/../../packages/database/src/index.ts',
    // Mock du service push pour éviter les warnings PUSH_SERVICE_NOT_INITIALIZED
    '^.*/services/push-notification\\.service$': '<rootDir>/src/services/__mocks__/push-notification.service.ts'
  },
  roots: ['<rootDir>/src'],
  // Tests handled by other configs/jobs — excluded here to avoid double execution.
  testPathIgnorePatterns: [
    '/node_modules/',
    // Moved to api-unit-fast job (jest.unit.config.cjs) — runs without Postgres
    '\\.unit\\.test\\.ts$',
    '/lib/__tests__/geoGrid\\.test\\.ts$',
    '/lib/__tests__/hash-email\\.test\\.ts$',
    '/lib/__tests__/hash-ip\\.test\\.ts$',
    '/lib/__tests__/client-ip\\.test\\.ts$',
    '/lib/__tests__/france-launch-guard\\.test\\.ts$',
    '/lib/__tests__/env-validation\\.admin-hardening\\.test\\.ts$',
    '/lib/__tests__/env-validation\\.email-hash\\.test\\.ts$',
    '/lib/__tests__/env-validation\\.smtp-vps\\.test\\.ts$',
    '/observability/__tests__/log-serializer\\.test\\.ts$',
    '/observability/__tests__/log-transport\\.test\\.ts$',
    '/lib/__tests__/no-tokens-in-source\\.test\\.ts$',
    '/middleware/__tests__/validate\\.test\\.ts$',
    '/middleware/__tests__/http-access-log\\.test\\.ts$',
    '/modules/auth/__tests__/login-attempt\\.util\\.test\\.ts$',
    // Moved to nightly.yml simulation-tests job (too heavy for per-PR CI)
    '/chat/__tests__/active-user-simulation\\.e2e\\.test\\.ts$',
    // Moved to socket-tests job (jest.socket.config.cjs) — fixed ports, timing-sensitive, serial-required.
    // All files matching /lib/__tests__/socket*.test.ts are excluded here.
    '/lib/__tests__/socket',
  ],
  setupFiles: ['<rootDir>/jest.setup.env.ts', '<rootDir>/jest.setup.secrets.ts'],
  maxWorkers: 1,
  setupFilesAfterEnv: ['<rootDir>/jest.setup.db.ts', '<rootDir>/jest.setup.redis.ts', '<rootDir>/jest.setup.ts'],
  // Force Jest to exit after tests complete
  forceExit: true,
  // Detect open handles to help debug hanging tests
  detectOpenHandles: true,

  // Configuration Coverage
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/**/*.test.ts',
    '!src/**/__tests__/**',
    '!src/**/types/**',
    '!src/test-utils/**',
    '!src/scripts/**',
    '!src/index.ts', // Point d'entrée, difficile à tester
  ],
  coverageThreshold: {
    global: {
      statements: 80,
      branches: 75,
      functions: 80,
      lines: 80,
    },
  },
  coverageReporters: ['text', 'text-summary', 'html', 'lcov'],
  coverageDirectory: '<rootDir>/coverage',
};

module.exports = config;
