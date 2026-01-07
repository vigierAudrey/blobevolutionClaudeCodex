'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSocket } from './useSocket';

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
  createdAt: Date;
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

interface SocketError {
  code: string;
  message: string;
  retryAfter?: number;
}

interface UseChatReturn {
  connected: boolean;
  sendMessage: (content: string, type?: 'TEXT' | 'PROPOSAL') => Promise<{ success: boolean; error?: SocketError }>;
  setTyping: (isTyping: boolean) => void;
  otherUserTyping: boolean;
  lastError: SocketError | null;
}

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

  // ✅ E-REVIEW P0 #1: Remonter lastSocketError du socket vers lastError
  useEffect(() => {
    if (lastSocketError) {
      setLastError(lastSocketError);
    }
  }, [lastSocketError]);

  // Rejoindre la conversation au montage
  useEffect(() => {
    if (!connected || !conversationId) return;

    // ✅ PATCH 2 (P0 #3): join-conversation avec ACK callback
    if (socket) {
      socket.emit('join-conversation', { conversationId }, (ack: any) => {
        if (!ack.ok && ack.error) {
          // ✅ E-REVIEW P0 #4: Pas de console.error, remontée UI via setLastError
          setLastError(ack.error);
        }
      });
    }

    return () => {
      emit('leave-conversation', conversationId);
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

  // ✅ PATCH 2 (P0 #3): Envoyer un message avec ACK callback
  const sendMessage = useCallback((content: string, type: 'TEXT' | 'PROPOSAL' = 'TEXT'): Promise<{ success: boolean; error?: SocketError }> => {
    if (!connected || !content.trim()) {
      return Promise.resolve({ success: false, error: { code: 'NOT_CONNECTED', message: 'Socket not connected' } });
    }

    if (!socket) {
      return Promise.resolve({ success: false, error: { code: 'NO_SOCKET', message: 'Socket instance not available' } });
    }

    return new Promise((resolve) => {
      const payload = {
        conversationId,
        content: content.trim(),
        type
      };

      // Timeout 5s pour ACK
      const timeout = setTimeout(() => {
        setLastError({ code: 'TIMEOUT', message: 'No response from server' });
        resolve({ success: false, error: { code: 'TIMEOUT', message: 'No response from server' } });
      }, 5000);

      socket.emit('send-message', payload, (ack: any) => {
        clearTimeout(timeout);

        if (ack.ok) {
          setLastError(null);
          resolve({ success: true });
        } else if (ack.error) {
          // Format normalisé: { ok: false, error: { code, message, retryAfter? } }
          setLastError(ack.error);
          resolve({ success: false, error: ack.error });
        } else {
          // Fallback format legacy
          const error = { code: ack.code || 'UNKNOWN', message: ack.message || 'Unknown error' };
          setLastError(error);
          resolve({ success: false, error });
        }
      });
    });
  }, [connected, conversationId, socket]);

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
