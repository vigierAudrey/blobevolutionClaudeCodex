# 📊 Monitoring Serveur Minimal Et Honnête

## 🎯 Philosophie

Ce document décrit le socle serveur réellement livré dans ce repo:
- logs runtime serveur sécurisés
- audit DB
- endpoints de posture et d’observabilité ciblés
- automation de supervision sobre

Ce document ne promet pas:
- OpenTelemetry complet
- Datadog full stack
- distributed tracing complet
- observabilité full-stack
- migration exhaustive des logs frontend/browser/service worker

## Logging serveur sécurisé — clôture du chantier

Résumé honnête:
- le chantier est clos sur un socle serveur minimal d’observabilité / logging sécurisé
- ce qui est livré: logs runtime structurés, transport asynchrone borné avec métriques et breaker, endpoints `/security/health` et `/security/observability`, audit DB, scripts de supervision
- ce qui n’est pas livré: observabilité full-stack, tracing distribué complet, intégration OpenTelemetry complète, nettoyage exhaustif de tous les logs du repo
- le chantier est DONE parce que ce scope serveur minimal est présent dans le code, documenté, et couvert par des tests ciblés

Périmètre réel:
- fondation serveur uniquement
- aucun claim frontend/browser/service worker
- aucune promesse d’agrégation externe ou d’APM complet dans ce chantier

Hors scope:
- full-stack observability
- distributed tracing complet
- OpenTelemetry complet
- Datadog full stack
- migration exhaustive de tous les logs du repo

Dette P2:
- la pseudonymisation des logs dépend encore partiellement des conventions de noms de clés dans `log-serializer.ts`

### Portée réelle du chantier

Le chantier livre uniquement :

`socle serveur minimal d’observabilité / logging sécurisé`

Il ne livre pas :
- full-stack observability
- distributed tracing complet
- OpenTelemetry complet
- migration exhaustive de tous les logs du repo

Toute description future du chantier doit utiliser ce wording.

## Contrat health

`GET /security/health` décrit la posture sécurité et l’état des dépendances critiques.
Il n’expose pas l’état détaillé du pipeline de logs.

Payload attendu:

```json
{
  "status": "SECURE",
  "timestamp": "2026-03-14T12:00:00.000Z",
  "checks": {
    "config": "ok",
    "env": "ok",
    "db": "ok",
    "redis": "ok"
  }
}
```

## Contrat observability

`GET /security/observability` expose l’état réel du pipeline de logs serveur.

Payload attendu:

```json
{
  "status": "healthy",
  "timestamp": "2026-03-14T12:00:00.000Z",
  "pipeline": {
    "queued": 0,
    "sent": 10450,
    "dropped": 3,
    "failed": 2,
    "breakerState": "closed"
  }
}
```

## Automation

Le workflow `.github/workflows/security-health-monitor.yml` exécute `scripts/security-health-check.sh`
toutes les 30 minutes avec `X-Security-Monitor-Token`.
Le script échoue explicitement si `status != SECURE` ou si l’endpoint est injoignable.

## Mode dégradé

Quand le transport échoue plusieurs fois de suite, le circuit breaker passe en `open`.
Comportement documenté:
- les logs `debug` sont drop immédiatement
- les logs `warn` / `error` / `security` restent prioritaires dans la queue bornée
- toute perte est comptée dans `pipeline.dropped`
- tout échec de transport est compté dans `pipeline.failed`

## Flush shutdown

Politique de shutdown:
- flush best-effort sur `SIGINT` et `SIGTERM`
- timeout borné via `LOG_SHUTDOWN_FLUSH_TIMEOUT_MS` (défaut: 2000 ms)
- si le délai expire, le reliquat est drop explicitement et compté

## Contrat /internal/metrics

`GET /internal/metrics` expose un snapshot point-in-temps des métriques applicatives.

Auth : header `X-Internal-Token: $METRICS_INTERNAL_TOKEN` (timing-safe compare).
Le token n'est jamais loggué. L'IP est hashée (HMAC) avant log.

Payload attendu :

```json
{
  "timestamp": "2026-03-23T12:00:00.000Z",
  "process": {
    "uptime_s": 3600,
    "memory_rss_mb": 142,
    "memory_heap_used_mb": 87,
    "memory_heap_total_mb": 110
  },
  "http": {
    "requests_total": 12450,
    "errors_5xx_total": 3,
    "error_5xx_rate": 0.0002,
    "latency_p50_ms": 25,
    "latency_p95_ms": 100,
    "latency_p99_ms": 250
  },
  "matching": {
    "search": { "requests": 840, "cache_hits": 700, ... },
    "decisions": { "requests": 320, ... }
  },
  "log_transport": {
    "queued": 0,
    "sent": 12100,
    "dropped": 0,
    "failed": 0,
    "breakerState": "closed"
  }
}
```

Limites honnêtes de ce snapshot :
- `process.*` reflète le processus Node.js, PAS la VM/VPS/container.
  - `memory_rss_mb` ≠ mémoire système disponible.
  - `uptime_s` repart à 0 à chaque redémarrage de processus.
  - Pas de CPU%, pas de disk, pas de réseau.
- `http.*` exclut les appels aux endpoints de monitoring (`/health`, `/internal/metrics`,
  `/security/health`, `/security/observability`) pour ne pas biaiser les compteurs.
- `http.requests_total` exclut également les requêtes bloquées en amont par le rate limiter
  global et le middleware CSRF, avant que le middleware de métriques ne les voie. Ce compteur
  ne représente donc pas le trafic brut total reçu par l'API.
- Tous les compteurs sont cumulatifs depuis le démarrage du processus.
- Pas de rolling window — la latency p99 est sur toute la durée de vie du processus.

Ce qui reste impossible sans VPS réel :
- CPU% système ou container
- Mémoire système / limites cgroup
- Disk I/O, réseau
- Alerting hors-process (PagerDuty, Grafana)
- Collecte centralisée de logs

## État actuel

- Le socle vise un DONE minimal, robuste, testable et documenté.
- Toute extension vers OTEL, Datadog, Prometheus, tracing distribué ou observabilité full-stack reste un backlog séparé.
