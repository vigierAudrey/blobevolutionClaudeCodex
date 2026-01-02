import { Server as HTTPServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { clientPrisma as prisma } from '@blobinfini/database';
import { secureLogger } from '../utils/secure-logger';
import {
  joinConversationSchema,
  leaveConversationSchema,
  sendMessageSchema,
  typingSchema,
  validateSocketPayload,
  SocketErrorCode
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

/**
 * Middleware d'authentification Socket.io
 * Vérifie le JWT avant d'autoriser la connexion
 */
async function authenticateSocket(socket: AuthenticatedSocket, next: (err?: Error) => void) {
  try {
    const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      return next(new Error('Authentication required'));
    }

    // Vérifier le JWT
    const decoded = jwt.verify(token, process.env.JWT_SECRET || '') as { sub: string; role: string };

    // Vérifier que l'utilisateur existe
    const user = await prisma.user.findUnique({
      where: { id: decoded.sub },
      select: { id: true, role: true }
    });

    if (!user) {
      return next(new Error('User not found'));
    }

    // Attacher l'utilisateur au socket
    socket.user = { id: user.id, role: user.role };
    next();
  } catch (error) {
    secureLogger.warn('SOCKET_AUTH_FAILED', { error: error instanceof Error ? error.message : 'Unknown' });
    next(new Error('Invalid token'));
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
    pingInterval: 25000 // Ping toutes les 25 secondes
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

    console.log(`[WebSocket] User ${userId} connected (${socket.id})`);

    // Rejoindre une room personnelle (pour les messages directs)
    socket.join(`user:${userId}`);

    // Rejoindre une conversation
    socket.on('join-conversation', async (rawData: unknown) => {
      try {
        // ✅ PR1: Validation Zod (accepte string OU { conversationId })
        const validation = validateSocketPayload(joinConversationSchema, rawData);
        if (!validation.success) {
          secureLogger.warn('SOCKET_VALIDATION_ERROR', {
            userId,
            event: 'join-conversation',
            error: validation.error
          });
          socket.emit('error', validation.error);
          return;
        }

        const { conversationId } = validation.data;

        // ✅ PR2: Rate limiting (20 joins/min par user)
        const rateCheck = await checkRateLimit(() => getJoinLimiter(), userId);
        if (!rateCheck.allowed) {
          socket.emit('error', rateCheck.error);
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
          socket.emit('error', {
            code: SocketErrorCode.NOT_MEMBER,
            message: 'Not a member of this conversation'
          });
          return;
        }

        socket.join(`conversation:${conversationId}`);
        console.log(`[WebSocket] User ${userId} joined conversation ${conversationId}`);
      } catch (error) {
        console.error('[WebSocket] Error joining conversation:', error);
        socket.emit('error', {
          code: SocketErrorCode.INTERNAL_ERROR,
          message: 'Failed to join conversation'
        });
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
    socket.on('send-message', async (rawData: unknown) => {
      try {
        // ✅ PR1: Validation Zod (UUID, longueur 1-1000, type valide)
        const validation = validateSocketPayload(sendMessageSchema, rawData);
        if (!validation.success) {
          secureLogger.warn('SOCKET_VALIDATION_ERROR', {
            userId,
            event: 'send-message',
            error: validation.error
          });
          socket.emit('error', validation.error);
          return;
        }

        const { conversationId, content, type } = validation.data;

        // ✅ PR2: Rate limiting (10 msg/min par user+conversation)
        const rateLimitKey = `${userId}:${conversationId}`;
        const rateCheck = await checkRateLimit(() => getSendMessageLimiter(), rateLimitKey);
        if (!rateCheck.allowed) {
          socket.emit('error', rateCheck.error);
          return;
        }

        // Vérifier que l'utilisateur est membre
        const member = await prisma.conversationMember.findFirst({
          where: { conversationId, userId }
        });

        if (!member) {
          socket.emit('error', {
            code: SocketErrorCode.NOT_MEMBER,
            message: 'Not a member of this conversation'
          });
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
          socket.emit('error', {
            code: SocketErrorCode.BLOCKED,
            message: 'You are blocked'
          });
          return;
        }

        // Créer le message en base
        const message = await prisma.message.create({
          data: {
            conversationId,
            senderId: userId,
            type: type as any,
            content: content.trim() // ✅ Déjà validé par Zod (max 1000)
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

        // Mettre à jour la date de la conversation
        await prisma.conversation.update({
          where: { id: conversationId },
          data: { updatedAt: new Date() }
        });

        // Envoyer le message à tous les membres de la conversation via Socket.io
        io?.to(`conversation:${conversationId}`).emit('new-message', {
          id: message.id,
          conversationId: message.conversationId,
          senderId: message.senderId,
          type: message.type,
          content: message.content,
          createdAt: message.createdAt,
          sender: message.sender
        });

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
        const { notifyNewMessage } = await import('../modules/push/push.controller');
        for (const member of otherMembers) {
          notifyNewMessage(member.userId, {
            senderName,
            message: message.content,
            conversationId
          }).catch((error) => {
            console.error(`[WebSocket] Failed to send push notification to ${member.userId}:`, error);
          });
        }

        console.log(`[WebSocket] Message sent in conversation ${conversationId} by user ${userId}`);
      } catch (error) {
        console.error('[WebSocket] Error sending message:', error);
        socket.emit('error', {
          code: SocketErrorCode.INTERNAL_ERROR,
          message: 'Failed to send message'
        });
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

        socket.to(`conversation:${conversationId}`).emit('user-typing', {
          userId,
          isTyping
        });
      } catch (error) {
        // Silencieux (typing non critique)
      }
    });

    // Déconnexion
    socket.on('disconnect', () => {
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

  io.to(`user:${userId}`).emit('new-match', matchData);
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
  io.emit('new-matching-card', {
    sport: criteria.sport,
    level: criteria.level,
    profileId: criteria.profileId
  });

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

  io.to(`user:${targetUserId}`).emit('match-decision', decision);
  console.log(`[WebSocket] Match decision sent to user ${targetUserId}: ${decision.decision}`);
}
