/**
 * Guard CI test: Ensures all P1 outbound socket emits are validated with Zod
 *
 * This test prevents regressions where someone removes Zod validation before emit.
 * It's a targeted guard that only checks the 5 specific P1 emit sites identified in the audit.
 *
 * NOT a global ESLint rule (which could have false positives).
 */

import fs from 'fs';
import path from 'path';

describe('Socket Outbound Validation Guard (P1 Critical Events)', () => {
  const socketFilePath = path.join(__dirname, '../socket.ts');
  let socketFileContent: string;

  beforeAll(() => {
    socketFileContent = fs.readFileSync(socketFilePath, 'utf-8');
  });

  /**
   * Helper: Check if a specific event emit is preceded by schema validation
   * @param eventName - The WebSocket event name (e.g., 'new-message')
   * @param schemaName - The Zod schema name (e.g., 'newMessageOutboundSchema')
   */
  function assertEmitHasValidation(eventName: string, schemaName: string) {
    // Pattern: find `.emit('event-name', ...)`
    const emitPattern = new RegExp(`\\.emit\\(['"]${eventName}['"]`, 'g');
    const matches = [...socketFileContent.matchAll(emitPattern)];

    expect(matches.length).toBeGreaterThan(0); // Event emit exists

    // For each emit, verify that the schema.parse() is present nearby (within ~20 lines before)
    for (const match of matches) {
      const emitIndex = match.index!;
      const contextBefore = socketFileContent.substring(Math.max(0, emitIndex - 1000), emitIndex);

      // Check if schema.parse() is present in the context before emit
      const hasValidation = contextBefore.includes(`${schemaName}.parse(`);

      if (!hasValidation) {
        // Also check if this is the legacy 'error' or 'socket-error' emit (which are allowed without validation)
        const isLegacyErrorEmit = eventName === 'error' || eventName === 'socket-error';
        if (!isLegacyErrorEmit) {
          fail(
            `Missing Zod validation for event '${eventName}'. ` +
            `Expected '${schemaName}.parse()' before '.emit('${eventName}', ...)' at position ${emitIndex}. ` +
            `Context: ${contextBefore.substring(contextBefore.length - 200)}`
          );
        }
      }
    }
  }

  // ============================================================================
  // P1 Critical Events - Must have Zod validation
  // ============================================================================

  it('should validate new-message emit with newMessageOutboundSchema', () => {
    assertEmitHasValidation('new-message', 'newMessageOutboundSchema');
  });

  it('should validate user-typing emit with userTypingOutboundSchema', () => {
    assertEmitHasValidation('user-typing', 'userTypingOutboundSchema');
  });

  it('should validate new-match emit with newMatchOutboundSchema', () => {
    assertEmitHasValidation('new-match', 'newMatchOutboundSchema');
  });

  it('should validate match-decision emit with matchDecisionOutboundSchema', () => {
    assertEmitHasValidation('match-decision', 'matchDecisionOutboundSchema');
  });

  it('should validate new-matching-card emit with newMatchingCardOutboundSchema', () => {
    assertEmitHasValidation('new-matching-card', 'newMatchingCardOutboundSchema');
  });

  // ============================================================================
  // Verification: Schemas are imported
  // ============================================================================

  it('should import all required outbound schemas', () => {
    const requiredSchemas = [
      'newMessageOutboundSchema',
      'userTypingOutboundSchema',
      'newMatchOutboundSchema',
      'matchDecisionOutboundSchema',
      'newMatchingCardOutboundSchema'
    ];

    for (const schema of requiredSchemas) {
      expect(socketFileContent).toContain(schema);
    }
  });

  // ============================================================================
  // Documentation: Verify P1 markers are present
  // ============================================================================

  it('should have P1 markers in comments for each validated emit', () => {
    // Check that the code has been annotated with "P1: Validate outbound payload"
    const p1MarkerPattern = /✅ P1: Validate outbound payload with Zod before emit/g;
    const p1Markers = [...socketFileContent.matchAll(p1MarkerPattern)];

    // Should have 5 P1 markers (one for each critical event)
    expect(p1Markers.length).toBe(5);
  });

  // ============================================================================
  // Anti-regression: Detect if someone bypasses validation
  // ============================================================================

  it('should NOT have any direct emit for P1 events without validation', () => {
    const criticalEvents = [
      'new-message',
      'user-typing',
      'new-match',
      'match-decision',
      'new-matching-card'
    ];

    for (const eventName of criticalEvents) {
      // Pattern to detect direct emit without a validation variable
      // Looking for patterns like: .emit('event-name', { ... }) instead of .emit('event-name', validatedPayload)

      // Find all emits for this event
      const emitPattern = new RegExp(`\\.emit\\(['"]${eventName}['"],\\s*([^)]+)\\)`, 'g');
      const matches = [...socketFileContent.matchAll(emitPattern)];

      for (const match of matches) {
        const emitArg = match[1].trim();

        // Check if the argument is an inline object literal { ... } instead of a validated variable
        // Validated variables should be like: newMessagePayload, userTypingPayload, etc.
        const isInlineObject = emitArg.startsWith('{');

        if (isInlineObject) {
          // Inline object without validation - this is a regression
          fail(
            `Found direct inline object emit for '${eventName}' at position ${match.index}. ` +
            `All P1 events must use validated payload variables (e.g., 'newMessagePayload'). ` +
            `Found: .emit('${eventName}', ${emitArg.substring(0, 50)}...)`
          );
        }
      }
    }
  });

  // ============================================================================
  // Positive test: Ensure guard can detect actual violations
  // ============================================================================

  describe('Guard self-test: Verify guard can detect violations', () => {
    it('should detect missing validation if someone removes schema.parse()', () => {
      // Simulate removing validation for new-message
      const tamperedContent = socketFileContent.replace(
        'newMessageOutboundSchema.parse(',
        '// TAMPERED: removed validation'
      );

      // Re-run the check with tampered content
      const emitPattern = /\.emit\(['"]new-message['"]/, ;
      const match = emitPattern.exec(tamperedContent);
      expect(match).not.toBeNull();

      if (match) {
        const emitIndex = match.index;
        const contextBefore = tamperedContent.substring(Math.max(0, emitIndex - 1000), emitIndex);
        const hasValidation = contextBefore.includes('newMessageOutboundSchema.parse(');

        // Should NOT have validation (because we removed it)
        expect(hasValidation).toBe(false);
      }
    });
  });
});
