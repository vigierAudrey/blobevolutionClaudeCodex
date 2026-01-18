/**
 * Schémas de validation Zod pour les événements WebSocket
 *
 * IMPORTANT: Tous les schémas acceptent les formats actuels (backward compatible)
 * - Format actuel: primitives (string directe)
 * - Format nouveau: objets
 *
 * La normalisation est faite via z.preprocess pour garantir une sortie uniforme.
 */

import { z } from 'zod';

/**
 * Schéma de base pour conversationId en objet
 */
const conversationIdObject = z.object({
  conversationId: z.string().uuid('conversationId must be a valid UUID')
});

/**
 * Schéma de base pour leave-conversation (permissif, non UUID strict)
 */
const leaveConversationObject = z.object({
  conversationId: z.string().min(1)
});

/**
 * Types dérivés des schémas (définis avant pour être réutilisés)
 */
export type JoinConversationPayload = z.infer<typeof conversationIdObject>;
export type LeaveConversationPayload = z.infer<typeof leaveConversationObject>;

// Type d'input (avant normalisation)
export type SendMessageInput = {
  conversationId: string;
  content: string;
  type: 'TEXT' | 'PROPOSAL';
  clientMsgId?: string; // Canonique
  clientMessageId?: string; // Legacy (deprecated)
};

// Type de sortie (après normalisation via transform)
export type SendMessagePayload = {
  conversationId: string;
  content: string;
  type: 'TEXT' | 'PROPOSAL';
  clientMsgId?: string; // Normalisé
};

export type TypingPayload = {
  conversationId: string;
  isTyping: boolean;
};

/**
 * Schéma pour join-conversation
 *
 * BACKWARD COMPATIBLE:
 * - Accepte: 'uuid-string' (format actuel probable)
 * - Accepte: { conversationId: 'uuid-string' } (nouveau format)
 *
 * Retourne toujours: { conversationId: string }
 */
export const joinConversationSchema = z.preprocess(
  (val) => (typeof val === 'string' ? { conversationId: val } : val),
  conversationIdObject
) as z.ZodType<JoinConversationPayload>;

/**
 * Schéma pour leave-conversation
 *
 * BACKWARD COMPATIBLE + NON STRICT:
 * - Accepte: n'importe quelle string non vide (pas forcément UUID)
 * - Accepte: { conversationId: string } (nouveau format)
 *
 * RAISON: leave est non critique, on évite une régression si format actuel différent
 */
export const leaveConversationSchema = z.preprocess(
  (val) => (typeof val === 'string' ? { conversationId: val } : val),
  leaveConversationObject
) as z.ZodType<LeaveConversationPayload>;

/**
 * Schéma pour send-message
 *
 * BACKWARD COMPATIBLE:
 * - Accepte: { conversationId, content, type? } (format actuel)
 * - Accepte: clientMessageId (legacy) OU clientMsgId (nouveau)
 * - Si les deux présents: doivent être identiques, sinon VALIDATION_ERROR
 * - Normalise vers clientMsgId canonique
 */
export const sendMessageSchema = z.object({
  conversationId: z.string().uuid('conversationId must be a valid UUID'),
  content: z.string()
    .min(1, 'Message cannot be empty')
    .max(1000, 'Message too long (max 1000 characters)'),
  type: z.enum(['TEXT', 'PROPOSAL']).optional().default('TEXT'),
  clientMsgId: z.string().uuid().optional(), // Nouveau (canonique)
  clientMessageId: z.string().uuid().optional() // Legacy (deprecated)
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
}) as z.ZodType<SendMessagePayload>;

/**
 * Schéma pour typing
 *
 * BACKWARD COMPATIBLE:
 * - Accepte: { conversationId, isTyping } (format actuel)
 */
export const typingSchema = z.object({
  conversationId: z.string().uuid('conversationId must be a valid UUID'),
  isTyping: z.boolean()
});

// ============================================================================
// OUTBOUND SCHEMAS (Server → Client)
// ============================================================================

/**
 * Schema for 'new-message' event payload (server → client)
 * Validates message broadcast to conversation members
 */
export const newMessageOutboundSchema = z.object({
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  senderId: z.string().uuid(),
  type: z.enum(['TEXT', 'PROPOSAL']),
  content: z.string(),
  createdAt: z.string(), // ISO 8601 string (NOT Date object)
  sender: z.object({
    id: z.string().uuid(),
    role: z.string(),
    riderProfile: z.object({
      displayName: z.string(),
      photoUrl: z.string().nullable()
    }).optional(),
    proProfile: z.object({
      businessName: z.string(),
      photoUrl: z.string().nullable()
    }).optional()
  })
}).strict();

export type NewMessageOutbound = z.infer<typeof newMessageOutboundSchema>;

/**
 * Schema for 'user-typing' event payload (server → client)
 * Validates typing indicator broadcast to conversation
 */
export const userTypingOutboundSchema = z.object({
  userId: z.string().uuid(),
  isTyping: z.boolean()
}).strict();

export type UserTypingOutbound = z.infer<typeof userTypingOutboundSchema>;

/**
 * Schema for 'new-match' event payload (server → client)
 * Validates new match notification to user
 */
export const newMatchOutboundSchema = z.object({
  matchId: z.string(),
  conversationId: z.string().optional(),
  otherUser: z.object({
    id: z.string(),
    displayName: z.string(),
    photoUrl: z.string().nullable().optional()
  })
}).strict();

export type NewMatchOutbound = z.infer<typeof newMatchOutboundSchema>;

/**
 * Schema for 'match-decision' event payload (server → client)
 * Validates match decision notification (accept/decline)
 */
export const matchDecisionOutboundSchema = z.object({
  actorUserId: z.string(),
  decision: z.enum(['ACCEPT', 'DECLINE']),
  mutualMatch: z.boolean(),
  conversationId: z.string().optional()
}).strict();

export type MatchDecisionOutbound = z.infer<typeof matchDecisionOutboundSchema>;

/**
 * Schema for 'new-matching-card' event payload (server → client)
 * Validates new matching card broadcast to all users
 */
export const newMatchingCardOutboundSchema = z.object({
  sport: z.string(),
  level: z.string(),
  profileId: z.string()
}).strict();

export type NewMatchingCardOutbound = z.infer<typeof newMatchingCardOutboundSchema>;

// ============================================================================
// ERROR HANDLING
// ============================================================================

/**
 * Codes d'erreur standardisés pour les événements WebSocket
 */
export enum SocketErrorCode {
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  NOT_MEMBER = 'NOT_MEMBER',
  BLOCKED = 'BLOCKED',
  RATE_LIMITED = 'RATE_LIMITED',
  INTERNAL_ERROR = 'INTERNAL_ERROR'
}

/**
 * Interface d'erreur WebSocket standardisée
 */
export interface SocketError {
  code: SocketErrorCode;
  message: string;
  details?: any;
  retryAfter?: number; // Pour rate limiting
}

/**
 * Helper de validation avec gestion d'erreurs
 * Retourne soit les données validées, soit une erreur formatée
 */
export function validateSocketPayload<T>(
  schema: z.ZodSchema<T>,
  data: unknown
): { success: true; data: T } | { success: false; error: SocketError } {
  const result = schema.safeParse(data);

  if (!result.success) {
    return {
      success: false,
      error: {
        code: SocketErrorCode.VALIDATION_ERROR,
        message: 'Invalid payload',
        details: result.error.errors
      }
    };
  }

  return { success: true, data: result.data };
}
