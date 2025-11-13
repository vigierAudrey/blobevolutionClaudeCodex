import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;

/**
 * Récupère ou crée l'instance Socket.io
 */
export function getSocket(token?: string): Socket {
  if (socket && socket.connected) {
    return socket;
  }

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

  socket = io(apiUrl, {
    autoConnect: false, // Connexion manuelle
    withCredentials: true,
    auth: {
      token: token || ''
    },
    transports: ['websocket', 'polling'], // WebSocket en priorité
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionAttempts: 5
  });

  // Logs de connexion/déconnexion
  socket.on('connect', () => {
    console.log('[WebSocket] Connected to server');
  });

  socket.on('disconnect', (reason) => {
    console.log('[WebSocket] Disconnected:', reason);
  });

  socket.on('connect_error', (error) => {
    console.error('[WebSocket] Connection error:', error.message);
  });

  socket.on('error', (error) => {
    console.error('[WebSocket] Error:', error);
  });

  return socket;
}

/**
 * Déconnecte le socket
 */
export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

/**
 * Vérifie si le socket est connecté
 */
export function isSocketConnected(): boolean {
  return socket?.connected || false;
}
