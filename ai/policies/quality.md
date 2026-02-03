# Politique Qualite IA

## Preuves ou silence
- Appliquer la regle "preuves ou silence" de `ai/policies/governance.md` pour toute affirmation d'etat qualite/tests.

## Refactor et portee
- **Pas de refactor massif** sans demande explicite.
- Les changements doivent etre **minimaux** et lies au besoin.

## Tests et realisme
- Tests realistes, pas de contournement (skip/comment) pour "faire passer".
- Si les tests ne peuvent pas etre executes, le signaler explicitement et expliquer pourquoi.

## Performance (gate minimal)
- Pas de requetes non bornees: pagination/limites obligatoires sur listes.
- Eviter N+1: preferer prefetch/join/aggregation selon la couche.
- Observer les index quand un chemin critique est touche.

## Dependances
- Aucune nouvelle dependance sans justification, alternatives ecartees, et impact clair.

## Commandes sensibles
- `prisma db push --accept-data-loss` **autorise uniquement en local ou CI de test**. **Interdit en production / CI prod**.
