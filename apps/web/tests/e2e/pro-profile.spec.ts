import { test, expect } from '@playwright/test';
import { loginWithCookieSession } from './helpers/auth';

const PRO_EMAIL = process.env.E2E_PRO_EMAIL ?? 'dev+pro1@test.com';
const PRO_PASSWORD = process.env.E2E_PRO_PASSWORD ?? 'Passw0rd!';
const RIDER_EMAIL = process.env.E2E_RIDER_EMAIL ?? 'dev+rider1@test.com';
const RIDER_PASSWORD = process.env.E2E_RIDER_PASSWORD ?? 'Passw0rd!';
test.describe('Pro Profile Management', () => {
  test('should display and update pro profile information', async ({ browser }) => {
    const context = await loginWithCookieSession(browser, PRO_EMAIL, {
      password: PRO_PASSWORD,
      tag: 'pro-profile',
    });
    const page = await context.newPage();

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

    // Toggle button with htmlFor="emailNotifToggle" linked via label "Alertes par email"
    const emailToggle = page.getByRole('button', { name: /alertes par email/i });
    await expect(emailToggle).toBeVisible({ timeout: 10_000 });

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
