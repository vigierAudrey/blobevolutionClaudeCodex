import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;
let currentToken: string | null = null;

/**
 * Récupère ou crée l'instance Socket.io
 */
export function getSocket(token?: string): Socket {
  if (socket && socket.connected) {
    return socket;
  }

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
  currentToken = token || '';

  socket = io(apiUrl, {
    autoConnect: false, // Connexion manuelle
    withCredentials: true,
    auth: {
      token: currentToken
    },
    transports: ['websocket', 'polling'], // WebSocket en priorité
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionAttempts: 5
  });

  // ✅ E-REVIEW P0 #4: Supprimer console.* (logs gérés dans useSocket)
  // Pas de logs ici, gestion dans le hook React

  return socket;
}

/**
 * ✅ E-REVIEW P0 #3: Reconnexion fiable avec cycle disconnect/connect
 * Utilisé après refresh token pour éviter la perte de connexion
 *
 * Force un cycle complet disconnect → update auth → connect pour garantir
 * que Socket.IO utilise le nouveau token lors du handshake
 */
export function reconnectSocketWithNewToken(newToken: string): void {
  if (!socket) return;

  currentToken = newToken;

  // Mettre à jour le token d'authentification
  socket.auth = { token: newToken };

  // ✅ E-REVIEW P0 #3: Force disconnect puis reconnect pour refresh handshake
  if (socket.connected) {
    socket.disconnect();
  }

  // Reconnexion avec nouveau token
  socket.connect();
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
