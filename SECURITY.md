# SECURITY.md

## Architecture de sécurité
- API Express protégée par Helmet renforcé (CSP, HSTS, policies referrer/frameguard).
- Sessions signées via `express-session`, CSRF actif (double-submit token + cookie httpOnly).
- Vérification fail-fast des secrets critiques (`SESSION_SECRET`, `JWT_SECRET`, `JWT_REFRESH_SECRET`) au démarrage en production.
- Confiance proxy explicite : `TRUSTED_PROXY_IPS` obligatoire en production pour limiter les IP amont.
- CORS stricte basé sur la liste blanche `ALLOWED_ORIGINS`.
- Rate limiting adaptatif (`smartRateLimit`) et compression contrôlée.
- Services sensibles (matching, profile, auth) valident leurs payloads via Zod et middleware `validate()`.
- Notifications push sans log de jetons sensibles, cache Redis protégé par retry.
- RBAC admin : toutes les routes `/admin/*` exigent les permissions définies dans `adminProfile.permissions` (middleware `requirePermissions`).
- 2FA admin : les codes sont stockés exclusivement dans Redis (aucun fallback en production) – `REDIS_URL` doit être disponible avant démarrage.

## Vulnérabilités corrigées
1. **Wildcard CORS** → Remplacé par whitelist dynamique (`ALLOWED_ORIGINS`).
2. **Secrets faibles par défaut** → Fail-fast si secrets manquants ou <32 caractères en prod.
3. **Logs de tokens FCM** → Suppression des logs de jetons partiels.
4. **Validation incohérente** → Middleware Zod réutilisable appliqué aux routes Auth/Profile.
5. **Headers insuffisants** → Helmet configuré (CSP, HSTS, referrer, frameguard, policies cross-origin).
6. **Trust proxy permissif** → `TRUSTED_PROXY_IPS` requis en production.
7. **Génération secrets manuelle** → Script `scripts/generate-secrets.sh` (openssl base64).

## Surveillance `/security/health`

1. **Configurer l'environnement**
   - Renseigner `ALLOWED_ORIGINS` avec **tous** les domaines front autorisés (ex. `https://app.blobinfini.com,https://admin.blobinfini.com`).
   - Ajouter `TRUSTED_PROXY_IPS` avec les IP/CIDR Clever Cloud ou du reverse-proxy (ex. `163.172.0.0/16,51.15.0.0/16`).
   - Vérifier que `NODE_ENV=production`, `JWT_SECRET`≥64 chars et `DATABASE_URL` contient `sslmode=require|verify-full`.
   - Redémarrer l'API puis appeler `/security/health` : chaque variable manquante apparaitra dans `issues[]`.

2. **Tester manuellement**
   - Générer un jeton admin jetable depuis un shell sécurisé (dans `apps/api/`) :
     ```bash
     cd apps/api
     ADMIN_USER_ID="00000000-0000-0000-0000-000000000000"
     ACCESS_TOKEN=$(node -e "const jwt=require('jsonwebtoken');console.log(jwt.sign({sub: process.env.ADMIN_USER_ID, role:'ADMIN'}, process.env.JWT_SECRET, { expiresIn: '5m' }));" ADMIN_USER_ID="$ADMIN_USER_ID" JWT_SECRET="$JWT_SECRET")
     curl -s -H "Authorization: Bearer ${ACCESS_TOKEN}" https://api.blobinfini.com/security/health | jq
     ```
   - Attendu : `status: "SECURE"` et `issues: []`. Tout autre statut doit être corrigé avant déploiement.

3. **Brancher une alerte automatisée**
   - Planifier un cron Clever Cloud ou GitHub Actions avec les variables suivantes :
     - `SECURITY_HEALTH_URL` : URL complète (prod ou staging).
     - `SECURITY_HEALTH_TOKEN` : jeton admin généré par la commande ci-dessus (valide quelques minutes).
     - `HC_FAIL_URL` / `HC_OK_URL` : webhook healthchecks.io ou Slack.
   - Script recommandé :
     ```bash
     #!/usr/bin/env bash
     set -euo pipefail
     : "${SECURITY_HEALTH_URL:?}"
     : "${SECURITY_HEALTH_TOKEN:?}"
     payload=$(curl -fsS -H "Authorization: Bearer ${SECURITY_HEALTH_TOKEN}" "${SECURITY_HEALTH_URL}")
     status=$(echo "${payload}" | jq -r '.status')
     issues=$(echo "${payload}" | jq -r '.issues | join(", ")')
     if [[ "${status}" != "SECURE" ]]; then
       echo "Security health failed: ${issues}" >&2
       [[ -n "${HC_FAIL_URL:-}" ]] && curl -fsS -X POST "${HC_FAIL_URL}" -d "status=${status}&issues=${issues}" >/dev/null
       exit 1
     fi
     [[ -n "${HC_OK_URL:-}" ]] && curl -fsS "${HC_OK_URL}" >/dev/null
     ```
   - Objectif : être alerté <1 min si une régression (CORS, secrets, proxies) survient en production.

## Journalisation & RGPD
- Les lectures et écritures sensibles côté admin sont tracées via `audit()` (actions `admin:*`, `security:*`). Toute consultation (`GET /admin/users`, analytics, GDPR) enregistre désormais l’utilisateur, la ressource et l’IP.
- Les logs sont automatiquement purgés après `AUDIT_LOG_RETENTION_DAYS` jours (365 par défaut) par `gdprPurgeService`.
- Les preuves légales (consentement, suppression) sont conservées dans la table PostgreSQL `LegalConsentArchive` et consultables via `/admin/gdpr/legal-archive/:userId`.

## Checklist déploiement
- [ ] Définir `ALLOWED_ORIGINS` (liste CSV).
- [ ] Générer les secrets (`SESSION_SECRET`, `JWT_SECRET`, `JWT_REFRESH_SECRET`) via `./scripts/generate-secrets.sh`.
- [ ] Renseigner `TRUSTED_PROXY_IPS` (IP/CIDR des reverse-proxy Clever Cloud).
- [ ] Vérifier `NODE_ENV=production`, `GDPR_PURGE_*`, `S3_*`, `REDIS_URL`, `DATABASE_URL`.
- [ ] Lancer `npm run build --workspace @blobinfini/api` et `npm test --workspace @blobinfini/api`.
- [ ] Tester `/security/health` (cf. section ci-dessus) et `/health`.
- [ ] Contrôler les headers HTTP (CSP/HSTS/referrer) via `curl -I`.
- [ ] Valider l’absence de logs sensibles dans `push-notification.service`.

## Ressources supplémentaires
- `ROADMAP.md` – section Sécurité Production-Ready.
- `apps/api/CSRF_PROTECTION.md` – détails CSRF/session.
- `scripts/generate-secrets.sh` – génération rapide de secrets.
