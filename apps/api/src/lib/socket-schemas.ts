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
export type SendMessagePayload = {
  conversationId: string;
  content: string;
  type: 'TEXT' | 'PROPOSAL';
  clientMessageId?: string;
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
 * - content.substring(0, 1000) était fait côté serveur → remplacé par validation Zod
 */
export const sendMessageSchema = z.object({
  conversationId: z.string().uuid('conversationId must be a valid UUID'),
  content: z.string()
    .min(1, 'Message cannot be empty')
    .max(1000, 'Message too long (max 1000 characters)'),
  type: z.enum(['TEXT', 'PROPOSAL']).optional().default('TEXT'),
  // Pour Phase P1 (idempotence) - optionnel en P0
  clientMessageId: z.string().uuid().optional()
});

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
