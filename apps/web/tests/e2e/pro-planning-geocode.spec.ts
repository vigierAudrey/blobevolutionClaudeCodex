import { test, expect } from '@playwright/test';

const PRO_EMAIL = process.env.E2E_PRO_EMAIL ?? 'dev+pro1@test.com';
const PRO_PASSWORD = process.env.E2E_PRO_PASSWORD ?? 'Passw0rd!';

const NOMINATIM_SEARCH = 'https://nominatim.openstreetmap.org/search';
const NOMINATIM_REVERSE = 'https://nominatim.openstreetmap.org/reverse';

test.describe('Pro planning – géocodage adresse ↔ carte', () => {
  test('auto-complétion adresse met à jour les coordonnées et la carte', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

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

    await page.goto('/login');
    await page.getByLabel('Email').fill(PRO_EMAIL);
    await page.getByLabel('Mot de passe').fill(PRO_PASSWORD);
    await page.getByRole('button', { name: 'Se connecter' }).click();
    await page.waitForTimeout(500);

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

    await page.getByRole('button', { name: 'Fermer' }).click();
    await context.close();
  });
});
