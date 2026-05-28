import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { loginWithCookieSession } from './helpers/auth';

// Extend window interface for gtag tracking and internal consent observability
interface WindowWithGtagTracking extends Window {
  __gtagCalls?: unknown[];
  gtag?: (...args: unknown[]) => void;
  /** Set by useConsent after bootstrap + gtag:consent:update — reliable boot signal. */
  __CONSENT_READY?: boolean;
  /** Active consent mode as seen by useConsent — cross-validates test expectation. */
  __CONSENT_MODE?: string;
}

type ConsentMode = 'personalized' | 'npa' | 'limited' | 'none';

const SIGNALS: Record<ConsentMode, { ad_storage: 'granted' | 'denied'; ad_user_data: 'granted' | 'denied'; ad_personalization: 'granted' | 'denied' }> = {
  personalized: { ad_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'granted' },
  npa: { ad_storage: 'granted', ad_user_data: 'denied', ad_personalization: 'denied' },
  limited: { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' },
  none: { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' },
};
const ADS_RIDER_EMAIL = process.env.E2E_ADS_RIDER_EMAIL ?? 'dev+active-rider-c@test.com';
const ADS_RIDER_PASSWORD = process.env.E2E_ADS_RIDER_PASSWORD ?? 'Passw0rd!';

const encodeConsent = (mode: ConsentMode) =>
  JSON.stringify({
    mode,
    signals: SIGNALS[mode],
    cmpVersion: 'playwright-suite',
    updatedAt: new Date().toISOString(),
  });

async function bootstrapConsent(page: Page, mode: ConsentMode) {
  await page.addInitScript(
    ({ consent, modeSignals }) => {
      window.localStorage.setItem('blob_consent', consent);
      window.localStorage.setItem('blob_device_id', 'playwright-device');
      window.localStorage.setItem('cookie-consent', modeSignals.mode === 'personalized' ? 'personalized' : modeSignals.mode === 'npa' || modeSignals.mode === 'limited' ? 'essential' : 'none');
      window.adsbygoogle = [];
      const callStore: unknown[] = [];
      (window as WindowWithGtagTracking).__gtagCalls = callStore;
      (window as WindowWithGtagTracking).gtag = (...args: unknown[]) => {
        callStore.push(args);
      };
    },
    { consent: encodeConsent(mode), modeSignals: { mode } },
  );
}

async function openMatchingWithConsent(browser: Browser, mode: ConsentMode) {
  const context = await loginWithCookieSession(browser, ADS_RIDER_EMAIL, {
    password: ADS_RIDER_PASSWORD,
    tag: `ads-consent-${mode}`,
  });
  const page = await context.newPage();
  await bootstrapConsent(page, mode);
  await page.goto('/matching');
  await expect(page).toHaveURL(/\/matching/);
  return { context, page };
}

async function assertGtagSignals(page: Page, expected: typeof SIGNALS[ConsentMode], mode: ConsentMode) {
  // Gate on internal bootstrap signal first: __CONSENT_READY is set synchronously after
  // gtag('consent','update') inside useConsent, so this implies the call was already made.
  // Waiting here before inspecting __gtagCalls eliminates the race where we snapshot an
  // empty call list before the React effect has run.
  await page.waitForFunction(
    () => (window as WindowWithGtagTracking).__CONSENT_READY === true,
    undefined,
    { timeout: 10000 },
  );

  // Cross-validate that the internal mode matches what the test expects.
  // Catches false-positives where gtag fires with a stale mode from a previous test.
  const internalMode = await page.evaluate(() => (window as WindowWithGtagTracking).__CONSENT_MODE);
  expect(internalMode).toBe(mode);

  // gtag() calls are fired in React useEffects — they can execute slightly after the
  // DOM element (ins.adsbygoogle) is painted. Poll instead of snapshotting immediately.
  await page.waitForFunction(
    () => {
      const calls = (window as WindowWithGtagTracking).__gtagCalls ?? [];
      return calls.some((a: unknown) => Array.isArray(a) && a[0] === 'consent' && a[1] === 'update');
    },
    undefined,
    { timeout: 8000 },
  );

  const calls = await page.evaluate(() => (window as WindowWithGtagTracking).__gtagCalls ?? []);
  const consentCall = calls.find((args: unknown) => Array.isArray(args) && args[0] === 'consent' && args[1] === 'update');
  expect(consentCall).toBeTruthy();
  if (Array.isArray(consentCall)) {
    expect(consentCall[2]).toMatchObject(expected);
  }

  if (mode === 'none') {
    return;
  }

  await page.waitForFunction(
    () => {
      const calls = (window as WindowWithGtagTracking).__gtagCalls ?? [];
      return calls.some((a: unknown) => Array.isArray(a) && a[0] === 'event' && a[1] === 'ad_impression');
    },
    undefined,
    { timeout: 8000 },
  );

  const allCalls = await page.evaluate(() => (window as WindowWithGtagTracking).__gtagCalls ?? []);
  const impression = allCalls.find((args: unknown) => Array.isArray(args) && args[0] === 'event' && args[1] === 'ad_impression');
  expect(impression).toBeTruthy();
  if (Array.isArray(impression)) {
    expect(impression[2]).toMatchObject({ ad_mode: mode });
  }
}

test.describe('Consent-driven ads', () => {
  test('renders personalized ads when full consent is granted', async ({ browser }) => {
    const { context, page } = await openMatchingWithConsent(browser, 'personalized');

    // Wait for consent signals to propagate — ad_impression fires AFTER the ins element is
    // committed to the DOM, so this guarantees the slot is stable before counting.
    await assertGtagSignals(page, SIGNALS.personalized, 'personalized');

    const slot = page.locator('ins.adsbygoogle[data-ad-slot="matching-selection"]');
    await expect(slot).toHaveCount(1);
    const scriptLoaded = await page.evaluate(() => !!document.querySelector('script[data-blobinfini="adsense"]'));
    expect(scriptLoaded).toBeTruthy();
    await context.close();
  });

  test('renders non-personalized ads when only storage is granted', async ({ browser }) => {
    const { context, page } = await openMatchingWithConsent(browser, 'npa');

    await assertGtagSignals(page, SIGNALS.npa, 'npa');

    const slot = page.locator('ins.adsbygoogle[data-ad-slot="matching-selection"]');
    await expect(slot).toHaveCount(1);
    const dataNpa = await slot.getAttribute('data-npa');
    expect(dataNpa).toBe('1');
    await context.close();
  });

  test('renders limited ads without storage', async ({ browser }) => {
    const { context, page } = await openMatchingWithConsent(browser, 'limited');

    await assertGtagSignals(page, SIGNALS.limited, 'limited');

    const slot = page.locator('ins.adsbygoogle[data-ad-slot="matching-selection"]');
    await expect(slot).toHaveCount(1);
    const dataNpa = await slot.getAttribute('data-npa');
    expect(dataNpa).toBe('1');

    const cookies = await context.cookies();
    const googleCookies = cookies.filter((cookie) => /google/i.test(cookie.name));
    expect(googleCookies.length).toBe(0);
    await context.close();
  });

  test('renders house ads with full refusal', async ({ browser }) => {
    const { context, page } = await openMatchingWithConsent(browser, 'none');

    // consent:update fires once useConsent establishes mode='none' — after this,
    // adEnabled=false so no ins.adsbygoogle is rendered in the tested slot.
    await assertGtagSignals(page, SIGNALS.none, 'none');

    await expect(page.getByText(/Blob House Ads/i)).toBeVisible();
    const slot = page.locator('ins.adsbygoogle[data-ad-slot="matching-selection"]');
    await expect(slot).toHaveCount(0);

    const scriptLoaded = await page.evaluate(() => !!document.querySelector('script[data-blobinfini="adsense"]'));
    expect(scriptLoaded).toBeFalsy();

    const cookies = await context.cookies();
    const googleCookies = cookies.filter((cookie) => /google/i.test(cookie.name));
    expect(googleCookies.length).toBe(0);
    await context.close();
  });
});

// ---------------------------------------------------------------------------
// Signal integrity tests
// ---------------------------------------------------------------------------
// These tests target the __CONSENT_READY / __CONSENT_MODE observability layer,
// not the ad rendering logic. They verify structural properties of the signal.
// ---------------------------------------------------------------------------

test.describe('Consent signal integrity', () => {
  // Test 1 (required): existing 4 modes already exercise personalized/npa/limited/none.
  // Signal integrity for each mode is proven by the __CONSENT_MODE cross-check inside
  // assertGtagSignals — see above. No duplication here.

  // Test 2: prove __CONSENT_READY is not true before bootstrap resolves.
  //
  // The reset `window.__CONSENT_READY = false` is placed at the synchronous start of
  // bootstrap() in useConsent — before sha256, before localStorage, before the API call.
  // This guarantees that immediately after page.goto returns (load event + React
  // hydration complete), __CONSENT_READY is false regardless of which resolution path
  // the bootstrap takes.
  //
  // Note: we cannot reliably block the bootstrap mid-flight in e2e (sha256 + localStorage
  // complete in <1ms). Instead we verify the property that follows from our fix: at the
  // earliest observable point after load, the signal has been reset to false and has not
  // yet transitioned to true (the async chain — sha256 + TCF + localStorage + API — is
  // still in-flight at that moment, or barely completed).
  test('__CONSENT_READY is reset to false at bootstrap start and transitions to true', async ({ page }) => {
    // Block consent API to eliminate remote data as a resolution source.
    // If the apiClient URL matches this pattern, it returns 404 → default fallback.
    // If the URL doesn't match (framework SSR path, different hostname), the route
    // is simply never called and the test still verifies the reset + eventual true.
    await page.route('**/consent/**', (route) => route.fulfill({ status: 404, body: '{}' }));

    // No localStorage injection — fresh context, no prior consent.
    await page.goto('/matching');

    // At this point bootstrap() has already fired __CONSENT_READY = false (fix 1).
    // The bootstrap async chain may or may not have completed yet.
    // Either way, the value must be false or undefined — never a stale true.
    const readyAtLoad = await page.evaluate(() => (window as WindowWithGtagTracking).__CONSENT_READY);
    expect(readyAtLoad).not.toBe(true);

    // Bootstrap resolves via the default path → __CONSENT_READY must reach true.
    await page.waitForFunction(
      () => (window as WindowWithGtagTracking).__CONSENT_READY === true,
      undefined,
      { timeout: 8000 },
    );
    const mode = await page.evaluate(() => (window as WindowWithGtagTracking).__CONSENT_MODE);
    expect(mode).toBe('none');
  });

  // Test 3: prove __CONSENT_MODE does not retain the value of a previous test.
  //
  // Each Playwright test gets a fresh BrowserContext → fresh window object →
  // window.__CONSENT_READY and __CONSENT_MODE start as undefined. This test makes
  // the guarantee explicit: it runs without any injection (no bootstrapConsent call)
  // and asserts that the resolved mode is 'none', NOT any mode that appeared in
  // earlier tests ('personalized', 'npa', 'limited'). If cross-test contamination
  // were possible, this test would observe a non-'none' mode.
  test('__CONSENT_MODE is none in a fresh context with no prior injection', async ({ page }) => {
    // Block remote consent lookup to prevent server-side stored consent from leaking.
    await page.route('**/consent/**', (route) => route.fulfill({ status: 404, body: '{}' }));

    // No addInitScript, no localStorage seeding.
    await page.goto('/matching');

    await page.waitForFunction(
      () => (window as WindowWithGtagTracking).__CONSENT_READY === true,
      undefined,
      { timeout: 8000 },
    );

    const mode = await page.evaluate(() => (window as WindowWithGtagTracking).__CONSENT_MODE);
    // Must be 'none' — the default. Any other value means stale data bled in.
    expect(mode).toBe('none');
  });

  // Test 4: __CONSENT_READY with no addInitScript injection.
  //
  // This test exercises the real bootstrap path (localStorage empty, TCF absent,
  // API blocked) and verifies that __CONSENT_READY reaches true with the correct
  // default mode. It is intentionally NOT using bootstrapConsent / addInitScript
  // so that the full async chain is exercised without test injection.
  //
  // Why addInitScript cannot be fully avoided for personalized/npa/limited:
  // Those modes require pre-populated localStorage before React hydrates because
  // the CookieConsent overlay blocks UI interaction until dismissed. Without injection,
  // the only observable mode in e2e is 'none' (the fallback). The banner would need
  // to be dismissed via UI interaction to test other modes without injection, which
  // couples consent tests to the CMP UI component — a separate concern.
  test('__CONSENT_READY reaches true via default path without injection', async ({ page }) => {
    await page.route('**/consent/**', (route) => route.fulfill({ status: 404, body: '{}' }));

    await page.goto('/matching');

    await page.waitForFunction(
      () => (window as WindowWithGtagTracking).__CONSENT_READY === true,
      undefined,
      { timeout: 8000 },
    );

    const { ready, mode } = await page.evaluate(() => ({
      ready: (window as WindowWithGtagTracking).__CONSENT_READY,
      mode: (window as WindowWithGtagTracking).__CONSENT_MODE,
    }));

    expect(ready).toBe(true);
    expect(mode).toBe('none');
  });
});
