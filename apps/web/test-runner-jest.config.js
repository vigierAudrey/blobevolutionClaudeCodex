const { getJestConfig } = require('@storybook/test-runner');

// The default Jest configuration comes from @storybook/test-runner
const testRunnerConfig = getJestConfig();

/**
 * @type {import('@jest/types').Config.InitialOptions}
 */
module.exports = {
  ...testRunnerConfig,
  /** Add your own overrides below, and make sure
   *  to merge testRunnerConfig properties with your own
   * @see https://jestjs.io/docs/configuration
   */

  // Ignore apps/api/dist to prevent "duplicate manual mock" errors
  modulePathIgnorePatterns: [
    ...(testRunnerConfig.modulePathIgnorePatterns || []),
    '/apps/api/dist/',
    '/apps/api/node_modules/',
  ],

  // Watch ignore patterns
  watchPathIgnorePatterns: [
    ...(testRunnerConfig.watchPathIgnorePatterns || []),
    '/apps/api/',
  ],

  // Test path ignore patterns (merge with defaults)
  testPathIgnorePatterns: [
    ...(testRunnerConfig.testPathIgnorePatterns || []),
    '/apps/api/',
  ],
};
