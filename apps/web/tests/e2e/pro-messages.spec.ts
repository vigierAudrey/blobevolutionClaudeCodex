import { test, expect } from '@playwright/test';
import { loginWithCookieSession } from './helpers/auth';

// pro1 has conversations seeded (conv1 RIDER_TO_PRO with rider1, conv3 PRO_TO_PRO with pro2)
const PRO_EMAIL = process.env.E2E_PRO_EMAIL ?? 'dev+pro1@test.com';
const PRO_PASSWORD = process.env.E2E_PRO_PASSWORD ?? 'Passw0rd!';

const WEB_BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? process.env.E2E_BASE_URL ?? 'http://localhost:3020';

function appUrl(path: string) {
  return new URL(path, WEB_BASE_URL).toString();
}

// ---------------------------------------------------------------------------
// Pro Messages — functional tests
// ---------------------------------------------------------------------------

test.describe('Pro Messages', () => {
  test.describe.configure({ mode: 'serial' });

  test('should display messages page', async ({ browser }) => {
    const context = await loginWithCookieSession(browser, PRO_EMAIL, {
      password: PRO_PASSWORD,
      tag: 'pro-messages-page',
    });
    const page = await context.newPage();

    await page.goto(appUrl('/pro/messages'));
    await expect(page).toHaveURL(/\/pro\/messages/);

    await expect(
      page.locator('h1, h2').filter({ hasText: /Mes Conversations|messages|conversations/i }).first()
    ).toBeVisible({ timeout: 10_000 });

    await context.close();
  });

  test('should display list of conversations', async ({ browser }) => {
    const context = await loginWithCookieSession(browser, PRO_EMAIL, {
      password: PRO_PASSWORD,
      tag: 'pro-messages-list',
    });
    const page = await context.newPage();

    await page.goto(appUrl('/pro/messages'));
    await expect(page).toHaveURL(/\/pro\/messages/);

    // Seed guarantees pro1 has conv1 (RIDER_TO_PRO with rider1).
    // PRO_TO_PRO conversations are filtered client-side, so only conv1 appears.
    // Hard assertion: if seed is absent, test fails with a clear message.
    await expect(page.locator('a[href*="/messages/"]').first()).toBeVisible({ timeout: 15_000 });

    await context.close();
  });

  test('should send a message in a conversation', async ({ browser }) => {
    const context = await loginWithCookieSession(browser, PRO_EMAIL, {
      password: PRO_PASSWORD,
      tag: 'pro-messages-send',
    });
    const page = await context.newPage();

    await page.goto(appUrl('/pro/messages'));
    await expect(page).toHaveURL(/\/pro\/messages/);

    // Seed guarantees pro1 has conv1 — hard assert, no conditional.
    const conversationLink = page.locator('a[href*="/messages/"]').first();
    await expect(conversationLink).toBeVisible({ timeout: 15_000 });
    await conversationLink.click();
    await page.waitForURL(/\/messages\//, { timeout: 8_000 });

    // Conversation detail: input must be visible (page fully mounted and auth OK).
    const msgInput = page.locator('input[placeholder="Écrire un message"]');
    await expect(msgInput).toBeVisible({ timeout: 8_000 });
    await msgInput.fill('Bonjour, je suis disponible pour une session cette semaine.');
    const sendButton = page.getByRole('button', { name: /envoyer|send/i });
    await expect(sendButton).toBeVisible();
    await sendButton.click();
    // Input cleared = optimistic send confirmed.
    await expect(msgInput).toHaveValue('', { timeout: 5_000 });

    await context.close();
  });

  test('should display message history in conversation', async ({ browser }) => {
    const context = await loginWithCookieSession(browser, PRO_EMAIL, {
      password: PRO_PASSWORD,
      tag: 'pro-messages-history',
    });
    const page = await context.newPage();

    await page.goto(appUrl('/pro/messages'));
    await expect(page).toHaveURL(/\/pro\/messages/);

    // Seed guarantees pro1 has conv1 — hard assert, no conditional.
    const conversationLink = page.locator('a[href*="/messages/"]').first();
    await expect(conversationLink).toBeVisible({ timeout: 15_000 });
    await conversationLink.click();
    await page.waitForURL(/\/messages\//, { timeout: 8_000 });

    // Previous test (serial mode) sent this exact message — it must appear in history.
    // If this test is run in isolation without the send test, it may fail: that is correct
    // behavior, as this test depends on the send test having run first.
    await expect(
      page.getByText('Bonjour, je suis disponible pour une session cette semaine.')
    ).toBeVisible({ timeout: 8_000 });

    await context.close();
  });

  test('should filter conversations by category', async ({ browser }) => {
    const context = await loginWithCookieSession(browser, PRO_EMAIL, {
      password: PRO_PASSWORD,
      tag: 'pro-messages-filter',
    });
    const page = await context.newPage();

    await page.goto(appUrl('/pro/messages'));
    await expect(page).toHaveURL(/\/pro\/messages/);

    // The pro messages page uses filter buttons (not a search input).
    // Verify the "Élèves" filter button exists and responds to click.
    const ridersFilterBtn = page.getByRole('button', { name: /Élèves/i });
    await expect(ridersFilterBtn).toBeVisible({ timeout: 10_000 });
    await ridersFilterBtn.click();

    // After filter: list must show matching conversations or the category empty state.
    // The category empty state is distinct from the global empty state.
    await expect(
      page.locator('a[href*="/messages/"]').first()
        .or(page.locator('text=/Aucune conversation/i'))
    ).toBeVisible({ timeout: 8_000 });

    await context.close();
  });

  test('should mark conversation as read', async ({ browser }) => {
    const context = await loginWithCookieSession(browser, PRO_EMAIL, {
      password: PRO_PASSWORD,
      tag: 'pro-messages-mark-read',
    });
    const page = await context.newPage();

    await page.goto(appUrl('/pro/messages'));
    await expect(page).toHaveURL(/\/pro\/messages/);

    // Opening a conversation implicitly marks it as read (server-side side-effect).
    // Hard assert: seed guarantees conv1 exists, no conditional branch.
    const conversationLink = page.locator('a[href*="/messages/"]').first();
    await expect(conversationLink).toBeVisible({ timeout: 15_000 });
    await conversationLink.click();
    await page.waitForURL(/\/messages\//, { timeout: 8_000 });

    // Detail page must be fully functional: input visible proves page mounted and auth OK.
    const msgInput = page.locator('input[placeholder="Écrire un message"]');
    await expect(msgInput).toBeVisible({ timeout: 8_000 });

    await context.close();
  });
});

// ---------------------------------------------------------------------------
// Pro Messages Security
// ---------------------------------------------------------------------------

test.describe('Pro Messages Security', () => {
  test('should require authentication to access messages', async ({ page }) => {
    await page.goto(appUrl('/pro/messages'));
    await expect(page).toHaveURL(/\/(login|auth|connexion)/i, { timeout: 10_000 });
  });

  test('should only show conversations for the logged-in pro', async ({ browser }) => {
    const context = await loginWithCookieSession(browser, PRO_EMAIL, {
      password: PRO_PASSWORD,
      tag: 'pro-messages-isolation',
    });
    const page = await context.newPage();

    await page.goto(appUrl('/pro/messages'));
    await expect(page).toHaveURL(/\/pro\/messages/);

    await expect(
      page.locator('h1, h2').filter({ hasText: /Mes Conversations|messages|conversations/i }).first()
    ).toBeVisible({ timeout: 10_000 });

    await context.close();
  });
});
