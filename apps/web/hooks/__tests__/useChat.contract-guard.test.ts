/**
 * Contract Drift Guard Test (C4.4)
 *
 * Simple guard test that fails if clientMsgId contract breaks.
 * Uses shallow pattern matching to detect drift without fragility.
 *
 * CRITICAL: If this test fails, clientMsgId idempotence is broken!
 */

import * as fs from 'fs';
import * as path from 'path';

describe('clientMsgId Contract Drift Guard', () => {
  const projectRoot = path.resolve(__dirname, '../..');

  /**
   * Guard #1: WS payload must include clientMsgId
   * File: hooks/useChat.ts
   * Pattern: socket.emit('send-message', {..., clientMsgId, ...})
   */
  it('should transmit clientMsgId in WS send-message payload', () => {
    const useChatPath = path.join(projectRoot, 'hooks/useChat.ts');
    const content = fs.readFileSync(useChatPath, 'utf-8');

    // Check that emitWithAck is called with 'send-message' and clientMsgId is in payload
    const hasEmitWithAck = content.includes("emitWithAck(socket, 'send-message'");
    const hasClientMsgIdInPayload = content.includes('clientMsgId');

    // More specific: check that the payload object construction includes clientMsgId
    const payloadPattern = /const\s+payload\s*=\s*\{[^}]*clientMsgId[^}]*\}/s;
    const hasClientMsgIdInPayloadObject = payloadPattern.test(content);

    expect(hasEmitWithAck).toBe(true);
    expect(hasClientMsgIdInPayload).toBe(true);
    expect(hasClientMsgIdInPayloadObject).toBe(true);
  });

  /**
   * Guard #2: HTTP fallback must include clientMsgId
   * File: hooks/useChat.ts
   * Pattern: apiClient.sendMessage*(conversationId, {..., clientMsgId, ...})
   */
  it('should transmit clientMsgId in HTTP fallback body', () => {
    const useChatPath = path.join(projectRoot, 'hooks/useChat.ts');
    const content = fs.readFileSync(useChatPath, 'utf-8');

    // Check that HTTP payload (httpPayload) includes clientMsgId
    const hasHttpPayload = content.includes('httpPayload');
    const hasClientMsgIdInHttpPayload = /httpPayload[^;]*clientMsgId/s.test(content);

    // Check that sendMessageWithStatus is called (HTTP fallback method)
    const hasSendMessageWithStatus = content.includes('sendMessageWithStatus');

    expect(hasHttpPayload).toBe(true);
    expect(hasClientMsgIdInHttpPayload).toBe(true);
    expect(hasSendMessageWithStatus).toBe(true);
  });

  /**
   * Guard #3: Reconciliation must prioritize clientMsgId matching
   * File: app/messages/[id]/page-websocket.tsx
   * Pattern: clientMsgId match check BEFORE content+time fallback
   */
  it('should reconcile by clientMsgId first (before content+time fallback)', () => {
    const pageWebSocketPath = path.join(projectRoot, 'app/messages/[id]/page-websocket.tsx');
    const content = fs.readFileSync(pageWebSocketPath, 'utf-8');

    // Extract the setOptimisticMessages reconciliation block specifically
    // Look for the reconciliation logic within setOptimisticMessages
    const reconciliationMatch = content.match(/setOptimisticMessages\(prev\s*=>\s*\{[\s\S]*?\n\s*\}\);/);

    expect(reconciliationMatch).toBeTruthy();

    if (reconciliationMatch) {
      const reconciliationBlock = reconciliationMatch[0];

      // Check that clientMsgId matching exists in this block
      const hasClientMsgIdMatch = /opt\.clientMsgId\s*===\s*formattedMessage\.clientMsgId/.test(reconciliationBlock);

      // Check that content+time fallback exists (backward compat)
      const hasContentTimeMatch = /opt\.content\s*===\s*formattedMessage\.content/.test(reconciliationBlock) &&
                                   /Date\.now\(\)\s*-\s*opt\.createdAtLocal/.test(reconciliationBlock);

      // Verify order: clientMsgId check must appear before content+time check
      const clientMsgIdIndex = reconciliationBlock.search(/opt\.clientMsgId\s*===\s*formattedMessage\.clientMsgId/);
      const contentTimeIndex = reconciliationBlock.search(/opt\.content\s*===\s*formattedMessage\.content/);

      expect(hasClientMsgIdMatch).toBe(true);
      expect(hasContentTimeMatch).toBe(true);
      expect(clientMsgIdIndex).toBeGreaterThan(-1);
      expect(contentTimeIndex).toBeGreaterThan(-1);
      expect(clientMsgIdIndex).toBeLessThan(contentTimeIndex);
    }
  });

  /**
   * Guard #4: sendMessage must accept optional clientMsgId parameter
   * File: hooks/useChat.ts
   * Pattern: sendMessage(..., clientMsgId?: string)
   */
  it('should accept optional clientMsgId parameter in sendMessage', () => {
    const useChatPath = path.join(projectRoot, 'hooks/useChat.ts');
    const content = fs.readFileSync(useChatPath, 'utf-8');

    // Check that sendMessage function signature includes clientMsgId parameter
    const hasSendMessageWithClientMsgId = /sendMessage.*clientMsgId\?:\s*string/s.test(content);

    // Check that providedClientMsgId variable exists (parameter name in implementation)
    const hasProvidedClientMsgId = content.includes('providedClientMsgId');

    expect(hasSendMessageWithClientMsgId).toBe(true);
    expect(hasProvidedClientMsgId).toBe(true);
  });

  /**
   * Guard #5: sendMessage result must include clientMsgId
   * File: hooks/useChat.ts
   * Pattern: return { ..., clientMsgId, ... }
   */
  it('should return clientMsgId in sendMessage result', () => {
    const useChatPath = path.join(projectRoot, 'hooks/useChat.ts');
    const content = fs.readFileSync(useChatPath, 'utf-8');

    // Check that return statements include clientMsgId
    // Look for patterns like: return { success: true, transport: 'WS', clientMsgId, ... }
    const hasClientMsgIdInWSReturn = /return\s*\{[^}]*transport:\s*'WS'[^}]*clientMsgId[^}]*\}/s.test(content);
    const hasClientMsgIdInHTTPReturn = /return\s*\{[^}]*transport:\s*'HTTP'[^}]*clientMsgId[^}]*\}/s.test(content);
    const hasClientMsgIdInFailureReturn = /return\s*\{[^}]*success:\s*false[^}]*clientMsgId[^}]*\}/s.test(content);

    expect(hasClientMsgIdInWSReturn).toBe(true);
    expect(hasClientMsgIdInHTTPReturn).toBe(true);
    expect(hasClientMsgIdInFailureReturn).toBe(true);
  });
});
