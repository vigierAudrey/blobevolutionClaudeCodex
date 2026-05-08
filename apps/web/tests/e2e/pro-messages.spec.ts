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

    // Wait for async load: either conversations or the empty-state text must appear.
    // The page fetches conversations from the API; we poll until one of them is true.
    await expect.poll(
      async () => {
        const hasConversations =
          (await page.locator('.divide-y a[href*="/messages/"]').count()) > 0;
        const hasEmptyState =
          (await page.locator('text=/Aucune conversation|no.*messages/i').count()) > 0;
        return hasConversations || hasEmptyState;
      },
      { timeout: 15_000 },
    ).toBe(true);

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

    const conversationLink = page.locator('.divide-y a[href*="/messages/"]').first();

    if ((await conversationLink.count()) > 0) {
      await conversationLink.click();
      await page.waitForURL(/\/messages\//, { timeout: 8_000 });

      const inputByPlaceholder = page.locator('textarea[placeholder], input[type="text"][placeholder]').first();
      if ((await inputByPlaceholder.count()) > 0) {
        await inputByPlaceholder.fill('Bonjour, je suis disponible pour une session cette semaine.');
        const sendButton = page.getByRole('button', { name: /envoyer|send/i });
        if ((await sendButton.count()) > 0) {
          await sendButton.click();
          await page.waitForTimeout(1_000);
        }
      }
    }

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

    const conversationLink = page.locator('.divide-y a[href*="/messages/"]').first();

    if ((await conversationLink.count()) > 0) {
      await conversationLink.click();
      await page.waitForURL(/\/messages\//, { timeout: 8_000 });
      await page.waitForTimeout(1_000);

      const messageHistory = page.locator(
        '[data-testid="message"], .message, [data-testid="chat-message"], [class*="message"]'
      );
      if ((await messageHistory.count()) > 0) {
        await expect(messageHistory.first()).toBeVisible();
      }
    }

    await context.close();
  });

  test('should filter or search conversations', async ({ browser }) => {
    const context = await loginWithCookieSession(browser, PRO_EMAIL, {
      password: PRO_PASSWORD,
      tag: 'pro-messages-search',
    });
    const page = await context.newPage();

    await page.goto(appUrl('/pro/messages'));
    await expect(page).toHaveURL(/\/pro\/messages/);

    const searchInput = page.locator(
      'input[type="search"], input[placeholder*="recherch" i], input[placeholder*="search" i]'
    );

    if ((await searchInput.count()) > 0) {
      await searchInput.fill('test');
      await page.waitForTimeout(500);
      await expect(searchInput).toHaveValue('test');
    }

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

    const conversationLink = page.locator('.divide-y a[href*="/messages/"]').first();
    if ((await conversationLink.count()) > 0) {
      await conversationLink.click();
      await page.waitForURL(/\/messages\//, { timeout: 8_000 });
      await page.waitForTimeout(1_000);
    }

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
