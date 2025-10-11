import { prisma, User } from '@blobinfini/database';
import { withRetry } from './retry';

/**
 * Nettoie tous les utilisateurs de test et leurs données associées
 * @param emails - Liste des emails à nettoyer
 */
export async function cleanupTestUsers(emails: string[]) {
  try {
    // 1. Nettoyer les réponses de contact
    await prisma.contactRequestResponse.deleteMany({
      where: {
        OR: [
          { rider: { email: { in: emails } } },
          { contactRequest: { pro: { email: { in: emails } } } }
        ]
      }
    });

    // 2. Nettoyer les demandes de contact
    await prisma.contactRequest.deleteMany({
      where: {
        pro: { email: { in: emails } }
      }
    });

    // 3. Nettoyer les bookings et booking requests
    await prisma.booking.deleteMany({
      where: { rider: { email: { in: emails } } }
    });
    await prisma.bookingRequest.deleteMany({
      where: { rider: { email: { in: emails } } }
    });

    // 4. Nettoyer les availabilities
    await prisma.proAvailability.deleteMany({
      where: { pro: { email: { in: emails } } }
    });

    // 5. Nettoyer les membres de conversation
    await prisma.conversationMember.deleteMany({
      where: { user: { email: { in: emails } } }
    });

    // 6. Nettoyer les messages
    await prisma.message.deleteMany({
      where: { sender: { email: { in: emails } } }
    });

    // 7. Nettoyer les conversations
    await prisma.conversation.deleteMany({
      where: {
        members: {
          some: { user: { email: { in: emails } } }
        }
      }
    });

    // 8. Nettoyer les matches
    await prisma.match.deleteMany({
      where: {
        OR: [
          { userOne: { email: { in: emails } } },
          { userTwo: { email: { in: emails } } }
        ]
      }
    });

    // 9. Nettoyer les décisions et reports
    await prisma.matchDecision.deleteMany({
      where: { actor: { email: { in: emails } } }
    });
    await prisma.profileReport.deleteMany({
      where: { reporter: { email: { in: emails } } }
    });

    // 10. Nettoyer les transactions et wallets
    await prisma.creditTransaction.deleteMany({
      where: { user: { email: { in: emails } } }
    });
    await prisma.userWallet.deleteMany({
      where: { user: { email: { in: emails } } }
    });

    // 11. Nettoyer les profils
    await prisma.proProfile.deleteMany({ where: { user: { email: { in: emails } } } });
    await prisma.riderDiscipline.deleteMany({
      where: { profile: { user: { email: { in: emails } } } }
    });
    await prisma.riderProfile.deleteMany({ where: { user: { email: { in: emails } } } });

    // 12. Nettoyer les tokens et sessions
    await prisma.emailVerificationToken.deleteMany({
      where: { user: { email: { in: emails } } }
    });
    await prisma.passwordResetToken.deleteMany({
      where: { user: { email: { in: emails } } }
    });
    await prisma.refreshToken.deleteMany({
      where: { user: { email: { in: emails } } }
    });
    await prisma.session.deleteMany({
      where: { user: { email: { in: emails } } }
    });

    // 13. Nettoyer les utilisateurs (en dernier)
    await prisma.user.deleteMany({ where: { email: { in: emails } } });

    console.log(`✅ Cleaned up test users: ${emails.join(', ')}`);
  } catch (error) {
    console.error('❌ Error during cleanup:', error);
    throw error;
  }
}

/**
 * Crée un utilisateur en s'assurant qu'il n'existe pas déjà
 * @param data - Données de l'utilisateur
 */
export async function createTestUser(data: {
  email: string;
  password: string;
  role: 'RIDER' | 'PRO' | 'ADMIN';
  emailVerified?: boolean;
}): Promise<User> {
  // Nettoyer d'abord si l'utilisateur existe
  await cleanupTestUsers([data.email]);

  // Créer avec retry en cas de conflit de concurrence
  return withRetry(() =>
    prisma.user.create({
      data: {
        email: data.email,
        password: data.password,
        role: data.role,
        emailVerified: data.emailVerified ?? true
      }
    })
  );
}
