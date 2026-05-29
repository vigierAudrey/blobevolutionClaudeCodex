# 📚 Documentation Blobinfini

Index complet de la documentation technique et métier du projet Blobinfini.

## 🎯 Documents Essentiels (Racine du Projet)

Ces fichiers sont à la racine pour une visibilité maximale :

| Fichier | Description | Audience |
|---------|-------------|----------|
| **[README.md](../README.md)** | Documentation principale du projet | 👤 Tous |
| **[AGENTS.md](../AGENTS.md)** | Gouvernance IA (Codex + Claude Code) | 🤖 IA |
| **[claude.md](../claude.md)** | Guide complet pour les IA | 🤖 IA |
| **[ROADMAP.md](../ROADMAP.md)** | Vision et priorités produit | 📈 Product |
| **[SECURITY.md](../SECURITY.md)** | Politique de sécurité GitHub | 🔒 Security |

---

## 📁 Documentation par Catégorie

### 🏢 Business & Stratégie

| Document | Description |
|----------|-------------|
| **[business-model.md](business-model.md)** ⭐ | Modèle économique : Association loi 1901, publicité, sponsors, offres partenaires |

**Contenu clé** :
- Statut juridique : Association loi 1901
- Revenus MVP : Publicité Google Adsense
- Phase 2 : Sponsors surf/kite (packages Bronze → Platinum)
- Phase 3 : Marketplace offres partenaires
- KPIs, pitch sponsors, contacts marques

---

### 🔒 Sécurité & RGPD

| Document | Description |
|----------|-------------|
| **[blobosphere.md](blobosphere.md)** | Guide Blobosphère avec **focus RGPD renforcé** |

**Sections critiques** :
- 🇫🇷 Conformité RGPD obligatoire (CNIL)
- Consentement publicité et cookies
- Durées de conservation des données
- Droit à l'oubli (soft delete 30j)
- Checklist sécurité avant déploiement

**Audits de sécurité** (dossier `/audits`) :
- [security-audit-pro-profile-2025-12.md](audits/security-audit-pro-profile-2025-12.md) - Audit sécurité page profil PRO (Déc 2025)
- [pro-profile-security-patch-2025-12.txt](audits/pro-profile-security-patch-2025-12.txt) - Patch correctifs profil PRO (Déc 2025)
- [ACTIONS_URGENTES_PRO_PROFILE.sh](audits/ACTIONS_URGENTES_PRO_PROFILE.sh) - Script d'actions urgentes (Déc 2025)

**Synthèses d'audit récentes** (racine du repo) :
- [AUDIT_SUMMARY_2025-12-08.md](../AUDIT_SUMMARY_2025-12-08.md) - Audit isolation des rôles (Déc 2025)
- [SECURITY_EXECUTIVE_SUMMARY_2025-12-08.md](../SECURITY_EXECUTIVE_SUMMARY_2025-12-08.md) - Résumé exécutif sécurité (Déc 2025)

---

### 📊 Analytics & Observabilite

| Document | Description |
|----------|-------------|
| **[analytics-definitions.md](analytics-definitions.md)** | Definitions exactes des KPIs analytics (RGPD-safe) |

---

### 🚀 Déploiement & Infrastructure

| Document | Description |
|----------|-------------|
| **[ops/deploy-vps.md](ops/deploy-vps.md)** | Runbook déploiement automatique GitHub Actions → VPS |
| **[runbooks/vps-runtime.md](runbooks/vps-runtime.md)** | Exploitation runtime VPS Hetzner + Docker Compose + Caddy |
| **[deployment.md](deployment.md)** | Document déprécié, redirige vers le runbook VPS actuel |
| **[adsense-deployment.md](adsense-deployment.md)** | Checklist déploiement Google AdSense sur domaine servi par le VPS |
| **[monitoring.md](monitoring.md)** | Outils monitoring gratuits |

**Déploiement** :
- GitHub Actions `CI` puis `Deploy VPS`
- Stack `docker-compose.vps.yml`
- Reverse proxy Caddy (`docker/Caddyfile`)
- Smoke test `scripts/smoke-test-vps.sh`

**AdSense** :
- Inscription compte Google AdSense
- Configuration DNS et domaine
- Standards Google (meta, titles, mobile-friendly)
- Intégration code + consentement RGPD

---

### 🧪 Tests & Qualité

| Document | Description |
|----------|-------------|
| **[testing.md](testing.md)** | Guide tests (Jest, Playwright, E2E) |
| **[adsense-testing.md](adsense-testing.md)** | Tests publicité en local |
| **[ci-e2e.md](ci-e2e.md)** | Tests end-to-end et CI/CD |
| **[storybook.md](storybook.md)** | Guide Storybook composants UI |

**Couverture** :
- Tests unitaires (Jest)
- Tests E2E (Playwright)
- Tests visuels (Storybook)
- CI/CD automatisé

---

### 🛠️ Technique & Architecture

| Document | Description |
|----------|-------------|
| **[matching-system.md](matching-system.md)** ⭐ | Système de matching complet (riders, critères, géoloc) |
| **[mcp-config.md](mcp-config.md)** | Configuration MCP pour IA (GitHub, Sentry, Playwright) |
| **[changelog.md](changelog.md)** | Historique détaillé des changements |
| **[migration-prisma6.md](migration-prisma6.md)** | Guide migration Prisma 5 → 6 |

**MCP (Model Context Protocol)** :
- Configuration Claude Code (CLI)
- Configuration Claude Desktop (App)
- Serveurs disponibles selon l'environnement local : GitHub, Sentry, Playwright, Context7, Chrome DevTools
- Obtention des tokens

---

## 🗂️ Structure Complète

```
docs/
├── README.md                          # ⭐ Ce fichier (index)
│
├── 🏢 Business & Stratégie
│   └── business-model.md              # Modèle économique complet
│
├── 🔒 Sécurité & RGPD
│   ├── blobosphere.md                 # Guide Blobosphère + RGPD
│   ├── analytics-definitions.md       # Definitions KPIs analytics
│   └── audits/
│       ├── security-audit-pro-profile-2025-12.md  # Audit sécurité profil PRO
│       ├── pro-profile-security-patch-2025-12.txt # Patch correctifs profil PRO
│       └── ACTIONS_URGENTES_PRO_PROFILE.sh        # Script actions urgentes
│
├── 🚀 Déploiement & Infra
│   ├── deployment.md                  # Document déprécié, redirection VPS
│   ├── ops/deploy-vps.md              # Déploiement automatique VPS
│   ├── runbooks/vps-runtime.md        # Runtime VPS Hetzner + Caddy
│   ├── adsense-deployment.md          # Déploiement AdSense
│   └── monitoring.md                  # Monitoring gratuit
│
├── 🧪 Tests & Qualité
│   ├── testing.md                     # Guide tests général
│   ├── adsense-testing.md             # Tests publicité
│   ├── ci-e2e.md                      # Tests E2E + CI/CD
│   └── storybook.md                   # Storybook UI
│
└── 🛠️ Technique
    ├── matching-system.md             # ⭐ Système matching complet
    ├── mcp-config.md                  # Config MCP pour IA
    ├── changelog.md                   # Historique changements
    └── migration-prisma6.md           # Migration Prisma 6
```

---

## 🎯 Guide d'Utilisation

### Pour les Développeurs

1. **Setup initial** → [README.md](../README.md)
2. **Architecture** → [claude.md](../claude.md) sections "Architecture Technique" et "Patterns de Code"
3. **Tests** → [testing.md](testing.md)
4. **Sécurité** → [SECURITY.md](../SECURITY.md) + [AUDIT_SUMMARY_2025-12-08.md](../AUDIT_SUMMARY_2025-12-08.md) + [audits/security-audit-pro-profile-2025-12.md](audits/security-audit-pro-profile-2025-12.md)

### Pour les IA (Codex, Claude Code)

1. **Instructions générales** → [AGENTS.md](../AGENTS.md)
2. **Guide complet** → [claude.md](../claude.md)
3. **MCP** → [mcp-config.md](mcp-config.md)
4. **Modèle économique** → [business-model.md](business-model.md)

### Pour les Product Owners

1. **Roadmap** → [ROADMAP.md](../ROADMAP.md)
2. **Modèle économique** → [business-model.md](business-model.md)
3. **Historique** → [changelog.md](changelog.md)

### Pour les Ops/DevOps

1. **Déploiement VPS** → [ops/deploy-vps.md](ops/deploy-vps.md)
2. **Runtime VPS** → [runbooks/vps-runtime.md](runbooks/vps-runtime.md)
3. **Monitoring** → [monitoring.md](monitoring.md)
4. **Sécurité** → [SECURITY.md](../SECURITY.md)

---

## 🔗 Ressources Externes

### Documentation technique

- [PostGIS Spatial](https://postgis.net/docs/)
- [Socket.IO Rooms](https://socket.io/docs/v4/rooms/)
- [Prisma Relations](https://www.prisma.io/docs/concepts/components/prisma-schema/relations)
- [JWT Best Practices](https://datatracker.ietf.org/doc/html/rfc8725)
- [Google Adsense Policies](https://support.google.com/adsense/answer/48182)

### RGPD & Sécurité 🇫🇷

- [CNIL - Guide RGPD du développeur](https://www.cnil.fr/fr/guide-rgpd-du-developpeur)
- [CNIL - Cookies et traceurs](https://www.cnil.fr/fr/cookies-et-autres-traceurs)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [ANSSI - Bonnes pratiques](https://www.ssi.gouv.fr/)

### Association loi 1901

- [Service-Public - Créer une association](https://www.service-public.fr/associations/vosdroits/F1119)
- [Associations.gouv.fr - RNA](https://www.associations.gouv.fr/)
- [Légifrance - Loi 1901](https://www.legifrance.gouv.fr/loda/id/JORFTEXT000000497458/)

---

## 📝 Conventions

### Nomenclature fichiers

- **kebab-case** : `business-model.md`, `adsense-deployment.md`
- **Dates dans audits** : `security-audit-pro-profile-2025-12.md` (format YYYY-MM)
- **Préfixes clairs** : `adsense-`, `api-`, `security-`

### Structure documents

Tous les docs techniques suivent cette structure :

```markdown
# Titre Principal

> Note importante ou résumé

## Table des matières (si >500 lignes)

## Section 1
## Section 2
## Ressources

---

**Dernière mise à jour** : DD/MM/YYYY
```

---

## 🚀 Contribution

Pour ajouter ou modifier un document :

1. Respecter la structure ci-dessus
2. Ajouter dans le bon dossier (`audits/` pour audits)
3. Mettre à jour ce README.md (section correspondante)
4. Ajouter lien dans `claude.md` si pertinent pour IA
5. Commit avec message explicite : `docs(category): add/update document-name`

---

**Maintainers** : Équipe Blobinfini
**Dernière mise à jour** : 16/12/2025
