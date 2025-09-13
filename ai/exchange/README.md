Boîte aux lettres – Codex ⇄ Claude Code

But

- Permettre un dialogue fluide sans confusion: échanges par fichiers versionnés.

Structure

- requests/: demandes structurées envoyées à Claude Code (copier un template de ai/prompts/\*).
- proposals/: réponses/diffs de Claude Code (patchs .diff ou .md structurés).

Conventions

- Nommer les demandes: `YYYYMMDD-HHMM-<sujet>.md`.
- Nommer les propositions: `YYYYMMDD-HHMM-<sujet>.diff` (unified diff) ou `.md` si analyse.
- Toujours inclure: Contexte, Hypothèses, Diffs, Tests, Commandes, Risques/TODO.

Cycle

1. Codex crée `requests/<…>.md` avec un template (debug/perf/migration/yolo…).
2. Claude Code dépose `proposals/<…>.diff|.md`.
3. Codex applique/ajuste les diffs et valide; feedback succinct retourné dans une nouvelle demande si besoin.

Notes

- Les diffs peuvent être appliqués via `git apply proposals/<file>.diff` (ou copiés manuellement).
- Voir `ai/handbook/claude_code_handshake.md` pour le format attendu et garde‑fous.
