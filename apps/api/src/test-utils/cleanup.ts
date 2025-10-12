import { prisma, User } from '@blobinfini/database';
import { withRetry } from './retry';

/**
 * Nettoie tous les utilisateurs de test et leurs données associées
 * @param emails - Liste des emails à nettoyer
 */
export async function cleanupTestUsers(emails: string[]) {
  try {
    await prisma.contactRequestResponse.deleteMany({
      where: {
        OR: [
          { rider: { email: { in: emails } } },
          { contactRequest: { pro: { email: { in: emails } } } }
        ]
      }
    });

    await prisma.contactRequest.deleteMany({
      where: {
        pro: { email: { in: emails } }
      }
    });

    await prisma.booking.deleteMany({
      where: { rider: { email: { in: emails } } }
    });
    await prisma.bookingRequest.deleteMany({
      where: { rider: { email: { in: emails } } }
    });

    await prisma.proAvailability.deleteMany({
      where: { pro: { email: { in: emails } } }
    });

    await prisma.conversationMember.deleteMany({
      where: { user: { email: { in: emails } } }
    });

    await prisma.message.deleteMany({
      where: { sender: { email: { in: emails } } }
    });

    await prisma.conversation.deleteMany({
      where: {
        members: {
          some: { user: { email: { in: emails } } }
        }
      }
    });

    await prisma.match.deleteMany({
      where: {
        OR: [
          { userOne: { email: { in: emails } } },
          { userTwo: { email: { in: emails } } }
        ]
      }
    });

    await prisma.matchDecision.deleteMany({
      where: { actor: { email: { in: emails } } }
    });
    await prisma.profileReport.deleteMany({
      where: { reporter: { email: { in: emails } } }
    });

    await prisma.creditTransaction.deleteMany({
      where: { user: { email: { in: emails } } }
    });
    await prisma.userWallet.deleteMany({
      where: { user: { email: { in: emails } } }
    });

    await prisma.proProfile.deleteMany({ where: { user: { email: { in: emails } } } });
    await prisma.riderDiscipline.deleteMany({
      where: { profile: { user: { email: { in: emails } } } }
    });
    await prisma.riderProfile.deleteMany({ where: { user: { email: { in: emails } } } });

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
  await cleanupTestUsers([data.email]);

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
