ADR – Journal de décisions

ADR‑001 – Auth intégré vs service dédié
- Contexte: Besoin d’aller vite pour le MVP avec peu de complexité infra.
- Décision: Auth intégré en module dans l’API.
- Alternatives: Microservice séparé (plus tard en Scale).
- Conséquences: Simplicité dev, moins d’overhead; couplage plus fort temporaire.

ADR‑002 – Prisma + PostgreSQL (+ PostGIS)
- Décision: Prisma pour productivité/typage; PostgreSQL pour fiabilité; PostGIS pour matching géospatial futur.

ADR‑003 – JWT + Refresh tokens
- Décision: Access 15m, Refresh 30j; invalidation via DB/Redis; rate limit strict login.

ADR‑004 – Validation Zod
- Décision: Validation explicite de tous inputs API, schemas partagés si utile.

ADR‑005 – Rendu App Router (SSR/ISR)
- Contexte: Multiples pages App Router avec dépendances à des hooks client (auth, matching) provoquaient des erreurs de prerender export et un rendu incohérent, tandis que les pages marketing restaient statiques.
- Décision: Forcer le SSR ciblé (`export const dynamic = 'force-dynamic'`) sur les segments dynamiques `(auth)` et métiers, tout en appliquant l’ISR 5 minutes (`export const revalidate = 300`) aux pages `(static)`.
- Alternatives: Forcer `force-dynamic` globalement (non retenu pour raisons SEO/perf), repasser en Pages Router (trop intrusif).
- Conséquences: Build Next stable, compat SSR pour les formulaires sensibles, cache ISR conservant de bonnes perfs pour le contenu marketing.


ADR‑006 – Simplification MVP: Exclusion Paiements et Gamification (Oct 2025)
- Contexte: Le MVP initial incluait un système de paiement (Stripe Connect) et de gamification (flocons d'avoine). Après réflexion, ces fonctionnalités ajoutent une complexité importante sans valeur immédiate pour tester le product-market fit.
- Décision:
  * ⏸️ Exclure complètement le système de paiement du MVP
  * ⏸️ Exclure la gamification (points, badges, flocons d'avoine)
  * ✅ Focus sur: Auth + Matching + Booking + Messaging + Publicité AdSense
- Alternatives considérées:
  * Implémenter Stripe en mode simplifié → Rejeté (overhead légal, comptable, support)
  * Gamification minimale → Rejeté (distrait du core value)
- Conséquences positives:
  * Réduction scope MVP de ~40%
  * Pas de gestion fiscale/comptable
  * Pas de support paiement/remboursement
  * UX simplifiée et focus sur matching
  * Monétisation AdSense plus rapide à déployer
- Conséquences à gérer:
  * Réserve monétisation aux revenus publicitaires
  * Possibilité d'ajouter paiements en post-MVP (3-6 mois) si besoin
- Critères de réactivation: Si AdSense < 200€/mois après 3 mois OU demande forte utilisateurs pour paiement direct.
