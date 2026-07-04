---
description: Générer un audit de sécurité complet à jour
---

📊 **AUDIT DE SÉCURITÉ COMPLET** : Générer un rapport structuré, comparé au dernier audit archivé dans `docs/audits/`.

## Contexte de la commande
- **Arguments fournis** : $ARGUMENTS
- **Projet** : Blob / Blobinfini (plateforme sports de glisse)
- **Audit de référence** : le fichier **le plus récent** parmi `docs/audits/security-audit-*.md` (l'identifier via `ls -t docs/audits/security-audit-*.md | head -1`, ne jamais présumer d'un nom/date/score fixe)
- **Format de sortie** : Markdown structuré avec sections standardisées

## Ton rôle

Délègue cette tâche à l'agent **cybersecurite** qui va générer un audit COMPLET :

1. **Analyser les arguments** :
   - Si aucun argument → **Audit complet**
   - Si "diff" → **Comparaison** audit actuel vs dernier audit archivé (delta uniquement)
   - Si "save" → Sauvegarder le rapport dans `docs/audits/security-audit-YYYY-MM-DD.md`
   - Si "quick" → Audit rapide (P0/P1 uniquement, sans P2)

2. **Structure du rapport** :

   ### 📋 Template de rapport

   ```markdown
   # Audit Sécurité Blob - [Date]

   ## 🎯 Résumé Exécutif
   - **Niveau de risque global** : [CRITIQUE/ÉLEVÉ/MOYEN/FAIBLE]
   - **Vulnérabilités détectées** : X P0, Y P1, Z P2
   - **Conformité RGPD** : X/100
   - **Dépendances** : X vulnérabilités critiques (npm audit)
   - **Évolution vs dernier audit archivé** : score actuel vs score de l'audit précédent (citer le fichier)

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

   ### A. Vulnérabilités du dernier audit archivé
   - Identifier le fichier le plus récent (`ls -t docs/audits/security-audit-*.md | head -1`) et le lire en entier.
   - Lister TOUTES ses vulnérabilités P1/P2 telles qu'il les décrit.
   - Vérifier le statut ACTUEL de chacune par lecture directe du fichier/zone de code concerné — ne jamais recopier l'ancien statut sans vérification, le code a évolué depuis.

   ### B. Scan automatique
   - `npm audit` (critical/high)
   - Secrets hardcodés (grep patterns)
   - OWASP Top 10 checklist
   - CORS configuration
   - CSP headers
   - Rate limiting profiles
   - Validation Zod coverage

   ### C. Comparaison vs dernier audit archivé
   - Score actuel vs score de l'audit précédent (citer les deux fichiers/dates)
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
   → Affiche UNIQUEMENT les changements vs le dernier audit archivé :
   - ✅ Vulnérabilités résolues
   - ⚠️ Vulnérabilités persistantes
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

Le format ci-dessous illustre la structure attendue — les scores et vulnérabilités sont des exemples, jamais des valeurs à réutiliser telles quelles :

```markdown
# Audit Sécurité Blob - [date du jour]

## 🎯 Résumé Exécutif
- **Niveau de risque global** : [à déterminer par le scan]
- **Vulnérabilités** : [X] P0, [Y] P1, [Z] P2
- **Conformité RGPD** : [X]/100
- **npm audit** : [résultat réel de la commande]
- **Évolution** : score actuel vs score du dernier audit archivé (citer le fichier)

## 📈 Évolution vs dernier audit archivé

### ✅ Vulnérabilités résolues
[Lister celles du dernier audit dont le statut actuel est corrigé, avec preuve fichier:ligne]

### ⚠️ Vulnérabilités persistantes
[Lister celles encore présentes, avec preuve fichier:ligne]

### 🆕 Nouvelles vulnérabilités
[Lister les vulnérabilités non présentes dans le dernier audit]

[... suite du rapport complet ...]
```

## Exemples d'utilisation

```bash
/audit              # Audit complet
/audit diff         # Comparaison vs dernier audit archivé (delta uniquement)
/audit save         # Sauvegarder dans docs/audits/security-audit-YYYY-MM-DD.md
/audit quick        # P0/P1 uniquement pour validation rapide
```

---

**ACTION IMMÉDIATE** : Lance l'agent cybersecurite avec le Task tool :

```
Task tool:
- subagent_type: cybersecurite
- description: Audit de sécurité complet Blob
- prompt: "Génère un audit de sécurité complet.

**MODE** : $ARGUMENTS (standard/diff/save/quick)

**DOCUMENTS DE RÉFÉRENCE OBLIGATOIRES** (à lire, jamais à supposer) :
1. Le fichier le plus récent parmi `docs/audits/security-audit-*.md` (l'identifier d'abord avec `ls -t`, puis le lire en entier) — template + vulnérabilités connues.
2. `ROADMAP.md` — sections "Chantiers P0"/"Chantiers P1"/"Chantiers P2" actuelles (titres à retrouver via `grep -n '^##' ROADMAP.md`, ne jamais citer de numéro de ligne figé).
3. Checklists : `/ai/checklists/securite_auth.md`, `/ai/checklists/rgpd.md`

**ÉTAPES OBLIGATOIRES** :

1. **Identifier et lire l'audit de référence** (le plus récent dans `docs/audits/`)
   - Comprendre sa structure (sections, format)
   - Lister TOUTES ses vulnérabilités P1/P2

2. **Vérifier le statut ACTUEL de CHAQUE vulnérabilité connue** :
   - Pour chacune, relire le fichier/zone de code qu'elle cite et confirmer si elle est corrigée, persistante, ou si la zone a été refactorée entre-temps (le cas échéant, le signaler comme INCONNU plutôt que de deviner)

3. **Scanner pour nouvelles vulnérabilités** :
   - `npm audit` (bash)
   - Secrets hardcodés (grep)
   - OWASP Top 10 checklist
   - Validation Zod coverage

4. **Générer le rapport selon le MODE** :

   **Si MODE = standard** :
   - Rapport complet avec TOUTES les sections
   - Inclure : résumé, P0/P1/P2, points positifs, conformité, roadmap, métriques

   **Si MODE = diff** :
   - UNIQUEMENT les différences vs le dernier audit archivé
   - Format concis : Résolutions / Persistants / Nouveaux / Score

   **Si MODE = save** :
   - Générer le rapport complet (mode standard)
   - Sauvegarder dans `docs/audits/security-audit-$(date +%Y-%m-%d).md`
   - Afficher message de confirmation avec chemin

   **Si MODE = quick** :
   - P0/P1 UNIQUEMENT (pas de P2)
   - Format résumé pour validation rapide

**SORTIE OBLIGATOIRE** :

Pour TOUS les modes :
- 📊 Score actuel /10
- 📈 Évolution vs dernier audit archivé (fichier + date cités)
- 🚨 Nombre de P0/P1/P2 (actuels)
- ✅ Nombre de vulnérabilités résolues depuis le dernier audit
- ⚠️ Vulnérabilités persistantes (liste)
- 🆕 Nouvelles vulnérabilités (liste)

Mode standard/save :
- Rapport complet (toutes sections)
- Code de correction pour CHAQUE vulnérabilité
- Roadmap de sécurisation en 6 phases

Mode diff :
- Delta uniquement (concis)
- Recommandations prioritaires

Mode quick :
- P0/P1 uniquement
- Actions immédiates (Jour 1)

**EXIGENCE CRITIQUE** :
- Chaque vulnérabilité du dernier audit doit être re-vérifiée par lecture directe, jamais recopiée telle quelle
- Localisation EXACTE de chaque vulnérabilité (fichier:ligne), vérifiée à l'instant T
- Code de correction pour CHAQUE problème
- Score /10 calculé objectivement, avec sa justification"
```
