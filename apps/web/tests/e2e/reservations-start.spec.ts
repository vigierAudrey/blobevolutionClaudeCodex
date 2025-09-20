import { test, expect } from '@playwright/test';

test.describe('Reservations start flow', () => {
  test('rider can progress through the main steps', async ({ page }) => {
    await page.goto('/reservations/start');

    await expect(page.getByText('Étape 1 / 3')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Quel sport veux-tu pratiquer ?' })).toBeVisible();

    await page.getByRole('button', { name: /Surf/ }).click();
    await page.getByText('Débutant').click();

    const continueButton = page.getByRole('button', { name: /Continuer/ });
    await expect(continueButton).toBeEnabled();
    await continueButton.click();

    await expect(page.getByRole('heading', { name: 'Où es-tu prêt·e à te déplacer ?' })).toBeVisible();

    await page.getByRole('button', { name: 'Voir les pros disponibles' }).click();

    await expect(page.getByRole('heading', { name: 'Pros disponibles' })).toBeVisible();
    await expect(
      page.getByText('Cette section affichera prochainement la carte et la liste filtrée.')
    ).toBeVisible();
  });
});

test.describe('Reservations map on mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('legend toggle and radius visuals render correctly', async ({ page }) => {
    await page.route('**/booking/availability/search**', async (route) => {
      const mockResponse = {
        results: [
          {
            id: 'slot-1',
            pro: {
              userId: 'pro-1',
              email: 'pro@example.com',
              businessName: 'Pro Surf Biarritz',
            },
            sport: 'surf',
            levels: ['beginner', 'intermediate'],
            startAt: new Date('2025-09-18T08:00:00Z').toISOString(),
            endAt: new Date('2025-09-18T09:30:00Z').toISOString(),
            capacity: 4,
            bookedCount: 1,
            spotName: 'Plage Centrale',
            spotLat: 43.4925,
            spotLng: -1.5582,
            distanceKm: 12.3,
            riders: [
              {
                id: 'rider-1',
                displayName: 'Ava',
                avatarUrl: null,
              },
            ],
          },
        ],
      } satisfies Record<string, unknown>;

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockResponse),
      });
    });

    await page.goto('/reservations/start');

    await page.getByRole('button', { name: /Surf/ }).click();
    await page.getByText('Débutant').click();
    await page.getByRole('button', { name: /Continuer/ }).click();
    await page.getByRole('button', { name: 'Voir les pros disponibles' }).click();

    const legendToggle = page.getByRole('button', { name: /légende/ });
    await expect(legendToggle).toBeVisible();

    await legendToggle.click();
    await expect(page.getByRole('button', { name: 'Masquer la légende' })).toBeVisible();
    await expect(page.getByText('Rayon de recherche : 25 km')).toBeVisible();

    await expect(page.locator('path[stroke="#0ea5e9"]').first()).toBeVisible();

    await legendToggle.click();
    await expect(page.getByRole('button', { name: 'Afficher la légende' })).toBeVisible();
  });
});
