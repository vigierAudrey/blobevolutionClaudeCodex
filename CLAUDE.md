# CLAUDE.md — Blob (BlobConnect / Blobinfini interne)

Guide court chargé automatiquement par Claude Code. Détail complet : `claude.md`. Gouvernance/arbitrage : `ai/README.md` + `ai/policies/*` (priment en cas de conflit documentaire).

## Naming (source de vérité : `ROADMAP.md`)
- **Blob** = nom produit visible (UI, emails, wording marketing, pages publiques).
- **BlobConnect** / **Blobinfini** = legacy technique (packages, namespaces, historique) — ne jamais utiliser en wording visible utilisateur.

## Contexte
Plateforme communautaire de mise en relation pour sports de glisse (surf/kitesurf), association loi 1901. **Mise en relation locale uniquement** — l'organisation du cours se fait hors plateforme, sans réservation ni paiement orchestrés.

## Règles P0 non négociables
- **Scope MVP** : pas de réservation orchestrée, calendrier transactionnel partagé, paiement intégré/Stripe, commission/escrow, workflow booking complet (request→confirm→cancel→complete). Toute demande dans ce sens est hors scope : le signaler explicitement et demander validation produit avant d'implémenter (détail : `claude.md` § anti-réintroduction scope produit, `docs/product-positioning.md`).
- **Prisma** : `prisma db push --accept-data-loss` autorisé **uniquement** en local ou CI de test — **jamais** en production ni CI prod, jamais sans garde-fou explicite.
- **Sécurité** : validation Zod stricte sur tous les inputs API, contrôle d'accès **server-side** (jamais "front only"), rate limiting sur routes sensibles, jamais de secret/PII en clair (code, logs, tests, fixtures), logs via le logger sécurisé existant (jamais `console.*` en production).
- **TypeScript** : `any` interdit → `unknown` + type guards (exception cadrée uniquement, voir `claude.md`).
- **Portée** : pas de refactor massif non demandé ; changements minimaux liés au besoin exprimé.
- **Preuves ou silence** : toute affirmation sur l'état actuel du code/de l'infra doit citer un fichier lu ou une commande exécutée ; sinon la marquer INCONNU et demander vérification humaine.

## Stack & commandes clés
- Monorepo : `apps/api` (Express + Prisma + PostgreSQL/PostGIS + Redis), `apps/web` (Next.js + Tailwind/Shadcn), `packages/database`.
- `npm run dev:all` · `npm run test` · `npm run type-check` · `npm run lint` · `npm run test:e2e` · `npm run openapi:lint`
- Avant toute PR touchant un module critique (auth, matching, booking/mise en relation, blobosphère, ads) : exécuter `test` + `type-check` + `build` et citer explicitement les commandes lancées.

## Où trouver le détail
- `claude.md` — guide complet (architecture, DoD sécurité, patterns de code, RGPD, règles UI).
- `AGENTS.md` — workflow agents (Codex/Claude Code), personas, checklist PR.
- `ai/README.md` + `ai/policies/*` — gouvernance opposable ; priment en cas de conflit avec tout autre document.
- `ROADMAP.md` — priorités business à jour, à consulter avant de démarrer un chantier.
