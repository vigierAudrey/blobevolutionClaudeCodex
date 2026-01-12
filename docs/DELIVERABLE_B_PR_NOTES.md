# Deliverable B: Unified Error Normalization — PR Notes

## Summary

Added unified error normalization and user-facing message mapping helpers to centralize error handling across all front-end flows (chat, booking, matching, reporting).

**No functional changes** — This is a pure helper layer. Existing components remain untouched.

---

## Files Created

1. `apps/web/lib/types/appError.ts` — TypeScript types for unified error model
2. `apps/web/lib/normalizeAppError.ts` — Normalizes errors from all sources (WS ACK, WS channel, HTTP strict, HTTP legacy, unknown)
3. `apps/web/lib/getUserFacingMessage.ts` — Maps normalized errors to user-friendly messages with context
4. `apps/web/lib/__tests__/normalizeAppError.test.ts` — 32 tests for normalization logic
5. `apps/web/lib/__tests__/getUserFacingMessage.test.ts` — 27 tests for user message mapping

**Total: 59 tests, all passing ✅**

---

## Error Classification Rules

| Code | Kind | canRetry | actionHint | Severity |
|------|------|----------|------------|----------|
| **RATE_LIMITED** | transient | false (cooldown) | retry | warning |
| **INTERNAL_ERROR** | transient | true | retry | warning |
| **INVALID_RESPONSE** | transient | true | retry | warning |
| **UNAUTHORIZED** | permanent | false | relogin | critical |
| **AUTH_FAILED** | client_only | false | relogin | error |
| **FORBIDDEN** | permanent | false | contact_support | critical |
| **VALIDATION_ERROR** | permanent | false | fix_input | error |
| **UNIQUE_CONSTRAINT** | permanent | false | fix_input | error |
| **BOOKING_CONFLICT** | permanent | false | fix_input | error |
| **MATCHING_CONFLICT** | permanent | false | fix_input | error |
| **CLIENT_TIMEOUT** | client_only | true | retry | warning |
| **NOT_CONNECTED** | client_only | true | retry | warning |
| **NO_SOCKET** | client_only | true | retry | warning |
| **CONNECT_ERROR** | client_only | true | retry | warning |
| **INVALID_ENVELOPE** | client_only | true | retry | warning |
| **INVALID_JSON** | client_only | true | retry | warning |

---

## Test Coverage

### `normalizeAppError.test.ts` (32 tests)

**WS ACK errors (5 tests)**:
- CLIENT_TIMEOUT from emitWithAck
- RATE_LIMITED with retryAfter from details
- RATE_LIMITED with top-level retryAfter
- Prefers top-level over details.retryAfter
- FORBIDDEN from WS ACK

**WS channel errors (2 tests)**:
- socket-error with ERROR_CODE
- VALIDATION_ERROR from socket-error

**HTTP Strict errors (8 tests)**:
- StrictHttpError with status + url
- UNAUTHORIZED with relogin hint
- UNIQUE_CONSTRAINT
- BOOKING_CONFLICT
- MATCHING_CONFLICT
- INVALID_ENVELOPE
- INVALID_JSON
- INVALID_RESPONSE

**Client-only errors (4 tests)**:
- NOT_CONNECTED
- NO_SOCKET
- AUTH_FAILED with relogin hint
- CONNECT_ERROR

**Legacy Error (2 tests)**:
- Error instance without code
- Error with custom properties (status)

**Unknown errors (4 tests)**:
- String error
- null error
- undefined error
- Object without code/message

**Never throws (2 tests)**:
- Handles error during normalization
- Handles circular reference

**Edge cases (5 tests)**:
- Ignores zero retryAfter
- Ignores negative retryAfter
- Ignores non-number retryAfter
- Handles empty debug object
- Includes debug when details present

### `getUserFacingMessage.test.ts` (27 tests)

**All ERROR_CODES mapped**:
- RATE_LIMITED (3 tests: with retryAfter, without, pluralization)
- UNAUTHORIZED / AUTH_FAILED (2 tests)
- FORBIDDEN (3 tests: chat context, booking context, generic)
- VALIDATION_ERROR (3 tests: chat, booking, matching contexts)
- UNIQUE_CONSTRAINT
- BOOKING_CONFLICT
- MATCHING_CONFLICT
- INTERNAL_ERROR

**Client-only codes mapped**:
- CLIENT_TIMEOUT (2 tests: chat context, generic)
- NOT_CONNECTED, NO_SOCKET, CONNECT_ERROR (3 tests)
- INVALID_ENVELOPE, INVALID_RESPONSE, INVALID_JSON (3 tests)

**Integration tests (3 tests)**:
- Full WS ACK → normalized → user message
- Full HTTP Strict → normalized → user message
- Full client-only → normalized → user message

**Unknown codes (1 test)**:
- Generic fallback message

---

## Usage in Deliverable C

### Example 1: Chat Message Send (WS + HTTP fallback)

**Current** (`apps/web/app/messages/[id]/page-websocket.tsx:185-200`):
```tsx
const result = await sendMessage(input.trim(), 'TEXT');
if (result.success) {
  setInput('');
  setError(null);
} else if (result.error) {
  if (result.error.code === 'RATE_LIMITED' && result.error.retryAfter) {
    const cooldownUntil = Date.now() + (result.error.retryAfter * 1000);
    setRateLimitedUntil(cooldownUntil);
    setError(`Trop de messages envoyés. Réessayez dans ${result.error.retryAfter}s`);
  } else {
    setError(`Erreur: ${result.error.message}`);
  }
}
```

**After Deliverable C** (using helpers):
```tsx
import { normalizeAppError } from '@/lib/normalizeAppError';
import { getUserFacingMessage } from '@/lib/getUserFacingMessage';

const result = await sendMessage(input.trim(), 'TEXT');
if (result.success) {
  setInput('');
  setError(null);
} else if (result.error) {
  const normalized = normalizeAppError(result.error);
  const userMsg = getUserFacingMessage(normalized, {
    domain: 'chat',
    action: 'send-message',
  });

  // Handle RATE_LIMITED cooldown
  if (normalized.code === 'RATE_LIMITED' && normalized.retryAfterSeconds) {
    const cooldownUntil = Date.now() + (normalized.retryAfterSeconds * 1000);
    setRateLimitedUntil(cooldownUntil);
  }

  // Set user-facing error
  setError(userMsg);
}
```

**Benefits**:
- Consistent error messages across all domains
- Context-aware messages (chat vs. booking vs. matching)
- Clear severity levels (warning, error, critical)
- Action hints (retry, relogin, contact_support, fix_input)

---

### Example 2: Booking Availability Create

**Current** (`apps/web/app/pro/planning/page.tsx:50-72`):
```tsx
try {
  const [availabilityRes, requestsRes, bookingsRes] = await Promise.all([
    apiClient.getBookingAvailabilitiesForPro(),
    apiClient.getBookingRequestsInbox(),
    apiClient.getProBookings(),
  ]);
  // ...
} catch (err: unknown) {
  const message = err instanceof Error ? err.message : 'Erreur de chargement du planning';
  setError(message);
}
```

**After Deliverable C**:
```tsx
import { normalizeAppError } from '@/lib/normalizeAppError';
import { getUserFacingMessage } from '@/lib/getUserFacingMessage';

try {
  // ... same
} catch (err: unknown) {
  const normalized = normalizeAppError(err);
  const userMsg = getUserFacingMessage(normalized, {
    domain: 'booking',
    action: 'load-planning',
    role: 'pro',
  });

  // Can now access structured error info
  setError(userMsg);
  setSeverity(userMsg.severity); // 'warning', 'error', 'critical'
  setCanRetry(userMsg.canRetry);
  setActionHint(userMsg.actionHint); // Show retry button, relogin link, etc.
}
```

---

### Example 3: Matching Decision

**Current** (`apps/web/app/matching/cards/CardsClient.tsx:198`):
```tsx
catch (err: unknown) {
  const message = err instanceof Error ? err.message : null;
  setError(message || 'Erreur chargement');
}
```

**After Deliverable C**:
```tsx
catch (err: unknown) {
  const normalized = normalizeAppError(err);
  const userMsg = getUserFacingMessage(normalized, {
    domain: 'matching',
    action: 'match-decision',
  });

  setError(userMsg);

  // Can distinguish error types
  if (normalized.code === 'MATCHING_CONFLICT') {
    // Profile already matched → skip to next
    nextCandidate();
  } else if (normalized.canRetry) {
    // Show retry button
    setShowRetry(true);
  }
}
```

---

## Type Definitions

### `AppError` (normalized error)

```typescript
interface AppError {
  source: 'WS_ACK' | 'WS_CHANNEL' | 'HTTP_STRICT' | 'HTTP_LEGACY' | 'UNKNOWN';
  kind: 'transient' | 'permanent' | 'client_only';
  code: string; // Can be ERROR_CODES or client-only codes
  message: string;
  retryAfterSeconds?: number;
  canRetry: boolean;
  actionHint: 'retry' | 'relogin' | 'contact_support' | 'fix_input' | 'none';
  debug?: {
    status?: number;
    url?: string;
    details?: unknown;
  };
}
```

### `UserMessage` (user-facing message)

```typescript
interface UserMessage {
  title: string; // e.g., "Trop de tentatives"
  text: string; // e.g., "Vous avez envoyé trop de messages. Réessayez dans 30 secondes."
  severity: 'info' | 'warning' | 'error' | 'critical';
  canRetry: boolean;
  retryAfterSeconds?: number;
  actionHint?: 'retry' | 'relogin' | 'contact_support' | 'fix_input' | 'none';
}
```

### `ErrorContext` (for user message mapping)

```typescript
interface ErrorContext {
  domain: 'chat' | 'booking' | 'matching' | 'reporting';
  action: string; // e.g., 'send-message', 'create-availability', 'match-decision'
  role?: 'rider' | 'pro' | 'admin';
}
```

---

## Next Steps (Deliverable C)

1. **Migrate useChat.ts** to use `normalizeAppError` + add HTTP fallback on CLIENT_TIMEOUT
2. **Update page-websocket.tsx** to use `getUserFacingMessage` for all errors
3. **Migrate pro/planning/page.tsx** to extract error codes from `StrictHttpError`
4. **Migrate matching/cards/CardsClient.tsx** to use unified error handling
5. **Add message state machine** (pending → sent → delayed_fallback → failed)

---

## Key Guarantees

✅ **Never throws** — `normalizeAppError` never throws, always returns valid `AppError`
✅ **Never mixes codes** — ERROR_CODES (server) kept separate from client-only codes
✅ **Context-aware** — User messages adapt to domain/action/role
✅ **Fully tested** — 59 tests covering all error sources and classification rules
✅ **Zero functional changes** — Existing components remain untouched until Deliverable C

---

**Ready for review!**
