Migration – Éléments à reprendre de ../blobevolution

Constats (auth-service existant)

- Prisma schema: User/Account (IDs int, rôles rider/professional/admin).
- Checklist prod (afairepourprod.txt): sécurité, rate limit, OpenAPI, CI/CD.

Adaptations pour MVP intégré

- IDs → préférer UUID (string) pour alignement scaling; rôles → RIDER/PRO/ADMIN (enum).
- Conserver bonnes pratiques: hashing, unique email, index, migrations, seeders.
- Consolidation: Auth dans apps/api/src/modules/auth au lieu d’un microservice.

À récupérer

- Idées de routes, structure Docker, .env.example et scripts utiles.
- Patterns de validation et checklists sécurité.

À éviter / à corriger

- SQL brut (remplacer par Prisma), validations éparses (centraliser Zod).
- Couplages forts entre services (MVP monolithique modulaire).
