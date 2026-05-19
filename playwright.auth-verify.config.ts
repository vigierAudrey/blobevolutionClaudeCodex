/**
 * Minimal Playwright config for auth-verify-flow spec.
 *
 * Two modes:
 *   1. Servers already running (fast): set SKIP_E2E_SERVERS=1
 *      SKIP_E2E_SERVERS=1 SKIP_E2E_RESEED=1 npx playwright test --config=playwright.auth-verify.config.ts
 *
 *   2. Auto-start (autonomous, slower): omit SKIP_E2E_SERVERS
 *      SKIP_E2E_RESEED=1 npx playwright test --config=playwright.auth-verify.config.ts
 *
 * Always requires Mailpit on http://localhost:8025 (start with: docker run -p 8025:8025 -p 1025:1025 axllent/mailpit)
 */
import { defineConfig, devices } from '@playwright/test';

const webPort = parseInt(process.env.E2E_WEB_PORT ?? '3002', 10);
const apiPort = parseInt(process.env.E2E_API_PORT ?? '4000', 10);
const skipServers = process.env.SKIP_E2E_SERVERS === '1';

process.env.PLAYWRIGHT_API_URL = `http://localhost:${apiPort}`;
process.env.PLAYWRIGHT_BASE_URL = `http://localhost:${webPort}`;
process.env.PLAYWRIGHT_WEB_BASE = `http://localhost:${webPort}`;

export default defineConfig({
  testDir: './apps/web/tests/e2e',
  testMatch: '**/auth-verify-flow.spec.ts',
  timeout: 60_000,
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
  webServer: skipServers
    ? []
    : [
        {
          command: 'npm run dev --workspace @blobinfini/api',
          url: `http://localhost:${apiPort}/health`,
          env: {
            ...process.env,
            PORT: String(apiPort),
            SMTP_HOST: '127.0.0.1',
            SMTP_PORT: '1025',
            SMTP_ALLOW_NO_AUTH: 'true',
            SMTP_USER: '',
            SMTP_PASS: '',
          },
          reuseExistingServer: true,
          stdout: 'pipe',
          stderr: 'pipe',
          timeout: 180_000,
        },
        {
          command: `cd apps/web && npx next dev -p ${webPort}`,
          url: `http://localhost:${webPort}`,
          env: {
            ...process.env,
            PORT: String(webPort),
            NEXT_PUBLIC_API_URL: `http://localhost:${apiPort}`,
          },
          reuseExistingServer: true,
          stdout: 'pipe',
          stderr: 'pipe',
          timeout: 180_000,
        },
      ],
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
