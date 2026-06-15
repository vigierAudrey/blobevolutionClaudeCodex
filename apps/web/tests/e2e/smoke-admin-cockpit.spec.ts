import { test, expect } from '@playwright/test';
import { loginWithCookieSession } from './helpers/auth';

/**
 * Smoke admin — cockpit "État système" (GAP-2) + alertes système (GAP-3).
 *
 * Prouve qu'un admin atteint le cockpit, voit la synthèse d'infrastructure et la
 * page d'alertes, sans qu'aucun secret ne fuite dans le DOM, et peut se déconnecter.
 * Vérifie aussi qu'un PRO ne peut pas atteindre le cockpit admin.
 *
 * L'admin obtient le cookie admin_session automatiquement à la connexion API
 * (cf. helpers/auth + admin-access.spec.ts) — le middleware Next ouvre alors /admin/*.
 */
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'dev+admin@test.com';
const PRO_EMAIL = process.env.E2E_PRO_EMAIL ?? 'dev+pro1@test.com';
const PRO_PASSWORD = process.env.E2E_PRO_PASSWORD ?? 'Passw0rd!';

test.describe('Smoke admin — cockpit & alertes', () => {
  test('admin voit le cockpit État système (GAP-2) sans fuite de secret', async ({ browser }) => {
    const context = await loginWithCookieSession(browser, ADMIN_EMAIL, {
      tag: 'smoke-admin-health',
    });
    const page = await context.newPage();

    await page.goto('/admin/health');

    // Joignabilité du cockpit (GO/NO-GO) : un admin autorisé atteint la route
    // /admin/health et la page monte son contenu. Le h1 + le sous-titre du
    // cockpit sont déterministes, indépendants de l'état live de l'infra.
    //
    // NB : on ne dépend PAS du panneau de données live (readiness/disque/backup)
    // — son rendu dépend de la disponibilité de l'infra (storage/redis) et de la
    // latence d'agrégation, ce qui varie selon l'environnement (CI vs pré-prod).
    // La correction de ces données est couverte par les tests API de GAP-2.
    await expect(
      page.getByRole('heading', { level: 1, name: /état système/i }),
    ).toBeVisible({ timeout: 25_000 });
    await expect(
      page.getByText(/cockpit pré-production/i),
    ).toBeVisible({ timeout: 10_000 });

    // Aucun secret ne doit transparaître dans le DOM rendu.
    const body = await page.locator('body').innerText();
    expect(body).not.toMatch(/postgres(ql)?:\/\//i);
    expect(body).not.toMatch(/BEGIN [A-Z ]*PRIVATE KEY/);
    expect(body).not.toMatch(/password\s*[:=]\s*\S+/i);
    expect(body).not.toMatch(/redis:\/\//i);

    await context.close();
  });

  test('admin voit la page Alertes système (GAP-3)', async ({ browser }) => {
    const context = await loginWithCookieSession(browser, ADMIN_EMAIL, {
      tag: 'smoke-admin-alerts',
    });
    const page = await context.newPage();

    await page.goto('/admin/alerts');
    await expect(
      page.getByRole('heading', { level: 1, name: /alertes système/i }),
    ).toBeVisible({ timeout: 25_000 });

    await context.close();
  });

  test('admin peut se déconnecter', async ({ browser }) => {
    const context = await loginWithCookieSession(browser, ADMIN_EMAIL, {
      tag: 'smoke-admin-logout',
    });
    const page = await context.newPage();

    await page.goto('/admin/dashboard');
    await expect(
      page.getByRole('heading', { name: /administration/i }),
    ).toBeVisible({ timeout: 25_000 });

    await page.getByRole('button', { name: /déconnexion/i }).click();
    // Le logout admin renvoie hors de /admin (router.push('/')).
    await page.waitForURL((url) => !url.pathname.startsWith('/admin'), {
      timeout: 10_000,
    });

    await context.close();
  });

  test('un pro ne peut pas atteindre le cockpit admin', async ({ browser }) => {
    const context = await loginWithCookieSession(browser, PRO_EMAIL, {
      password: PRO_PASSWORD,
      tag: 'smoke-pro-admin-gate',
    });
    const page = await context.newPage();

    await page.goto('/admin/health');
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });

    await context.close();
  });
});
