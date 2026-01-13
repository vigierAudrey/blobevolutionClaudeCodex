# HTTP strict vs legacy (web client)

## Strict mode (requestStrict)
- En-tête requis : `X-API-ENVELOPE: 1`
- Réponses obligatoirement enveloppées :
  - Succès : `{ ok: true, data, meta? }` validé par Zod strict
  - Erreur : `{ ok: false, error: { code: ERROR_CODES, message, details? } }` validé par Zod strict
- Échec systématique si : absence d’enveloppe, JSON invalide, schéma invalide, `data` invalide.
- Aucune dépendance à “pas d’erreur” ou à la vérité d’un champ : succès = `ok:true` + schéma valide uniquement.

## Quand utiliser quoi ?
- P0 (write critique : auth, décisions, booking, reporting, modération) → **strict obligatoire**.
- P1 (write sensible) → strict recommandé.
- P2 (read/analytics/affichage) → strict optionnel.
- Legacy helpers (`request`) : tolérés uniquement pour les callsites non migrés ; pas de fallback implicite depuis le strict.

## Bonnes pratiques
- Préférer `requestStrict(endpoint, options, dataSchema)` avec schéma Zod strict.
- Ne jamais baser la logique sur `response.ok` seul ou sur `JSON.parse` sans validation.
- Utiliser `ERROR_CODES` pour le contrôle de flux ; `CLIENT_TIMEOUT` reste un code côté client (WS) et ne fait pas partie d’`ERROR_CODES`.

### Exemples
**Bad** (legacy implicite) :
```ts
const res = await fetch(url);
const data = await res.json();
// suppose que l’absence d’erreur == succès
```

**Good** (strict, fail-closed) :
```ts
const data = await requestStrict(
  '/matching/decisions',
  { method: 'POST', body: JSON.stringify(payload) },
  matchDecisionsDataSchema
);
```

## Inventaire des endpoints web
| Endpoint | Méthode | Mode | Risque | Notes |
| --- | --- | --- | --- | --- |
| /matching/decisions | POST | Strict (requestStrict) | P0 | Batch décisions |
| /booking/requests/:id/decision | POST | Strict (requestStrict) | P0 | Décision booking |
| /reports/profile | POST | Strict (requestStrict) | P0 | Signalement profil |
| /booking/availability | POST | Strict (requestStrict) | P0 | Création dispo |
| /booking/availability/:id | PATCH/DELETE | Strict (requestStrict) | P0 | Mise à jour / suppression dispo |
| /conversations/:id/messages | POST | Strict (requestStrict) | P0 | Envoi message HTTP fallback |
| /conversations/open | POST | Strict (requestStrict) | P0 | Ouverture conversation |
| /conversations/:id/messages | POST | Legacy | P0 | Envoi message HTTP (à migrer ou confirmer usage) |
| Autres calls read (search, lists…) | GET/POST | Legacy | P1/P2 | À migrer selon priorité |

## Guardrails
- Commentaire dans `requestStrict.ts` : ne pas bypasser le strict pour les writes P0.
- (Option) Script d’audit : `./scripts/audit-web-fetch.sh` liste les usages de `fetch(` dans `apps/web` pour repérer les callsites à migrer.

## Règles d’erreurs
- `ERROR_CODES` uniquement pour les enveloppes HTTP strictes.
- `CLIENT_TIMEOUT` est réservé au client WS (non inclus dans `ERROR_CODES`).

## Comment migrer un callsite
1) Définir les schémas Zod stricts (body + data).
2) Appeler `requestStrict` avec `X-API-ENVELOPE` (géré automatiquement).
3) Tester : succès enveloppé, erreur enveloppée, réponse legacy rejetée, schéma invalide rejeté.
