import { test, expect, request as playwrightRequest, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { loginWithCookieSession } from './helpers/auth';

const WEB_BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? process.env.E2E_BASE_URL ?? 'http://localhost:3020';

// Pre-computed at module load so the updatedAt timestamp is stable across retries.
const NPA_CONSENT_JSON = JSON.stringify({
  mode: 'npa',
  signals: { ad_storage: 'granted', ad_user_data: 'denied', ad_personalization: 'denied' },
  cmpVersion: 'playwright-suite',
  updatedAt: new Date().toISOString(),
});

// Inject a non-none consent state so CookieConsent modal never appears during pro-map tests.
// Preserved from #147 stabilization — prevents CookieConsent modal from blocking assertions.
async function setupConsent(page: Page): Promise<void> {
  await page.addInitScript((consent) => {
    window.localStorage.setItem('blob_consent', consent);
    window.localStorage.setItem('cookie-consent', 'essential');
  }, NPA_CONSENT_JSON);
}
const API_BASE_URL = process.env.PLAYWRIGHT_API_URL ?? 'http://localhost:4000';
const PRO_EMAIL = process.env.E2E_PRO_EMAIL ?? 'dev+pro9@test.com';
const PRO_PASSWORD = process.env.E2E_PRO_PASSWORD ?? 'Passw0rd!';
// rider1 is reserved for the PRO-role security test — use rider2 for the lesson fixture
// to avoid sharing the AUTH_LOGIN_ACCOUNT_IP rate-limit bucket between beforeAll and tests.
const RIDER_EMAIL = process.env.E2E_RIDER_EMAIL ?? 'dev+rider1@test.com';
const RIDER_PASSWORD = process.env.E2E_RIDER_PASSWORD ?? 'Passw0rd!';
const FIXTURE_RIDER_EMAIL = process.env.E2E_FIXTURE_RIDER_EMAIL ?? 'dev+rider2@test.com';

// Pro9 "Hossegor Peak Coaching" is seeded at lat:43.6645, lng:-1.3908.
// These lesson coords place the fixture rider ~100 m from the pro — guaranteed
// to appear in any radius query ≥ 1 km (spec uses 200 km).
const FIXTURE_LESSON_LAT = 43.664;
const FIXTURE_LESSON_LNG = -1.390;

/**
 * Injects a visible lesson-request fixture for the Blobomap spec.
 *
 * The global seed provides lessonLat/lessonLng for some wantsLesson riders, but
 * their coords are near their own base location — not necessarily near pro9 at
 * Hossegor. This function patches dev+rider2 via PUT /profile/me to set coords
 * ~100 m from pro9, guaranteeing at least one rider appears in the map regardless
 * of which random seed riders happen to be in range.
 *
 * Business invariants respected:
 *  - wantsLesson=true requires lessonLat AND lessonLng (both-or-none)
 *  - Coordinates must be in France (France-only launch guard)
 *  - No prod code modified
 */
async function setupLessonFixture(): Promise<void> {
  const apiContext = await playwrightRequest.newContext({ baseURL: API_BASE_URL });
  try {
    // Bootstrap CSRF secret into a fresh session
    const csrfRes = await apiContext.get('/csrf-token');
    if (!csrfRes.ok()) throw new Error(`CSRF fetch failed: ${csrfRes.status()}`);
    const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };

    // Login as the dedicated fixture rider (not RIDER_EMAIL which is used in security tests,
    // to keep each account's AUTH_LOGIN_ACCOUNT_IP bucket independent)
    const loginRes = await apiContext.post('/auth/login', {
      headers: { 'X-CSRF-Token': csrfToken },
      data: { email: FIXTURE_RIDER_EMAIL, password: RIDER_PASSWORD, consentAccepted: true },
    });
    if (!loginRes.ok()) throw new Error(`Rider login failed: ${loginRes.status()}`);

    // After login the session is renewed — fetch a fresh CSRF token
    const csrfRes2 = await apiContext.get('/csrf-token');
    if (!csrfRes2.ok()) throw new Error(`Post-login CSRF fetch failed: ${csrfRes2.status()}`);
    const { csrfToken: csrfToken2 } = (await csrfRes2.json()) as { csrfToken: string };

    // Patch lesson coords so the rider appears on /pro/near/lessons
    const profileRes = await apiContext.put('/profile/me', {
      headers: { 'X-CSRF-Token': csrfToken2 },
      data: {
        wantsLesson: true,
        lessonSport: 'surf',
        lessonLevel: 'beginner',
        lessonStudentCount: 1,
        lessonLat: FIXTURE_LESSON_LAT,
        lessonLng: FIXTURE_LESSON_LNG,
      },
    });
    if (!profileRes.ok()) {
      const body = await profileRes.text();
      throw new Error(`Profile fixture update failed: ${profileRes.status()} — ${body}`);
    }
  } finally {
    await apiContext.dispose();
  }
}

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

function appUrl(path: string) {
  return new URL(path, WEB_BASE_URL).toString();
}

type StorageState = Awaited<ReturnType<BrowserContext['storageState']>>;

async function createPageFromStorageState(
  browser: Browser,
  storageState: StorageState,
  tag: string,
) {
  const context = await browser.newContext({
    storageState,
    extraHTTPHeaders: {
      'X-Forwarded-For': testIp(tag),
    },
  });
  const page = await context.newPage();
  return { context, page };
}

async function resolveMatchingOptionValue(selectLocator: Locator, pattern: RegExp) {
  const options = await selectLocator.locator('option').evaluateAll(
    (elements: Element[]) =>
      elements.map((element) => {
        const option = element as HTMLOptionElement;
        return {
          value: option.value,
          label: option.textContent ?? '',
        };
      }),
  );

  const match = options.find((option) => pattern.test(option.label));
  if (!match) {
    throw new Error(`No select option matches ${pattern}`);
  }

  return match.value;
}

function mapMarkerIcons(page: Page) {
  // .map-marker-item is present on rider/availability markers only — the center
  // (pro location) marker uses .map-marker-icon without .map-marker-item.
  // Using the more specific selector avoids counting or targeting the center
  // marker when zoomed out and markers overlap at the same pixel.
  return page.locator('.leaflet-marker-icon.map-marker-item');
}

async function dismissAdsModalIfPresent(page: Page) {
  const modalHeading = page.getByRole('heading', { name: /Publicités adaptées à tes goûts surf\/kite/i });
  // waitFor polls briefly so a late-appearing modal (rendered after initial paint) is caught.
  // isVisible() is instantaneous and misses modals that appear after this call.
  const appeared = await modalHeading
    .waitFor({ state: 'visible', timeout: 2_000 })
    .then(() => true)
    .catch(() => false);
  if (appeared) {
    const dismissButton = page
      .getByRole('button', { name: /Continuer avec les pubs basiques|Utiliser les pubs limitées/i })
      .first();
    await dismissButton.click();
    await expect(modalHeading).toBeHidden({ timeout: 10_000 });
  }
}

async function loadVisibleLessonRequests(page: Page) {
  // Callers already waited for .leaflet-container visibility — dismiss modal directly.
  await dismissAdsModalIfPresent(page);

  // Disable Leaflet CSS transitions so markers are immediately stable after
  // flyToBounds — prevents the "element is not stable" / "intercepts pointer
  // events" race when the viewport animates on radius change.
  await page.addStyleTag({
    content: '.leaflet-zoom-animated { transition-property: none !important; }',
  });

  const radiusInput = page.locator('input[type="number"]').first();
  await radiusInput.fill('200');
  await dismissAdsModalIfPresent(page);
  await page.getByRole('button', { name: /Rafraîchir/i }).click();

  await expect
    .poll(
      async () => {
        const text = await page.locator('main').textContent();
        const match = text?.match(/(\d+)\s+demande\(s\)\s+trouvée\(s\)/i);
        return match ? Number(match[1]) : -1;
      },
      { timeout: 15_000 },
    )
    .toBeGreaterThan(0);

  // Wait for the Leaflet flyToBounds animation to settle. The map animates when
  // bounds change; clicking a marker during animation triggers "intercepts pointer
  // events" because the marker pane is mid-transform. leaflet-zoom-anim is added
  // to the container for the duration of the animation.
  await page.waitForFunction(
    () => !document.querySelector('.leaflet-container.leaflet-zoom-anim'),
    { timeout: 5_000 },
  ).catch(() => { /* animation may have already ended */ });
}

// Seed guarantee: dev+pro9 has lat/lng → /pro/me returns them → geolocEnabled=true.
// Therefore .leaflet-container ALWAYS renders for an authenticated pro with seed data.
// Lesson-request markers are guaranteed by setupLessonFixture() in beforeAll.

test.describe('Pro Map (Blobomap)', () => {
  test.describe.configure({ mode: 'serial' });

  let proStorageState: StorageState;

  test.beforeAll(async ({ browser }) => {
    const context = await loginWithCookieSession(browser, PRO_EMAIL, {
      password: PRO_PASSWORD,
      tag: 'pro-map-auth',
    });
    proStorageState = await context.storageState();
    await context.close();

    // Ensure at least one rider has lesson coords visible to /pro/near/lessons
    await setupLessonFixture();
  });

  test('should display map page with riders looking for lessons', async ({ browser }) => {
    const { context, page } = await createPageFromStorageState(browser, proStorageState, 'pro-map');
    await setupConsent(page);
    await page.goto(appUrl('/pro/map'));
    await expect(page).toHaveURL(/\/pro\/map/);

    // Seed guarantees lat/lng → Leaflet map container must appear.
    await expect(page.locator('.leaflet-container')).toBeVisible({ timeout: 10000 });

    await context.close();
  });

  test('should display markers for riders on the map', async ({ browser }) => {
    const { context, page } = await createPageFromStorageState(browser, proStorageState, 'pro-map-markers');
    await setupConsent(page);
    await page.goto(appUrl('/pro/map'));
    await expect(page).toHaveURL(/\/pro\/map/);
    await expect(page.locator('.leaflet-container')).toBeVisible({ timeout: 10000 });

    await loadVisibleLessonRequests(page);

    // loadVisibleLessonRequests guarantees count > 0 via expect.poll on the rider count text.
    // No conditional needed: if markers are absent here, the fixture failed upstream.
    const markers = mapMarkerIcons(page);
    expect(await markers.count()).toBeGreaterThan(0);

    await context.close();
  });

  test('should show rider details on marker click', async ({ browser }) => {
    const { context, page } = await createPageFromStorageState(browser, proStorageState, 'pro-map-details');
    await setupConsent(page);
    await page.goto(appUrl('/pro/map'));
    await expect(page).toHaveURL(/\/pro\/map/);
    await expect(page.locator('.leaflet-container')).toBeVisible({ timeout: 10000 });

    await loadVisibleLessonRequests(page);

    // loadVisibleLessonRequests guarantees markers are present — assertion replaces conditional.
    const markers = mapMarkerIcons(page);
    expect(await markers.count()).toBeGreaterThan(0);
    // force: true bypasses "intercepts pointer events" — at high zoom-out levels
    // (200 km radius) markers can overlap at the same pixel. Leaflet still
    // receives the click event on the correct element via its own hit-testing.
    await markers.first().click({ force: true });
    // MapComponent renders a Leaflet <Popup> with rider details.
    await expect(page.locator('.leaflet-popup')).toBeVisible({ timeout: 5000 });

    await context.close();
  });

  test('should filter riders by sport', async ({ browser }) => {
    const { context, page } = await createPageFromStorageState(browser, proStorageState, 'pro-map-filter-sport');
    await setupConsent(page);
    await page.goto(appUrl('/pro/map'));
    await expect(page).toHaveURL(/\/pro\/map/);
    await expect(page.locator('.leaflet-container')).toBeVisible({ timeout: 10_000 });
    await dismissAdsModalIfPresent(page);

    // Sport buttons are rendered unconditionally — hard assertion preserved from #147.
    const surfBtn = page.getByRole('button', { name: /surf/i }).first();
    const kitesurfBtn = page.getByRole('button', { name: /kitesurf/i }).first();
    await expect(surfBtn).toBeVisible({ timeout: 10000 });
    await expect(kitesurfBtn).toBeVisible();

    await kitesurfBtn.click();
    await page.waitForResponse(
      (resp) => resp.url().includes('/pro/near/lessons') && resp.status() === 200,
      { timeout: 8000 },
    );

    await context.close();
  });

  // Level filter UI does not exist in the current /pro/map implementation (#147).
  // Re-enable and implement when the level filter feature is added to the map page.
  test.skip('should filter riders by level — level filter UI not yet implemented in /pro/map (#147)', () => {});

  test('should adjust map radius/distance filter', async ({ browser }) => {
    const { context, page } = await createPageFromStorageState(browser, proStorageState, 'pro-map-radius');
    await setupConsent(page);
    await page.goto(appUrl('/pro/map'));
    await expect(page).toHaveURL(/\/pro\/map/);
    await expect(page.locator('.leaflet-container')).toBeVisible({ timeout: 10_000 });
    await dismissAdsModalIfPresent(page);

    // Radius input (labeled "Rayon :") is always rendered — hard assertion preserved from #147.
    const radiusInput = page.getByLabel(/rayon/i);
    await expect(radiusInput).toBeVisible({ timeout: 10000 });

    await radiusInput.fill('50');
    // Seed has lat/lng → geoloc active → radius change triggers debounced API fetch.
    await page.waitForResponse(
      (resp) => resp.url().includes('/pro/near/lessons') && resp.status() === 200,
      { timeout: 8000 },
    );

    await context.close();
  });

  test('should show rider count or statistics', async ({ browser }) => {
    const { context, page } = await createPageFromStorageState(browser, proStorageState, 'pro-map-stats');
    await setupConsent(page);
    await page.goto(appUrl('/pro/map'));
    await expect(page).toHaveURL(/\/pro\/map/);
    await expect(page.locator('.leaflet-container')).toBeVisible({ timeout: 10_000 });
    await dismissAdsModalIfPresent(page);

    // Fixture ensures at least 1 rider is visible → hard assertion preserved from #147.
    await expect(page.locator('text=/demande\\(s\\) trouvée\\(s\\)/i')).toBeVisible({ timeout: 10000 });

    await context.close();
  });

  test('should allow contacting a rider from the map', async ({ browser }) => {
    const { context, page } = await createPageFromStorageState(browser, proStorageState, 'pro-map-contact');
    await setupConsent(page);
    await page.goto(appUrl('/pro/map'));
    await expect(page).toHaveURL(/\/pro\/map/);
    await expect(page.locator('.leaflet-container')).toBeVisible({ timeout: 10000 });

    await loadVisibleLessonRequests(page);

    // loadVisibleLessonRequests guarantees markers are present — assertion replaces conditional.
    const markers = mapMarkerIcons(page);
    expect(await markers.count()).toBeGreaterThan(0);
    // force: true — same rationale as the marker-click test above.
    await markers.first().click({ force: true });
    // Wait for popup to open before looking for the button (Leaflet popup animation).
    await expect(page.locator('.leaflet-popup')).toBeVisible({ timeout: 5000 });
    // The MapComponent popup renders a "💬 Contacter" button.
    await expect(page.getByRole('button', { name: /contacter/i }).first()).toBeVisible({ timeout: 3000 });

    await context.close();
  });
});

test.describe('Pro Map Security', () => {
  test('should require authentication to access map', async ({ page }) => {
    await page.goto(appUrl('/pro/map'));

    // Should redirect to login
    await expect(page).toHaveURL(/\/(login|auth|connexion)/i, { timeout: 10000 });
  });

  test('should require PRO role to access map', async ({ browser }) => {
    const context = await loginWithCookieSession(browser, RIDER_EMAIL, {
      password: RIDER_PASSWORD,
      tag: 'rider-access-pro-map',
    });
    const page = await context.newPage();
    await page.goto(appUrl('/pro/map'));

    // Should redirect away from pro map — wait for navigation to settle
    await page.waitForURL((url) => !url.pathname.includes('/pro/map'), { timeout: 8000 });

    await context.close();
  });
});
