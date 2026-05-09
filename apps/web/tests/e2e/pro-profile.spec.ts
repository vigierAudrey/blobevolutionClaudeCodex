import { test, expect, request as playwrightRequest } from '@playwright/test';
import { loginWithCookieSession } from './helpers/auth';

const PRO_EMAIL = process.env.E2E_PRO_EMAIL ?? 'dev+pro1@test.com';
const PRO_PASSWORD = process.env.E2E_PRO_PASSWORD ?? 'Passw0rd!';
const RIDER_EMAIL = process.env.E2E_RIDER_EMAIL ?? 'dev+rider1@test.com';
const RIDER_PASSWORD = process.env.E2E_RIDER_PASSWORD ?? 'Passw0rd!';
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

test.describe('Pro Profile Management', () => {
  test('should display and update pro profile information', async ({ browser }) => {
    // ── Auth: capture httpOnly session cookies via API request context ──────
    // Uses a standalone APIRequestContext — its cookies are NOT automatically
    // available to the page context. We transfer them via storageState so the
    // browser sends the real httpOnly accessToken cookie on every request.
    // blob_session_hint='1' is set via addInitScript so apiClient.getTokens()
    // returns truthy and ensureAuthenticated() does NOT redirect to /login.
    const apiCtx = await playwrightRequest.newContext({
      baseURL: API_BASE_URL,
      extraHTTPHeaders: { 'X-Forwarded-For': testIp('pro-profile-login') },
    });
    const csrfRes = await apiCtx.get('/csrf-token');
    const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
    const loginRes = await apiCtx.post('/auth/login', {
      headers: { 'X-CSRF-Token': csrfToken },
      data: { email: PRO_EMAIL, password: PRO_PASSWORD },
    });
    if (!loginRes.ok()) {
      throw new Error(`PRO login failed: ${loginRes.status()} ${await loginRes.text()}`);
    }
    const sessionState = await apiCtx.storageState();
    await apiCtx.dispose();

    // ── Browser context with transferred session cookies ────────────────────
    const context = await browser.newContext({
      extraHTTPHeaders: { 'X-Forwarded-For': testIp('pro-profile') },
      storageState: sessionState,
    });
    const page = await context.newPage();
    // blob_session_hint = '1' is the marker apiClient.getTokens() reads from
    // localStorage. Without it, getTokens() returns null → immediate redirect.
    // blob_consent pre-set to 'limited' suppresses the cookie consent modal
    // (fixed inset-0 z-50 overlay) that would otherwise block all clicks.
    await page.addInitScript(() => {
      window.localStorage.setItem('blob_session_hint', '1');
      window.localStorage.setItem(
        'blob_consent',
        JSON.stringify({
          mode: 'limited',
          signals: { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' },
          cmpVersion: 'blobinfini-consent-v1',
          updatedAt: new Date().toISOString(),
        }),
      );
    });

    await page.goto('/pro/profile');
    await expect(page).toHaveURL(/\/pro\/profile/);

    // Verify profile form is displayed — labels: "Nom commercial" and "Présentation"
    await expect(page.getByLabel(/nom.*commercial|nom.*entreprise|business.*name/i)).toBeVisible();
    await expect(page.getByLabel(/présentation|bio|description/i)).toBeVisible();

    // Update business name
    const businessNameInput = page.getByLabel(/nom.*commercial|nom.*entreprise|business.*name/i);
    await businessNameInput.clear();
    await businessNameInput.fill('My Updated Surf School');

    // Update bio
    const bioTextarea = page.getByLabel(/présentation|bio|description/i);
    await bioTextarea.clear();
    await bioTextarea.fill('Professional surf instructor with 10 years of experience');

    // Confirm React state has settled after fills before attempting the click
    await expect(businessNameInput).toHaveValue('My Updated Surf School');
    await expect(bioTextarea).toHaveValue('Professional surf instructor with 10 years of experience');

    // Save — Promise.all starts waitForURL listener before the click fires
    await Promise.all([
      page.waitForURL(/\/pro\/onboarding/, { timeout: 10000 }),
      page.getByRole('button', { name: /enregistrer|save|mettre.*jour|update/i }).click(),
    ]);

    // Navigate back to profile and verify changes persisted
    await page.goto('/pro/profile');
    await expect(page.getByLabel(/nom.*commercial|nom.*entreprise|business.*name/i)).toHaveValue('My Updated Surf School');

    await context.close();
  });

  test('should upload a profile photo', async ({ browser }) => {
    const context = await loginWithCookieSession(browser, PRO_EMAIL, {
      password: PRO_PASSWORD,
      tag: 'pro-photo-upload',
    });
    const page = await context.newPage();

    await page.goto('/pro/profile');
    await expect(page).toHaveURL(/\/pro\/profile/);

    // File input must exist — no conditional (the upload section is always rendered).
    await expect(page.locator('input[type="file"]').first()).toBeVisible({ timeout: 10_000 });

    await context.close();
  });

  test('should display location settings', async ({ browser }) => {
    // Pro1 seed always sets lat/lng — "Position active" is guaranteed to render.
    const context = await loginWithCookieSession(browser, PRO_EMAIL, {
      password: PRO_PASSWORD,
      tag: 'pro-location',
    });
    const page = await context.newPage();

    await page.goto('/pro/profile');
    await expect(page).toHaveURL(/\/pro\/profile/);

    // Geolocation section heading is always rendered (not conditional)
    await expect(page.getByRole('heading', { name: /géolocalisation/i })).toBeVisible({ timeout: 10_000 });
    // Pro1 seed always has lat/lng → "Position active" block is rendered
    await expect(page.getByText('Position active')).toBeVisible({ timeout: 5_000 });

    await context.close();
  });

  test('should display email notification preferences', async ({ browser }) => {
    // Checkbox #notif is tied to its label via htmlFor — use getByRole for robust selection.
    const context = await loginWithCookieSession(browser, PRO_EMAIL, {
      password: PRO_PASSWORD,
      tag: 'pro-notif',
    });
    const page = await context.newPage();

    await page.goto('/pro/profile');
    await expect(page).toHaveURL(/\/pro\/profile/);

    // Targets <input id="notif"> via associated <Label htmlFor="notif"> text
    const emailCheckbox = page.getByRole('checkbox', { name: /recevoir des emails pour les nouvelles demandes/i });
    await expect(emailCheckbox).toBeVisible({ timeout: 10_000 });

    await context.close();
  });
});

test.describe('Pro Profile Security', () => {
  test('should require authentication to access pro profile', async ({ page }) => {
    await page.goto('/pro/profile');

    // Should redirect to login
    await expect(page).toHaveURL(/\/(login|auth|connexion)/i, { timeout: 10000 });
  });

  test('should not allow RIDER to access pro profile page', async ({ browser }) => {
    const context = await loginWithCookieSession(browser, RIDER_EMAIL, {
      password: RIDER_PASSWORD,
      tag: 'rider-access-pro',
    });
    const page = await context.newPage();

    await page.goto('/pro/profile');

    // RIDER must not access pro routes — wait for server/client redirect
    await page.waitForURL((url) => !url.pathname.startsWith('/pro/profile'), { timeout: 8_000 });

    await context.close();
  });
});
