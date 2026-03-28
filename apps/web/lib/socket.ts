import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;

/**
 * Récupère ou crée l'instance Socket.io.
 *
 * Auth mode cookie-only : le navigateur envoie automatiquement le cookie httpOnly
 * `accessToken` lors du handshake WebSocket grâce à `withCredentials: true`.
 * Aucun token JWT n'est transmis côté JS dans le handshake auth.
 *
 * Le paramètre _token est conservé pour compatibilité des appelants mais ignoré.
 */
export function getSocket(_token?: string): Socket {
  if (socket && socket.connected) {
    return socket;
  }

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

  socket = io(apiUrl, {
    autoConnect: false,
    withCredentials: true, // Envoie le cookie httpOnly accessToken sur le handshake
    transports: ['websocket', 'polling'], // WebSocket en priorité
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionAttempts: 5
  });

  return socket;
}

/**
 * Force un cycle disconnect → connect pour renouveler le handshake.
 * À appeler après un refresh de session (le serveur a mis à jour le cookie).
 * Aucun token à passer — le cookie mis à jour est envoyé automatiquement.
 */
export function reconnectSocket(): void {
  if (!socket) return;

  if (socket.connected) {
    socket.disconnect();
  }

  socket.connect();
}

/**
 * @deprecated Utiliser reconnectSocket().
 * Conservé pour compatibilité — le token passé est ignoré (cookie-only auth).
 */
export function reconnectSocketWithNewToken(_newToken: string): void {
  reconnectSocket();
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
