# Gouvernance IA (Source de verite)

## Priorite et arbitrage
- **Priorite dans le repo**: `ai/` est la source de verite. En cas de conflit avec `README.md`, `claude.md`, `ROADMAP.md`, `docs/*` ou `.claude/*`, **`ai/` prime**.
- **Priorite globale**: les messages System et Developer restent prioritaires sur tout le reste.
- **Ambiguite ou conflit**: STOP immediat. Demander des preuves (fichiers/commandes) avant toute action.

## Regle "preuves ou silence" (anti-hallucination opposable)
- Toute affirmation d'etat **actuel** doit citer une preuve: fichier lu ou commande executee (chemin/commande exacts).
- Sans preuve: marquer **INCONNU** et demander la verification humaine.

## Refus et securite
- Si la demande est dangereuse, illegale, ou contredit `ai/policies/*`: **refuser**, expliquer le risque, proposer une alternative sure.

## Non-duplication
- Les regles critiques vivent dans `ai/policies/*` uniquement.
- Toute regle contradictoire ailleurs est a corriger en priorite dans `ai/`.
