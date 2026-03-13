# RUNBOOK PROD/PREPROD - PREUVE P0 WEBSOCKET

Ce runbook produit une preuve exploitable pour:
- `TRUST_PROXY_MODE`
- `ENABLE_WEBSOCKET_RATE_LIMIT`
- `REPLICAS` et HPA effectif

Il inclut aussi:
- vérification du log de boot `CONFIG_WS` (sans PII/secrets)
- preuve du fail-fast si RL est désactivé en production
- smoke test WebSocket post-déploiement

## 0) Variables shell

```bash
export NS="api-prod"            # ou api-preprod
export APP="blobinfini-api"     # nom du Deployment
export CONTAINER="api"          # nom du conteneur dans le pod
```

## 1) Preuve config déclarée (spec Deployment)

```bash
kubectl -n "$NS" set env deploy/"$APP" --list \
  | rg '^(TRUST_PROXY_MODE|ENABLE_WEBSOCKET_RATE_LIMIT|REPLICAS)='
```

Résultat attendu (exemple):

```text
TRUST_PROXY_MODE=ips
ENABLE_WEBSOCKET_RATE_LIMIT=true
REPLICAS=2
```

Si une variable est absente ici, elle peut venir d'un `valueFrom` (ConfigMap/Secret) ou d'un défaut runtime.

## 2) Preuve runtime réelle (pod en cours)

```bash
POD="$(kubectl -n "$NS" get pod -l app="$APP" -o jsonpath='{.items[0].metadata.name}')"
kubectl -n "$NS" exec "$POD" -c "$CONTAINER" -- printenv \
  | rg '^(TRUST_PROXY_MODE|ENABLE_WEBSOCKET_RATE_LIMIT|REPLICAS)='
```

Résultat attendu (exemple):

```text
TRUST_PROXY_MODE=ips
ENABLE_WEBSOCKET_RATE_LIMIT=true
REPLICAS=2
```

## 3) Preuve scale effective (Deployment + HPA)

```bash
kubectl -n "$NS" get deploy "$APP" -o custom-columns=NAME:.metadata.name,REPLICAS:.spec.replicas,READY:.status.readyReplicas,AVAILABLE:.status.availableReplicas
kubectl -n "$NS" get hpa -o custom-columns=NAME:.metadata.name,MIN:.spec.minReplicas,MAX:.spec.maxReplicas,CURRENT:.status.currentReplicas,TARGETS:.status.currentMetrics[*].resource.current.averageUtilization
```

Résultat attendu (exemple):

```text
NAME            REPLICAS  READY  AVAILABLE
blobinfini-api  2         2      2

NAME            MIN  MAX  CURRENT  TARGETS
blobinfini-api  2    6    2        34
```

Si HPA absent:

```text
No resources found in <ns> namespace.
```

## 4) Preuve boot `CONFIG_WS` + garde-fou RL prod

### 4.1 Vérifier log de boot `CONFIG_WS`

```bash
kubectl -n "$NS" logs deploy/"$APP" -c "$CONTAINER" --since=15m \
  | rg 'CONFIG_WS|RATE_LIMIT_ENABLED'
```

Résultat attendu (exemple):

```text
INFO RATE_LIMIT_ENABLED { env: "production", flag: "true", mode: "production (default ON)" }
INFO CONFIG_WS { env: "production", trustProxyMode: "ips", rateLimitEnabled: true, ... }
```

### 4.2 Vérifier fail-fast si RL off en prod

Le code doit crasher au boot si `NODE_ENV=production` et `ENABLE_WEBSOCKET_RATE_LIMIT=false`.

Preuve non destructive (lecture):

```bash
kubectl -n "$NS" logs deploy/"$APP" -c "$CONTAINER" --since=24h \
  | rg 'FATAL: ENABLE_WEBSOCKET_RATE_LIMIT=false'
```

Test actif (PREPROD uniquement):

```bash
kubectl -n "$NS" set env deploy/"$APP" ENABLE_WEBSOCKET_RATE_LIMIT=false
kubectl -n "$NS" rollout restart deploy/"$APP"
kubectl -n "$NS" rollout status deploy/"$APP" --timeout=120s || true
kubectl -n "$NS" logs deploy/"$APP" -c "$CONTAINER" --since=10m \
  | rg 'FATAL: ENABLE_WEBSOCKET_RATE_LIMIT=false'

# rollback immédiat
kubectl -n "$NS" set env deploy/"$APP" ENABLE_WEBSOCKET_RATE_LIMIT=true
kubectl -n "$NS" rollout restart deploy/"$APP"
kubectl -n "$NS" rollout status deploy/"$APP" --timeout=120s
```

## 5) Smoke test WS post-déploiement

Pré-requis:
- `WS_URL` (ex: `https://api.example.com`)
- `WS_ORIGIN` autorisée (ex: front prod)
- `WS_TOKEN` JWT utilisateur valide

```bash
WS_URL="https://api.example.com" \
WS_ORIGIN="https://app.example.com" \
WS_TOKEN="<jwt>" \
node -e "const { io } = require('socket.io-client'); const s = io(process.env.WS_URL, { transports:['websocket'], auth:{ token: process.env.WS_TOKEN }, extraHeaders:{ Origin: process.env.WS_ORIGIN }, reconnection:false, timeout:8000 }); s.on('connect', () => { console.log('WS_SMOKE_OK connected', s.id); s.close(); process.exit(0); }); s.on('connect_error', (e) => { console.error('WS_SMOKE_FAIL connect_error', e.message); process.exit(1); }); setTimeout(() => { console.error('WS_SMOKE_FAIL timeout'); process.exit(1); }, 10000);"
```

Résultat attendu:

```text
WS_SMOKE_OK connected <socket-id>
```

## 6) Actions correctives si INCONNU

Si les commandes ci-dessus ne permettent pas de prouver les valeurs:

1. Kubernetes natif:
   - définir les variables dans le `Deployment` (`spec.template.spec.containers[].env`)
   - ou via `ConfigMap/Secret` référencés dans `envFrom`
   - redéployer et rerun sections 1→5
2. Helm:
   - définir dans `values-<env>.yaml` (`env`, `replicaCount`, `autoscaling`)
   - rendre la valeur finale avec `helm template ... | rg 'TRUST_PROXY_MODE|ENABLE_WEBSOCKET_RATE_LIMIT|replicaCount|HPA'`
   - appliquer `helm upgrade --install` puis rerun sections 1→5
3. Provider managé (sans manifests dans ce repo, ex. Clever Cloud/Render/Railway):
   - configurer les variables dans le panneau ENV de l'application API
   - configurer le scale/replicas côté provider
   - redémarrer le service puis exécuter preuve runtime (logs + smoke test)

Valeurs safe-by-default:
- `TRUST_PROXY_MODE=disabled` (ou `ips` + `TRUSTED_PROXY_IPS` si reverse proxy)
- `ENABLE_WEBSOCKET_RATE_LIMIT=true`
- `REPLICAS=1` par défaut (si `2+`, considérer les gardes mémoire comme best-effort par instance)

## 7) Checklist GO/NO-GO (signature)

- [ ] `TRUST_PROXY_MODE` prouvé en runtime (`kubectl exec printenv`)
- [ ] `ENABLE_WEBSOCKET_RATE_LIMIT=true` prouvé en runtime
- [ ] `REPLICAS` prouvé (`deploy`) et HPA vérifié (`get hpa`)
- [ ] Log `CONFIG_WS` visible au boot et cohérent
- [ ] Preuve fail-fast RL off en prod/preprod (lecture logs ou test actif preprod)
- [ ] Smoke test WS post-déploiement: `WS_SMOKE_OK`
- [ ] Aucun écart P0 non corrigé

Décision:
- GO seulement si toutes les cases sont cochées.
- NO-GO si une case P0 est non prouvée.
