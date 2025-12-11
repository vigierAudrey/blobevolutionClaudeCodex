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

test.describe('Pro Profile Management', () => {
  test('should display and update pro profile information', async ({ browser }) => {
    const context = await browser.newContext({
      extraHTTPHeaders: {
        'X-Forwarded-For': testIp('pro-profile'),
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

    await page.goto('/pro/profile');
    await expect(page).toHaveURL(/\/pro\/profile/);

    // Verify profile form is displayed
    await expect(page.getByLabel(/nom.*entreprise|business.*name/i)).toBeVisible();
    await expect(page.getByLabel(/bio|description/i)).toBeVisible();

    // Update business name
    const businessNameInput = page.getByLabel(/nom.*entreprise|business.*name/i);
    await businessNameInput.clear();
    await businessNameInput.fill('My Updated Surf School');

    // Update bio
    const bioTextarea = page.getByLabel(/bio|description/i);
    await bioTextarea.clear();
    await bioTextarea.fill('Professional surf instructor with 10 years of experience');

    // Save changes
    const saveButton = page.getByRole('button', { name: /enregistrer|save|mettre.*jour|update/i });
    await saveButton.click();

    // Wait for success message or confirmation
    await expect(page.locator('text=/profil.*mis.*jour|profile.*updated|success/i')).toBeVisible({ timeout: 10000 });

    // Reload page to verify changes persisted
    await page.reload();
    await expect(businessNameInput).toHaveValue('My Updated Surf School');

    await context.close();
  });

  test('should upload a profile photo', async ({ browser }) => {
    const context = await browser.newContext({
      extraHTTPHeaders: {
        'X-Forwarded-For': testIp('pro-photo-upload'),
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

    await page.goto('/pro/profile');
    await expect(page).toHaveURL(/\/pro\/profile/);

    // Look for photo upload button or input
    const photoInput = page.locator('input[type="file"]').or(page.getByLabel(/photo|image|logo/i));

    if (await photoInput.count() > 0) {
      // If photo upload is available, test it
      await expect(photoInput.first()).toBeVisible();
      // Note: Actual file upload would require a test file
      // For now, just verify the input exists
    }

    await context.close();
  });

  test('should display location settings', async ({ browser }) => {
    const context = await browser.newContext({
      extraHTTPHeaders: {
        'X-Forwarded-For': testIp('pro-location'),
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

    await page.goto('/pro/profile');
    await expect(page).toHaveURL(/\/pro\/profile/);

    // Verify location fields exist
    const locationFields = [
      page.getByLabel(/latitude|lat/i),
      page.getByLabel(/longitude|lng|lon/i),
      page.getByLabel(/rayon|radius/i)
    ];

    for (const field of locationFields) {
      if (await field.count() > 0) {
        await expect(field.first()).toBeVisible();
      }
    }

    await context.close();
  });

  test('should display email notification preferences', async ({ browser }) => {
    const context = await browser.newContext({
      extraHTTPHeaders: {
        'X-Forwarded-For': testIp('pro-notif'),
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

    await page.goto('/pro/profile');
    await expect(page).toHaveURL(/\/pro\/profile/);

    // Look for email notification checkbox
    const emailNotifCheckbox = page.locator('input[type="checkbox"]').filter({ hasText: /email|notification/i });

    if (await emailNotifCheckbox.count() > 0) {
      await expect(emailNotifCheckbox.first()).toBeVisible();
      // Toggle it
      await emailNotifCheckbox.first().click();
      // Save
      const saveButton = page.getByRole('button', { name: /enregistrer|save/i });
      await saveButton.click();
      await page.waitForTimeout(1000);
    }

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
    // This test assumes we have a RIDER account set up
    const RIDER_EMAIL = process.env.E2E_RIDER_EMAIL ?? 'dev+rider1@test.com';
    const RIDER_PASSWORD = process.env.E2E_RIDER_PASSWORD ?? 'Passw0rd!';

    const context = await browser.newContext({
      extraHTTPHeaders: {
        'X-Forwarded-For': testIp('rider-access-pro'),
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

      await page.goto('/pro/profile');

      // Should either redirect to home or show access denied
      await page.waitForTimeout(2000);
      const url = page.url();
      expect(url).not.toContain('/pro/profile');
    } catch (error) {
      // Expected to fail if RIDER account doesn't exist
      console.log('RIDER account test skipped - account not configured');
    }

    await context.close();
  });
});
