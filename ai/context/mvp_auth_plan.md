Plan d’exécution – MVP Auth (Intégré)

Objectif
- Livrer un module Auth fiable: register, login, refresh, logout, reset password.

Pré‑requis
- docker-compose (Postgres + Redis), .env, Prisma init (packages/database), app API scaffolding.

Étapes (proposées)
1) DB & Prisma
   - Définir models User, Session/RefreshToken; rôles (RIDER, PRO, ADMIN).
   - Migrations + seed minimal; index email.

2) Services Auth (apps/api)
   - Zod DTOs register/login/reset.
   - Hash password (bcrypt ≥ 12); créer user; email verification (stub).
   - Login: vérifier credentials; générer access/refresh; stocker session/refresh.
   - Refresh: vérifier/renouveler; rotation si choisi.
   - Logout: invalider refresh (DB/Redis).
   - Reset password: request + token + changement.

3) Middleware & Guards
   - requireAuth (JWT), requireRole, rate limit sur routes sensibles.
   - Headers sécurité (helmet); CSRF si cookies.

4) Tests
   - Unitaires (services) + intégration (routes) via Supertest.
   - Cas erreurs: invalid input, wrong password, expired token, rate limit.

5) Docs & CI
   - Swagger/OpenAPI minimal; scripts npm (test, lint, type-check).
   - Checklist sécurité passée; décisions mises à jour.

Critères de Done
- Tests verts (≥ 80% Auth), endpoints stables, docs mises à jour.
- Revue PR OK (sécurité, qualité, perfs) + migrations propres.
