/**
 * Service d'alertes de sécurité
 *
 * Détecte et notifie l'administrateur des tentatives d'accès non autorisées
 * à des ressources ou endpoints protégés.
 *
 * Fonctionnalités :
 * - Enregistrement dans systemAlert (base de données)
 * - Notification email à l'administrateur
 * - Logs runtime sécurisés pour traçabilité immédiate
 */

import { systemAlertService } from './system-alert.service';
import { sendMail } from '../lib/mailer';
import { hashIpHmac } from '../lib/hash-ip';
import { hashEmail } from '../modules/auth/login-attempt.util';
import { secureLogger } from '../utils/secure-logger';

interface SecurityViolation {
  userId: string;
  userEmail?: string;
  userRole: string;
  action: string;
  endpoint: string;
  attemptedAction: string;
  clientIp?: string;
  userAgent?: string;
}

class SecurityAlertService {
  private readonly ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@blobinfini.com';
  private readonly WEB_BASE_URL = process.env.WEB_BASE_URL || 'http://localhost:3002';

  /**
   * Enregistre une violation de sécurité et notifie l'administrateur
   */
  async reportSecurityViolation(violation: SecurityViolation): Promise<void> {
    const {
      userId,
      userEmail,
      userRole,
      action,
      endpoint,
      attemptedAction,
      clientIp,
      userAgent
    } = violation;
    const ipHash = this.resolveIpHash(clientIp);

    secureLogger.security('SECURITY_VIOLATION_REPORTED', {
      userId,
      userRole,
      action,
      endpoint,
      attemptedAction,
      ipHash,
    });

    // 2. Créer une alerte système en base de données
    try {
      await systemAlertService.createAlert({
        type: 'SECURITY_VIOLATION',
        message: `${userRole} user attempted unauthorized access: ${attemptedAction}`,
        severity: 'CRITICAL',
        link: `${this.WEB_BASE_URL}/admin/security-alerts`,
        metadata: {
          userId,
          userEmail,
          userRole,
          endpoint,
          action,
          attemptedAction,
          ipHash,
          ipHashVersion: ipHash ? 'v2' : null,
          userAgent,
          timestamp: new Date().toISOString()
        },
        createdById: userId,
        dedupeKey: null // Pas de déduplication pour les violations de sécurité
      });

      secureLogger.info('SECURITY_ALERT_CREATED', { userId, endpoint });
    } catch (error) {
      secureLogger.error('SECURITY_ALERT_CREATE_FAILED', { error, endpoint });
      // Ne pas bloquer si l'alerte DB échoue
    }

    // 3. Envoyer notification email à l'admin
    try {
      await this.sendAdminNotificationEmail(violation);
      secureLogger.info('SECURITY_ALERT_EMAIL_SENT', {
        adminEmailHash: hashEmail(this.ADMIN_EMAIL)
      });
    } catch (error) {
      secureLogger.error('SECURITY_ALERT_EMAIL_FAILED', { error });
      // Ne pas bloquer si l'email échoue
    }
  }

  /**
   * Envoie un email de notification à l'administrateur
   */
  private async sendAdminNotificationEmail(violation: SecurityViolation): Promise<void> {
    const {
      userId,
      userEmail,
      userRole,
      endpoint,
      attemptedAction,
      clientIp,
      userAgent
    } = violation;
    const ipHash = this.resolveIpHash(clientIp);

    const subject = `🚨 Alerte Sécurité : Tentative d'accès non autorisée`;

    const text = `ALERTE DE SÉCURITÉ - BlobConnect

Une tentative d'accès non autorisée a été détectée et bloquée.

DÉTAILS DE L'INCIDENT :
────────────────────────
👤 Utilisateur : ${userId}
📧 Email : ${userEmail || 'N/A'}
👥 Rôle : ${userRole}
🎯 Endpoint : ${endpoint}
⚠️  Action tentée : ${attemptedAction}
🌐 Empreinte IP (HMAC) : ${ipHash || 'N/A'}
🖥️  User-Agent : ${userAgent || 'N/A'}
⏰ Date/Heure : ${new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })}

ACTION PRISE :
────────────────────────
✅ Accès bloqué (403 Forbidden)
✅ Incident enregistré dans les logs système
✅ Alerte créée dans le dashboard admin

ACTIONS RECOMMANDÉES :
────────────────────────
1. Vérifier l'historique de l'utilisateur
2. Contacter l'utilisateur si nécessaire
3. Surveiller les tentatives répétées
4. Considérer une suspension temporaire si comportement malveillant

Accéder au dashboard : ${this.WEB_BASE_URL}/admin/security-alerts

────────────────────────
Système de sécurité BlobConnect`;

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: 'Segoe UI', Arial, sans-serif; background: #f9fafb; margin: 0; padding: 20px; }
    .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    .header { background: linear-gradient(135deg, #dc2626 0%, #991b1b 100%); color: white; padding: 30px 20px; text-align: center; }
    .header h1 { margin: 0; font-size: 24px; font-weight: 600; }
    .header p { margin: 10px 0 0 0; opacity: 0.9; font-size: 14px; }
    .content { padding: 30px 20px; }
    .alert-box { background: #fef2f2; border-left: 4px solid #dc2626; padding: 16px; margin: 20px 0; border-radius: 4px; }
    .alert-box strong { color: #991b1b; }
    .details { background: #f9fafb; padding: 20px; border-radius: 6px; margin: 20px 0; }
    .detail-row { display: flex; padding: 8px 0; border-bottom: 1px solid #e5e7eb; }
    .detail-row:last-child { border-bottom: none; }
    .detail-label { font-weight: 600; color: #6b7280; min-width: 140px; }
    .detail-value { color: #111827; word-break: break-word; }
    .actions { background: #f0f9ff; border: 1px solid #bfdbfe; padding: 20px; border-radius: 6px; margin: 20px 0; }
    .actions h3 { margin: 0 0 12px 0; color: #1e40af; font-size: 16px; }
    .actions ul { margin: 8px 0; padding-left: 20px; color: #1e40af; }
    .actions li { margin: 6px 0; }
    .button { display: inline-block; padding: 12px 24px; background: #1e40af; color: white; text-decoration: none; border-radius: 6px; margin: 10px 0; font-weight: 500; }
    .footer { background: #f9fafb; padding: 20px; text-align: center; color: #6b7280; font-size: 12px; border-top: 1px solid #e5e7eb; }
    .badge { display: inline-block; padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: 600; }
    .badge-critical { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; }
    .badge-blocked { background: #f0fdf4; color: #166534; border: 1px solid #bbf7d0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🚨 Alerte de Sécurité</h1>
      <p>Une tentative d'accès non autorisée a été détectée et bloquée</p>
    </div>

    <div class="content">
      <div class="alert-box">
        <strong>⚠️ INCIDENT DE SÉCURITÉ</strong><br>
        Un utilisateur avec le rôle <strong>${userRole}</strong> a tenté d'accéder à des ressources non autorisées.
      </div>

      <h3 style="color: #111827; margin-top: 24px;">Détails de l'incident</h3>
      <div class="details">
        <div class="detail-row">
          <span class="detail-label">👤 ID Utilisateur :</span>
          <span class="detail-value"><code>${userId}</code></span>
        </div>
        <div class="detail-row">
          <span class="detail-label">📧 Email :</span>
          <span class="detail-value">${userEmail || 'N/A'}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">👥 Rôle :</span>
          <span class="detail-value"><span class="badge badge-critical">${userRole}</span></span>
        </div>
        <div class="detail-row">
          <span class="detail-label">🎯 Endpoint :</span>
          <span class="detail-value"><code>${endpoint}</code></span>
        </div>
        <div class="detail-row">
          <span class="detail-label">⚠️ Action tentée :</span>
          <span class="detail-value">${attemptedAction}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">🌐 Empreinte IP :</span>
          <span class="detail-value"><code>${ipHash || 'N/A'}</code></span>
        </div>
        <div class="detail-row">
          <span class="detail-label">🖥️ User-Agent :</span>
          <span class="detail-value" style="font-size: 11px;">${userAgent || 'N/A'}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">⏰ Date/Heure :</span>
          <span class="detail-value">${new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">✅ Statut :</span>
          <span class="detail-value"><span class="badge badge-blocked">BLOQUÉ</span></span>
        </div>
      </div>

      <div class="actions">
        <h3>📋 Actions recommandées</h3>
        <ul>
          <li>Vérifier l'historique d'activité de cet utilisateur</li>
          <li>Contacter l'utilisateur pour comprendre l'intention</li>
          <li>Surveiller les tentatives répétées sur ce compte</li>
          <li>Considérer une suspension temporaire si comportement suspect</li>
        </ul>
      </div>

      <div style="text-align: center; margin: 30px 0;">
        <a href="${this.WEB_BASE_URL}/admin/security-alerts" class="button">
          🔍 Consulter le Dashboard Sécurité
        </a>
      </div>
    </div>

    <div class="footer">
      <strong>Système de sécurité BlobConnect</strong><br>
      Cette alerte a été générée automatiquement. Ne pas répondre à cet email.<br>
      Pour toute question, consultez le dashboard administrateur.
    </div>
  </div>
</body>
</html>`;

    await sendMail({
      to: this.ADMIN_EMAIL,
      subject,
      text,
      html
    });
  }

  private resolveIpHash(clientIp?: string): string | undefined {
    try {
      return hashIpHmac(clientIp) ?? undefined;
    } catch (error) {
      secureLogger.error('SECURITY_ALERT_IP_HASH_FAILED', {
        reason: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  /**
   * Rapporte une tentative de PRO d'accéder aux endpoints RIDER
   */
  async reportProToRiderViolation(
    userId: string,
    endpoint: string,
    userEmail?: string,
    clientIp?: string,
    userAgent?: string
  ): Promise<void> {
    await this.reportSecurityViolation({
      userId,
      userEmail,
      userRole: 'PRO',
      action: 'ACCESS_RIDER_ENDPOINT',
      endpoint,
      attemptedAction: 'Accès aux données RIDER depuis un compte PRO',
      clientIp,
      userAgent
    });
  }

  /**
   * Rapporte une tentative de RIDER d'accéder aux endpoints PRO
   */
  async reportRiderToProViolation(
    userId: string,
    endpoint: string,
    userEmail?: string,
    clientIp?: string,
    userAgent?: string
  ): Promise<void> {
    await this.reportSecurityViolation({
      userId,
      userEmail,
      userRole: 'RIDER',
      action: 'ACCESS_PRO_ENDPOINT',
      endpoint,
      attemptedAction: 'Accès aux données PRO depuis un compte RIDER',
      clientIp,
      userAgent
    });
  }

  /**
   * Rapporte une tentative d'accès avec un rôle invalide
   */
  async reportInvalidRoleViolation(
    userId: string,
    userRole: string,
    endpoint: string,
    userEmail?: string,
    clientIp?: string,
    userAgent?: string
  ): Promise<void> {
    await this.reportSecurityViolation({
      userId,
      userEmail,
      userRole,
      action: 'INVALID_ROLE_ACCESS',
      endpoint,
      attemptedAction: `Tentative d'accès avec un rôle invalide (${userRole})`,
      clientIp,
      userAgent
    });
  }

  /**
   * Rapporte une tentative d'ADMIN d'accéder aux endpoints PRO
   * IMPORTANT: Même l'admin doit être tracé pour détecter un compte compromis
   */
  async reportAdminToProViolation(
    userId: string,
    endpoint: string,
    userEmail?: string,
    clientIp?: string,
    userAgent?: string
  ): Promise<void> {
    await this.reportSecurityViolation({
      userId,
      userEmail,
      userRole: 'ADMIN',
      action: 'ADMIN_ACCESS_PRO_ENDPOINT',
      endpoint,
      attemptedAction: '⚠️ Compte ADMIN accédant aux endpoints PRO (potentiellement compromis)',
      clientIp,
      userAgent
    });
  }

  /**
   * Rapporte une tentative d'ADMIN d'accéder aux endpoints RIDER
   * IMPORTANT: Même l'admin doit être tracé pour détecter un compte compromis
   */
  async reportAdminToRiderViolation(
    userId: string,
    endpoint: string,
    userEmail?: string,
    clientIp?: string,
    userAgent?: string
  ): Promise<void> {
    await this.reportSecurityViolation({
      userId,
      userEmail,
      userRole: 'ADMIN',
      action: 'ADMIN_ACCESS_RIDER_ENDPOINT',
      endpoint,
      attemptedAction: '⚠️ Compte ADMIN accédant aux endpoints RIDER (potentiellement compromis)',
      clientIp,
      userAgent
    });
  }
}

export const securityAlertService = new SecurityAlertService();
