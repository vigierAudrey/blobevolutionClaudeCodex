# Chat Module Tests

## Expected Test Logs

### Prisma P2002 Errors During Idempotence Tests

When running `client-msg-id-idempotence.test.ts`, you may see Prisma error logs like:

```
prisma:error
Invalid `prisma.message.create()` invocation
Unique constraint failed on the fields: (`conversationId`,`clientMsgId`)
```

**This is EXPECTED behavior.**

The create-then-fallback pattern intentionally catches P2002 errors to detect replay scenarios:

```typescript
try {
  msg = await prisma.message.create({ conversationId, clientMsgId }); // First send succeeds
  wasCreated = true; // → 201 Created
} catch (e) {
  if (e.code === 'P2002') { // Replay throws P2002 (EXPECTED!)
    // Uses composite unique constraint (conversationId, clientMsgId)
    msg = await prisma.message.findUnique({
      where: { conversation_client_msg_unique: { conversationId, clientMsgId } }
    });
    wasCreated = false; // → 200 OK
  }
}
```

These errors are part of the idempotence mechanism and allow the API to correctly return:
- **201 Created** for first send
- **200 OK** for replay/concurrent requests

All tests should pass (9/9) despite these logs.
