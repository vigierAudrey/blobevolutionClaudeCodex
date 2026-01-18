/**
 * Tests for outbound WebSocket payload schemas (server → client)
 * Ensures all emitted payloads are strictly validated before emit
 */

import {
  newMessageOutboundSchema,
  userTypingOutboundSchema,
  newMatchOutboundSchema,
  matchDecisionOutboundSchema,
  newMatchingCardOutboundSchema,
  type NewMessageOutbound,
  type UserTypingOutbound,
  type NewMatchOutbound,
  type MatchDecisionOutbound,
  type NewMatchingCardOutbound
} from '../socket-schemas';

describe('Outbound WebSocket Schemas (Server → Client)', () => {
  // ============================================================================
  // newMessageOutboundSchema
  // ============================================================================

  describe('newMessageOutboundSchema', () => {
    it('should validate a valid TEXT message with riderProfile', () => {
      const validPayload: NewMessageOutbound = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        conversationId: '550e8400-e29b-41d4-a716-446655440001',
        senderId: '550e8400-e29b-41d4-a716-446655440002',
        type: 'TEXT',
        content: 'Hello world',
        createdAt: '2026-01-18T10:30:00.000Z',
        sender: {
          id: '550e8400-e29b-41d4-a716-446655440002',
          role: 'RIDER',
          riderProfile: {
            displayName: 'John Doe',
            photoUrl: 'https://example.com/photo.jpg'
          }
        }
      };

      expect(() => newMessageOutboundSchema.parse(validPayload)).not.toThrow();
      const parsed = newMessageOutboundSchema.parse(validPayload);
      expect(parsed).toEqual(validPayload);
    });

    it('should validate a valid PROPOSAL message with proProfile and null photoUrl', () => {
      const validPayload: NewMessageOutbound = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        conversationId: '550e8400-e29b-41d4-a716-446655440001',
        senderId: '550e8400-e29b-41d4-a716-446655440002',
        type: 'PROPOSAL',
        content: 'Proposal message',
        createdAt: '2026-01-18T10:30:00.000Z',
        sender: {
          id: '550e8400-e29b-41d4-a716-446655440002',
          role: 'PRO',
          proProfile: {
            businessName: 'Acme Corp',
            photoUrl: null
          }
        }
      };

      expect(() => newMessageOutboundSchema.parse(validPayload)).not.toThrow();
    });

    it('should reject message with missing required field (id)', () => {
      const invalidPayload = {
        // id missing
        conversationId: '550e8400-e29b-41d4-a716-446655440001',
        senderId: '550e8400-e29b-41d4-a716-446655440002',
        type: 'TEXT',
        content: 'Hello',
        createdAt: '2026-01-18T10:30:00.000Z',
        sender: {
          id: '550e8400-e29b-41d4-a716-446655440002',
          role: 'RIDER'
        }
      };

      expect(() => newMessageOutboundSchema.parse(invalidPayload)).toThrow();
    });

    it('should reject message with invalid type enum', () => {
      const invalidPayload = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        conversationId: '550e8400-e29b-41d4-a716-446655440001',
        senderId: '550e8400-e29b-41d4-a716-446655440002',
        type: 'INVALID_TYPE', // invalid
        content: 'Hello',
        createdAt: '2026-01-18T10:30:00.000Z',
        sender: {
          id: '550e8400-e29b-41d4-a716-446655440002',
          role: 'RIDER'
        }
      };

      expect(() => newMessageOutboundSchema.parse(invalidPayload)).toThrow();
    });

    it('should reject message with unknown extra field (strict mode)', () => {
      const invalidPayload = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        conversationId: '550e8400-e29b-41d4-a716-446655440001',
        senderId: '550e8400-e29b-41d4-a716-446655440002',
        type: 'TEXT',
        content: 'Hello',
        createdAt: '2026-01-18T10:30:00.000Z',
        sender: {
          id: '550e8400-e29b-41d4-a716-446655440002',
          role: 'RIDER'
        },
        extraField: 'should reject' // unknown field
      };

      expect(() => newMessageOutboundSchema.parse(invalidPayload)).toThrow();
    });

    it('should reject message with Date object instead of ISO string', () => {
      const invalidPayload = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        conversationId: '550e8400-e29b-41d4-a716-446655440001',
        senderId: '550e8400-e29b-41d4-a716-446655440002',
        type: 'TEXT',
        content: 'Hello',
        createdAt: new Date(), // Date object instead of ISO string
        sender: {
          id: '550e8400-e29b-41d4-a716-446655440002',
          role: 'RIDER'
        }
      };

      expect(() => newMessageOutboundSchema.parse(invalidPayload)).toThrow();
    });
  });

  // ============================================================================
  // userTypingOutboundSchema
  // ============================================================================

  describe('userTypingOutboundSchema', () => {
    it('should validate a valid typing=true payload', () => {
      const validPayload: UserTypingOutbound = {
        userId: '550e8400-e29b-41d4-a716-446655440000',
        isTyping: true
      };

      expect(() => userTypingOutboundSchema.parse(validPayload)).not.toThrow();
      const parsed = userTypingOutboundSchema.parse(validPayload);
      expect(parsed).toEqual(validPayload);
    });

    it('should validate a valid typing=false payload', () => {
      const validPayload: UserTypingOutbound = {
        userId: '550e8400-e29b-41d4-a716-446655440000',
        isTyping: false
      };

      expect(() => userTypingOutboundSchema.parse(validPayload)).not.toThrow();
    });

    it('should reject payload with missing isTyping', () => {
      const invalidPayload = {
        userId: '550e8400-e29b-41d4-a716-446655440000'
        // isTyping missing
      };

      expect(() => userTypingOutboundSchema.parse(invalidPayload)).toThrow();
    });

    it('should reject payload with wrong type for isTyping', () => {
      const invalidPayload = {
        userId: '550e8400-e29b-41d4-a716-446655440000',
        isTyping: 'true' // string instead of boolean
      };

      expect(() => userTypingOutboundSchema.parse(invalidPayload)).toThrow();
    });
  });

  // ============================================================================
  // newMatchOutboundSchema
  // ============================================================================

  describe('newMatchOutboundSchema', () => {
    it('should validate a valid new match with conversationId and photoUrl', () => {
      const validPayload: NewMatchOutbound = {
        matchId: 'match-123',
        conversationId: 'conv-456',
        otherUser: {
          id: 'user-789',
          displayName: 'Jane Doe',
          photoUrl: 'https://example.com/photo.jpg'
        }
      };

      expect(() => newMatchOutboundSchema.parse(validPayload)).not.toThrow();
      const parsed = newMatchOutboundSchema.parse(validPayload);
      expect(parsed).toEqual(validPayload);
    });

    it('should validate a valid new match without conversationId and null photoUrl', () => {
      const validPayload: NewMatchOutbound = {
        matchId: 'match-123',
        otherUser: {
          id: 'user-789',
          displayName: 'Jane Doe',
          photoUrl: null
        }
      };

      expect(() => newMatchOutboundSchema.parse(validPayload)).not.toThrow();
    });

    it('should reject payload with missing matchId', () => {
      const invalidPayload = {
        // matchId missing
        otherUser: {
          id: 'user-789',
          displayName: 'Jane Doe'
        }
      };

      expect(() => newMatchOutboundSchema.parse(invalidPayload)).toThrow();
    });

    it('should reject payload with malformed otherUser', () => {
      const invalidPayload = {
        matchId: 'match-123',
        otherUser: {
          id: 'user-789'
          // displayName missing
        }
      };

      expect(() => newMatchOutboundSchema.parse(invalidPayload)).toThrow();
    });
  });

  // ============================================================================
  // matchDecisionOutboundSchema
  // ============================================================================

  describe('matchDecisionOutboundSchema', () => {
    it('should validate a valid ACCEPT decision with conversationId', () => {
      const validPayload: MatchDecisionOutbound = {
        actorUserId: 'user-123',
        decision: 'ACCEPT',
        mutualMatch: true,
        conversationId: 'conv-456'
      };

      expect(() => matchDecisionOutboundSchema.parse(validPayload)).not.toThrow();
      const parsed = matchDecisionOutboundSchema.parse(validPayload);
      expect(parsed).toEqual(validPayload);
    });

    it('should validate a valid DECLINE decision without conversationId', () => {
      const validPayload: MatchDecisionOutbound = {
        actorUserId: 'user-123',
        decision: 'DECLINE',
        mutualMatch: false
      };

      expect(() => matchDecisionOutboundSchema.parse(validPayload)).not.toThrow();
    });

    it('should reject payload with invalid decision enum', () => {
      const invalidPayload = {
        actorUserId: 'user-123',
        decision: 'MAYBE', // invalid enum
        mutualMatch: true
      };

      expect(() => matchDecisionOutboundSchema.parse(invalidPayload)).toThrow();
    });

    it('should reject payload with wrong type for mutualMatch', () => {
      const invalidPayload = {
        actorUserId: 'user-123',
        decision: 'ACCEPT',
        mutualMatch: 'true' // string instead of boolean
      };

      expect(() => matchDecisionOutboundSchema.parse(invalidPayload)).toThrow();
    });
  });

  // ============================================================================
  // newMatchingCardOutboundSchema
  // ============================================================================

  describe('newMatchingCardOutboundSchema', () => {
    it('should validate a valid matching card payload', () => {
      const validPayload: NewMatchingCardOutbound = {
        sport: 'TENNIS',
        level: 'INTERMEDIATE',
        profileId: 'profile-123'
      };

      expect(() => newMatchingCardOutboundSchema.parse(validPayload)).not.toThrow();
      const parsed = newMatchingCardOutboundSchema.parse(validPayload);
      expect(parsed).toEqual(validPayload);
    });

    it('should validate another valid matching card payload with different values', () => {
      const validPayload: NewMatchingCardOutbound = {
        sport: 'FOOTBALL',
        level: 'ADVANCED',
        profileId: 'profile-456'
      };

      expect(() => newMatchingCardOutboundSchema.parse(validPayload)).not.toThrow();
    });

    it('should reject payload with missing profileId', () => {
      const invalidPayload = {
        sport: 'TENNIS',
        level: 'INTERMEDIATE'
        // profileId missing
      };

      expect(() => newMatchingCardOutboundSchema.parse(invalidPayload)).toThrow();
    });

    it('should reject payload with wrong type for sport', () => {
      const invalidPayload = {
        sport: 123, // number instead of string
        level: 'INTERMEDIATE',
        profileId: 'profile-123'
      };

      expect(() => newMatchingCardOutboundSchema.parse(invalidPayload)).toThrow();
    });

    it('should reject payload with unknown extra field (strict mode)', () => {
      const invalidPayload = {
        sport: 'TENNIS',
        level: 'INTERMEDIATE',
        profileId: 'profile-123',
        extraField: 'should reject'
      };

      expect(() => newMatchingCardOutboundSchema.parse(invalidPayload)).toThrow();
    });
  });

  // ============================================================================
  // Integration test: Payload construction from DB models
  // ============================================================================

  describe('Integration: Payload construction safety', () => {
    it('should catch createdAt Date-to-string conversion requirement', () => {
      // Simulates what happens if socket.ts forgets to call .toISOString()
      const dbMessage = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        conversationId: '550e8400-e29b-41d4-a716-446655440001',
        senderId: '550e8400-e29b-41d4-a716-446655440002',
        type: 'TEXT',
        content: 'Hello',
        createdAt: new Date('2026-01-18T10:30:00.000Z'), // Date object (not ISO string)
        sender: {
          id: '550e8400-e29b-41d4-a716-446655440002',
          role: 'RIDER'
        }
      };

      // Should throw because createdAt is Date, not string
      expect(() => newMessageOutboundSchema.parse(dbMessage)).toThrow();

      // Correct way: convert Date to ISO string
      const correctedPayload = {
        ...dbMessage,
        createdAt: dbMessage.createdAt.toISOString()
      };
      expect(() => newMessageOutboundSchema.parse(correctedPayload)).not.toThrow();
    });

    it('should catch unknown fields added by mistake', () => {
      // Simulates accidentally including internal DB fields
      const payloadWithInternalField = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        conversationId: '550e8400-e29b-41d4-a716-446655440001',
        senderId: '550e8400-e29b-41d4-a716-446655440002',
        type: 'TEXT',
        content: 'Hello',
        createdAt: '2026-01-18T10:30:00.000Z',
        sender: {
          id: '550e8400-e29b-41d4-a716-446655440002',
          role: 'RIDER'
        },
        _internalDbField: 'should not be emitted' // Simulates accidental leak
      };

      // Strict mode should catch this
      expect(() => newMessageOutboundSchema.parse(payloadWithInternalField)).toThrow();
    });
  });
});
