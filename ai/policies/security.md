# Politique Securite IA

## Preuves ou silence
- Appliquer la regle "preuves ou silence" de `ai/policies/governance.md` pour toute affirmation d'etat securite.

## Regles de base (non negociables)
- **Secrets/PII**: jamais en clair dans logs, tests, fixtures, ou messages. Redaction obligatoire.
- **Logs**: pas de `console.*` en production; utiliser le logger securise existant.
- **RBAC server-side**: controles d'acces cote serveur uniquement. Le front ne suffit jamais.
- **Validation input**: DTO allowlist + validation stricte (body, query, params). Refuser l'input non valide par defaut.
- **Rate limiting**: requis sur endpoints sensibles (auth, reset, upload, actions critiques).
- **Auth/session**: tokens courts, rotation si applicable, stockage prudent (pas de secrets client).
- **Pas de bypass**: ne jamais affaiblir Zod, RBAC, CSP, CSRF ou headers securite pour "faire passer".

## Duplications et contradiction
- Si une regle securite differe ailleurs, `ai/policies/security.md` prime.
