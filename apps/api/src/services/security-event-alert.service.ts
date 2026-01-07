import { systemAlertService } from './system-alert.service';
import { clientPrisma as prisma } from '@blobinfini/database';
import { secureLogger } from '../utils/secure-logger';

/**
 * Security Event Alert Service
 *
 * Connects security events (2FA rate limiting, login failures) to SystemAlert
 * for automated admin notifications with smart deduplication.
 *
 * Features:
 * - 24h deduplication windows to prevent alert spam
 * - Pattern detection for repeated login failures
 * - Severity escalation based on threat level
 * - RGPD compliant (uses ipHash, never raw IPs)
 */
class SecurityEventAlertService {
  private readonly WEB_BASE_URL = process.env.WEB_BASE_URL || 'http://localhost:3002';

  /**
   * Get today's date string for deduplication (YYYY-MM-DD format)
   * Used to create 24h deduplication windows
   */
  private getDateKey(): string {
    return new Date().toISOString().split('T')[0];
  }

  /**
   * Report 2FA rate limiting event
   *
   * Creates a SystemAlert when a user/IP hits 2FA rate limits.
   * Uses 24h deduplication to prevent spam from ongoing attacks.
   *
   * @param userId - User identifier
   * @param reason - Rate limit reason (BLOCKED_USER, BLOCKED_IP, BLOCKED_USER_IP)
   * @param ipHash - Hashed IP address (HMAC-SHA256)
   */
  async reportTwoFactorRateLimit(
    userId: string,
    reason: 'BLOCKED_USER' | 'BLOCKED_IP' | 'BLOCKED_USER_IP',
    ipHash: string
  ): Promise<void> {
    try {
      const dateKey = this.getDateKey();

      // Deduplication strategy: one alert per reason+user per day
      // This prevents spam but still alerts on new attack patterns
      const dedupeKey = `2FA_RATE_LIMIT:${reason}:${userId}:${dateKey}`;

      const severityMap = {
        BLOCKED_USER: 'WARNING' as const,      // User trying too many codes (likely forgot)
        BLOCKED_IP: 'CRITICAL' as const,       // IP attacking multiple accounts
        BLOCKED_USER_IP: 'WARNING' as const    // Specific user+IP combo (likely forgot)
      };

      const messageMap = {
        BLOCKED_USER: `Utilisateur bloqué pour tentatives 2FA excessives`,
        BLOCKED_IP: `IP bloquée pour tentatives 2FA massives (attaque potentielle)`,
        BLOCKED_USER_IP: `Utilisateur bloqué pour tentatives 2FA excessives depuis IP spécifique`
      };

      await systemAlertService.ensureAlert({
        type: '2FA_RATE_LIMIT',
        message: messageMap[reason],
        severity: severityMap[reason],
        link: `${this.WEB_BASE_URL}/admin/security-alerts`,
        metadata: {
          userId,
          reason,
          ipHash,
          timestamp: new Date().toISOString(),
          rateLimitThresholds: {
            perUser: process.env.TWO_FACTOR_MAX_ATTEMPTS_USER || '5',
            perIp: process.env.TWO_FACTOR_MAX_ATTEMPTS_IP || '20',
            perUserIp: process.env.TWO_FACTOR_MAX_ATTEMPTS_USER_IP || '5'
          }
        },
        createdById: userId,
        dedupeKey
      });

      secureLogger.info('SECURITY_ALERT_2FA_RATE_LIMIT_CREATED', {
        userId,
        reason,
        dedupeKey
      });
    } catch (error) {
      // Never fail the 2FA flow if alert creation fails
      secureLogger.error('SECURITY_ALERT_2FA_RATE_LIMIT_FAILED', {
        userId,
        reason,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Detect and report repeated login failures pattern
   *
   * Analyzes recent LoginAttempt records to detect brute-force attacks.
   * Creates SystemAlert if suspicious patterns detected.
   *
   * Detection criteria:
   * - 10+ failed attempts in last hour from same IP → CRITICAL (brute-force attack)
   * - 5+ failed attempts for same email in last hour → WARNING (account targeted)
   *
   * @param email - Email being targeted
   * @param ipHash - Hashed IP address (HMAC-SHA256)
   */
  async detectAndReportLoginFailurePattern(
    email: string,
    ipHash: string
  ): Promise<void> {
    try {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

      // Check for IP-based brute-force (multiple accounts from same IP)
      const ipFailures = await prisma.loginAttempt.count({
        where: {
          ipHash,
          success: false,
          createdAt: { gte: oneHourAgo }
        }
      });

      // Check for account-targeted attack (same email, multiple IPs)
      const emailFailures = await prisma.loginAttempt.count({
        where: {
          email,
          success: false,
          createdAt: { gte: oneHourAgo }
        }
      });

      const dateKey = this.getDateKey();

      // CRITICAL: IP attacking multiple accounts (brute-force)
      if (ipFailures >= 10) {
        const dedupeKey = `LOGIN_BRUTE_FORCE:IP:${ipHash}:${dateKey}`;

        await systemAlertService.ensureAlert({
          type: 'LOGIN_BRUTE_FORCE',
          message: `Attaque brute-force détectée: ${ipFailures} tentatives échouées en 1h depuis même IP`,
          severity: 'CRITICAL',
          link: `${this.WEB_BASE_URL}/admin/security-alerts`,
          metadata: {
            ipHash,
            failureCount: ipFailures,
            timeWindow: '1h',
            timestamp: new Date().toISOString(),
            latestEmail: email // Last targeted email
          },
          createdById: null,
          dedupeKey
        });

        secureLogger.warn('SECURITY_ALERT_LOGIN_BRUTE_FORCE_DETECTED', {
          ipHash,
          failureCount: ipFailures,
          dedupeKey
        });
      }

      // WARNING: Account being targeted (credential stuffing or targeted attack)
      if (emailFailures >= 5) {
        const dedupeKey = `LOGIN_TARGETED_ACCOUNT:${email}:${dateKey}`;

        await systemAlertService.ensureAlert({
          type: 'LOGIN_TARGETED_ACCOUNT',
          message: `Compte ciblé: ${emailFailures} tentatives échouées en 1h pour ${email}`,
          severity: 'WARNING',
          link: `${this.WEB_BASE_URL}/admin/security-alerts`,
          metadata: {
            email,
            failureCount: emailFailures,
            timeWindow: '1h',
            timestamp: new Date().toISOString(),
            latestIpHash: ipHash // Last IP attempting
          },
          createdById: null,
          dedupeKey
        });

        secureLogger.warn('SECURITY_ALERT_LOGIN_TARGETED_ACCOUNT_DETECTED', {
          email,
          failureCount: emailFailures,
          dedupeKey
        });
      }
    } catch (error) {
      // Never fail the login flow if pattern detection fails
      secureLogger.error('SECURITY_ALERT_LOGIN_PATTERN_DETECTION_FAILED', {
        email,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Report successful login after previous failures
   *
   * This can indicate a successful brute-force attack that should be investigated.
   * Only creates alert if there were 5+ failed attempts before success.
   *
   * @param email - Email that successfully logged in
   * @param ipHash - Hashed IP address (HMAC-SHA256)
   * @param userId - User ID that logged in
   */
  async reportSuccessAfterFailures(
    email: string,
    ipHash: string,
    userId: string
  ): Promise<void> {
    try {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

      // Count recent failures for this email
      const recentFailures = await prisma.loginAttempt.count({
        where: {
          email,
          success: false,
          createdAt: { gte: oneHourAgo }
        }
      });

      // Only alert if there were significant failures (possible brute-force success)
      if (recentFailures >= 5) {
        const dateKey = this.getDateKey();
        const dedupeKey = `LOGIN_SUCCESS_AFTER_FAILURES:${userId}:${dateKey}`;

        await systemAlertService.ensureAlert({
          type: 'LOGIN_SUCCESS_AFTER_FAILURES',
          message: `Connexion réussie après ${recentFailures} échecs en 1h (brute-force réussi?)`,
          severity: 'CRITICAL',
          link: `${this.WEB_BASE_URL}/admin/security-alerts`,
          metadata: {
            userId,
            email,
            ipHash,
            recentFailures,
            timeWindow: '1h',
            timestamp: new Date().toISOString()
          },
          createdById: userId,
          dedupeKey
        });

        secureLogger.warn('SECURITY_ALERT_LOGIN_SUCCESS_AFTER_FAILURES', {
          userId,
          email,
          recentFailures,
          dedupeKey
        });
      }
    } catch (error) {
      // Never fail the login flow if alert creation fails
      secureLogger.error('SECURITY_ALERT_SUCCESS_AFTER_FAILURES_FAILED', {
        email,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
}

export const securityEventAlertService = new SecurityEventAlertService();
