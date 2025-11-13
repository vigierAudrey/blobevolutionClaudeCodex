'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSocket } from './useSocket';

interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  type: 'TEXT' | 'PROPOSAL';
  content: string;
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

interface UseChatReturn {
  connected: boolean;
  sendMessage: (content: string, type?: 'TEXT' | 'PROPOSAL') => void;
  setTyping: (isTyping: boolean) => void;
  otherUserTyping: boolean;
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
  const { socket, connected, emit, on, off } = useSocket({ token, autoConnect: true });
  const [otherUserTyping, setOtherUserTyping] = useState(false);

  // Rejoindre la conversation au montage
  useEffect(() => {
    if (!connected || !conversationId) return;

    emit('join-conversation', conversationId);

    return () => {
      emit('leave-conversation', conversationId);
    };
  }, [connected, conversationId, emit]);

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

  // Envoyer un message
  const sendMessage = useCallback((content: string, type: 'TEXT' | 'PROPOSAL' = 'TEXT') => {
    if (!connected || !content.trim()) return;

    emit('send-message', {
      conversationId,
      content: content.trim(),
      type
    });
  }, [connected, conversationId, emit]);

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
    otherUserTyping
  };
}
