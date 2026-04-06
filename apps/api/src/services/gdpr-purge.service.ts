import { clientPrisma as prisma } from '@blobinfini/database';
import crypto from 'crypto';
import { secureLogger } from '../utils/secure-logger';
import { archiveBookingsBulk } from '../lib/booking-archive';
import { retentionExportArtifactService } from './retention-export-artifact.service';

export interface GDPRTechnicalStats {
  sessionsDeleted: number;
  tokensDeleted: number;
  oldLogsDeleted: number;
  loginAttemptsDeleted: number;
  analyticsEventsDeleted: number;
  analyticsDailyAggDeleted: number;
}

export interface GDPRUserAnonymizationStats {
  phase1Anonymized: number;
  phase2Anonymized: number;
  phase3Purged: number;
}

export interface GDPRRelationalStats {
  conversationsDeleted: number;
  matchesDeleted: number;
  oldSearchesDeleted: number;
}

export interface GDPRPurgeResult {
  technicalData: GDPRTechnicalStats;
  userAnonymization: GDPRUserAnonymizationStats;
  relationalData: GDPRRelationalStats;
  summary: string;
}

export interface AuditLogPurgeReadiness {
  requiresVerifiedExport: boolean;
  exportVerified: boolean;
  hasEligibleLogs: boolean;
  threshold: Date;
  oldestPurgeableLogCreatedAt: Date | null;
}

/**
 * Service de purge RGPD avec protection juridique
 *
 * STRATÉGIE :
 * - Conserver les preuves de consentement 10 ans (protection juridique)
 * - Purger les données personnelles détaillées rapidement (RGPD)
 * - Anonymiser plutôt que supprimer quand possible
 */
export class GDPRPurgeService {
  async getAuditLogPurgeReadiness(now: Date = new Date()): Promise<AuditLogPurgeReadiness> {
    const logRetentionDays = Number(process.env.AUDIT_LOG_RETENTION_DAYS || '365');
    const requiresVerifiedExport = String(process.env.AUDIT_LOG_PURGE_REQUIRES_VERIFIED_EXPORT || 'true').toLowerCase() !== 'false';
    const threshold = new Date(now.getTime() - logRetentionDays * 24 * 60 * 60 * 1000);

    const oldestPurgeableLog = await prisma.auditLog.findFirst({
      where: { createdAt: { lt: threshold } },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    });

    if (!oldestPurgeableLog) {
      return {
        requiresVerifiedExport,
        exportVerified: true,
        hasEligibleLogs: false,
        threshold,
        oldestPurgeableLogCreatedAt: null,
      };
    }

    if (!requiresVerifiedExport) {
      return {
        requiresVerifiedExport,
        exportVerified: true,
        hasEligibleLogs: true,
        threshold,
        oldestPurgeableLogCreatedAt: oldestPurgeableLog.createdAt,
      };
    }

    const exportVerified = await retentionExportArtifactService.hasVerifiedCoverage(
      'AUDIT_LOG',
      oldestPurgeableLog.createdAt,
      threshold,
    );

    return {
      requiresVerifiedExport,
      exportVerified,
      hasEligibleLogs: true,
      threshold,
      oldestPurgeableLogCreatedAt: oldestPurgeableLog.createdAt,
    };
  }

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
  async purgeExpiredTechnicalData(): Promise<GDPRTechnicalStats> {
    const now = new Date();
    const analyticsRetentionDays = Number(process.env.ANALYTICS_EVENT_RETENTION_DAYS || '90');
    const analyticsAggRetentionDays = Number(process.env.ANALYTICS_DAILY_AGG_RETENTION_DAYS || '365');

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

    const auditLogReadiness = await this.getAuditLogPurgeReadiness(now);
    const oldLogsResult = auditLogReadiness.hasEligibleLogs && auditLogReadiness.exportVerified
      ? await prisma.auditLog.deleteMany({
        where: {
          createdAt: { lt: auditLogReadiness.threshold }
        }
      })
      : { count: 0 };

    if (auditLogReadiness.hasEligibleLogs && !auditLogReadiness.exportVerified) {
      secureLogger.warn('GDPR_PURGE_AUDIT_LOG_BLOCKED_MISSING_VERIFIED_EXPORT', {
        threshold: auditLogReadiness.threshold.toISOString(),
        oldestPurgeableLogCreatedAt: auditLogReadiness.oldestPurgeableLogCreatedAt?.toISOString() ?? null,
      });
    }

    // Purger les LoginAttempts anciens (RGPD Article 5.1.e)
    const loginAttemptsDeleted = await this.purgeOldLoginAttempts();

    let analyticsEventsDeleted = 0;
    if (analyticsRetentionDays > 0) {
      const analyticsThreshold = new Date(now.getTime() - analyticsRetentionDays * 24 * 60 * 60 * 1000);
      const analyticsEventsResult = await prisma.analyticsEvent.deleteMany({
        where: { occurredAt: { lt: analyticsThreshold } },
      });
      analyticsEventsDeleted = analyticsEventsResult.count;
    }

    let analyticsDailyAggDeleted = 0;
    if (analyticsAggRetentionDays > 0) {
      const analyticsAggThreshold = new Date(now.getTime() - analyticsAggRetentionDays * 24 * 60 * 60 * 1000);
      const analyticsAggResult = await prisma.analyticsDailyAgg.deleteMany({
        where: { day: { lt: analyticsAggThreshold } },
      });
      analyticsDailyAggDeleted = analyticsAggResult.count;
    }

    secureLogger.info('GDPR_PURGE_TECHNICAL_COMPLETED', {
      sessionsDeleted: sessionsResult.count,
      tokensDeleted,
      loginAttemptsDeleted,
      analyticsEventsDeleted,
    });

    return {
      sessionsDeleted: sessionsResult.count,
      tokensDeleted,
      oldLogsDeleted: oldLogsResult.count,
      loginAttemptsDeleted,
      analyticsEventsDeleted,
      analyticsDailyAggDeleted
    };
  }

  /**
   * Purge des LoginAttempts après durée de rétention
   * Conforme RGPD Article 5.1.e (limitation de conservation)
   * @returns Nombre d'entrées supprimées
   */
  async purgeOldLoginAttempts(): Promise<number> {
    const retentionDays = Number(process.env.LOGIN_ATTEMPT_RETENTION_DAYS || '30');
    const threshold = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

    const result = await prisma.loginAttempt.deleteMany({
      where: {
        createdAt: { lt: threshold }
      }
    });

    secureLogger.info('GDPR_PURGE_LOGIN_ATTEMPTS_COMPLETED', {
      count: result.count,
      retentionDays,
    });

    // Alerte si nombre anormal (possible attaque)
    if (result.count > 100000) {
      secureLogger.error('GDPR_PURGE_LOGIN_ATTEMPTS_ABNORMAL', { count: result.count });
    }

    return result.count;
  }

  /**
   * ÉTAPE 2: Anonymisation progressive des comptes supprimés
   * À exécuter quotidiennement
   *
   * PHASE 1 (7 jours): Anonymiser données personnelles détaillées
   * PHASE 2 (2 ans): Anonymiser email
   * PHASE 3 (10 ans): Conserver uniquement preuve consentement
   */
  async anonymizeDeletedUsers(): Promise<GDPRUserAnonymizationStats> {
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
      if (!user.deletedAt) continue;

      await prisma.legalConsentArchive.upsert({
        where: {
          originalUserId_deletedAt: {
            originalUserId: user.id,
            deletedAt: user.deletedAt
          }
        },
        create: {
          originalUserId: user.id,
          consentedAt: user.consentedAt ?? null,
          consentVersion: user.consentVersion ?? null,
          // RGPD v2: use consentIpHash (already HMAC-SHA256), no need to re-anonymize
          consentIpHash: user.consentIpHash ?? null,
          deletedAt: user.deletedAt,
          archivedAt: new Date()
        },
        update: {
          consentedAt: user.consentedAt ?? null,
          consentVersion: user.consentVersion ?? null,
          // RGPD v2: use consentIpHash (already HMAC-SHA256), no need to re-anonymize
          consentIpHash: user.consentIpHash ?? null,
          archivedAt: new Date()
        }
      });

      // Archiver les bookings AVANT la cascade de suppression.
      // Booking.onDelete = Cascade depuis User ET depuis ProAvailability →
      // tout sera détruit par user.delete() ci-dessous.
      // On collecte : bookings en tant que rider + bookings en tant que pro
      // (via les slots de disponibilité de ce pro).
      const bookingsToArchive = await prisma.booking.findMany({
        where: {
          OR: [
            { riderUserId: user.id },
            { availability: { proUserId: user.id } },
          ],
        },
        include: {
          availability: {
            select: { proUserId: true, sport: true, startAt: true, price: true },
          },
        },
      });

      if (bookingsToArchive.length > 0) {
        const archiveResult = await archiveBookingsBulk(
          bookingsToArchive,
          new Date(), // closedAt = maintenant (pré-suppression)
          `gdpr-phase3:${user.id}`
        );
        secureLogger.info('GDPR_PHASE3_BOOKINGS_ARCHIVED', {
          userId: '[redacted]',
          created: archiveResult.created,
          skipped: archiveResult.skipped,
          errors:  archiveResult.errors,
        });
      }

      // Supprimer définitivement l'utilisateur et ses données
      await prisma.user.delete({
        where: { id: user.id }
      });

      phase3Count++;
    }

    secureLogger.info('GDPR_USER_ANONYMIZATION_COMPLETED', {
      phase1Count,
      phase2Count,
      phase3Count,
    });

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
  async purgeRelationalData(): Promise<GDPRRelationalStats> {
    const now = new Date();

    // Supprimer les conversations trashées depuis > 90 jours
    // (porté de 30j à 90j — RGPD Phase 1, meilleure couverture litiges court-terme)
    const convThreshold = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

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

    secureLogger.info('GDPR_PURGE_RELATIONAL_COMPLETED', {
      conversationsDeleted: orphanConversations.count,
      matchesDeleted: orphanMatches.count,
      oldSearchesDeleted: oldSearches.count,
    });

    return {
      conversationsDeleted: orphanConversations.count,
      matchesDeleted: orphanMatches.count,
      oldSearchesDeleted: oldSearches.count
    };
  }

  /**
   * Purge complète - À exécuter quotidiennement via CRON
   */
  async performFullPurge(): Promise<GDPRPurgeResult> {
    secureLogger.info('GDPR_PURGE_STARTED');

    const technicalData = await this.purgeExpiredTechnicalData();
    const userAnonymization = await this.anonymizeDeletedUsers();
    const relationalData = await this.purgeRelationalData();

    const summary = `GDPR Purge completed: ${technicalData.sessionsDeleted + technicalData.tokensDeleted} technical items, ${userAnonymization.phase1Anonymized + userAnonymization.phase2Anonymized + userAnonymization.phase3Purged} users processed, ${relationalData.conversationsDeleted + relationalData.matchesDeleted + relationalData.oldSearchesDeleted} relational items deleted`;

    secureLogger.info('GDPR_PURGE_COMPLETED', { summary });

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

    const convThreshold = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
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
