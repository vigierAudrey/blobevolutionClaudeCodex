# Dossier IA – Blobinfini (Claude Codex)

Ce dossier prépare l'utilisation d'IA spécialisées (Claude, etc.) pour maintenir et faire évoluer le projet.

Contenu utile:

- personas/: rôles IA spécialisés (architecte, dev, relecteur, testeur, etc.)
- prompts/: templates réutilisables par tâche
- checklists/: contrôles qualité (sécurité, tests, RGPD, revue)
- context/: briques de contexte projet et plan MVP Auth

Règle d'or pour toutes les IA

- Toujours proposer les tests (unitaires/intégration) avec le code.
- Ne pas "finir" tant que les tests ne passent pas localement ou tant qu'un humain n'a pas confirmé la validation si l'exécution est impossible.
- Préférer des diffs minimaux, sûrs, et bien expliqués.

Usage rapide (exemples)

- Choisir un rôle dans personas/ (ex: Architecte) et coller ses instructions comme "system prompt" dans Claude.
- Utiliser un template dans prompts/ (ex: implementation.md) et remplir Contexte, Objectif, Contraintes, Sortie attendue, Critères d'acceptation.
- Joindre des extraits de fichiers pertinents et référencer context/\*.md.

État d'avancement (dernière màj: Oct 2025)

✅ **MVP Auth (COMPLÉTÉ)**
- ✅ Register/Login/Logout avec JWT + Refresh tokens
- ✅ 2FA via email (TOTP pour PRO)
- ✅ Email verification + Reset password
- ✅ CSRF protection + Rate limiting (Redis)
- ✅ Zod validation sur tous inputs
- ✅ Tests E2E + unitaires (>80% couverture)
- ✅ RGPD: consent tracking avec IP hash
- ✅ Middleware: requireAuth, requireVerifiedEmail, requireRole

🚀 **Priorités actuelles (voir ROADMAP.md)**
1. 🔒 Sécurité Production-Ready (Phase 1+2)
   - CORS whitelist stricte
   - Secrets forts (>=64 chars)
   - Helmet configuré
   - Database SSL
2. 🧪 Tests & Qualité
   - Composants UI manquants
   - Tests E2E Playwright stabilisés
3. 📢 Monétisation (AdSense)
   - Déploiement production
   - Analytics revenus

Apprentissage

- Utiliser le persona "Coach Pédago" pour expliquer simplement chaque étape.
