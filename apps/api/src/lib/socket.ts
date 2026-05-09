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
  userTypingOutboundSchema
} from './socket-schemas';
import {
  RATE_LIMIT_ENABLED,
  getSendMessageLimiter,
  getSendMessageGlobalLimiter,
  getTypingLimiter,
  getJoinLimiter,
  checkRateLimit,
  isRateLimitRedisReady
} from './socket-rate-limit';
import { getClientIpFromIncomingRequest, getTrustProxyMode } from './client-ip';
import { checkPreAuthIpRateLimit, getPreAuthRateLimitMetrics } from './socket-preauth-rate-limit';
import {
  attachSlowConsumerGuard,
  getSlowConsumerMetrics,
  isSocketCongested,
  registerTypingDrop
} from './socket-slow-consumer-guard';
import { checkBurstLimit, getBurstMetrics } from './socket-burst-limit';
import {
  enqueuePushTask,
  getFanoutMetrics,
  selectPushTargets,
  touchConversationCoalesced
} from './socket-fanout-control';
import { runWithWsLogContext } from '../observability/log-context';

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

const shortId = (value: string | undefined | null): string =>
  typeof value === 'string' && value.length > 8 ? `${value.slice(0, 8)}...` : String(value ?? '');

/**
 * Extrait la valeur d'un cookie depuis un header Cookie brut.
 * Utilisé pour lire le JWT dans le cookie httpOnly lors du handshake WebSocket.
 * Pas de dépendance externe — parsing minimal suffisant.
 */
function extractCookieValue(cookieHeader: string, name: string): string | undefined {
  for (const part of cookieHeader.split(';')) {
    const eqIdx = part.indexOf('=');
    if (eqIdx === -1) continue;
    const key = part.slice(0, eqIdx).trim();
    if (key === name) {
      return decodeURIComponent(part.slice(eqIdx + 1).trim());
    }
  }
  return undefined;
}

const withSocketEventContext = <TArgs extends unknown[]>(
  socket: AuthenticatedSocket,
  routeOrJob: string,
  handler: (...args: TArgs) => void | Promise<void>,
) => (...args: TArgs) =>
  runWithWsLogContext(routeOrJob, socket.user?.id, () => handler(...args));

async function assertConversationMember(userId: string, conversationId: string): Promise<boolean> {
  const member = await prisma.conversationMember.findUnique({
    where: {
      conversationId_userId: {
        conversationId,
        userId
      } as any
    },
    select: { id: true }
  });
  return !!member;
}

// Typing membership cache: short-lived positive cache to reduce DB load on normal typing bursts.
// Security remains server-side enforced; cache is used only with room-membership gate + very short TTL.
const TYPING_MEMBERSHIP_TTL_MS = 3000;
const typingMembershipCache = new Map<string, number>();

function isTypingMembershipCached(userId: string, conversationId: string, nowMs: number): boolean {
  const cacheKey = `${userId}:${conversationId}`;
  const expiresAt = typingMembershipCache.get(cacheKey);
  if (!expiresAt) return false;
  if (expiresAt <= nowMs) {
    typingMembershipCache.delete(cacheKey);
    return false;
  }
  return true;
}

function cacheTypingMembership(userId: string, conversationId: string, nowMs: number): void {
  typingMembershipCache.set(`${userId}:${conversationId}`, nowMs + TYPING_MEMBERSHIP_TTL_MS);
}

function sweepTypingMembershipCache(nowMs: number): void {
  if (typingMembershipCache.size < 256) return;
  for (const [key, expiresAt] of typingMembershipCache.entries()) {
    if (expiresAt <= nowMs) typingMembershipCache.delete(key);
  }
}

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
    // Auth sources (priority order):
    // 1. handshake.auth.token  — Bearer token (tests, clients SDK non-browser)
    // 2. Authorization header  — Bearer header fallback
    // 3. Cookie httpOnly       — sessions navigateur cookie-only (mode normal)
    const cookieHeader = socket.handshake.headers.cookie ?? '';
    const cookieToken = extractCookieValue(cookieHeader, 'accessToken');
    const rawHandshakeToken: unknown = socket.handshake.auth?.token;
    const handshakeToken = typeof rawHandshakeToken === 'string' && rawHandshakeToken.length > 0 ? rawHandshakeToken : undefined;
    const token = handshakeToken ?? socket.handshake.headers.authorization?.replace('Bearer ', '') ?? cookieToken;

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
    const decoded = jwt.verify(token, process.env.JWT_SECRET || '') as { sub: string; role: string; sv?: number };
    const userId = decoded.sub;
    // sv (sessionVersion) est encodé dans le JWT à l'émission (buildAccessToken).
    // S'il est absent (token legacy), on skip la comparaison.
    const tokenSv = typeof decoded.sv === 'number' && decoded.sv >= 1 ? decoded.sv : undefined;
    await runWithWsLogContext('ws:authenticate', userId, async () => {
      // P0 STEP 2: Vérifier rate limit reconnection AVANT toute query DB
      const reconnectBlockReason = await checkReconnectionAllowed(userId);
      if (reconnectBlockReason) {
        // Erreur publique neutre
        next(new Error(reconnectBlockReason));
        return;
      }

      // P0 STEP 1: Vérifier limites connexions simultanées AVANT query DB
      const connectionBlockReason = checkConnectionAllowed(userId, socket);
      if (connectionBlockReason) {
        // Erreur publique neutre
        next(new Error(connectionBlockReason));
        return;
      }

      // P0 STEP 2: Vérifier cache auth (évite query DB si hit)
      const cachedAuth = getCachedAuth(userId);

      let userRole: string;

      if (cachedAuth) {
        // Cache HIT → pas de query DB
        if (!cachedAuth.exists) {
          next(new Error('User not found'));
          return;
        }
        // P1-WS: Vérifier sessionVersion contre la valeur mise en cache depuis la DB.
        // Si le JWT porte un sv inférieur à celui de la DB (logout / changement de mot de passe),
        // la reconnexion est refusée même si le JWT est encore cryptographiquement valide.
        if (tokenSv !== undefined && cachedAuth.sessionVersion !== undefined && tokenSv < cachedAuth.sessionVersion) {
          secureLogger.warn('SOCKET_AUTH_SESSION_REVOKED_CACHE', {
            userId: shortId(userId),
            tokenSv,
            cachedSv: cachedAuth.sessionVersion
          });
          next(new Error('Session revoked'));
          return;
        }
        userRole = cachedAuth.role!;
      } else {
        // Cache MISS → query DB
        const user = await prisma.user.findUnique({
          where: { id: userId },
          select: {
            id: true,
            role: true,
            deletedAt: true, // P0 STEP 2.1: Vérifier soft delete
            sessionVersion: true // P1-WS: Vérifier révocation de session
          }
        });

        // P0 STEP 2.1: User soft-deleted = inexistant
        if (!user || user.deletedAt) {
          // Mettre en cache l'absence (évite query DB répétées)
          setCachedAuth(userId, false);

          if (user?.deletedAt) {
            secureLogger.info('SOCKET_AUTH_DELETED_USER_BLOCKED', {
              userId: shortId(userId),
              deletedAt: user.deletedAt.toISOString()
            });
          }

          next(new Error('User not found'));
          return;
        }

        // P1-WS: Si le JWT porte un sv < sessionVersion en DB, la session est révoquée.
        if (tokenSv !== undefined && tokenSv < user.sessionVersion) {
          secureLogger.warn('SOCKET_AUTH_SESSION_REVOKED_DB', {
            userId: shortId(userId),
            tokenSv,
            dbSv: user.sessionVersion
          });
          // Mettre en cache le refus pour bloquer les reconnexions rapides.
          setCachedAuth(userId, false);
          next(new Error('Session revoked'));
          return;
        }

        userRole = user.role;

        // P0 STEP 2: Mettre en cache le user avec sessionVersion pour comparaison future.
        setCachedAuth(userId, true, userRole, user.sessionVersion);
      }

      // Attacher l'utilisateur au socket
      socket.user = { id: userId, role: userRole };
      next();
    });
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
  const originsSet = new Set(origins);
  const isProduction = process.env.NODE_ENV === 'production';
  const replicas = Number(process.env.REPLICAS || '1');
  const hasRedisAdapter = String(process.env.WS_ADAPTER_REDIS || '').toLowerCase() === 'true';
  const trustProxyMode = getTrustProxyMode();

  const preAuthCfg = getPreAuthRateLimitMetrics();
  const slowConsumerCfg = getSlowConsumerMetrics();
  const burstCfg = getBurstMetrics();
  const fanoutCfg = getFanoutMetrics();

  secureLogger.info('CONFIG_WS', {
    env: process.env.NODE_ENV || 'development',
    trustProxyMode,
    trustedProxyIpsConfigured: Boolean(process.env.TRUSTED_PROXY_IPS?.trim()),
    enableWebsocketRateLimitEnv: process.env.ENABLE_WEBSOCKET_RATE_LIMIT ?? '(unset)',
    rateLimitEnabled: RATE_LIMIT_ENABLED,
    replicas,
    wsAdapterRedis: hasRedisAdapter,
    maxHttpBufferSize: 1e6,
    preAuthRateLimit: {
      enabled: preAuthCfg.enabled,
      points: preAuthCfg.points,
      windowMs: preAuthCfg.windowMs,
      baseBanMs: preAuthCfg.baseBanMs,
      maxBanMs: preAuthCfg.maxBanMs
    },
    slowConsumerGuard: {
      enabled: slowConsumerCfg.enabled,
      checkIntervalMs: slowConsumerCfg.checkIntervalMs,
      maxStreak: slowConsumerCfg.maxStreak,
      maxBufferedPackets: slowConsumerCfg.maxBufferedPackets
    },
    burstControl: {
      pointsPerSec: burstCfg.pointsPerSec,
      capacity: burstCfg.capacity,
      strictPointsPerSec: burstCfg.strictPointsPerSec,
      strictCapacity: burstCfg.strictCapacity,
      blockMs: burstCfg.blockMs
    },
    fanoutBudget: {
      pushPerMessageMax: fanoutCfg.pushPerMessageMax,
      queueMaxPending: fanoutCfg.queueMaxPending,
      queueConcurrency: fanoutCfg.queueConcurrency,
      conversationTouchMinIntervalMs: fanoutCfg.conversationTouchMinIntervalMs
    }
  });

  if (Number.isFinite(replicas) && replicas > 1 && !hasRedisAdapter) {
    secureLogger.warn('WS_MULTI_INSTANCE_WITHOUT_REDIS_ADAPTER', {
      replicas,
      wsAdapterRedis: false,
      note: 'Sticky sessions are required until a shared Socket.IO adapter is enabled.',
      risk: 'Room revocation is best-effort per node; cross-node post-revocation receive is possible.'
    });
  }

  io = new SocketIOServer(httpServer, {
    cors: {
      origin: origins,
      // Cookie-based session auth: le navigateur doit envoyer le cookie httpOnly accessToken
      // sur le handshake WebSocket upgrade. credentials:true est requis à cet effet.
      // Protection CSRF assurée par la validation d'Origin dans allowRequest().
      credentials: true
    },
    allowRequest: (req, callback) => {
      return runWithWsLogContext('ws:allow-request', undefined, () => {
        const clientIp = getClientIpFromIncomingRequest(req as any);
        const preAuthRateLimit = checkPreAuthIpRateLimit(clientIp);
        if (!preAuthRateLimit.allowed) {
          secureLogger.warn('WS_PREAUTH_HANDSHAKE_REJECTED', {
            retryAfterMs: preAuthRateLimit.retryAfterMs,
            reason: preAuthRateLimit.reason
          });
          callback('Connection temporarily unavailable', false);
          return;
        }

        const origin = req.headers.origin;

        if (!origin) {
          if (isProduction) {
            callback('Origin required', false);
            return;
          }
          callback(null, true);
          return;
        }

        if (!originsSet.has(origin)) {
          secureLogger.warn('WS_ORIGIN_BLOCKED', { origin });
          callback('Origin not allowed', false);
          return;
        }

        callback(null, true);
      });
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
    attachSlowConsumerGuard(socket);
    runWithWsLogContext('ws:connection', userId, () => {
      secureLogger.info('WS_CONNECTED', {
        userId: shortId(userId),
        socketId: shortId(socket.id)
      });
    });

    // Rejoindre une room personnelle (pour les messages directs)
    socket.join(`user:${userId}`);

    // Rejoindre une conversation
    socket.on('join-conversation', withSocketEventContext(socket, 'ws:join-conversation', async (rawData: unknown, ackCb?: unknown) => {
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
            userId: shortId(userId),
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
        const member = await assertConversationMember(userId, conversationId);

        if (!member) {
          const errPayload = {
            code: SocketErrorCode.NOT_MEMBER,
            message: 'Not a member of this conversation'
          };
          fail(ERROR_CODES.FORBIDDEN, errPayload.message, errPayload, errPayload.code);
          return;
        }

        socket.join(`conversation:${conversationId}`);
        secureLogger.info('WS_JOIN_CONVERSATION', {
          userId: shortId(userId),
          conversationId: shortId(conversationId)
        });
        ackSuccess(
          ack,
          { conversationId },
          ackSuccessSchemaRequired(z.object({ conversationId: z.string() }))
        );
      } catch (error) {
        secureLogger.error('WS_JOIN_CONVERSATION_FAILED', {
          userId: shortId(userId),
          error: error instanceof Error ? error.message : String(error)
        });
        const payload = {
          code: SocketErrorCode.INTERNAL_ERROR,
          message: 'Failed to join conversation'
        };
        fail(ERROR_CODES.INTERNAL_ERROR, payload.message, payload, payload.code);
      }
    }));

    // Quitter une conversation
    socket.on('leave-conversation', withSocketEventContext(socket, 'ws:leave-conversation', (rawData: unknown) => {
      // ✅ PR1: Validation permissive (string non vide, pas UUID strict)
      const validation = validateSocketPayload(leaveConversationSchema, rawData);
      if (!validation.success) {
        // Silencieux (leave non critique, pas de log ni d'erreur émise)
        return;
      }

      const { conversationId } = validation.data;
      socket.leave(`conversation:${conversationId}`);
      secureLogger.debug('WS_LEAVE_CONVERSATION', {
        userId: shortId(userId),
        conversationId: shortId(conversationId)
      });
    }));

    // Envoyer un message
    socket.on('send-message', withSocketEventContext(socket, 'ws:send-message', async (rawData: unknown, ackCb?: unknown) => {
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
            userId: shortId(userId),
            event: 'send-message',
            error: validation.error
          });
          fail(ERROR_CODES.VALIDATION_ERROR, 'Invalid input', validation.error, validation.error.code);
          return;
        }

        const { conversationId, content, type, clientMsgId } = validation.data;

        const strictBurstMode = !isRateLimitRedisReady();
        const userBurst = checkBurstLimit(`send-message:${userId}`, { strict: strictBurstMode });
        if (!userBurst.allowed) {
          fail(
            ERROR_CODES.RATE_LIMITED,
            'Too many requests. Retry shortly.',
            { retryAfterMs: userBurst.retryAfterMs, limit: 'burst-user' },
            SocketErrorCode.RATE_LIMITED
          );
          return;
        }

        const conversationBurst = checkBurstLimit(`send-message:${userId}:${conversationId}`, { strict: strictBurstMode });
        if (!conversationBurst.allowed) {
          fail(
            ERROR_CODES.RATE_LIMITED,
            'Too many requests. Retry shortly.',
            { retryAfterMs: conversationBurst.retryAfterMs, limit: 'burst-conversation' },
            SocketErrorCode.RATE_LIMITED
          );
          return;
        }

        // Coarse per-user limiter to block random-conversation flood before DB lookups.
        const globalRateCheck = await checkRateLimit(() => getSendMessageGlobalLimiter(), userId);
        if (!globalRateCheck.allowed) {
          const code = mapSocketErrorCode(globalRateCheck.error.code);
          fail(code, globalRateCheck.error.message, { retryAfter: globalRateCheck.error.retryAfter }, globalRateCheck.error.code);
          return;
        }

        // ✅ PR2: Rate limiting (10 msg/min par user+conversation)
        const rateLimitKey = `${userId}:${conversationId}`;
        const rateCheck = await checkRateLimit(() => getSendMessageLimiter(), rateLimitKey);
        if (!rateCheck.allowed) {
          const code = mapSocketErrorCode(rateCheck.error.code);
          fail(code, rateCheck.error.message, { retryAfter: rateCheck.error.retryAfter }, rateCheck.error.code);
          return;
        }

        // Vérifier que l'utilisateur est membre
        const member = await assertConversationMember(userId, conversationId);

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

        // Mettre à jour la date de la conversation (coalescé en cas de flood)
        await touchConversationCoalesced(conversationId, async () => {
          await prisma.conversation.update({
            where: { id: conversationId },
            data: { updatedAt: new Date() }
          });
        });

        // Envoyer le message à tous les membres de la conversation via Socket.io
        // ✅ P1: Validate outbound payload with Zod before emit
        const normalizedSender = {
          id: message.sender.id,
          role: message.sender.role,
          riderProfile: message.sender.riderProfile
            ? {
                displayName: message.sender.riderProfile.displayName || 'Rider',
                photoUrl: message.sender.riderProfile.photoUrl ?? null
              }
            : undefined,
          proProfile: message.sender.proProfile
            ? {
                businessName: message.sender.proProfile.businessName || 'Professionnel',
                photoUrl: message.sender.proProfile.photoUrl ?? null
              }
            : undefined
        };

        const newMessagePayload = newMessageOutboundSchema.parse({
          id: message.id,
          conversationId: message.conversationId,
          senderId: message.senderId,
          type: message.type,
          content: message.content,
          createdAt: message.createdAt.toISOString(), // Convert Date to ISO string
          sender: normalizedSender
        });
        io?.to(`conversation:${conversationId}`).emit('new-message', newMessagePayload);

        // Envoyer push notification aux membres offline/autres devices
        const senderName = message.sender.role === 'PRO'
          ? message.sender.proProfile?.businessName || 'Un professionnel'
          : message.sender.riderProfile?.displayName || 'Un rider';

        // Récupérer tous les membres sauf l'expéditeur
        const otherMembers: Array<{ userId: string }> = await prisma.conversationMember.findMany({
          where: {
            conversationId,
            userId: { not: userId }
          },
          select: { userId: true }
        });

        const { targets: pushTargets, droppedByBudget } = selectPushTargets(otherMembers.map((m: { userId: string }) => m.userId));
        if (droppedByBudget > 0) {
          secureLogger.warn('WS_PUSH_FANOUT_BUDGET_DROPPED', {
            conversationId: shortId(conversationId),
            droppedByBudget
          });
        }

        // Envoyer notification push via queue bornée (non-bloquant)
        for (const targetUserId of pushTargets) {
          const enqueued = enqueuePushTask(async () => {
            await notifyNewMessage(targetUserId, {
              senderName,
              message: message.content,
              conversationId
            });
          });

          if (!enqueued) {
            secureLogger.warn('WS_PUSH_QUEUE_DROPPED', {
              conversationId: shortId(conversationId),
              targetUserId: shortId(targetUserId)
            });
          }
        }

        secureLogger.info('WS_SEND_MESSAGE_OK', {
          userId: shortId(userId),
          conversationId: shortId(conversationId),
          created: wasCreated
        });
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
        secureLogger.error('WS_SEND_MESSAGE_FAILED', {
          userId: shortId(userId),
          error: error instanceof Error ? error.message : String(error)
        });
        const payload = {
          code: SocketErrorCode.INTERNAL_ERROR,
          message: 'Failed to send message'
        };
        fail(ERROR_CODES.INTERNAL_ERROR, payload.message, payload, payload.code);
      }
    }));

    // Indicateur de frappe (typing)
    socket.on('typing', withSocketEventContext(socket, 'ws:typing', async (rawData: unknown) => {
      try {
        // ✅ PR1: Validation Zod (silencieuse, typing non critique)
        const validation = validateSocketPayload(typingSchema, rawData);
        if (!validation.success) {
          // Pas de log ni d'erreur pour typing (non critique)
          return;
        }

        const { conversationId, isTyping } = validation.data;
        const roomName = `conversation:${conversationId}`;

        // A socket must currently be in the room to emit typing for that room.
        // Prevents abuse from arbitrary room IDs and helps immediate local revocation.
        if (!socket.rooms.has(roomName)) {
          return;
        }

        const nowMs = Date.now();
        let isMember = isTypingMembershipCached(userId, conversationId, nowMs);
        if (!isMember) {
          isMember = await assertConversationMember(userId, conversationId);
          if (isMember) {
            cacheTypingMembership(userId, conversationId, nowMs);
            sweepTypingMembershipCache(nowMs);
          }
        }
        if (!isMember) {
          return;
        }

        // ✅ PR2: Rate limiting (30 events/min par user+conversation)
        const rateLimitKey = `${userId}:${conversationId}`;
        const rateCheck = await checkRateLimit(() => getTypingLimiter(), rateLimitKey, {
          failOpen: false,
          hardFailOnError: true
        });
        if (!rateCheck.allowed) {
          // Silencieux (typing non critique, pas d'erreur émise au client)
          return;
        }

        if (isSocketCongested(socket)) {
          registerTypingDrop();
          return;
        }

        // ✅ P1: Validate outbound payload with Zod before emit
        const userTypingPayload = userTypingOutboundSchema.parse({
          userId,
          isTyping
        });
        socket.to(roomName).volatile.emit('user-typing', userTypingPayload);
      } catch (error) {
        // Silencieux (typing non critique)
      }
    }));

    // Déconnexion
    socket.on('disconnect', withSocketEventContext(socket, 'ws:disconnect', () => {
      // P0 FIX: Cleanup tracking garanti
      untrackConnection(socket.id);
      secureLogger.info('WS_DISCONNECTED', {
        userId: shortId(userId),
        socketId: shortId(socket.id)
      });
    }));

    // Gestion d'erreurs
    socket.on('error', withSocketEventContext(socket, 'ws:error', (error) => {
      secureLogger.error('WS_SOCKET_ERROR', {
        userId: shortId(userId),
        error: error instanceof Error ? error.message : String(error)
      });
    }));
  });

  return io;
}

export function getSocketHardeningMetrics() {
  return {
    preAuthRateLimit: getPreAuthRateLimitMetrics(),
    slowConsumer: getSlowConsumerMetrics(),
    burst: getBurstMetrics(),
    fanout: getFanoutMetrics()
  };
}

/**
 * Envoie une notification à un utilisateur spécifique
 */
export function notifyUser(userId: string, event: string, data: any) {
  runWithWsLogContext('ws:notify-user', userId, () => {
    if (!io) {
      secureLogger.warn('WS_NOT_INITIALIZED_NOTIFY_USER', { event });
      return;
    }

    io.to(`user:${userId}`).emit(event, data);
  });
}


/**
 * Déconnecte de force toutes les connexions WebSocket d'un utilisateur.
 * Utilisé par les actions admin (révocation de session, suspension).
 * No-op si io non initialisé ou si l'utilisateur n'a aucun socket actif.
 */
export function disconnectUserSockets(userId: string, reason?: string): void {
  runWithWsLogContext('ws:disconnect-user-sockets', userId, () => {
    if (!io) {
      secureLogger.warn('WS_NOT_INITIALIZED_DISCONNECT_USER_SOCKETS', {
        userId: shortId(userId),
      });
      return;
    }

    // Tous les sockets de l'utilisateur sont dans la room personnelle `user:{userId}`.
    // disconnectSockets(true) envoie un close immédiat (close=true = pas de polling fallback).
    io.in(`user:${userId}`).disconnectSockets(true);

    secureLogger.info('WS_USER_SOCKETS_DISCONNECTED', {
      userId: shortId(userId),
      reason: reason ?? 'admin-forced-disconnect',
    });
  });
}
