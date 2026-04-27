import { test, expect } from '@playwright/test';
import { loginWithCookieSession } from './helpers/auth';

const API_BASE_URL = process.env.PLAYWRIGHT_API_URL ?? 'http://localhost:4000';

/**
 * Admin access-control gate.
 *
 * All three tests use the real cookie-based auth flow:
 *  1. API login → httpOnly accessToken + refreshToken cookies (+ admin_session for ADMIN role)
 *  2. Cookies transferred to browser context via storageState
 *  3. Next.js middleware reads admin_session from request headers (server-side)
 *
 * No localStorage tokens. No body-token extraction.
 */
test.describe('Admin dashboard access control', () => {
  test('redirects unauthenticated users to login', async ({ page }) => {
    await page.goto('/admin/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });

  test('prevents rider from accessing admin dashboard', async ({ browser }) => {
    const riderEmail = process.env.E2E_RIDER_EMAIL ?? 'dev+rider1@test.com';

    // RIDER login — no admin_session cookie in API response
    const context = await loginWithCookieSession(browser, riderEmail, {
      tag: 'admin-gate-rider',
    });
    const page = await context.newPage();

    // Verify session is live (httpOnly cookie proof)
    const authMe = await page.request.get(`${API_BASE_URL}/auth/me`);
    expect(authMe.status()).toBe(200);
    const meBody = (await authMe.json()) as { role?: string };
    expect(meBody.role).not.toBe('ADMIN');

    // No admin_session cookie → middleware must redirect to /login
    await page.goto('/admin/dashboard');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/login/);

    await context.close();
  });

  test('allows admin to access dashboard', async ({ browser }) => {
    const adminEmail = process.env.E2E_ADMIN_EMAIL ?? 'dev+admin@test.com';

    // ADMIN login — API sets admin_session httpOnly cookie automatically
    const context = await loginWithCookieSession(browser, adminEmail, {
      tag: 'admin-gate-admin',
    });
    const page = await context.newPage();

    // Verify the session is accepted by the API and the role is ADMIN
    const authMe = await page.request.get(`${API_BASE_URL}/auth/me`);
    expect(authMe.status()).toBe(200);
    const meBody = (await authMe.json()) as { role?: string };
    expect(meBody.role).toBe('ADMIN');

    // admin_session cookie is in the context → middleware allows /admin/*
    await page.goto('/admin/dashboard');
    await expect(page.getByRole('heading', { name: /Administration/i })).toBeVisible();

    await context.close();
  });
});
