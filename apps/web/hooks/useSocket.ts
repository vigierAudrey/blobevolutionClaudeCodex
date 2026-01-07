'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { Socket } from 'socket.io-client';
import { getSocket, disconnectSocket, isSocketConnected, reconnectSocketWithNewToken } from '../lib/socket';
import { apiClient } from '../lib/apiClient';
import { isAuthConnectError } from '../lib/socketUtils';

interface UseSocketOptions {
  token?: string;
  autoConnect?: boolean;
}

interface SocketError {
  code: string;
  message: string;
  retryAfter?: number;
}

interface UseSocketReturn {
  socket: Socket | null;
  connected: boolean;
  lastSocketError: SocketError | null;
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
  const [lastSocketError, setLastSocketError] = useState<SocketError | null>(null);
  const refreshAttemptedRef = useRef(false);
  const inFlightRefreshRef = useRef<Promise<boolean> | null>(null);
  const lastReconnectedTokenRef = useRef<string | null>(null);

  // Initialiser le socket
  useEffect(() => {
    if (!token) return;

    const socketInstance = getSocket(token);
    setSocket(socketInstance);

    // Écouter les événements de connexion
    const handleConnect = () => {
      setConnected(true);
      setLastSocketError(null);
      // Reset refresh flag, in-flight Promise & reconnected token on successful connection
      refreshAttemptedRef.current = false;
      inFlightRefreshRef.current = null;
      lastReconnectedTokenRef.current = null;
    };

    const handleDisconnect = () => setConnected(false);

    // ✅ E-REVIEW P0 #2: Gestion connect_error robuste avec isAuthConnectError()
    const handleConnectError = async (error: Error) => {
      // ✅ E-REVIEW P0 #4: Ne jamais logger error brut
      // Log structuré sans détails sensibles
      if (process.env.NODE_ENV !== 'production') {
        // eslint-disable-next-line no-console
        console.warn('[WebSocket] Connection error (type only):', error.constructor.name);
      }

      // ✅ E-REVIEW P0 #2: Détection robuste avec heuristiques
      if (isAuthConnectError(error)) {
        // Anti-concurrent refresh: si déjà un refresh en vol, attendre celui-ci
        if (inFlightRefreshRef.current) {
          const refreshed = await inFlightRefreshRef.current;
          if (refreshed) {
            const newTokens = apiClient.getTokens();
            if (newTokens?.accessToken) {
              // Guard: ne reconnect que si (1) socket déconnecté ET (2) token différent
              if (!socketInstance.connected && lastReconnectedTokenRef.current !== newTokens.accessToken) {
                lastReconnectedTokenRef.current = newTokens.accessToken;
                reconnectSocketWithNewToken(newTokens.accessToken);
              }
            }
          }
          return;
        }

        // Premier refresh: vérifier flag
        if (!refreshAttemptedRef.current) {
          refreshAttemptedRef.current = true;

          // Lancer refresh et tracker Promise
          const refreshPromise = apiClient.refreshToken();
          inFlightRefreshRef.current = refreshPromise;

          const refreshed = await refreshPromise;
          inFlightRefreshRef.current = null;

          if (refreshed) {
            const newTokens = apiClient.getTokens();
            if (newTokens?.accessToken) {
              // ✅ E-REVIEW P0 #3: Reconnexion fiable + guard double reconnect
              lastReconnectedTokenRef.current = newTokens.accessToken;
              reconnectSocketWithNewToken(newTokens.accessToken);
              return; // Retry connexion avec nouveau token
            }
          }

          // Refresh failed → clear & redirect
          apiClient.clearTokens();
          setLastSocketError({
            code: 'AUTH_FAILED',
            message: 'Session expired, please login again'
          });
          // User sera redirigé vers login par le composant parent
        }
      } else {
        // Erreur non-auth
        setLastSocketError({
          code: 'CONNECT_ERROR',
          message: 'Connection failed'
        });
      }
    };

    // ✅ E-REVIEW P0 #1: Gestion event serveur 'socket-error'
    const handleSocketError = (errorPayload: SocketError) => {
      setLastSocketError(errorPayload);
    };

    socketInstance.on('connect', handleConnect);
    socketInstance.on('disconnect', handleDisconnect);
    socketInstance.on('connect_error', handleConnectError);
    socketInstance.on('socket-error', handleSocketError);

    // Connexion automatique si demandée
    if (autoConnect && !socketInstance.connected) {
      socketInstance.connect();
    }

    // Cleanup à la destruction du composant
    return () => {
      socketInstance.off('connect', handleConnect);
      socketInstance.off('disconnect', handleDisconnect);
      socketInstance.off('connect_error', handleConnectError);
      socketInstance.off('socket-error', handleSocketError);
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
    }
    // Note: si socket pas connecté, erreur déjà remontée via lastSocketError
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
    lastSocketError,
    connect,
    disconnect,
    emit,
    on,
    off
  };
}
