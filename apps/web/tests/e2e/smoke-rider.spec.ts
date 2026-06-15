import { test, expect } from '@playwright/test';
import { loginWithCookieSession } from './helpers/auth';

/**
 * Smoke rider — parcours MVP GO/NO-GO pré-prod.
 *
 * Réalité MVP (vérifiée) : un rider dont le profil est incomplet (sans photo —
 * cas des comptes seedés) est **redirigé du dashboard vers /onboarding**, qui
 * impose 3 étapes obligatoires avant d'accéder au matching. Ce gating est le
 * comportement attendu, pas un bug.
 *
 * Le smoke prouve donc : connexion (cookies httpOnly réels via le helper),
 * arrivée sur un espace cohérent (gate onboarding), CTA profil fonctionnel
 * (anti-bouton mort), déconnexion, et refus d'accès admin.
 *
 * Sélecteurs par rôle/texte de contenu, jamais sur la nav dupliquée responsive
 * ni sur des classes CSS.
 */
const RIDER_EMAIL = process.env.E2E_RIDER_EMAIL ?? 'dev+rider1@test.com';
const RIDER_PASSWORD = process.env.E2E_RIDER_PASSWORD ?? 'Passw0rd!';

test.describe('Smoke rider — parcours MVP', () => {
  test('login → onboarding obligatoire → profil → logout', async ({ browser }) => {
    const context = await loginWithCookieSession(browser, RIDER_EMAIL, {
      password: RIDER_PASSWORD,
      tag: 'smoke-rider',
    });
    const page = await context.newPage();

    // Le dashboard redirige silencieusement un rider au profil incomplet
    // (hasName/hasPhoto/hasDiscipline) vers l'onboarding obligatoire.
    await page.goto('/dashboard');
    await page.waitForURL(/\/onboarding/, { timeout: 15_000 });

    await expect(
      page.getByRole('heading', { level: 1, name: /bienvenue/i }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByText(/3 étapes obligatoires/i),
    ).toBeVisible();

    // Anti-bouton mort : le CTA "Ouvrir mon profil" mène bien au profil rider.
    await page.getByRole('button', { name: /ouvrir mon profil/i }).click();
    await expect(page).toHaveURL(/\/profile/, { timeout: 10_000 });

    // Déconnexion depuis l'espace compte (toujours accessible).
    await page.goto('/account');
    await expect(
      page.getByRole('heading', { level: 1, name: /mon compte/i }),
    ).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: /se déconnecter/i }).click();
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });

    await context.close();
  });

  test('rider ne peut pas atteindre le dashboard admin', async ({ browser }) => {
    const context = await loginWithCookieSession(browser, RIDER_EMAIL, {
      password: RIDER_PASSWORD,
      tag: 'smoke-rider-admin-gate',
    });
    const page = await context.newPage();

    await page.goto('/admin/dashboard');
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });

    await context.close();
  });
});
