import { defineConfig, devices } from '@playwright/test';
import waitPort from 'wait-port';

process.env.PLAYWRIGHT_SKIP_LAST_RUN = '1';

const finalWebPort = parseInt(process.env.E2E_WEB_PORT ?? '3020', 10);
const finalApiPort = parseInt(process.env.E2E_API_PORT ?? '4020', 10);

console.info(`[E2E] Configured ports: web=${finalWebPort}, api=${finalApiPort}`);

const baseURL = `http://localhost:${finalWebPort}`;
const apiURL = `http://localhost:${finalApiPort}`;

process.env.PLAYWRIGHT_BASE_URL = baseURL;
process.env.PLAYWRIGHT_API_URL = apiURL;

async function waitForServer(port: number, label: string) {
  const ready = await waitPort({ host: '127.0.0.1', port, timeout: 180_000 });
  if (!ready) {
    throw new Error(`[E2E] ❌ ${label} did not start on port ${port} within 180s`);
  }
  console.info(`[E2E] ✅ ${label} ready on port ${port}`);
}

export default defineConfig({
  testDir: './apps/web/tests/e2e',
  timeout: 45_000,
  // Avoid root-owned default 'test-results' folder in some environments
  outputDir: 'playwright-out',
  globalSetup: './playwright.global-setup.ts',
  expect: {
    timeout: 7_000,
  },
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI
    ? [['github'], ['html', { outputFolder: 'playwright-report', open: 'never' }]]
    : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'npm run dev --workspace @blobinfini/api',
      url: `${apiURL}/health`,
      env: {
        ...process.env,
        PORT: String(finalApiPort),
      },
      reuseExistingServer: false,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 180_000,
    },
    {
      command: 'npm run dev --workspace @blobinfini/web',
      url: baseURL,
      env: {
        ...process.env,
        PORT: String(finalWebPort),
        NEXT_PUBLIC_API_URL: apiURL,
      },
      reuseExistingServer: false,
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
  hooks: {
    async preRun() {
      console.info('[E2E] Waiting for servers to start…');
      await waitForServer(finalApiPort, 'API server');
      await waitForServer(finalWebPort, 'Web server');
      console.info('[E2E] Environment ready. Running Playwright tests…');
    },
  },
});
