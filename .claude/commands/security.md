---
description: Audit de sécurité complet ou ciblé du projet - Blocage de TOUTES tentatives de hacking
---

🔐 **MISSION CRITIQUE** : Protéger Blob (Blobinfini interne) contre TOUTES tentatives de hacking, intrusion ou exploitation.

## Contexte de la commande
- **Arguments fournis** : $ARGUMENTS
- **Projet** : Blob / Blobinfini (plateforme sports de glisse avec auth JWT, Next.js, Express, Prisma, PostgreSQL, Redis)
- **Checklists de référence** :
  - `/ai/checklists/securite_auth.md`
  - `/ai/checklists/rgpd.md`
- **Audit de référence** : le **plus récent** fichier `docs/audits/security-audit-*.md` (trier par date dans le nom de fichier — ne jamais supposer un score ou une date figée, toujours vérifier par lecture directe).
- **État des chantiers sécurité** : `ROADMAP.md` sections "Chantiers Terminés", "Chantiers P0", "Chantiers P1", "Chantiers P2" — lire les titres de section actuels avec `grep -n "^##" ROADMAP.md`, ne jamais citer un numéro de ligne figé (le document est réécrit régulièrement).
- **Niveau d'exigence** : ZÉRO TOLÉRANCE pour les vulnérabilités P0/P1

## Ton rôle

Délègue cette tâche à l'agent **cybersecurite** qui va IMPITOYABLEMENT :

1. **Analyser les arguments** :
   - Si aucun argument → **AUDIT COMPLET** OWASP Top 10 + CWE Top 25
   - Si "auth" → Audit authentification (JWT, sessions, passwords, 2FA)
   - Si "api" → Audit endpoints API (injection, validation, rate limiting)
   - Si "frontend" → Audit Next.js (XSS, CSRF, CSP, secrets exposure)
   - Si "infra" → Audit infrastructure (DB, Redis, env vars, logs)
   - Si "roadmap" → Lire `ROADMAP.md` (sections P0/P1/P2 actuelles) + proposer une mise à jour
   - Si "harden" → Implémenter défenses proactives (honeypots, IDS, WAF)
   - Si "incident" → Roadmap de réponse à incident (7 jours)
   - Si "pre-prod" → Checklist de préproduction (voir section "Environnements" de `ROADMAP.md`) + vérifications
   - Si "status" → Comparer l'état actuel au dernier audit archivé dans `docs/audits/`
   - Si chemin de fichier → Audit ciblé de ce fichier

2. **Scanner AGRESSIVEMENT** :
   - `npm audit` → BLOQUER si critical/high non résolues
   - **Vulnérabilités connues** → Ouvrir le dernier audit dans `docs/audits/`, lister ses vulnérabilités P1/P2, puis vérifier CHAQUE statut par lecture du fichier/ligne actuel (jamais par supposition — le code a bougé depuis l'audit)
   - Secrets hardcodés → Grep récursif patterns sensibles
   - Injections SQL/NoSQL → Vérifier TOUTES requêtes Prisma
   - XSS → Vérifier sanitization inputs utilisateur
   - CSRF → Vérifier tokens/SameSite cookies
   - Headers sécurité → CSP, HSTS, X-Frame-Options, Permissions-Policy
   - Rate limiting → Vérifier présence + profils actuels (grep les limiters dans `apps/api/src`)
   - Logs → Vérifier pas de PII, anonymisation, rétention ≤ 30j
   - OWASP Top 10 → Checklist complète systématique

3. **Produire un rapport ACTIONNABLE** avec :
   - 🚨 Niveau de risque global (CRITIQUE/ÉLEVÉ/MOYEN/FAIBLE)
   - 📈 **Évolution vs le dernier audit archivé** (citer son nom de fichier et sa date)
   - 📍 Vulnérabilités P0/P1/P2 avec **localisations EXACTES** (fichier:ligne, vérifiées à l'instant T)
   - ✅ **Statut des vulnérabilités du dernier audit** (résolues / persistantes / non vérifiables)
   - 💻 **Code de correction** prêt à copier-coller pour CHAQUE problème
   - 🧪 **Tests de sécurité** pour valider les correctifs
   - 📊 Roadmap si > 3 vulnérabilités (référencer les sections P0/P1/P2 actuelles de `ROADMAP.md`)
   - 🛡️ Score de conformité OWASP (X/10)
   - 📋 Checklist pré-production si demandée

4. **ACTIONS IMMÉDIATES** :
   - ⚠️ P0 → BLOCKER : corriger AVANT tout merge/deploy
   - ⚡ P1 → Corriger dans les 48h maximum
   - 📌 P2 → Roadmap de correction à J+7
   - 🚀 Roadmap de sécurisation complète si audit global
   - 🛡️ Implémentation honeypots + IDS si mode "harden"
   - 📧 Template de notification CNIL si incident RGPD

## 🎯 Comportement attendu (STRICT)

- **🚨 ZÉRO TOLÉRANCE P0** : Aucune vulnérabilité critique ne passe
- **📊 Transparence TOTALE** : Documenter CHAQUE vulnérabilité sans exception
- **⚡ Priorisation STRICTE** : P0 → P1 → P2, jamais l'inverse
- **🔮 Proactivité MAXIMALE** : Proposer améliorations non demandées
- **📚 Pédagogie RÉFÉRENCÉE** : OWASP Top 10, CWE, CNIL, Code Pénal français
- **💻 Actionnable IMMÉDIAT** : Code de correction + tests pour CHAQUE problème
- **🛡️ Defense in Depth** : Multiples couches de sécurité systématiques
- **⚖️ Assume Breach** : Partir du principe qu'une attaque aura lieu
- **🔒 Fail Secure** : En cas d'erreur, REFUSER l'accès (pas l'inverse)
- **🚫 Preuves ou silence** : jamais de score/date/statut affirmé sans citer le fichier lu ou la commande exécutée (voir `ai/policies/governance.md`)

## 🇫🇷 Conformité légale française

- **Code Pénal Art. 323-1** : Accès frauduleux = 2 ans prison + 60k€
- **RGPD/CNIL** : Notification sous 72h si violation données personnelles
- **Hébergement données** : Serveurs UE uniquement (souveraineté)
- **Cookies** : Consentement EXPLICITE avant tracking (pas d'opt-out)

## 📚 Références aux documents existants

### Audit précédent
- Toujours identifier le **fichier le plus récent** dans `docs/audits/security-audit-*.md` (ne jamais présumer d'un fichier ou d'un score fixe).
- Lire son contenu réel avant de comparer quoi que ce soit à l'état actuel.

### Roadmap sécurité actuelle
- **Fichier** : `ROADMAP.md` — sections "Chantiers P0", "Chantiers P1", "Chantiers P2" (titres à retrouver via `grep -n "^##" ROADMAP.md`, les numéros de ligne changent à chaque réécriture du document).

### Checklists de référence
- `/ai/checklists/securite_auth.md` - Tokens, routes sensibles, RGPD, protections
- `/ai/checklists/rgpd.md` - Consentement, droits utilisateurs, minimisation

## Exemples d'utilisation

```bash
/security                    # Audit complet + comparaison vs dernier audit archivé
/security auth               # Audit module auth
/security roadmap            # Roadmap à jour basée sur ROADMAP.md (sections P0/P1/P2 actuelles)
/security harden             # Implémenter honeypots + security.txt
/security pre-prod           # Checklist de préproduction + tests automatisés
/security status             # Comparer état actuel vs dernier audit archivé
/security apps/api/src/middleware/auth.ts  # Audit fichier spécifique
```

---

**ACTION IMMÉDIATE** : Lance l'agent cybersecurite avec le Task tool :

```
Task tool:
- subagent_type: cybersecurite
- description: Audit de sécurité Blob
- prompt: "Effectue un audit de sécurité avec les arguments : '$ARGUMENTS'.

**DOCUMENTS DE RÉFÉRENCE OBLIGATOIRES** (à lire, jamais à supposer) :
1. Le fichier le plus récent parmi `docs/audits/security-audit-*.md` — l'identifier d'abord (ex. `ls -t docs/audits/security-audit-*.md | head -1`), puis le lire en entier.
2. `ROADMAP.md` — sections "Chantiers P0"/"Chantiers P1"/"Chantiers P2" actuelles (retrouver les titres avec `grep -n '^##' ROADMAP.md`).
3. Checklists : `/ai/checklists/securite_auth.md`, `/ai/checklists/rgpd.md`

**SI AUCUN ARGUMENT** (audit complet) :
1. Identifier et lire le dernier audit archivé dans `docs/audits/`.
2. Vérifier le STATUT ACTUEL de chacune de ses vulnérabilités par lecture directe du fichier/ligne concerné (le code a évolué depuis — ne pas recopier l'ancien statut sans vérification).
3. Comparer le score actuel à celui du dernier audit, en citant les deux sources.
4. Scanner : npm audit, OWASP Top 10, secrets, CORS, CSP, rate limiting.
5. Rapport avec : évolution depuis le dernier audit, nouvelles vulnérabilités détectées, statut des correctifs précédents, score actuel /10 + roadmap.

**SI ARGUMENT SPÉCIFIQUE** :
- 'auth' → Module auth (JWT, sessions, 2FA, validation password)
- 'api' → Endpoints API + rate limiting (profils actuels, à identifier dans le code)
- 'frontend' → Next.js + CSP/XSS/CSRF
- 'roadmap' → Générer une roadmap basée sur les sections P0/P1/P2 actuelles de `ROADMAP.md`
- 'harden' → Implémenter honeypots + security.txt
- 'pre-prod' → Checklist de préproduction + tests automatisés
- 'status' → Comparer état actuel vs dernier audit archivé
- chemin fichier → Audit ciblé

**SORTIE OBLIGATOIRE** :
- 📈 Évolution vs dernier audit archivé (citer fichier + date)
- 🚨 Nouvelles vulnérabilités P0/P1/P2 avec code de correction
- ✅ Statut des vulnérabilités du dernier audit (vérifié fichier par fichier)
- 🛡️ Score /10 + roadmap
- 📋 Checklist pré-prod si demandée

**EXIGENCE** : ZÉRO vulnérabilité P0/P1 avant production. Toute affirmation d'état doit citer sa preuve (fichier lu ou commande exécutée)."
```
