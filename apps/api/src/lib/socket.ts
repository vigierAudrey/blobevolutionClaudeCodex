import { Server as HTTPServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { clientPrisma as prisma } from '@blobinfini/database';
import { secureLogger } from '../utils/secure-logger';
import { notifyNewMessage } from '../modules/push/push.controller';
import { ackErrorSchema, ackSuccessSchema, ackSuccessSchemaRequired, createAckOnce, type AckResult } from './socket-ack';
import { ERROR_CODES } from '../utils/error-codes';
import { z } from 'zod';
import { checkConnectionAllowed, trackConnection, untrackConnection } from './socket-connection-guard';
import { checkReconnectionAllowed } from './socket-reconnection-guard';
import { getCachedAuth, setCachedAuth } from './socket-auth-cache';
import {
  joinConversationSchema,
  leaveConversationSchema,
  sendMessageSchema,
  typingSchema,
  validateSocketPayload,
  SocketErrorCode,
  newMessageOutboundSchema,
  userTypingOutboundSchema,
  newMatchOutboundSchema,
  matchDecisionOutboundSchema,
  newMatchingCardOutboundSchema
} from './socket-schemas';
import {
  getSendMessageLimiter,
  getTypingLimiter,
  getJoinLimiter,
  checkRateLimit
} from './socket-rate-limit';

let io: SocketIOServer | null = null;

interface SocketUser {
  id: string;
  role: string;
}

interface AuthenticatedSocket extends Socket {
  user?: SocketUser;
}

type AckFn = (payload: AckResult<unknown>) => void;
type AckSchema = z.ZodType<{ ok: true; data: unknown }>;

const ensureAck = (ack?: unknown): AckFn => {
  if (typeof ack === 'function') return ack as AckFn;
  return () => {};
};

const ackSuccess = (ack: AckFn, data: unknown, schema: AckSchema) => {
  const payload: AckResult<unknown> = { ok: true, data };
  schema.parse(payload);
  ack(payload);
};

const ackError = (ack: AckFn, code: (typeof ERROR_CODES)[keyof typeof ERROR_CODES], message: string, details?: unknown) => {
  const payload = { ok: false, error: { code, message, ...(details !== undefined ? { details } : {}) } };
  ackErrorSchema.parse(payload);
  ack(payload);
};

const mapSocketErrorCode = (code: SocketErrorCode): (typeof ERROR_CODES)[keyof typeof ERROR_CODES] => {
  switch (code) {
    case SocketErrorCode.VALIDATION_ERROR:
      return ERROR_CODES.VALIDATION_ERROR;
    case SocketErrorCode.RATE_LIMITED:
      return ERROR_CODES.RATE_LIMITED;
    default:
      return ERROR_CODES.FORBIDDEN;
  }
};

const sanitizeRateLimitDetails = (details: unknown) => {
  if (!details || typeof details !== 'object') return undefined;
  const d = details as Record<string, unknown>;
  const safe: Record<string, unknown> = {};
  if (typeof d.retryAfter === 'number') safe.retryAfter = d.retryAfter;
  if (typeof d.retryAfterMs === 'number') safe.retryAfterMs = d.retryAfterMs;
  if (typeof d.limit === 'number') safe.limit = d.limit;
  if (typeof d.windowMs === 'number') safe.windowMs = d.windowMs;
  return Object.keys(safe).length > 0 ? safe : undefined;
};

const emitSocketError = (
  socket: Socket,
  payload: { ok: false; error: { code: (typeof ERROR_CODES)[keyof typeof ERROR_CODES]; message: string; details?: unknown } },
  legacyCode?: SocketErrorCode
) => {
  const mergedDetails =
    legacyCode !== undefined
      ? { ...(payload.error.details as Record<string, unknown> | undefined), legacyCode }
      : payload.error.details;
  const normalized = { ok: false as const, error: { ...payload.error, ...(mergedDetails !== undefined ? { details: mergedDetails } : {}) } };
  ackErrorSchema.parse(normalized);
  socket.emit('socket-error', normalized);
  socket.emit('error', normalized);
};

/**
 * Middleware d'authentification Socket.io
 * Vérifie le JWT avant d'autoriser la connexion
 *
 * P0 SECURITY (Step 2):
 * - Vérifie rate limit reconnection AVANT query DB (étape 2)
 * - Vérifie limites connexions AVANT query DB (étape 1)
 * - Cache auth en mémoire TTL 30s (réduit charge DB, étape 2)
 * - Cleanup garanti sur erreur
 * - Erreurs publiques neutres
 *
 * ORDRE D'EXÉCUTION:
 * 1. Vérifier JWT (décodage token)
 * 2. Vérifier rate limit reconnection (Storm guard Step 2)
 * 3. Vérifier limites connexions simultanées (Step 1)
 * 4. Vérifier cache auth (Step 2)
 * 5. Query DB si cache miss (fallback)
 * 6. Mettre en cache (Step 2)
 */
async function authenticateSocket(socket: AuthenticatedSocket, next: (err?: Error) => void) {
  try {
    const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      return next(new Error('Authentication required'));
    }

    // P0 STEP 2.1: Garde token size (évite DoS jwt.verify avec token énorme)
    const MAX_TOKEN_SIZE = 4096; // 4KB max (JWT normal ~200-500 bytes)
    if (token.length > MAX_TOKEN_SIZE) {
      secureLogger.warn('SOCKET_AUTH_TOKEN_TOO_LARGE', {
        tokenLength: token.length,
        maxAllowed: MAX_TOKEN_SIZE
      });
      return next(new Error('Authentication failed'));
    }

    // Étape 1: Vérifier le JWT (pas de query DB encore)
    const decoded = jwt.verify(token, process.env.JWT_SECRET || '') as { sub: string; role: string };
    const userId = decoded.sub;

    // P0 STEP 2: Vérifier rate limit reconnection AVANT toute query DB
    const reconnectBlockReason = await checkReconnectionAllowed(userId);
    if (reconnectBlockReason) {
      // Erreur publique neutre
      return next(new Error(reconnectBlockReason));
    }

    // P0 STEP 1: Vérifier limites connexions simultanées AVANT query DB
    const connectionBlockReason = checkConnectionAllowed(userId, socket);
    if (connectionBlockReason) {
      // Erreur publique neutre
      return next(new Error(connectionBlockReason));
    }

    // P0 STEP 2: Vérifier cache auth (évite query DB si hit)
    const cachedAuth = getCachedAuth(userId);

    let userExists: boolean;
    let userRole: string;

    if (cachedAuth) {
      // Cache HIT → pas de query DB
      if (!cachedAuth.exists) {
        return next(new Error('User not found'));
      }
      userExists = true;
      userRole = cachedAuth.role!;
    } else {
      // Cache MISS → query DB
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          role: true,
          deletedAt: true // P0 STEP 2.1: Vérifier soft delete
        }
      });

      // P0 STEP 2.1: User soft-deleted = inexistant
      if (!user || user.deletedAt) {
        // Mettre en cache l'absence (évite query DB répétées)
        setCachedAuth(userId, false);

        if (user?.deletedAt) {
          secureLogger.info('SOCKET_AUTH_DELETED_USER_BLOCKED', {
            userId,
            deletedAt: user.deletedAt.toISOString()
          });
        }

        return next(new Error('User not found'));
      }

      userExists = true;
      userRole = user.role;

      // P0 STEP 2: Mettre en cache le user
      setCachedAuth(userId, true, userRole);
    }

    // Attacher l'utilisateur au socket
    socket.user = { id: userId, role: userRole };
    next();
  } catch (error) {
    // Pas de log du token (sécurité PII)
    secureLogger.warn('SOCKET_AUTH_FAILED', {
      error: error instanceof Error ? error.message : 'Unknown',
      errorType: error instanceof Error ? error.constructor.name : 'Unknown'
    });
    next(new Error('Authentication failed'));
  }
}

/**
 * Initialise Socket.io avec le serveur HTTP
 */
export function initializeSocket(httpServer: HTTPServer): SocketIOServer {
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);

  const devOrigins = [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:3002',
    'http://127.0.0.1:3002'
  ];

  const origins = allowedOrigins.length > 0 ? allowedOrigins : devOrigins;

  io = new SocketIOServer(httpServer, {
    cors: {
      origin: origins,
      credentials: true
    },
    transports: ['websocket', 'polling'], // WebSocket en priorité, polling en fallback
    pingTimeout: 60000, // 60 secondes avant timeout
    pingInterval: 25000, // Ping toutes les 25 secondes
    // P0 Security: Limite taille payload (évite DoS CPU via JSON.parse de payload énorme)
    maxHttpBufferSize: 1e6, // 1MB max (Socket.IO default = 1MB, on rend explicite)
    perMessageDeflate: false // Désactiver compression (économie CPU, payload déjà limité)
  });

  // Appliquer l'authentification à toutes les connexions
  io.use(authenticateSocket);

  // Gérer les connexions
  io.on('connection', (socket: AuthenticatedSocket) => {
    const userId = socket.user?.id;

    if (!userId) {
      socket.disconnect();
      return;
    }

    // P0 FIX: Tracker la connexion (après auth réussie)
    trackConnection(userId, socket);

    console.log(`[WebSocket] User ${userId} connected (${socket.id})`);

    // Rejoindre une room personnelle (pour les messages directs)
    socket.join(`user:${userId}`);

    // Rejoindre une conversation
    socket.on('join-conversation', async (rawData: unknown, ackCb?: unknown) => {
      const ack = createAckOnce(ensureAck(ackCb));
      const fail = (
        code: (typeof ERROR_CODES)[keyof typeof ERROR_CODES],
        message: string,
        details?: unknown,
        legacyCode?: SocketErrorCode
      ) => {
        const safeDetails =
          code === ERROR_CODES.RATE_LIMITED ? sanitizeRateLimitDetails(details) : details;
        const payload = { ok: false as const, error: { code, message, ...(safeDetails !== undefined ? { details: safeDetails } : {}) } };
        ackErrorSchema.parse(payload);
        ack(payload);
        emitSocketError(socket, payload, legacyCode);
      };
      try {
        // ✅ PR1: Validation Zod (accepte string OU { conversationId })
        const validation = validateSocketPayload(joinConversationSchema, rawData);
        if (!validation.success) {
          secureLogger.warn('SOCKET_VALIDATION_ERROR', {
            userId,
            event: 'join-conversation',
            error: validation.error
          });
          fail(ERROR_CODES.VALIDATION_ERROR, 'Invalid input', validation.error, validation.error.code);
          return;
        }

        const { conversationId } = validation.data;

        // ✅ PR2: Rate limiting (20 joins/min par user)
        const rateCheck = await checkRateLimit(() => getJoinLimiter(), userId);
        if (!rateCheck.allowed) {
          const code = mapSocketErrorCode(rateCheck.error.code);
          fail(code, rateCheck.error.message, { retryAfter: rateCheck.error.retryAfter }, rateCheck.error.code);
          return;
        }

        // Vérifier que l'utilisateur est membre de cette conversation
        const member = await prisma.conversationMember.findFirst({
          where: {
            conversationId,
            userId
          }
        });

        if (!member) {
          const errPayload = {
            code: SocketErrorCode.NOT_MEMBER,
            message: 'Not a member of this conversation'
          };
          fail(ERROR_CODES.FORBIDDEN, errPayload.message, errPayload, errPayload.code);
          return;
        }

        socket.join(`conversation:${conversationId}`);
        console.log(`[WebSocket] User ${userId} joined conversation ${conversationId}`);
        ackSuccess(
          ack,
          { conversationId },
          ackSuccessSchemaRequired(z.object({ conversationId: z.string() }))
        );
      } catch (error) {
        console.error('[WebSocket] Error joining conversation:', error);
        const payload = {
          code: SocketErrorCode.INTERNAL_ERROR,
          message: 'Failed to join conversation'
        };
        fail(ERROR_CODES.INTERNAL_ERROR, payload.message, payload, payload.code);
      }
    });

    // Quitter une conversation
    socket.on('leave-conversation', (rawData: unknown) => {
      // ✅ PR1: Validation permissive (string non vide, pas UUID strict)
      const validation = validateSocketPayload(leaveConversationSchema, rawData);
      if (!validation.success) {
        // Silencieux (leave non critique, pas de log ni d'erreur émise)
        return;
      }

      const { conversationId } = validation.data;
      socket.leave(`conversation:${conversationId}`);
      console.log(`[WebSocket] User ${userId} left conversation ${conversationId}`);
    });

    // Envoyer un message
    socket.on('send-message', async (rawData: unknown, ackCb?: unknown) => {
      const ack = createAckOnce(ensureAck(ackCb));
      const fail = (
        code: (typeof ERROR_CODES)[keyof typeof ERROR_CODES],
        message: string,
        details?: unknown,
        legacyCode?: SocketErrorCode
      ) => {
        const payload = { ok: false as const, error: { code, message, ...(details !== undefined ? { details } : {}) } };
        ackErrorSchema.parse(payload);
        ack(payload);
        emitSocketError(socket, payload, legacyCode);
      };
      try {
        // ✅ PR1: Validation Zod (UUID, longueur 1-1000, type valide)
        const validation = validateSocketPayload(sendMessageSchema, rawData);
        if (!validation.success) {
          secureLogger.warn('SOCKET_VALIDATION_ERROR', {
            userId,
            event: 'send-message',
            error: validation.error
          });
          fail(ERROR_CODES.VALIDATION_ERROR, 'Invalid input', validation.error, validation.error.code);
          return;
        }

        const { conversationId, content, type, clientMsgId } = validation.data;

        // ✅ PR2: Rate limiting (10 msg/min par user+conversation)
        const rateLimitKey = `${userId}:${conversationId}`;
        const rateCheck = await checkRateLimit(() => getSendMessageLimiter(), rateLimitKey);
        if (!rateCheck.allowed) {
          const code = mapSocketErrorCode(rateCheck.error.code);
          fail(code, rateCheck.error.message, { retryAfter: rateCheck.error.retryAfter }, rateCheck.error.code);
          return;
        }

        // Vérifier que l'utilisateur est membre
        const member = await prisma.conversationMember.findFirst({
          where: { conversationId, userId }
        });

        if (!member) {
          const errPayload = {
            code: SocketErrorCode.NOT_MEMBER,
            message: 'Not a member of this conversation'
          };
          fail(ERROR_CODES.FORBIDDEN, errPayload.message, errPayload, errPayload.code);
          return;
        }

        // Vérifier si l'utilisateur est bloqué
        const otherMember = await prisma.conversationMember.findFirst({
          where: {
            conversationId,
            userId: { not: userId }
          }
        });

        if (otherMember?.blockedAt) {
          const errPayload = {
            code: SocketErrorCode.BLOCKED,
            message: 'You are blocked'
          };
          fail(ERROR_CODES.FORBIDDEN, errPayload.message, errPayload, errPayload.code);
          return;
        }

        // Pattern create-then-fallback pour détecter création vs replay
        let message;
        let wasCreated = true;

        if (clientMsgId) {
          // Tenter création avec clientMsgId
          try {
            message = await prisma.message.create({
              data: {
                conversationId,
                senderId: userId,
                type: type as any,
                content: content.trim(),
                clientMsgId
              },
              include: {
                sender: {
                  select: {
                    id: true,
                    role: true,
                    riderProfile: {
                      select: { displayName: true, photoUrl: true }
                    },
                    proProfile: {
                      select: { businessName: true, photoUrl: true }
                    }
                  }
                }
              }
            });
            wasCreated = true;
          } catch (e: any) {
            // Si erreur unique constraint P2002 (on assume que c'est notre contrainte composite)
            if (e?.code === 'P2002') {
              // Récupérer le message existant
              message = await prisma.message.findUnique({
                where: {
                  conversation_client_msg_unique: { conversationId, clientMsgId }
                },
                include: {
                  sender: {
                    select: {
                      id: true,
                      role: true,
                      riderProfile: {
                        select: { displayName: true, photoUrl: true }
                      },
                      proProfile: {
                        select: { businessName: true, photoUrl: true }
                      }
                    }
                  }
                }
              });
              wasCreated = false;
              if (!message) {
                // Cas improbable: constraint hit mais findUnique échoue
                const errPayload = {
                  code: SocketErrorCode.INTERNAL_ERROR,
                  message: 'Message should exist after unique constraint violation'
                };
                fail(ERROR_CODES.INTERNAL_ERROR, errPayload.message, errPayload, errPayload.code);
                return;
              }
            } else {
              // Autre erreur, propager
              throw e;
            }
          }
        } else {
          // Sans clientMsgId: création classique
          message = await prisma.message.create({
            data: {
              conversationId,
              senderId: userId,
              type: type as any,
              content: content.trim()
            },
            include: {
              sender: {
                select: {
                  id: true,
                  role: true,
                  riderProfile: {
                    select: { displayName: true, photoUrl: true }
                  },
                  proProfile: {
                    select: { businessName: true, photoUrl: true }
                  }
                }
              }
            }
          });
          wasCreated = true;
        }

        // Mettre à jour la date de la conversation
        await prisma.conversation.update({
          where: { id: conversationId },
          data: { updatedAt: new Date() }
        });

        // Envoyer le message à tous les membres de la conversation via Socket.io
        // ✅ P1: Validate outbound payload with Zod before emit
        const newMessagePayload = newMessageOutboundSchema.parse({
          id: message.id,
          conversationId: message.conversationId,
          senderId: message.senderId,
          type: message.type,
          content: message.content,
          createdAt: message.createdAt.toISOString(), // Convert Date to ISO string
          sender: message.sender
        });
        io?.to(`conversation:${conversationId}`).emit('new-message', newMessagePayload);

        // Envoyer push notification aux membres offline/autres devices
        const senderName = message.sender.role === 'PRO'
          ? message.sender.proProfile?.businessName || 'Un professionnel'
          : message.sender.riderProfile?.displayName || 'Un rider';

        // Récupérer tous les membres sauf l'expéditeur
        const otherMembers = await prisma.conversationMember.findMany({
          where: {
            conversationId,
            userId: { not: userId }
          },
          select: { userId: true }
        });

        // Envoyer notification push à chaque membre (non-bloquant)
        for (const member of otherMembers) {
          notifyNewMessage(member.userId, {
            senderName,
            message: message.content,
            conversationId
          }).catch((error: unknown) => {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`[WebSocket] Failed to send push notification to ${member.userId}:`, errorMessage);
          });
        }

        console.log(`[WebSocket] Message ${wasCreated ? 'created' : 'replayed (idempotent)'} in conversation ${conversationId} by user ${userId}`);
        ackSuccess(
          ack,
          {
            id: message.id,
            conversationId: message.conversationId,
            content: message.content,
            type: message.type,
            createdAt: message.createdAt.toISOString(),
            created: wasCreated // true si création, false si replay
          },
          ackSuccessSchemaRequired(
            z.object({
              id: z.string(),
              conversationId: z.string(),
              content: z.string(),
              type: z.string(),
              createdAt: z.string(),
              created: z.boolean()
            })
          )
        );
      } catch (error) {
        console.error('[WebSocket] Error sending message:', error);
        const payload = {
          code: SocketErrorCode.INTERNAL_ERROR,
          message: 'Failed to send message'
        };
        fail(ERROR_CODES.INTERNAL_ERROR, payload.message, payload, payload.code);
      }
    });

    // Indicateur de frappe (typing)
    socket.on('typing', async (rawData: unknown) => {
      try {
        // ✅ PR1: Validation Zod (silencieuse, typing non critique)
        const validation = validateSocketPayload(typingSchema, rawData);
        if (!validation.success) {
          // Pas de log ni d'erreur pour typing (non critique)
          return;
        }

        const { conversationId, isTyping } = validation.data;

        // ✅ PR2: Rate limiting (30 events/min par user+conversation)
        const rateLimitKey = `${userId}:${conversationId}`;
        const rateCheck = await checkRateLimit(() => getTypingLimiter(), rateLimitKey, { failOpen: true });
        if (!rateCheck.allowed) {
          // Silencieux (typing non critique, pas d'erreur émise au client)
          return;
        }

        // ✅ P1: Validate outbound payload with Zod before emit
        const userTypingPayload = userTypingOutboundSchema.parse({
          userId,
          isTyping
        });
        socket.to(`conversation:${conversationId}`).emit('user-typing', userTypingPayload);
      } catch (error) {
        // Silencieux (typing non critique)
      }
    });

    // Déconnexion
    socket.on('disconnect', () => {
      // P0 FIX: Cleanup tracking garanti
      untrackConnection(socket.id);
      console.log(`[WebSocket] User ${userId} disconnected (${socket.id})`);
    });

    // Gestion d'erreurs
    socket.on('error', (error) => {
      console.error('[WebSocket] Socket error:', error);
    });
  });

  return io;
}

/**
 * Récupère l'instance Socket.io (pour utilisation dans d'autres modules)
 */
export function getSocketIO(): SocketIOServer | null {
  return io;
}

/**
 * Envoie une notification à un utilisateur spécifique
 */
export function notifyUser(userId: string, event: string, data: any) {
  if (!io) {
    console.warn('[WebSocket] Socket.io not initialized');
    return;
  }

  io.to(`user:${userId}`).emit(event, data);
}

/**
 * Envoie une notification à tous les membres d'une conversation
 */
export function notifyConversation(conversationId: string, event: string, data: any) {
  if (!io) {
    console.warn('[WebSocket] Socket.io not initialized');
    return;
  }

  io.to(`conversation:${conversationId}`).emit(event, data);
}

/**
 * Notifie un utilisateur qu'il a un nouveau match
 */
export function notifyNewMatch(userId: string, matchData: {
  matchId: string;
  conversationId?: string;
  otherUser: {
    id: string;
    displayName: string;
    photoUrl?: string | null;
  };
}) {
  if (!io) {
    console.warn('[WebSocket] Socket.io not initialized');
    return;
  }

  // ✅ P1: Validate outbound payload with Zod before emit
  const newMatchPayload = newMatchOutboundSchema.parse(matchData);
  io.to(`user:${userId}`).emit('new-match', newMatchPayload);
  console.log(`[WebSocket] New match notification sent to user ${userId}`);
}

/**
 * Notifie les utilisateurs qu'une nouvelle carte de matching est disponible
 * Envoie à tous les users qui correspondent aux critères (sport, level, zone)
 */
export function notifyNewMatchingCard(criteria: {
  sport: string;
  level: string;
  location?: { lat: number; lng: number };
  distanceKm?: number;
  profileId: string;
}) {
  if (!io) {
    console.warn('[WebSocket] Socket.io not initialized');
    return;
  }

  // Broadcast à tous les utilisateurs connectés (ils filtreront côté client)
  // ✅ P1: Validate outbound payload with Zod before emit
  const newMatchingCardPayload = newMatchingCardOutboundSchema.parse({
    sport: criteria.sport,
    level: criteria.level,
    profileId: criteria.profileId
  });
  io.emit('new-matching-card', newMatchingCardPayload);

  console.log(`[WebSocket] New matching card broadcasted: ${criteria.profileId}`);
}

/**
 * Notifie qu'une décision de match a été prise (accept/decline)
 */
export function notifyMatchDecision(targetUserId: string, decision: {
  actorUserId: string;
  decision: 'ACCEPT' | 'DECLINE';
  mutualMatch: boolean;
  conversationId?: string;
}) {
  if (!io) {
    console.warn('[WebSocket] Socket.io not initialized');
    return;
  }

  // ✅ P1: Validate outbound payload with Zod before emit
  const matchDecisionPayload = matchDecisionOutboundSchema.parse(decision);
  io.to(`user:${targetUserId}`).emit('match-decision', matchDecisionPayload);
  console.log(`[WebSocket] Match decision sent to user ${targetUserId}: ${decision.decision}`);
}
