# Architecture Dashboard Polling Multi-Onglets

**Version**: 1.0
**Date**: 2026-02-01
**Status**: Production-ready

---

## Résumé (10 lignes)

Système de polling HTTP pour le dashboard utilisateur avec leader election entre onglets pour réduire la charge serveur.

**Règle d'or**:
- Onglet **visible** → 1 seul leader poll toutes les 60s pour tous les onglets
- Onglet **hidden** → stop immédiat, pas de polling en arrière-plan
- Transition `hidden → visible` → refresh immédiat puis reprise polling 60s

**Garanties**:
- Au plus 1 leader actif à tout instant (convergence < 2s)
- Timeout réseau réel (AbortController, pas de setState après unmount)
- Auto-réparation si localStorage corrompu
- Pas de logs sensibles en production

**Ce que ça ne fait PAS**: Temps réel. Pour notifs < 1s, utiliser WebSocket (`lib/socket.ts`).

---

## Concepts

### Leader
L'onglet navigateur qui a le droit de faire des requêtes API pour tous les onglets ouverts.

### Lease
Ticket temporaire stocké dans `localStorage` indiquant quel onglet est leader et jusqu'à quand.

**Structure**:
```typescript
{
  tabId: string;      // UUID stable (sessionStorage)
  nonce: string;      // UUID runtime (détecte duplicate tab)
  expiresAt: number;  // Timestamp Date.now() + 3000ms
}
```

**Clé localStorage**: `blobconnect:dashboard:polling:leader-lease`

**TTL**: 3s (renouvelé toutes les 1.5s par le leader actif)

---

## Invariants (MERGE BLOCKERS)

### I1. Un seul leader effectif
À tout instant, au plus 1 onglet poll l'API. Micro-fenêtre < 10ms possible au startup (acceptable).

**Preuve**: Test Playwright `dashboard-polling-convergence.spec.ts:18` vérifie convergence < 2s avec 3 onglets.

### I2. Auto-réparation localStorage
Si `JSON.parse(lease)` fail ou structure invalide → `removeItem(LEASE_KEY)` → nouveau lease créé.

**Trace**: `apps/web/app/dashboard/page.tsx:185-195`, `228-250`

### I3. Détection duplicate tab
Si user clique "Dupliquer l'onglet" → sessionStorage cloné → `instanceNonce` différent → nouveau `tabId` généré.

**Trace**: `apps/web/app/dashboard/page.tsx:115-161`

### I4. AbortController timeout réseau réel
Timeout 10s déclenche `abortController.abort()` → fetch() throw AbortError → JAMAIS de `setState()` après abort/unmount.

**Preuve**: Test Playwright `dashboard-polling-convergence.spec.ts:153` vérifie `unreadTotalLastSetAt` pas modifié après timeout.

**Trace**: `apps/web/app/dashboard/page.tsx:294-344`

### I5. Pas de logs sensibles en prod
Instrumentation `window.__dashboardPollingDebug` uniquement si `NODE_ENV !== 'production'`.

**Trace**: `apps/web/app/dashboard/page.tsx:167`, `302`, `327`

---

## Détails Techniques

### Clés localStorage/sessionStorage

| Clé | Scope | Type | Contenu |
|-----|-------|------|---------|
| `blobconnect:dashboard:polling:leader-lease` | localStorage | `{ tabId, nonce, expiresAt }` | Lease leader actuel |
| `blobconnect:dashboard:polling:tab-id` | sessionStorage | `string` | UUID stable de l'onglet |

### TTL et logique lease

**Acquisition lease** (`tryAcquireLease()`):

1. Lire `localStorage.getItem(LEASE_KEY)`
2. Si absent → créer lease avec `expiresAt = Date.now() + 3000`
3. Si présent mais invalide (validation stricte) → `removeItem()` + créer nouveau
4. Si présent mais expiré (`Date.now() > expiresAt`) → créer nouveau
5. Si présent et `tabId === myTabId && nonce === instanceNonce` → renouveler (`expiresAt = now + 3000`)
6. Si présent et autre tab → return false (pas leader)
7. **Après chaque `setItem()`** → re-read et vérifier `tabId + nonce` correspond (réduit race < 10ms)

**Validation stricte** (ligne 185-195):
```typescript
if (
  !lease ||
  typeof lease !== 'object' ||
  typeof lease.tabId !== 'string' ||
  typeof lease.expiresAt !== 'number' ||
  !Number.isFinite(lease.expiresAt)
) {
  localStorage.removeItem(LEASE_KEY);
  return false;
}
```

**Re-read verification** (ligne 216-223):
```typescript
localStorage.setItem(LEASE_KEY, JSON.stringify(newLease));

// Vérifier qu'on a gagné la race
const verifyRaw = localStorage.getItem(LEASE_KEY);
const verify = JSON.parse(verifyRaw);
return verify.tabId === myTabId && verify.nonce === instanceNonce;
```

### AbortController

**Création** (ligne 295-299):
```typescript
if (currentAbortController) {
  currentAbortController.abort(); // Annuler précédente si en vol
}
currentAbortController = new AbortController();
const signal = currentAbortController.signal;
```

**Timeout** (ligne 312-316):
```typescript
const timeoutId = setTimeout(() => {
  if (currentAbortController && !signal.aborted) {
    currentAbortController.abort(); // VRAIE annulation HTTP
  }
}, 10000);
```

**Fetch avec signal** (ligne 318):
```typescript
const data = await apiClient.listConversations(undefined, signal);
```

**Check abort avant setState** (ligne 322):
```typescript
if (!active || signal.aborted) return; // Skip setState si aborted
```

**Cleanup** (ligne 373-377):
```typescript
const stopPolling = () => {
  clearInterval(intervalId);
  if (currentAbortController) {
    currentAbortController.abort();
    currentAbortController = null;
  }
};
```

### Visibilité

**Démarrage polling** (ligne 347-366):
```typescript
const startPolling = () => {
  if (document.visibilityState !== 'visible') return; // Check visibilité

  if (!tryAcquireLease()) return; // Pas leader → skip

  void loadUnread(); // Refresh immédiat

  intervalId = setInterval(() => {
    if (!tryAcquireLease()) {
      stopPolling(); // Lease perdu → stop
      return;
    }
    void loadUnread();
  }, 60000);
};
```

**Event listener** (ligne 380-387):
```typescript
const handleVisibilityChange = () => {
  if (document.visibilityState === 'visible') {
    startPolling(); // Refresh immédiat + reprise polling
  } else {
    stopPolling(); // Stop net
  }
};

document.addEventListener('visibilitychange', handleVisibilityChange);
```

**Convergence rapide** (ligne 389-401):
```typescript
// Checks toutes les 500ms pendant 3s au startup
const startTime = Date.now();
initialLeadershipCheckIntervalId = setInterval(() => {
  if (Date.now() - startTime > 3000) {
    clearInterval(initialLeadershipCheckIntervalId);
    return;
  }
  if (!amILeader()) {
    stopPolling(); // Perte lease → stop immédiat
  }
}, 500);
```

---

## Tests & Commandes

### Tests Playwright

**Fichier**: `apps/web/tests/e2e/dashboard-polling-convergence.spec.ts`

**Test 1**: Convergence < 2s avec 3 onglets
- Ouvre 3 tabs simultanément
- Vérifie via `window.__dashboardPollingDebug.fetchCount` qu'exactement 1 tab poll après 2s
- Vérifie stabilité (leader continue, non-leaders arrêtés)

**Test 2**: Abort timeout + preuve setState skip
- Mock API avec délai 15s (> timeout 10s)
- Vérifie que `unreadTotalLastSetAt` pas modifié après timeout (setState skip)
- Vérifie que 2ème requête pas lancée

**Instrumentation dev-only** (`window.__dashboardPollingDebug`):
```typescript
{
  tabId: string;                // UUID de l'onglet
  nonce: string;                // Nonce runtime
  fetchCount: number;           // Nombre de fetch() appelés
  lastFetchTime: number | null; // Timestamp dernier fetch
  unreadTotalLastSetAt: number | null; // Timestamp dernier setUnreadTotal()
}
```

### Commandes

**Tests e2e polling**:
```bash
npm run test:e2e -- dashboard-polling-convergence.spec.ts
```

**Tests unit**:
```bash
npm test
```

**Build (vérifier TypeScript)**:
```bash
npm run build
```

**Lint clés storage** (manuel):
```bash
# Vérifier pas de clés non-namespacées
rg "localStorage\.(setItem|getItem|removeItem)\(['\"](?!blobconnect:)" \
  apps/web/app apps/web/lib apps/web/hooks \
  --glob '!**/__tests__/**' --glob '!**/lib/storage.ts'
# Attendu: aucun match
```

**Lint instrumentation prod** (manuel):
```bash
# Vérifier __dashboardPollingDebug uniquement avec guard dev
rg "window\.__dashboard" apps/web/app apps/web/lib \
  --glob '!**/__tests__/**' --glob '!**/*.spec.ts'
# Attendu: seulement dashboard/page.tsx avec NODE_ENV check
```

---

## DO / DON'T

### ✅ DO

- **DO** vérifier `document.visibilityState === 'visible'` avant tout polling
- **DO** utiliser AbortController pour timeouts réseau
- **DO** valider structure JSON après `JSON.parse()` pour données critiques (lease)
- **DO** nommer clés storage format `blobconnect:feature:subfeature:key`
- **DO** utiliser `expect.poll()` dans tests Playwright (pas `waitForTimeout`)
- **DO** guard instrumentation avec `NODE_ENV !== 'production'`
- **DO** re-read après `localStorage.setItem()` pour vérifier race

### ❌ DON'T

- **DON'T** polling en background (`visibilityState === 'hidden'`) sans décision produit documentée
- **DON'T** timeout simulé sans abort réseau réel (flag local insuffisant)
- **DON'T** `JSON.parse()` sans validation stricte (risque corruption localStorage)
- **DON'T** clés storage génériques (`'leader-lease'`, `'tab-id'`) → collision
- **DON'T** `waitForTimeout()` fixes dans tests e2e → flaky en CI
- **DON'T** logs sensibles en prod (objets error, PII)
- **DON'T** cast `as { ... }` après `JSON.parse()` sans runtime checks

---

## Anti-Regression Checklist (PR Review)

Avant merge, vérifier:

- [ ] ✅ `document.visibilityState` check présent avant polling (`page.tsx:348`)
- [ ] ✅ `AbortController` utilisé + signal passé à fetch (`page.tsx:294-318`)
- [ ] ✅ Validation stricte lease (`typeof`, `isFinite`) (`page.tsx:185-195`)
- [ ] ✅ Clés storage namespacées `blobconnect:*` (`page.tsx:110-111`)
- [ ] ✅ Tests utilisent `expect.poll()` pas `waitForTimeout()` (`spec.ts:57-75`)
- [ ] ✅ Instrumentation guard `NODE_ENV !== 'production'` (`page.tsx:167`)
- [ ] ✅ Re-read verification après `setItem()` (`page.tsx:216-223`)
- [ ] ✅ Tests passent: `npm test && npm run test:e2e`
- [ ] ✅ Build OK: `npm run build`

**Si 1 item fail → REJECT PR.**

---

## Risques Résiduels (P2 - Acceptés)

### R1. Throttling background tabs
**Impact**: Si tous onglets hidden → polling stop complètement.
**Justification**: User pas sur l'app → pas besoin données temps réel. Économie serveur + batterie.
**Alternative**: Push notifications (WebSocket, FCM).

### R2. NTP drift
**Impact**: Horloge système change → `expiresAt` invalide.
**Justification**: NTP ajustements graduels (rare). Convergence via checks 500ms corrige anomalies.

### R3. localStorage quota
**Impact**: Storage plein → `setItem()` throw `QuotaExceededError` → onglet perd lease.
**Justification**: App non-fonctionnelle sans storage (tokens). Safe wrappers (`lib/storage.ts`) catch errors.

### R4. Race double leader < 10ms
**Impact**: 2 onglets poll simultanément pendant < 10ms au startup.
**Justification**: Fenêtre courte grâce re-read verification. Convergence < 2s garantie.

---

## Comment Étendre

### Mode économie extrême (polling 5min)

**Besoin**: Réduire davantage charge serveur (60s → 5min).

**Comment**:
1. Modifier `pollIntervalMs` (ligne 107):
   ```typescript
   const pollIntervalMs = Number(process.env.NEXT_PUBLIC_UNREAD_POLL_MS ?? '300000') || 300000;
   ```
2. Ajuster `LEASE_TTL_MS` (ligne 112):
   ```typescript
   const LEASE_TTL_MS = 10000; // 10s (> 5min non nécessaire)
   ```
3. Tests: ajuster timeout convergence (spec.ts:96):
   ```typescript
   { timeout: 10000, intervals: [100, 250, 500, 1000] }
   ```

**⚠️ Ne PAS**:
- Retirer checks visibilité
- Retirer validation lease
- Retirer AbortController

### Temps réel (< 1s)

**Besoin**: Notifications instantanées.

**Comment**: Utiliser WebSocket existant (`apps/web/lib/socket.ts`).

**Exemple**:
```typescript
// Dans dashboard/page.tsx
import { socket } from '../../lib/socket';

useEffect(() => {
  socket.on('unread:update', (count: number) => {
    setUnreadTotal(count);
  });

  return () => {
    socket.off('unread:update');
  };
}, []);
```

**⚠️ Ne PAS**:
- Polling < 10s (abuse serveur)
- Polling sans visibilité check
- Mélanger WebSocket + polling sans coordination

### Multi-feature polling

**Besoin**: Plusieurs features utilisent même pattern (bookings, notifications).

**Comment**:
1. Créer hook réutilisable `hooks/useLeaderPolling.ts`:
   ```typescript
   export const useLeaderPolling = (
     fetchFn: (signal: AbortSignal) => Promise<void>,
     intervalMs: number,
     featureKey: string // Ex: 'bookings', 'notifications'
   ) => {
     // Copier logique dashboard/page.tsx
     // Utiliser clés namespacées: `blobconnect:${featureKey}:polling:leader-lease`
   };
   ```
2. Utiliser dans features:
   ```typescript
   useLeaderPolling(loadBookings, 120000, 'bookings');
   ```

**⚠️ Ne PAS**:
- Réutiliser même lease entre features (collision)
- Skip validation JSON
- Skip AbortController

---

## Fichiers Modifiés

| Fichier | Lignes | Description |
|---------|--------|-------------|
| `apps/web/app/dashboard/page.tsx` | 103-422 | Leader lease + polling + abort |
| `apps/web/lib/apiClient.ts` | 1022-1028 | Support AbortSignal |
| `apps/web/lib/storage.ts` | 1-130 | Safe wrappers localStorage/sessionStorage |
| `apps/web/tests/e2e/dashboard-polling-convergence.spec.ts` | 1-215 | Tests convergence + abort |
| `apps/web/hooks/__tests__/useConsent.bug-hash.test.ts` | 1-41 | Tests safe storage |

---

## Liens Documentation

- **Audit trail**: `docs/SECURITY_GATE_FINAL_PATCHES.md`
- **Détails complets**: `docs/POLLING_MULTITABS.md`
- **Review checklist**: `docs/POLLING_MULTITABS_REVIEW.md`
- **Sécurité CSP**: `docs/CSP_STAGING_VALIDATION.md`

---

**Auteur**: Security Gate Final
**Version**: 1.0
**Dernière MAJ**: 2026-02-01
