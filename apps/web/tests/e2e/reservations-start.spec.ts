import { test, expect, request as playwrightRequest, type Browser, type APIRequestContext } from '@playwright/test';

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

async function runBookingFlow(
  browser: Browser,
  action: 'ACCEPT' | 'REJECT',
  options: { proEmail?: string; riderEmail?: string } = {}
) {
    const apiBaseUrl = process.env.PLAYWRIGHT_API_URL ?? 'http://127.0.0.1:4000';
    const proApi = await playwrightRequest.newContext({ baseURL: apiBaseUrl });
    const riderApi = await playwrightRequest.newContext({ baseURL: apiBaseUrl });

    const fetchCsrfToken = async (ctx: APIRequestContext) => {
      const res = await ctx.get('/csrf-token');
      if (!res.ok()) {
        throw new Error(`Unable to fetch CSRF token (${res.status()})`);
      }
      const json = (await res.json()) as { csrfToken: string };
      return json.csrfToken;
    };

    const proEmail = options.proEmail ?? process.env.E2E_PRO_EMAIL ?? 'dev+pro1@test.com';
    const riderEmail = options.riderEmail ?? process.env.E2E_RIDER_EMAIL ?? 'dev+rider1@test.com';

    const proLoginCsrf = await fetchCsrfToken(proApi);
    const proLogin = await proApi.post('/auth/login', {
      headers: { 'X-CSRF-Token': proLoginCsrf },
      data: { email: proEmail, password: 'Passw0rd!' },
    });
    if (!proLogin.ok()) {
      throw new Error(`Pro login failed (${proLogin.status}): ${await proLogin.text()}`);
    }
    const proLoginJson = await proLogin.json();
    const proToken = proLoginJson.accessToken as string;

    const riderLoginCsrf = await fetchCsrfToken(riderApi);
    const riderLogin = await riderApi.post('/auth/login', {
      headers: { 'X-CSRF-Token': riderLoginCsrf },
      data: { email: riderEmail, password: 'Passw0rd!' },
    });
    if (!riderLogin.ok()) {
      throw new Error(`Rider login failed (${riderLogin.status}): ${await riderLogin.text()}`);
    }
    const riderLoginJson = await riderLogin.json();
    const riderToken = riderLoginJson.accessToken as string;

    const now = Date.now();
    const startAt = new Date(now + 60 * 60 * 1000);
    const endAt = new Date(now + 90 * 60 * 1000);
    const spotName = `Playwright Spot ${action} ${now}`;

    const availabilityCsrf = await fetchCsrfToken(proApi);
    const availabilityResponse = await proApi.post('/booking/availability', {
      headers: { Authorization: `Bearer ${proToken}`, 'X-CSRF-Token': availabilityCsrf },
      data: {
        sport: 'surf',
        levels: ['beginner', 'intermediate'],
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
        capacity: 4,
        spotName,
        spotLat: 43.493,
        spotLng: -1.558,
      },
    });
    expect(availabilityResponse.ok()).toBeTruthy();
    const availabilityJson = await availabilityResponse.json();
    const availabilityId = availabilityJson.id as string;

    const riderContext = await browser.newContext();
    const riderPage = await riderContext.newPage();

    await riderPage.goto('/login');
    await riderPage.getByLabel('Email').fill(riderEmail);
    await riderPage.getByLabel('Mot de passe').fill('Passw0rd!');
    await riderPage.getByRole('button', { name: 'Se connecter' }).click();
    await riderPage.waitForTimeout(500); // redirection onboarding vs dashboard
    await riderPage.goto('/reservations/start');

    await riderPage.getByRole('button', { name: /Surf/ }).click();
    await riderPage.getByText('Débutant').click();
    await riderPage.getByRole('button', { name: /Continuer/ }).click();
    await riderPage.getByRole('button', { name: 'Voir les pros disponibles' }).click();

    await riderPage.waitForResponse((res) => res.url().includes('/booking/availability/search'));
    const slotHeading = riderPage.getByRole('heading', { name: spotName }).first();
    await expect(slotHeading).toBeVisible();
    const slotCard = slotHeading.locator('xpath=ancestor::div[contains(@class,"rounded-xl")][1]');
    await slotCard.getByRole('button', { name: 'Demander ce créneau' }).click();
    await expect(riderPage.getByRole('heading', { name: 'Demander ce créneau' })).toBeVisible();
    await riderPage.getByRole('button', { name: 'Envoyer la demande' }).click();
    await expect(riderPage.getByText('Demande envoyée')).toBeVisible();

    const riderRequestsPending = await riderApi.get('/booking/requests/me', {
      headers: { Authorization: `Bearer ${riderToken}` },
    });
    expect(riderRequestsPending.ok()).toBeTruthy();
    const riderRequestsJson = (await riderRequestsPending.json()) as {
      requests: Array<{ id: string; availability: { id: string }; status: string }>;
    };
    const createdRequest = riderRequestsJson.requests.find((req) => req.availability.id === availabilityId);
    expect(createdRequest).toBeTruthy();
    const requestId = createdRequest!.id;
    expect(createdRequest!.status).toBe('PENDING');

    const proContext = await browser.newContext();
    const proPage = await proContext.newPage();
    await proPage.goto('/login');
    await proPage.getByLabel('Email').fill(proEmail);
    await proPage.getByLabel('Mot de passe').fill('Passw0rd!');
    await proPage.getByRole('button', { name: 'Se connecter' }).click();
    await proPage.waitForTimeout(500);
    await proPage.goto('/pro/planning');

    const pendingRequestCard = proPage.locator('div', {
      hasText: spotName,
      has: proPage.getByRole('button', { name: 'Accepter' }),
    }).first();
    await expect(pendingRequestCard).toBeVisible();
    const decisionButtonName = action === 'ACCEPT' ? 'Accepter' : 'Refuser';
    await Promise.all([
      proPage.waitForResponse(
        (res) =>
          res.url().includes(`/booking/requests/${requestId}/decision`) &&
          res.request().method() === 'POST' &&
          res.ok()
      ),
      pendingRequestCard.getByRole('button', { name: decisionButtonName }).first().click(),
    ]);

    const riderRequestsAccepted = await riderApi.get('/booking/requests/me', {
      headers: { Authorization: `Bearer ${riderToken}` },
    });
    expect(riderRequestsAccepted.ok()).toBeTruthy();
    const riderRequestsAcceptedJson = (await riderRequestsAccepted.json()) as {
      requests: Array<{ id: string; availability: { id: string }; status: string }>;
    };
    const finalRequest = riderRequestsAcceptedJson.requests.find((req) => req.id === requestId);
    expect(finalRequest).toBeTruthy();
    expect(finalRequest!.status).toBe(action === 'ACCEPT' ? 'ACCEPTED' : 'REJECTED');

    await proContext.close();
    await riderContext.close();
    await proApi.dispose();
    await riderApi.dispose();
}

test.describe('Rider to pro booking flow', () => {
  test.describe.configure({ mode: 'serial' });

  test('rider sends request and pro accepts it', async ({ browser }) => {
    await runBookingFlow(browser, 'ACCEPT', {
      proEmail: 'dev+pro1@test.com',
      riderEmail: 'dev+rider1@test.com',
    });
  });

  test('rider sends request and pro rejects it', async ({ browser }) => {
    await runBookingFlow(browser, 'REJECT', {
      proEmail: 'dev+pro2@test.com',
      riderEmail: 'dev+rider2@test.com',
    });
  });
});
