/**
 * Minimal Playwright config for auth-verify-flow spec.
 * Assumes dev servers are already running:
 *   - API on http://localhost:4000
 *   - Web on http://localhost:3002
 *   - Mailpit on http://localhost:8025
 *
 * Run: SKIP_E2E_RESEED=1 npx playwright test --config=playwright.auth-verify.config.ts
 */
import { defineConfig, devices } from '@playwright/test';

const webPort = parseInt(process.env.E2E_WEB_PORT ?? '3002', 10);
const apiPort = parseInt(process.env.E2E_API_PORT ?? '4000', 10);

process.env.PLAYWRIGHT_API_URL = `http://localhost:${apiPort}`;
process.env.PLAYWRIGHT_BASE_URL = `http://localhost:${webPort}`;
process.env.PLAYWRIGHT_WEB_BASE = `http://localhost:${webPort}`;

export default defineConfig({
  testDir: './apps/web/tests/e2e',
  testMatch: '**/auth-verify-flow.spec.ts',
  timeout: 30_000,
  outputDir: 'playwright-out',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${webPort}`,
    headless: true,
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
