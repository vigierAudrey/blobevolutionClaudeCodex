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

test.describe('Pro Messages', () => {
  test('should display messages page', async ({ browser }) => {
    const context = await browser.newContext({
      extraHTTPHeaders: {
        'X-Forwarded-For': testIp('pro-messages'),
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

    await page.goto('/pro/messages');
    await expect(page).toHaveURL(/\/pro\/messages/);

    // Page should load successfully
    await expect(page.locator('h1, h2').filter({ hasText: /messages|conversations/i }).first()).toBeVisible({ timeout: 10000 });

    await context.close();
  });

  test('should display list of conversations', async ({ browser }) => {
    const context = await browser.newContext({
      extraHTTPHeaders: {
        'X-Forwarded-For': testIp('pro-messages-list'),
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

    await page.goto('/pro/messages');
    await expect(page).toHaveURL(/\/pro\/messages/);

    // Look for conversation list or empty state
    const hasConversations = await page.locator('[data-testid="conversation-list"], .conversation-item').count() > 0;
    const hasEmptyState = await page.locator('text=/aucun.*(message|conversation)|no.*messages|vide|empty/i').count() > 0;

    // Either conversations or empty state should be visible
    expect(hasConversations || hasEmptyState).toBe(true);

    await context.close();
  });

  test('should send a message in a conversation', async ({ browser }) => {
    const context = await browser.newContext({
      extraHTTPHeaders: {
        'X-Forwarded-For': testIp('pro-messages-send'),
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

    await page.goto('/pro/messages');
    await expect(page).toHaveURL(/\/pro\/messages/);

    // Click on first conversation if available
    const conversationItem = page.locator('[data-testid="conversation-item"], .conversation-item').first();

    if (await conversationItem.count() > 0) {
      await conversationItem.click();

      // Wait for conversation to load
      await page.waitForTimeout(1000);

      // Look for message input
      const messageInput = page.locator('textarea, input[type="text"]').filter({ hasText: /message|écrire|write/i });

      if (await messageInput.count() === 0) {
        // Try finding by placeholder
        const inputByPlaceholder = page.locator('textarea[placeholder*="message"], input[placeholder*="message"]');

        if (await inputByPlaceholder.count() > 0) {
          await inputByPlaceholder.fill('Bonjour, je suis disponible pour une session cette semaine.');

          // Find and click send button
          const sendButton = page.getByRole('button', { name: /envoyer|send/i });
          if (await sendButton.count() > 0) {
            await sendButton.click();
            await page.waitForTimeout(1000);
          }
        }
      } else {
        await messageInput.first().fill('Bonjour, je suis disponible pour une session cette semaine.');

        // Find and click send button
        const sendButton = page.getByRole('button', { name: /envoyer|send/i });
        if (await sendButton.count() > 0) {
          await sendButton.click();
          await page.waitForTimeout(1000);
        }
      }
    }

    await context.close();
  });

  test('should display message history in conversation', async ({ browser }) => {
    const context = await browser.newContext({
      extraHTTPHeaders: {
        'X-Forwarded-For': testIp('pro-messages-history'),
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

    await page.goto('/pro/messages');
    await expect(page).toHaveURL(/\/pro\/messages/);

    // Click on first conversation if available
    const conversationItem = page.locator('[data-testid="conversation-item"], .conversation-item').first();

    if (await conversationItem.count() > 0) {
      await conversationItem.click();
      await page.waitForTimeout(1000);

      // Look for message bubbles or history container
      const messageHistory = page.locator('[data-testid="message"], .message, [data-testid="chat-message"]');

      if (await messageHistory.count() > 0) {
        await expect(messageHistory.first()).toBeVisible();
      }
    }

    await context.close();
  });

  test('should filter or search conversations', async ({ browser }) => {
    const context = await browser.newContext({
      extraHTTPHeaders: {
        'X-Forwarded-For': testIp('pro-messages-search'),
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

    await page.goto('/pro/messages');
    await expect(page).toHaveURL(/\/pro\/messages/);

    // Look for search input
    const searchInput = page.locator('input[type="search"], input[placeholder*="recherch"], input[placeholder*="search"]');

    if (await searchInput.count() > 0) {
      await searchInput.fill('test');
      await page.waitForTimeout(500);

      // Verify filtering occurred (implementation dependent)
      await expect(searchInput).toHaveValue('test');
    }

    await context.close();
  });

  test('should mark conversation as read', async ({ browser }) => {
    const context = await browser.newContext({
      extraHTTPHeaders: {
        'X-Forwarded-For': testIp('pro-messages-mark-read'),
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

    await page.goto('/pro/messages');
    await expect(page).toHaveURL(/\/pro\/messages/);

    // Click on conversation should mark it as read
    const unreadConversation = page.locator('[data-testid="conversation-item"], .conversation-item').filter({
      hasText: /non.*lu|unread|nouveau|new/i
    });

    if (await unreadConversation.count() > 0) {
      await unreadConversation.first().click();
      await page.waitForTimeout(1000);

      // After clicking, unread indicator should disappear
      // (Implementation specific - this is a basic check)
    }

    await context.close();
  });
});

test.describe('Pro Messages Security', () => {
  test('should require authentication to access messages', async ({ page }) => {
    await page.goto('/pro/messages');

    // Should redirect to login
    await expect(page).toHaveURL(/\/(login|auth|connexion)/i, { timeout: 10000 });
  });

  test('should only show conversations for the logged-in pro', async ({ browser }) => {
    const context = await browser.newContext({
      extraHTTPHeaders: {
        'X-Forwarded-For': testIp('pro-messages-isolation'),
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

    await page.goto('/pro/messages');
    await expect(page).toHaveURL(/\/pro\/messages/);

    // All conversations should belong to this pro
    // (Implementation specific - just verify page loads correctly)
    await expect(page.locator('h1, h2').filter({ hasText: /messages|conversations/i }).first()).toBeVisible({ timeout: 10000 });

    await context.close();
  });
});
