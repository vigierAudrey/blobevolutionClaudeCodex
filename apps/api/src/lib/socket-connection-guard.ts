/**
 * WebSocket Connection Guards (P0 Security)
 *
 * PROTECTIONS:
 * - Max connexions par user (défaut: 10)
 * - Max connexions par IP (défaut: 50, si proxy config fiable)
 * - Cleanup automatique garanti sur disconnect et erreur auth
 *
 * LIMITATIONS:
 * - Tracking en mémoire (1 instance Node uniquement)
 * - Si multi-instances (load balancer) : limites par instance, pas global
 * - Solution multi-instances : utiliser Redis (non implémenté ici, P1)
 *
 * SÉCURITÉ:
 * - Pas de logs PII (pas d'IP en clair, seulement compteurs)
 * - Erreurs publiques neutres (pas de détails internes)
 * - IP tracking seulement si proxy config fiable (sinon fallback user-only)
 */

import type { Socket } from 'socket.io';
import { secureLogger } from '../utils/secure-logger';
import { getClientIp, getTrustProxyMode, isTrustProxyConfigSafe } from './client-ip';

// ============================================================================
// CONFIGURATION
// ============================================================================

const MAX_CONNECTIONS_PER_USER = Number(process.env.WS_MAX_CONN_PER_USER || '10');
const MAX_CONNECTIONS_PER_IP = Number(process.env.WS_MAX_CONN_PER_IP || '50');

// Vérification de la fiabilité de l'IP en production
const isProduction = process.env.NODE_ENV === 'production';
const trustProxyMode = getTrustProxyMode();
const isTrustProxySafe = isTrustProxyConfigSafe();

/**
 * P0 DÉCISION: Activer le tracking par IP uniquement si config proxy fiable
 *
 * RAISONS:
 * - Si proxy non configuré → socket.remoteAddress = IP du proxy (pas du client)
 * - Si config unsafe → risque de spoofing X-Forwarded-For
 * - Mieux vaut limiter par user uniquement que risquer faux positifs IP
 *
 * CRITÈRES "FIABLE":
 * - En dev: toujours fiable (loopback trusted)
 * - En prod: mode 'ips' avec TRUSTED_PROXY_IPS valide
 */
const enableIpTracking = !isProduction || (trustProxyMode === 'ips' && isTrustProxySafe);

if (!enableIpTracking) {
  secureLogger.warn('WS_CONN_IP_TRACKING_DISABLED', {
    env: process.env.NODE_ENV,
    trustProxyMode,
    isTrustProxySafe,
    reason: isProduction
      ? 'Production proxy config unsafe or missing (TRUSTED_PROXY_IPS not configured)'
      : 'Unknown environment',
    fallback: 'User-only tracking active',
    risk: 'Multi-tabs from same user across different IPs not limited per-IP'
  });
}

// ============================================================================
// TRACKING STORAGE (en mémoire)
// ============================================================================

/**
 * Map: userId → Set<socketId>
 * Permet de compter et tracker les connexions par user
 */
const userConnections = new Map<string, Set<string>>();

/**
 * Map: ip → Set<socketId>
 * Seulement si enableIpTracking = true
 */
const ipConnections = new Map<string, Set<string>>();

/**
 * Map: socketId → { userId, ip }
 * Permet le cleanup en O(1) sur disconnect
 */
const socketMetadata = new Map<string, { userId: string; ip?: string }>();

// ============================================================================
// EXTRACTION IP SÉCURISÉE (Socket.IO handshake)
// ============================================================================

/**
 * Extrait l'IP client depuis un socket Socket.IO de manière sécurisée
 *
 * SÉCURITÉ:
 * - Utilise la logique de client-ip.ts (trust proxy safe)
 * - Socket.IO handshake ≠ Express req, donc adaptation nécessaire
 *
 * @param socket - Socket Socket.IO
 * @returns IP normalisée ou undefined si indisponible
 */
function getSocketClientIp(socket: Socket): string | undefined {
  // Socket.IO handshake a une structure similaire à Express req
  // mais pas identique. On crée un objet compatible.
  const pseudoReq = {
    socket: socket.request.socket,
    connection: socket.request.connection,
    ip: socket.handshake.address,
    ips: [], // Socket.IO ne parse pas X-Forwarded-For automatiquement
    headers: socket.handshake.headers
  } as any;

  // Utiliser getClientIp qui gère trust proxy
  return getClientIp(pseudoReq);
}

// ============================================================================
// GUARDS
// ============================================================================

/**
 * Vérifie si une nouvelle connexion est autorisée
 *
 * @param userId - ID utilisateur authentifié
 * @param socket - Socket Socket.IO (pour extraction IP)
 * @returns null si OK, string avec raison si bloqué (erreur neutre publique)
 */
export function checkConnectionAllowed(userId: string, socket: Socket): string | null {
  // Guard 1: Max connexions par user
  const userSockets = userConnections.get(userId);
  const currentUserCount = userSockets?.size || 0;

  if (currentUserCount >= MAX_CONNECTIONS_PER_USER) {
    secureLogger.warn('WS_CONN_BLOCKED_USER_LIMIT', {
      userId,
      current: currentUserCount,
      limit: MAX_CONNECTIONS_PER_USER
    });
    // Erreur publique neutre (pas de détails internes)
    return 'Connection limit reached';
  }

  // Guard 2: Max connexions par IP (seulement si enableIpTracking)
  if (enableIpTracking) {
    const ip = getSocketClientIp(socket);

    if (ip) {
      const ipSockets = ipConnections.get(ip);
      const currentIpCount = ipSockets?.size || 0;

      if (currentIpCount >= MAX_CONNECTIONS_PER_IP) {
        secureLogger.warn('WS_CONN_BLOCKED_IP_LIMIT', {
          // PAS d'IP en clair dans les logs (RGPD)
          ipHash: ip.substring(0, 8) + '...', // Truncated pour privacy
          current: currentIpCount,
          limit: MAX_CONNECTIONS_PER_IP,
          userId // OK de logger userId (pas PII sensible seul)
        });
        // Erreur publique neutre
        return 'Connection limit reached';
      }
    }
  }

  return null; // OK, connexion autorisée
}

/**
 * Enregistre une connexion (tracking)
 *
 * @param userId - ID utilisateur
 * @param socket - Socket Socket.IO
 */
export function trackConnection(userId: string, socket: Socket): void {
  const socketId = socket.id;

  // Track par user
  if (!userConnections.has(userId)) {
    userConnections.set(userId, new Set());
  }
  userConnections.get(userId)!.add(socketId);

  // Track par IP (seulement si activé)
  let ip: string | undefined;
  if (enableIpTracking) {
    ip = getSocketClientIp(socket);
    if (ip) {
      if (!ipConnections.has(ip)) {
        ipConnections.set(ip, new Set());
      }
      ipConnections.get(ip)!.add(socketId);
    }
  }

  // Stocker metadata pour cleanup rapide
  socketMetadata.set(socketId, { userId, ip });

  // Log sans PII
  secureLogger.debug('WS_CONN_TRACKED', {
    userId,
    socketId: socketId.substring(0, 8) + '...', // Truncated
    userTotal: userConnections.get(userId)!.size,
    ipTracking: enableIpTracking,
    ipTotal: ip ? ipConnections.get(ip)?.size : 'N/A'
  });
}

/**
 * Nettoie une connexion (appelé sur disconnect)
 *
 * GARANTIE: Cleanup complet en O(1) grâce à socketMetadata
 *
 * @param socketId - ID du socket à nettoyer
 */
export function untrackConnection(socketId: string): void {
  const metadata = socketMetadata.get(socketId);

  if (!metadata) {
    // Socket jamais tracké (erreur auth avant tracking) → OK, skip silently
    return;
  }

  const { userId, ip } = metadata;

  // Cleanup user tracking
  const userSockets = userConnections.get(userId);
  if (userSockets) {
    userSockets.delete(socketId);
    if (userSockets.size === 0) {
      userConnections.delete(userId);
    }
  }

  // Cleanup IP tracking
  if (ip) {
    const ipSockets = ipConnections.get(ip);
    if (ipSockets) {
      ipSockets.delete(socketId);
      if (ipSockets.size === 0) {
        ipConnections.delete(ip);
      }
    }
  }

  // Cleanup metadata
  socketMetadata.delete(socketId);

  secureLogger.debug('WS_CONN_UNTRACKED', {
    userId,
    socketId: socketId.substring(0, 8) + '...'
  });
}

/**
 * Métriques pour observabilité (pas de PII)
 */
export function getConnectionMetrics() {
  const totalUsers = userConnections.size;
  const totalIps = enableIpTracking ? ipConnections.size : 0;
  const totalConnections = Array.from(userConnections.values())
    .reduce((sum, sockets) => sum + sockets.size, 0);

  return {
    totalUsers,
    totalIps: enableIpTracking ? totalIps : null,
    totalConnections,
    avgConnectionsPerUser: totalUsers > 0 ? (totalConnections / totalUsers).toFixed(2) : '0',
    ipTrackingEnabled: enableIpTracking,
    limits: {
      maxPerUser: MAX_CONNECTIONS_PER_USER,
      maxPerIp: enableIpTracking ? MAX_CONNECTIONS_PER_IP : null
    }
  };
}

/**
 * LIMITATION MULTI-INSTANCES:
 *
 * Ce système de tracking en mémoire fonctionne pour 1 instance Node.
 *
 * Si déploiement multi-instances (ex: 3 serveurs derrière load balancer):
 * - Chaque instance a son propre tracking
 * - Limite effective = limite × nb instances
 * - Ex: 10 conn/user × 3 instances = 30 connexions max par user (global)
 *
 * SOLUTION MULTI-INSTANCES (P1):
 * - Utiliser Redis pour tracking global
 * - Redis INCR/DECR pour compteurs atomiques
 * - Redis EXPIRE pour cleanup automatique
 * - Fallback mémoire si Redis down (comme socket-rate-limit.ts)
 *
 * DÉCISION P0:
 * - Tracking mémoire suffisant pour MVP (déploiement 1 instance typique)
 * - Redis tracking = P1 (à implémenter avant scaling horizontal)
 */
