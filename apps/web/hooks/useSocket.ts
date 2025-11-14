'use client';

import { useEffect, useState, useCallback } from 'react';
import { Socket } from 'socket.io-client';
import { getSocket, disconnectSocket, isSocketConnected } from '../lib/socket';

interface UseSocketOptions {
  token?: string;
  autoConnect?: boolean;
}

interface UseSocketReturn {
  socket: Socket | null;
  connected: boolean;
  connect: () => void;
  disconnect: () => void;
  emit: (event: string, data: any) => void;
  on: (event: string, handler: (data: any) => void) => void;
  off: (event: string, handler?: (data: any) => void) => void;
}

/**
 * Hook React pour gérer la connexion WebSocket
 *
 * @example
 * const { socket, connected, emit, on } = useSocket({
 *   token: accessToken,
 *   autoConnect: true
 * });
 *
 * useEffect(() => {
 *   on('new-message', (message) => {
 *     console.log('New message:', message);
 *   });
 * }, [on]);
 */
export function useSocket(options: UseSocketOptions = {}): UseSocketReturn {
  const { token, autoConnect = false } = options;
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);

  // Initialiser le socket
  useEffect(() => {
    if (!token) return;

    const socketInstance = getSocket(token);
    setSocket(socketInstance);

    // Écouter les événements de connexion
    const handleConnect = () => setConnected(true);
    const handleDisconnect = () => setConnected(false);

    socketInstance.on('connect', handleConnect);
    socketInstance.on('disconnect', handleDisconnect);

    // Connexion automatique si demandée
    if (autoConnect && !socketInstance.connected) {
      socketInstance.connect();
    }

    // Cleanup à la destruction du composant
    return () => {
      socketInstance.off('connect', handleConnect);
      socketInstance.off('disconnect', handleDisconnect);
    };
  }, [token, autoConnect]);

  // Fonction pour se connecter manuellement
  const connect = useCallback(() => {
    if (socket && !socket.connected) {
      socket.connect();
    }
  }, [socket]);

  // Fonction pour se déconnecter
  const disconnect = useCallback(() => {
    disconnectSocket();
    setConnected(false);
    setSocket(null);
  }, []);

  // Fonction pour émettre un événement
  const emit = useCallback((event: string, data: any) => {
    if (socket?.connected) {
      socket.emit(event, data);
    } else {
      console.warn('[useSocket] Cannot emit: socket not connected');
    }
  }, [socket]);

  // Fonction pour écouter un événement
  const on = useCallback((event: string, handler: (data: any) => void) => {
    if (socket) {
      socket.on(event, handler);
    }
  }, [socket]);

  // Fonction pour arrêter d'écouter un événement
  const off = useCallback((event: string, handler?: (data: any) => void) => {
    if (socket) {
      if (handler) {
        socket.off(event, handler);
      } else {
        socket.off(event);
      }
    }
  }, [socket]);

  return {
    socket,
    connected,
    connect,
    disconnect,
    emit,
    on,
    off
  };
}
