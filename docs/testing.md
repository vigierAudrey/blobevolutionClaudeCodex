# Tests E2E – Blob

## 🔌 Ports & environnements

| Environnement | Web | API  | Usage                 |
|---------------|-----|------|-----------------------|
| Dev           | 3002 | 4000 | Codage quotidien      |
| E2E           | 3020 | 4020 | Tests Playwright      |
| CI/CD         | auto | auto | GitHub Actions / Docker |

Ton environnement de développement reste actif sur `3002/4000`. Les tests E2E s’exécutent dans un environnement isolé (par défaut `3020/4020`) sans jamais toucher aux serveurs existants.

## ▶️ Lancer les tests

```bash
npm run test:e2e
```

- Le script `scripts/run-e2e.mjs` trouve des ports libres (3020/4020 par défaut, fallback automatique) et exporte les variables `E2E_WEB_PORT` / `E2E_API_PORT`.
- Journalisation automatique :  
  ` [E2E] Using ports: web=3020, api=4020`
- Les serveurs sont attendus jusqu’à 180 s avec un message explicite si l’un d’eux ne démarre pas.

### Ports personnalisés

Tu peux surcharger via variables d’environnement (CLI ou `.env.local`) :

```bash
E2E_WEB_PORT=3050 E2E_API_PORT=4050 npm run test:e2e
```

## 📦 Docker

Le service `e2e-server` défini dans `docker-compose.yml` permet de lancer les tests dans un container isolé (utile pour la CI ou un run one-shot) :

```bash
docker compose run --rm e2e-server
```

Ce service mappe `3020/4020` vers l’hôte pour faciliter le debug.

> Astuce CI : la commande ci-dessus est identique à ce qui se passe dans GitHub Actions (workflow `test.yml`).

## 📓 Rappels

- Aucun `kill-port`, `lsof`, ou autre commande intrusive n’est nécessaire.
- Les tests utilisent Playwright (`apps/web/tests/e2e/`) et couvrent notamment la conformité RGPD (consentement pub, absence de cookies sans opt-in).

Consulte aussi `README_ADS.md` pour la cartographie complète des environnements et la checklist RGPD/Ads.
