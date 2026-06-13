# Healthchecks API — liveness & readiness

Sondes HTTP publiques destinées à l'orchestrateur (Docker), au load balancer
(Caddy/Cloudflare) et au monitoring externe. **Aucune authentification** — elles
n'exposent que des statuts, jamais de secret, host interne, détail SQL ou stack trace.

Implémentation : [`apps/api/src/modules/health/`](../../apps/api/src/modules/health/)
(montée dans [`apps/api/src/index.ts`](../../apps/api/src/index.ts) **avant** session /
rate-limit / CSRF, donc jamais rate-limitée).

## Endpoints

### `GET /health/live` — liveness

Dit uniquement si **le process API est vivant**. Ne touche **aucune** dépendance
(ni PostgreSQL, ni Redis, ni stockage). Toujours `200`.

```json
{ "status": "ok", "service": "api", "uptimeSeconds": 123, "timestamp": "2026-06-13T04:38:07.364Z" }
```

> Utilisée par le `healthcheck` du conteneur API (`docker-compose.*.yml`) : on ne
> veut pas que Docker marque le conteneur *unhealthy* parce que Postgres est
> momentanément indisponible — ça, c'est de la *readiness*.

### `GET /health/ready` — readiness

Dit si l'API est **prête à servir le trafic**. Vérifie les dépendances avec un
timeout court et borné par check (`HEALTH_CHECK_TIMEOUT_MS`, défaut `2000`, plafonné à 5000).

```json
{
  "status": "ok|degraded|critical",
  "checks": {
    "database": "ok|degraded|critical",
    "redis": "ok|degraded|critical|not_configured",
    "storage": "ok|degraded|critical|not_configured"
  },
  "timestamp": "2026-06-13T04:38:07.364Z"
}
```

| Check | Type | Sonde | Panne |
|-------|------|-------|-------|
| `database` | **dure** | `SELECT 1` | `critical` |
| `redis` | souple (fallback mémoire) | `PING` via cache service | `degraded` |
| `storage` | souple (médias) | `HeadBucket` MinIO/S3 | `degraded` |

**Code HTTP** : `200` si `ok` ou `degraded`, **`503` si `critical`** (= DB injoignable).
Un LB doit retirer l'instance du pool sur `503`, mais la garder sur `degraded`.

**`not_configured`** : la dépendance n'est pas attendue dans ce déploiement
(Redis sans `REDIS_URL` ni `DOCKER=true`, ou stockage sans `S3_BUCKET`). N'affecte
pas le verdict global.

### `GET /health` — compat héritée

Réponse plate `{ "status": "ok" }`. Conservée pour rétro-compatibilité.

## Variables d'environnement

| Variable | Défaut | Rôle |
|----------|--------|------|
| `HEALTH_CHECK_TIMEOUT_MS` | `2000` | Timeout par check de readiness (borné 250–5000 ms) |
| `REDIS_URL` / `DOCKER=true` | — | Marque Redis comme *attendu* (panne ⇒ `degraded` au lieu de `not_configured`) |
| `S3_BUCKET` | — | Présence ⇒ le stockage est probé ; absence ⇒ `not_configured` |

## Vérifier que ça marche

```bash
# Liveness — doit toujours répondre 200, même DB coupée
curl -s http://localhost:4000/health/live | jq

# Readiness — 200 (ok/degraded) ou 503 (critical)
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:4000/health/ready
curl -s http://localhost:4000/health/ready | jq

# Conteneur (statut Docker, basé sur /health/live)
docker inspect --format '{{.State.Health.Status}}' <api-container>
```

Tests automatisés :
```bash
NODE_ENV=test pnpm --filter @blobinfini/api exec jest --testPathPatterns "modules/health"
```

## En cas d'échec

| Symptôme | Cause probable | Action |
|----------|----------------|--------|
| `/health/live` ne répond pas | process API mort / port non exposé | `docker compose logs api` ; redémarrer le conteneur |
| `/health/ready` = `503` (`database: critical`) | Postgres down / réseau / pool saturé | voir [restore-pg.sh](../../scripts/restore-pg.sh) si corruption ; sinon vérifier le conteneur postgres et `pg_isready` |
| `database: degraded` (timeout) | DB lente / surcharge | vérifier la charge, les requêtes longues, `HEALTH_CHECK_TIMEOUT_MS` |
| `redis: degraded` | Redis down | l'app continue (fallback mémoire pour rate-limit) ; restaurer Redis sans urgence bloquante |
| `storage: degraded` | MinIO/S3 down | les uploads médias échouent ; le cœur (auth/matching/messagerie) reste servi |

## Limites connues

- La readiness ne mesure pas la *profondeur* (latence p99, taille de pool) — c'est
  une sonde binaire bornée, pas un APM. Voir [`/internal/metrics`](../monitoring.md).
- Le check storage fait un `HeadBucket` par appel : ne pas poller `/health/ready`
  à très haute fréquence (≤ toutes les 10 s recommandé).
- En `NODE_ENV=test`, le check storage ne fait aucun appel réseau.
