import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireVerifiedEmail } from '../auth/auth.guard';
import { clientPrisma as prisma, Prisma } from '@blobinfini/database';

export const contactRouter = Router();
contactRouter.use(requireAuth, requireVerifiedEmail);

// Schema pour créer une demande de contact
const createContactRequestSchema = z.object({
  conversationId: z.string().uuid(),
  message: z.string().max(500).optional(),
});

// Schema pour répondre à une demande de contact
const respondToContactRequestSchema = z.object({
  contactRequestId: z.string().uuid(),
  response: z.enum(['ACCEPT', 'REJECT']),
});

// POST /contact/request - Le Pro envoie une demande de contact
contactRouter.post('/request', async (req, res) => {
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

    // Vérifier que la conversation existe et contient des riders avec demande de cours
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        match: {
          include: {
            userOne: { include: { riderProfile: true } },
            userTwo: { include: { riderProfile: true } }
          }
        },
        members: {
          include: { user: { include: { riderProfile: true } } }
        }
      }
    });

    if (!conversation || !conversation.match) {
      return res.status(404).json({ error: 'Conversation or match not found' });
    }

    // Vérifier qu'au moins un des riders veut un cours
    const riders = [conversation.match.userOne, conversation.match.userTwo];
    const hasLessonRequest = riders.some(rider =>
      rider.riderProfile?.wantsLesson === true
    );

    if (!hasLessonRequest) {
      return res.status(400).json({ error: 'No lesson request found in this conversation' });
    }

    // Vérifier qu'il n'y a pas déjà une demande en cours
    const existingRequest = await prisma.contactRequest.findFirst({
      where: {
        proUserId: userId,
        conversationId: conversationId,
        status: 'PENDING'
      }
    });

    if (existingRequest) {
      return res.status(400).json({ error: 'Contact request already pending for this conversation' });
    }

    // Créer la demande de contact
    const contactRequest = await prisma.contactRequest.create({
      data: {
        proUserId: userId,
        conversationId,
        message: message || null,
        status: 'PENDING'
      },
      include: {
        pro: {
          include: { proProfile: true }
        },
        conversation: {
          include: {
            members: {
              include: { user: { include: { riderProfile: true } } }
            }
          }
        }
      }
    });

    return res.json({
      success: true,
      contactRequest: {
        id: contactRequest.id,
        message: contactRequest.message,
        proName: contactRequest.pro.proProfile?.businessName || 'Professionnel',
        createdAt: contactRequest.createdAt
      }
    });

  } catch (err: any) {
    if (err?.name === 'ZodError') {
      return res.status(400).json({ error: 'Invalid input', details: err.errors });
    }
    return res.status(500).json({ error: 'Internal error' });
  }
});

// POST /contact/respond - Les riders répondent à la demande
contactRouter.post('/respond', async (req, res) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { contactRequestId, response } = respondToContactRequestSchema.parse(req.body);

    // Vérifier que la demande existe et que l'utilisateur fait partie de la conversation
    const contactRequest = await prisma.contactRequest.findUnique({
      where: { id: contactRequestId },
      include: {
        conversation: {
          include: {
            members: true,
            match: true
          }
        },
        pro: {
          include: { proProfile: true }
        }
      }
    });

    if (!contactRequest) {
      return res.status(404).json({ error: 'Contact request not found' });
    }

    if (contactRequest.status !== 'PENDING') {
      return res.status(400).json({ error: 'Contact request is no longer pending' });
    }

    // Vérifier que l'utilisateur fait partie de la conversation
    const isMember = contactRequest.conversation.members.some(
      (member) => member.userId === userId
    );
    if (!isMember) {
      return res.status(403).json({ error: 'User not part of this conversation' });
    }

    // Enregistrer la réponse du rider
    await prisma.contactRequestResponse.upsert({
      where: {
        contactRequestId_riderUserId: {
          contactRequestId,
          riderUserId: userId
        }
      },
      create: {
        contactRequestId,
        riderUserId: userId,
        response
      },
      update: {
        response
      }
    });

    // Vérifier les réponses de tous les riders
    const allResponses = await prisma.contactRequestResponse.findMany({
      where: { contactRequestId },
      include: { rider: true }
    });

    const riderIds = contactRequest.conversation.members
      .filter((member) => member.userId !== contactRequest.proUserId)
      .map((member) => member.userId);

    const allRidersResponded = riderIds.every((riderId: string) =>
      allResponses.some(
        (resp: Prisma.ContactRequestResponseGetPayload<{ include: { rider: true } }>) =>
          resp.riderUserId === riderId
      )
    );

    let finalStatus = 'PENDING';
    let shouldAddProToConversation = false;

    if (allRidersResponded) {
      const allAccepted = allResponses.every(
        (resp: Prisma.ContactRequestResponseGetPayload<{ include: { rider: true } }>) =>
          resp.response === 'ACCEPT'
      );
      const anyRejected = allResponses.some(
        (resp: Prisma.ContactRequestResponseGetPayload<{ include: { rider: true } }>) =>
          resp.response === 'REJECT'
      );

      if (allAccepted) {
        finalStatus = 'ACCEPTED';
        shouldAddProToConversation = true;
      } else if (anyRejected) {
        finalStatus = 'REJECTED';
      }
    }

    // Mettre à jour le statut de la demande
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.contactRequest.update({
        where: { id: contactRequestId },
        data: { status: finalStatus as any }
      });

      // Si accepté par tous, ajouter le pro à la conversation (sans changer le type)
      if (shouldAddProToConversation) {
        await tx.conversationMember.create({
          data: {
            conversationId: contactRequest.conversationId,
            userId: contactRequest.proUserId
          }
        });
      }
    });

    return res.json({
      success: true,
      status: finalStatus,
      message: finalStatus === 'ACCEPTED'
        ? 'Le professionnel a été ajouté à votre conversation'
        : finalStatus === 'REJECTED'
        ? 'Demande refusée'
        : 'Réponse enregistrée, en attente des autres participants'
    });

  } catch (err: any) {
    if (err?.name === 'ZodError') {
      return res.status(400).json({ error: 'Invalid input', details: err.errors });
    }
    return res.status(500).json({ error: 'Internal error' });
  }
});

// GET /contact/requests - Obtenir les demandes de contact pour un Pro
contactRouter.get('/requests', async (req, res) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true }
    });

    if (!user || user.role !== 'PRO') {
      return res.status(403).json({ error: 'Only professionals can view contact requests' });
    }

    const requests = await prisma.contactRequest.findMany({
      where: { proUserId: userId },
      include: {
        conversation: {
          include: {
            members: {
              include: { user: { include: { riderProfile: true } } }
            }
          }
        },
        responses: {
          include: { rider: { include: { riderProfile: true } } }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    return res.json({ requests });

  } catch (err) {
    return res.status(500).json({ error: 'Internal error' });
  }
});

// GET /contact/pending - Obtenir les demandes en attente pour un rider
contactRouter.get('/pending', async (req, res) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    // Trouver les demandes de contact en attente pour les conversations de ce rider
    const pendingRequests = await prisma.contactRequest.findMany({
      where: {
        status: 'PENDING',
        conversation: {
          members: {
            some: { userId }
          }
        },
        // Exclure les demandes où ce rider a déjà répondu
        NOT: {
          responses: {
            some: { riderUserId: userId }
          }
        }
      },
      include: {
        pro: {
          include: { proProfile: true }
        },
        conversation: {
          include: {
            match: true,
            members: {
              include: { user: { include: { riderProfile: true } } }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    return res.json({ requests: pendingRequests });

  } catch (err) {
    return res.status(500).json({ error: 'Internal error' });
  }
});
