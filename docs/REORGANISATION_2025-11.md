# 📁 Réorganisation Documentation - 07/11/2025

Ce document trace la réorganisation complète de la documentation projet effectuée le 07/11/2025.

**Mise à jour (2025-01-17)** : les audits 2025-10/11 ont été supprimés lors du nettoyage. Les exemples ci-dessous reflètent les audits actifs.

## 🎯 Objectif

Clarifier la structure documentaire pour :
- ✅ Séparer les **documents de gouvernance IA** (racine) des **guides techniques** (docs/)
- ✅ Éliminer les doublons et redondances
- ✅ Archiver les audits temporaires
- ✅ Créer un index centralisé

## 📊 Avant / Après

### 📁 Racine du Projet

#### AVANT (18 fichiers .md)
```
❌ ADSENSE_DEPLOYMENT.md
❌ ADSENSE_READY_TO_DEPLOY.md
❌ ADSENSE_TESTING_GUIDE.md
✅ AGENTS.md                      → CONSERVÉ (gouvernance IA)
❌ API_CLIENT_AUDIT.md
❌ CLAUDE_CODE_IMPROVEMENTS.md
❌ DEPLOYMENT.md
❌ MONITORING_GRATUIT.md
❌ README_ADS.md
✅ README.md                      → CONSERVÉ (doc principale)
❌ READMESECURITY.md
❌ README_TESTS.md
✅ ROADMAP.md                     → CONSERVÉ (vision produit)
❌ ROADMAP_ADMIN.md
✅ SECURITY.md                    → CONSERVÉ (politique GitHub)
❌ SECURITY_FIXES.md
❌ VERCEL_BUILD_FIXES.md
✅ claude.md                      → CONSERVÉ (guide IA)
```

#### APRÈS (5 fichiers .md)
```
✅ AGENTS.md         → Gouvernance IA (Codex + Claude Code)
✅ README.md         → Documentation principale projet
✅ ROADMAP.md        → Vision et priorités produit
✅ SECURITY.md       → Politique de sécurité GitHub
✅ claude.md         → Guide complet pour les IA
```

---

### 📁 Dossier /docs

#### AVANT (13 fichiers)
```
📄 ci-e2e.md
📄 mcp-setup.md
📄 migration-prisma6.md
📄 storybook.md
📄 ux-reservation.md
📄 MATCHING_OPTIMIZATION_SUMMARY.md
📄 QUERY_BATCHING_ANALYSIS.md
```

#### APRÈS (19 fichiers organisés)
```
📖 README.md                      → 🆕 Index complet documentation

🏢 Business & Stratégie
📄 business-model.md              → 🆕 Modèle économique complet

🔒 Sécurité & RGPD
📄 blobosphere.md                 → 🆕 Guide + focus RGPD renforcé
📁 audits/                        → 🆕 Dossier audits actifs
  ├── security-audit-pro-profile-2025-12.md
  ├── pro-profile-security-patch-2025-12.txt
  └── ACTIONS_URGENTES_PRO_PROFILE.sh

🚀 Déploiement & Infra
📄 deployment.md                  → ⬅️ DEPLOYMENT.md
📄 adsense-deployment.md          → ⬅️ ADSENSE_DEPLOYMENT.md
📄 monitoring.md                  → ⬅️ MONITORING_GRATUIT.md

🧪 Tests & Qualité
📄 testing.md                     → ⬅️ README_TESTS.md
📄 adsense-testing.md             → ⬅️ ADSENSE_TESTING_GUIDE.md
📄 ci-e2e.md                      → ✅ Conservé
📄 storybook.md                   → ✅ Conservé

🛠️ Technique
📄 mcp-config.md                  → 🆕 Config MCP pour IA
📄 changelog.md                   → 🆕 Historique changements
📄 migration-prisma6.md           → ✅ Conservé
📄 mcp-setup.md                   → ✅ Conservé
📄 ux-reservation.md              → ✅ Conservé
📄 MATCHING_OPTIMIZATION_SUMMARY.md → ✅ Conservé
📄 QUERY_BATCHING_ANALYSIS.md    → ✅ Conservé
```

---

## 🗑️ Fichiers Supprimés (Redondants)

| Fichier | Raison | Contenu fusionné dans |
|---------|--------|----------------------|
| `README_ADS.md` | Redondant | `business-model.md` + `adsense-deployment.md` |
| `ADSENSE_READY_TO_DEPLOY.md` | Redondant | `adsense-deployment.md` |
| `CLAUDE_CODE_IMPROVEMENTS.md` | Obsolète (Sept 2025) | Suggestions traitées |
| `ROADMAP_ADMIN.md` | Fusionné | `ROADMAP.md` |

---

## 🆕 Fichiers Créés

### 1. **docs/business-model.md** ⭐⭐⭐
Nouveau document central pour le modèle économique :

- Association loi 1901 (démarches, avantages)
- Phase MVP : Publicité Google Adsense + RGPD
- Phase 2 : Sponsors surf/kite (packages, pitch)
- Phase 3 : Marketplace offres partenaires
- KPIs, contacts marques, roadmap monétisation

### 2. **docs/blobosphere.md** ⭐
Guide complet module Blobosphère avec **accent RGPD** :

- 🇫🇷 Conformité CNIL obligatoire
- Consentement cookies/pub (code examples)
- Durées conservation données
- Droit à l'oubli (soft delete 30j)
- Checklist sécurité avant déploiement

### 3. **docs/mcp-config.md**
Configuration complète MCP pour IA :

- Claude Code (CLI) : Vercel, Chrome DevTools
- Claude Desktop (App) : Sentry, Playwright, GitHub, Context7
- Obtention tokens (guides détaillés)
- Cas d'usage et troubleshooting

### 4. **docs/changelog.md**
Historique détaillé des changements :

- Nov 2025 → Mai 2025
- Commits majeurs avec contexte
- Breaking changes documentés
- Conventions Git

### 5. **docs/README.md** ⭐
Index centralisé de toute la documentation :

- Organisation par catégorie
- Liens vers tous les docs
- Guide d'utilisation par profil (Dev, IA, PO, Ops)
- Structure complète en arborescence

---

## 📋 Actions Réalisées

### 1️⃣ Déplacer fichiers techniques → /docs
```bash
DEPLOYMENT.md → docs/deployment.md
ADSENSE_DEPLOYMENT.md → docs/adsense-deployment.md
ADSENSE_TESTING_GUIDE.md → docs/adsense-testing.md
README_TESTS.md → docs/testing.md
MONITORING_GRATUIT.md → docs/monitoring.md
```

### 2️⃣ Fusionner doublons
- `README_ADS.md` → Contenu intégré dans `business-model.md`
- `ADSENSE_READY_TO_DEPLOY.md` → Fusionné avec `adsense-deployment.md`
- `ROADMAP_ADMIN.md` → Fusionné avec `ROADMAP.md`

### 3️⃣ Audits récents → /docs/audits
```bash
docs/audits/security-audit-pro-profile-2025-12.md
docs/audits/pro-profile-security-patch-2025-12.txt
docs/audits/ACTIONS_URGENTES_PRO_PROFILE.sh
```

### 4️⃣ Supprimer fichiers obsolètes
```bash
❌ README_ADS.md
❌ ADSENSE_READY_TO_DEPLOY.md
❌ CLAUDE_CODE_IMPROVEMENTS.md
❌ ROADMAP_ADMIN.md
```

### 5️⃣ Créer index central
```bash
🆕 docs/README.md (index complet)
```

---

## 🎯 Bénéfices

### Pour les Développeurs
- ✅ Documentation technique dans `/docs` (séparée de la gouvernance IA)
- ✅ Index centralisé pour trouver rapidement l'info
- ✅ Guides déploiement, tests, monitoring accessibles

### Pour les IA (Codex, Claude Code)
- ✅ Fichiers de gouvernance clairs à la racine (`AGENTS.md`, `claude.md`)
- ✅ Modèle économique documenté (`business-model.md`)
- ✅ Configuration MCP détaillée (`mcp-config.md`)
- ✅ Moins de bruit (fichiers obsolètes supprimés)

### Pour les Product Owners
- ✅ Vision claire (`ROADMAP.md`)
- ✅ Modèle économique explicite (`business-model.md`)
- ✅ Historique des changements (`changelog.md`)

### Pour les Ops/DevOps
- ✅ Guides déploiement (`deployment.md`, `adsense-deployment.md`)
- ✅ Monitoring (`monitoring.md`)
- ✅ Audits sécurité archivés (`docs/audits/`)

---

## 📐 Conventions Adoptées

### Nomenclature
- **kebab-case** : `business-model.md`, `adsense-deployment.md`
- **Dates dans audits** : `security-audit-pro-profile-2025-12.md` (format YYYY-MM)
- **Préfixes clairs** : `adsense-`, `api-`, `security-`

### Organisation
- **Racine** : Documents de gouvernance (IA) + vision (ROADMAP)
- **/docs** : Documentation technique par catégorie
- **/docs/audits** : Audits et correctifs archivés

### Maintenance
Pour ajouter un document :
1. Respecter la nomenclature
2. Placer dans le bon dossier (`/docs/audits` pour audits)
3. Mettre à jour `docs/README.md`
4. Ajouter lien dans `claude.md` si pertinent pour IA
5. Commit : `docs(category): add/update document-name`

---

## 🚀 Prochaines Étapes

### Court terme
- [ ] Mettre à jour les liens dans les PRs/issues existantes
- [ ] Informer l'équipe de la nouvelle structure
- [ ] Vérifier les liens cassés dans les docs

### Moyen terme
- [ ] Ajouter diagrammes architecture dans `/docs/architecture`
- [ ] Créer guide onboarding développeurs
- [ ] Documenter API publique (si Phase 3)

### Long terme
- [ ] Versioning de la doc (ex: v1.0, v2.0)
- [ ] Documentation multilingue (EN)
- [ ] Documentation interactive (Docusaurus)

---

## 📊 Statistiques

### Avant réorganisation
- **Fichiers .md racine** : 18
- **Fichiers redondants** : 6
- **Structure** : Désorganisée (mélange gouvernance + technique)

### Après réorganisation
- **Fichiers .md racine** : 5 (gouvernance uniquement)
- **Fichiers redondants** : 0
- **Structure** : Organisée par catégorie dans `/docs`
- **Nouveaux docs créés** : 5 (business-model, blobosphere, mcp-config, changelog, README)
- **Fichiers archivés** : 4 (dans `/docs/audits`)
- **Fichiers supprimés** : 4 (obsolètes)

### Amélioration
- 📉 **-72% de fichiers à la racine** (18 → 5)
- 📈 **+38% de fichiers organisés** (13 → 19 dans /docs)
- ✅ **100% de la doc indexée** (nouveau `docs/README.md`)

---

**Réalisé par** : Claude Code (Sonnet 4.5)
**Date** : 07/11/2025
**Validé par** : Audrey (Présidente Association Blobinfini)
