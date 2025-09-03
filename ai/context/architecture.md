Architecture – MVP Monorepo

Structure proposée
blobevolutionClaudeCodex/
├─ apps/
│  ├─ web/                 # Next.js PWA
│  └─ api/                 # Express API modulaire
│     └─ src/modules/
│        ├─ auth/          # Auth intégré (MVP focus)
│        ├─ users/
│        ├─ bookings/
│        ├─ payments/
│        └─ messaging/
├─ packages/
│  ├─ database/            # Prisma schema + client
│  ├─ shared/              # Types TS partagés
│  └─ ui/                  # Composants UI réutilisables
├─ docker-compose.yml      # Postgres + Redis (dev)
└─ turbo.json              # Turborepo

Découpage MVP
- Auth dans l’API (simplicité). Migration vers service dédié en phase Scale.
- Prisma + PostgreSQL (PostGIS prêt pour matching géospatial).
- JWT access (15m) + refresh (30j), sessions/blacklist côté DB/Redis.

Sécurité cross‑cutting
- Zod sur tous inputs, rate limit, CSRF/headers, logs structurés.
