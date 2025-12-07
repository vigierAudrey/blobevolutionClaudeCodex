import {
  test,
  expect,
  request as playwrightRequest,
  type Browser,
  type BrowserContext,
  type APIRequestContext,
} from '@playwright/test';

const API_BASE_URL = process.env.PLAYWRIGHT_API_URL ?? 'http://localhost:4000';
const DEFAULT_PASSWORD = process.env.E2E_DEFAULT_PASSWORD ?? 'Passw0rd!';

function testIp(tag: string) {
  const base = Math.abs(
    Array.from(`${tag}-${Date.now()}-${Math.random()}`)
      .reduce((acc, char) => acc + char.charCodeAt(0), 0)
  );
  const a = (base >> 12) & 255;
  const b = (base >> 8) & 255;
  const c = (base >> 4) & 255;
  const d = base & 255;
  return `10.${a}.${b}.${c ^ d || 99}`;
}

async function primeCsrfSession(context: BrowserContext, tag: string) {
  const response = await context.request.get(`${API_BASE_URL}/csrf-token`, {
    headers: { 'X-Forwarded-For': testIp(`csrf-${tag}`) },
  });

  if (!response.ok()) {
    const body = await response.text();
    throw new Error(`Unable to bootstrap CSRF session (${response.status()}): ${body}`);
  }

  const setCookieHeader = response.headers()['set-cookie'] ?? '';
  const match = /connect\.sid=([^;]+)/.exec(setCookieHeader);
  if (match) {
    await context.addCookies([
      {
        name: 'connect.sid',
        value: match[1],
        url: API_BASE_URL,
        httpOnly: true,
        secure: false,
        sameSite: 'Lax',
      },
    ]);

    if (process.env.DEBUG_E2E_CSRF === '1') {
      const cookies = await context.cookies(API_BASE_URL);
      console.log(`[csrf-debug] cookies for ${tag}:`, cookies);
    }
  }
}

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

async function loginViaApi(email: string, password: string, tag: string) {
  const apiContext = await playwrightRequest.newContext({
    baseURL: API_BASE_URL,
    extraHTTPHeaders: { 'X-Forwarded-For': testIp(`api-login-${tag}`) },
  });

  const csrfResponse = await apiContext.get('/csrf-token');
  const csrfJson = (await csrfResponse.json()) as { csrfToken: string };

  const loginResponse = await apiContext.post('/auth/login', {
    headers: { 'X-CSRF-Token': csrfJson.csrfToken },
    data: { email, password },
  });

  if (!loginResponse.ok()) {
    throw new Error(`API login failed for ${email}: ${loginResponse.status()} ${await loginResponse.text()}`);
  }

  const tokens = (await loginResponse.json()) as { accessToken: string; refreshToken: string };
  await apiContext.dispose();
  return tokens;
}

async function runBookingFlow(
  browser: Browser,
  action: 'ACCEPT' | 'REJECT',
  options: { proEmail?: string; riderEmail?: string } = {}
) {
    const proApi = await playwrightRequest.newContext({
      baseURL: API_BASE_URL,
      extraHTTPHeaders: { 'X-Forwarded-For': testIp(`pro-api-${action}`) },
    });
    const riderApi = await playwrightRequest.newContext({
      baseURL: API_BASE_URL,
      extraHTTPHeaders: { 'X-Forwarded-For': testIp(`rider-api-${action}`) },
    });

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

    const proTokens = await loginViaApi(proEmail, DEFAULT_PASSWORD, `pro-ui-${action}`);
    const riderTokens = await loginViaApi(riderEmail, DEFAULT_PASSWORD, `rider-ui-${action}`);
    const proToken = proTokens.accessToken;
    const riderToken = riderTokens.accessToken;

    const now = Date.now();
    const baseOffsetMinutes = 365 * 24 * 60; // plan 1 year ahead to avoid existing data
    const randomOffsetMinutes =
      Math.floor((now / 1000) % 10000) + (action === 'ACCEPT' ? 0 : 300); // ensure uniqueness per run
    const startAt = new Date(now + (baseOffsetMinutes + randomOffsetMinutes) * 60 * 1000);
    const endAt = new Date(startAt.getTime() + 90 * 60 * 1000);
    const spotName = `Playwright Spot ${action} ${now}`;

    const availabilityCsrf = await fetchCsrfToken(proApi);
    const availabilityResponse = await proApi.post('/booking/availability', {
      headers: {
        Authorization: `Bearer ${proToken}`,
        'X-CSRF-Token': availabilityCsrf,
        'Content-Type': 'application/json',
      },
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
    if (!availabilityResponse.ok()) {
      throw new Error(
        `Availability creation failed (${availabilityResponse.status()}): ${await availabilityResponse.text()}`
      );
    }
    const availabilityJson = await availabilityResponse.json();
    const availabilityId = availabilityJson.id as string;
    if (process.env.DEBUG_E2E_CSRF === '1') {
      const searchDebug = await riderApi.get(
        `/booking/availability/search?sport=surf&level=beginner&lat=43.493&lng=-1.558&radiusKm=25`,
        { headers: { Authorization: `Bearer ${riderToken}` } }
      );
      console.log(
        `[csrf-debug] search status: ${searchDebug.status()} body: ${await searchDebug.text()}`
      );
    }

    const riderContext = await browser.newContext();
    await primeCsrfSession(riderContext, `rider-${action}`);
    await riderContext.addInitScript(
      ({ accessToken, refreshToken }) => {
        window.localStorage.setItem('accessToken', accessToken);
        window.localStorage.setItem('refreshToken', refreshToken);
      },
      riderTokens
    );
    const riderPage = await riderContext.newPage();
    riderPage.on('response', async (res) => {
      if (res.url().includes('/booking/availability/search') && process.env.DEBUG_E2E_CSRF === '1') {
        console.log(`[csrf-debug] ui search status ${res.status()} url ${res.url()}`);
      }
    });
    if (process.env.DEBUG_E2E_CSRF === '1') {
      await riderPage.route('**/booking/requests', async (route) => {
        console.log('[csrf-debug] booking request headers', route.request().headers());
        await route.continue();
      });
    }
    riderPage.on('console', (msg) => {
      console.log(`[rider-console] ${msg.type()}: ${msg.text()}`);
    });
    await riderPage.goto('/reservations/start');

    await riderPage.getByRole('button', { name: /Surf/ }).click();
    await riderPage.getByText('Débutant').click();
    await riderPage.getByRole('button', { name: /Continuer/ }).click();
    await riderPage.getByRole('button', { name: 'Voir les pros disponibles' }).click();

    await riderPage.waitForResponse((res) => {
      const url = res.url();
      return url.includes('/booking/availability/search') && res.request().method() === 'GET';
    });
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
    await primeCsrfSession(proContext, `pro-${action}`);
    await proContext.addInitScript(
      ({ accessToken, refreshToken }) => {
        window.localStorage.setItem('accessToken', accessToken);
        window.localStorage.setItem('refreshToken', refreshToken);
      },
      proTokens
    );
    const proPage = await proContext.newPage();
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
