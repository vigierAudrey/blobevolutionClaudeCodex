/* Lightweight mailer wrapper with optional nodemailer.
 * If SMTP env is missing or nodemailer is not installed, emails are skipped gracefully.
 */
import dotenv from 'dotenv';
import { resolve } from 'path';
import { hashEmail } from '../modules/auth/login-attempt.util';

// Ensure env is loaded when used standalone (tests or jobs)
dotenv.config({ path: resolve(process.cwd(), process.env.ENV_FILE || '../../.env') });

type Mail = { to: string; subject: string; text: string; html?: string };

function getSmtpConfig() {
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const secure = String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true';
  const from = process.env.SMTP_FROM || 'no-reply@localhost';

  if (!host) return null;

  // Dev convenience: allow servers without auth (e.g., Mailpit on 1025)
  const allowNoAuth = String(process.env.SMTP_ALLOW_NO_AUTH || '').toLowerCase() === 'true' || port === 1025;

  const base = { host, port, secure, from };
  if (user && pass) return { ...base, auth: { user, pass } };
  if (allowNoAuth) return base; // no auth

  return null; // not configured properly
}

async function getTransport() {
  const cfg = getSmtpConfig();
  if (!cfg) return null;
  try {
    // Lazy import to keep optional
    const mod = await import('nodemailer');
    const nodemailer: any = (mod as any).default ?? mod; // support CJS/ESM
    const transport = nodemailer.createTransport({
      host: (cfg as any).host,
      port: (cfg as any).port,
      secure: (cfg as any).secure,
      // If no auth provided (Mailpit), nodemailer accepts undefined
      auth: (cfg as any).auth,
    });
    return { transport, from: (cfg as any).from };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[mailer] nodemailer not available; emails will be skipped');
    return null;
  }
}

export async function sendMail(mail: Mail) {
  const t = await getTransport();
  const emailHash = hashEmail(mail.to);
  if (!t) {
    // eslint-disable-next-line no-console
    console.info('[mailer] SMTP not configured. Skipping send', { emailHash, subject: mail.subject });
    return { skipped: true } as const;
  }
  try {
    await t.transport.sendMail({ from: t.from, to: mail.to, subject: mail.subject, text: mail.text, html: mail.html });
    return { sent: true } as const;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[mailer] Failed to send mail', { emailHash, error: (e as any)?.message || e });
    return { sent: false } as const;
  }
}

export function buildWebUrl(pathname: string, params?: Record<string, string>) {
  const base = process.env.WEB_BASE_URL || 'http://localhost:3002';
  const url = new URL(pathname.startsWith('/') ? pathname : `/${pathname}`, base);
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  }
  return url.toString();
}

export async function sendVerificationEmail(to: string, token: string) {
  const link = buildWebUrl('/verify', { token });
  const text = `Bienvenue ! Pour vérifier ton email, clique sur ce lien: ${link}`;
  const html = `<p>Bienvenue !</p><p>Pour vérifier ton email, clique sur ce lien:</p><p><a href="${link}">Vérifier mon email</a></p>`;
  return sendMail({ to, subject: 'Vérifie ton email', text, html });
}

export async function sendPasswordResetEmail(to: string, token: string) {
  const link = buildWebUrl('/reset-password', { token });
  const text = `Tu as demandé à réinitialiser ton mot de passe. Clique ici: ${link}`;
  const html = `<p>Tu as demandé à réinitialiser ton mot de passe.</p><p><a href="${link}">Réinitialiser mon mot de passe</a></p>`;
  return sendMail({ to, subject: 'Réinitialisation du mot de passe', text, html });
}

export async function send2FACode(to: string, code: string) {
  const text = `Code de sécurité BlobConnect: ${code}

Ce code expire dans 5 minutes.

Si tu n'as pas demandé ce code, ignore cet email.`;

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #1e40af;">🔒 Code de sécurité</h2>
      <p>Voici ton code de sécurité pour accéder à ton compte BlobConnect :</p>

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
        Équipe BlobConnect
      </p>
    </div>
  `;

  return sendMail({ to, subject: '🔒 Code de sécurité BlobConnect', text, html });
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

Nous avons bien reçu ta demande de suppression de compte BlobConnect.

📅 Date prévue de suppression définitive : ${formattedDate}

Tu disposes de 30 jours pour annuler cette demande. Il te suffit de te connecter à ton espace et de cliquer sur "Annuler la suppression".

Accéder à mon espace : ${profileUrl}

Si tu n'es pas à l'origine de cette demande, contacte immédiatement le support à ${supportEmail}.

À très vite,
L'équipe BlobConnect`;

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #ef4444;">🗑️ Suppression de compte programmée</h2>
      <p>Bonjour,</p>
      <p>Nous avons bien reçu ta demande de suppression de compte BlobConnect.</p>
      <p style="background:#fef2f2; border-left:4px solid #ef4444; padding:12px;">
        <strong>📅 Suppression définitive prévue le :</strong><br>
        <span style="font-size:18px;">${formattedDate}</span>
      </p>
      <p>Tu disposes de <strong>30 jours</strong> pour annuler cette demande. Pour revenir en arrière :</p>
      <ol>
        <li>Connecte-toi à ton espace BlobConnect.</li>
        <li>Ouvre la section <em>Confidentialité & Données</em>.</li>
        <li>Clique sur <strong>« Annuler la suppression »</strong>.</li>
      </ol>
      <p style="margin:20px 0;">
        <a href="${profileUrl}" style="display:inline-block;padding:12px 24px;background:#1e40af;color:#fff;text-decoration:none;border-radius:6px;">Accéder à mon espace</a>
      </p>
      <p>Si tu n'es pas à l'origine de cette demande, contacte immédiatement le support : <a href="mailto:${supportEmail}">${supportEmail}</a>.</p>
      <p style="color:#6b7280;">À très vite,<br>L'équipe BlobConnect</p>
    </div>
  `;

  return { to, subject, text, html };
}

export async function sendAccountDeletionEmail(to: string, deletionDate: Date, role: string | null | undefined, supportEmail = 'support@blobinfini.com') {
  const mail = buildAccountDeletionEmail(to, deletionDate, role, supportEmail);
  return sendMail(mail);
}

export function buildAccountDeletionCancellationEmail(to: string, role: string | null | undefined, supportEmail = 'support@blobinfini.com'): Mail {
  const profileUrl = resolveProfileUrl(role);
  const subject = '✅ Suppression de compte annulée';
  const text = `Bonne nouvelle !

La suppression de ton compte BlobConnect a été annulée.

Tu conserves l'ensemble de tes données et de tes conversations.

Accéder à mon espace : ${profileUrl}

Si tu n'es pas à l'origine de cette action, pense à modifier ton mot de passe et à activer la double authentification.

L'équipe BlobConnect`;

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #16a34a;">✅ Suppression de compte annulée</h2>
      <p>Bonne nouvelle ! La suppression de ton compte BlobConnect vient d'être annulée.</p>
      <p>Tu conserves l'ensemble de tes données, conversations et préférences.</p>
      <p style="margin:20px 0;">
        <a href="${profileUrl}" style="display:inline-block;padding:12px 24px;background:#1e40af;color:#fff;text-decoration:none;border-radius:6px;">Accéder à mon espace</a>
      </p>
      <p>Si tu n'es pas à l'origine de cette action, nous te recommandons de modifier ton mot de passe et d'activer la double authentification.</p>
      <p style="color:#6b7280;">À bientôt sur BlobConnect !</p>
    </div>
  `;

  return { to, subject, text, html };
}

export async function sendAccountDeletionCancelledEmail(to: string, role: string | null | undefined, supportEmail = 'support@blobinfini.com') {
  const mail = buildAccountDeletionCancellationEmail(to, role, supportEmail);
  return sendMail(mail);
}
