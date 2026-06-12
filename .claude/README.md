# 🤖 Configuration Claude Code - Blob

Ce dossier contient la configuration spécifique à **Claude Code CLI** pour automatiser les workflows de développement.

## ✅ Appeler les commandes

1. Ouvrir le repo avec Claude Code CLI (à la racine du projet).
2. Les commandes `/...` sont automatiquement chargées depuis `.claude/commands/`.
3. Les agents spécialisés sont chargés depuis `.claude/agents/`.

Si des commandes shell sont bloquées, ajuster l’allowlist dans `.claude/settings.local.json`.

---

## 📂 Structure

```
.claude/
├── commands/          # Slash commands (/security, /rgpd, etc.)
├── agents/            # Agents spécialisés (cybersecurite.md)
├── settings.local.json # Configuration locale
└── README.md          # Ce fichier
```

---

## ⚡ Slash Commands disponibles

### 🔐 Sécurité & Conformité

#### `/security [args]`
Audit de sécurité complet ou ciblé avec **ZÉRO TOLÉRANCE** pour les vulnérabilités P0/P1.

**📚 Documents de référence** :
- `ROADMAP.md` (lignes 50-219) - Score actuel: 7.0/10 → Objectif: 9.5/10
- `docs/audits/security-audit-2025-10.md` - Audit octobre 2025 (Score: 95/100)

**Modes disponibles** :
- `/security` → Audit COMPLET (OWASP Top 10 + CWE Top 25) + comparaison vs octobre 2025
- `/security auth` → Audit authentification + vérif [P1-3] validation password
- `/security api` → Audit endpoints API (injections, validation, rate limiting)
- `/security frontend` → Audit Next.js + vérif [P1-2] CSP sans unsafe-inline
- `/security infra` → Audit infrastructure (DB, Redis, env vars, logs)
- `/security roadmap` → Roadmap à jour basée sur `ROADMAP.md` Phases 1-3
- `/security harden` → Implémenter honeypots + security.txt (audit oct. lignes 595-693)
- `/security pre-prod` → Checklist `ROADMAP.md:178-216` + tests automatisés
- `/security status` → Comparer état actuel vs audit octobre (P1/P2 résolus ?)

**Garanties** :
- ✅ Détection OWASP Top 10 + vérification 12 vulnérabilités connues (P1-1 à P2-9)
- ✅ Code de correction pour CHAQUE vulnérabilité
- ✅ Tests de sécurité automatisés
- ✅ Score de conformité /10 + évolution vs octobre 2025
- ✅ Roadmap référençant `ROADMAP.md` si > 3 vulnérabilités

#### `/audit [mode]`
Générer un audit de sécurité complet au **format octobre 2025** (762 lignes structurées).

**Modes disponibles** :
- `/audit` → Rapport complet (format identique à `docs/audits/security-audit-2025-10.md`)
- `/audit diff` → Delta uniquement vs octobre 2025 (résolutions + persistants + nouveaux)
- `/audit save` → Sauvegarder dans `docs/audits/security-audit-YYYY-MM-DD.md`
- `/audit quick` → P0/P1 uniquement pour validation rapide (sans P2)

**Sortie garantie** :
- 📈 **Évolution vs octobre 2025** : Score actuel vs 95/100
- ✅ **Statut des 12 vulnérabilités connues** : [P1-1] à [P2-9]
- 🆕 **Nouvelles vulnérabilités détectées**
- 💻 **Code de correction** pour CHAQUE problème
- 📊 **Roadmap de sécurisation en 6 phases** (Corrections → CSP → Logging → Optimisations → Dissuasion → Certification)

**Exemples** :
```bash
/audit              # Rapport complet avec toutes les sections
/audit diff         # "✅ 4 résolues / ⚠️ 8 persistantes / 🆕 0 nouvelles"
/audit save         # Génère + sauvegarde docs/audits/security-audit-2025-11-09.md
/audit quick        # Résumé exécutif + P0 + P1 uniquement
```

#### `/rgpd [args]`
Audit RGPD complet selon **CNIL française** et conformité UE.

**Modes disponibles** :
- `/rgpd` → Audit COMPLET (7 principes + 6 droits)
- `/rgpd cookies` → Audit consentement cookies CNIL
- `/rgpd data` → Audit collecte et traitement données
- `/rgpd rights` → Audit droits utilisateurs (accès, suppression, portabilité)
- `/rgpd breach` → Procédure de notification CNIL (72h)
- `/rgpd privacy-policy` → Générer politique de confidentialité

**Garanties** :
- ✅ Conformité CNIL 100%
- ✅ Score de conformité /100
- ✅ Templates de documents légaux
- ✅ Checklist pré-production

---

### 🛠️ Développement

#### `/implement [feature]`
Implémenter une fonctionnalité avec le persona **Développeur**.

**Exemples** :
```bash
/implement POST /api/auth/register avec Zod et rate limiting
/implement page de profil utilisateur avec édition
```

**Garanties** :
- ✅ Code TypeScript strict (pas de `any`)
- ✅ Validation Zod sur tous inputs
- ✅ Tests unitaires + intégration
- ✅ Diff minimal et expliqué

#### `/review [changements]`
Revue PR stricte avec checklist sécurité et qualité.

**Exemples** :
```bash
/review apps/api/src/modules/auth/
/review "Modifications du système de login"
```

**Checklist** :
- ✅ Sécurité (Zod, JWT, rate limiting, CSRF)
- ✅ RGPD (consentement, export, suppression)
- ✅ Code Quality (TS strict, gestion erreurs)
- ✅ Performance (N+1, index DB, pagination)
- ✅ Tests (coverage ≥ 80%)

#### `/test [feature]`
Générer suite de tests complète (Happy path + Sad path + Edge cases).

**Exemples** :
```bash
/test POST /api/auth/login
/test composant PasswordRequirementsList
```

**Garanties** :
- ✅ Tests unitaires + intégration
- ✅ Coverage ≥ 80%
- ✅ Oracles clairs (assertions précises)
- ✅ Seeds/fixtures inclus

#### `/debug [bug]`
Déboguer un problème avec méthodologie systématique.

**Exemples** :
```bash
/debug "TypeError: Cannot read property 'email' of undefined"
/debug "Les sessions expirent trop tôt"
```

**Méthodologie** :
1. Reproduction du bug
2. Isolation de la cause
3. Hypothèses testées
4. Patch minimal
5. Tests de non-régression

#### `/plan [feature]`
Créer un plan de livraison découpé en tâches atomiques.

**Exemples** :
```bash
/plan Feature de matching géospatial
/plan Système de notifications par email
```

**Livrable** :
- ✅ Découpage en phases (Foundation → Core → Polish)
- ✅ Tâches atomiques (1-3h, < 200 lignes)
- ✅ Timeline avec dépendances
- ✅ Checklist de validation finale

---

## 🤖 Agents spécialisés

### `cybersecurite.md`
Expert cybersécurité offensif pour auditer, protéger et bloquer toute tentative de hacking.

**Capacités** :
- Audit OWASP Top 10 + CWE Top 25
- Vérification automatique des 12 vulnérabilités connues (P1-1 à P2-9)
- Détection secrets hardcodés, injections, XSS, CSRF
- Roadmaps de sécurisation pré-configurées :
  - 🚀 Production-Ready (9h) - `ROADMAP.md:50-219`
  - 🔥 Post-Audit Octobre (30j) - `docs/audits/security-audit-2025-10.md:568-603`
  - 🛡️ Incident Response (7j) - Template générique
- Implémentation honeypots, IDS, WAF, security.txt
- Conformité RGPD + CNIL française

**Déclenchement** :
- Automatique via `/security`, `/audit` et `/rgpd`
- Peut être invoqué directement via Task tool

**Documents de référence automatiques** :
- `ROADMAP.md` (lignes 50-219) - Score 7.0/10 → 9.5/10
- `docs/audits/security-audit-2025-10.md` - Audit octobre (Score: 95/100)
- `/ai/checklists/securite_auth.md` + `rgpd.md`

---

## 📊 Comparaison `.claude/` vs `ai/` vs `docs/`

| Aspect | `.claude/` (Claude Code) | `ai/` (Universel) | `docs/` (Archives) |
|--------|--------------------------|-------------------|--------------------|
| **Portée** | Spécifique à Claude Code CLI | Universel (Claude web, autres IA) | Documentation projet |
| **Usage** | Automatique via slash commands | Manuel : copier-coller prompts | Référence historique |
| **Agents** | `.claude/agents/*.md` - intégration native | `ai/personas/*.md` - templates | - |
| **Prompts** | `.claude/commands/*.md` - commandes rapides | `ai/prompts/*.md` - workflows complets | - |
| **Audits** | `/security`, `/audit` référencent | `/ai/checklists/` - critères | `docs/audits/security-audit-*.md` |
| **Roadmaps** | Agent cybersécurité synchronisé | - | `ROADMAP.md` + `docs/audits/*.md` |
| **Avantage** | Efficacité quotidienne dans CLI | Portabilité et documentation projet | Traçabilité et historique |

**Les TROIS systèmes se complètent** :
- `.claude/` → **Efficacité** (commandes rapides)
- `ai/` → **Portabilité** (réutilisable partout)
- `docs/` → **Traçabilité** (audits archivés)

---

## 🚀 Quick Start

### 1. Audit de sécurité complet
```bash
/security              # Audit complet + comparaison vs octobre 2025
/audit                 # Rapport structuré format octobre 2025
/audit diff            # Delta uniquement (rapide)
```

### 2. Vérifier l'évolution de la sécurité
```bash
/security status       # Tableau P1/P2 résolus vs octobre 2025
/audit quick           # P0/P1 uniquement pour validation rapide
```

### 3. Vérifier conformité RGPD
```bash
/rgpd                  # Conformité CNIL + score /100
```

### 4. Avant déploiement production
```bash
/security pre-prod     # Checklist ROADMAP.md:178-216
/audit save            # Archiver audit dans docs/audits/
```

### 5. Implémenter une feature
```bash
/implement Endpoint POST /api/users/me/export pour droit d'accès RGPD
```

### 6. Reviewer des changements
```bash
/review apps/api/src/modules/auth/
```

### 7. Déboguer un problème
```bash
/debug "Rate limiting ne fonctionne pas sur /api/auth/login"
```

---

## 🔒 Règles de sécurité

### Avant CHAQUE merge/deploy
1. ✅ `/security pre-prod` → Aucun P0/P1 (checklist `ROADMAP.md:178-216`)
2. ✅ `/audit quick` → Vérification rapide P0/P1
3. ✅ `/rgpd` → Score ≥ 80/100
4. ✅ `npm audit` → 0 critical/high
5. ✅ Tests verts (≥ 80% coverage)
6. ✅ Lint/build OK

### Audit régulier (recommandé)
- **Hebdomadaire** : `/audit diff` (10 min) - Vérifier pas de régression
- **Mensuel** : `/audit save` (30 min) - Archive dans `docs/audits/`
- **Avant production** : `/audit` complet + `/security pre-prod`

### En cas d'incident
1. ⚠️ `/security incident` → Roadmap de réponse (7j)
2. 📧 `/rgpd breach` → Notification CNIL (72h)
3. 🛡️ `/security harden` → Défenses proactives (honeypots, IDS)

---

## 📚 Ressources

### Sécurité
- **Audits archivés** : `docs/audits/security-audit-*.md`
  - Octobre 2025 : Score 95/100 (762 lignes, référence complète)
- **Roadmap active** : `ROADMAP.md` (lignes 50-219) - Score 7.0/10 → 9.5/10
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [CWE Top 25](https://cwe.mitre.org/top25/)
- [Code Pénal Art. 323-1](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000030939438)

### RGPD
- [Guide RGPD CNIL](https://www.cnil.fr/fr/guide-rgpd-du-developpeur)
- [Recommandations cookies](https://www.cnil.fr/fr/cookies-et-autres-traceurs)
- [Registre des traitements](https://www.cnil.fr/fr/RGDP-le-registre-des-activites-de-traitement)

### Checklists locales
- `/ai/checklists/securite_auth.md` - Tokens, routes, RGPD, protections
- `/ai/checklists/rgpd.md` - Consentement, droits, minimisation
- `/ai/checklists/tests.md` - Couverture, oracles, non-régression

### Vulnérabilités connues (à vérifier)
- **P1** : [P1-1] ✅ Sentry, [P1-2] ✅ CSP, [P1-3] ⚠️ Password validation
- **P2** : [P2-1] SESSION_SECRET, [P2-2] console.log, [P2-3] Referrer Policy, [P2-4] Redis timeout, [P2-5] ✅ Rate limiting email, [P2-6] /security/health, [P2-7] Timing attack, [P2-8] ✅ GDPR export, [P2-9] Query params logs

---

## 🌊 Esprit Blob

> "Surfer, c'est être libre **et** lire la houle.
> Les IA Blob avancent seules,
> mais lèvent la main quand elles voient la digue."

**Aucun compromis sur la sécurité. Zéro tolérance pour les vulnérabilités critiques.**
