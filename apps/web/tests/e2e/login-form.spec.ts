/**
 * Minimal E2E proof: real browser login form with CSRF.
 *
 * This test exercises the path that loginThroughUi no longer covers:
 *   /login page → fill form → submit → frontend handles CSRF →
 *   API sets httpOnly cookies → frontend calls /auth/me → 200.
 *
 * It is intentionally minimal. Its job is to detect regressions in the
 * CSRF/cookie round-trip, not to test application business logic.
 */
import { test, expect } from '@playwright/test';

const DEFAULT_PASSWORD = process.env.E2E_DEFAULT_PASSWORD ?? 'Passw0rd!';
const RIDER_EMAIL = process.env.E2E_RIDER_EMAIL ?? 'dev+rider1@test.com';

const MINIMAL_CONSENT = JSON.stringify({
  mode: 'limited',
  signals: { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' },
  cmpVersion: 'active-user-simulation',
  updatedAt: '2026-03-15T00:00:00.000Z',
});

test('login formulaire navigateur → CSRF + cookies httpOnly → /auth/me 200', async ({ page }) => {
  // Dismiss consent modal before any navigation
  await page.addInitScript((consent) => {
    window.localStorage.setItem('blob_consent', consent);
    window.localStorage.setItem('cookie-consent', 'essential');
  }, MINIMAL_CONSENT);

  // Arm the /auth/me wait before clicking submit to avoid a race
  const authMePromise = page.waitForResponse(
    (r) => r.url().includes('/auth/me') && r.request().method() === 'GET',
    { timeout: 15_000 },
  );

  await page.goto('/login');
  await page.locator('#email').fill(RIDER_EMAIL);
  await page.locator('#password').fill(DEFAULT_PASSWORD);
  await page.getByRole('button', { name: /Se connecter/i }).click();

  // The frontend calls /auth/me after a successful login — this is the proof
  // that the CSRF token was accepted and the httpOnly cookies were set.
  const authMeResponse = await authMePromise;
  expect(authMeResponse.status()).toBe(200);
});
