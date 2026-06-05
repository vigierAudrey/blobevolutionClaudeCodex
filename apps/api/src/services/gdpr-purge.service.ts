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
   * Purge des LoginAttempts (appelé par le job RGPD quotidien).
   * Délègue à purgeOldLoginAttemptsBatched en mode réel.
   * Conforme RGPD Article 5.1.e (limitation de conservation).
   */
  async purgeOldLoginAttempts(): Promise<number> {
    const { deleted } = await this.purgeOldLoginAttemptsBatched({ dryRun: false });
    return deleted;
  }

  /**
   * Purge batchée des LoginAttempts avec rétention différenciée.
   *
   * WHY batching:
   *   Un DELETE massif (ex: 1M lignes) pose un lock exclusif sur les pages touchées,
   *   génère un WAL spike, et peut provoquer un timeout Prisma (30s par défaut).
   *   Les batches de 2000 lignes limitent la durée de chaque lock à ~10-50ms.
   *
   * WHY retention différenciée:
   *   success=true  → connexion normale, PII minimal → 7 jours (RGPD minimisation).
   *   success=false → preuve d'attaque, nécessaire pour audit/investigation → 30 jours.
   *
   * WHY la sous-requête SELECT id + LIMIT:
   *   Prisma ORM ne supporte pas DELETE ... LIMIT directement.
   *   La sous-requête avec LIMIT permet un batch déterministe.
   *   L'index composite (success, createdAt DESC) est utilisé par le planner.
   *
   * @param dryRun   true = COUNT uniquement, aucune suppression.
   * @returns        { deleted, wouldDelete, dryRun, batches, successRetentionDays, failureRetentionDays }
   */
  async purgeOldLoginAttemptsBatched(options: { dryRun: boolean }): Promise<{
    deleted: number;
    wouldDelete: number;
    dryRun: boolean;
    batches: number;
    successRetentionDays: number;
    failureRetentionDays: number;
  }> {
    const { dryRun } = options;

    // Use || instead of ?? to also handle empty-string env vars ('' ?? '7' = '' → Number('') = 0).
    const successRetentionDays = Number(process.env.LOGIN_ATTEMPT_SUCCESS_RETENTION_DAYS || '7');
    const failureRetentionDays = Number(process.env.LOGIN_ATTEMPT_FAILURE_RETENTION_DAYS || '30');
    const BATCH_SIZE = 2000;
    // Safety valve: évite une boucle infinie si les timestamps sont dans le futur ou la DB est corrompue.
    const MAX_BATCHES = 5000;

    const successThreshold = new Date(Date.now() - successRetentionDays * 24 * 60 * 60 * 1000);
    const failureThreshold = new Date(Date.now() - failureRetentionDays * 24 * 60 * 60 * 1000);

    // Dry-run: COUNT uniquement via l'index composite — O(log n + matching_rows)
    if (dryRun) {
      type CountRow = { cnt: bigint };
      const [row] = await prisma.$queryRaw<CountRow[]>`
        SELECT COUNT(*)::bigint AS cnt
        FROM "LoginAttempt"
        WHERE (success = true  AND "createdAt" < ${successThreshold})
           OR (success = false AND "createdAt" < ${failureThreshold})
      `;
      const wouldDelete = Number(row?.cnt ?? 0);
      secureLogger.info('GDPR_PURGE_LOGIN_ATTEMPTS_DRYRUN', {
        wouldDelete,
        successRetentionDays,
        failureRetentionDays,
      });
      return { deleted: 0, wouldDelete, dryRun: true, batches: 0, successRetentionDays, failureRetentionDays };
    }

    // Real purge — batched DELETE via subquery
    let totalDeleted = 0;
    let batches = 0;

    for (let i = 0; i < MAX_BATCHES; i++) {
      // DELETE ... WHERE id IN (SELECT id ... LIMIT batch_size)
      // Uses (success, createdAt DESC) index; processes oldest rows first (ASC).
      const deletedInBatch = await prisma.$executeRaw`
        DELETE FROM "LoginAttempt"
        WHERE id IN (
          SELECT id FROM "LoginAttempt"
          WHERE (success = true  AND "createdAt" < ${successThreshold})
             OR (success = false AND "createdAt" < ${failureThreshold})
          ORDER BY "createdAt" ASC
          LIMIT ${BATCH_SIZE}
        )
      `;

      batches++;
      totalDeleted += deletedInBatch;

      secureLogger.info('GDPR_PURGE_LOGIN_ATTEMPTS_BATCH', {
        batch: batches,
        deletedInBatch,
        totalDeleted,
      });

      // Stop when the batch returned fewer rows than requested — table is clean.
      if (deletedInBatch < BATCH_SIZE) break;
    }

    if (batches >= MAX_BATCHES) {
      secureLogger.error('GDPR_PURGE_LOGIN_ATTEMPTS_MAX_BATCHES_REACHED', {
        MAX_BATCHES,
        totalDeleted,
      });
    }

    // Alert if volume is abnormally high (possible ongoing attack filling the table)
    if (totalDeleted > 500_000) {
      secureLogger.error('GDPR_PURGE_LOGIN_ATTEMPTS_ABNORMAL_VOLUME', {
        totalDeleted,
        batches,
      });
    }

    secureLogger.info('GDPR_PURGE_LOGIN_ATTEMPTS_COMPLETED', {
      deleted: totalDeleted,
      batches,
      successRetentionDays,
      failureRetentionDays,
    });

    return {
      deleted: totalDeleted,
      wouldDelete: totalDeleted,
      dryRun: false,
      batches,
      successRetentionDays,
      failureRetentionDays,
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
  async anonymizeDeletedUsers(): Promise<GDPRUserAnonymizationStats> {
    const now = new Date();

    // Les tokens d'alertes sont des données techniques liées au terminal.
    // Ils n'ont plus de finalité dès qu'un compte est marqué supprimé.
    const deletedUsers = await prisma.user.findMany({
      where: { deletedAt: { not: null } },
      select: { id: true },
    });
    const deletedUserIds = deletedUsers.map((user: { id: string }) => user.id);

    if (deletedUserIds.length > 0) {
      const [pushTokensResult, notificationPreferencesResult] = await Promise.all([
        prisma.pushToken.deleteMany({
          where: { userId: { in: deletedUserIds } },
        }),
        prisma.notificationPreferences.deleteMany({
          where: { userId: { in: deletedUserIds } },
        }),
      ]);

      secureLogger.info('GDPR_DELETED_USER_ALERT_DATA_PURGED', {
        pushTokensDeleted: pushTokensResult.count,
        notificationPreferencesDeleted: notificationPreferencesResult.count,
      });
    }

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
