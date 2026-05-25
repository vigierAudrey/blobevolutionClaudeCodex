# Contact Workflow — Documentation anti-régression

> Sprints C11–C17 · Dernière révision : 2026-05-24

## 1. Vue d'ensemble

Le workflow contact permet à un **pro** de demander l'autorisation de rejoindre la conversation d'un **rider**. Les riders de la conversation votent ; le pro est ajouté seulement si tous acceptent.

```
PRO                       RIDER(S)                    SYSTÈME
 │                           │                            │
 │─ POST /contact/request ──►│                            │
 │                           │◄── GET /contact/pending ───│
 │                           │─ POST /contact/respond ───►│
 │                           │   (répété par chaque rider)│
 │                           │                            │─► updateMany status=PENDING→ACCEPTED/REJECTED
 │                           │                            │─► conversationMember.createMany (si ACCEPTED)
 │◄── GET /contact/requests ─│                            │
```

---

## 2. Cycle de vie d'un ContactRequest

### Statuts

| Statut     | Signification                                    |
|------------|--------------------------------------------------|
| `PENDING`  | En attente de votes. Visible dans `/contact/pending` pour les riders qui n'ont pas encore voté. |
| `ACCEPTED` | Tous les riders ont répondu ACCEPT. Le pro a été ajouté à la conversation. |
| `REJECTED` | Au moins un rider a répondu REJECT. Le pro n'est pas ajouté. |

### Transitions autorisées

```
PENDING → ACCEPTED  (tous les riders ont voté ACCEPT)
PENDING → REJECTED  (≥ 1 rider vote REJECT)
```

### Transitions interdites

- `ACCEPTED → *` : impossible, le vote est immuable.
- `REJECTED → *` : impossible, idem.
- Un pro ne peut envoyer **qu'une seule** demande par conversation, quel que soit le statut précédent (`@@unique([proUserId, conversationId])`).
- Un rider ne peut voter **qu'une seule fois** par demande (`@@unique([contactRequestId, riderUserId])`).

---

## 3. Endpoints

### POST /contact/request

**Qui :** PRO uniquement (`role = PRO`, vérifié server-side).

**Input :**
```json
{ "conversationId": "uuid", "message": "texte optionnel ≤ 500 chars" }
```

**DTO réponse (champs autorisés uniquement) :**
```json
{
  "success": true,
  "contactRequest": {
    "id": "uuid",
    "message": "string | null",
    "proName": "businessName ou 'Professionnel'",
    "createdAt": "ISO 8601"
  }
}
```

**Champs interdits dans la réponse :** `proUserId`, `conversationId`, `lessonRequestId`, `status`, `email`, tout objet `user`/`riderProfile`/`conversation`.

**Rate limit :** 5 demandes / 10 min / userId.

**IDOR :** Réponse 404 neutre si le pro n'est pas participant du match (même message que "conversation not found").

---

### GET /contact/pending

**Qui :** tout utilisateur authentifié + email vérifié (filtré par membership).

**DTO réponse :**
```json
{
  "requests": [
    {
      "id": "uuid",
      "message": "string | null",
      "createdAt": "ISO 8601",
      "conversationId": "uuid",
      "proName": "businessName ou 'Professionnel'"
    }
  ]
}
```

**Champs interdits :** `proUserId`, `email`, `riderProfile`, `members`, `lessonRequestId`, tout champ de coordonnées.

**Limite :** 50 résultats maximum, ordre anti-chronologique.

**Rate limit :** 120 requêtes / min / userId.

**Filtre automatique :** n'affiche que les demandes `status = PENDING` pour lesquelles l'utilisateur courant est membre de la conversation et n'a pas encore voté.

---

### POST /contact/respond

**Qui :** rider membre de la conversation (le pro qui a créé la demande ne peut pas voter).

**Input :**
```json
{ "contactRequestId": "uuid", "response": "ACCEPT | REJECT" }
```

**DTO réponse :**
```json
{
  "success": true,
  "status": "PENDING | ACCEPTED | REJECTED",
  "message": "texte lisible en français"
}
```

**Rate limit :** 20 réponses / 10 min / userId.

**Codes d'erreur 409 :**
- `ALREADY_RESPONDED` : le rider a déjà voté (vote immuable).
- `CONTACT_REQUEST_ALREADY_RESOLVED` : la demande est déjà finalisée (+ champ `status`).
- `CONCURRENT_UPDATE` : échec de sérialisation PostgreSQL P2034 — retryable.

**Concurrence :** transaction `Serializable` + `CREATE` (pas `upsert`) + `updateMany WHERE status=PENDING` → aucun double-fire possible.

---

### GET /contact/requests

**Qui :** PRO uniquement.

**DTO réponse :**
```json
{
  "requests": [
    {
      "id": "uuid",
      "status": "PENDING | ACCEPTED | REJECTED",
      "message": "string | null",
      "createdAt": "ISO 8601",
      "conversationId": "uuid",
      "riderName": "displayName ou 'Rider'"
    }
  ]
}
```

**Champs interdits :** `riderUserId`, `email`, coordonnées, `riderProfile` complet, `members` list, `lessonRequestId`.

**Limite :** 50 résultats maximum, ordre anti-chronologique.

**Rate limit :** 60 requêtes / min / userId.

---

## 4. Règles de sécurité — ne jamais régresser

### AuthN / AuthZ
- `requireAuth` + `requireVerifiedEmail` appliqués au niveau du router (ligne 10 du controller) : aucune route ne peut être appelée sans token valide + email vérifié.
- Le `userId` est **toujours** extrait du JWT server-side (`(req as any).user?.id`), jamais du body/query.
- Les vérifications de rôle PRO se font via un `findUnique` sur `User.role`, pas via un champ client.

### IDOR
- POST /contact/request : si `userId` n'est pas `userOneId` ou `userTwoId` du match → 404 neutre (même message que "conversation not found").
- POST /contact/respond : vérification que l'utilisateur est dans `conversation.members` + qu'il n'est pas le `proUserId`.

### TOCTOU
- Doublon de demande : garde applicative (findFirst) + contrainte DB `@@unique([proUserId, conversationId])` + catch P2002 → 409.
- Vote doublon : garde applicative (findUnique sur `contactRequestId_riderUserId`) + contrainte DB `@@unique([contactRequestId, riderUserId])` + catch P2002 → 409.
- Transition d'état : `updateMany WHERE status=PENDING` → seule une transaction réussit en cas de concurrent.

### Data minimization
- Tous les `prisma.*` utilisent `select` explicite — jamais `include` sans select ni fetch complet.
- `lessonRequestId` est calculé server-side, jamais retourné dans les réponses.
- Aucune adresse email, mot de passe, IP, ou coordonnée dans les réponses.

### Logging
- `secureLogger` uniquement (pas de `console.*` avec PII).
- Les logs d'audit incluent : `CONTACT_REQUEST_CREATED`, `CONTACT_RESPOND`, `CONTACT_RESPOND_ERROR`, `CONTACT_PENDING_ERROR`, `CONTACT_REQUESTS_LIST_ERROR`.
- Les logs ne contiennent jamais le message textuel envoyé par le pro (potentiellement PII).

---

## 5. Rate limits récapitulatifs

| Endpoint                 | Fenêtre | Limite | Clé            |
|--------------------------|---------|--------|----------------|
| POST /contact/request    | 10 min  | 5      | userId         |
| GET /contact/pending     | 1 min   | 120    | userId         |
| POST /contact/respond    | 10 min  | 20     | userId         |
| GET /contact/requests    | 1 min   | 60     | userId         |

---

## 6. Commandes à lancer avant toute modification

```bash
# Typecheck API complet
pnpm --filter @blobinfini/api exec tsc --noEmit

# Suite contact complète
NODE_ENV=test pnpm --filter @blobinfini/api exec jest --testPathPatterns "contact" --runInBand

# Suite par fichier (pour cibler)
NODE_ENV=test pnpm --filter @blobinfini/api exec jest --testPathPatterns "contact.e2e" --runInBand
NODE_ENV=test pnpm --filter @blobinfini/api exec jest --testPathPatterns "contact.abuse" --runInBand
NODE_ENV=test pnpm --filter @blobinfini/api exec jest --testPathPatterns "contact.respond.statemachine" --runInBand
NODE_ENV=test pnpm --filter @blobinfini/api exec jest --testPathPatterns "contact.create.dataminimization" --runInBand
NODE_ENV=test pnpm --filter @blobinfini/api exec jest --testPathPatterns "contact.pending.dataminimization" --runInBand
NODE_ENV=test pnpm --filter @blobinfini/api exec jest --testPathPatterns "contact.requests.dataminimization" --runInBand
NODE_ENV=test pnpm --filter @blobinfini/api exec jest --testPathPatterns "contact.pending.openapi.contract" --runInBand

# Valider le schéma Prisma (avant toute migration)
pnpm --filter @blobinfini/database exec prisma validate
```

---

## 7. Ce que prouvent les tests existants

| Fichier de test                          | Ce qu'il garantit |
|------------------------------------------|-------------------|
| `contact.e2e.test.ts`                    | Flux complet create→respond ACCEPT/REJECT ; IDOR guard ; wantsLesson check |
| `contact.abuse.test.ts`                  | Doublon demande ; re-soumission ; IDOR cross-pro ; race conditions |
| `contact.respond.statemachine.test.ts`   | Vote immuable ; ALREADY_RESPONDED ; ALREADY_RESOLVED ; concurrence Serializable ; pro self-respond interdit |
| `contact.create.dataminimization.test.ts`| DTO create : absence email/objects/coordonnées ; fallback proName |
| `contact.pending.dataminimization.test.ts`| DTO pending : absence email/userId/riderProfile |
| `contact.requests.dataminimization.test.ts`| DTO requests : absence email/coordonnées/riderProfile complet |
| `contact.pending.openapi.contract.test.ts`| OpenAPI strict : additionalProperties:false ; required exact ; champs sensibles absents ; 409 codes respond |

---

## 8. Choses à ne jamais faire

- Ne **jamais** ajouter un champ `include: { user: true }` ou `include: { conversation: true }` sans `select` strict dans les endpoints contact.
- Ne **jamais** retourner `proUserId`, `lessonRequestId`, ou tout champ `email` dans un DTO contact.
- Ne **jamais** utiliser `upsert` pour les votes — les votes sont immuables par design (`CREATE` uniquement).
- Ne **jamais** lever la contrainte `@@unique([proUserId, conversationId])` ou `@@unique([contactRequestId, riderUserId])` sans remplacer par un mécanisme équivalent.
- Ne **jamais** passer la transaction `/contact/respond` en `ReadCommitted` — la sémantique `Serializable` est load-bearing pour la machine d'état.
- Ne **jamais** retirer `additionalProperties: false` des schémas OpenAPI contact sans mettre à jour les tests de contrat correspondants.
