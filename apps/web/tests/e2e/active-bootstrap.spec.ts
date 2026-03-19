import { expect, test } from '@playwright/test';
import { loginThroughUi } from './helpers/auth';

const RIDER_A_EMAIL = process.env.E2E_ACTIVE_RIDER_A_EMAIL ?? 'dev+active-rider-a@test.com';

const MATCHING_QUERY =
  '/matching/cards?sport=surf&level=advanced&date=anytime&useGeoloc=1&distanceKm=10&lat=50.1234&lng=1.2345';

test.describe('Active users bootstrap gate', () => {
  test('login cookie-based puis accès à une page protégée réelle', async ({ page }) => {
    await loginThroughUi(page, RIDER_A_EMAIL);

    const matchingResponse = page.waitForResponse((response) => {
      return response.url().includes('/matching/search') && response.request().method() === 'POST';
    });

    await page.goto(MATCHING_QUERY);

    await expect(page.getByRole('heading', { name: /Parcourir les profils/i })).toBeVisible({ timeout: 15000 });
    expect((await matchingResponse).status()).toBe(200);
  });
});
