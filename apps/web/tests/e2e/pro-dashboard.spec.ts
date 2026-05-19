import { test, expect } from '@playwright/test';
import { loginWithCookieSession } from './helpers/auth';

const PRO_EMAIL = process.env.E2E_PRO_EMAIL ?? 'dev+pro1@test.com';
const PRO_PASSWORD = process.env.E2E_PRO_PASSWORD ?? 'Passw0rd!';
const RIDER_EMAIL = process.env.E2E_RIDER_EMAIL ?? 'dev+rider1@test.com';
const RIDER_PASSWORD = process.env.E2E_RIDER_PASSWORD ?? 'Passw0rd!';

test.describe('Pro Dashboard', () => {
  test('should display dashboard with statistics', async ({ browser }) => {
    const context = await loginWithCookieSession(browser, PRO_EMAIL, {
      password: PRO_PASSWORD,
      tag: 'pro-dashboard',
    });
    const page = await context.newPage();

    await page.goto('/pro/dashboard');
    await expect(page).toHaveURL(/\/pro\/dashboard/);

    // Wait for auth + async data load — heading only appears after me() resolves
    await expect(
      page.locator('h1, h2').filter({ hasText: /dashboard|tableau.*bord/i }).first(),
    ).toBeVisible({ timeout: 10_000 });

    // At least one section keyword must be visible after data loads
    const dashboardContent = page.locator(
      'text=/statistiques|statistics|réservations|bookings|messages/i',
    );
    await expect
      .poll(() => dashboardContent.count(), { timeout: 10_000 })
      .toBeGreaterThan(0);

    await context.close();
  });

  test('should display recent bookings or requests', async ({ browser }) => {
    const context = await loginWithCookieSession(browser, PRO_EMAIL, {
      password: PRO_PASSWORD,
      tag: 'pro-dashboard-bookings',
    });
    const page = await context.newPage();

    await page.goto('/pro/dashboard');
    await expect(page).toHaveURL(/\/pro\/dashboard/);

    // Wait for async data load before asserting section presence
    const bookingsSection = page.locator(
      'text=/réservations|bookings|demandes|requests/i',
    );
    await expect
      .poll(() => bookingsSection.count(), { timeout: 10_000 })
      .toBeGreaterThan(0);
    await expect(bookingsSection.first()).toBeVisible();

    await context.close();
  });

  test('should display quick actions or shortcuts', async ({ browser }) => {
    const context = await loginWithCookieSession(browser, PRO_EMAIL, {
      password: PRO_PASSWORD,
      tag: 'pro-dashboard-actions',
    });
    const page = await context.newPage();

    await page.goto('/pro/dashboard');
    await expect(page).toHaveURL(/\/pro\/dashboard/);

    // Wait for the dashboard to finish loading (h1 only appears after me() resolves)
    await expect(
      page.locator('h1, h2').filter({ hasText: /dashboard|tableau.*bord/i }).first(),
    ).toBeVisible({ timeout: 10_000 });

    // The dashboard renders "Messages" and "Profil Pro" links inside card wrappers.
    // Use href-based locators: more stable than accessible-name on complex card links.
    const messagesLink = page.locator('a[href="/pro/messages"]');
    const profileLink = page.locator('a[href="/pro/profile"]');

    // At least one navigation card link must be present
    await expect(messagesLink.or(profileLink).first()).toBeVisible({ timeout: 10_000 });

    await context.close();
  });

  test('should display BloboMap navigation card', async ({ browser }) => {
    // The dashboard was redesigned as a navigation hub (no inline stats).
    // BloboMap is its core feature — the /pro/map link must always be present.
    const context = await loginWithCookieSession(browser, PRO_EMAIL, {
      password: PRO_PASSWORD,
      tag: 'pro-dashboard-map',
    });
    const page = await context.newPage();

    await page.goto('/pro/dashboard');
    await expect(page).toHaveURL(/\/pro\/dashboard/);

    await expect(
      page.locator('h1, h2').filter({ hasText: /dashboard|tableau.*bord/i }).first(),
    ).toBeVisible({ timeout: 10_000 });

    await expect(page.locator('a[href="/pro/map"]')).toBeVisible({ timeout: 10_000 });

    await context.close();
  });

  test('should navigate to profile from dashboard', async ({ browser }) => {
    const context = await loginWithCookieSession(browser, PRO_EMAIL, {
      password: PRO_PASSWORD,
      tag: 'pro-dashboard-nav-profile',
    });
    const page = await context.newPage();

    await page.goto('/pro/dashboard');
    await expect(page).toHaveURL(/\/pro\/dashboard/);

    // Profile link must exist — hard assert (test purpose is navigation)
    const profileLink = page.getByRole('link', { name: /profil|profile/i });
    await expect(profileLink.first()).toBeVisible({ timeout: 10_000 });
    await profileLink.first().click();
    await expect(page).toHaveURL(/\/pro\/profile/);

    await context.close();
  });

  test('should remain accessible without offers module', async ({ browser }) => {
    const context = await loginWithCookieSession(browser, PRO_EMAIL, {
      password: PRO_PASSWORD,
      tag: 'pro-dashboard-nav-offers',
    });
    const page = await context.newPage();

    await page.goto('/pro/dashboard');
    await expect(page).toHaveURL(/\/pro\/dashboard/);

    // No offers link anymore — verify dashboard still renders without crash
    await expect(
      page.locator('h1, h2').filter({ hasText: /dashboard|tableau.*bord/i }).first(),
    ).toBeVisible({ timeout: 10_000 });

    await context.close();
  });
});

test.describe('Pro Dashboard Security', () => {
  test('should require authentication to access dashboard', async ({ page }) => {
    await page.goto('/pro/dashboard');

    // Should redirect to login
    await expect(page).toHaveURL(/\/(login|auth|connexion)/i, { timeout: 10_000 });
  });

  test('should require PRO role to access dashboard', async ({ browser }) => {
    const context = await loginWithCookieSession(browser, RIDER_EMAIL, {
      password: RIDER_PASSWORD,
      tag: 'rider-access-pro-dashboard',
    });
    const page = await context.newPage();

    await page.goto('/pro/dashboard');

    // RIDER must not access pro dashboard — deterministic URL check (no sleep)
    await page.waitForURL((url) => !url.pathname.includes('/pro/dashboard'), {
      timeout: 8_000,
    });

    await context.close();
  });
});
