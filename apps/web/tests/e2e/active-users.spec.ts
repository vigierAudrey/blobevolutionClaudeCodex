import { test, expect } from '@playwright/test';
import { loginThroughUi } from './helpers/auth';

const RIDER_A_EMAIL = process.env.E2E_ACTIVE_RIDER_A_EMAIL ?? 'dev+active-rider-a@test.com';
const RIDER_B_EMAIL = process.env.E2E_ACTIVE_RIDER_B_EMAIL ?? 'dev+active-rider-b@test.com';
const DEFAULT_PASSWORD = process.env.E2E_DEFAULT_PASSWORD ?? 'Passw0rd!';

const MATCHING_QUERY =
  '/matching/cards?sport=surf&level=advanced&date=anytime&useGeoloc=1&distanceKm=10&lat=50.1234&lng=1.2345';

test.describe('Simulation utilisateurs actifs', () => {
  test('A et B parcourent le matching, ouvrent une conversation et vérifient la réception', async ({ browser }) => {
    const riderAContext = await browser.newContext();
    const riderAPage = await riderAContext.newPage();
    const messageText = `E2E active users ${Date.now()}`;

    await loginThroughUi(riderAPage, RIDER_A_EMAIL, DEFAULT_PASSWORD);
    await riderAPage.goto(MATCHING_QUERY);
    await expect(riderAPage.getByRole('heading', { name: /Parcourir les profils/i })).toBeVisible();
    await expect(riderAPage.getByText('Active Rider B')).toBeVisible({ timeout: 15000 });

    await riderAPage.getByRole('button', { name: /^Accepter$/i }).click();
    await expect(riderAPage.getByRole('heading', { name: /match/i })).toBeVisible({ timeout: 15000 });

    await riderAPage.getByRole('button', { name: /Envoyer un message/i }).click();
    await expect(riderAPage).toHaveURL(/\/messages\/[0-9a-f-]+$/i);

    const conversationUrl = riderAPage.url();
    const conversationId = conversationUrl.split('/').pop();
    expect(conversationId).toBeTruthy();

    await riderAPage.getByPlaceholder('Écrire un message').fill(messageText);
    await riderAPage.getByRole('button', { name: /^Envoyer$/i }).click();
    await expect(riderAPage.getByText(messageText)).toBeVisible({ timeout: 10000 });

    const riderBContext = await browser.newContext();
    const riderBPage = await riderBContext.newPage();
    await loginThroughUi(riderBPage, RIDER_B_EMAIL, DEFAULT_PASSWORD);
    await riderBPage.goto(`/messages/${conversationId}`);
    await expect(riderBPage.getByText(messageText)).toBeVisible({ timeout: 10000 });

    await riderBContext.close();
    await riderAContext.close();
  });
});
