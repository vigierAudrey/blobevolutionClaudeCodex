import { defineConfig, devices } from '@playwright/test';
process.env.PLAYWRIGHT_SKIP_LAST_RUN = '1';

const finalWebPort = parseInt(process.env.E2E_WEB_PORT ?? '3020', 10);
const finalApiPort = parseInt(process.env.E2E_API_PORT ?? '4020', 10);

const baseURL = `http://127.0.0.1:${finalWebPort}`;
const apiURL = `http://127.0.0.1:${finalApiPort}`;

process.env.PLAYWRIGHT_BASE_URL = baseURL;
process.env.PLAYWRIGHT_API_URL = apiURL;

const safeTestEnv = {
  ALLOWED_ORIGINS: `${baseURL},http://127.0.0.1:${finalWebPort}`,
  SMTP_HOST: '127.0.0.1',
  SMTP_PORT: '1025',
  SMTP_ALLOW_NO_AUTH: 'true',
  SMTP_USER: '',
  SMTP_PASS: '',
  TRUST_PROXY_MODE: 'loopback',
  FIREBASE_PROJECT_ID: 'blobinfini-demo',
  FIREBASE_CLIENT_EMAIL: '',
  FIREBASE_PRIVATE_KEY: '',
  NEXT_PUBLIC_FIREBASE_API_KEY: '',
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: '',
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: '',
  NEXT_PUBLIC_FIREBASE_APP_ID: '',
  NEXT_PUBLIC_FIREBASE_VAPID_KEY: '',
  WEBHOOK_URL: '',
  N8N_WEBHOOK_URL: '',
};

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 45_000,
  outputDir: '../../playwright-out',
  globalSetup: './playwright.global-setup.ts',
  expect: {
    timeout: 7_000,
  },
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI
    ? [['github'], ['html', { outputFolder: '../../playwright-report', open: 'never' }]]
    : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'pnpm --filter @blobinfini/api run dev',
      url: `${apiURL}/health`,
      env: {
        ...process.env,
        ...safeTestEnv,
        PORT: String(finalApiPort),
      },
      reuseExistingServer: false,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 180_000,
    },
    {
      // Requires a pre-built .next/ in apps/web/ — run build with NEXT_PUBLIC_API_URL set first.
      // next dev is too slow (cold-compile >180s). NEXT_PUBLIC_API_URL is baked at build time.
      command: 'npx next start -p $PORT',
      url: baseURL,
      env: {
        ...process.env,
        ...safeTestEnv,
        PORT: String(finalWebPort),
      },
      reuseExistingServer: false,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 60_000,
    },
  ],
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
