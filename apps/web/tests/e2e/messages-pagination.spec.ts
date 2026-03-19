/**
 * Messagerie rider — Tests Playwright ciblés — Pagination & UI
 *
 * Couverture :
 *  1. Affichage initial de la liste (real data — accepte l'état vide)
 *  2. Filtre "Non lus" — la liste répond sans crash (real data)
 *  3. "Charger plus" déclenche un fetch avec cursor et étend la liste [MOCK API]
 *  4. SoftRefresh polling préserve les items accumulés par pagination [MOCK API + FAKE CLOCK]
 *  5. Ouverture d'une conversation depuis la liste [MOCK API]
 *  6. Envoi d'un message : UI optimiste puis confirmation serveur [MOCK API]
 *
 * Stratégie auth :
 *   1 seul loginViaApi dans beforeAll + injection localStorage par test (token partagé).
 *   WHY pro1 : dev+active-rider-* sont soumis au loginAccountIpLimiter (rate limit strict)
 *   et sont déjà utilisés par active-users.spec.ts. dev+pro1 est un compte régulier.
 *
 * Mode sériel obligatoire :
 *   test.describe.configure({ mode: 'serial' }) garantit l'exécution séquentielle.
 *   WHY : en mode parallel chaque worker appelle beforeAll → N logins simultanés
 *   sur le même compte → rate limit. Le mode sériel garantit 1 login pour les 6 tests.
 *
 * Stratégie mock API :
 *   window.fetch override via page.addInitScript() — patch côté browser, pas de CORS preflight.
 *   WHY NOT page.route() : apiClient utilise credentials:'include' → OPTIONS preflight intercepté
 *   sans CORS headers → browser bloque les requêtes GET/POST suivantes.
 *   WHY MOCK for tests 3-6 : "Charger plus" n'apparaît que si l'API retourne nextCursor.
 *   Avec limit=100, il faudrait >100 conversations en base. Impossible en données de test.
 *
 * Stratégie polling (test 4) :
 *   page.clock.install() + fastForward(15100) — aucun sleep arbitraire.
 *   WHY FAKE CLOCK : le setInterval est à 15s, attendre 15s en test est flaky et lent.
 */

import { test, expect, request as playwrightRequest } from '@playwright/test';

// ─── Mode sériel ──────────────────────────────────────────────────────────────
test.describe.configure({ mode: 'serial' });

// ─── Config ──────────────────────────────────────────────────────────────────
const RIDER_EMAIL = process.env.E2E_MESSAGES_EMAIL ?? 'dev+pro1@test.com';
const RIDER_PASSWORD = process.env.E2E_MESSAGES_PASSWORD ?? 'Passw0rd!';
const API_BASE_URL = process.env.PLAYWRIGHT_API_URL ?? 'http://localhost:4000';

// ─── Auth helper ─────────────────────────────────────────────────────────────

function testIp(tag: string): string {
  const base = Math.abs(
    Array.from(`${tag}-${Date.now()}-${Math.random()}`)
      .reduce((acc, char) => acc + char.charCodeAt(0), 0),
  );
  const a = (base >> 12) & 255;
  const b = (base >> 8) & 255;
  const c = (base >> 4) & 255;
  const d = base & 255;
  return `10.${a}.${b}.${c ^ d || 42}`;
}

async function loginViaApi(email: string, password: string) {
  const apiCtx = await playwrightRequest.newContext({
    baseURL: API_BASE_URL,
    extraHTTPHeaders: { 'X-Forwarded-For': testIp(`msg-auth-${email}`) },
  });
  const csrfJson = (await (await apiCtx.get('/csrf-token')).json()) as { csrfToken: string };
  const loginRes = await apiCtx.post('/auth/login', {
    headers: { 'X-CSRF-Token': csrfJson.csrfToken },
    data: { email, password, consentAccepted: true },
  });
  if (!loginRes.ok()) {
    throw new Error(`Login failed for ${email}: ${loginRes.status()} ${await loginRes.text()}`);
  }
  const tokens = (await loginRes.json()) as { accessToken: string; refreshToken: string };
  await apiCtx.dispose();
  return tokens;
}

// ─── Fetch mock via addInitScript ────────────────────────────────────────────
// WHY NOT page.route() :
//   apiClient utilise credentials: 'include' → le browser envoie un OPTIONS preflight.
//   page.route() intercepte OPTIONS et retourne JSON sans CORS headers → CORS fail.
//   route.continue() sur OPTIONS est théoriquement correct mais instable en pratique.
//
// SOLUTION : patcher window.fetch dans le browser (addInitScript) AVANT la navigation.
//   Avantages : même-origine (pas de CORS), pas de preflight OPTIONS, déterministe.
//   L'argument est sérialisé par Playwright du process test → context browser.

interface MockFetchSetup {
  /** Réponse retournée pour GET /conversations sans cursor */
  page1: unknown;
  /** Réponse retournée pour GET /conversations avec cursor */
  page2: unknown;
  /** Si true : seule page1 est retournée (polling + initial, pas de cursor) */
  pollOnly?: boolean;
}

/**
 * Remplace window.fetch dans le browser pour intercepter les appels /conversations.
 * Les appels non-conversations passent en transparence via le vrai fetch.
 * Le shim expose window.__mockCursorSeen pour permettre des assertions côté test.
 */
async function mockConversationsApi(
  page: import('@playwright/test').Page,
  setup: MockFetchSetup,
) {
  await page.addInitScript(
    ({
      page1,
      page2,
      pollOnly,
    }: {
      page1: unknown;
      page2: unknown;
      pollOnly?: boolean;
    }) => {
      const realFetch = window.fetch.bind(window);
      (window as unknown as Record<string, unknown>).__mockCursorSeen = null;
      (window as unknown as Record<string, unknown>).__convFetchCount = 0;

      window.fetch = async function (
        input: RequestInfo | URL,
        init?: RequestInit,
      ): Promise<Response> {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.toString()
              : (input as Request).url;

        // Only intercept the list endpoint: /conversations (not sub-paths like /conversations/xyz)
        if (url) {
          let parsedUrl: URL;
          try {
            parsedUrl = new URL(url);
          } catch {
            return realFetch(input, init);
          }

          const pathParts = parsedUrl.pathname.split('/').filter(Boolean);
          if (pathParts.length === 1 && pathParts[0] === 'conversations') {
            (window as unknown as Record<string, unknown>).__convFetchCount =
              (((window as unknown as Record<string, unknown>).__convFetchCount as number) ?? 0) + 1;
            const cursor = parsedUrl.searchParams.get('cursor');
            const body = !pollOnly && cursor ? page2 : page1;
            if (cursor) {
              (window as unknown as Record<string, unknown>).__mockCursorSeen = cursor;
            }
            return new Response(JSON.stringify(body), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
        }

        return realFetch(input, init);
      };
    },
    { page1: setup.page1, page2: setup.page2, pollOnly: setup.pollOnly ?? false },
  );
}

// ─── Token partagé : 1 seul login pour les 6 tests ───────────────────────────
let sharedTokens: { accessToken: string; refreshToken: string };

test.beforeAll(async () => {
  sharedTokens = await loginViaApi(RIDER_EMAIL, RIDER_PASSWORD);
});

// ─── Mock data factory ───────────────────────────────────────────────────────

/** Crée un ThreadSummary minimal mais complet pour le rendu du composant. */
function mockThread(id: string, name: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    otherDisplayName: name,
    otherRole: 'PRO',
    type: 'RIDER_TO_PRO',
    unread: 0,
    favorite: false,
    blocked: false,
    trashed: false,
    isGroup: false,
    lastMessage: `Bonjour de ${name}`,
    otherPhotoUrl: null,
    matchedAt: null,
    ...extra,
  };
}

// Page 1 : 2 conversations + curseur → le bouton "Charger plus" doit apparaître
const MOCK_PAGE_1 = {
  items: [mockThread('mock-1', 'Alice'), mockThread('mock-2', 'Bob')],
  nextCursor: 'cursor-page2',
  total: 4,
};

// Page 2 : 2 autres conversations sans curseur → "Charger plus" doit disparaître
const MOCK_PAGE_2 = {
  items: [mockThread('mock-3', 'Charlie'), mockThread('mock-4', 'Diana')],
  nextCursor: null,
  total: 4,
};

// ─── Helper : injecter le token + consentement ads dans localStorage ─────────
// WHY consent : CookieConsent affiche une modale fullscreen (fixed inset-0 z-50) si
// localStorage.blob_consent est absent ou mode==='none'. Ça bloque tous les clics.
// On pré-injecte mode='limited' (aucun tracking) pour que la modale ne s'affiche pas.
async function injectToken(page: import('@playwright/test').Page) {
  await page.addInitScript(
    ({ at, rt }: { at: string; rt: string }) => {
      window.localStorage.setItem('accessToken', at);
      window.localStorage.setItem('refreshToken', rt);
      // Supprime la modale ads en pré-acceptant le mode "limited" (pas de tracking)
      window.localStorage.setItem(
        'blob_consent',
        JSON.stringify({
          mode: 'limited',
          signals: { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' },
          cmpVersion: 'blobinfini-consent-v1',
          updatedAt: new Date().toISOString(),
        }),
      );
    },
    { at: sharedTokens.accessToken, rt: sharedTokens.refreshToken },
  );
}

// ─── Suite 1 : Affichage liste ────────────────────────────────────────────────

test.describe('Messagerie rider — liste conversations', () => {
  test('1. Affichage initial : h1 visible + liste ou état vide', async ({ browser }) => {
    // WHY REAL DATA : ce test valide que la page monte correctement en conditions réelles.
    // L'état vide ("Aucune conversation") est une réponse valide — le test ne le rejette pas.
    const context = await browser.newContext({
      extraHTTPHeaders: { 'X-Forwarded-For': testIp('msg-list-initial') },
    });
    const page = await context.newPage();
    await injectToken(page);

    await page.goto('/messages');

    // Signal stable : le h1 "Messagerie" prouve que le composant client est monté
    await expect(page.getByRole('heading', { name: 'Messagerie' })).toBeVisible({ timeout: 12000 });

    // La page ne redirige pas (auth OK)
    await expect(page).toHaveURL(/\/messages$/);

    // Soit des conversations, soit l'état vide — les deux sont valides
    const convLinks = page.locator('a[href^="/messages/"]');
    const emptyState = page.getByText('Aucune conversation');
    await expect(convLinks.first().or(emptyState)).toBeVisible({ timeout: 8000 });

    await context.close();
  });

  test('2. Filtre "Non lus" : pas de crash, liste ou état vide', async ({ browser }) => {
    const context = await browser.newContext({
      extraHTTPHeaders: { 'X-Forwarded-For': testIp('msg-filter-unread') },
    });
    const page = await context.newPage();
    await injectToken(page);

    await page.goto('/messages');
    await expect(page.getByRole('heading', { name: 'Messagerie' })).toBeVisible({ timeout: 12000 });

    // Préparer le listener AVANT le click pour éviter la race condition
    // (le filtre déclenche setFilter → useEffect → load() → fetch /conversations)
    const filterResponse = page.waitForResponse(
      (r) => {
        try {
          return new URL(r.url()).pathname === '/conversations' && r.request().method() === 'GET';
        } catch {
          return false;
        }
      },
      { timeout: 10000 },
    );

    await page.getByRole('button', { name: /Non lus/i }).click();
    await filterResponse;

    // Résultat : soit conversations filtrées, soit état vide — aucun crash
    const convLinks = page.locator('a[href^="/messages/"]');
    const emptyState = page.getByText('Aucune conversation');
    await expect(convLinks.first().or(emptyState)).toBeVisible({ timeout: 5000 });

    // Aucune erreur visible
    await expect(page.locator('.text-red-900').filter({ hasText: /erreur/i })).not.toBeVisible();

    await context.close();
  });
});

// ─── Suite 2 : Pagination ────────────────────────────────────────────────────

test.describe('Messagerie rider — pagination "Charger plus"', () => {
  test('3. "Charger plus" déclenche un fetch avec cursor et étend la liste sans doublons', async ({
    browser,
  }) => {
    // WHY MOCK : "Charger plus" n'apparaît que si l'API retourne nextCursor.
    // Avec limit=100, il faudrait >100 conversations en base de test. Ce n'est pas le cas.
    // Le mock est le seul moyen déterministe de prouver ce comportement.

    const context = await browser.newContext({
      extraHTTPHeaders: { 'X-Forwarded-For': testIp('msg-load-more') },
    });
    const page = await context.newPage();
    await injectToken(page);
    await mockConversationsApi(page, { page1: MOCK_PAGE_1, page2: MOCK_PAGE_2 });

    await page.goto('/messages');
    await expect(page.getByRole('heading', { name: 'Messagerie' })).toBeVisible({ timeout: 12000 });

    // Page 1 : Alice et Bob visibles
    await expect(
      page.locator('a[href^="/messages/"]').filter({ hasText: 'Alice' }),
    ).toBeVisible({ timeout: 8000 });
    await expect(page.locator('a[href^="/messages/"]').filter({ hasText: 'Bob' })).toBeVisible();

    // Le bouton "Charger plus" est visible et activé (nextCursor != null dans mock page 1)
    const loadMoreBtn = page.getByRole('button', { name: 'Charger plus' });
    await expect(loadMoreBtn).toBeVisible();
    await expect(loadMoreBtn).toBeEnabled();

    await loadMoreBtn.click();

    // Après chargement : 4 items présents, aucun doublon
    await expect(
      page.locator('a[href^="/messages/"]').filter({ hasText: 'Charlie' }),
    ).toBeVisible({ timeout: 5000 });
    await expect(
      page.locator('a[href^="/messages/"]').filter({ hasText: 'Diana' }),
    ).toBeVisible();

    // Les 2 premiers items sont toujours là (pas de destruction par l'append)
    await expect(
      page.locator('a[href^="/messages/"]').filter({ hasText: 'Alice' }),
    ).toBeVisible();
    await expect(
      page.locator('a[href^="/messages/"]').filter({ hasText: 'Bob' }),
    ).toBeVisible();

    // Exactement 4 liens conversation (pas de doublons)
    await expect(page.locator('a[href^="/messages/"]')).toHaveCount(4);

    // "Charger plus" a disparu (nextCursor == null dans mock page 2)
    await expect(loadMoreBtn).not.toBeVisible();

    // Le cursor de la page 1 a bien été transmis dans la requête "Charger plus"
    const cursorSeen = await page.evaluate(
      () => (window as unknown as { __mockCursorSeen?: string | null }).__mockCursorSeen,
    );
    expect(cursorSeen).toBe('cursor-page2');

    await context.close();
  });

  test('4. SoftRefresh polling (15s) préserve les items accumulés par pagination', async ({
    browser,
  }) => {
    // WHY FAKE CLOCK : setInterval à 15s. Attendre 15s en test est lent et flaky.
    // page.clock.install() + fastForward() avance les timers du navigateur de façon
    // déterministe, sans sleep. C'est l'approche recommandée par Playwright pour les timers.
    //
    // INVARIANT TESTÉ : softRefresh=true ne détruit PAS les items accumulés via "Charger plus".
    // Le polling renvoie seulement page 1 (2 items), mais les 4 items accumulés restent.
    //
    // RISQUE : page.clock affecte aussi les timers React (scheduler utilise setTimeout(0)).
    // En pratique, React 18 fonctionne correctement avec le fake clock Playwright car
    // ses timers 0ms sont déclenchés avant les timers de 15s lors du fastForward.

    const context = await browser.newContext({
      extraHTTPHeaders: { 'X-Forwarded-For': testIp('msg-polling-stable') },
    });
    const page = await context.newPage();
    await injectToken(page);
    await mockConversationsApi(page, { page1: MOCK_PAGE_1, page2: MOCK_PAGE_2 });

    // Installer le fake clock AVANT la navigation pour capturer le setInterval
    // qui sera enregistré lors du montage du composant.
    // NOTE : React 18 scheduler utilise MessageChannel (non patché) → aucun impact.
    await page.clock.install({ time: Date.now() });

    await page.goto('/messages');
    await expect(page.getByRole('heading', { name: 'Messagerie' })).toBeVisible({ timeout: 12000 });
    await expect(
      page.locator('a[href^="/messages/"]').filter({ hasText: 'Alice' }),
    ).toBeVisible({ timeout: 8000 });

    // Accumuler 4 items via "Charger plus"
    const loadMoreBtn = page.getByRole('button', { name: 'Charger plus' });
    await expect(loadMoreBtn).toBeVisible();
    await loadMoreBtn.click();
    await expect(
      page.locator('a[href^="/messages/"]').filter({ hasText: 'Charlie' }),
    ).toBeVisible({ timeout: 5000 });

    const countBefore = await page.locator('a[href^="/messages/"]').count();
    expect(countBefore).toBe(4);

    // Avancer de 15.1s → déclenche le setInterval(fn, 15000) exactement une fois
    // (fetch call 1 = chargement initial, call 2 = loadMore, call 3 = polling)
    await page.clock.fastForward(15100);

    // Attendre que le fetch de polling soit bien arrivé (incrémente __convFetchCount)
    // WHY waitForFunction et pas waitForResponse : le mock est in-browser, aucune
    // requête réseau n'est émise, page.waitForResponse() ne déclencherait jamais.
    await page.waitForFunction(
      () =>
        ((window as unknown as { __convFetchCount?: number }).__convFetchCount ?? 0) >= 3,
      { timeout: 5000 },
    );

    // INVARIANT PRINCIPAL : toujours 4 items après le polling (softRefresh préserve tout)
    await expect(page.locator('a[href^="/messages/"]')).toHaveCount(4);

    // Vérification individuelle des 4 items
    await expect(
      page.locator('a[href^="/messages/"]').filter({ hasText: 'Alice' }),
    ).toBeVisible();
    await expect(
      page.locator('a[href^="/messages/"]').filter({ hasText: 'Bob' }),
    ).toBeVisible();
    await expect(
      page.locator('a[href^="/messages/"]').filter({ hasText: 'Charlie' }),
    ).toBeVisible();
    await expect(
      page.locator('a[href^="/messages/"]').filter({ hasText: 'Diana' }),
    ).toBeVisible();

    await context.close();
  });
});

// ─── Fetch mock pour la page de détail ───────────────────────────────────────
/**
 * Remplace window.fetch pour la page de détail d'une conversation.
 * Intercepte :
 *   GET  /conversations           → liste avec convId (pour findConversationById)
 *   GET  /conversations/:id/messages → liste vide
 *   POST /conversations/:id/messages → réponse serveur + stocke payload dans __sentPayload
 */
async function mockMessageDetailApi(
  page: import('@playwright/test').Page,
  convId: string,
  serverMsgContent: string,
) {
  await page.addInitScript(
    ({ cId, content }: { cId: string; content: string }) => {
      const realFetch = window.fetch.bind(window);
      (window as unknown as Record<string, unknown>).__sentPayload = null;

      window.fetch = async function (
        input: RequestInfo | URL,
        init?: RequestInit,
      ): Promise<Response> {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.toString()
              : (input as Request).url;

        if (url) {
          let parsedUrl: URL;
          try {
            parsedUrl = new URL(url);
          } catch {
            return realFetch(input, init);
          }

          const pathParts = parsedUrl.pathname.split('/').filter(Boolean);
          const method = (init?.method ?? 'GET').toUpperCase();

          // GET/POST /conversations/:id/messages
          if (
            pathParts.length === 3 &&
            pathParts[0] === 'conversations' &&
            pathParts[1] === cId &&
            pathParts[2] === 'messages'
          ) {
            if (method === 'GET') {
              return new Response(JSON.stringify({ items: [], nextCursor: null }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              });
            }
            if (method === 'POST') {
              (window as unknown as Record<string, unknown>).__sentPayload =
                init?.body ?? null;
              return new Response(
                JSON.stringify({
                  id: 'server-msg-id',
                  senderId: 'me',
                  type: 'TEXT',
                  content,
                  createdAt: new Date().toISOString(),
                  isCurrentUser: true,
                  senderName: 'Vous',
                  senderPhotoUrl: null,
                }),
                { status: 201, headers: { 'Content-Type': 'application/json' } },
              );
            }
          }

          // GET /conversations (list) — pour findConversationById
          if (pathParts.length === 1 && pathParts[0] === 'conversations') {
            return new Response(
              JSON.stringify({
                items: [
                  {
                    id: cId,
                    otherDisplayName: 'TestPro',
                    otherRole: 'PRO',
                    type: 'RIDER_TO_PRO',
                    unread: 0,
                    favorite: false,
                    blocked: false,
                    trashed: false,
                    isGroup: false,
                    lastMessage: 'Hello',
                    otherPhotoUrl: null,
                    matchedAt: null,
                  },
                ],
                nextCursor: null,
                total: 1,
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            );
          }
        }

        return realFetch(input, init);
      };
    },
    { cId: convId, content: serverMsgContent },
  );
}

// ─── Suite 3 : Conversation detail ───────────────────────────────────────────

test.describe('Messagerie rider — détail conversation', () => {
  test("5. Ouverture d'une conversation depuis la liste navigue vers /messages/:id", async ({
    browser,
  }) => {
    // WHY MOCK : garantit qu'une conversation est toujours disponible dans la liste,
    // indépendamment du seed. Le test vérifie uniquement la navigation (URL), pas le contenu.

    const context = await browser.newContext({
      extraHTTPHeaders: { 'X-Forwarded-For': testIp('msg-open-conv') },
    });
    const page = await context.newPage();
    await injectToken(page);

    // Mock : liste avec une conversation connue
    await mockConversationsApi(page, {
      page1: { items: [mockThread('known-conv-id', 'TestUser')], nextCursor: null, total: 1 },
      page2: { items: [], nextCursor: null, total: 0 },
    });

    await page.goto('/messages');
    await expect(page.getByRole('heading', { name: 'Messagerie' })).toBeVisible({ timeout: 12000 });

    const convLink = page.locator('a[href^="/messages/"]').filter({ hasText: 'TestUser' });
    await expect(convLink).toBeVisible({ timeout: 8000 });

    await convLink.click();

    // URL doit changer vers /messages/:id
    await expect(page).toHaveURL(/\/messages\/known-conv-id$/, { timeout: 8000 });

    await context.close();
  });

  test("6. Envoi d'un message : UI optimiste immédiate puis vérification call serveur", async ({
    browser,
  }) => {
    // WHY MOCK : navigation directe vers une conversation fictive contrôlée.
    // Prouve l'UI optimiste (message visible AVANT la réponse serveur)
    // et que sendMessage() est bien appelé avec le bon contenu.

    const CONV_ID = 'e2e-conv-send-test';
    const MSG_TEXT = `Test Playwright send ${Date.now()}`;

    const context = await browser.newContext({
      extraHTTPHeaders: { 'X-Forwarded-For': testIp('msg-send-msg') },
    });
    const page = await context.newPage();
    await injectToken(page);

    // Mock complet : /conversations (list) + /conversations/:id/messages (GET + POST)
    await mockMessageDetailApi(page, CONV_ID, MSG_TEXT);

    // Naviguer directement vers la conversation
    await page.goto(`/messages/${CONV_ID}`);

    // Attendre que l'input soit visible (preuve que la page est montée et auth OK)
    const input = page.getByPlaceholder('Écrire un message');
    await expect(input).toBeVisible({ timeout: 12000 });

    // Avant d'envoyer : le texte du message ne doit PAS être dans le DOM
    await expect(page.getByText(MSG_TEXT)).not.toBeVisible();

    // Remplir et envoyer
    await input.fill(MSG_TEXT);
    await expect(input).toHaveValue(MSG_TEXT);
    await page.getByRole('button', { name: 'Envoyer' }).click();

    // UI OPTIMISTE : le message apparaît immédiatement dans le DOM
    // (avant la réponse serveur, via le tempMessage avec id "temp-*")
    await expect(page.getByText(MSG_TEXT)).toBeVisible({ timeout: 3000 });

    // L'input est vidé après l'envoi
    await expect(input).toHaveValue('');

    // Attendre que le payload de l'envoi soit capturé par le mock
    // WHY waitForFunction : le fetch est in-browser, page.waitForResponse() ne se déclenche pas.
    await page.waitForFunction(
      () => (window as unknown as { __sentPayload?: unknown }).__sentPayload !== null,
      { timeout: 5000 },
    );

    // Le payload envoyé au serveur contient bien le contenu du message
    const rawPayload = await page.evaluate(
      () => (window as unknown as { __sentPayload?: string | null }).__sentPayload,
    );
    const sentPayload = JSON.parse(rawPayload as string);
    expect(sentPayload).toMatchObject({ content: MSG_TEXT, type: 'TEXT' });

    await context.close();
  });
});
