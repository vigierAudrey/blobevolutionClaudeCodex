import { test, expect, type BrowserContext, type Page } from '@playwright/test';

// Extend window interface for gtag tracking
interface WindowWithGtagTracking extends Window {
  __gtagCalls?: unknown[];
  gtag?: (...args: unknown[]) => void;
}

type ConsentMode = 'personalized' | 'npa' | 'limited' | 'none';

const SIGNALS: Record<ConsentMode, { ad_storage: 'granted' | 'denied'; ad_user_data: 'granted' | 'denied'; ad_personalization: 'granted' | 'denied' }> = {
  personalized: { ad_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'granted' },
  npa: { ad_storage: 'granted', ad_user_data: 'denied', ad_personalization: 'denied' },
  limited: { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' },
  none: { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' },
};

const encodeConsent = (mode: ConsentMode) =>
  JSON.stringify({
    mode,
    signals: SIGNALS[mode],
    cmpVersion: 'playwright-suite',
    updatedAt: new Date().toISOString(),
  });

async function bootstrapConsent(context: BrowserContext, mode: ConsentMode) {
  await context.addInitScript(
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

async function assertGtagSignals(page: Page, expected: typeof SIGNALS[ConsentMode], mode: ConsentMode) {
  const calls = await page.evaluate(() => (window as WindowWithGtagTracking).__gtagCalls ?? []);
  const consentCall = calls.find((args: unknown) => Array.isArray(args) && args[0] === 'consent' && args[1] === 'update');
  expect(consentCall).toBeTruthy();
  if (Array.isArray(consentCall)) {
    expect(consentCall[2]).toMatchObject(expected);
  }

  if (mode === 'none') {
    return;
  }
  const impression = calls.find((args: unknown) => Array.isArray(args) && args[0] === 'event' && args[1] === 'ad_impression');
  expect(impression).toBeTruthy();
  if (Array.isArray(impression)) {
    expect(impression[2]).toMatchObject({ ad_mode: mode });
  }
}

test.describe('Consent-driven ads', () => {
  test('renders personalized ads when full consent is granted', async ({ context, page }) => {
    await bootstrapConsent(context, 'personalized');
    await page.goto('/matching');

    await expect(page.locator('ins.adsbygoogle')).toHaveCount(1, { timeout: 5000 });
    const scriptLoaded = await page.evaluate(() => !!document.querySelector('script[data-blobinfini="adsense"]'));
    expect(scriptLoaded).toBeTruthy();

    await assertGtagSignals(page, SIGNALS.personalized, 'personalized');
  });

  test('renders non-personalized ads when only storage is granted', async ({ context, page }) => {
    await bootstrapConsent(context, 'npa');
    await page.goto('/matching');

    await expect(page.locator('ins.adsbygoogle')).toHaveCount(1, { timeout: 5000 });
    const dataNpa = await page.locator('ins.adsbygoogle').getAttribute('data-npa');
    expect(dataNpa).toBe('1');

    await assertGtagSignals(page, SIGNALS.npa, 'npa');
  });

  test('renders limited ads without storage', async ({ context, page }) => {
    await bootstrapConsent(context, 'limited');
    await page.goto('/matching');

    await expect(page.locator('ins.adsbygoogle')).toHaveCount(1, { timeout: 5000 });
    const dataNpa = await page.locator('ins.adsbygoogle').getAttribute('data-npa');
    expect(dataNpa).toBe('1');

    await assertGtagSignals(page, SIGNALS.limited, 'limited');

    const cookies = await context.cookies();
    const googleCookies = cookies.filter((cookie) => /google/i.test(cookie.name));
    expect(googleCookies.length).toBe(0);
  });

  test('renders house ads with full refusal', async ({ context, page }) => {
    await bootstrapConsent(context, 'none');
    await page.goto('/matching');

    await expect(page.getByText(/BlobConnect House Ads/i)).toBeVisible();
    await expect(page.locator('ins.adsbygoogle')).toHaveCount(0);

    const scriptLoaded = await page.evaluate(() => !!document.querySelector('script[data-blobinfini="adsense"]'));
    expect(scriptLoaded).toBeFalsy();

    await assertGtagSignals(page, SIGNALS.none, 'none');

    const cookies = await context.cookies();
    const googleCookies = cookies.filter((cookie) => /google/i.test(cookie.name));
    expect(googleCookies.length).toBe(0);
  });
});
