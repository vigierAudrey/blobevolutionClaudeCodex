'use client';

import { useEffect, useState, useCallback } from 'react';
import { z } from 'zod';
import { useSocket } from './useSocket';
import { emitWithAck } from '../lib/emitWithAck';
import { ackSuccessSchemaRequired, ERROR_CODES, type ErrorCode } from '../lib/socketAck';
import { apiClient } from '../lib/apiClient';
import type { SendMessagePayload } from '@/types/messages';

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
}

interface SendMessageFailure {
  success: false;
  error: unknown; // Raw error (not normalized)
}

type SendMessageResult = SendMessageSuccess | SendMessageFailure;

interface UseChatReturn {
  connected: boolean;
  sendMessage: (content: string, type?: 'TEXT' | 'PROPOSAL', meta?: { date?: string; place?: string; note?: string }) => Promise<SendMessageResult>;
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
  const sendMessage = useCallback(
    async (content: string, type: 'TEXT' | 'PROPOSAL' = 'TEXT', meta?: { date?: string; place?: string; note?: string }): Promise<SendMessageResult> => {
      const trimmed = content.trim();
      if (!connected || !trimmed) {
        const error: SocketError = { code: 'NOT_CONNECTED', message: 'Socket not connected' };
        setLastError(error);
        return { success: false, error };
      }

      if (!socket) {
        const error: SocketError = { code: 'NO_SOCKET', message: 'Socket instance not available' };
        setLastError(error);
        return { success: false, error };
      }

      // ✅ C4: Generate clientMsgId for idempotence (NEVER regenerate on retry)
      const clientMsgId = crypto.randomUUID();

      const payload = {
        conversationId,
        content: trimmed,
        type,
        clientMsgId // Transmit to backend for idempotence
      };

      // Try WS first
      try {
        await emitWithAck(socket, 'send-message', payload, sendAckSchema);
        setLastError(null);
        return { success: true, transport: 'WS' };
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
            await apiClient.sendMessage(conversationId, httpPayload);
            setLastError(null);
            return { success: true, transport: 'HTTP' };
          } catch (httpErr: unknown) {
            // HTTP fallback failed, return raw HTTP error (not normalized)
            return { success: false, error: httpErr };
          }
        }

        // Other WS errors: return raw error (not normalized)
        return { success: false, error: wsErr };
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
