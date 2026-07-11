export default {
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
    '^~/(.*)$': '<rootDir>/$1',
    '\\.css$': '<rootDir>/__mocks__/styleMock.js',
  },
  transform: {
    '^.+\\.(js|jsx|ts|tsx)$': ['@swc/jest'],
  },
  // next-intl / use-intl sont distribués en ESM uniquement : ils doivent être
  // transformés par swc (layout pnpm : node_modules/.pnpm/<pkg>@<version>/...).
  transformIgnorePatterns: [
    '/node_modules/\\.pnpm/(?!(next-intl@|use-intl@|intl-messageformat@|@formatjs\\+))',
    '/node_modules/(?!(\\.pnpm|next-intl|use-intl|intl-messageformat|@formatjs)/)',
  ],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx'],
  collectCoverageFrom: [
    'app/**/*.{ts,tsx}',
    'components/**/*.{ts,tsx}',
    'lib/**/*.{ts,tsx}',
    '!**/*.d.ts',
    '!**/node_modules/**',
  ],
  testMatch: [
    '<rootDir>/**/__tests__/**/*.{js,jsx,ts,tsx}',
    '<rootDir>/**/*.{test,spec}.{js,jsx,ts,tsx}',
  ],
  testPathIgnorePatterns: [
    '<rootDir>/.next/',
    '<rootDir>/node_modules/',
    '<rootDir>/tests/e2e/', // Exclure les tests Playwright
  ],
};