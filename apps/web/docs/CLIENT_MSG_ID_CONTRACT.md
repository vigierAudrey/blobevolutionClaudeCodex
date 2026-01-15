# clientMsgId Idempotence Contract

Contrat strict pour l'idempotence des messages via `clientMsgId` (RFC4122 UUID v4).

---

## Qui génère clientMsgId

**Composant UI** (`app/messages/[id]/page-websocket.tsx`):
- Génère UNE fois par message lors de l'action utilisateur
- Fonction: `generateClientMsgId()` → UUID v4
- Stocké dans `OptimisticMessage.clientMsgId`
- **Invariant**: même ID réutilisé sur retry (JAMAIS régénéré)

```typescript
// Initial send
const clientMsgId = generateClientMsgId(); // ex: "550e8400-e29b-41d4-a716-446655440000"
const result = await sendMessage(content, type, meta, clientMsgId);

// Retry (same clientMsgId)
const retryResult = await sendMessage(content, type, meta, clientMsgId);
```

---

## Qui le transporte

**Hook React** (`hooks/useChat.ts`):
- Accepte `clientMsgId?: string` en paramètre optionnel
- Si absent: génère UUID v4 (crypto.randomUUID ou fallback)
- Si présent: utilise tel quel (retry)
- Transmet WS + HTTP fallback avec **exactement le même ID**

```typescript
// WS payload
socket.emit('send-message', { conversationId, content, type, clientMsgId });

// HTTP fallback (CLIENT_TIMEOUT uniquement)
apiClient.sendMessageWithStatus(conversationId, { type, content, clientMsgId });
```

---

## Qui l'interprète

**Backend** (`apps/api/src/modules/chat/conversations.controller.ts`, `socket.ts`):
- Composite unique: `(conversationId, clientMsgId)`
- Pattern: create-then-fallback (pas upsert)
- Détecte replay via Prisma `P2002` (unique constraint)
- Retourne:
  - **WS**: `{ ok: true, data: {...}, created: boolean }`
  - **HTTP**: Status `201 Created` ou `200 OK`

```typescript
// Backend behavior
POST /conversations/:id/messages { clientMsgId: "uuid" }
→ 201 Created (première fois)
→ 200 OK (replay détecté, message existant retourné)
```

---

## Signification exacte de `created`

### Flag `created` (WS + HTTP)

| Source | Format | Valeur | Signification |
|--------|--------|--------|---------------|
| WS ACK | `data.created: boolean?` | `true` | Message créé en DB (premier envoi) |
| WS ACK | `data.created: boolean?` | `false` | Replay détecté, message existant retourné |
| WS ACK | `data.created: boolean?` | `undefined` | Backend ancien (backward compat) |
| HTTP | `status: number` | `201` | Message créé (dérivé: `created: true`) |
| HTTP | `status: number` | `200` | Replay détecté (dérivé: `created: false`) |
| HTTP | `status: number` | autre | Indéterminé (dérivé: `created: undefined`) |

### Usage du flag `created`

**❌ JAMAIS utilisé pour**:
- Afficher/cacher un message
- Décider si supprimer optimistic
- Logique de réconciliation

**✅ UNIQUEMENT pour**:
- Telemetry / observabilité
- Debug / analytics
- Information secondaire (UX informative si besoin)

**Règle stricte**: `clientMsgId` = clé de vérité, `created` = metadata

---

## Ce qui est garanti

### Invariants strictement garantis

1. **Unicité par conversation**
   - `clientMsgId` unique dans une conversation donnée
   - Backend: constraint `unique(conversationId, clientMsgId)`

2. **Génération UNE fois**
   - Composant UI génère lors de l'action utilisateur
   - Réutilisé sur retry (même ID WS + HTTP)

3. **Transport identique**
   - WS + HTTP fallback utilisent le MÊME `clientMsgId`
   - Aucune régénération entre tentatives

4. **Réconciliation strict**
   - Cleanup optimistic par `clientMsgId` (exact match)
   - Fallback content+time uniquement si `clientMsgId` absent (backward compat)

5. **Idempotence backend**
   - Même `clientMsgId` + même `conversationId` = même message
   - Replay détectable (201 vs 200, created true vs false)

### Ce qui n'est PAS garanti

1. **Unicité cross-conversation**
   - Deux conversations différentes peuvent avoir même `clientMsgId`
   - Constraint scope: per-conversation only

2. **Ordre de réception**
   - HTTP fallback + WS broadcast peuvent arriver dans n'importe quel ordre
   - Reconciliation gère les deux cas

3. **Timestamp exact**
   - `createdAt` peut différer légèrement entre tentatives
   - Pas utilisé comme clé de réconciliation

---

## Schéma flux

```
User Action
    │
    ├─ generateClientMsgId() → "uuid-1234"
    │
    ├─ Create OptimisticMessage { clientMsgId: "uuid-1234", status: 'pending' }
    │
    ├─ sendMessage(content, type, meta, "uuid-1234")
    │
    ├──[WS]─→ socket.emit({ clientMsgId: "uuid-1234" })
    │         │
    │         ├─ SUCCESS → ACK { created: true/false }
    │         │             └─> Remove optimistic by clientMsgId
    │         │
    │         └─ TIMEOUT → [HTTP Fallback]
    │                       │
    │                       └─→ POST /messages { clientMsgId: "uuid-1234" }
    │                           │
    │                           ├─ 201 Created (created: true)
    │                           │   └─> Remove optimistic by clientMsgId
    │                           │
    │                           └─ 200 OK (created: false)
    │                               └─> Remove optimistic by clientMsgId
    │
    └─ [WS Broadcast] new-message { clientMsgId: "uuid-1234" }
                      │
                      └─> Reconcile by clientMsgId (prevent duplicate)
```

---

## Tests critiques

### Test 1: WS timeout → HTTP 200 (replay)
- Envoyer message
- WS timeout
- HTTP retourne 200 (replay)
- Server broadcast via WS
- **Vérifie**: 1 seul message affiché (pas doublon)

### Test 2: Retry with same clientMsgId
- Envoyer message avec clientMsgId A
- Échoue
- Retry avec MÊME clientMsgId A
- Backend détecte replay (created: false)
- **Vérifie**: pas de duplication

### Test 3: Multiple messages distinct IDs
- Envoyer msg1 avec clientMsgId A
- Envoyer msg2 avec clientMsgId B
- **Vérifie**: 2 messages distincts affichés

---

## Références

- **Backend Option B**: `DELIVERABLE_BACKEND_CLIENT_MSG_ID.md` (project root docs/)
- **Frontend C4.x**: commits `60bb912`, `659cd27`, `7129a60`, `8c5eb3a`
- **Tests**:
  - `hooks/__tests__/useChat.clientMsgId.test.ts` (unit tests)
  - `hooks/__tests__/useChat.integration.test.ts` (integration tests)
  - `hooks/__tests__/useChat.contract-guard.test.ts` (contract drift guards)
- **Composite constraint**: `packages/database/prisma/schema.prisma`

---

## Changelog

- **2026-01-15 (C4.4)**: Anti-flake hardening + contract drift guards
- **2026-01-15 (C4.3)**: Documentation contractuelle initiale
- **2026-01-14 (C4.2)**: UUID fallback hardened, HTTP status parity
- **2026-01-14 (C4.1)**: Retry reuse same clientMsgId
- **2026-01-14 (C4)**: Frontend clientMsgId transmission
