# Audit hostile email infra — VPS/Brevo — 2026-05-12

## Périmètre

- Repo versionné seulement pour les grep bruts ci-dessous.
- Les fichiers locaux non versionnés `.env.vps` et `.env.pre-vps` n'apparaissent pas dans les grep pour éviter toute fuite de secrets.
- Constat hors repo : dans ce workspace, les copies locales `.env.vps` et `.env.pre-vps` pointent encore vers Mailpit. Elles doivent être corrigées manuellement avant le prochain bootstrap VPS/pré-prod réelle.

## Grep complet `mailpit`

```text
scripts/run-active-user-load.mjs:61:  if (smtpHost && !['localhost', '127.0.0.1', 'mailpit'].includes(smtpHost)) {
docs/testing/active-user-simulation.md:17:- Infra locale démarrée: PostgreSQL, Redis, Mailpit, MinIO.
playwright.auth-verify.config.ts:11: * Always requires Mailpit on http://localhost:8025 (start with: docker run -p 8025:8025 -p 1025:1025 axllent/mailpit)
playwright.config.ts:48:  // auth-verify-flow has its own dedicated config and Mailpit prerequisite.
scripts/check-vps-env.sh:13:#   - SMTP Brevo obligatoire, authentifié, sans fallback Mailpit
scripts/check-vps-env.sh:215:must_not_contain "SMTP_HOST" "^mailpit$"
.env.vps.example:73:# Aucun fallback Mailpit/localhost n'est autorisé ici.
README.md:307:# Configuration SMTP (Mailpit local/dev uniquement)
README.md:578:docker compose up -d postgres redis minio mailpit
README.md:798:     - Démarre l'infra Docker (Postgres, Redis, MinIO, Mailpit) et l'API dans Docker
README.md:1049:  docker compose up -d postgres redis minio mailpit
README.md:1058:npm run dev:infra       # Postgres/Redis/MinIO/Mailpit (Docker)
README.md:1069:  - Mailpit (inbox mails dev) : `http://localhost:8025`
README.md:1079:Activer l’envoi d’emails (dev avec Mailpit)
README.md:1081:- Démarrer Mailpit: inclus dans `docker-compose.yml` → `docker compose up -d mailpit` (UI: http://localhost:8025)
README.md:1082:- `.env` déjà prêt pour Mailpit: `SMTP_HOST=localhost`, `SMTP_PORT=1025`, `SMTP_SECURE=false`.
README.md:1086:Mailpit ne doit pas être utilisé en VPS/pré-prod réelle: utiliser Brevo via `.env.vps` et `docker-compose.vps.yml`.
scripts/ci-local.sh:38:log_info "Step 1/8: Starting Docker services (postgres, redis, minio, mailpit)..."
scripts/ci-local.sh:39:if ! docker compose up -d postgres redis minio mailpit 2>&1; then
scripts/ci-local.sh:88:# Check Mailpit (just verify the port is open)
scripts/ci-local.sh:89:log_info "  → Checking Mailpit..."
scripts/ci-local.sh:90:if docker compose ps mailpit | grep -q "Up"; then
scripts/ci-local.sh:91:    log_success "  Mailpit is running"
scripts/ci-local.sh:93:    log_warning "  Mailpit may not be ready"
scripts/ci-local.sh:192:echo "  ✅ Docker services started (PostgreSQL, Redis, MinIO, Mailpit)"
scripts/ci-local.sh:200:echo "  📊 Mailpit (emails): http://localhost:8025"
.github/workflows/ci.yml:540:      # Mailpit reste en CI pour les scénarios E2E de capture d'email locale.
.github/workflows/ci.yml:542:      mailpit:
.github/workflows/ci.yml:543:        image: axllent/mailpit:latest
.github/workflows/ci.yml:570:      MAILPIT_URL: http://localhost:8025
scripts/pre-vps-bootstrap.sh:11:#   6. Démarrage des services infrastructure (postgres, redis, minio, mailpit)
scripts/pre-vps-bootstrap.sh:159:# ─── 7. Démarrage infra (postgres, redis, minio, mailpit) ────────────────────
scripts/pre-vps-bootstrap.sh:161:$DC up -d postgres redis minio mailpit
scripts/pre-vps-bootstrap.sh:238:echo "  Mailpit UI    : http://localhost:8025"
ROADMAP.md:190:- [x] **2026-05-12 — SMTP VPS durci** : Mailpit retiré de `docker-compose.vps.yml`, `.env.vps.example` basculé sur Brevo SMTP relay, validation/healthcheck SMTP VPS ajoutés et `forgot-password` limité par email comme `resend-verification`.
apps/api/src/modules/security/security.health.ts:14:const LOCAL_SMTP_HOSTS = new Set(['mailpit', 'localhost', '127.0.0.1']);
docker-compose.vps.yml:142:      # AUCUN override Docker vers Mailpit ici : tout fallback silencieux est interdit.
scripts/README.md:9:1. ✅ **Docker** - Démarre PostgreSQL, Redis, MinIO et Mailpit
scripts/README.md:25:| **Mailpit** | 1025, 8025 | http://localhost:8025 | (interface web emails) |
scripts/README.md:87:Step 1/8: Starting Docker services (postgres, redis, minio, mailpit)...
scripts/README.md:97:  → Checking Mailpit...
scripts/README.md:98:✅ Mailpit is running
docs/runbooks/vps-runtime.md:194:| Fallback silencieux vers Mailpit | `docker-compose.vps.yml` n'embarque aucun service Mailpit; `check-vps-env.sh` + `validateProductionEnv()` imposent Brevo SMTP authentifié |
apps/api/src/lib/env-validation.ts:21:const LOCAL_SMTP_HOSTS = new Set(['mailpit', 'localhost', '127.0.0.1']);
docker-compose.yml:61:  mailpit:
docker-compose.yml:62:    image: axllent/mailpit:latest
docker-compose.yml:65:      - "127.0.0.1:${MAILPIT_SMTP_PORT:-1025}:1025"
docker-compose.yml:66:      - "127.0.0.1:${MAILPIT_HOST_PORT:-8025}:8025"
docker-compose.yml:81:      SMTP_HOST: mailpit
docker-compose.yml:128:      SMTP_HOST: mailpit
docs/ci-e2e.md:86:- “nodemailer not available” → en dev, on a Mailpit. `.env` doit inclure `SMTP_HOST=localhost`, `SMTP_PORT=1025`, `SMTP_ALLOW_NO_AUTH=true`.
package.json:26:    "dev:infra": "docker compose up -d postgres redis minio mailpit",
apps/web/tests/e2e/auth-verify-flow.spec.ts:12: *   - Mailpit HTTP API: MAILPIT_URL (defaulted by playwright.auth-verify.config.ts)
apps/web/tests/e2e/auth-verify-flow.spec.ts:21:const MAILPIT_URL = process.env.MAILPIT_URL ?? 'http://127.0.0.1:8025';
apps/web/tests/e2e/auth-verify-flow.spec.ts:53:async function getVerifyUrlFromMailpit(recipientEmail: string): Promise<string> {
apps/web/tests/e2e/auth-verify-flow.spec.ts:55:  let lastFailure = `Mailpit URL ${MAILPIT_URL} did not return a matching message`;
apps/web/tests/e2e/auth-verify-flow.spec.ts:57:    const listRes = await fetch(`${MAILPIT_URL}/api/v1/messages?limit=50`);
apps/web/tests/e2e/auth-verify-flow.spec.ts:59:      lastFailure = `Mailpit list failed with HTTP ${listRes.status} at ${MAILPIT_URL}/api/v1/messages?limit=50`;
apps/web/tests/e2e/auth-verify-flow.spec.ts:74:      const msgRes = await fetch(`${MAILPIT_URL}/api/v1/message/${msg.ID}`);
apps/web/tests/e2e/auth-verify-flow.spec.ts:76:        lastFailure = `Mailpit message fetch failed with HTTP ${msgRes.status} at ${MAILPIT_URL}/api/v1/message/${msg.ID}`;
apps/web/tests/e2e/auth-verify-flow.spec.ts:124:  const verifyUrl = await getVerifyUrlFromMailpit(email);
apps/web/tests/e2e/auth-verify-flow.spec.ts:153:  const verifyUrl = await getVerifyUrlFromMailpit(email);
docker-compose.pre-vps.yml:120:  mailpit:
docker-compose.pre-vps.yml:121:    # Pin v1.29.4 (mars 2026) — suivi des releases : https://github.com/axllent/mailpit/releases
docker-compose.pre-vps.yml:122:    image: axllent/mailpit:v1.29.4
docker-compose.pre-vps.yml:145:      SMTP_HOST:    mailpit
docs/runbooks/pre-vps-runbook.md:61:| Mailpit (emails de qualification locale uniquement) | http://localhost:8025 | — |
docs/runbooks/pre-vps-runbook.md:67:Mailpit reste volontairement présent ici pour les liens de vérification/reset et les codes 2FA en qualification locale. Il ne fait pas partie de la cible VPS réelle.
docs/runbooks/pre-vps-runbook.md:274:- [ ] Configurer Brevo SMTP réel (`smtp-relay.brevo.com`, auth obligatoire, pas Mailpit)
.env.example:67:# Valeurs par défaut pour Mailpit (dev):
.env.example:68:#  - UI: http://localhost:${MAILPIT_HOST_PORT:-8025}
.env.example:71:# surcharger uniquement le port UI : MAILPIT_HOST_PORT=8026
.env.example:72:# NE PAS changer SMTP_PORT ici — l’API Docker se connecte à mailpit:1025 en réseau interne.
.env.example:73:MAILPIT_HOST_PORT=8025
.env.example:80:SMTP_ALLOW_NO_AUTH=true # Permet l'envoi sans login/password (Mailpit en dev)
apps/web/app/(auth)/login-pro/page.tsx:38:      setInfo(`${baseMessage} (Dev: Mailpit sur :8025)`);
apps/web/app/(auth)/login-pro/page.tsx:95:      setInfo(`${baseMessage} (Dev: Mailpit sur :8025)`);
apps/api/src/lib/mailer.ts:28:  // Dev/pre-VPS only: explicit opt-in for unauthenticated SMTP targets such as Mailpit.
apps/api/src/lib/mailer.ts:54:      // If no auth provided (Mailpit), nodemailer accepts undefined
.env.pre-vps.example:62:# ─── SMTP (Mailpit docker interne, pré-VPS local uniquement) ─────────────────
.env.pre-vps.example:65:SMTP_HOST=mailpit
```

## Grep complet `SMTP_HOST`

```text
scripts/run-active-user-load.mjs:60:  const smtpHost = String(process.env.SMTP_HOST || '').trim().toLowerCase();
scripts/run-active-user-load.mjs:62:    fail(`SMTP_HOST non sûr pour la charge: ${smtpHost}`);
apps/web/playwright.config.ts:15:  SMTP_HOST: '127.0.0.1',
playwright.auth-verify.config.ts:46:            SMTP_HOST: '127.0.0.1',
playwright.config.ts:19:  SMTP_HOST: '127.0.0.1',
.env.vps.example:77:SMTP_HOST=smtp-relay.brevo.com
README.md:308:SMTP_HOST=localhost
README.md:1082:- `.env` déjà prêt pour Mailpit: `SMTP_HOST=localhost`, `SMTP_PORT=1025`, `SMTP_SECURE=false`.
scripts/check-vps-env.sh:198:require_var "SMTP_HOST"
scripts/check-vps-env.sh:203:if [ "${SMTP_HOST:-}" != "smtp-relay.brevo.com" ]; then
scripts/check-vps-env.sh:204:  log_err "SMTP_HOST doit valoir 'smtp-relay.brevo.com' en VPS (valeur actuelle: ${SMTP_HOST:-<vide>})"
scripts/check-vps-env.sh:215:must_not_contain "SMTP_HOST" "^mailpit$"
scripts/check-vps-env.sh:216:must_not_contain "SMTP_HOST" "^localhost$"
scripts/check-vps-env.sh:217:must_not_contain "SMTP_HOST" "^127\\.0\\.0\\.1$"
apps/api/src/lib/env-validation.ts:20:const BREVO_SMTP_HOST = 'smtp-relay.brevo.com';
apps/api/src/lib/env-validation.ts:21:const LOCAL_SMTP_HOSTS = new Set(['mailpit', 'localhost', '127.0.0.1']);
apps/api/src/lib/env-validation.ts:76:    const smtpHost = String(process.env.SMTP_HOST ?? '').trim().toLowerCase();
apps/api/src/lib/env-validation.ts:84:      errors.push('SMTP_HOST is required when APP_ENV=vps');
apps/api/src/lib/env-validation.ts:86:      if (LOCAL_SMTP_HOSTS.has(smtpHost)) {
apps/api/src/lib/env-validation.ts:87:        errors.push(`SMTP_HOST="${smtpHost}" is forbidden when APP_ENV=vps`);
apps/api/src/lib/env-validation.ts:89:      if (smtpHost !== BREVO_SMTP_HOST) {
apps/api/src/lib/env-validation.ts:90:        errors.push(`SMTP_HOST must be "${BREVO_SMTP_HOST}" when APP_ENV=vps`);
apps/api/src/modules/security/security.health.ts:13:const BREVO_SMTP_HOST = 'smtp-relay.brevo.com';
apps/api/src/modules/security/security.health.ts:14:const LOCAL_SMTP_HOSTS = new Set(['mailpit', 'localhost', '127.0.0.1']);
apps/api/src/modules/security/security.health.ts:45:    const smtpHost = String(process.env.SMTP_HOST ?? '').trim().toLowerCase();
apps/api/src/modules/security/security.health.ts:54:      LOCAL_SMTP_HOSTS.has(smtpHost) ||
apps/api/src/modules/security/security.health.ts:55:      smtpHost !== BREVO_SMTP_HOST ||
SECURITY_ALERT_SYSTEM.md:209:SMTP_HOST=smtp.example.com
docker-compose.pre-vps.yml:145:      SMTP_HOST:    mailpit
docker-compose.yml:81:      SMTP_HOST: mailpit
docker-compose.yml:128:      SMTP_HOST: mailpit
docs/runbooks/vps-runtime.md:180:6. **SMTP** : configurer Brevo (`SMTP_HOST=smtp-relay.brevo.com`, auth obligatoire, aucun `SMTP_ALLOW_NO_AUTH`)
.env.example:74:SMTP_HOST=localhost
docs/changelog.md:129:SMTP_HOST=smtp.example.com
docs/ci-e2e.md:86:- “nodemailer not available” → en dev, on a Mailpit. `.env` doit inclure `SMTP_HOST=localhost`, `SMTP_PORT=1025`, `SMTP_ALLOW_NO_AUTH=true`.
apps/api/src/lib/mailer.ts:19:  const host = process.env.SMTP_HOST;
.env.pre-vps.example:65:SMTP_HOST=mailpit
```

## Grep complet `BREVO`

```text
README.md:1086:Mailpit ne doit pas être utilisé en VPS/pré-prod réelle: utiliser Brevo via `.env.vps` et `docker-compose.vps.yml`.
.env.vps.example:71:# ─── SMTP / Brevo (OBLIGATOIRE en VPS réel) ──────────────────────────────────
.env.vps.example:72:# Cible imposée en VPS/pré-prod réelle : Brevo SMTP relay.
.env.vps.example:74:# Brevo TLS explicite :
.env.vps.example:77:SMTP_HOST=smtp-relay.brevo.com
.env.vps.example:79:SMTP_USER=7xxxxxx@smtp-brevo.com
.env.vps.example:80:SMTP_PASS=CHANGEME_brevo_smtp_key
.github/workflows/ci.yml:541:      # Ce job ne valide pas la parité SMTP VPS/Brevo.
scripts/check-vps-env.sh:13:#   - SMTP Brevo obligatoire, authentifié, sans fallback Mailpit
scripts/check-vps-env.sh:196:# ─── SMTP / Brevo ─────────────────────────────────────────────────────────────
scripts/check-vps-env.sh:197:echo "--- SMTP / Brevo ---"
scripts/check-vps-env.sh:203:if [ "${SMTP_HOST:-}" != "smtp-relay.brevo.com" ]; then
scripts/check-vps-env.sh:204:  log_err "SMTP_HOST doit valoir 'smtp-relay.brevo.com' en VPS (valeur actuelle: ${SMTP_HOST:-<vide>})"
ROADMAP.md:190:- [x] **2026-05-12 — SMTP VPS durci** : Mailpit retiré de `docker-compose.vps.yml`, `.env.vps.example` basculé sur Brevo SMTP relay, validation/healthcheck SMTP VPS ajoutés et `forgot-password` limité par email comme `resend-verification`.
apps/api/src/lib/env-validation.ts:20:const BREVO_SMTP_HOST = 'smtp-relay.brevo.com';
apps/api/src/lib/env-validation.ts:89:      if (smtpHost !== BREVO_SMTP_HOST) {
apps/api/src/lib/env-validation.ts:90:        errors.push(`SMTP_HOST must be "${BREVO_SMTP_HOST}" when APP_ENV=vps`);
docs/runbooks/pre-vps-runbook.md:274:- [ ] Configurer Brevo SMTP réel (`smtp-relay.brevo.com`, auth obligatoire, pas Mailpit)
apps/api/src/modules/security/security.health.ts:13:const BREVO_SMTP_HOST = 'smtp-relay.brevo.com';
apps/api/src/modules/security/security.health.ts:55:      smtpHost !== BREVO_SMTP_HOST ||
docker-compose.vps.yml:141:      # SMTP: la cible réelle est fournie par .env.vps (Brevo en VPS/pré-prod réelle).
docker-compose.pre-vps.yml:119:  # sans dépendance Brevo ni émission de vrais emails.
docs/runbooks/vps-runtime.md:180:6. **SMTP** : configurer Brevo (`SMTP_HOST=smtp-relay.brevo.com`, auth obligatoire, aucun `SMTP_ALLOW_NO_AUTH`)
docs/runbooks/vps-runtime.md:194:| Fallback silencieux vers Mailpit | `docker-compose.vps.yml` n'embarque aucun service Mailpit; `check-vps-env.sh` + `validateProductionEnv()` imposent Brevo SMTP authentifié |
```

## Grep complet `smtp`

```text
docs/testing/active-user-simulation.md:31:- SMTP redirigé vers `127.0.0.1:1025` en E2E.
scripts/run-active-user-load.mjs:60:  const smtpHost = String(process.env.SMTP_HOST || '').trim().toLowerCase();
scripts/run-active-user-load.mjs:61:  if (smtpHost && !['localhost', '127.0.0.1', 'mailpit'].includes(smtpHost)) {
scripts/run-active-user-load.mjs:62:    fail(`SMTP_HOST non sûr pour la charge: ${smtpHost}`);
apps/web/playwright.config.ts:15:  SMTP_HOST: '127.0.0.1',
apps/web/playwright.config.ts:16:  SMTP_PORT: '1025',
apps/web/playwright.config.ts:17:  SMTP_ALLOW_NO_AUTH: 'true',
apps/web/playwright.config.ts:18:  SMTP_USER: '',
apps/web/playwright.config.ts:19:  SMTP_PASS: '',
docs/audit-notification-system.md:281:7. Emails de notification (infrastructure SMTP à configurer)
playwright.auth-verify.config.ts:46:            SMTP_HOST: '127.0.0.1',
playwright.auth-verify.config.ts:47:            SMTP_PORT: '1025',
playwright.auth-verify.config.ts:48:            SMTP_ALLOW_NO_AUTH: 'true',
playwright.auth-verify.config.ts:49:            SMTP_USER: '',
playwright.auth-verify.config.ts:50:            SMTP_PASS: '',
playwright.config.ts:19:  SMTP_HOST: '127.0.0.1',
playwright.config.ts:20:  SMTP_PORT: '1025',
playwright.config.ts:21:  SMTP_ALLOW_NO_AUTH: 'true',
playwright.config.ts:22:  SMTP_USER: '',
playwright.config.ts:23:  SMTP_PASS: '',
README.md:307:# Configuration SMTP (Mailpit local/dev uniquement)
README.md:308:SMTP_HOST=localhost
README.md:309:SMTP_PORT=1025
README.md:310:SMTP_SECURE=false
README.md:311:SMTP_USER=
README.md:312:SMTP_PASS=
README.md:1082:- `.env` déjà prêt pour Mailpit: `SMTP_HOST=localhost`, `SMTP_PORT=1025`, `SMTP_SECURE=false`.
README.md:1088:Sans SMTP actif, l’API continue de fonctionner et ignore l’envoi (log d’info seulement).
scripts/check-vps-env.sh:13:#   - SMTP Brevo obligatoire, authentifié, sans fallback Mailpit
scripts/check-vps-env.sh:196:# ─── SMTP / Brevo ─────────────────────────────────────────────────────────────
scripts/check-vps-env.sh:197:echo "--- SMTP / Brevo ---"
scripts/check-vps-env.sh:198:require_var "SMTP_HOST"
scripts/check-vps-env.sh:199:require_var "SMTP_PORT"
scripts/check-vps-env.sh:200:require_var "SMTP_USER"
scripts/check-vps-env.sh:201:require_var "SMTP_PASS" 8
scripts/check-vps-env.sh:202:require_var "SMTP_FROM"
scripts/check-vps-env.sh:203:if [ "${SMTP_HOST:-}" != "smtp-relay.brevo.com" ]; then
scripts/check-vps-env.sh:204:  log_err "SMTP_HOST doit valoir 'smtp-relay.brevo.com' en VPS (valeur actuelle: ${SMTP_HOST:-<vide>})"
scripts/check-vps-env.sh:207:if [ "${SMTP_PORT:-}" != "587" ] && [ "${SMTP_PORT:-}" != "465" ]; then
scripts/check-vps-env.sh:208:  log_err "SMTP_PORT doit valoir 587 ou 465 en VPS (valeur actuelle: ${SMTP_PORT:-<vide>})"
scripts/check-vps-env.sh:211:if [ "${SMTP_ALLOW_NO_AUTH:-}" = "true" ] || [ "${SMTP_ALLOW_NO_AUTH:-}" = "1" ]; then
scripts/check-vps-env.sh:212:  log_err "SMTP_ALLOW_NO_AUTH ne doit jamais être activé en VPS"
scripts/check-vps-env.sh:215:must_not_contain "SMTP_HOST" "^mailpit$"
scripts/check-vps-env.sh:216:must_not_contain "SMTP_HOST" "^localhost$"
scripts/check-vps-env.sh:217:must_not_contain "SMTP_HOST" "^127\\.0\\.0\\.1$"
.github/workflows/ci.yml:541:      # Ce job ne valide pas la parité SMTP VPS/Brevo.
ROADMAP.md:190:- [x] **2026-05-12 — SMTP VPS durci** : Mailpit retiré de `docker-compose.vps.yml`, `.env.vps.example` basculé sur Brevo SMTP relay, validation/healthcheck SMTP VPS ajoutés et `forgot-password` limité par email comme `resend-verification`.
.env.vps.example:71:# ─── SMTP / Brevo (OBLIGATOIRE en VPS réel) ──────────────────────────────────
.env.vps.example:72:# Cible imposée en VPS/pré-prod réelle : Brevo SMTP relay.
.env.vps.example:75:#   - port 587  => SMTP_SECURE=false
.env.vps.example:76:#   - port 465  => SMTP_SECURE=true
.env.vps.example:77:SMTP_HOST=smtp-relay.brevo.com
.env.vps.example:78:SMTP_PORT=587
.env.vps.example:79:SMTP_USER=7xxxxxx@smtp-brevo.com
.env.vps.example:80:SMTP_PASS=CHANGEME_brevo_smtp_key
.env.vps.example:81:SMTP_SECURE=false
.env.vps.example:82:SMTP_FROM=no-reply@blobinfini.local
docs/runbooks/pre-vps-runbook.md:274:- [ ] Configurer Brevo SMTP réel (`smtp-relay.brevo.com`, auth obligatoire, pas Mailpit)
apps/api/src/lib/env-validation.ts:20:const BREVO_SMTP_HOST = 'smtp-relay.brevo.com';
apps/api/src/lib/env-validation.ts:21:const LOCAL_SMTP_HOSTS = new Set(['mailpit', 'localhost', '127.0.0.1']);
apps/api/src/lib/env-validation.ts:76:    const smtpHost = String(process.env.SMTP_HOST ?? '').trim().toLowerCase();
apps/api/src/lib/env-validation.ts:77:    const smtpPort = String(process.env.SMTP_PORT ?? '').trim();
apps/api/src/lib/env-validation.ts:78:    const smtpUser = String(process.env.SMTP_USER ?? '').trim();
apps/api/src/lib/env-validation.ts:79:    const smtpPass = String(process.env.SMTP_PASS ?? '').trim();
apps/api/src/lib/env-validation.ts:80:    const smtpFrom = String(process.env.SMTP_FROM ?? '').trim();
apps/api/src/lib/env-validation.ts:81:    const smtpAllowNoAuth = String(process.env.SMTP_ALLOW_NO_AUTH ?? '').trim().toLowerCase();
apps/api/src/lib/env-validation.ts:83:    if (!smtpHost) {
apps/api/src/lib/env-validation.ts:84:      errors.push('SMTP_HOST is required when APP_ENV=vps');
apps/api/src/lib/env-validation.ts:86:      if (LOCAL_SMTP_HOSTS.has(smtpHost)) {
apps/api/src/lib/env-validation.ts:87:        errors.push(`SMTP_HOST="${smtpHost}" is forbidden when APP_ENV=vps`);
apps/api/src/lib/env-validation.ts:89:      if (smtpHost !== BREVO_SMTP_HOST) {
apps/api/src/lib/env-validation.ts:90:        errors.push(`SMTP_HOST must be "${BREVO_SMTP_HOST}" when APP_ENV=vps`);
apps/api/src/lib/env-validation.ts:94:    if (!['465', '587'].includes(smtpPort)) {
apps/api/src/lib/env-validation.ts:95:      errors.push('SMTP_PORT must be 465 or 587 when APP_ENV=vps');
apps/api/src/lib/env-validation.ts:97:    if (!smtpUser) {
apps/api/src/lib/env-validation.ts:98:      errors.push('SMTP_USER is required when APP_ENV=vps');
apps/api/src/lib/env-validation.ts:100:    if (!smtpPass) {
apps/api/src/lib/env-validation.ts:101:      errors.push('SMTP_PASS is required when APP_ENV=vps');
apps/api/src/lib/env-validation.ts:103:    if (!smtpFrom) {
apps/api/src/lib/env-validation.ts:104:      errors.push('SMTP_FROM is required when APP_ENV=vps');
apps/api/src/lib/env-validation.ts:106:    if (['1', 'true', 'yes', 'on'].includes(smtpAllowNoAuth)) {
apps/api/src/lib/env-validation.ts:107:      errors.push('SMTP_ALLOW_NO_AUTH=true is forbidden when APP_ENV=vps');
docker-compose.pre-vps.yml:145:      SMTP_HOST:    mailpit
docker-compose.pre-vps.yml:146:      SMTP_PORT:    "1025"
apps/api/src/modules/security/security.health.ts:13:const BREVO_SMTP_HOST = 'smtp-relay.brevo.com';
apps/api/src/modules/security/security.health.ts:14:const LOCAL_SMTP_HOSTS = new Set(['mailpit', 'localhost', '127.0.0.1']);
apps/api/src/modules/security/security.health.ts:45:    const smtpHost = String(process.env.SMTP_HOST ?? '').trim().toLowerCase();
apps/api/src/modules/security/security.health.ts:46:    const smtpPort = String(process.env.SMTP_PORT ?? '').trim();
apps/api/src/modules/security/security.health.ts:47:    const smtpUser = String(process.env.SMTP_USER ?? '').trim();
apps/api/src/modules/security/security.health.ts:48:    const smtpPass = String(process.env.SMTP_PASS ?? '').trim();
apps/api/src/modules/security/security.health.ts:49:    const smtpFrom = String(process.env.SMTP_FROM ?? '').trim();
apps/api/src/modules/security/security.health.ts:50:    const smtpAllowNoAuth = String(process.env.SMTP_ALLOW_NO_AUTH ?? '').trim().toLowerCase();
apps/api/src/modules/security/security.health.ts:53:      !smtpHost ||
apps/api/src/modules/security/security.health.ts:54:      LOCAL_SMTP_HOSTS.has(smtpHost) ||
apps/api/src/modules/security/security.health.ts:55:      smtpHost !== BREVO_SMTP_HOST ||
apps/api/src/modules/security/security.health.ts:56:      !['465', '587'].includes(smtpPort) ||
apps/api/src/modules/security/security.health.ts:57:      !smtpUser ||
apps/api/src/modules/security/security.health.ts:58:      !smtpPass ||
apps/api/src/modules/security/security.health.ts:59:      !smtpFrom ||
apps/api/src/modules/security/security.health.ts:60:      ['1', 'true', 'yes', 'on'].includes(smtpAllowNoAuth)
docker-compose.vps.yml:141:      # SMTP: la cible réelle est fournie par .env.vps (Brevo en VPS/pré-prod réelle).
SECURITY_ALERT_SYSTEM.md:89:│   systemAlert    │      │   (SMTP/nodemailer) │
SECURITY_ALERT_SYSTEM.md:208:# Configuration SMTP pour l'envoi des emails
SECURITY_ALERT_SYSTEM.md:209:SMTP_HOST=smtp.example.com
SECURITY_ALERT_SYSTEM.md:210:SMTP_PORT=587
SECURITY_ALERT_SYSTEM.md:211:SMTP_USER=noreply@blobconnect.com
SECURITY_ALERT_SYSTEM.md:212:SMTP_PASS=your-password
SECURITY_ALERT_SYSTEM.md:213:SMTP_FROM=security@blobconnect.com
SECURITY_ALERT_SYSTEM.md:214:SMTP_SECURE=true  # true pour port 465, false pour 587
SECURITY_ALERT_SYSTEM.md:220:### Comportement sans SMTP
SECURITY_ALERT_SYSTEM.md:222:Si SMTP n'est pas configuré :
docs/changelog.md:129:SMTP_HOST=smtp.example.com
docs/changelog.md:130:SMTP_PORT=587
docs/changelog.md:131:SMTP_USER=noreply@blobinfini.com
docs/changelog.md:132:SMTP_PASSWORD=xxx
docker-compose.yml:65:      - "127.0.0.1:${MAILPIT_SMTP_PORT:-1025}:1025"
docker-compose.yml:81:      SMTP_HOST: mailpit
docker-compose.yml:128:      SMTP_HOST: mailpit
docs/runbooks/vps-runtime.md:180:6. **SMTP** : configurer Brevo (`SMTP_HOST=smtp-relay.brevo.com`, auth obligatoire, aucun `SMTP_ALLOW_NO_AUTH`)
docs/runbooks/vps-runtime.md:194:| Fallback silencieux vers Mailpit | `docker-compose.vps.yml` n'embarque aucun service Mailpit; `check-vps-env.sh` + `validateProductionEnv()` imposent Brevo SMTP authentifié |
docs/ci-e2e.md:86:- “nodemailer not available” → en dev, on a Mailpit. `.env` doit inclure `SMTP_HOST=localhost`, `SMTP_PORT=1025`, `SMTP_ALLOW_NO_AUTH=true`.
.env.example:66:# SMTP (optionnel pour envoi d’emails)
.env.example:69:#  - SMTP: localhost:1025 (sans auth)
.env.example:72:# NE PAS changer SMTP_PORT ici — l’API Docker se connecte à mailpit:1025 en réseau interne.
.env.example:74:SMTP_HOST=localhost
.env.example:75:SMTP_PORT=1025
.env.example:76:SMTP_USER=
.env.example:77:SMTP_PASS=
.env.example:78:SMTP_SECURE=false
.env.example:79:SMTP_FROM=no-reply@localhost
.env.example:80:SMTP_ALLOW_NO_AUTH=true # Permet l'envoi sans login/password (Mailpit en dev)
.env.pre-vps.example:62:# ─── SMTP (Mailpit docker interne, pré-VPS local uniquement) ─────────────────
.env.pre-vps.example:65:SMTP_HOST=mailpit
.env.pre-vps.example:66:SMTP_PORT=1025
.env.pre-vps.example:67:SMTP_USER=
.env.pre-vps.example:68:SMTP_PASS=
.env.pre-vps.example:69:SMTP_SECURE=false
.env.pre-vps.example:70:SMTP_FROM=no-reply@pre-vps.blobinfini.local
.env.pre-vps.example:71:SMTP_ALLOW_NO_AUTH=true
apps/api/src/lib/mailer.ts:3: * VPS runtime must fail loud on SMTP misconfiguration or missing transport.
apps/api/src/lib/mailer.ts:18:function getSmtpConfig() {
apps/api/src/lib/mailer.ts:19:  const host = process.env.SMTP_HOST;
apps/api/src/lib/mailer.ts:20:  const port = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 587;
apps/api/src/lib/mailer.ts:21:  const user = process.env.SMTP_USER;
apps/api/src/lib/mailer.ts:22:  const pass = process.env.SMTP_PASS;
apps/api/src/lib/mailer.ts:23:  const secure = String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true';
apps/api/src/lib/mailer.ts:24:  const from = process.env.SMTP_FROM || 'no-reply@localhost';
apps/api/src/lib/mailer.ts:28:  // Dev/pre-VPS only: explicit opt-in for unauthenticated SMTP targets such as Mailpit.
apps/api/src/lib/mailer.ts:29:  const allowNoAuth = String(process.env.SMTP_ALLOW_NO_AUTH || '').toLowerCase() === 'true';
apps/api/src/lib/mailer.ts:39:  const cfg = getSmtpConfig();
apps/api/src/lib/mailer.ts:42:      throw new Error('SMTP configuration is invalid for VPS runtime');
```

## Points saillants

- `docker-compose.vps.yml` ne contient plus aucun service `mailpit`.
- `.env.vps.example` cible désormais explicitement Brevo (`smtp-relay.brevo.com`).
- `check-vps-env.sh`, `validateProductionEnv()` et `/security/health` font échouer la config VPS si SMTP dérive vers Mailpit/localhost, si l'auth SMTP est absente, ou si `SMTP_ALLOW_NO_AUTH=true`.
- `POST /auth/forgot-password` est désormais rate-limit par email, comme `POST /auth/resend-verification`.
- Mailpit reste présent uniquement en local/dev, pré-VPS local de qualification, Playwright email-link, et CI E2E locale.
