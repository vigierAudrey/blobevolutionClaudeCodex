# Guide Agent Cybersécurité - Blobinfini

## 🎯 Vue d'ensemble

L'agent cybersécurité est un expert offensif configuré pour protéger activement le projet Blobinfini contre toute tentative de hacking, exploitation ou intrusion.

## 📍 Localisation

- **Agent** : `.claude/agents/cybersecurite.md`
- **Slash command** : `.claude/commands/security.md`
- **Checklists** : `/ai/checklists/securite_auth.md`, `/ai/checklists/rgpd.md`

## 🚀 Utilisation

# Audit d'un fichier spécifique
/security apps/api/src/middleware/auth.ts
```

### Via délégation automatique

Claude Code peut déléguer automatiquement à l'agent cybersécurité quand vous demandez :
- "Audite la sécurité du projet"
- "Y a-t-il des vulnérabilités dans ce code ?"
- "Prépare le projet pour la production"
- "Crée une roadmap de sécurité"

## 🛡️ Capacités de l'Agent

### 1. Audit de Sécurité
- Scan automatique : `npm audit`, secrets hardcodés, headers manquants
- Analyse statique : SQL injection, XSS, CSRF, validation manquante
- Analyse dynamique : rate limiting, expiration tokens, logs
- Conformité RGPD : consentement, export, suppression

### 2. Détection & Réponse aux Intrusions
- Monitoring temps réel des accès suspects
- Honeypots pour détecter scanners automatisés
- IP blacklisting dynamique
- Forensics et traçabilité complète

### 3. Défense Proactive
- Rate limiting intelligent avec bannissement
- Headers de sécurité avancés (CSP, HSTS, Permissions-Policy)
- Anti-bot measures (CAPTCHA, challenge-response)
- Minimisation de surface d'attaque

### 4. Dissuasion & Transparence
- `security.txt` avec politique de divulgation responsable
- Legal notices sur endpoints sensibles
- Logging visible pour dissuader les attaquants
- Post-mortems publics d'incidents

### 5. Roadmaps de Sécurité
- **MVP Pre-Production** : 21 jours pour sécuriser avant déploiement
- **Incident Response** : 7 jours pour répondre à une vulnérabilité critique
- **Hardening Continu** : 3 mois d'amélioration progressive

## 📊 Livrables de l'Agent

### Rapport d'Audit
```markdown
# Audit Sécurité - [Date]

## Résumé exécutif
- Niveau de risque global : [CRITIQUE/ÉLEVÉ/MOYEN/FAIBLE]
- Vulnérabilités : X P0, Y P1, Z P2

## Vulnérabilités détectées
### [P0] Titre
- Localisation : fichier:ligne
- Description : ...
- Impact : ...
- Exploitation : ...
- Recommandation : [code de correction]

## Conformité RGPD
- [✓] Consentement
- [✗] Export des données
...

## Actions prioritaires
1. Corriger P0 immédiatement
2. ...
```

### Roadmap de Sécurité
- Contexte et niveau de risque
- Phases (6 phases sur 21-30 jours)
- Livrables et deadlines
- Métriques de succès
- Risques et mitigations
- Budget et ressources

### Code de Correction
- Patches prêts à l'emploi
- Tests de validation
- Documentation des changements

## 🎯 Priorisation des Vulnérabilités

- **P0 (CRITIQUE)** : Corriger immédiatement, bloquer déploiement
  - Secrets hardcodés
  - Injection SQL/XSS direct
  - Auth bypassable
  - Données sensibles exposées

- **P1 (IMPORTANTE)** : Corriger avant production
  - Rate limiting manquant
  - Validation inputs incomplète
  - Headers de sécurité manquants
  - RGPD non conforme

- **P2 (MINEURE)** : Améliorations recommandées
  - Logs trop verbeux
  - Dépendances obsolètes (non vulnérables)
  - Documentation sécurité manquante

## 🔐 Règles Strictes de l'Agent

❌ **JAMAIS** proposer de code vulnérable "temporairement"
❌ **JAMAIS** minimiser une vulnérabilité P0/P1
❌ **JAMAIS** accepter "TODO: fix security later"

✅ **TOUJOURS** proposer une alternative sécurisée
✅ **TOUJOURS** documenter les compromis de sécurité
✅ **TOUJOURS** tester les correctifs avant de proposer

## 📚 Ressources

- **OWASP Top 10** : https://owasp.org/www-project-top-ten/
- **CWE Top 25** : https://cwe.mitre.org/top25/
- **RGPD (CNIL)** : https://www.cnil.fr/
- **Checklist Auth** : `/ai/checklists/securite_auth.md`
- **Checklist RGPD** : `/ai/checklists/rgpd.md`

## 🧪 Tests Rapides

### Test 1 : Audit complet
```bash
/security
```

### Test 2 : Audit module auth
```bash
/security auth
```

### Test 3 : Créer roadmap pré-production
```bash
/security roadmap
```

### Test 4 : Implémenter mesures dissuasives
```bash
/security harden
```

## 🚨 En Cas d'Incident

1. **Invoquer immédiatement** : `/security roadmap`
2. **Suivre le plan de réponse** : Phase 1-6 de la roadmap "Incident Response"
3. **Notifier** : équipe + CNIL si violation RGPD (sous 72h)
4. **Documenter** : post-mortem transparent

## 💡 Conseils

- **Auditez régulièrement** : avant chaque PR majeure, avant déploiement
- **Soyez transparent** : documenter toutes les vulnérabilités découvertes
- **Priorisez** : toujours traiter les P0 en premier
- **Éduquez-vous** : lisez les explications OWASP/CWE fournies par l'agent
- **Testez** : valider que les corrections fonctionnent avant de commiter

---

**Aucun compromis sur la sécurité. Protégeons Blobinfini et ses utilisateurs.**
