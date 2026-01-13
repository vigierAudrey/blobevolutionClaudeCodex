# Deliverable: Backend clientMsgId Idempotence — PR Notes

**Date**: 2026-01-13
**Scope**: Backend only (apps/api + packages/database)
**Goal**: Add optional clientMsgId field for idempotent message creation with proper HTTP status codes

---

## Summary

This PR adds backend idempotence for chat messages using an optional `clientMsgId` field. The implementation uses a create-then-fallback pattern to correctly distinguish between creation (201) and replay (200).

**Key features**:
- ✅ **Backward compatible**: Accepts legacy `clientMessageId` field
- ✅ **Proper HTTP status**: 201 Created vs 200 OK (replay detection)
- ✅ **Atomic**: Create-then-fallback prevents race conditions
- ✅ **Safe validation**: Rejects if both fields provided but differ
- ✅ **WS support**: ACK includes `created` flag
- ✅ **9 integration tests** covering all scenarios

---

## Status Code Semantics

**IMPORTANT**: This PR implements Option B (201/200 distinction):

- **201 Created**: Message was actually created (first send)
- **200 OK**: Message already exists (replay/idempotent)

**Detection method**: Create-then-fallback pattern
1. Try `prisma.message.create()`
2. If unique constraint error (P2002) → fetch existing → return 200
3. If success → return 201

**Why not upsert?** Upsert doesn't tell us if a row was created or already existed, making it impossible to return correct HTTP status codes.

---

## Backward Compatibility

### Field Normalization

The API accepts **two field names** for the same purpose:

- `clientMessageId` (legacy, deprecated)
- `clientMsgId` (canonical, recommended)

**Normalization rules**:
1. If only `clientMsgId` present → use it
2. If only `clientMessageId` present → normalize to `clientMsgId`
3. If both present AND identical → use the value
4. If both present AND different → **400 VALIDATION_ERROR**

**Example**:
```json
// ✅ OK: Legacy field
{ "content": "Hello", "clientMessageId": "uuid-1" }

// ✅ OK: New field
{ "content": "Hello", "clientMsgId": "uuid-1" }

// ✅ OK: Both identical
{ "content": "Hello", "clientMsgId": "uuid-1", "clientMessageId": "uuid-1" }

// ❌ 400 VALIDATION_ERROR: Both different
{ "content": "Hello", "clientMsgId": "uuid-1", "clientMessageId": "uuid-2" }
```

**Storage**: Only `clientMsgId` is stored in database (normalized during validation).

---

## Files Modified

### 1. `packages/database/prisma/schema.prisma`

**No changes** (schema already had `clientMsgId` field from previous commit).

---

### 2. `apps/api/src/lib/socket-schemas.ts`

**Added legacy field + validation**:

```typescript
export type SendMessagePayload = {
  conversationId: string;
  content: string;
  type: 'TEXT' | 'PROPOSAL';
  clientMsgId?: string; // Canonique
  clientMessageId?: string; // Legacy (deprecated)
};

export const sendMessageSchema = z.object({
  conversationId: z.string().uuid(),
  content: z.string().min(1).max(1000),
  type: z.enum(['TEXT', 'PROPOSAL']).optional().default('TEXT'),
  clientMsgId: z.string().uuid().optional(),
  clientMessageId: z.string().uuid().optional()
})
.refine(
  (data) => {
    // Si les deux présents, doivent être identiques
    if (data.clientMsgId && data.clientMessageId) {
      return data.clientMsgId === data.clientMessageId;
    }
    return true;
  },
  { message: 'clientMsgId and clientMessageId must be identical if both provided' }
)
.transform((data) => {
  // Normaliser: clientMessageId → clientMsgId si absent
  const clientMsgId = data.clientMsgId || data.clientMessageId;
  return {
    conversationId: data.conversationId,
    content: data.content,
    type: data.type,
    clientMsgId
  };
});
```

**Why `.transform()`?** Ensures downstream code only sees `clientMsgId` (single source of truth).

---

### 3. `apps/api/src/modules/chat/conversations.controller.ts`

**Added create-then-fallback pattern** (lines 323-369):

```typescript
// Pattern create-then-fallback pour détecter création vs replay
let msg;
let wasCreated = true;

if (body.clientMsgId) {
  // Tenter création avec clientMsgId
  try {
    msg = await prisma.message.create({
      data: {
        conversationId: id,
        senderId: userId as string,
        type: body.type as any,
        content: body.content,
        meta: body.meta,
        clientMsgId: body.clientMsgId
      },
      select: { id: true, content: true, type: true, createdAt: true },
    });
    wasCreated = true;
  } catch (e: any) {
    // Si erreur unique constraint P2002 (on assume que c'est notre contrainte composite)
    if (e?.code === 'P2002') {
      // Récupérer le message existant
      msg = await prisma.message.findUnique({
        where: {
          conversation_client_msg_unique: { conversationId: id, clientMsgId: body.clientMsgId }
        },
        select: { id: true, content: true, type: true, createdAt: true },
      });
      wasCreated = false;
      if (!msg) {
        // Cas improbable: constraint hit mais findUnique échoue
        throw new Error('Message should exist after unique constraint violation');
      }
    } else {
      // Autre erreur, propager
      throw e;
    }
  }
} else {
  // Sans clientMsgId: création classique
  msg = await prisma.message.create({
    data: { /* ... */ },
    select: { /* ... */ },
  });
  wasCreated = true;
}

// Retourner 201 si création, 200 si replay
const statusCode = wasCreated ? 201 : 200;
return envelope ? sendOk(res, statusCode, msg) : res.status(statusCode).json({ id: msg.id });
```

**Why P2002 only?** Prisma error code P2002 = unique constraint violation. We assume it's our composite constraint.

---

### 4. `apps/api/src/lib/socket.ts`

**Same pattern as HTTP** + ACK with `created` flag (lines 328-488):

```typescript
// Pattern create-then-fallback (identique à HTTP)
let message;
let wasCreated = true;

if (clientMsgId) {
  try {
    message = await prisma.message.create({ /* ... */ });
    wasCreated = true;
  } catch (e: any) {
    if (e?.code === 'P2002') {
      message = await prisma.message.findUnique({ /* ... */ });
      wasCreated = false;
      // ...
    } else {
      throw e;
    }
  }
} else {
  message = await prisma.message.create({ /* ... */ });
  wasCreated = true;
}

// ACK avec flag created
ackSuccess(
  ack,
  {
    id: message.id,
    conversationId: message.conversationId,
    content: message.content,
    type: message.type,
    createdAt: message.createdAt.toISOString(),
    created: wasCreated // true si création, false si replay
  },
  ackSuccessSchemaRequired(
    z.object({
      id: z.string(),
      conversationId: z.string(),
      content: z.string(),
      type: z.string(),
      createdAt: z.string(),
      created: z.boolean()
    })
  )
);
```

**WebSocket difference**: Can't return HTTP status, so ACK payload includes `created: boolean`.

---

### 5. `apps/api/src/modules/chat/__tests__/client-msg-id-idempotence.test.ts`

**9 integration tests** (all passing):

1. ✅ **Without clientMsgId**: Classic create → 201 (backward compatible)
2. ✅ **With clientMsgId (first send)**: Create → 201
3. ✅ **Replay (same clientMsgId)**: First 201, second 200
4. ✅ **Concurrent requests**: One 201, other 200 (race handled)
5. ✅ **Different clientMsgIds**: Creates distinct messages
6. ✅ **Same clientMsgId, different conversations**: Allowed (scoped)
7. ✅ **clientMessageId (legacy)**: Normalizes to clientMsgId → 201
8. ✅ **Both fields identical**: OK → 201
9. ✅ **Both fields different**: 400 VALIDATION_ERROR

**Test evidence**:
```
PASS src/modules/chat/__tests__/client-msg-id-idempotence.test.ts
  ✓ creates message without clientMsgId (classic behavior)
  ✓ creates message with clientMsgId (first send) - returns 201
  ✓ returns 201 on first send, 200 on replay (same clientMsgId)
  ✓ handles concurrent requests with same clientMsgId (one 201, other 200)
  ✓ creates distinct messages with different clientMsgIds
  ✓ allows same clientMsgId in different conversations
  ✓ accepts clientMessageId (legacy) and normalizes to clientMsgId
  ✓ accepts both clientMsgId and clientMessageId if identical
  ✓ rejects if clientMsgId and clientMessageId differ

Tests:       9 passed, 9 total
Time:        25.617 s
```

---

## Behavior Examples

### Scenario 1: First send (creation)

**Request**:
```http
POST /conversations/:id/messages
{ "content": "Hello", "clientMsgId": "uuid-1" }
```

**Response**: 201 Created
```json
{ "ok": true, "data": { "id": "msg-1", "content": "Hello", "type": "TEXT" } }
```

---

### Scenario 2: Replay (idempotent)

**Request** (same clientMsgId):
```http
POST /conversations/:id/messages
{ "content": "Different content", "clientMsgId": "uuid-1" }
```

**Response**: 200 OK
```json
{ "ok": true, "data": { "id": "msg-1", "content": "Hello", "type": "TEXT" } }
```

**Note**: Content NOT modified (original preserved).

---

### Scenario 3: Concurrent sends

**Requests** (simultaneous with same clientMsgId):
```http
POST /conversations/:id/messages (Thread A)
POST /conversations/:id/messages (Thread B)
```

**Responses**:
- Thread A: 201 Created (wins race)
- Thread B: 200 OK (sees existing)

**Result**: Only 1 message in DB, both requests succeed.

---

### Scenario 4: Legacy field

**Request**:
```http
POST /conversations/:id/messages
{ "content": "Legacy", "clientMessageId": "uuid-2" }
```

**Response**: 201 Created
**DB**: `clientMsgId` = "uuid-2" (normalized)

---

### Scenario 5: Both fields (conflict)

**Request**:
```http
POST /conversations/:id/messages
{ "content": "Conflict", "clientMsgId": "uuid-1", "clientMessageId": "uuid-2" }
```

**Response**: 400 Bad Request
```json
{ "ok": false, "error": { "code": "VALIDATION_ERROR", "message": "clientMsgId and clientMessageId must be identical if both provided" } }
```

---

## Anti-Regression Checklist

✅ **Backward compatible**: clientMsgId optional, no breaking changes
✅ **Without clientMsgId**: Classic behavior unchanged (always 201)
✅ **With clientMsgId**: First send → 201, replay → 200
✅ **Concurrency safe**: Create-then-fallback handles race (P2002 catch)
✅ **Per-conversation scope**: Same clientMsgId allowed across conversations
✅ **Legacy support**: clientMessageId normalized transparently
✅ **Validation**: Both fields different → 400 error
✅ **No content matching**: Server trusts clientMsgId, doesn't compare content
✅ **Build successful**: TypeScript compilation passes
✅ **All tests pass**: 9/9 integration tests passing

---

## Implementation Details

### Why Create-Then-Fallback (Not Upsert)?

**Problem with upsert**: Prisma `upsert()` doesn't return info about whether row was created or already existed.

**Solution**: Create-then-fallback pattern:
```typescript
try {
  msg = await prisma.message.create({ clientMsgId });
  wasCreated = true; // Know it was created
} catch (e) {
  if (e.code === 'P2002') {
    msg = await prisma.message.findUnique({ clientMsgId });
    wasCreated = false; // Know it was replay
  }
}
```

**Benefit**: Explicit `wasCreated` flag for correct HTTP status.

---

### Concurrency Guarantees

**Race condition**:
```
Thread A: create(clientMsgId=uuid-1) → SUCCESS (201)
Thread B: create(clientMsgId=uuid-1) → P2002 → findUnique() → SUCCESS (200)
```

**Result**: Both threads succeed, only 1 message in DB, correct status codes.

**Why safe**: PostgreSQL unique constraint enforced at DB level (atomic).

---

### Security Notes

**No sensitive data in logs**:
- Error logs never include message content
- Only log: `code`, `conversationId`, `userId` (metadata)
- Prisma error includes `meta.target` (column names), not data

**Example secure log**:
```typescript
// ❌ BAD: Would log content
console.error('Create failed', { error: e, content: body.content });

// ✅ GOOD: Metadata only
console.error('Create failed', { error: { code: e.code, conversationId: id, userId } });
```

---

## Code Diff Summary

```diff
apps/api/src/lib/socket-schemas.ts:
  export type SendMessagePayload = {
    conversationId: string;
    content: string;
    type: 'TEXT' | 'PROPOSAL';
    clientMsgId?: string;
  + clientMessageId?: string; // Legacy
  };

  + .refine((data) => {
  +   if (data.clientMsgId && data.clientMessageId) {
  +     return data.clientMsgId === data.clientMessageId;
  +   }
  +   return true;
  + })
  + .transform((data) => {
  +   const clientMsgId = data.clientMsgId || data.clientMessageId;
  +   return { ...data, clientMsgId };
  + });

apps/api/src/modules/chat/conversations.controller.ts:
  - const msg = body.clientMsgId ? await prisma.message.upsert(...) : await prisma.message.create(...);
  + let msg;
  + let wasCreated = true;
  + if (body.clientMsgId) {
  +   try {
  +     msg = await prisma.message.create({ clientMsgId: body.clientMsgId });
  +     wasCreated = true;
  +   } catch (e) {
  +     if (e.code === 'P2002') {
  +       msg = await prisma.message.findUnique({ clientMsgId: body.clientMsgId });
  +       wasCreated = false;
  +     } else {
  +       throw e;
  +     }
  +   }
  + } else {
  +   msg = await prisma.message.create({ ... });
  +   wasCreated = true;
  + }

  - return envelope ? sendOk(res, 201, msg) : res.status(201).json({ id: msg.id });
  + const statusCode = wasCreated ? 201 : 200;
  + return envelope ? sendOk(res, statusCode, msg) : res.status(statusCode).json({ id: msg.id });

apps/api/src/lib/socket.ts:
  (same pattern as HTTP controller)

  + created: wasCreated // ACK flag

apps/api/src/modules/chat/__tests__/client-msg-id-idempotence.test.ts:
  + 3 new backward compat tests
  ~ Updated existing tests to expect 201/200
```

**Total**: ~200 insertions, ~100 deletions

---

## Next Steps (Out of Scope)

### Frontend Integration

**Not included** (backend only):
- Update `apps/web/hooks/useChat.ts` to send clientMsgId
- Handle 200 OK (replay) in frontend
- Update retry logic to reuse clientMsgId

**Migration guide**: Frontend can start sending `clientMsgId` immediately (backward compatible).

---

## Commit Message

```
fix(api): clientMsgId idempotence status 201/200 + ws backward compat

Implement proper idempotence with correct HTTP status codes and legacy support.

Changes:
- Pattern: create-then-fallback (not upsert) for 201 vs 200 detection
- Backward compat: accept clientMessageId (legacy) + clientMsgId (new)
- Validation: reject if both fields present but differ (400 error)
- WS: ACK includes created flag
- Tests: 9 integration tests (all passing)

Status semantics:
- 201 Created = message created (first send)
- 200 OK = message exists (replay/idempotent)

Safety:
- Atomic: DB constraint enforced
- Concurrent: one 201, other 200 (race handled)
- No breaking changes: clientMsgId optional

Build: ✅ Successful
Tests: ✅ 9/9 passed

🤖 Generated with Claude Code (https://claude.com/claude-code)

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>
```

---

**Ready for review!**
