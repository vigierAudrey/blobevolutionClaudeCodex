import { prisma } from '@blobinfini/database';
import crypto from 'crypto';

/**
 * Service de purge RGPD avec protection juridique
 *
 * STRATÉGIE :
 * - Conserver les preuves de consentement 10 ans (protection juridique)
 * - Purger les données personnelles détaillées rapidement (RGPD)
 * - Anonymiser plutôt que supprimer quand possible
 */
export class GDPRPurgeService {

  /**
   * Anonymise une données sensible en conservant un hash pour identification
   */
  private anonymizeData(originalData: string, userId: string): string {
    const salt = process.env.ANONYMIZATION_SALT || 'blobinfini-gdpr-salt';
    return crypto.createHash('sha256').update(`${originalData}:${userId}:${salt}`).digest('hex').substring(0, 16);
  }

  /**
   * ÉTAPE 1: Purge immédiate des données techniques expirées
   * À exécuter toutes les heures
   */
  async purgeExpiredTechnicalData(): Promise<{
    sessionsDeleted: number;
    tokensDeleted: number;
    oldLogsDeleted: number;
  }> {
    const now = new Date();

    // Supprimer les sessions expirées
    const sessionsResult = await prisma.session.deleteMany({
      where: { expiresAt: { lt: now } }
    });

    // Supprimer les tokens de réinitialisation expirés
    const passwordTokensResult = await prisma.passwordResetToken.deleteMany({
      where: { expiresAt: { lt: now } }
    });

    // Supprimer les tokens de vérification email expirés
    const emailTokensResult = await prisma.emailVerificationToken.deleteMany({
      where: { expiresAt: { lt: now } }
    });

    // Supprimer les refresh tokens expirés
    const refreshTokensResult = await prisma.refreshToken.deleteMany({
      where: { expiresAt: { lt: now } }
    });

    const tokensDeleted = passwordTokensResult.count + emailTokensResult.count + refreshTokensResult.count;

    console.log(`✅ GDPR: Purged ${sessionsResult.count} sessions, ${tokensDeleted} expired tokens`);

    return {
      sessionsDeleted: sessionsResult.count,
      tokensDeleted,
      oldLogsDeleted: 0 // TODO: implémenter si des logs existent
    };
  }

  /**
   * ÉTAPE 2: Anonymisation progressive des comptes supprimés
   * À exécuter quotidiennement
   *
   * PHASE 1 (7 jours): Anonymiser données personnelles détaillées
   * PHASE 2 (2 ans): Anonymiser email
   * PHASE 3 (10 ans): Conserver uniquement preuve consentement
   */
  async anonymizeDeletedUsers(): Promise<{
    phase1Anonymized: number;
    phase2Anonymized: number;
    phase3Purged: number;
  }> {
    const now = new Date();

    // PHASE 1: Anonymiser profils détaillés après 7 jours
    const phase1Threshold = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const phase1Users = await prisma.user.findMany({
      where: {
        deletedAt: { not: null, lt: phase1Threshold },
        // Pas encore anonymisé (email pas encore hashé)
        email: { not: { startsWith: 'anon_' } }
      },
      include: {
        riderProfile: true,
        proProfile: true
      }
    });

    let phase1Count = 0;
    for (const user of phase1Users) {
      // Anonymiser les profils détaillés
      if (user.riderProfile) {
        await prisma.riderProfile.update({
          where: { userId: user.id },
          data: {
            displayName: `Utilisateur supprimé ${this.anonymizeData(user.email, user.id)}`,
            bio: null,
            photoUrl: null,
            // Conserver sport/level pour stats anonymes
            lat: null,
            lng: null
          }
        });
      }

      if (user.proProfile) {
        await prisma.proProfile.update({
          where: { userId: user.id },
          data: {
            businessName: `Pro supprimé ${this.anonymizeData(user.email, user.id)}`,
            photoUrl: null,
            bio: null
          }
        });
      }

      phase1Count++;
    }

    // PHASE 2: Anonymiser email après 2 ans
    const phase2Threshold = new Date(now.getTime() - 2 * 365 * 24 * 60 * 60 * 1000);
    const phase2Users = await prisma.user.findMany({
      where: {
        deletedAt: { not: null, lt: phase2Threshold },
        email: { not: { startsWith: 'anon_' } }
      }
    });

    let phase2Count = 0;
    for (const user of phase2Users) {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          email: `anon_${this.anonymizeData(user.email, user.id)}@anonymized.local`,
          password: 'ANONYMIZED'
        }
      });
      phase2Count++;
    }

    // PHASE 3: Purge finale après 10 ans (sauf preuves légales)
    const phase3Threshold = new Date(now.getTime() - 10 * 365 * 24 * 60 * 60 * 1000);

    // Identifier les utilisateurs à purger définitivement
    const phase3Users = await prisma.user.findMany({
      where: {
        deletedAt: { not: null, lt: phase3Threshold }
      }
    });

    let phase3Count = 0;
    for (const user of phase3Users) {
      // Créer un enregistrement de preuve légale avant suppression
      await prisma.$executeRaw`
        INSERT INTO legal_consent_archive (
          original_user_id,
          consented_at,
          consent_version,
          consent_ip_hash,
          deleted_at,
          archived_at
        ) VALUES (
          ${user.id},
          ${user.consentedAt},
          ${user.consentVersion},
          ${user.consentIp ? this.anonymizeData(user.consentIp, user.id) : null},
          ${user.deletedAt},
          NOW()
        )
        ON DUPLICATE KEY UPDATE archived_at = NOW()
      `;

      // Supprimer définitivement l'utilisateur et ses données
      await prisma.user.delete({
        where: { id: user.id }
      });

      phase3Count++;
    }

    console.log(`✅ GDPR: Phase1=${phase1Count}, Phase2=${phase2Count}, Phase3=${phase3Count} users processed`);

    return {
      phase1Anonymized: phase1Count,
      phase2Anonymized: phase2Count,
      phase3Purged: phase3Count
    };
  }

  /**
   * ÉTAPE 3: Nettoyage des conversations et données relationnelles
   * À exécuter quotidiennement
   */
  async purgeRelationalData(): Promise<{
    conversationsDeleted: number;
    matchesDeleted: number;
    oldSearchesDeleted: number;
  }> {
    const now = new Date();

    // Supprimer les conversations trasher depuis > 30 jours
    const convThreshold = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // D'abord supprimer les membres de conversations trashées
    await prisma.conversationMember.deleteMany({
      where: {
        trashedAt: { not: null, lt: convThreshold }
      }
    });

    // Supprimer les conversations orphelines (sans membres)
    const orphanConversations = await prisma.conversation.deleteMany({
      where: {
        members: { none: {} }
      }
    });

    // Supprimer les anciennes recherches (> 1 an)
    const searchThreshold = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
    const oldSearches = await prisma.lastSearch.deleteMany({
      where: {
        updatedAt: { lt: searchThreshold }
      }
    });

    // Supprimer les matches avec utilisateurs supprimés
    const orphanMatches = await prisma.match.deleteMany({
      where: {
        OR: [
          { userOne: { deletedAt: { not: null } } },
          { userTwo: { deletedAt: { not: null } } }
        ]
      }
    });

    console.log(`✅ GDPR: Conversations=${orphanConversations.count}, Matches=${orphanMatches.count}, Searches=${oldSearches.count} deleted`);

    return {
      conversationsDeleted: orphanConversations.count,
      matchesDeleted: orphanMatches.count,
      oldSearchesDeleted: oldSearches.count
    };
  }

  /**
   * Purge complète - À exécuter quotidiennement via CRON
   */
  async performFullPurge(): Promise<{
    technicalData: any;
    userAnonymization: any;
    relationalData: any;
    summary: string;
  }> {
    console.log('🧹 Starting GDPR purge...');

    const technicalData = await this.purgeExpiredTechnicalData();
    const userAnonymization = await this.anonymizeDeletedUsers();
    const relationalData = await this.purgeRelationalData();

    const summary = `GDPR Purge completed: ${technicalData.sessionsDeleted + technicalData.tokensDeleted} technical items, ${userAnonymization.phase1Anonymized + userAnonymization.phase2Anonymized + userAnonymization.phase3Purged} users processed, ${relationalData.conversationsDeleted + relationalData.matchesDeleted + relationalData.oldSearchesDeleted} relational items deleted`;

    console.log(`✅ ${summary}`);

    return {
      technicalData,
      userAnonymization,
      relationalData,
      summary
    };
  }

  /**
   * Vérification de conformité RGPD
   */
  async getGDPRComplianceReport(): Promise<{
    expiredSessionsCount: number;
    expiredTokensCount: number;
    unanonymizedDeletedUsers: number;
    oldDeletedUsersAwaitingPurge: number;
    trashedConversationsOld: number;
  }> {
    const now = new Date();

    const expiredSessions = await prisma.session.count({
      where: { expiresAt: { lt: now } }
    });

    const expiredPasswordTokens = await prisma.passwordResetToken.count({
      where: { expiresAt: { lt: now } }
    });

    const expiredEmailTokens = await prisma.emailVerificationToken.count({
      where: { expiresAt: { lt: now } }
    });

    const phase1Threshold = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const unanonymizedUsers = await prisma.user.count({
      where: {
        deletedAt: { not: null, lt: phase1Threshold },
        email: { not: { startsWith: 'anon_' } }
      }
    });

    const phase3Threshold = new Date(now.getTime() - 10 * 365 * 24 * 60 * 60 * 1000);
    const oldDeletedUsers = await prisma.user.count({
      where: {
        deletedAt: { not: null, lt: phase3Threshold }
      }
    });

    const convThreshold = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const oldTrashedConversations = await prisma.conversationMember.count({
      where: {
        trashedAt: { not: null, lt: convThreshold }
      }
    });

    return {
      expiredSessionsCount: expiredSessions,
      expiredTokensCount: expiredPasswordTokens + expiredEmailTokens,
      unanonymizedDeletedUsers: unanonymizedUsers,
      oldDeletedUsersAwaitingPurge: oldDeletedUsers,
      trashedConversationsOld: oldTrashedConversations
    };
  }
}

export const gdprPurgeService = new GDPRPurgeService();