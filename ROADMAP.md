# Blob — Roadmap 2026

Ce document est la roadmap opérationnelle actuelle. Il remplace les anciennes
listes accumulées autour de BlobConnect, Blobinfini, Clever Cloud, Vercel,
booking et Stripe.

Règle de preuve : un chantier n'est marqué **Terminé** que si une preuve existe
dans le dépôt, hors roadmap. Sinon il reste **Partiellement réalisé** ou
**À confirmer**.

## 1. Vision Produit

- **Blob** est le nom visible utilisateur dans l'interface, les emails, les pages publiques et le wording marketing.
- **blobsurf.com** est le domaine public actuel documenté pour le déploiement.
- Blob est une plateforme de mise en relation surf/kite, pas une marketplace transactionnelle.
- Le MVP actuel couvre la demande de cours, la découverte géolocalisée, la consultation de profils, la demande de contact et la messagerie.
- Le paiement, la réservation orchestrée, les créneaux transactionnels et Stripe actif sont hors scope MVP.
- La Blobosphère reste un levier de visibilité SEO, contenu éditorial et acquisition communautaire.
- Le territoire pilote est **Hourtin, Carcans, Lacanau** (Médoc Atlantique). Le bassin d'acquisition principal est **Bordeaux Métropole**.
- **Blob est d'abord une communauté surf & kite locale.** Le matching, les pros, la BlobMap, les guides et les promotions sont au service de cette communauté.
- L'extension nationale est post-pilot : le MVP ne vise pas un déploiement national immédiat.

Sources de vérité produit :

- `README.md`
- `docs/product-positioning.md`

Vocabulaire canonique 2026 :

| Terme | Usage |
|---|---|
| Blob | Nom produit visible utilisateur |
| BlobSurf / blobsurf.com | Domaine public et contexte de déploiement |
| BlobConnect | Historique / technique uniquement |
| Blobinfini | Legacy technique, packages et namespaces |
| booking | Legacy technique uniquement, pas wording produit |
| Stripe | Archive / hors scope MVP |

## 2. Architecture Actuelle

Infrastructure réellement prouvée par le dépôt :

| Composant | Statut | Preuve |
|---|---|---|
| Hetzner VPS | Terminé | `README.md`, `docs/ops/deploy-vps.md` |
| Docker Compose VPS | Terminé | `docker-compose.vps.yml`, `.github/workflows/deploy-vps.yml` |
| Caddy | Terminé | `docker-compose.vps.yml`, `docker/Caddyfile`, `scripts/guard-no-nginx-vps.sh` |
| PostgreSQL/PostGIS | Terminé | `docker-compose.vps.yml`, `.github/workflows/ci.yml` |
| Redis | Terminé | `docker-compose.vps.yml`, `scripts/smoke-test-vps.sh` |
| MinIO | Terminé | `docker-compose.vps.yml`, `docker/Caddyfile`, `scripts/smoke-test-vps.sh` |
| Brevo SMTP | Terminé | `.env.vps.example`, `apps/api/src/lib/env-validation.ts`, `apps/api/src/lib/mailer.ts` |
| Cloudflare R2 | Partiellement réalisé | `.env.vps.example`, `scripts/backup-encrypt-upload.sh`, `scripts/r2-rotate.sh`, `scripts/r2-restore-test.sh` |
| Cloudflare DNS/CDN/WAF | À confirmer | Aucune preuve de configuration effective dans le dépôt |

Domaines documentés :

- App/site : `https://blobsurf.com`
- API : `https://api.blobsurf.com`
- Stockage : `https://storage.blobsurf.com`

À ne pas réintroduire comme architecture principale :

- nginx pour le VPS
- Vercel comme chemin de production principal
- Clever Cloud comme provider de runtime principal
- Render, Railway, Fly.io sans décision explicite

## 3. Environnements

### Local

Statut : **Terminé** pour le socle de développement local.

Preuves :

- `docker-compose.yml`
- `.env.example`
- `README.md`
- `package.json`

Caractéristiques :

- Postgres/PostGIS, Redis, MinIO et Mailpit via Docker Compose.
- Mailpit est réservé au local/dev.
- Le frontend tourne localement, notamment via `pnpm run dev:web` et les scripts `dev:all` / `dev:all:docker`.

### Préproduction VPS privée

Statut : **Partiellement réalisé**.

Preuves :

- `docker-compose.vps.yml`
- `.env.vps.example`
- `scripts/vps-bootstrap.sh`
- `scripts/check-vps-env.sh`
- `scripts/smoke-test-vps.sh`
- `docs/ops/deploy-vps.md`

Constat :

- La stack VPS est définie et outillée.
- Le mode privé/préproduction, la restriction d'accès, la stratégie DNS et les canaux d'alerte ne sont pas encore prouvés de bout en bout dans le dépôt.
- Brevo doit être utilisé pour tout VPS réel. Mailpit ne doit pas être utilisé hors local/dev.

### Production publique

Statut : **À confirmer**.

Preuves disponibles :

- `docker/Caddyfile` documente les domaines `blobsurf.com`, `api.blobsurf.com`, `storage.blobsurf.com`.
- `docs/ops/monitoring-blobsurf.md` documente les monitors publics attendus.
- `.github/workflows/deploy-vps.yml` déploie `main` vers le VPS après CI verte.

Limite :

- Le dépôt ne prouve pas à lui seul que la production publique est officiellement lancée.
- La roadmap ne doit donc pas annoncer un lancement public tant qu'une preuve opérationnelle externe ou un runbook validé ne l'établit pas.

## 4. Chantiers Terminés

Le statut **Terminé** est réservé aux éléments prouvés par code, scripts,
workflows, compose ou documentation opérationnelle. Les éléments incomplets sont
classés ailleurs.

| Chantier | Statut | Preuve |
|---|---|---|
| CI GitHub Actions | Terminé | `.github/workflows/ci.yml` |
| Deploy VPS après CI verte | Terminé | `.github/workflows/deploy-vps.yml`, `docs/ops/deploy-vps.md` |
| Cible `docker-compose.vps.yml` | Terminé | `.github/workflows/deploy-vps.yml`, `docker-compose.vps.yml` |
| Caddy reverse proxy TLS | Terminé | `docker-compose.vps.yml`, `docker/Caddyfile` |
| Guard anti-nginx VPS | Terminé | `scripts/guard-no-nginx-vps.sh`, `.github/workflows/ci.yml` |
| PostgreSQL/PostGIS VPS | Terminé | `docker-compose.vps.yml`, `.github/workflows/ci.yml` |
| Redis VPS | Terminé | `docker-compose.vps.yml`, `scripts/smoke-test-vps.sh` |
| MinIO derrière Caddy | Terminé | `docker-compose.vps.yml`, `docker/Caddyfile`, `scripts/smoke-test-vps.sh` |
| Brevo obligatoire en VPS réel | Terminé | `.env.vps.example`, `apps/api/src/lib/env-validation.ts` |
| Mailpit local uniquement | Terminé | `.env.example`, `.env.vps.example`, `README.md` |
| Health checks conteneurs | Terminé | `docker-compose.vps.yml` |
| Smoke test VPS | Terminé | `scripts/smoke-test-vps.sh`, `.github/workflows/deploy-vps.yml` |
| `/health` API | Terminé | `apps/api/src/index.ts`, `apps/api/src/index.health.test.ts` |
| `/security/health` | Terminé | `apps/api/src/modules/security/security.controller.ts`, `scripts/security-health-check.sh`, `.github/workflows/security-health-monitor.yml` |
| `/internal/metrics` non-stub | Terminé | `apps/api/src/index.ts`, `scripts/check-metrics-not-stub.sh`, `.github/workflows/ci.yml` |
| Logging sécurisé minimal | Terminé | `apps/api/src/utils/secure-logger.ts`, `scripts/no-insecure-logs-check.sh` |
| Backup PostgreSQL local VPS | Terminé | `scripts/backup-blobsurf.sh`, `scripts/backup-pg.sh` |
| Restauration PostgreSQL dry-run | Terminé | `scripts/restore-blobsurf.sh`, `scripts/restore-pg.sh` |
| Chiffrement age des backups | Terminé | `scripts/setup-backup-keys.sh`, `scripts/backup-encrypt-upload.sh` |
| Upload Cloudflare R2 | Partiellement réalisé | `scripts/backup-encrypt-upload.sh`, `.env.vps.example` |
| Rotation R2 | Partiellement réalisé | `scripts/r2-rotate.sh`, `.env.vps.example` |
| Test restore R2 | Partiellement réalisé | `scripts/r2-restore-test.sh`, `scripts/test-backup-r2-local.sh` |
| Positionnement MVP sans booking transactionnel | Terminé | `docs/product-positioning.md`, `README.md` |

## 5. Chantiers P0

Les P0 sont les sujets qui peuvent bloquer ou fragiliser une exploitation VPS
réelle.

| Chantier | Statut | Pourquoi |
|---|---|---|
| PRA complet | À faire | Pas de document consolidé RTO/RPO, procédure live, rôles, validation périodique |
| Restauration complète | Partiellement réalisé | Dry-run PostgreSQL présent, restore complet R2 possible avec clé, restore MinIO non prouvé |
| Backup MinIO | À faire | `docs/ops/cron-blobsurf.cron` référence `scripts/backup-minio.sh`, fichier absent |
| Monitoring opérationnel | Partiellement réalisé | UptimeRobot documenté, health checks présents, mais scripts cron monitor absents |
| Alerting Discord | À confirmer | `DISCORD_WEBHOOK_URL` documenté, mais `scripts/alert.sh` absent |
| Scripts ops manquants | À faire | Plusieurs scripts référencés par `docs/ops/cron-blobsurf.cron` sont absents |
| Cohérence docs ops | À faire | `docs/ops/monitoring-blobsurf.md` référence encore `docker-compose.blobsurf.yml` alors que la cible déploiement est `docker-compose.vps.yml` |
| Vérification lancement production | À confirmer | Le dépôt documente les domaines, mais ne prouve pas le lancement public |

Scripts référencés mais absents au dernier audit :

- `scripts/backup-minio.sh`
- `scripts/disk-guard.sh`
- `scripts/health-monitor.sh`
- `scripts/weekly-restore-test.sh`
- `scripts/docker-cleanup.sh`
- `scripts/alert.sh`

Definition of Done P0 :

- PRA versionné avec RTO/RPO, matrice incidents, responsables et étapes de restauration.
- Test restore PostgreSQL complet et documenté.
- Stratégie restore MinIO documentée et testée.
- Alerting Discord ou équivalent prouvé par script versionné.
- Monitoring uptime + metrics + disque relié à un canal d'alerte.
- Cron ops aligné uniquement sur des scripts existants.

## 6. Chantiers P1

Les P1 soutiennent l'acquisition, la qualité du MVP et l'exploitation produit.

| Chantier | Statut | Objectif |
|---|---|---|
| SEO public Blob | À faire | Stabiliser pages publiques, métadonnées, contenus indexables |
| Blobosphère | Partiellement réalisé | Clarifier scope CMS, publication, SEO, analytics éditoriales |
| Onboarding pros | À faire | Fluidifier inscription, vérification, zone d'activité et activation |
| Analytics produit | Partiellement réalisé | Mesurer demande de cours, pros trouvés, contact, conversation, conversion |
| Cloudflare DNS/CDN/WAF | À confirmer | Distinguer DNS/CDN/WAF du R2 backup déjà partiellement outillé |
| Monétisation AdSense | À confirmer | Valider compte, variables, consentement, revenus et pages conformes |
| Sponsors surf/kite | À faire | Définir offre sponsors, pages, tracking et pipeline de prospection |
| Emails produit | Partiellement réalisé | Brevo technique prouvé, templates et contacts publics à confirmer |
| Documentation contributeur | Partiellement réalisé | README aligné, docs ops restantes à rationaliser |

Definition of Done P1 :

- Mesures analytics lisibles par l'équipe.
- Parcours pro testable sans intervention manuelle non documentée.
- Pages SEO et Blobosphère publiables avec règles éditoriales.
- Monétisation compatible RGPD et mesurable.
- Cloudflare DNS/CDN/WAF documenté avec statut réel.

## 7. Chantiers P2

Les P2 réduisent la dette documentaire et historique sans bloquer
l'exploitation immédiate.

| Chantier | Statut | Objectif |
|---|---|---|
| Nettoyage legacy naming | À faire | Réduire BlobConnect/Blobinfini hors zones techniques |
| Archivage historique | Partiellement réalisé | Conserver l'historique utile sans polluer la roadmap active |
| Rationalisation documentation | À faire | Éliminer doublons, chemins obsolètes, docs provider historiques |
| Harmonisation vocabulaire produit | À faire | Remplacer booking/réservation par demande de cours/contact en doc produit |
| Réduction TODO obsolètes | À faire | Supprimer les TODO fermés ou devenus non pertinents |
| Alignement docs ops | À faire | Synchroniser monitoring, deploy, runtime, backup, restore |

## 8. Vision Moyen Terme

La vision moyen terme ne doit pas masquer les P0. Elle devient pertinente une
fois la préproduction privée stable et le PRA prouvé.

Axes :

- **Communauté** : renforcer l'entraide surf & kite du Médoc Atlantique (Hourtin, Carcans, Lacanau), contenus locaux, confiance et sécurité des sessions. Extension nationale post-pilot.
- **Blob IA** : assistance à la modération, aide éditoriale Blobosphère, support utilisateur et synthèse d'analytics, sans automatiser des décisions sensibles sans revue.
- **Croissance** : SEO, Blobosphère, onboarding pros, activation locale et mesure conversion.
- **Partenariats** : écoles, moniteurs indépendants, marques surf/kite, événements locaux.
- **Sponsors** : offres sponsors non intrusives, compatibles RGPD et alignées avec le positionnement associatif.

Hypothèses futures à garder exploratoires :

- Abonnement pro.
- Visibilité sponsorisée.
- Outils de prospection avancés.
- Fonctionnalités IA utilisateur.

À ne pas réintroduire sans décision produit explicite :

- Paiement intégré.
- Réservation orchestrée.
- Calendrier transactionnel.
- Commission ou escrow.
- Stripe actif dans le MVP.

## 9. Archive Historique

Cette section conserve le contexte utile sans le laisser piloter les priorités
2026.

| Élément | Statut historique | Décision |
|---|---|---|
| BlobConnect | Ancien nom produit / technique | Ne plus utiliser en wording visible, conserver pour contexte historique |
| Blobinfini | Legacy technique | Conserver dans packages, namespaces, buckets ou placeholders tant que non renommés |
| blobevolution / blobevolutionClaudeCodex | Historique projet / nom dépôt | Ne pas renommer en masse sans ticket dédié |
| Clever Cloud | Ancien chemin envisagé | Archivé, pas provider principal |
| Vercel | Ancien chemin frontend | Archivé, pas chemin production principal |
| nginx | Ancien reverse proxy VPS | Archivé, Caddy est la cible VPS |
| booking | Legacy technique | Acceptable dans code/routes/migrations historiques, interdit comme promesse produit active |
| réservation orchestrée | Hors scope MVP | À éviter hors archive |
| Stripe | Hors scope MVP | À conserver uniquement comme hypothèse post-MVP |
| paiement intégré | Hors scope MVP | À ne pas planifier sans validation produit explicite |

Anciennes informations à ne plus utiliser comme priorités actives :

- Scores santé historiques.
- Comptages de tests anciens.
- Répartitions agent Claude/Codex anciennes.
- Estimations Clever Cloud ou Vercel.
- TODO fermés ou non prouvés par le dépôt.
- Listes longues de tâches déjà traitées ailleurs.

## Suivi de Mise à Jour

- Dernière refonte roadmap : 2026-05-31 (ajout territoire pilote Médoc Atlantique + positionnement communauté locale).
- Source principale produit : `README.md` et `docs/product-positioning.md`.
- Source principale infrastructure : `docker-compose.vps.yml`, `docker/Caddyfile`, `.github/workflows/deploy-vps.yml`.
- Source principale ops : `docs/ops/deploy-vps.md`, `docs/ops/monitoring-blobsurf.md`, `scripts/*backup*`, `scripts/*restore*`, `scripts/security-health-check.sh`.
