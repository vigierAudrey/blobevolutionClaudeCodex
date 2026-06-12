# Blob — Project Brief (MVP 2026)

> Ce document remplace `project_brief.legacy.md` (archivé — contenu obsolète : Stripe, gamification,
> marketplace transactionnelle).
> Il est la référence de contexte projet pour les IA (Claude Code, Codex, etc.).

## Marque et domaine

- **Nom produit visible** : Blob
- **Domaine public** : blobsurf.com
- **Namespace technique legacy** : Blobinfini / BlobConnect — conserver uniquement dans le code
  existant, ne pas réintroduire dans les textes produit ou UI
- **Domaines terminés** : les anciens domaines `blobinfini.*` (.com/.fr) n'existent plus — ne
  jamais les utiliser (code, docs, exemples, emails). Canonique : `blobsurf.com`,
  `api.blobsurf.com`, `storage.blobsurf.com`, emails `support@` / `security@` / `dpo@blobsurf.com`

## Stratégie produit — Territoire pilote

Le lancement pilote cible le territoire **Médoc Atlantique** :

- **Communes** : Hourtin, Carcans, Lacanau
- **Bassin d'acquisition principal** : Bordeaux Métropole

Ce choix est une décision de stratégie produit (concentration des ressources, validation locale
avant extension), non une limitation technique du système. La plateforme est techniquement capable
de fonctionner sur n'importe quel territoire géolocalisé. L'extension au-delà du Médoc sera
décidée après validation du pilot.

## Positionnement

**Blob est d'abord une communauté surf & kite locale.**

Les fonctionnalités — matching, pros, BlobMap, guides, promotions — sont au service de cette
communauté, et non l'inverse.

Blob n'est pas :
- une marketplace nationale
- une plateforme avec paiement intégré
- une plateforme gamifiée

## Structure

Projet associatif (forme juridique définitive à confirmer).

## Vision

Connecter les riders et les pros de surf/kitesurf du Médoc Atlantique.
Permettre la mise en relation locale : un rider publie une demande de cours géolocalisée,
un pro dans son périmètre la voit et prend contact via la messagerie.
Amplifier la visibilité de la communauté locale via la Blobosphère (contenus éditoriaux surf/kite).

## MVP — Fonctionnalités actives

- Auth complet : inscription, connexion, reset password, RGPD, 2FA obligatoire pour pros
- Profils riders et pros (public + privé)
- Matching géolocalisé (surf/kitesurf) — déployé en priorité sur le territoire pilote
- Publication de demandes de cours géolocalisées
- BlobMap : outil de visualisation des demandes locales, actuellement orienté usage pro ;
  l'ouverture à d'autres usages (communauté, riders) sera décidée après le pilot
- Messagerie intégrée (sans workflow de réservation)
- Blobosphère : hub éditorial (articles, guides, contenus surf/kite locaux)

## Hors scope MVP — Ne pas implémenter

- Paiement intégré / Stripe actif
- Réservation orchestrée / workflow booking
- Gamification (points, badges, niveaux)
- Calendrier transactionnel partagé rider/pro
- Déploiement national (décision post-pilot)

## Stack technique active

- **Front** : Next.js 14+ (App Router), TypeScript strict, Tailwind CSS, shadcn/ui, PWA
- **API** : Node.js + Express modulaire, Prisma ORM
- **DB** : PostgreSQL + PostGIS, Redis (cache + pub/sub)
- **Temps réel** : Socket.io (messagerie uniquement, page-scoped)
- **Email** : Brevo SMTP (prod/VPS), Mailpit (local/dev uniquement)
- **Infra** : Hetzner VPS, Docker Compose, Caddy, GitHub Actions CI/CD

## Contraintes permanentes

- Sécurité : Zod sur tous les inputs API, Prisma exclusif (pas de SQL raw), rate limiting,
  CSRF, headers sécurité
- Auth : cookies HttpOnly, 2FA obligatoire pros, aucun token stocké côté front
- RGPD : consentement explicite géolocalisation, export données, droit à l'oubli, hébergement UE
- Qualité : TypeScript strict, tests ≥ 80 %, CI verte avant deploy VPS

## Sources de vérité (par ordre de priorité)

1. `docs/product-positioning.md` — périmètre fonctionnel MVP
2. `README.md` — architecture, stack, naming, fonctionnalités
3. `ROADMAP.md` — priorisation et chantiers actifs
4. `ai/context/decisions.md` — journal de décisions techniques (ADRs)
