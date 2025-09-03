Style Guide – Code & Repo

TypeScript
- Mode strict; pas de any; préférer unknown + narrowing.
- Nommage en anglais; commentaires FR autorisés.

API
- Express modulaire par domaines (modules/*).
- Validation Zod par route; mapper erreurs → statuts clairs.

Base de données
- Prisma schema versionné; migrations idempotentes; seeds en dev.
- Index sur email/dates/relations; pas de SQL brut.

Tests
- Jest + Supertest (API); 1 test/fonction critique mini; viser ≥ 80% sur Auth.

Git
- Commits: feat/fix/docs/test/refactor; PR petites et atomiques; review obligatoire.
