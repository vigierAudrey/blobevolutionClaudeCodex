'use client';

import { useEffect, useState, useCallback } from 'react';
import { z } from 'zod';
import { useSocket } from './useSocket';
import { emitWithAck } from '../lib/emitWithAck';
import { ackSuccessSchemaRequired, ERROR_CODES, type ErrorCode } from '../lib/socketAck';
import { apiClient } from '../lib/apiClient';
import type { SendMessagePayload } from '@/types/messages';

/**
 * Generate UUID v4 (RFC4122) as fallback when crypto.randomUUID is unavailable
 * Format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
 * - Version 4: always has '4' at position 14 (version field)
 * - Variant: bits 10 at positions 19-20 (variant field = [8,9,a,b])
 * Prefers crypto.getRandomValues for better entropy, falls back to Math.random
 */
function generateUuidV4Fallback(): string {
  // Use crypto.getRandomValues if available (better entropy than Math.random)
  const getRandomByte = typeof crypto !== 'undefined' && crypto.getRandomValues
    ? () => {
        const arr = new Uint8Array(1);
        crypto.getRandomValues(arr);
        return arr[0];
      }
    : () => Math.floor(Math.random() * 256);

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (getRandomByte() >> 4) & 0xf; // Get 4 random bits
    const v = c === 'x' ? r : (r & 0x3 | 0x8); // For 'y', set variant bits to 10xx
    return v.toString(16);
  });
}

interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  type: 'TEXT' | 'PROPOSAL';
  content: string;
  meta?: {
    date?: string;
    place?: string;
    note?: string;
    [key: string]: unknown;
  } | null;
  createdAt: string;
  sender?: {
    id: string;
    role: string;
    riderProfile?: { displayName: string; photoUrl: string | null };
    proProfile?: { businessName: string; photoUrl: string | null };
  };
}

interface UseChatOptions {
  conversationId: string;
  token: string;
  onNewMessage?: (message: Message) => void;
}

type SocketErrorCode =
  | ErrorCode
  | 'CLIENT_TIMEOUT'
  | 'NOT_CONNECTED'
  | 'NO_SOCKET'
  | 'AUTH_FAILED'
  | 'CONNECT_ERROR';

interface SocketError {
  code: SocketErrorCode;
  message: string;
  retryAfter?: number;
  details?: unknown;
}

interface SendMessageSuccess {
  success: true;
  transport: 'WS' | 'HTTP';
  clientMsgId: string; // ✅ C4.1: Return clientMsgId for parent tracking
  created?: boolean; // ✅ C4.1: Backend Option B flag (optional for backward compat)
}

interface SendMessageFailure {
  success: false;
  error: unknown; // Raw error (not normalized)
  clientMsgId?: string; // ✅ C4.1: clientMsgId even on failure (for retry tracking)
}

type SendMessageResult = SendMessageSuccess | SendMessageFailure;

interface UseChatReturn {
  connected: boolean;
  sendMessage: (content: string, type?: 'TEXT' | 'PROPOSAL', meta?: { date?: string; place?: string; note?: string }, clientMsgId?: string) => Promise<SendMessageResult>;
  setTyping: (isTyping: boolean) => void;
  otherUserTyping: boolean;
  lastError: SocketError | null;
}

const joinAckSchema = ackSuccessSchemaRequired(z.object({ conversationId: z.string() }));
const sendAckSchema = ackSuccessSchemaRequired(
  z.object({
    id: z.string(),
    conversationId: z.string(),
    content: z.string(),
    type: z.string(),
    createdAt: z.string(),
    created: z.boolean().optional() // Backend flag for idempotence (Option B)
  })
);

const SOCKET_ERROR_CODES = new Set<string>([
  ...Object.values(ERROR_CODES),
  'CLIENT_TIMEOUT',
  'NOT_CONNECTED',
  'NO_SOCKET',
  'AUTH_FAILED',
  'CONNECT_ERROR'
]);

const normalizeSocketError = (err: unknown): SocketError => {
  const rawCode = (err as any)?.code;
  const code: SocketErrorCode = typeof rawCode === 'string' && SOCKET_ERROR_CODES.has(rawCode) ? rawCode as SocketErrorCode : 'INTERNAL_ERROR';
  const details = (err as any)?.details;
  const retryAfterFromDetails = typeof details?.retryAfter === 'number' ? details.retryAfter : undefined;
  const retryAfter = typeof (err as any)?.retryAfter === 'number' ? (err as any).retryAfter : retryAfterFromDetails;
  return {
    code,
    message: (err as any)?.message ?? 'Unknown error',
    retryAfter,
    details
  };
};

/**
 * Hook React pour gérer une conversation en temps réel
 *
 * @example
 * const { connected, sendMessage, setTyping, otherUserTyping } = useChat({
 *   conversationId: 'conv-123',
 *   token: accessToken,
 *   onNewMessage: (message) => {
 *     setMessages(prev => [...prev, message]);
 *   }
 * });
 */
export function useChat(options: UseChatOptions): UseChatReturn {
  const { conversationId, token, onNewMessage } = options;
  const { socket, connected, lastSocketError, emit, on, off } = useSocket({ token, autoConnect: true });
  const [otherUserTyping, setOtherUserTyping] = useState(false);
  const [lastError, setLastError] = useState<SocketError | null>(null);
  const joinAckSchema = ackSuccessSchemaRequired(z.object({ conversationId: z.string() }));
  const sendAckSchema = ackSuccessSchemaRequired(
    z.object({
      id: z.string(),
      conversationId: z.string(),
      content: z.string(),
      type: z.string(),
      createdAt: z.string(),
      created: z.boolean().optional() // Backend flag for idempotence (Option B)
    })
  );

  // ✅ E-REVIEW P0 #1: Remonter lastSocketError du socket vers lastError
  useEffect(() => {
    if (lastSocketError) {
      setLastError(normalizeSocketError(lastSocketError));
    }
  }, [lastSocketError]);

  // Rejoindre la conversation au montage
  useEffect(() => {
    if (!connected || !conversationId) return;

    let cancelled = false;

    const doJoin = async () => {
      try {
        await emitWithAck(socket, 'join-conversation', { conversationId }, joinAckSchema);
        if (!cancelled) setLastError(null);
      } catch (err: any) {
        if (cancelled) return;
        const error = normalizeSocketError(err);
        setLastError(error);
      }
    };

    void doJoin();

    return () => {
      emit('leave-conversation', conversationId);
      cancelled = true;
    };
  }, [connected, conversationId, socket, emit]);

  // Écouter les nouveaux messages
  useEffect(() => {
    if (!socket) return;

    const handleNewMessage = (message: Message) => {
      if (onNewMessage) {
        onNewMessage(message);
      }
    };

    const handleUserTyping = (data: { userId: string; isTyping: boolean }) => {
      setOtherUserTyping(data.isTyping);

      // Désactiver l'indicateur après 3 secondes
      if (data.isTyping) {
        setTimeout(() => setOtherUserTyping(false), 3000);
      }
    };

    on('new-message', handleNewMessage);
    on('user-typing', handleUserTyping);

    return () => {
      off('new-message', handleNewMessage);
      off('user-typing', handleUserTyping);
    };
  }, [socket, on, off, onNewMessage]);

  // ✅ C2: Envoyer un message avec WS→HTTP fallback sur CLIENT_TIMEOUT
  // ✅ C4.1: Accept optional clientMsgId for retry idempotence
  const sendMessage = useCallback(
    async (content: string, type: 'TEXT' | 'PROPOSAL' = 'TEXT', meta?: { date?: string; place?: string; note?: string }, providedClientMsgId?: string): Promise<SendMessageResult> => {
      const trimmed = content.trim();
      if (!connected || !trimmed) {
        const error: SocketError = { code: 'NOT_CONNECTED', message: 'Socket not connected' };
        setLastError(error);
        return { success: false, error, clientMsgId: providedClientMsgId };
      }

      if (!socket) {
        const error: SocketError = { code: 'NO_SOCKET', message: 'Socket instance not available' };
        setLastError(error);
        return { success: false, error, clientMsgId: providedClientMsgId };
      }

      // ✅ C4.1: Use provided clientMsgId OR generate new one
      // ✅ C4.2: Always generate valid UUID v4 (backend expects RFC4122)
      const clientMsgId = providedClientMsgId || (
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : generateUuidV4Fallback()
      );

      const payload = {
        conversationId,
        content: trimmed,
        type,
        clientMsgId // Transmit to backend for idempotence
      };

      // Try WS first
      try {
        const ackData = await emitWithAck(socket, 'send-message', payload, sendAckSchema);
        setLastError(null);
        return {
          success: true,
          transport: 'WS',
          clientMsgId,
          created: ackData.created // Backend Option B flag (optional)
        };
      } catch (wsErr: any) {
        const error = normalizeSocketError(wsErr);
        setLastError(error);

        // CLIENT_TIMEOUT only: try HTTP fallback (1 WS + max 1 HTTP)
        if (error.code === 'CLIENT_TIMEOUT') {
          // Construct discriminated union payload with same clientMsgId (NEVER regenerate!)
          const httpPayload: SendMessagePayload =
            type === 'PROPOSAL' && meta
              ? { type: 'PROPOSAL', content: trimmed, meta, clientMsgId }
              : { type: 'TEXT', content: trimmed, clientMsgId };

          try {
            // C4.2: Use sendMessageWithStatus to capture HTTP status for created flag
            const httpResult = await apiClient.sendMessageWithStatus(conversationId, httpPayload);
            setLastError(null);

            // Derive created flag from HTTP status: 201 Created = true, 200 OK = false
            const created = httpResult.status === 201 ? true : httpResult.status === 200 ? false : undefined;

            return { success: true, transport: 'HTTP', clientMsgId, created };
          } catch (httpErr: unknown) {
            // HTTP fallback failed, return raw HTTP error (not normalized)
            return { success: false, error: httpErr, clientMsgId };
          }
        }

        // Other WS errors: return raw error (not normalized)
        return { success: false, error: wsErr, clientMsgId };
      }
    },
    [connected, conversationId, socket]
  );

  // Envoyer l'indicateur de frappe
  const setTyping = useCallback((isTyping: boolean) => {
    if (!connected) return;

    emit('typing', {
      conversationId,
      isTyping
    });
  }, [connected, conversationId, emit]);

  return {
    connected,
    sendMessage,
    setTyping,
    otherUserTyping,
    lastError
  };
}
