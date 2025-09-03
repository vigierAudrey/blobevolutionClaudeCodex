Revue Code – Checklist

Sécurité
- Inputs validés avec Zod
- Auth/JWT gérés proprement (exp, alg, secret)
- Rate limiting sur routes sensibles
- CSRF + headers sécurité en place si applicable

Qualité
- TS strict, pas de any
- Erreurs gérées (statuts, messages) + logs utiles
- Nommage clair, fonctions courtes

Perfs/DB
- Pas de N+1, pagination
- Index nécessaires (email, dates, relations)

Tests & Migrations
- Tests couvrent succès + erreurs
- Migrations idempotentes + rollback
