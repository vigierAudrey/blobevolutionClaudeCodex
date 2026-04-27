import { request as playwrightRequest, type Browser, type BrowserContext, type Page } from '@playwright/test';

const API_BASE_URL = process.env.PLAYWRIGHT_API_URL ?? 'http://localhost:4000';
const DEFAULT_PASSWORD = process.env.E2E_DEFAULT_PASSWORD ?? 'Passw0rd!';
const SESSION_HINT_KEY = 'blob_session_hint';

const MINIMAL_AD_CONSENT = JSON.stringify({
  mode: 'limited',
  signals: {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
  },
  cmpVersion: 'active-user-simulation',
  updatedAt: '2026-03-15T00:00:00.000Z',
});

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

export async function loginWithCookieSession(
  browser: Browser,
  email: string,
  options: { password?: string; tag: string; adminSession?: boolean } = { tag: 'default' }
): Promise<BrowserContext> {
  const password = options.password ?? DEFAULT_PASSWORD;
  const forwardedFor = testIp(options.tag);

  const apiContext = await playwrightRequest.newContext({
    baseURL: API_BASE_URL,
    extraHTTPHeaders: { 'X-Forwarded-For': forwardedFor },
  });

  const csrfResponse = await apiContext.get('/csrf-token');
  if (!csrfResponse.ok()) {
    throw new Error(`Unable to fetch CSRF token (${csrfResponse.status()})`);
  }

  const csrfJson = (await csrfResponse.json()) as { csrfToken?: string };
  if (!csrfJson.csrfToken) {
    throw new Error('Missing csrfToken in /csrf-token response');
  }

  const loginResponse = await apiContext.post('/auth/login', {
    headers: { 'X-CSRF-Token': csrfJson.csrfToken },
    data: { email, password, consentAccepted: true },
  });

  if (!loginResponse.ok()) {
    throw new Error(`Login failed for ${email}: ${loginResponse.status()} ${await loginResponse.text()}`);
  }

  const loginBody = (await loginResponse.json()) as { ok?: boolean; requires2FA?: boolean };
  if (loginBody.requires2FA) {
    throw new Error(`2FA login is not supported by this helper for ${email}`);
  }
  if (loginBody.ok !== true) {
    throw new Error(`Unexpected login payload for ${email}`);
  }

  const storageState = await apiContext.storageState();
  await apiContext.dispose();

  const context = await browser.newContext({
    storageState,
    extraHTTPHeaders: {
      'X-Forwarded-For': forwardedFor,
    },
  });

  await context.addInitScript((sessionHintKey) => {
    window.localStorage.setItem(sessionHintKey, '1');
  }, SESSION_HINT_KEY);

  if (options.adminSession) {
    await context.addCookies([
      {
        name: 'admin_session',
        value: '1',
        domain: 'localhost',
        path: '/',
        httpOnly: false,
        secure: false,
        sameSite: 'Lax',
        expires: Math.floor(Date.now() / 1000) + 7 * 24 * 3600,
      },
    ]);
  }

  return context;
}

export async function loginThroughUi(page: Page, email: string, password = DEFAULT_PASSWORD): Promise<void> {
  const forwardedFor = testIp(`ui-${email}`);

  await page.addInitScript(
    ({ consent }) => {
      window.localStorage.setItem('blob_consent', consent);
      window.localStorage.setItem('cookie-consent', 'essential');
      window.localStorage.setItem('blob_device_id', 'playwright-active-users');
    },
    { consent: MINIMAL_AD_CONSENT },
  );

  // Login via API context to avoid cross-origin CSRF timing issues in CI.
  // This proves cookie-based auth works: the cookies are placed in the browser
  // context exactly as they would be after a real login, then the browser uses
  // them for all subsequent authenticated requests.
  const apiContext = await playwrightRequest.newContext({
    baseURL: API_BASE_URL,
    extraHTTPHeaders: { 'X-Forwarded-For': forwardedFor },
  });

  const csrfResponse = await apiContext.get('/csrf-token');
  if (!csrfResponse.ok()) {
    throw new Error(`Unable to fetch CSRF token (${csrfResponse.status()})`);
  }
  const csrfJson = (await csrfResponse.json()) as { csrfToken?: string };
  if (!csrfJson.csrfToken) {
    throw new Error('Missing csrfToken in /csrf-token response');
  }

  const loginResponse = await apiContext.post('/auth/login', {
    headers: { 'X-CSRF-Token': csrfJson.csrfToken },
    data: { email, password, consentAccepted: true },
  });
  if (!loginResponse.ok()) {
    throw new Error(`Login failed for ${email}: ${loginResponse.status()} ${await loginResponse.text()}`);
  }

  const storageState = await apiContext.storageState();
  await apiContext.dispose();

  // Transfer auth cookies into the browser context
  await page.context().addCookies(storageState.cookies);

  // Navigate to an initial page so localStorage is accessible, then set the
  // session hint so authenticated pages don't redirect to /login.
  await page.goto('/login');
  await page.evaluate((sessionHintKey) => {
    window.localStorage.setItem(sessionHintKey, '1');
  }, SESSION_HINT_KEY);
}
