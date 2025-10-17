import { test, expect, request as playwrightRequest } from '@playwright/test';

const PRO_EMAIL = process.env.E2E_PRO_EMAIL ?? 'dev+pro1@test.com';
const PRO_PASSWORD = process.env.E2E_PRO_PASSWORD ?? 'Passw0rd!';

const NOMINATIM_SEARCH = 'https://nominatim.openstreetmap.org/search';
const NOMINATIM_REVERSE = 'https://nominatim.openstreetmap.org/reverse';

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

test.describe('Pro planning – géocodage adresse ↔ carte', () => {
  test('auto-complétion adresse met à jour les coordonnées et la carte', async ({ browser }) => {
    const context = await browser.newContext({
      extraHTTPHeaders: {
        'X-Forwarded-For': testIp('pro-planning'),
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

    await page.route(`${NOMINATIM_SEARCH}**`, async (route) => {
      const payload = [
        {
          display_name: 'Plage Centrale, Biarritz, Pyrénées-Atlantiques, France',
          lat: '43.492',
          lon: '-1.558',
          importance: 0.8,
        },
      ];
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(payload),
      });
    });

    await page.route(`${NOMINATIM_REVERSE}**`, async (route) => {
      const payload = {
        display_name: 'Plage Centrale, Biarritz, Pyrénées-Atlantiques, France',
      };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(payload),
      });
    });

    await page.goto('/pro/planning');
    await expect(page).toHaveURL(/\/pro\/planning/);
    const openModalButton = page.getByRole('button', { name: 'Ajouter un créneau' });
    await expect(openModalButton).toBeVisible();
    await openModalButton.click();

    const adresseInput = page.getByLabel('Adresse (optionnelle)');
    await adresseInput.fill('Plage Centrale Biarritz');
    await expect(page.getByRole('button', { name: /Plage Centrale, Biarritz/ })).toBeVisible();

    await page.getByRole('button', { name: /Plage Centrale, Biarritz/ }).click();

    await expect(page.getByLabel('Nom du spot')).toHaveValue('Plage Centrale, Biarritz, Pyrénées-Atlantiques, France');
    await expect(page.getByLabel('Adresse (optionnelle)')).toHaveValue('Plage Centrale, Biarritz, Pyrénées-Atlantiques, France');
    await expect(page.getByLabel('Latitude')).toHaveValue('43.492000');
    await expect(page.getByLabel('Longitude')).toHaveValue('-1.558000');

    await context.close();
  });
});
