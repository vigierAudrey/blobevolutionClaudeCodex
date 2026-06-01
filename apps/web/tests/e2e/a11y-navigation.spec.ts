import { expect, type Page, test } from '@playwright/test';

const MINIMAL_AD_CONSENT = JSON.stringify({
  mode: 'limited',
  signals: {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
  },
  cmpVersion: 'a11y-navigation',
  updatedAt: '2026-05-14T00:00:00.000Z',
});

async function suppressConsentModal(page: Page) {
  await page.addInitScript((consent: string) => {
    try {
      window.localStorage.setItem('blob_consent', consent);
    } catch {
      // Some transient browser documents do not expose localStorage.
    }
  }, MINIMAL_AD_CONSENT);
}

function collectReactWarnings(page: Page) {
  const warnings: string[] = [];
  page.on('console', (message) => {
    const text = message.text();
    if (/hydration|did not match|validateDOMNesting|Warning:/i.test(text)) {
      warnings.push(`${message.type()}: ${text}`);
    }
  });
  page.on('pageerror', (error) => {
    if (/hydration|React/i.test(error.message)) {
      warnings.push(`pageerror: ${error.message}`);
    }
  });
  return warnings;
}

test.describe('A11y navigation primitives', () => {
  test('focuses the skip link first and moves focus to main content on Enter', async ({ page }) => {
    const reactWarnings = collectReactWarnings(page);
    await suppressConsentModal(page);

    await page.goto('/');

    const skipLink = page.getByTestId('skip-link');
    const main = page.locator('#main-content');

    await expect(skipLink).toHaveAttribute('href', '#main-content');
    await expect(main).toBeVisible();
    await expect(main).toHaveAttribute('tabindex', '-1');

    await page.keyboard.press('Tab');
    await expect(skipLink).toBeFocused();
    await expect(skipLink).toBeVisible();
    await expect(skipLink).toHaveText('Aller au contenu principal');

    await page.keyboard.press('Enter');
    await expect(main).toBeFocused();
    await expect(page).toHaveURL(/#main-content$/);
    expect(reactWarnings).toEqual([]);
  });

  test('mounts a polite route announcer and updates it after App Router navigation', async ({ page }) => {
    const reactWarnings = collectReactWarnings(page);
    await suppressConsentModal(page);

    await page.goto('/');

    const announcer = page.getByTestId('route-announcer');
    await expect(announcer).toHaveAttribute('role', 'status');
    await expect(announcer).toHaveAttribute('aria-live', 'polite');
    await expect(announcer).toHaveAttribute('aria-atomic', 'true');
    await expect(announcer).toHaveText('');

    await page.getByRole('link', { name: /Se connecter/i }).click();

    await expect(page).toHaveURL(/\/login$/);
    await expect(announcer).toHaveText('Page chargée : login');
    expect(reactWarnings).toEqual([]);
  });
});
