/* Lightweight mailer wrapper with optional nodemailer.
 * Local/dev/pre-VPS may skip email delivery gracefully.
 * VPS runtime must fail loud on SMTP misconfiguration or missing transport.
 */
import dotenv from 'dotenv';
import { createRequire } from 'module';
import { resolve } from 'path';
import { hashEmail } from '../modules/auth/login-attempt.util';
import { recordEmailSendFailure, recordEmailSendSuccess } from './email-metrics';
import { secureLogger } from '../utils/secure-logger';

// Ensure env is loaded when used standalone (tests or jobs)
dotenv.config({ path: resolve(process.cwd(), process.env.ENV_FILE || '../../.env') });
const requireModule = createRequire(__filename);

const BREVO_SMTP_HOST = 'smtp-relay.brevo.com';
const SMTP_CONNECTION_TIMEOUT_MS = 3000;
const SMTP_GREETING_TIMEOUT_MS = 3000;
const SMTP_SOCKET_TIMEOUT_MS = 5000;
const SMTP_VERIFY_TIMEOUT_MS = 3000;

export type MailType =
  | 'email_verification'
  | 'email_verification_resend'
  | 'password_reset'
  | 'password_changed'
  | 'two_factor_code'
  | 'account_deletion'
  | 'account_deletion_cancelled'
  | 'security_alert'
  | 'system_alert'
  | 'new_lesson_request';

type Mail = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  type: MailType;
};

type MailProvider = 'brevo' | 'smtp';

type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  from: string;
  auth?: {
    user: string;
    pass: string;
  };
};

const isStrictEmailDeliveryEnv = () =>
  process.env.NODE_ENV === 'production' && process.env.APP_ENV === 'vps';

function resolveMailProvider(host?: string): MailProvider {
  return String(host ?? '').trim().toLowerCase() === BREVO_SMTP_HOST ? 'brevo' : 'smtp';
}

function getSmtpConfig(): SmtpConfig | null {
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const secure = String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true';
  const from = process.env.SMTP_FROM || 'no-reply@localhost';

  if (!host) return null;

  // Dev/pre-VPS only: explicit opt-in for unauthenticated SMTP targets such as Mailpit.
  const allowNoAuth = String(process.env.SMTP_ALLOW_NO_AUTH || '').toLowerCase() === 'true';

  const base = { host, port, secure, from };
  if (user && pass) return { ...base, auth: { user, pass } };
  if (allowNoAuth) return base; // no auth

  return null; // not configured properly
}

function buildTransportOptions(cfg: SmtpConfig) {
  return {
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: cfg.auth,
    connectionTimeout: SMTP_CONNECTION_TIMEOUT_MS,
    greetingTimeout: SMTP_GREETING_TIMEOUT_MS,
    socketTimeout: SMTP_SOCKET_TIMEOUT_MS,
    ...(isStrictEmailDeliveryEnv()
      ? {
          requireTLS: true,
          tls: {
            servername: cfg.host,
            rejectUnauthorized: true,
            minVersion: 'TLSv1.2',
          },
        }
      : {}),
  };
}

async function getTransport() {
  const cfg = getSmtpConfig();
  if (!cfg) {
    if (isStrictEmailDeliveryEnv()) {
      throw new Error('SMTP configuration is invalid for VPS runtime');
    }
    return null;
  }
  try {
    const mod = requireModule('nodemailer');
    const nodemailer: any = (mod as any).default ?? mod; // support CJS/ESM
    const transport = nodemailer.createTransport(buildTransportOptions(cfg));
    return { transport, from: cfg.from, provider: resolveMailProvider(cfg.host) };
  } catch (e) {
    if (isStrictEmailDeliveryEnv()) {
      throw e;
    }
    secureLogger.warn('MAILER_PACKAGE_UNAVAILABLE');
    return null;
  }
}

function isTimeoutError(error: unknown): boolean {
  const code = String((error as any)?.code ?? '');
  const command = String((error as any)?.command ?? '');
  return code === 'ETIMEDOUT' || code === 'ESOCKET' || command === 'CONN';
}

function extractSmtpCode(error: unknown): number | undefined {
  const raw = (error as any)?.responseCode ?? (error as any)?.statusCode;
  return typeof raw === 'number' ? raw : undefined;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutHandle: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(Object.assign(new Error(label), { code: 'ETIMEDOUT' })), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  });
}

export class MailDeliveryError extends Error {
  readonly smtpCode?: number;
  readonly latencyMs: number;
  readonly provider: MailProvider;
  readonly type: MailType;
  readonly timedOut: boolean;

  constructor(args: {
    type: MailType;
    provider: MailProvider;
    latencyMs: number;
    smtpCode?: number;
    timedOut: boolean;
    cause?: unknown;
  }) {
    super('Email delivery unavailable');
    this.name = 'MailDeliveryError';
    this.smtpCode = args.smtpCode;
    this.latencyMs = args.latencyMs;
    this.provider = args.provider;
    this.type = args.type;
    this.timedOut = args.timedOut;
    Object.defineProperty(this, 'internalCause', {
      value: args.cause,
      enumerable: false,
      configurable: false,
      writable: false,
    });
  }
}

function buildMailDeliveryError(args: {
  type: MailType;
  provider: MailProvider;
  latencyMs: number;
  cause: unknown;
}) {
  return new MailDeliveryError({
    type: args.type,
    provider: args.provider,
    latencyMs: args.latencyMs,
    smtpCode: extractSmtpCode(args.cause),
    timedOut: isTimeoutError(args.cause),
    cause: args.cause,
  });
}

function logMailDeliveryError(error: MailDeliveryError, emailHash: string) {
  const event = error.timedOut ? 'EMAIL_SEND_TIMEOUT' : 'EMAIL_SEND_FAILED';
  secureLogger.error(event, {
    emailHash,
    type: error.type,
    provider: error.provider,
    latencyMs: error.latencyMs,
    ...(typeof error.smtpCode === 'number' ? { smtpCode: error.smtpCode } : {}),
  });
}

export async function sendMail(mail: Mail) {
  const emailHash = hashEmail(mail.to);
  const startedAt = Date.now();
  let t: Awaited<ReturnType<typeof getTransport>>;
  try {
    t = await getTransport();
  } catch (error) {
    const deliveryError = buildMailDeliveryError({
      type: mail.type,
      provider: resolveMailProvider(process.env.SMTP_HOST),
      latencyMs: Date.now() - startedAt,
      cause: error,
    });
    recordEmailSendFailure(mail.type, deliveryError.latencyMs, deliveryError.timedOut);
    logMailDeliveryError(deliveryError, emailHash);
    throw deliveryError;
  }
  if (!t) {
    secureLogger.info('MAILER_SEND_SKIPPED', {
      emailHash,
      type: mail.type,
      provider: resolveMailProvider(process.env.SMTP_HOST),
    });
    return { skipped: true } as const;
  }
  try {
    await t.transport.sendMail({ from: t.from, to: mail.to, subject: mail.subject, text: mail.text, html: mail.html });
    const latencyMs = Date.now() - startedAt;
    recordEmailSendSuccess(mail.type, latencyMs);
    secureLogger.info('EMAIL_SEND_SUCCESS', {
      emailHash,
      type: mail.type,
      provider: t.provider,
      latencyMs,
    });
    return { sent: true, provider: t.provider, latencyMs } as const;
  } catch (error) {
    const deliveryError = buildMailDeliveryError({
      type: mail.type,
      provider: t.provider,
      latencyMs: Date.now() - startedAt,
      cause: error,
    });
    recordEmailSendFailure(mail.type, deliveryError.latencyMs, deliveryError.timedOut);
    logMailDeliveryError(deliveryError, emailHash);
    throw deliveryError;
  }
}

export async function verifySmtpConnection(): Promise<boolean> {
  const transportBundle = await getTransport();
  if (!transportBundle) {
    return false;
  }
  await withTimeout(
    Promise.resolve(transportBundle.transport.verify()),
    SMTP_VERIFY_TIMEOUT_MS,
    'SMTP verify timeout',
  );
  return true;
}

function buildWebUrl(pathname: string, params?: Record<string, string>) {
  const base = process.env.WEB_BASE_URL || 'http://localhost:3002';
  const url = new URL(pathname.startsWith('/') ? pathname : `/${pathname}`, base);
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  }
  return url.toString();
}

export async function sendVerificationEmail(
  to: string,
  token: string,
  type: Extract<MailType, 'email_verification' | 'email_verification_resend'> = 'email_verification',
) {
  const link = buildWebUrl('/verify', { token });
  const text = `Bienvenue ! Pour vérifier ton email, clique sur ce lien: ${link}`;
  const html = `<p>Bienvenue !</p><p>Pour vérifier ton email, clique sur ce lien:</p><p><a href="${link}">Vérifier mon email</a></p>`;
  return sendMail({ to, subject: 'Vérifie ton email', text, html, type });
}

export async function sendPasswordResetEmail(to: string, token: string) {
  const link = buildWebUrl('/reset-password', { token });
  const text = `Tu as demandé à réinitialiser ton mot de passe. Clique ici: ${link}`;
  const html = `<p>Tu as demandé à réinitialiser ton mot de passe.</p><p><a href="${link}">Réinitialiser mon mot de passe</a></p>`;
  return sendMail({ to, subject: 'Réinitialisation du mot de passe', text, html, type: 'password_reset' });
}

export async function sendPasswordChangedEmail(to: string) {
  const text = `Votre mot de passe Blob a été modifié.

Si vous n'êtes pas à l'origine de cette action, contactez immédiatement le support à support@blobinfini.com.

L'équipe Blob`;
  const html = `<p>Votre mot de passe Blob a été modifié.</p><p>Si vous n'êtes pas à l'origine de cette action, contactez immédiatement le support : <a href="mailto:support@blobinfini.com">support@blobinfini.com</a>.</p><p style="color:#6b7280;">L'équipe Blob</p>`;
  return sendMail({ to, subject: 'Votre mot de passe Blob a été modifié', text, html, type: 'password_changed' });
}

export async function send2FACode(to: string, code: string) {
  const text = `Code de sécurité Blob: ${code}

Ce code expire dans 5 minutes.

Si tu n'as pas demandé ce code, ignore cet email.`;

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #1e40af;">🔒 Code de sécurité</h2>
      <p>Voici ton code de sécurité pour accéder à ton compte Blob :</p>

      <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; text-align: center; margin: 20px 0;">
        <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #1e40af;">${code}</span>
      </div>

      <p style="color: #6b7280; font-size: 14px;">
        ⏱️ Ce code expire dans <strong>5 minutes</strong><br>
        🔐 Ne le partage avec personne
      </p>

      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">

      <p style="color: #9ca3af; font-size: 12px;">
        Si tu n'as pas demandé ce code, ignore cet email.<br>
        Équipe Blob
      </p>
    </div>
  `;

  return sendMail({ to, subject: '🔒 Code de sécurité Blob', text, html, type: 'two_factor_code' });
}

function formatDeletionDate(date: Date) {
  return date.toISOString().split('T')[0];
}

function resolveProfileUrl(role: string | null | undefined) {
  if (role === 'PRO') return buildWebUrl('/pro/profile');
  if (role === 'ADMIN') return buildWebUrl('/admin');
  return buildWebUrl('/profile');
}

export function buildAccountDeletionEmail(to: string, deletionDate: Date, role: string | null | undefined, supportEmail = 'support@blobinfini.com'): Mail {
  const formattedDate = formatDeletionDate(deletionDate);
  const profileUrl = resolveProfileUrl(role);
  const subject = '🗑️ Suppression de compte programmée';
  const text = `Bonjour,

Nous avons bien reçu ta demande de suppression de compte Blob.

📅 Date prévue de suppression définitive : ${formattedDate}

Tu disposes de 30 jours pour annuler cette demande. Il te suffit de te connecter à ton espace et de cliquer sur "Annuler la suppression".

Accéder à mon espace : ${profileUrl}

Si tu n'es pas à l'origine de cette demande, contacte immédiatement le support à ${supportEmail}.

À très vite,
L'équipe Blob`;

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #ef4444;">🗑️ Suppression de compte programmée</h2>
      <p>Bonjour,</p>
      <p>Nous avons bien reçu ta demande de suppression de compte Blob.</p>
      <p style="background:#fef2f2; border-left:4px solid #ef4444; padding:12px;">
        <strong>📅 Suppression définitive prévue le :</strong><br>
        <span style="font-size:18px;">${formattedDate}</span>
      </p>
      <p>Tu disposes de <strong>30 jours</strong> pour annuler cette demande. Pour revenir en arrière :</p>
      <ol>
        <li>Connecte-toi à ton espace Blob.</li>
        <li>Ouvre la section <em>Confidentialité & Données</em>.</li>
        <li>Clique sur <strong>« Annuler la suppression »</strong>.</li>
      </ol>
      <p style="margin:20px 0;">
        <a href="${profileUrl}" style="display:inline-block;padding:12px 24px;background:#1e40af;color:#fff;text-decoration:none;border-radius:6px;">Accéder à mon espace</a>
      </p>
      <p>Si tu n'es pas à l'origine de cette demande, contacte immédiatement le support : <a href="mailto:${supportEmail}">${supportEmail}</a>.</p>
      <p style="color:#6b7280;">À très vite,<br>L'équipe Blob</p>
    </div>
  `;

  return { to, subject, text, html, type: 'account_deletion' };
}

export async function sendAccountDeletionEmail(to: string, deletionDate: Date, role: string | null | undefined, supportEmail = 'support@blobinfini.com') {
  const mail = buildAccountDeletionEmail(to, deletionDate, role, supportEmail);
  return sendMail(mail);
}

export function buildAccountDeletionCancellationEmail(to: string, role: string | null | undefined, supportEmail = 'support@blobinfini.com'): Mail {
  const profileUrl = resolveProfileUrl(role);
  const subject = '✅ Suppression de compte annulée';
  const text = `Bonne nouvelle !

La suppression de ton compte Blob a été annulée.

Tu conserves l'ensemble de tes données et de tes conversations.

Accéder à mon espace : ${profileUrl}

Si tu n'es pas à l'origine de cette action, pense à modifier ton mot de passe et à activer la double authentification.

L'équipe Blob`;

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #16a34a;">✅ Suppression de compte annulée</h2>
      <p>Bonne nouvelle ! La suppression de ton compte Blob vient d'être annulée.</p>
      <p>Tu conserves l'ensemble de tes données, conversations et préférences.</p>
      <p style="margin:20px 0;">
        <a href="${profileUrl}" style="display:inline-block;padding:12px 24px;background:#1e40af;color:#fff;text-decoration:none;border-radius:6px;">Accéder à mon espace</a>
      </p>
      <p>Si tu n'es pas à l'origine de cette action, nous te recommandons de modifier ton mot de passe et d'activer la double authentification.</p>
      <p style="color:#6b7280;">À bientôt sur Blob !</p>
    </div>
  `;

  return { to, subject, text, html, type: 'account_deletion_cancelled' };
}

export async function sendAccountDeletionCancelledEmail(to: string, role: string | null | undefined, supportEmail = 'support@blobinfini.com') {
  const mail = buildAccountDeletionCancellationEmail(to, role, supportEmail);
  return sendMail(mail);
}

export type LessonRequestMailParams = {
  /** Adresse email du professionnel destinataire — jamais exposée au rider. */
  proEmail: string;
  /** Sport de la demande : 'surf' | 'kitesurf' | null (générique). */
  sport: string | null;
};

export function buildNewLessonRequestEmail(params: LessonRequestMailParams): Mail {
  const { proEmail, sport } = params;
  const sportLabel = sport === 'surf' ? 'surf' : sport === 'kitesurf' ? 'kitesurf' : 'cours';
  const proUrl = buildWebUrl('/pro/dashboard');

  const subject = 'Nouvelle demande sur Blob';
  const text = `Bonjour,

Un rider vient de vous envoyer une nouvelle demande sur Blob.
Sport : ${sportLabel}

Consultez votre espace pro pour répondre.

${proUrl}

À bientôt,
Blob`;

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #d97706;">🏄 Nouvelle demande sur Blob</h2>
      <p>Bonjour,</p>
      <p>Un rider vient de vous envoyer une nouvelle demande sur Blob.</p>
      <table style="background:#fef3c7;border-left:4px solid #f59e0b;padding:12px;border-radius:4px;margin:16px 0;width:100%;">
        <tr><td><strong>Sport :</strong> ${sportLabel}</td></tr>
      </table>
      <p>Consultez votre espace pro pour répondre rapidement.</p>
      <p style="margin:24px 0;">
        <a href="${proUrl}" style="display:inline-block;padding:12px 24px;background:#d97706;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold;">Voir la demande</a>
      </p>
      <p style="color:#6b7280;font-size:13px;">
        Cet email vous a été envoyé car vous avez activé les alertes email dans votre espace pro.<br>
        Vous pouvez désactiver ces notifications dans vos préférences.
      </p>
      <p style="color:#6b7280;">À bientôt,<br>L'équipe Blob</p>
    </div>
  `;

  return { to: proEmail, subject, text, html, type: 'new_lesson_request' };
}

export async function sendNewLessonRequestEmailToPro(params: LessonRequestMailParams) {
  const mail = buildNewLessonRequestEmail(params);
  return sendMail(mail);
}
