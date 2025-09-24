import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
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
    '^@blobinfini/database$': '<rootDir>/../../packages/database/src/index.ts'
  },
  roots: ['<rootDir>/src'],
  maxWorkers: 1,
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  // Force Jest to exit after tests complete
  forceExit: true,
  // Detect open handles to help debug hanging tests
  detectOpenHandles: true
}; 

export default config;
