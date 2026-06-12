---
description: Audit de sécurité complet ou ciblé du projet - Blocage de TOUTES tentatives de hacking
---

🔐 **MISSION CRITIQUE** : Protéger Blob contre TOUTES tentatives de hacking, intrusion ou exploitation.

## Contexte de la commande
- **Arguments fournis** : $ARGUMENTS
- **Projet** : Blob (plateforme sports de glisse avec auth JWT, Next.js, Express, Prisma, PostgreSQL, Redis)
- **Checklists de référence** :
  - `/ai/checklists/securite_auth.md`
  - `/ai/checklists/rgpd.md`
- **Roadmaps existantes** :
  - `ROADMAP.md` (lignes 50-219) - Section "🔒 Sécurité & Conformité"
    - ✅ Phase 1 TERMINÉE (10 nov. 2025) : CORS, secrets, logs, validation
    - 🔄 Phase 2 EN COURS : Helmet strict, trust proxy, DB SSL
    - ⏳ Phase 3 À FAIRE : `/security/health`, audit logs
  - `docs/audits/security-audit-2025-10.md` - Audit complet (Score: 95/100)
- **Niveau d'exigence** : ZÉRO TOLÉRANCE pour les vulnérabilités P0/P1
- **Score actuel** : 7.0/10 → Objectif 9.5/10 avant production (Phase 1 ✅, ~5h restantes)

## Ton rôle

Délègue cette tâche à l'agent **cybersecurite** qui va IMPITOYABLEMENT :

1. **Analyser les arguments** :
   - Si aucun argument → **AUDIT COMPLET** OWASP Top 10 + CWE Top 25
   - Si "auth" → Audit authentification (JWT, sessions, passwords, 2FA)
   - Si "api" → Audit endpoints API (injection, validation, rate limiting)
   - Si "frontend" → Audit Next.js (XSS, CSRF, CSP, secrets exposure)
   - Si "infra" → Audit infrastructure (DB, Redis, env vars, logs)
   - Si "roadmap" → Consulter `ROADMAP.md:50-219` + créer roadmap à jour
   - Si "harden" → Implémenter défenses proactives (honeypots, IDS, WAF)
   - Si "incident" → Roadmap de réponse à incident (7 jours)
   - Si "pre-prod" → Checklist `ROADMAP.md:178-216` + vérifications
   - Si "status" → Comparer état actuel vs audit octobre 2025 (`docs/audits/security-audit-2025-10.md`)
   - Si chemin de fichier → Audit ciblé de ce fichier

2. **Scanner AGRESSIVEMENT** :
   - `npm audit` → BLOQUER si critical/high non résolues
   - **Vulnérabilités connues** → Vérifier statut des P1/P2 de `docs/audits/security-audit-2025-10.md` :
     - [P1-1] ✅ Sentry sendDefaultPii (corrigé)
     - [P1-2] ✅ CSP unsafe-inline (corrigé)
     - [P1-3] ⚠️ Validation mot de passe (à vérifier)
     - [P2-1 à P2-9] → Vérifier si implémentés
   - **Phase 1 (ROADMAP.md)** → Vérifier CORS, secrets, logs, validation :
     - CORS whitelist dynamique
     - Secrets ≥ 64 chars
     - Logs sanitizés (secure-logger)
     - Validation Zod complète
   - Secrets hardcodés → Grep récursif patterns sensibles
   - Injections SQL/NoSQL → Vérifier TOUTES requêtes Prisma
   - XSS → Vérifier sanitization inputs utilisateur
   - CSRF → Vérifier tokens/SameSite cookies
   - Headers sécurité → CSP, HSTS, X-Frame-Options, Permissions-Policy
   - Rate limiting → Vérifier présence + profils (AUTH 5/15min, REGISTRATION 3/h, EMAIL_VERIFICATION 3/h)
   - Logs → Vérifier pas de PII, anonymisation, rétention ≤ 30j
   - OWASP Top 10 → Checklist complète systématique

3. **Produire un rapport ACTIONNABLE** avec :
   - 🚨 Niveau de risque global (CRITIQUE/ÉLEVÉ/MOYEN/FAIBLE)
   - 📈 **Évolution vs audit octobre 2025** : Score actuel vs 95/100
   - 📍 Vulnérabilités P0/P1/P2 avec **localisations EXACTES** (fichier:ligne)
   - ✅ **Statut des vulnérabilités connues** (P1-1, P1-2, P1-3, P2-1 à P2-9)
   - 💻 **Code de correction** prêt à copier-coller pour CHAQUE problème
   - 🧪 **Tests de sécurité** pour valider les correctifs
   - 📊 Roadmap si > 3 vulnérabilités (référencer `ROADMAP.md` Phases 1-3)
   - 🛡️ Score de conformité OWASP (X/10) → Objectif 9.5/10
   - 📋 Checklist pré-production si demandée (`ROADMAP.md:178-216`)

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

## 🇫🇷 Conformité légale française

- **Code Pénal Art. 323-1** : Accès frauduleux = 2 ans prison + 60k€
- **RGPD/CNIL** : Notification sous 72h si violation données personnelles
- **Hébergement données** : Serveurs UE uniquement (souveraineté)
- **Cookies** : Consentement EXPLICITE avant tracking (pas d'opt-out)

## 📚 Références aux documents existants

### Audit précédent (Octobre 2025)
**Fichier** : `docs/audits/security-audit-2025-10.md` (762 lignes)
- **Score final** : 95/100 après corrections P1
- **Vulnérabilités** : 0 P0, 3 P1, 9 P2
- **Points forts** : RGPD 90/100, Rate limiting, CSRF, Validation Zod
- **Roadmap en 6 phases** : Corrections (3j) → CSP (4j) → Logging (7j) → Optimisations (7j) → Dissuasion (8j) → Certification

### Roadmap sécurité actuelle
**Fichier** : `ROADMAP.md` (lignes 50-219)
- **Score actuel** : 7.0/10 → Objectif 9.5/10
- **Phase 1 (2h)** : CORS, secrets, logs, validation Zod
- **Phase 2 (3h)** : Helmet, trust proxy, DB SSL, scripts secrets
- **Phase 3 (2h)** : `/security/health`, audit logs
- **Checklist pré-prod** : Lignes 178-216 (config + tests + monitoring)

### Checklists de référence
- `/ai/checklists/securite_auth.md` - Tokens, routes sensibles, RGPD, protections
- `/ai/checklists/rgpd.md` - Consentement, droits utilisateurs, minimisation

## Exemples d'utilisation

```bash
/security                    # Audit complet + comparaison vs octobre 2025
/security auth               # Audit module auth + vérif P1-3 (validation password)
/security roadmap            # Roadmap à jour basée sur ROADMAP.md
/security harden             # Implémenter honeypots + security.txt (audit oct. lignes 595-693)
/security pre-prod           # Checklist ROADMAP.md:178-216 + tests automatisés
/security status             # Comparer état actuel vs audit octobre (P1/P2 résolus ?)
/security apps/api/src/middleware/auth.ts  # Audit fichier spécifique
```

---

**ACTION IMMÉDIATE** : Lance l'agent cybersecurite avec le Task tool :

```
Task tool:
- subagent_type: cybersecurite
- description: Audit de sécurité Blob
- prompt: "Effectue un audit de sécurité avec les arguments : '$ARGUMENTS'.

**DOCUMENTS DE RÉFÉRENCE OBLIGATOIRES** :
1. `docs/audits/security-audit-2025-10.md` - Audit octobre 2025 (Score: 95/100)
   - Vulnérabilités P1 : [P1-1] ✅ Sentry, [P1-2] ✅ CSP, [P1-3] ⚠️ Password validation
   - Vulnérabilités P2 : [P2-1] à [P2-9] - Vérifier statut
   - Roadmap en 6 phases (lignes 568-603)
   - Mesures proactives : honeypots (607-636), IP blacklisting (640-661), security.txt (664-692)

2. `ROADMAP.md` (lignes 50-219) - Sécurité Production-Ready
   - Phase 1 (2h) : CORS, secrets, logs, validation (lignes 63-137)
   - Phase 2 (3h) : Helmet, trust proxy, DB SSL (lignes 138-156)
   - Phase 3 (2h) : Monitoring, audit logs (lignes 158-176)
   - Checklist pré-prod (lignes 178-216)

3. Checklists : `/ai/checklists/securite_auth.md`, `/ai/checklists/rgpd.md`

**SI AUCUN ARGUMENT** (audit complet) :
1. Lire et analyser `docs/audits/security-audit-2025-10.md`
2. Vérifier STATUT de TOUTES les vulnérabilités P1/P2 :
   - [P1-3] Validation password : `apps/api/src/modules/auth/auth.controller.ts:14`
   - [P2-1] à [P2-9] : Vérifier si implémentés
3. Comparer score actuel vs 95/100 (octobre 2025)
4. Scanner : npm audit, OWASP Top 10, secrets, CORS, CSP, rate limiting
5. Rapport avec :
   - Évolution depuis octobre 2025
   - Nouvelles vulnérabilités détectées
   - Statut des correctifs précédents
   - Score actuel /10 + roadmap pour atteindre 9.5/10

**SI ARGUMENT SPÉCIFIQUE** :
- 'auth' → Module auth + vérifier [P1-3] password validation
- 'api' → Endpoints API + rate limiting (profils AUTH/REGISTRATION/EMAIL_VERIFICATION)
- 'frontend' → Next.js + vérifier [P1-2] CSP sans unsafe-inline
- 'roadmap' → Générer roadmap basée sur `ROADMAP.md` Phases 1-3
- 'harden' → Implémenter honeypots + security.txt (audit oct. lignes 595-693)
- 'pre-prod' → Checklist `ROADMAP.md:178-216` + tests automatisés
- 'status' → Comparer état actuel vs audit octobre (tableau P1/P2 résolus)
- chemin fichier → Audit ciblé

**SORTIE OBLIGATOIRE** :
- 📈 Évolution vs octobre 2025 (score + vulnérabilités résolues)
- 🚨 Nouvelles vulnérabilités P0/P1/P2 avec code de correction
- ✅ Statut des 12 vulnérabilités connues (P1-1 à P2-9)
- 🛡️ Score /10 + roadmap pour atteindre 9.5/10
- 📋 Checklist pré-prod si demandée

**EXIGENCE** : ZÉRO vulnérabilité P0/P1 avant production."
```
