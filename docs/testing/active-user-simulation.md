# Simulation d'utilisateurs actifs BlobConnect

## Pourquoi
- Valider le contrat réel d'authentification: cookies HTTP-only + CSRF, pas de tokens JSON.
- Vérifier l'authZ serveur sur matching, conversations et messagerie avant de pousser la charge.
- Garder les tests strictement locaux ou sur staging jetable, avec effets externes neutralisés.

## Ce que couvre la base livrée
- Seed dédiée locale: `dev+active-rider-a@test.com`, `dev+active-rider-b@test.com`, `dev+active-rider-intruder@test.com`, `dev+active-pro@test.com`.
- Scénario Playwright A/B: matching -> ouverture conversation -> message -> vérification de réception.
- Tests API: happy path, authZ conversation, validation, idempotence message.
- Tests Socket.IO: authZ join/send pour non-membre.
- Charge HTTP via `k6`: burst login, matching read, decisions, envoi message, concurrence modérée puis forte.

## Pré-requis
- Local uniquement par défaut. Pour une DB distante jetable, définir explicitement `ALLOW_NON_LOCAL_ACTIVE_TEST_DB=1`.
- Infra locale démarrée: PostgreSQL, Redis, Mailpit, MinIO.
- Ne jamais lancer contre la production.
- Si `k6` n'est pas installé sur la machine, l'installer côté runner plutôt que d'ajouter une dépendance npm au monorepo.

## Commandes
```bash
pnpm run dev:infra
pnpm run db:reseed:active-tests
pnpm run test:active-users:api
pnpm run test:active-users:e2e
BASE_URL=http://127.0.0.1:4000 pnpm run test:active-users:load
```

## Neutralisation des effets externes
- SMTP redirigé vers `127.0.0.1:1025` en E2E.
- Push Firebase désactivé si les credentials restent vides.
- Aucun webhook réel n'est injecté dans la config Playwright.
- Les scripts de charge n'émettent que des logs sans PII métier.
