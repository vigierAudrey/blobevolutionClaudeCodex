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

## État actuel

- Le socle vise un DONE minimal, robuste, testable et documenté.
- Toute extension vers OTEL, Datadog, Prometheus, tracing distribué ou observabilité full-stack reste un backlog séparé.
