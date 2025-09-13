# CI & E2E – Coach pédago

## Image mentale
- CI = la chaîne de montage d’une usine: à chaque pièce (commit/PR), la chaîne vérifie qu’elle s’assemble, qu’elle roule et qu’elle freine. Si un test échoue, la pièce ne sort pas de l’usine.
- E2E = l’essai routier filmé: on prend une vraie voiture complète (API + DB, et bientôt Web), on fait le trajet utilisateur, et on enregistre le résultat.

## Ce que fait la CI (GitHub Actions)
- Déclenchement: à chaque push/PR vers `main`/`develop`.
- Étapes principales:
  - Node 20 et Postgres (service Docker) sont démarrés.
  - Prisma `generate` puis `migrate` pour préparer la base.
  - Build du front Next.js (détecte aussi les erreurs de types côté Web).
  - Type-check global du repo.
  - Tests API E2E (Jest + Supertest) avec une vraie DB locale.
- Fichiers clés: `.github/workflows/ci.yml`.
- Où voir les résultats: onglet “Actions” de GitHub sur le dépôt.

## Reproduire localement (WSL recommandé)
Blocs à coller tels quels:

```
cd ~/dev/blobevolutionClaudeCodex
export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm use 20

# Services
docker compose up -d postgres

# Dépendances + DB
npm ci
npm run db:generate
npm run db:migrate

# Tests API E2E
npm test --workspace @blobinfini/api
```

- API écoute en local sur `4000` pendant les E2E (lancée par les tests).
- Web en dev par défaut: `3001` (utile pour tester visuellement à côté).

## Ce que couvrent les E2E (aujourd’hui)
- Auth: register → login → refresh rotation → logout (all/single).
- Forgot/reset password.
- Email verification (+ option “login bloqué si non vérifié”).
- Route protégée “verified-only”.
- Profil: création auto, update, URL présignée S3/MinIO.

## Ajouter un test E2E API
- Dossier: `apps/api/src/modules/**/__tests__/*e2e.test.ts`.
- Modèle rapide:

```ts
import request from 'supertest';
import { createApp } from '../../../index';
import { prisma } from '@blobinfini/database';

describe('Feature E2E', () => {
  const app = createApp();
  beforeAll(async () => { await prisma.user.deleteMany(); });
  afterAll(async () => { await prisma.$disconnect(); });

  it('does the journey', async () => {
    await request(app).post('/auth/register').send({ email: 'x@test.com', password: 'Passw0rd!', consentAccepted: true }).expect(201);
    const login = await request(app).post('/auth/login').send({ email: 'x@test.com', password: 'Passw0rd!' }).expect(200);
    expect(login.body).toHaveProperty('accessToken');
  });
});
```

## E2E Web (prochaines étapes)
- Outil: Playwright.
- Parcours minimal cible: `register` → message de vérif → `login` → redirection dashboard.
- Intégration: un job CI supplémentaire lancera le serveur API + Web, puis les tests Playwright.

## Dépannage rapide
- “Port 3000 occupé” → libérer: `sudo fuser -k 3000/tcp`.
- “nodemailer not available” → en dev, on a Mailpit. `.env` doit inclure `SMTP_HOST=localhost`, `SMTP_PORT=1025`, `SMTP_ALLOW_NO_AUTH=true`.
- “get-tsconfig introuvable” → réinstaller: `rm -rf node_modules && npm ci`.

---
Astuce pédagogie: pense CI comme “la porte de l’usine”. Si le feu n’est pas vert (build/tests), aucune voiture ne sort. Les E2E sont le test drive qui évite les surprises en arrivant chez le client.

