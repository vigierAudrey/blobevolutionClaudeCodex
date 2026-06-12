---
description: Générer un audit de sécurité complet à jour (format octobre 2025)
---

📊 **AUDIT DE SÉCURITÉ COMPLET** : Générer un rapport structuré comme `docs/audits/security-audit-2025-10.md`

## Contexte de la commande
- **Arguments fournis** : $ARGUMENTS
- **Projet** : Blob (plateforme sports de glisse)
- **Audit de référence** : `docs/audits/security-audit-2025-10.md` (octobre 2025, Score: 95/100)
- **Format de sortie** : Markdown structuré avec sections standardisées

## Ton rôle

Délègue cette tâche à l'agent **cybersecurite** qui va générer un audit COMPLET :

1. **Analyser les arguments** :
   - Si aucun argument → **Audit complet** (format octobre 2025)
   - Si "diff" → **Comparaison** audit actuel vs octobre 2025 (delta uniquement)
   - Si "save" → Sauvegarder le rapport dans `docs/audits/security-audit-YYYY-MM-DD.md`
   - Si "quick" → Audit rapide (P0/P1 uniquement, sans P2)

2. **Structure du rapport** (format standard octobre 2025) :

   ### 📋 Template de rapport

   ```markdown
   # Audit Sécurité Blob - [Date]

   ## 🎯 Résumé Exécutif
   - **Niveau de risque global** : [CRITIQUE/ÉLEVÉ/MOYEN/FAIBLE]
   - **Vulnérabilités détectées** : X P0, Y P1, Z P2
   - **Conformité RGPD** : X/100
   - **Dépendances** : X vulnérabilités critiques (npm audit)
   - **Évolution vs octobre 2025** : Score actuel vs 95/100

   ## 🔴 Module 0 – Quick Wins (48h)
   - État des correctifs rapides
   - Vérifications manuelles recommandées

   ## 🚨 Vulnérabilités Critiques (P0)
   [Liste avec localisations exactes + code de correction]

   ## ⚠️ Vulnérabilités Importantes (P1)
   ### [P1-X] Titre
   - **Localisation** : `fichier.ts:ligne`
   - **Description** : ...
   - **Impact** : ...
   - **Exploitation** : ...
   - **Code actuel** : ```typescript```
   - **Recommandation** : ```typescript```
   - **Priorité** : ...
   - **Référence** : OWASP/CWE

   ## ℹ️ Améliorations Recommandées (P2)
   [Même format que P1]

   ## ✅ Points Positifs
   - Authentification & Autorisation
   - Rate Limiting & Protection DoS
   - Validation & Sanitization
   - Headers de Sécurité
   - CSRF Protection
   - RGPD & Conformité
   - Infrastructure
   - Tests

   ## 📋 Conformité Checklist
   ### Sécurité Auth (checklist `/ai/checklists/securite_auth.md`)
   - Tokens
   - Routes sensibles
   - Données & RGPD
   - Protections

   ### RGPD (checklist `/ai/checklists/rgpd.md`)
   - Consentement & Transparence
   - Droits utilisateurs
   - Minimisation & Sécurité

   ## 🎯 Actions Prioritaires
   ### URGENT (Jour 1)
   ### Important (Semaine 1)
   ### Recommandé (Mois 1)

   ## 📊 Roadmap de Sécurisation
   ### Phase 1 : Corrections Critiques (Jour 1-3)
   ### Phase 2 : CSP Hardening (Jour 4-7)
   ### Phase 3 : Logging & Monitoring (Jour 8-14)
   ### Phase 4 : Optimisations Finales (Jour 15-21)
   ### Phase 5 : Dissuasion & Communication (Jour 22-30)
   ### Phase 6 : Certification (Post-MVP)

   ## 🛡️ Mesures Proactives Proposées
   - Honeypot Endpoint
   - IP Blacklisting Dynamique
   - Security.txt

   ## 📈 Métriques de Succès
   - Score cible
   - Objectifs mesurables

   ## 🚀 Prochaines Étapes
   1. Corrections P1
   2. Migration CSP
   3. Monitoring & Alerting
   4. Documentation

   ## 📚 Ressources Utiles
   - OWASP Top 10
   - CWE Top 25
   - RGPD (CNIL)
   - ANSSI

   ## Conclusion
   Synthèse + recommandation finale
   ```

3. **Vérifications obligatoires** :

   ### A. Vulnérabilités connues (octobre 2025)
   Vérifier le statut de TOUTES les vulnérabilités de `docs/audits/security-audit-2025-10.md` :

   **P1 (Important)** :
   - [P1-1] Sentry sendDefaultPii → `apps/api/src/instrument.ts` (✅ corrigé)
   - [P1-2] CSP unsafe-inline → `apps/api/src/index.ts` (✅ corrigé)
   - [P1-3] Validation password → `apps/api/src/modules/auth/auth.controller.ts:14` (⚠️ à vérifier)

   **P2 (Améliorations)** :
   - [P2-1] SESSION_SECRET fallback → `apps/api/src/index.ts:154`
   - [P2-2] console.log avec PII → 26 fichiers
   - [P2-3] Referrer Policy → `apps/api/src/index.ts:60`
   - [P2-4] Redis timeout → `apps/api/src/middleware/enhanced-rate-limit.ts:23`
   - [P2-5] Rate limiting email → `apps/api/src/modules/auth/auth.controller.ts:163` (✅ corrigé)
   - [P2-6] /security/health → `apps/api/src/index.ts:249`
   - [P2-7] Timing attack tokens → `apps/api/src/modules/auth/auth.service.ts:129`
   - [P2-8] GDPR export emails → `apps/api/src/services/gdpr-export.service.ts` (✅ corrigé)
   - [P2-9] Query params logs → `apps/api/src/index.ts:305`

   ### B. Scan automatique
   - `npm audit` (critical/high)
   - Secrets hardcodés (grep patterns)
   - OWASP Top 10 checklist
   - CORS configuration
   - CSP headers
   - Rate limiting profiles
   - Validation Zod coverage

   ### C. Comparaison vs octobre 2025
   - Score actuel vs 95/100
   - Nombre de vulnérabilités P0/P1/P2 (évolution)
   - Conformité RGPD (évolution)
   - Nouvelles vulnérabilités introduites
   - Régressions détectées

4. **Modes de sortie** :

   ### Mode standard (aucun argument)
   ```bash
   /audit
   ```
   → Rapport complet affiché dans le chat

   ### Mode diff (comparaison)
   ```bash
   /audit diff
   ```
   → Affiche UNIQUEMENT les changements vs octobre 2025 :
   - ✅ Vulnérabilités résolues (P1-1, P1-2, P2-5, P2-8)
   - ⚠️ Vulnérabilités persistantes (P1-3, P2-1 à P2-9)
   - 🆕 Nouvelles vulnérabilités détectées
   - 📊 Évolution du score

   ### Mode save (sauvegarder)
   ```bash
   /audit save
   ```
   → Génère le rapport ET le sauvegarde dans :
   - `docs/audits/security-audit-YYYY-MM-DD.md`
   - Message de confirmation avec chemin du fichier

   ### Mode quick (rapide)
   ```bash
   /audit quick
   ```
   → Audit P0/P1 uniquement (sans P2) pour validation rapide

## 📊 Sortie attendue

### Format console (mode standard)
```markdown
# Audit Sécurité Blob - 2025-11-09

## 🎯 Résumé Exécutif
- **Niveau de risque global** : MOYEN
- **Vulnérabilités** : 0 P0, 1 P1, 7 P2
- **Conformité RGPD** : 92/100 (+2 vs oct. 2025)
- **npm audit** : 0 critical/high ✅
- **Évolution** : Score actuel 8.5/10 (vs 95/100 oct. 2025)

## 📈 Évolution vs Octobre 2025

### ✅ Vulnérabilités résolues (4)
- [P1-1] ✅ Sentry sendDefaultPii - `apps/api/src/instrument.ts` (corrigé)
- [P1-2] ✅ CSP unsafe-inline - `apps/api/src/index.ts` (corrigé)
- [P2-5] ✅ Rate limiting email - `auth.controller.ts:163` (corrigé)
- [P2-8] ✅ GDPR export emails - `gdpr-export.service.ts` (corrigé)

### ⚠️ Vulnérabilités persistantes (8)
- [P1-3] ⚠️ Validation password - TOUJOURS PRÉSENT
- [P2-1 à P2-4, P2-6, P2-7, P2-9] - À traiter

### 🆕 Nouvelles vulnérabilités (0)
Aucune nouvelle vulnérabilité détectée ✅

[... suite du rapport complet ...]
```

### Format diff (mode diff)
```markdown
# Audit Diff - 2025-11-09 vs 2025-10-26

## Résumé
- **Améliorations** : +4 vulnérabilités résolues
- **Dégradations** : 0 nouvelles vulnérabilités
- **Score** : 8.5/10 (vs 7.0/10, +1.5) 📈

## ✅ Résolutions
[P1-1] Sentry sendDefaultPii → Corrigé dans `instrument.ts`
[P1-2] CSP unsafe-inline → Corrigé avec nonces dynamiques
...

## ⚠️ Toujours présents
[P1-3] Validation password → BLOCKER avant production
...

## 📊 Recommandations
1. Corriger [P1-3] IMMÉDIATEMENT (blocker prod)
2. Traiter P2-1 à P2-4 (semaine 1)
3. Objectif : 9.5/10 avant production
```

## Exemples d'utilisation

```bash
/audit              # Audit complet (format octobre 2025)
/audit diff         # Comparaison vs octobre 2025 (delta uniquement)
/audit save         # Sauvegarder dans docs/audits/security-audit-2025-11-09.md
/audit quick        # P0/P1 uniquement pour validation rapide
```

---

**ACTION IMMÉDIATE** : Lance l'agent cybersecurite avec le Task tool :

```
Task tool:
- subagent_type: cybersecurite
- description: Audit de sécurité complet Blob
- prompt: "Génère un audit de sécurité complet au format octobre 2025.

**MODE** : $ARGUMENTS (standard/diff/save/quick)

**DOCUMENTS DE RÉFÉRENCE OBLIGATOIRES** :
1. `docs/audits/security-audit-2025-10.md` - Template + vulnérabilités connues
2. `ROADMAP.md` (lignes 50-219) - État actuel sécurité
3. Checklists : `/ai/checklists/securite_auth.md`, `/ai/checklists/rgpd.md`

**ÉTAPES OBLIGATOIRES** :

1. **Lire l'audit de référence** (`docs/audits/security-audit-2025-10.md`)
   - Comprendre la structure (sections, format)
   - Lister TOUTES les vulnérabilités (P1-1 à P2-9)

2. **Vérifier le statut de CHAQUE vulnérabilité connue** :
   - [P1-1] Sentry → Lire `apps/api/src/instrument.ts` ligne ~15-65
   - [P1-2] CSP → Lire `apps/api/src/index.ts` ligne ~60-80
   - [P1-3] Password → Lire `apps/api/src/modules/auth/auth.controller.ts` ligne ~14
   - [P2-1] SESSION_SECRET → Lire `apps/api/src/index.ts` ligne ~154
   - [P2-2] console.log → Grep 'console\\.log' dans apps/api/src/
   - [P2-3] referrerPolicy → Lire `apps/api/src/index.ts` ligne ~60
   - [P2-4] Redis timeout → Lire `apps/api/src/middleware/enhanced-rate-limit.ts` ligne ~23
   - [P2-5] Rate limiting email → Lire `apps/api/src/modules/auth/auth.controller.ts` ligne ~163
   - [P2-6] /security/health → Lire `apps/api/src/index.ts` ligne ~249
   - [P2-7] Timing attack → Lire `apps/api/src/modules/auth/auth.service.ts` ligne ~129
   - [P2-8] GDPR export → Lire `apps/api/src/services/gdpr-export.service.ts`
   - [P2-9] Query params → Lire `apps/api/src/index.ts` ligne ~305

3. **Scanner pour nouvelles vulnérabilités** :
   - `npm audit` (bash)
   - Secrets hardcodés (grep)
   - OWASP Top 10 checklist
   - Validation Zod coverage

4. **Générer le rapport selon le MODE** :

   **Si MODE = standard** :
   - Rapport complet avec TOUTES les sections
   - Format identique à octobre 2025
   - Inclure : résumé, P0/P1/P2, points positifs, conformité, roadmap, métriques

   **Si MODE = diff** :
   - UNIQUEMENT les différences vs octobre 2025
   - Format concis : Résolutions / Persistants / Nouveaux / Score
   - Pas de sections complètes, juste le delta

   **Si MODE = save** :
   - Générer le rapport complet (mode standard)
   - Sauvegarder dans `docs/audits/security-audit-$(date +%Y-%m-%d).md`
   - Afficher message de confirmation avec chemin

   **Si MODE = quick** :
   - P0/P1 UNIQUEMENT (pas de P2)
   - Format résumé pour validation rapide
   - Sections : Résumé exécutif + P0 + P1 + Actions prioritaires

**SORTIE OBLIGATOIRE** :

Pour TOUS les modes :
- 📊 Score actuel /10
- 📈 Évolution vs octobre 2025
- 🚨 Nombre de P0/P1/P2 (actuels)
- ✅ Nombre de vulnérabilités résolues depuis octobre
- ⚠️ Vulnérabilités persistantes (liste)
- 🆕 Nouvelles vulnérabilités (liste)

Mode standard/save :
- Rapport complet format octobre 2025 (toutes sections)
- Code de correction pour CHAQUE vulnérabilité
- Roadmap de sécurisation en 6 phases

Mode diff :
- Delta uniquement (concis)
- Recommandations prioritaires

Mode quick :
- P0/P1 uniquement
- Actions immédiates (Jour 1)

**EXIGENCE CRITIQUE** :
- TOUTES les 12 vulnérabilités connues (P1-1 à P2-9) doivent être vérifiées
- Localisation EXACTE de chaque vulnérabilité (fichier:ligne)
- Code de correction pour CHAQUE problème
- Score /10 calculé objectivement"
```
