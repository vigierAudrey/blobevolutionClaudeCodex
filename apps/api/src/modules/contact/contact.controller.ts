import { Router, type Request } from 'express';
import { z } from 'zod';
import { requireAuth, requireVerifiedEmail } from '../auth/auth.guard';
import { clientPrisma as prisma, Prisma } from '@blobinfini/database';
import { makeLessonRequestId } from '../../services/lesson-fanout.repository';
import { createLazyCustomRateLimiter } from '../../middleware/enhanced-rate-limit';
import { secureLogger } from '../../utils/secure-logger';

export const contactRouter = Router();
contactRouter.use(requireAuth, requireVerifiedEmail);

// 5 demandes de contact / 10 min / userId — intentionnel : un pro ne spamme pas.
const contactRequestLimiter = createLazyCustomRateLimiter(
  {
    windowMs: 10 * 60 * 1000,
    limit: 5,
    keyGenerator: (req: Request) => `contact_request:${(req as any).user?.id ?? 'anon'}`,
    message: {
      error: 'CONTACT_REQUEST_RATE_LIMIT_EXCEEDED',
      message: 'Too many contact requests. Please wait before sending another.',
    },
  },
  'contact_request',
);

// 60 lectures / min / userId — listing pro, lecture seule.
const contactRequestsListLimiter = createLazyCustomRateLimiter(
  {
    windowMs: 60 * 1000,
    limit: 60,
    keyGenerator: (req: Request) => `contact_requests_list:${(req as any).user?.id ?? 'anon'}`,
    message: {
      error: 'CONTACT_REQUESTS_RATE_LIMIT_EXCEEDED',
      message: 'Too many requests. Please wait.',
    },
  },
  'contact_requests_list',
);

// 20 réponses / 10 min / userId — protège contre le bourrage de votes.
const contactRespondLimiter = createLazyCustomRateLimiter(
  {
    windowMs: 10 * 60 * 1000,
    limit: 20,
    keyGenerator: (req: Request) => `contact_respond:${(req as any).user?.id ?? 'anon'}`,
    message: {
      error: 'CONTACT_RESPOND_RATE_LIMIT_EXCEEDED',
      message: 'Too many responses. Please wait before responding again.',
    },
  },
  'contact_respond',
);

// Schema pour créer une demande de contact.
// lessonRequestId est exclu volontairement : calculé server-side uniquement.
const createContactRequestSchema = z.object({
  conversationId: z.string().uuid(),
  message: z.string().max(500).optional(),
}).strict();

// Schema pour répondre à une demande de contact
const respondToContactRequestSchema = z.object({
  contactRequestId: z.string().uuid(),
  response: z.enum(['ACCEPT', 'REJECT']),
});

// POST /contact/request - Le Pro envoie une demande de contact
contactRouter.post('/request', contactRequestLimiter, async (req, res) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    // Vérifier que l'utilisateur est un PRO
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true }
    });

    if (!user || user.role !== 'PRO') {
      return res.status(403).json({ error: 'Only professionals can send contact requests' });
    }

    const { conversationId, message } = createContactRequestSchema.parse(req.body);

    // Vérifier que la conversation existe et contient des riders avec demande de cours.
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        match: {
          include: {
            userOne: { include: { riderProfile: true } },
            userTwo: { include: { riderProfile: true } }
          }
        }
      }
    });

    if (!conversation || !conversation.match) {
      return res.status(404).json({ error: 'Conversation or match not found' });
    }

    // IDOR guard : seuls les participants du match (userOneId / userTwoId) peuvent
    // initier un ContactRequest pour cette conversation.
    // Réponse 404 neutre — même message que "conversation not found" pour éviter
    // toute discrimination observable qui permettrait d'énumérer les conversations.
    const { userOneId, userTwoId } = conversation.match;
    if (userId !== userOneId && userId !== userTwoId) {
      return res.status(404).json({ error: 'Conversation or match not found' });
    }

    // Identifier le premier participant avec wantsLesson=true.
    // Le pro (qui n'a pas de riderProfile) ne peut jamais être lessonRider.
    // Guard supplémentaire : lessonRider.id !== userId — défense en profondeur
    // contre un utilisateur ayant à la fois un proProfile et wantsLesson=true.
    const riders = [conversation.match.userOne, conversation.match.userTwo];
    const lessonRider = riders.find(
      rider => rider.riderProfile?.wantsLesson === true && rider.id !== userId
    );

    if (!lessonRider) {
      return res.status(400).json({ error: 'No lesson request found in this conversation' });
    }

    // Garde anti-doublon : un seul ContactRequest par (pro, conversation), quel que soit
    // le statut précédent. La contrainte DB unique couvre aussi le TOCTOU concurrent.
    const existingRequest = await prisma.contactRequest.findFirst({
      where: {
        proUserId: userId,
        conversationId: conversationId,
      },
      select: { id: true },
    });

    if (existingRequest) {
      return res.status(409).json({ error: 'Contact request already exists for this conversation' });
    }

    // lessonRequestId calculé server-side : sha256(riderId + UTC-date)[:16].
    // Stable sur la journée — permet COUNT(DISTINCT lessonRequestId) ↔ LessonFanout.
    const lessonRequestId = makeLessonRequestId(lessonRider.id);

    // Créer la demande de contact — select minimal : seuls les champs du DTO public.
    // Pas de conversation, pas d'objet user complet, pas de riderProfile.
    type ContactRequestCreated = Prisma.ContactRequestGetPayload<{
      select: {
        id: true;
        message: true;
        createdAt: true;
        pro: { select: { proProfile: { select: { businessName: true } } } };
      };
    }>;

    let contactRequest!: ContactRequestCreated;
    try {
      contactRequest = await prisma.contactRequest.create({
        data: {
          proUserId: userId,
          conversationId,
          message: message || null,
          status: 'PENDING',
          lessonRequestId,
        },
        select: {
          id: true,
          message: true,
          createdAt: true,
          pro: {
            select: {
              proProfile: { select: { businessName: true } },
            },
          },
        },
      });
    } catch (createErr: unknown) {
      // Race condition : une requête concurrente a créé le ContactRequest avant nous.
      if ((createErr as any)?.code === 'P2002') {
        return res.status(409).json({ error: 'Contact request already exists for this conversation' });
      }
      throw createErr;
    }

    secureLogger.info('CONTACT_REQUEST_CREATED', {
      conversationId,
      lessonRequestId,
    });

    return res.json({
      success: true,
      contactRequest: {
        id: contactRequest.id,
        message: contactRequest.message,
        proName: contactRequest.pro?.proProfile?.businessName || 'Professionnel',
        createdAt: contactRequest.createdAt,
      },
    });

  } catch (err: any) {
    if (err?.name === 'ZodError') {
      return res.status(400).json({ error: 'Invalid input', details: err.errors });
    }
    return res.status(500).json({ error: 'Internal error' });
  }
});

// POST /contact/respond - Les riders répondent à la demande
//
// Machine d'état stricte :
//   PENDING → ACCEPTED  (tous les riders ont ACCEPT)
//   PENDING → REJECTED  (au moins un rider a REJECT)
//   Toute autre transition → 409 Conflict
//
// Garanties de concurrence :
//   - Tout est dans une transaction Serializable
//   - contactRequestResponse.create (pas upsert) → vote immuable, P2002 → 409
//   - updateMany WHERE status=PENDING → transition atomique
//   - conversationMember.createMany skipDuplicates → idempotent
contactRouter.post('/respond', contactRespondLimiter, async (req, res) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { contactRequestId, response } = respondToContactRequestSchema.parse(req.body);

    type RespondStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED';
    let finalStatus: RespondStatus = 'PENDING';

    try {
      finalStatus = await prisma.$transaction(
        async (tx: Prisma.TransactionClient): Promise<RespondStatus> => {
          // 1. Charger la demande et ses membres dans la transaction
          const contactRequest = await tx.contactRequest.findUnique({
            where: { id: contactRequestId },
            include: { conversation: { include: { members: true } } },
          });

          if (!contactRequest) {
            throw Object.assign(new Error('NOT_FOUND'), { _code: 'NOT_FOUND' });
          }

          const members = contactRequest.conversation.members as Array<{ userId: string }>;

          // 3. Autorisation : doit être membre de la conversation
          if (!members.some(m => m.userId === userId)) {
            throw Object.assign(new Error('FORBIDDEN'), { _code: 'FORBIDDEN' });
          }

          // 4. Le pro ne peut pas répondre à sa propre demande
          if (userId === contactRequest.proUserId) {
            throw Object.assign(new Error('FORBIDDEN'), { _code: 'FORBIDDEN' });
          }

          // 5. Vérifier si le rider a déjà voté — avant le check de statut pour donner
          //    une erreur sémantiquement correcte ("tu as déjà répondu" > "c'est résolu")
          const existingVote = await tx.contactRequestResponse.findUnique({
            where: { contactRequestId_riderUserId: { contactRequestId, riderUserId: userId } },
            select: { id: true },
          });
          if (existingVote) {
            throw Object.assign(new Error('ALREADY_RESPONDED'), { _code: 'ALREADY_RESPONDED' });
          }

          // 6. Machine d'état : seul PENDING peut transitionner (après le check de vote)
          if (contactRequest.status !== 'PENDING') {
            throw Object.assign(new Error('ALREADY_RESOLVED'), {
              _code: 'ALREADY_RESOLVED',
              currentStatus: contactRequest.status,
            });
          }

          // 7. Enregistrer le vote (CREATE — P2002 = filet de sécurité concurrence)
          try {
            await tx.contactRequestResponse.create({
              data: { contactRequestId, riderUserId: userId, response },
            });
          } catch (createErr: unknown) {
            if ((createErr as any)?.code === 'P2002') {
              throw Object.assign(new Error('ALREADY_RESPONDED'), { _code: 'ALREADY_RESPONDED' });
            }
            throw createErr;
          }

          // 8. Recalculer le statut final avec toutes les réponses actuelles
          const riderIds = members
            .filter(m => m.userId !== contactRequest.proUserId)
            .map(m => m.userId);

          const allResponses: Array<{ riderUserId: string; response: string }> =
            await tx.contactRequestResponse.findMany({
              where: { contactRequestId },
              select: { riderUserId: true, response: true },
            });

          const allRidersResponded = riderIds.every(riderId =>
            allResponses.some(r => r.riderUserId === riderId)
          );

          if (!allRidersResponded) return 'PENDING'; // En attente d'autres riders

          const next: RespondStatus = allResponses.some(r => r.response === 'REJECT')
            ? 'REJECTED'
            : 'ACCEPTED';

          // 7. Transition atomique : updateMany WHERE status=PENDING évite le double-fire concurrent
          const updated = await tx.contactRequest.updateMany({
            where: { id: contactRequestId, status: 'PENDING' },
            data: { status: next },
          });

          if (updated.count === 0) {
            // Une requête concurrente a déjà finalisé — lire l'état réel
            const current = await tx.contactRequest.findUnique({
              where: { id: contactRequestId },
              select: { status: true },
            });
            return ((current?.status as RespondStatus | undefined) ?? 'PENDING');
          }

          if (next === 'ACCEPTED') {
            // 8. Ajouter le pro à la conversation (skipDuplicates = garde concurrence)
            await tx.conversationMember.createMany({
              data: [{ conversationId: contactRequest.conversationId, userId: contactRequest.proUserId }],
              skipDuplicates: true,
            });
          }

          return next;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

    } catch (txErr: unknown) {
      const code = (txErr as any)?._code;
      if (code === 'NOT_FOUND') {
        return res.status(404).json({ error: 'Contact request not found' });
      }
      if (code === 'ALREADY_RESOLVED') {
        return res.status(409).json({
          error: 'CONTACT_REQUEST_ALREADY_RESOLVED',
          status: (txErr as any).currentStatus,
        });
      }
      if (code === 'FORBIDDEN') {
        return res.status(403).json({ error: 'Forbidden' });
      }
      if (code === 'ALREADY_RESPONDED') {
        return res.status(409).json({
          error: 'ALREADY_RESPONDED',
          message: 'You have already responded to this contact request',
        });
      }
      // P2034 = échec de sérialisation PostgreSQL — transitoire
      if ((txErr as any)?.code === 'P2034') {
        return res.status(409).json({ error: 'CONCURRENT_UPDATE', message: 'Please retry' });
      }
      throw txErr;
    }

    secureLogger.info('CONTACT_RESPOND', { contactRequestId, response, finalStatus });

    return res.json({
      success: true,
      status: finalStatus,
      message:
        finalStatus === 'ACCEPTED'
          ? 'Le professionnel a été ajouté à votre conversation'
          : finalStatus === 'REJECTED'
          ? 'Demande refusée'
          : 'Réponse enregistrée, en attente des autres participants',
    });

  } catch (err: unknown) {
    if ((err as any)?.name === 'ZodError') {
      return res.status(400).json({ error: 'Invalid input', details: (err as any).errors });
    }
    secureLogger.error('CONTACT_RESPOND_ERROR', { error: (err as any)?.message });
    return res.status(500).json({ error: 'Internal error' });
  }
});

// DTO minimal pro pour GET /contact/requests.
// Seuls les champs nécessaires à l'UI pro sont exposés.
// Aucun email, aucun objet user/riderProfile complet, aucune lat/lng.
const REQUESTS_MAX = 50;

// GET /contact/requests - Obtenir les demandes de contact envoyées par un Pro
contactRouter.get('/requests', contactRequestsListLimiter, async (req, res) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });

    if (!user || user.role !== 'PRO') {
      return res.status(403).json({ error: 'Only professionals can view contact requests' });
    }

    const rows = await prisma.contactRequest.findMany({
      where: { proUserId: userId },
      select: {
        id: true,
        status: true,
        message: true,
        createdAt: true,
        conversationId: true,
        conversation: {
          select: {
            members: {
              where: { userId: { not: userId } },
              take: 1,
              select: {
                user: {
                  select: {
                    riderProfile: { select: { displayName: true } },
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: REQUESTS_MAX,
    });

    const requests = rows.map((r: (typeof rows)[number]) => ({
      id: r.id,
      status: r.status,
      message: r.message,
      createdAt: r.createdAt,
      conversationId: r.conversationId,
      riderName: r.conversation.members[0]?.user.riderProfile?.displayName ?? 'Rider',
    }));

    return res.json({ requests });

  } catch (err) {
    secureLogger.error('CONTACT_REQUESTS_LIST_ERROR', { error: (err as any)?.message });
    return res.status(500).json({ error: 'Internal error' });
  }
});

// DTO minimal pour GET /contact/pending
// Seuls les champs nécessaires à l'UI rider sont exposés.
// Aucun email, userId du rider, profil complet, ni objet conversation.
const PENDING_MAX = 50;

// GET /contact/pending - Obtenir les demandes en attente pour un rider
contactRouter.get('/pending', async (req, res) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const rows = await prisma.contactRequest.findMany({
      where: {
        status: 'PENDING',
        conversation: {
          members: { some: { userId } },
        },
        // Exclure les demandes où ce rider a déjà répondu
        NOT: {
          responses: { some: { riderUserId: userId } },
        },
      },
      select: {
        id: true,
        message: true,
        createdAt: true,
        conversationId: true,
        pro: {
          select: {
            proProfile: { select: { businessName: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: PENDING_MAX,
    });

    const requests = rows.map((r: (typeof rows)[number]) => ({
      id: r.id,
      message: r.message,
      createdAt: r.createdAt,
      conversationId: r.conversationId,
      proName: r.pro.proProfile?.businessName ?? 'Professionnel',
    }));

    return res.json({ requests });

  } catch (err) {
    return res.status(500).json({ error: 'Internal error' });
  }
});
