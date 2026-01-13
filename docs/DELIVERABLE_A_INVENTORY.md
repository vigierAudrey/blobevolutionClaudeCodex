# Deliverable A: Front-End Reliability Inventory Audit

**Date**: 2026-01-12
**Scope**: apps/web (Next.js client)
**Goal**: Document current WS/HTTP flows, error handling, UI states, and reliability gaps

---

## 1. WebSocket (WS) Flows — Current Implementation

### 1.1 Chat/Messaging (HIGHEST PRIORITY)

#### WS Send Message
**Location**: `apps/web/hooks/useChat.ts:182-214`

**Flow**:
1. User calls `sendMessage(content, type)` from `useChat` hook
2. Hook checks: `connected` → if false, returns `{ success: false, error: { code: 'NOT_CONNECTED' } }`
3. Hook checks: `socket` → if null, returns `{ success: false, error: { code: 'NO_SOCKET' } }`
4. Calls `emitWithAck(socket, 'send-message', payload, sendAckSchema)`
5. On success: returns `{ success: true }`, clears `lastError`
6. On error: normalizes via `normalizeSocketError(err)`, sets `lastError`, returns `{ success: false, error }`

**ACK Handling**: ✅ **Strict ACK required** (via `emitWithAck`)
- Timeout: 5000ms (default in `emitWithAck`)
- On timeout → throws `{ code: 'CLIENT_TIMEOUT', message: 'ACK timeout after 5000ms' }`
- On server error → throws envelope `{ code: ERROR_CODE, message, details }`

**Error Normalization**: `apps/web/hooks/useChat.ts:79-91`
```typescript
const normalizeSocketError = (err: unknown): SocketError => {
  const rawCode = (err as any)?.code;
  const code: SocketErrorCode = typeof rawCode === 'string' && SOCKET_ERROR_CODES.has(rawCode)
    ? rawCode as SocketErrorCode
    : 'INTERNAL_ERROR';
  // Extracts retryAfter from details or top-level
  const retryAfter = typeof (err as any)?.retryAfter === 'number' ? (err as any).retryAfter : retryAfterFromDetails;
  return { code, message, retryAfter, details };
};
```

**Client-Only Codes**: `apps/web/hooks/useChat.ts:36-42`
- `CLIENT_TIMEOUT` (from `emitWithAck` timeout)
- `NOT_CONNECTED` (socket disconnected)
- `NO_SOCKET` (socket instance unavailable)
- `AUTH_FAILED` (from `useSocket` connect_error)
- `CONNECT_ERROR` (generic connection failure)

**⚠️ Problem**: CLIENT_TIMEOUT is mixed into `SocketErrorCode` type alongside `ErrorCode` from server. This violates the "never mix client codes into ERROR_CODES" constraint.

#### WS Join Conversation
**Location**: `apps/web/hooks/useChat.ts:129-151`

**Flow**:
1. On mount/reconnect, if `connected && conversationId`, calls `emitWithAck(socket, 'join-conversation', { conversationId }, joinAckSchema)`
2. On success: clears `lastError`
3. On error: normalizes error, sets `lastError`
4. On unmount: emits `leave-conversation` (fire-and-forget, no ACK)

**ACK Handling**: ✅ **Strict ACK required**

#### WS Error Channels
**Location**: `apps/web/hooks/useSocket.ts:141-161`

**Canonical channel**: `socket-error`
**Legacy fallback**: `error`

**Flow**:
1. Socket emits `socket-error` or `error` with payload
2. Validates payload with `ackErrorSchema.safeParse(payload)`
3. If invalid → logs warning, ignores
4. If valid → extracts `{ code, message, details }`, sets `lastSocketError`
5. Extracts `retryAfter` from `details.retryAfter` if present

**⚠️ Problem**: No clear distinction between transient errors (RATE_LIMITED) and permanent errors (FORBIDDEN). UI must know which errors warrant retry vs. stop.

### 1.2 Current UI Integration (Chat)

**Location**: `apps/web/app/messages/[id]/page-websocket.tsx`

**Connected Indicator**: Lines 288-296
- Shows "Temps réel" badge if `connected === true`
- Shows "Hors ligne" badge if `connected === false`

**Error Display**: Lines 72-76, 336
```tsx
useEffect(() => {
  if (lastError && lastError.code !== 'RATE_LIMITED') {
    setError(lastError.message);
  }
}, [lastError]);

// UI: {error && <p className="text-sm text-red-600">{error}</p>}
```

**RATE_LIMITED Handling**: Lines 192-199
```tsx
if (result.error.code === 'RATE_LIMITED' && result.error.retryAfter) {
  const cooldownUntil = Date.now() + (result.error.retryAfter * 1000);
  setRateLimitedUntil(cooldownUntil);
  setError(`Trop de messages envoyés. Réessayez dans ${result.error.retryAfter}s`);
}
```

**Cooldown UI**: Lines 157-178
- Countdown timer showing `cooldownSeconds`
- Button disabled with text "Attendre ${cooldownSeconds}s"

**⚠️ Problems**:
1. **Filter logic** (`lastError.code !== 'RATE_LIMITED'`) prevents RATE_LIMITED from being shown in generic error UI, but it's still set in `lastError` state
2. **No distinction** between transient vs. permanent errors (e.g., FORBIDDEN should stop retry)
3. **No fallback HTTP attempt** when WS fails (see gap #3)

---

## 2. HTTP Fallback — Current Implementation

### 2.1 Chat/Messaging HTTP APIs

#### HTTP Send Message
**Location**: `apps/web/lib/apiClient.ts:1016-1031`

**API**: `POST /conversations/:id/messages`

**Flow**:
1. Validates payload with `sendMessagePayloadSchema.parse(body)`
2. Adds headers: `Content-Type`, `X-CSRF-Token`, `Authorization`, `X-API-ENVELOPE: 1`
3. Calls `requestStrict(path, init, sendMessageDataSchema)`
4. Returns `Promise<{ id, content, type, createdAt }>`

**Error Handling**: `apps/web/lib/requestStrict.ts:44-123`
- Parses envelope: `{ ok: true, data }` or `{ ok: false, error: { code, message, details } }`
- On error envelope → throws `StrictHttpError` with `code`, `message`, `details`, `status`, `url`, `body`
- On invalid/missing envelope → throws `{ code: 'INVALID_ENVELOPE' }`
- On network/parse error → throws `{ code: 'INVALID_RESPONSE' | 'INVALID_JSON' }`

**Envelope Schema**: `apps/web/lib/requestStrict.ts:6-24`
```typescript
export const envelopeErrorSchema = z.object({
  ok: z.literal(false),
  error: z.object({
    code: z.nativeEnum(ERROR_CODES), // Server ERROR_CODES only
    message: z.string(),
    details: z.unknown().optional(),
  }),
}).strict();
```

**✅ Strict contract**: All HTTP writes using `requestStrict` get type-safe envelopes and explicit error codes.

#### HTTP Open Conversation
**Location**: `apps/web/lib/apiClient.ts:969-984`

**API**: `POST /conversations/open`

**Flow**:
1. Validates `{ targetUserId }` with `openConversationPayloadSchema`
2. Calls `requestStrict('/conversations/open', init, openConversationDataSchema)`
3. Returns `Promise<{ id, created? }>`

**✅ Strict contract**: Uses `requestStrict` with envelope validation.

### 2.2 Current HTTP Fallback Usage in Chat

**Location**: `apps/web/app/messages/[id]/page-websocket.tsx:201-212`

**Trigger**: Manual fallback only when `connected === false`

**Flow**:
```tsx
if (connected) {
  // WS primary
  const result = await sendMessage(input.trim(), 'TEXT');
  if (result.success) { /* ... */ }
  else { setError(`Erreur: ${result.error.message}`); }
} else {
  // HTTP fallback
  const payload: SendMessagePayload = { type: 'TEXT', content: input.trim() };
  try {
    await apiClient.sendMessage(id, payload);
    setInput('');
    await loadMessages(); // Re-fetch all messages
  } catch (err) {
    setError('Erreur lors de l\'envoi du message');
  }
}
```

**⚠️ Problems**:
1. **No automatic fallback on WS timeout**: If `emitWithAck` times out (CLIENT_TIMEOUT), code does NOT retry via HTTP
2. **No unified state**: HTTP success doesn't mark message as "delayed_fallback", just reloads all messages
3. **Generic error message**: Catch block loses error code/details from `StrictHttpError`

---

## 3. Other Critical Write Actions (HTTP Only)

### 3.1 Matching Decisions

#### Single Decision
**Location**: `apps/web/lib/apiClient.ts:949-950`

**API**: `POST /matching/decision`
**Method**: Legacy `request()` (NOT `requestStrict`)
**Envelope**: ❌ No envelope validation

**⚠️ Problem**: Does not use strict envelope, loses error codes.

#### Batch Decisions
**Location**: `apps/web/lib/apiClient.ts:952-967`

**API**: `POST /matching/decisions`
**Method**: ✅ `requestStrict` with `matchDecisionsDataSchema`
**Envelope**: ✅ Strict envelope

**UI**: `apps/web/app/matching/cards/CardsClient.tsx`
- Shows generic error message: `setError(message || 'Erreur chargement')`
- No distinction between FORBIDDEN, VALIDATION_ERROR, INTERNAL_ERROR

### 3.2 Booking Availability (Pro)

#### Create Availability
**Location**: `apps/web/lib/apiClient.ts:1252-1267`

**API**: `POST /booking/availability`
**Method**: ✅ `requestStrict` with `proAvailabilityDataSchema`
**Envelope**: ✅ Strict envelope

**UI**: `apps/web/app/pro/planning/page.tsx:50-72`
```tsx
catch (err: unknown) {
  const message = err instanceof Error ? err.message : 'Erreur de chargement du planning';
  setError(message);
}
```

**⚠️ Problem**: Loses error code. `err instanceof Error` check doesn't extract `.code` from `StrictHttpError`.

#### Decide Booking Request
**Location**: `apps/web/lib/apiClient.ts:1304-1323`

**API**: `POST /booking/requests/:id/decision`
**Method**: ✅ `requestStrict` with `bookingDecisionDataSchema`
**Envelope**: ✅ Strict envelope

**UI**: `apps/web/app/pro/planning/page.tsx:124-135`
```tsx
catch (err: unknown) {
  const message = err instanceof Error ? err.message : 'Impossible de traiter la demande';
  setError(message);
}
```

**⚠️ Problem**: Same as above—loses error code.

### 3.3 Report Profile
**Location**: `apps/web/lib/apiClient.ts:986-1001`

**API**: `POST /reports/profile`
**Method**: ✅ `requestStrict` with `reportProfileDataSchema`
**Envelope**: ✅ Strict envelope

**UI**: Not audited (low priority for this deliverable).

---

## 4. Server ERROR_CODES

**Source**: `apps/api/src/utils/error-codes.ts` + `apps/web/lib/socketAck.ts:3-12`

```typescript
export const ERROR_CODES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  UNIQUE_CONSTRAINT: 'UNIQUE_CONSTRAINT',
  BOOKING_CONFLICT: 'BOOKING_CONFLICT',
  MATCHING_CONFLICT: 'MATCHING_CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
} as const;
```

**Used by**:
- WS ACK envelopes (`ackErrorSchema`)
- HTTP strict envelopes (`envelopeErrorSchema`)

**Client-only codes** (NOT in ERROR_CODES):
- `CLIENT_TIMEOUT` (WS timeout)
- `NOT_CONNECTED` (WS disconnected)
- `NO_SOCKET` (WS unavailable)
- `AUTH_FAILED` (connect_error → auth)
- `CONNECT_ERROR` (connect_error → generic)
- `INVALID_ENVELOPE` (HTTP parse failure)
- `INVALID_RESPONSE` (HTTP network failure)
- `INVALID_JSON` (HTTP malformed body)

---

## 5. Current UI States and Error Display Patterns

### 5.1 Chat Message States

**Observed**: `apps/web/app/messages/[id]/page-websocket.tsx`

**States**:
- **Local optimistic**: None (user must wait for ACK or HTTP response)
- **Sent**: Message added to `messages[]` array on WS `new-message` event or after HTTP success + re-fetch
- **Failed**: `setError(message)` shows red text above chat

**⚠️ Missing States**:
- **Pending**: No visual indicator that message is awaiting ACK (user sees no feedback until success/error)
- **Delayed fallback**: No indicator when WS fails and HTTP succeeds (user doesn't know message took fallback path)
- **Failed with retry hint**: No distinction between retryable (RATE_LIMITED, INTERNAL_ERROR) vs. non-retryable (FORBIDDEN, UNAUTHORIZED)

### 5.2 Error Display Patterns

**Chat**: Single `error` state, displayed as `<p className="text-sm text-red-600">{error}</p>`

**Matching**: Single `error` state, generic message `"Erreur chargement"`

**Booking**: Single `error` state, generic message `"Erreur de chargement du planning"` or `"Impossible de traiter la demande"`

**⚠️ Problems**:
1. **No structured error object**: Just strings, lose code/details
2. **No user-facing mapping**: Same error text for FORBIDDEN (stop) vs. INTERNAL_ERROR (retry)
3. **No action hints**: No "Retry" button, no "Contact support", no "Re-login"
4. **No severity levels**: All errors shown as red text, no WARNING vs. CRITICAL distinction

---

## 6. Identified Gaps

### Gap #1: "Silence = Success" — Missing Pending State
**Problem**: When user clicks "Send", there's no visual feedback until ACK completes (5s timeout). If network is slow, user sees nothing and may click again.

**Location**: `apps/web/app/messages/[id]/page-websocket.tsx:180-213`

**Impact**: UX feels unresponsive. Risk of duplicate sends.

**Fix**: Add pending state to message object, show spinner/indicator.

---

### Gap #2: WS Timeout → No HTTP Fallback
**Problem**: If `emitWithAck` times out (CLIENT_TIMEOUT), code shows error but does NOT retry via HTTP.

**Location**: `apps/web/app/messages/[id]/page-websocket.tsx:185-200`

**Current**:
```tsx
if (connected) {
  const result = await sendMessage(input.trim(), 'TEXT');
  if (!result.success) {
    setError(`Erreur: ${result.error.message}`); // ❌ No fallback
  }
}
```

**Expected**:
```tsx
if (connected) {
  const result = await sendMessage(input.trim(), 'TEXT');
  if (!result.success && result.error.code === 'CLIENT_TIMEOUT') {
    // ✅ Retry via HTTP fallback
    await apiClient.sendMessage(id, payload);
  }
}
```

**Impact**: Messages fail permanently on WS hiccups, even when HTTP would succeed.

---

### Gap #3: Missing Message State Machine
**Problem**: No explicit state transitions for pending → sent → delayed_fallback → failed.

**Impact**: UI cannot show clear state to user. No rollback on failure.

**Proposed States**:
- `pending`: User clicked send, awaiting ACK
- `sent`: ACK ok:true or HTTP ok:true
- `delayed_fallback`: WS failed/timeout, HTTP succeeded (optional indicator)
- `failed`: Both WS and HTTP failed OR FORBIDDEN/UNAUTHORIZED/VALIDATION_ERROR

---

### Gap #4: No Unified Error Normalization
**Problem**: Three different error types:
1. WS `SocketError` (from `normalizeSocketError`)
2. HTTP `StrictHttpError` (from `requestStrict`)
3. Legacy errors (from old `request()` calls)

**Impact**: UI code must handle 3 formats, lose details when using `instanceof Error`.

**Fix**: Single `normalizeAppError(err)` function that normalizes all sources.

---

### Gap #5: No User-Facing Message Mapper
**Problem**: Error messages are raw server text or generic strings. No mapping to user-friendly language.

**Examples**:
- `FORBIDDEN` → "Vous n'avez pas accès à cette ressource"
- `RATE_LIMITED` → "Trop de tentatives. Réessayez dans X secondes"
- `UNAUTHORIZED` → "Session expirée, veuillez vous reconnecter"
- `VALIDATION_ERROR` → "Vérifiez vos informations et réessayez"
- `INTERNAL_ERROR` → "Erreur serveur. Réessayez dans un instant"

**Impact**: Users see technical messages, unclear what action to take.

---

### Gap #6: No Retry/Action Hints
**Problem**: When error shown, no button/link to retry, contact support, or re-login.

**Impact**: Users stuck with red text, don't know next step.

**Fix**: Map errors to action hints:
- `RATE_LIMITED` → Show countdown, disable retry until cooldown
- `FORBIDDEN` → "Contact support" link
- `UNAUTHORIZED` → "Re-login" link
- `INTERNAL_ERROR` → "Retry" button
- `VALIDATION_ERROR` → Highlight invalid field

---

### Gap #7: HTTP Error Code Lost in UI
**Problem**: Catch blocks do `err instanceof Error ? err.message : 'Fallback'`, losing `.code` from `StrictHttpError`.

**Location**:
- `apps/web/app/matching/cards/CardsClient.tsx:198`
- `apps/web/app/pro/planning/page.tsx:65, 130`

**Fix**: Check for `.code` property:
```tsx
catch (err: unknown) {
  const code = (err as any)?.code ?? 'UNKNOWN';
  const message = (err as any)?.message ?? 'Erreur inconnue';
  setError({ code, message, source: 'HTTP_STRICT' });
}
```

---

### Gap #8: CLIENT_TIMEOUT Mixed into Error Code Type
**Problem**: `apps/web/hooks/useChat.ts:36-42` defines `SocketErrorCode` as union of `ErrorCode | 'CLIENT_TIMEOUT' | ...`.

**Impact**: Violates constraint: "NEVER mix CLIENT_TIMEOUT into ERROR_CODES".

**Fix**: Separate client codes into distinct type, unify in `normalizeAppError`.

---

### Gap #9: No Test Coverage for Pending Rollback
**Problem**: If WS times out, no test ensures pending message is removed from UI.

**Location**: `apps/web/hooks/__tests__/useChat.test.ts` (missing test)

**Fix**: Add test with fake timers for timeout + rollback.

---

### Gap #10: No Deterministic Pending Resolution
**Problem**: Pending messages could remain forever if:
1. WS times out (5s)
2. HTTP fallback fails
3. User navigates away

**Fix**: Ensure `sendMessage` always resolves pending to `sent` or `failed`, never leaves hanging.

---

## 7. Summary Table

| Flow | WS Primary | WS ACK | HTTP Fallback | HTTP Strict | Error Normalization | UI State Machine | User-Facing Errors | Retry Logic |
|------|-----------|--------|---------------|-------------|-------------------|-----------------|-------------------|-------------|
| **Chat: Send Message** | ✅ | ✅ | ⚠️ Manual only | ✅ (`sendMessage`) | ⚠️ Partial | ❌ | ❌ | ❌ |
| **Chat: Join Conversation** | ✅ | ✅ | ❌ N/A | ❌ N/A | ⚠️ Partial | ❌ | ❌ | ❌ |
| **Matching: Decisions (batch)** | ❌ | ❌ | ✅ | ✅ (`matchDecisions`) | ❌ | ❌ | ❌ | ❌ |
| **Matching: Decision (single)** | ❌ | ❌ | ✅ | ❌ (legacy) | ❌ | ❌ | ❌ | ❌ |
| **Booking: Create Availability** | ❌ | ❌ | ✅ | ✅ (`createBookingAvailability`) | ❌ | ❌ | ❌ | ❌ |
| **Booking: Decide Request** | ❌ | ❌ | ✅ | ✅ (`decideBookingRequest`) | ❌ | ❌ | ❌ | ❌ |
| **Report: Profile** | ❌ | ❌ | ✅ | ✅ (`reportProfile`) | ❌ | ❌ | ❌ | ❌ |

**Legend**:
- ✅ = Implemented correctly
- ⚠️ = Partially implemented / has issues
- ❌ = Not implemented / missing

---

## 8. Recommendations for Deliverable B

Based on this inventory, **Deliverable B** (unified error + state model) should:

1. **Create `normalizeAppError(err)`** that handles:
   - WS `SocketError` (from `emitWithAck` or `useSocket.lastSocketError`)
   - HTTP `StrictHttpError` (from `requestStrict`)
   - Legacy `Error` (from old `apiClient.request()`)
   - Client-only codes: `CLIENT_TIMEOUT`, `NOT_CONNECTED`, `NO_SOCKET`, `AUTH_FAILED`, `CONNECT_ERROR`
   - HTTP-only codes: `INVALID_ENVELOPE`, `INVALID_RESPONSE`, `INVALID_JSON`

   **Output**:
   ```typescript
   type NormalizedError = {
     kind: 'transient' | 'permanent' | 'client_only';
     code: string; // Can be ERROR_CODES or client-only codes
     message: string;
     retryAfterSeconds?: number;
     canRetry: boolean;
     actionHint?: 'retry' | 'relogin' | 'contact_support' | 'fix_input';
     source: 'WS_ACK' | 'WS_CHANNEL' | 'HTTP_STRICT' | 'HTTP_LEGACY' | 'UNKNOWN';
   };
   ```

2. **Create `getUserFacingMessage(normErr, context)`** that maps codes to user-friendly text:
   - Context: `{ domain: 'chat' | 'booking' | 'matching' | 'reporting', role: 'rider' | 'pro' | 'admin', action: 'send-message' | 'open-conversation' | ... }`
   - Output:
   ```typescript
   type UserMessage = {
     title: string; // e.g., "Trop de messages"
     text: string; // e.g., "Vous avez envoyé trop de messages. Réessayez dans 30 secondes."
     severity: 'info' | 'warning' | 'error' | 'critical';
     canRetry: boolean;
     retryAfterSeconds?: number;
     suggestedAction?: 'retry_button' | 'relogin_link' | 'support_link' | 'highlight_field';
   };
   ```

3. **Define message state machine** (for chat):
   ```typescript
   type MessageState = 'pending' | 'sent' | 'delayed_fallback' | 'failed';
   ```

   **Transitions**:
   - `pending` → `sent`: WS ACK ok:true OR HTTP ok:true
   - `pending` → `delayed_fallback`: WS timeout → HTTP ok:true (optional UI indicator)
   - `pending` → `failed`: WS timeout → HTTP failed OR FORBIDDEN/UNAUTHORIZED/VALIDATION_ERROR
   - `failed` → `pending`: User clicks retry (only if `canRetry === true`)

4. **Implement HTTP fallback in `useChat.sendMessage`**:
   ```typescript
   const result = await sendMessage(content, type);
   if (!result.success && result.error.code === 'CLIENT_TIMEOUT') {
     // Retry via HTTP
     try {
       await apiClient.sendMessage(conversationId, payload);
       return { success: true, source: 'HTTP_FALLBACK' };
     } catch (httpErr) {
       const normalized = normalizeAppError(httpErr);
       return { success: false, error: normalized };
     }
   }
   ```

5. **Update UI components** to use `normalizeAppError` + `getUserFacingMessage`:
   ```tsx
   catch (err) {
     const normalized = normalizeAppError(err);
     const userMsg = getUserFacingMessage(normalized, { domain: 'chat', role: 'rider', action: 'send-message' });
     setError(userMsg);
   }
   ```

---

## 9. Files to Modify (Deliverable C)

**Priority 1 (Chat)**:
- `apps/web/hooks/useChat.ts` — Add HTTP fallback on WS timeout, implement state machine
- `apps/web/hooks/useSocket.ts` — Already correct, no changes needed (canonical error channel)
- `apps/web/app/messages/[id]/page-websocket.tsx` — Use normalized errors + user-facing messages
- `apps/web/lib/normalizeAppError.ts` — **NEW FILE** — Single error normalization function
- `apps/web/lib/getUserFacingMessage.ts` — **NEW FILE** — User-facing message mapper

**Priority 2 (Pro/Booking/Matching)**:
- `apps/web/app/pro/planning/page.tsx` — Extract error code from `StrictHttpError`, use normalized errors
- `apps/web/app/matching/cards/CardsClient.tsx` — Extract error code, use normalized errors
- `apps/web/lib/apiClient.ts` — Migrate `matchDecision` (single) to `requestStrict` (optional)

---

## 10. Test Coverage Needed (Deliverable D)

**Unit Tests**:
- `apps/web/lib/__tests__/normalizeAppError.test.ts` — All error sources (WS, HTTP, legacy, client-only)
- `apps/web/lib/__tests__/getUserFacingMessage.test.ts` — All ERROR_CODES + client-only codes + contexts

**Integration Tests (useChat)**:
- WS success → `sent`
- WS timeout + HTTP success → `sent` or `delayed_fallback` (as designed)
- WS timeout + HTTP FORBIDDEN → `failed` with FORBIDDEN message
- RATE_LIMITED → `failed` with `retryAfterSeconds`
- Pending never stuck (use fake timers, ensure timeout always resolves)

**Integration Tests (useSocket)**:
- `socket-error` payload mapped correctly
- Legacy `error` payload mapped correctly

---

## 11. Documentation (Deliverable E)

**File**: `docs/FRONT_RELIABILITY.md`

**Contents**:
1. WS/HTTP fallback architecture
2. Error codes mapping rules (server vs. client-only)
3. Message state machine (pending → sent → delayed_fallback → failed)
4. Where to add new actions safely (use `requestStrict`, use `normalizeAppError`, use `getUserFacingMessage`)
5. Example: Adding a new "delete availability" action

---

**End of Deliverable A**
