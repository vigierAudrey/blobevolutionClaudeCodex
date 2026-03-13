# WS_P0 Runtime Proof - PROD / PREPROD

Status global: **NO-GO** (preuves runtime manquantes dans ce repo local)
Reason: `kubectl` non disponible dans cet environnement d'exécution (`kubectl:absent`, vérifié le 2026-02-19).

Règles de redaction:
- Autorisé: booléens/nombres utiles (`true/false`, `REPLICAS`, min/max HPA).
- Redacter: hosts, URLs, IP/CIDR, namespaces sensibles, noms de pods, tokens.
- Format de redaction: `<redacted>`.

## PREPROD

- Date (UTC): `<to-fill>`
- Namespace: `<redacted>`
- App/Deployment: `<redacted>`
- Container: `<redacted>`

### 1) Env déclarée (Deployment)
Command:
```bash
kubectl -n "$NS" set env deploy/"$APP" --list | rg '^(TRUST_PROXY_MODE|ENABLE_WEBSOCKET_RATE_LIMIT|REPLICAS)='
```
Output:
```text
NO_PROOF_COLLECTED
```

### 2) Env runtime (pod)
Command:
```bash
POD="$(kubectl -n "$NS" get pod -l app="$APP" -o jsonpath='{.items[0].metadata.name}')"
kubectl -n "$NS" exec "$POD" -c "$CONTAINER" -- printenv | rg '^(TRUST_PROXY_MODE|ENABLE_WEBSOCKET_RATE_LIMIT|REPLICAS)='
```
Output:
```text
NO_PROOF_COLLECTED
```

### 3) Scale deployment
Command:
```bash
kubectl -n "$NS" get deploy "$APP" -o custom-columns=NAME:.metadata.name,REPLICAS:.spec.replicas,READY:.status.readyReplicas,AVAILABLE:.status.availableReplicas
```
Output:
```text
NO_PROOF_COLLECTED
```

### 4) HPA
Command:
```bash
kubectl -n "$NS" get hpa -o custom-columns=NAME:.metadata.name,MIN:.spec.minReplicas,MAX:.spec.maxReplicas,CURRENT:.status.currentReplicas,TARGETS:.status.currentMetrics[*].resource.current.averageUtilization
```
Output:
```text
NO_PROOF_COLLECTED
```

### 5) Boot logs CONFIG_WS
Command:
```bash
kubectl -n "$NS" logs deploy/"$APP" -c "$CONTAINER" --since=15m | rg 'CONFIG_WS|RATE_LIMIT_ENABLED'
```
Output:
```text
NO_PROOF_COLLECTED
```

Conclusion PREPROD: **NO-GO** tant que les 5 outputs ne sont pas collés.

## PROD

- Date (UTC): `<to-fill>`
- Namespace: `<redacted>`
- App/Deployment: `<redacted>`
- Container: `<redacted>`

### 1) Env déclarée (Deployment)
Command:
```bash
kubectl -n "$NS" set env deploy/"$APP" --list | rg '^(TRUST_PROXY_MODE|ENABLE_WEBSOCKET_RATE_LIMIT|REPLICAS)='
```
Output:
```text
NO_PROOF_COLLECTED
```

### 2) Env runtime (pod)
Command:
```bash
POD="$(kubectl -n "$NS" get pod -l app="$APP" -o jsonpath='{.items[0].metadata.name}')"
kubectl -n "$NS" exec "$POD" -c "$CONTAINER" -- printenv | rg '^(TRUST_PROXY_MODE|ENABLE_WEBSOCKET_RATE_LIMIT|REPLICAS)='
```
Output:
```text
NO_PROOF_COLLECTED
```

### 3) Scale deployment
Command:
```bash
kubectl -n "$NS" get deploy "$APP" -o custom-columns=NAME:.metadata.name,REPLICAS:.spec.replicas,READY:.status.readyReplicas,AVAILABLE:.status.availableReplicas
```
Output:
```text
NO_PROOF_COLLECTED
```

### 4) HPA
Command:
```bash
kubectl -n "$NS" get hpa -o custom-columns=NAME:.metadata.name,MIN:.spec.minReplicas,MAX:.spec.maxReplicas,CURRENT:.status.currentReplicas,TARGETS:.status.currentMetrics[*].resource.current.averageUtilization
```
Output:
```text
NO_PROOF_COLLECTED
```

### 5) Boot logs CONFIG_WS
Command:
```bash
kubectl -n "$NS" logs deploy/"$APP" -c "$CONTAINER" --since=15m | rg 'CONFIG_WS|RATE_LIMIT_ENABLED'
```
Output:
```text
NO_PROOF_COLLECTED
```

Conclusion PROD: **NO-GO** tant que les 5 outputs ne sont pas collés.

## Test evidence (local branch validation)

Command:
```bash
pnpm --filter @blobinfini/api type-check
```
Result:
```text
exit_code=0
```

Command:
```bash
NODE_ENV=test pnpm --filter @blobinfini/api exec jest --runInBand --testPathPatterns "socket-"
```
Result:
```text
exit_code=0
Test Suites: 11 passed, 11 total
Tests: 45 passed, 45 total
```
