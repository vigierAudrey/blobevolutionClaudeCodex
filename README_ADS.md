## Publicités & Consentement – Blobinfini

### Objectif
Industrialiser la diffusion des publicités (AdSense) en mode multi-consentement (personalized, NPA, limited, house) tout en respectant les exigences RGPD/CNIL et l’architecture existante (Next.js 14 + Express/Prisma).

---

### Architecture des consentements

#### Base de données (Prisma)
```
model UserConsent {
  id                 String         @id @default(uuid())
  userHash           String         @unique        // hash SHA-256 pseudonymisé
  consentLevel       ConsentLevel   // personalized | npa | limited | none
  ad_storage         ConsentSignal  // granted | denied
  ad_user_data       ConsentSignal
  ad_personalization ConsentSignal
  cmpVersion         String?
  createdAt          DateTime       @default(now())
  updatedAt          DateTime       @updatedAt
}
```
- TTL purgé automatiquement à 13 mois (`purgeOldConsents`).
- Aucune PII stockée (hash = SHA-256 sur deviceId + UA).

#### Service backend
- `apps/api/src/services/consent.service.ts`
  - `getConsent(hash)` → récupère et purge les enregistrements obsolètes.
  - `createOrUpdateConsent(payload)` → upsert idempotent.
  - `purgeOldConsents()` → suppression batch (appelé automatiquement).
- API Express : `GET /consent/:hash`, `POST /consent/:hash`
  - Réponses JSON `{ consent: ConsentRecord | null }`.
  - Pas d’authentification requise (hash anonymisé).

---

### Frontend – pipeline consentement

#### Hook `useConsent`
Chemin `apps/web/hooks/useConsent.ts`
1. Génère un `deviceId` (localStorage) puis un hash SHA-256 (`deviceId:userAgent`).
2. Sources de consentement (ordre):
   - CMP TCF v2 (`window.__tcfapi('getTCData')`) → conversion vers signaux.
   - Cache local (`blob_consent`).
   - API back (`/consent/:hash`).
   - Par défaut → mode `none` (house ads).
3. Met à jour `gtag('consent','update', …)` dès qu’un choix est connu.
4. Fournit `updateConsent(mode)` pour enregistrer un nouveau choix (local + API).
5. Synchronise le legacy `localStorage['cookie-consent']` pour rétrocompatibilité.

#### Bannière (`CookieConsent.tsx`)
- Options :
  - **Publicités personnalisées** → `personalized`.
  - **Publicités basiques** → `npa` (NPA: ad_storage granted, data/personalization denied).
  - **Publicités limitées** → `limited` (aucun stockage publicitaire).
  - **Refus toutes publicités** → `none` (house ads internes).
- Bouton flottant “Gérer les cookies” pour rouvrir la bannière.

#### Chargement AdSense
- Script utilitaire `apps/web/lib/ads/loadAdSense.ts` (lazy, unique).
- `AdBanner.tsx` :
  - Utilise `useConsent` pour connaître le mode courant.
  - `loadAdSense()` + `adsbygoogle.push({})` seulement si mode ≠ `none`.
  - Trace GA4 `ad_impression` `{ ad_mode, ad_slot, page_location }`.
  - Modes :
    - **personalized** → `data-npa="0"`.
    - **npa** → `data-npa="1"` + `ad_storage granted`.
    - **limited** → `data-npa="1"` + `ad_storage denied` (Limited Ads).
    - **none** ou absence de consentement → House ads (contenu interne, offline-safe).

---

### Intégration CMP
- Compatible avec une CMP TCF v2 (ex: Klaro, TarteAuCitron, CookieConsent) via `window.__tcfapi`.
- Si aucune CMP tierce → module interne Blobinfini utilise table `user_consent`.
- `cmpVersion` enregistré (ex: `blobinfini-consent-v1` ou `tcf-xxxx`).

### Environnements d'exécution

| Contexte | Web | API | Remarques |
|----------|-----|-----|-----------|
| Dev | 3002 | 4000 | Serveurs Next.js / Express de développement |
| E2E | 3020 (auto) | 4020 (auto) | Playwright démarre ses propres serveurs isolés (ports auto-ajustés si occupés) |
| Prod | dépend hébergeur | dépend hébergeur | Configurée via variables d’environnement (`NEXT_PUBLIC_ADSENSE_CLIENT`, `GA4_ID`, …) |

Les tests E2E (`npm run test:e2e`) valident la conformité RGPD (modes consentement, absence de cookies sans opt-in) dans un environnement isolé.

---

### Checklist Tests & Conformité
1. **Migrations / Prisma**
   - `prisma migrate dev` (ou `db:migrate` en CI) → table `UserConsent`.
2. **API Consent**
   - `GET /consent/:hash` renvoie `{ consent: null }` si inconnu.
   - `POST /consent/:hash` upsert sans doublon.
   - Vérifier purge TTL > 13 mois (peut être déclenché via service).
3. **Front**
   - Navigation sans consentement → house ads visibles, aucun script Google chargé.
   - Acceptation “basiques” → `data-npa="1"`, AdSense chargé, `gtag` mis à jour.
   - Acceptation “personnalisées” → `data-npa="0"`.
   - Choix “publicités limitées” → AdSense limité, `ad_storage` = denied.
   - Refus total → House ads uniquement, `loadAdSense` non appelé.
4. **GA4 / Consent Mode**
   - Observer `gtag('consent','update', …)` dans la console dev.
   - Vérifier événements `ad_impression` avec `ad_mode`.
5. **CMP TCF (si branchée)**
   - `__tcfapi` accessible → le hook doit récupérer le TC String.
   - Vérifier cohérence signaux `purpose.consents`.
6. **Qualité**
   - `npm run lint` & `npm test --workspaces` (web + api).
   - Tests Playwright ciblés (`ads-consent.spec.ts`, `admin-access.spec.ts`) pour valider le rendu conditionnel.

---

### Points de vigilance RGPD/CNIL
- Aucune cookie publicitaire avant consentement (`loadAdSense` + `adsbygoogle.push` uniquement après choix).
- Hash pseudonymisé (SHA-256) sans email/IP brute.
- TTL 13 mois sur les consentements (conformité directive ePrivacy).
- Possibilité de rattacher ultérieurement la BI (Metabase) via exports anonymisés.

### 🔒 Conformité RGPD vérifiée
- Tests unitaires `consent.service.test.ts` garantissant création, update idempotent et purge à 13 mois.
- Tests E2E Playwright (`ads-consent.spec.ts`) couvrant les 4 modes et absence de cookies lors d’un refus.
- Rapport `docs/validation/consent_audit_report.md` : preuves des signaux `gtag`, absence de PII et suivi GA4.
- House Ads affichées en refus total pour maintenir la monétisation sans traceur.

---

### Roadmap d’évolution
- [ ] Intégrer une CMP open-source (Klaro/TarteAuCitron) pour la génération automatique du TC String.
- [ ] Ajouter un backoffice analytics “Ads” consolidant impressions / modes utilisés.
- [ ] Connecter Metabase pour suivre la répartition des consentements (personalized vs NPA vs limited vs none).
