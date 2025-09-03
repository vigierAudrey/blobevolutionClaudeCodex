# Dossier IA – Blobinfini (Claude Codex)

Ce dossier prépare l’utilisation d’IA spécialisées (Claude, etc.) pour livrer le MVP en commençant par le module Auth intégré, conformément au README.

Contenu utile:

- personas/: rôles IA spécialisés (architecte, dev, relecteur, testeur, etc.)
- prompts/: templates réutilisables par tâche
- checklists/: contrôles qualité (sécurité, tests, RGPD, revue)
- context/: briques de contexte projet et plan MVP Auth

Règle d’or pour toutes les IA

- Toujours proposer les tests (unitaires/intégration) avec le code.
- Ne pas “finir” tant que les tests ne passent pas localement ou tant qu’un humain n’a pas confirmé la validation si l’exécution est impossible.
- Préférer des diffs minimaux, sûrs, et bien expliqués.

Usage rapide (exemples)

- Choisir un rôle dans personas/ (ex: Architecte) et coller ses instructions comme “system prompt” dans Claude.
- Utiliser un template dans prompts/ (ex: implementation.md) et remplir Contexte, Objectif, Contraintes, Sortie attendue, Critères d’acceptation.
- Joindre des extraits de fichiers pertinents et référencer context/\*.md.

Étapes conseillées (MVP Auth)

1. Valider architecture (context/architecture.md) et décisions (context/decisions.md)
2. Écrire plan détaillé (context/mvp_auth_plan.md) avec critères de Done
3. Implémenter par petites PRs: register, login, refresh, logout, reset password
4. Revue stricte via checklists/ + tests via prompts/tests.md
5. Boucler jusqu’à validation (tests verts + critères OK)

Apprentissage

- Utiliser le persona “Coach Pédago” pour expliquer simplement chaque étape.
