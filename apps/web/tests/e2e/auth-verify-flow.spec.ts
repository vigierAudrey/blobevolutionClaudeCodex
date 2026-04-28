/**
 * E2E proof: auth email-verify flow
 *
 * Verifies three security/UX invariants introduced in commit 3695f65:
 *   1. PRO email verification → redirected to /login-pro (not /login)
 *   2. RIDER email verification → redirected to /login
 *   3. Token NEVER appears in the DOM (was leaking via <Input> before the fix)
 *
 * Requires running servers:
 *   - API: PLAYWRIGHT_API_URL (default http://localhost:4000)
 *   - Web: PLAYWRIGHT_BASE_URL (default http://localhost:3002)
 *   - Mailpit: http://localhost:8025
 *
 * Run: SKIP_E2E_RESEED=1 npx playwright test --config=playwright.auth-verify.config.ts
 */
import { test, expect, request as playwrightRequest } from '@playwright/test';
import crypto from 'crypto';

const API_URL = process.env.PLAYWRIGHT_API_URL ?? 'http://localhost:4000';
const WEB_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3002';
const MAILPIT_URL = process.env.MAILPIT_URL ?? `http://localhost:${process.env.MAILPIT_HOST_PORT ?? '8025'}`;
const PASSWORD = 'Passw0rd!Verify99';

// ─── helpers ────────────────────────────────────────────────────────────────

async function registerUser(email: string, role: 'PRO' | 'RIDER'): Promise<void> {
  const apiCtx = await playwrightRequest.newContext({ baseURL: API_URL });
  const csrfRes = await apiCtx.get('/csrf-token');
  if (!csrfRes.ok()) throw new Error(`CSRF fetch failed: ${csrfRes.status()}`);
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };

  const reg = await apiCtx.post('/auth/register', {
    headers: { 'X-CSRF-Token': csrfToken },
    data: { email, password: PASSWORD, role, consentAccepted: true, ...(role === 'PRO' ? { countryCode: 'FR' } : {}) },
  });
  await apiCtx.dispose();
  if (!reg.ok()) {
    const body = await reg.text();
    throw new Error(`Register failed ${reg.status()}: ${body}`);
  }
}

async function getVerifyUrlFromMailpit(recipientEmail: string): Promise<string> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const listRes = await fetch(`${MAILPIT_URL}/api/v1/messages?limit=50`);
    if (!listRes.ok) {
      await new Promise((r) => setTimeout(r, 500));
      continue;
    }
    const list = (await listRes.json()) as {
      messages: Array<{ ID: string; To: Array<{ Address: string }>; Subject: string }>;
    };
    const msg = list.messages?.find(
      (m) =>
        m.To?.some((t) => t.Address.toLowerCase() === recipientEmail.toLowerCase()) &&
        (m.Subject?.toLowerCase().includes('vérif') ||
          m.Subject?.toLowerCase().includes('verif') ||
          m.Subject?.toLowerCase().includes('confirm')),
    );
    if (msg) {
      const msgRes = await fetch(`${MAILPIT_URL}/api/v1/message/${msg.ID}`);
      const msgData = (await msgRes.json()) as { Text?: string; HTML?: string };
      const body = msgData.Text ?? msgData.HTML ?? '';
      // Extract the full verify URL from the email body
      const match = body.match(/https?:\/\/\S+\/verify\S*/);
      if (match) {
        // Rewrite host to match the actual running web server (WEB_URL may differ from WEB_BASE_URL in email)
        const url = new URL(match[0].replace(/&amp;/g, '&'));
        const webBaseUrl = new URL(WEB_URL);
        url.hostname = webBaseUrl.hostname;
        url.port = webBaseUrl.port;
        url.protocol = webBaseUrl.protocol;
        return url.toString();
      }
    }
    await new Promise((r) => setTimeout(r, 600));
  }
  throw new Error(`No verification email found for ${recipientEmail} within 15s`);
}

function uniqueEmail(prefix: string) {
  return `${prefix}-${crypto.randomBytes(4).toString('hex')}@e2e-verify.test`;
}

// Dismiss cookie consent modal so it doesn't intercept button clicks.
const MINIMAL_CONSENT = JSON.stringify({
  mode: 'limited',
  signals: { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' },
  cmpVersion: 'active-user-simulation',
  updatedAt: '2026-03-15T00:00:00.000Z',
});

async function setConsentStorage(page: import('@playwright/test').Page) {
  await page.addInitScript((consent) => {
    window.localStorage.setItem('blob_consent', consent);
    window.localStorage.setItem('cookie-consent', 'essential');
  }, MINIMAL_CONSENT);
}

// ─── tests ───────────────────────────────────────────────────────────────────

test('PRO email verification → redirects to /login-pro, token never in DOM', async ({ page }) => {
  const email = uniqueEmail('pro');
  await registerUser(email, 'PRO');

  const verifyUrl = await getVerifyUrlFromMailpit(email);
  const token = new URL(verifyUrl).searchParams.get('token');
  expect(token).toBeTruthy(); // token exists in URL

  // Suppress consent modal (blocking) and navigate as if clicking the email link
  await setConsentStorage(page);
  await page.goto(verifyUrl);

  // Wait for verification to complete (status changes to success or error)
  await expect(page.getByText(/vérifié|invalide|expiré|erreur/i)).toBeVisible({ timeout: 10_000 });

  // INVARIANT 1: token must NOT be visible in rendered text or in any form input
  const bodyText = await page.evaluate(() => document.body.innerText);
  expect(bodyText).not.toContain(token!);
  // Check no input/textarea has the token as its value (was the original bug)
  const inputWithToken = await page.evaluate(
    (t) => Array.from(document.querySelectorAll('input, textarea')).some((el) => (el as HTMLInputElement).value === t),
    token!,
  );
  expect(inputWithToken).toBe(false);

  // INVARIANT 2: success path → auto-redirect to /login-pro (2 s timer in component)
  await expect(page).toHaveURL(/\/login-pro/, { timeout: 8_000 });
});

test('RIDER email verification → redirects to /login, token never in DOM', async ({ page }) => {
  const email = uniqueEmail('rider');
  await registerUser(email, 'RIDER');

  const verifyUrl = await getVerifyUrlFromMailpit(email);
  const token = new URL(verifyUrl).searchParams.get('token');
  expect(token).toBeTruthy();

  await setConsentStorage(page);
  await page.goto(verifyUrl);
  await expect(page.getByText(/vérifié|invalide|expiré|erreur/i)).toBeVisible({ timeout: 10_000 });

  // Token must NOT be visible in rendered text or any form input
  const bodyText = await page.evaluate(() => document.body.innerText);
  expect(bodyText).not.toContain(token!);
  const inputWithToken = await page.evaluate(
    (t) => Array.from(document.querySelectorAll('input, textarea')).some((el) => (el as HTMLInputElement).value === t),
    token!,
  );
  expect(inputWithToken).toBe(false);

  // Redirect to /login (RIDER, not /login-pro) — auto fires after 2 s
  await expect(page).toHaveURL(/\/login(?!-pro)/, { timeout: 8_000 });
});

test('Invalid token → neutral error message, token never in DOM', async ({ page }) => {
  const fakeToken = crypto.randomBytes(32).toString('hex');
  await page.goto(`${WEB_URL}/verify?token=${fakeToken}`);

  // Wait for error state
  await expect(page.getByText(/invalide|expiré|erreur/i)).toBeVisible({ timeout: 10_000 });

  // Token must NOT be visible in rendered text or any form input
  const bodyText = await page.evaluate(() => document.body.innerText);
  expect(bodyText).not.toContain(fakeToken);
  const inputWithToken = await page.evaluate(
    (t) => Array.from(document.querySelectorAll('input, textarea')).some((el) => (el as HTMLInputElement).value === t),
    fakeToken,
  );
  expect(inputWithToken).toBe(false);

  // No success redirect occurred — still on /verify
  expect(page.url()).toContain('/verify');
});
