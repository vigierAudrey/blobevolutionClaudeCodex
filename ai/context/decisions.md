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
