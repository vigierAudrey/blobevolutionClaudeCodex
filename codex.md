# Codex - Gouvernance IA (minimal)

Source de verite: `ai/README.md` et `ai/policies/*`.

## Regles Codex
- **Preuves ou silence**: toute affirmation d'etat actuel doit citer un fichier lu ou une commande executee.
- **Portee minimale**: pas de refactor massif sans demande explicite.
- **Securite**: pas de secrets/PII dans logs, pas de bypass des controles serveur.
- **Dependances**: aucune nouvelle dependance sans justification explicite.
- **Prisma**: `prisma db push --accept-data-loss` autorise uniquement en local ou CI de test; **interdit en production / CI prod**.

En cas d'ambiguite: STOP et demande de preuves.
