'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { Socket } from 'socket.io-client';
import { getSocket, disconnectSocket, isSocketConnected, reconnectSocket } from '../lib/socket';
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
  emit: (event: string, data: unknown) => void;
  on: (event: string, handler: (data: unknown) => void) => void;
  off: (event: string, handler?: (data: unknown) => void) => void;
}

/**
 * Hook React pour gérer la connexion WebSocket.
 *
 * Auth mode cookie-only : aucun token JWT n'est manipulé côté JS.
 * Le cookie httpOnly `accessToken` est envoyé automatiquement par le navigateur.
 * Après un refresh de session, la reconnexion suffit (le cookie est mis à jour server-side).
 *
 * @example
 * const { socket, connected, emit, on } = useSocket({
 *   token: sessionHint, // utilisé comme gate "utilisateur connecté" uniquement
 *   autoConnect: true
 * });
 */
export function useSocket(options: UseSocketOptions = {}): UseSocketReturn {
  const { token, autoConnect = false } = options;
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [lastSocketError, setLastSocketError] = useState<SocketError | null>(null);
  const refreshAttemptedRef = useRef(false);
  const inFlightRefreshRef = useRef<Promise<boolean> | null>(null);

  // Initialiser le socket
  useEffect(() => {
    // Gate : ne pas créer de socket si l'utilisateur n'est pas connecté
    if (!token) return;

    const socketInstance = getSocket(token);
    setSocket(socketInstance);

    const handleConnect = () => {
      setConnected(true);
      setLastSocketError(null);
      // Reset des guards refresh à chaque connexion réussie
      refreshAttemptedRef.current = false;
      inFlightRefreshRef.current = null;
    };

    const handleDisconnect = () => setConnected(false);

    const handleConnectError = async (error: Error) => {
      if (process.env.NODE_ENV !== 'production') {
        // eslint-disable-next-line no-console
        console.warn('[WebSocket] Connection error (type only):', error.constructor.name);
      }

      if (isAuthConnectError(error)) {
        // Anti-concurrent refresh : attendre le refresh en vol
        if (inFlightRefreshRef.current) {
          const refreshed = await inFlightRefreshRef.current;
          if (refreshed && !socketInstance.connected) {
            // Cookie mis à jour server-side — reconnexion suffit
            reconnectSocket();
          }
          return;
        }

        if (!refreshAttemptedRef.current) {
          refreshAttemptedRef.current = true;

          const refreshPromise = apiClient.refreshToken();
          inFlightRefreshRef.current = refreshPromise;

          const refreshed = await refreshPromise;
          inFlightRefreshRef.current = null;

          if (refreshed) {
            if (!socketInstance.connected) {
              // Cookie rafraîchi server-side — le handshake enverra le nouveau cookie
              reconnectSocket();
            }
            return;
          }

          // Refresh échoué → déconnexion propre
          apiClient.clearTokens();
          setLastSocketError({
            code: 'AUTH_FAILED',
            message: 'Session expired, please login again'
          });
        }
      } else {
        setLastSocketError({
          code: 'CONNECT_ERROR',
          message: 'Connection failed'
        });
      }
    };

    const handleSocketError = (errorPayload: SocketError) => {
      setLastSocketError(errorPayload);
    };

    socketInstance.on('connect', handleConnect);
    socketInstance.on('disconnect', handleDisconnect);
    socketInstance.on('connect_error', handleConnectError);
    socketInstance.on('socket-error', handleSocketError);

    if (autoConnect && !socketInstance.connected) {
      socketInstance.connect();
    }

    return () => {
      socketInstance.off('connect', handleConnect);
      socketInstance.off('disconnect', handleDisconnect);
      socketInstance.off('connect_error', handleConnectError);
      socketInstance.off('socket-error', handleSocketError);
    };
  }, [token, autoConnect]);

  const connect = useCallback(() => {
    if (socket && !socket.connected) {
      socket.connect();
    }
  }, [socket]);

  const disconnect = useCallback(() => {
    disconnectSocket();
    setConnected(false);
    setSocket(null);
  }, []);

  const emit = useCallback((event: string, data: unknown) => {
    if (socket?.connected) {
      socket.emit(event, data);
    }
  }, [socket]);

  const on = useCallback((event: string, handler: (data: unknown) => void) => {
    if (socket) {
      socket.on(event, handler);
    }
  }, [socket]);

  const off = useCallback((event: string, handler?: (data: unknown) => void) => {
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
