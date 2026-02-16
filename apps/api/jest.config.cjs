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
