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

## Vulnérabilités corrigées
1. **Wildcard CORS** → Remplacé par whitelist dynamique (`ALLOWED_ORIGINS`).
2. **Secrets faibles par défaut** → Fail-fast si secrets manquants ou <32 caractères en prod.
3. **Logs de tokens FCM** → Suppression des logs de jetons partiels.
4. **Validation incohérente** → Middleware Zod réutilisable appliqué aux routes Auth/Profile.
5. **Headers insuffisants** → Helmet configuré (CSP, HSTS, referrer, frameguard, policies cross-origin).
6. **Trust proxy permissif** → `TRUSTED_PROXY_IPS` requis en production.
7. **Génération secrets manuelle** → Script `scripts/generate-secrets.sh` (openssl base64).

## Checklist déploiement
- [ ] Définir `ALLOWED_ORIGINS` (liste CSV).
- [ ] Générer les secrets (`SESSION_SECRET`, `JWT_SECRET`, `JWT_REFRESH_SECRET`) via `./scripts/generate-secrets.sh`.
- [ ] Renseigner `TRUSTED_PROXY_IPS` (IP/CIDR des reverse-proxy Clever Cloud).
- [ ] Vérifier `NODE_ENV=production`, `GDPR_PURGE_*`, `S3_*`, `REDIS_URL`, `DATABASE_URL`.
- [ ] Lancer `npm run build --workspace @blobinfini/api` et `npm test --workspace @blobinfini/api`.
- [ ] Tester `/security/health` (à implémenter phase 3) et `/health`.
- [ ] Contrôler les headers HTTP (CSP/HSTS/referrer) via `curl -I`.
- [ ] Valider l’absence de logs sensibles dans `push-notification.service`.

## Ressources supplémentaires
- `ROADMAP.md` – section Sécurité Production-Ready.
- `apps/api/CSRF_PROTECTION.md` – détails CSRF/session.
- `scripts/generate-secrets.sh` – génération rapide de secrets.
