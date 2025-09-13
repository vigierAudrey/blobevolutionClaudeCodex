# Handshake Claude Code × Codex

Objectif
- Collaborer sans collision: qui fait quoi, quand activer Claude Code, format attendu.

Principes
- Source of truth pour commits: Codex (vous). Claude Code ne push pas; il propose des diffs.
- Claude Code parle via personas spécialisées (ai/personas/*) et templates (ai/prompts/*).
- Toujours référencer des chemins de fichiers et proposer des patches minimaux.

Quand activer Claude Code
- Bloqué sur un bug → persona `debugger.md` + template `debug_request.md`.
- Revue de sécurité/qualité → `relecteur_pr.md` + `review.md`.
- Tests manquants → `testeur.md` + `tests.md`.
- Perf douteuse → `performance.md` + `perf_request.md`.
- Migrations sensibles → `migrations_db.md` + `migration_plan.md`.
- Docs/communication → `docs_scribe.md` + `docs_request.md`.
- Impl rapide multi‑fichiers → `yolo.md` + `yolo_task.md` (avec garde‑fous).

Format de réponse attendu (Claude Code)
1) Résumé du contexte et hypothèses (≤ 3 lignes)
2) Diffs proposés (groupés par feature)
3) Tests (si applicable)
4) Commandes de validation
5) Risques/impacts + TODO

Garde‑fous
- Pas de changement de secrets/infra prod.
- Pas de refactor global hors scope.
- Compat ascendante privilégiée; migrations sécurisées.

Handoff
- Codex applique/ajuste les diffs et exécute la validation.
- Si divergence, Codex renvoie un court feedback et réitère avec Claude Code.

