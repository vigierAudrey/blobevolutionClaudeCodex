import { test, expect, request as playwrightRequest } from '@playwright/test';

const API_BASE_URL = process.env.PLAYWRIGHT_API_URL ?? 'http://localhost:4000';
const DEFAULT_PASSWORD = process.env.E2E_DEFAULT_PASSWORD ?? 'Passw0rd!';

function testIp(tag: string) {
  const base = Math.abs(
    Array.from(`${tag}-${Date.now()}-${Math.random()}`)
      .reduce((acc, char) => acc + char.charCodeAt(0), 0)
  );
  const a = (base >> 12) & 255;
  const b = (base >> 8) & 255;
  const c = (base >> 4) & 255;
  const d = base & 255;
  return `10.${a}.${b}.${c ^ d || 99}`;
}

async function loginViaApi(email: string, tag: string) {
  const apiContext = await playwrightRequest.newContext({
    baseURL: API_BASE_URL,
    extraHTTPHeaders: { 'X-Forwarded-For': testIp(`api-${tag}`) },
  });
  const csrfResponse = await apiContext.get('/csrf-token');
  if (!csrfResponse.ok()) {
    throw new Error(`Unable to fetch CSRF token (${csrfResponse.status()})`);
  }
  const csrfJson = (await csrfResponse.json()) as { csrfToken: string };

  const loginResponse = await apiContext.post('/auth/login', {
    headers: { 'X-CSRF-Token': csrfJson.csrfToken },
    data: { email, password: DEFAULT_PASSWORD },
  });

  if (!loginResponse.ok()) {
    throw new Error(`Login failed for ${email}: ${loginResponse.status()} ${await loginResponse.text()}`);
  }

  const tokens = (await loginResponse.json()) as { accessToken: string; refreshToken: string };
  await apiContext.dispose();
  return tokens;
}

test.describe('Admin dashboard access control', () => {
  test('redirects unauthenticated users to login', async ({ page }) => {
    await page.goto('/admin/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });

  test('prevents rider from accessing admin dashboard', async ({ browser }) => {
    const riderEmail = process.env.E2E_RIDER_EMAIL ?? 'dev+rider1@test.com';
    const tokens = await loginViaApi(riderEmail, 'admin-gate-rider');

    const context = await browser.newContext();
    await context.addInitScript(
      ({ accessToken, refreshToken }) => {
        window.localStorage.setItem('accessToken', accessToken);
        window.localStorage.setItem('refreshToken', refreshToken);
      },
      tokens
    );
    const page = await context.newPage();
    await page.goto('/admin/dashboard');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/dashboard/);
    await context.close();
  });

  test('allows admin to access dashboard', async ({ browser }) => {
    const tokens = await loginViaApi('dev+admin@test.com', 'admin-gate-admin');
    const context = await browser.newContext();
    await context.addInitScript(
      ({ accessToken, refreshToken }) => {
        window.localStorage.setItem('accessToken', accessToken);
        window.localStorage.setItem('refreshToken', refreshToken);
      },
      tokens
    );
    const page = await context.newPage();
    await page.goto('/admin/dashboard');
    await expect(page.getByRole('heading', { name: 'Administration' })).toBeVisible();
    await context.close();
  });
});
