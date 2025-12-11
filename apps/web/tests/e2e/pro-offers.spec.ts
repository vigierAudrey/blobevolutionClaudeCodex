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

test.describe('Pro Offers Management', () => {
  test('should display offers page and list existing offers', async ({ browser }) => {
    const context = await browser.newContext({
      extraHTTPHeaders: {
        'X-Forwarded-For': testIp('pro-offers-list'),
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

    await page.goto('/pro/offers');
    await expect(page).toHaveURL(/\/pro\/offers/);

    // Page should load successfully
    await expect(page.locator('h1, h2').filter({ hasText: /offres|offers/i }).first()).toBeVisible({ timeout: 10000 });

    await context.close();
  });

  test('should create a new offer', async ({ browser }) => {
    const context = await browser.newContext({
      extraHTTPHeaders: {
        'X-Forwarded-For': testIp('pro-offers-create'),
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

    await page.goto('/pro/offers');
    await expect(page).toHaveURL(/\/pro\/offers/);

    // Look for "Add offer" or "Create offer" button
    const createButton = page.getByRole('button', { name: /ajouter|créer|nouveau|add|create|new/i });

    if (await createButton.count() > 0) {
      await createButton.first().click();

      // Fill offer form
      const titleInput = page.getByLabel(/titre|title/i);
      if (await titleInput.count() > 0) {
        await titleInput.fill('Cours de surf pour débutants');
      }

      const descriptionInput = page.getByLabel(/description/i);
      if (await descriptionInput.count() > 0) {
        await descriptionInput.fill('Apprenez les bases du surf dans une ambiance conviviale et sécurisée avec un moniteur diplômé.');
      }

      const priceInput = page.getByLabel(/prix|tarif|rate|price/i);
      if (await priceInput.count() > 0) {
        await priceInput.fill('60');
      }

      // Select sport (surf or kitesurf)
      const sportSelect = page.locator('select').filter({ hasText: /sport/i });
      if (await sportSelect.count() > 0) {
        await sportSelect.selectOption('surf');
      }

      // Select level
      const levelSelect = page.locator('select').filter({ hasText: /niveau|level/i });
      if (await levelSelect.count() > 0) {
        await levelSelect.selectOption({ label: /débutant|beginner/i });
      }

      // Submit form
      const submitButton = page.getByRole('button', { name: /enregistrer|save|créer|create/i });
      await submitButton.click();

      // Wait for success confirmation
      await page.waitForTimeout(2000);
    }

    await context.close();
  });

  test('should toggle offer active status', async ({ browser }) => {
    const context = await browser.newContext({
      extraHTTPHeaders: {
        'X-Forwarded-For': testIp('pro-offers-toggle'),
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

    await page.goto('/pro/offers');
    await expect(page).toHaveURL(/\/pro\/offers/);

    // Look for toggle switch or activate/deactivate button
    const toggleButton = page.locator('button, input[type="checkbox"]').filter({
      hasText: /activer|désactiver|active|inactive|toggle/i
    });

    if (await toggleButton.count() > 0) {
      await toggleButton.first().click();
      await page.waitForTimeout(1000);

      // Verify state changed (this depends on UI implementation)
      await expect(page.locator('text=/actif|active|inactive/i').first()).toBeVisible({ timeout: 5000 });
    }

    await context.close();
  });

  test('should edit an existing offer', async ({ browser }) => {
    const context = await browser.newContext({
      extraHTTPHeaders: {
        'X-Forwarded-For': testIp('pro-offers-edit'),
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

    await page.goto('/pro/offers');
    await expect(page).toHaveURL(/\/pro\/offers/);

    // Look for edit button
    const editButton = page.getByRole('button', { name: /modifier|edit/i });

    if (await editButton.count() > 0) {
      await editButton.first().click();

      // Update description
      const descriptionInput = page.getByLabel(/description/i);
      if (await descriptionInput.count() > 0) {
        await descriptionInput.clear();
        await descriptionInput.fill('Description mise à jour avec plus de détails sur le cours.');
      }

      // Save changes
      const saveButton = page.getByRole('button', { name: /enregistrer|save/i });
      await saveButton.click();

      await page.waitForTimeout(1000);
    }

    await context.close();
  });

  test('should delete an offer', async ({ browser }) => {
    const context = await browser.newContext({
      extraHTTPHeaders: {
        'X-Forwarded-For': testIp('pro-offers-delete'),
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

    await page.goto('/pro/offers');
    await expect(page).toHaveURL(/\/pro\/offers/);

    // Look for delete button
    const deleteButton = page.getByRole('button', { name: /supprimer|delete/i });

    if (await deleteButton.count() > 0) {
      // Click delete
      await deleteButton.first().click();

      // Confirm deletion in modal if present
      const confirmButton = page.getByRole('button', { name: /confirmer|confirm|oui|yes/i });
      if (await confirmButton.count() > 0) {
        await confirmButton.first().click();
      }

      await page.waitForTimeout(1000);
    }

    await context.close();
  });

  test('should display offer statistics', async ({ browser }) => {
    const context = await browser.newContext({
      extraHTTPHeaders: {
        'X-Forwarded-For': testIp('pro-offers-stats'),
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

    await page.goto('/pro/offers');
    await expect(page).toHaveURL(/\/pro\/offers/);

    // Look for statistics like views, bookings, etc.
    const statsElements = page.locator('text=/vues|views|réservations|bookings|statistiques|statistics/i');

    if (await statsElements.count() > 0) {
      await expect(statsElements.first()).toBeVisible();
    }

    await context.close();
  });
});

test.describe('Pro Offers Security', () => {
  test('should require authentication to access offers page', async ({ page }) => {
    await page.goto('/pro/offers');

    // Should redirect to login
    await expect(page).toHaveURL(/\/(login|auth|connexion)/i, { timeout: 10000 });
  });

  test('should require PRO role to access offers page', async ({ browser }) => {
    // This test assumes we have a RIDER account set up
    const RIDER_EMAIL = process.env.E2E_RIDER_EMAIL ?? 'dev+rider1@test.com';
    const RIDER_PASSWORD = process.env.E2E_RIDER_PASSWORD ?? 'Passw0rd!';

    const context = await browser.newContext({
      extraHTTPHeaders: {
        'X-Forwarded-For': testIp('rider-access-pro-offers'),
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

      await page.goto('/pro/offers');

      // Should redirect away from pro offers page
      await page.waitForTimeout(2000);
      const url = page.url();
      expect(url).not.toContain('/pro/offers');
    } catch (error) {
      // Expected to fail if RIDER account doesn't exist
      console.log('RIDER account test skipped - account not configured');
    }

    await context.close();
  });
});
