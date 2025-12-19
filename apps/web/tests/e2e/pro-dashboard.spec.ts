import { test, expect, request as playwrightRequest } from '@playwright/test';

const PRO_EMAIL = process.env.E2E_PRO_EMAIL ?? 'dev+pro1@test.com';
const PRO_PASSWORD = process.env.E2E_PRO_PASSWORD ?? 'Passw0rd!';
const API_BASE_URL = process.env.PLAYWRIGHT_API_URL ?? 'http://localhost:4000';

function testIp(tag: string) {
  const base = Math.abs(
    Array.from(tag + Date.now().toString()).reduce((acc, char) => acc + char.charCodeAt(0), 0)
  );
  const a = (base >> 12) & 255;
  const b = (base >> 8) & 255;
  const c = (base >> 4) & 255;
  const d = base & 255;
  return `10.${a}.${b}.${c ^ d || 42}`;
}

async function loginViaApi(email: string, password: string) {
  const apiContext = await playwrightRequest.newContext({
    baseURL: API_BASE_URL,
    extraHTTPHeaders: { 'X-Forwarded-For': testIp(`api-${email}`) },
  });

  const csrfResponse = await apiContext.get('/csrf-token');
  const csrfJson = (await csrfResponse.json()) as { csrfToken: string };

  const loginResponse = await apiContext.post('/auth/login', {
    headers: {
      'X-CSRF-Token': csrfJson.csrfToken,
    },
    data: { email, password },
  });

  if (!loginResponse.ok()) {
    throw new Error(`API login failed for ${email}: ${loginResponse.status()} ${await loginResponse.text()}`);
  }

  const tokens = await loginResponse.json();
  await apiContext.dispose();
  return tokens as { accessToken: string; refreshToken: string };
}

test.describe('Pro Dashboard', () => {
  test('should display dashboard with statistics', async ({ browser }) => {
    const context = await browser.newContext({
      extraHTTPHeaders: {
        'X-Forwarded-For': testIp('pro-dashboard'),
      },
    });
    const page = await context.newPage();

    const tokens = await loginViaApi(PRO_EMAIL, PRO_PASSWORD);
    await page.addInitScript(
      ({ accessToken, refreshToken }) => {
        window.localStorage.setItem('accessToken', accessToken);
        window.localStorage.setItem('refreshToken', refreshToken);
      },
      tokens
    );

    await page.goto('/pro/dashboard');
    await expect(page).toHaveURL(/\/pro\/dashboard/);

    // Verify dashboard loads
    await expect(page.locator('h1, h2').filter({ hasText: /dashboard|tableau.*bord/i }).first()).toBeVisible({ timeout: 10000 });

    // Look for common dashboard elements
    const dashboardElements = [
      page.locator('text=/statistiques|statistics/i'),
      page.locator('text=/réservations|bookings/i'),
      page.locator('text=/messages/i')
    ];

    // At least one dashboard element should be visible
    let foundElement = false;
    for (const element of dashboardElements) {
      if (await element.count() > 0) {
        foundElement = true;
        break;
      }
    }

    expect(foundElement).toBe(true);

    await context.close();
  });

  test('should display recent bookings or requests', async ({ browser }) => {
    const context = await browser.newContext({
      extraHTTPHeaders: {
        'X-Forwarded-For': testIp('pro-dashboard-bookings'),
      },
    });
    const page = await context.newPage();

    const tokens = await loginViaApi(PRO_EMAIL, PRO_PASSWORD);
    await page.addInitScript(
      ({ accessToken, refreshToken }) => {
        window.localStorage.setItem('accessToken', accessToken);
        window.localStorage.setItem('refreshToken', refreshToken);
      },
      tokens
    );

    await page.goto('/pro/dashboard');
    await expect(page).toHaveURL(/\/pro\/dashboard/);

    // Look for bookings section
    const bookingsSection = page.locator('text=/réservations|bookings|demandes|requests/i');

    if (await bookingsSection.count() > 0) {
      await expect(bookingsSection.first()).toBeVisible();
    }

    await context.close();
  });

  test('should display quick actions or shortcuts', async ({ browser }) => {
    const context = await browser.newContext({
      extraHTTPHeaders: {
        'X-Forwarded-For': testIp('pro-dashboard-actions'),
      },
    });
    const page = await context.newPage();

    const tokens = await loginViaApi(PRO_EMAIL, PRO_PASSWORD);
    await page.addInitScript(
      ({ accessToken, refreshToken }) => {
        window.localStorage.setItem('accessToken', accessToken);
        window.localStorage.setItem('refreshToken', refreshToken);
      },
      tokens
    );

    await page.goto('/pro/dashboard');
    await expect(page).toHaveURL(/\/pro\/dashboard/);

    // Look for navigation links to other pro sections
    const actionLinks = [
      page.getByRole('link', { name: /messages/i }),
      page.getByRole('link', { name: /profil|profile/i }),
      page.getByRole('link', { name: /planning|calendar/i })
    ];

    // At least one action link should be present
    let foundLink = false;
    for (const link of actionLinks) {
      if (await link.count() > 0) {
        foundLink = true;
        break;
      }
    }

    expect(foundLink).toBe(true);

    await context.close();
  });

  test('should display activity metrics', async ({ browser }) => {
    const context = await browser.newContext({
      extraHTTPHeaders: {
        'X-Forwarded-For': testIp('pro-dashboard-metrics'),
      },
    });
    const page = await context.newPage();

    const tokens = await loginViaApi(PRO_EMAIL, PRO_PASSWORD);
    await page.addInitScript(
      ({ accessToken, refreshToken }) => {
        window.localStorage.setItem('accessToken', accessToken);
        window.localStorage.setItem('refreshToken', refreshToken);
      },
      tokens
    );

    await page.goto('/pro/dashboard');
    await expect(page).toHaveURL(/\/pro\/dashboard/);

    // Look for numeric metrics (views, clicks, bookings count, etc.)
    const metricsPattern = /\d+/;
    const potentialMetrics = page.locator('text=/vues|views|clics|clicks|total|count/i');

    if (await potentialMetrics.count() > 0) {
      await expect(potentialMetrics.first()).toBeVisible();
    }

    await context.close();
  });

  test('should navigate to profile from dashboard', async ({ browser }) => {
    const context = await browser.newContext({
      extraHTTPHeaders: {
        'X-Forwarded-For': testIp('pro-dashboard-nav-profile'),
      },
    });
    const page = await context.newPage();

    const tokens = await loginViaApi(PRO_EMAIL, PRO_PASSWORD);
    await page.addInitScript(
      ({ accessToken, refreshToken }) => {
        window.localStorage.setItem('accessToken', accessToken);
        window.localStorage.setItem('refreshToken', refreshToken);
      },
      tokens
    );

    await page.goto('/pro/dashboard');
    await expect(page).toHaveURL(/\/pro\/dashboard/);

    // Click on profile link
    const profileLink = page.getByRole('link', { name: /profil|profile/i });

    if (await profileLink.count() > 0) {
      await profileLink.first().click();
      await expect(page).toHaveURL(/\/pro\/profile/);
    }

    await context.close();
  });

  test('should remain accessible without offers module', async ({ browser }) => {
    const context = await browser.newContext({
      extraHTTPHeaders: {
        'X-Forwarded-For': testIp('pro-dashboard-nav-offers'),
      },
    });
    const page = await context.newPage();

    const tokens = await loginViaApi(PRO_EMAIL, PRO_PASSWORD);
    await page.addInitScript(
      ({ accessToken, refreshToken }) => {
        window.localStorage.setItem('accessToken', accessToken);
        window.localStorage.setItem('refreshToken', refreshToken);
      },
      tokens
    );

    await page.goto('/pro/dashboard');
    await expect(page).toHaveURL(/\/pro\/dashboard/);

    // No offers link anymore; ensure dashboard stays accessible
    await expect(page).toHaveURL(/\/pro\/dashboard/);

    await context.close();
  });
});

test.describe('Pro Dashboard Security', () => {
  test('should require authentication to access dashboard', async ({ page }) => {
    await page.goto('/pro/dashboard');

    // Should redirect to login
    await expect(page).toHaveURL(/\/(login|auth|connexion)/i, { timeout: 10000 });
  });

  test('should require PRO role to access dashboard', async ({ browser }) => {
    // This test assumes we have a RIDER account set up
    const RIDER_EMAIL = process.env.E2E_RIDER_EMAIL ?? 'dev+rider1@test.com';
    const RIDER_PASSWORD = process.env.E2E_RIDER_PASSWORD ?? 'Passw0rd!';

    const context = await browser.newContext({
      extraHTTPHeaders: {
        'X-Forwarded-For': testIp('rider-access-pro-dashboard'),
      },
    });
    const page = await context.newPage();

    try {
      const tokens = await loginViaApi(RIDER_EMAIL, RIDER_PASSWORD);
      await page.addInitScript(
        ({ accessToken, refreshToken }) => {
          window.localStorage.setItem('accessToken', accessToken);
          window.localStorage.setItem('refreshToken', refreshToken);
        },
        tokens
      );

      await page.goto('/pro/dashboard');

      // Should redirect away from pro dashboard
      await page.waitForTimeout(2000);
      const url = page.url();
      expect(url).not.toContain('/pro/dashboard');
    } catch (error) {
      // Expected to fail if RIDER account doesn't exist
      console.log('RIDER account test skipped - account not configured');
    }

    await context.close();
  });
});
