/* Lightweight mailer wrapper with optional nodemailer.
 * If SMTP env is missing or nodemailer is not installed, emails are skipped gracefully.
 */
import dotenv from 'dotenv';
import { resolve } from 'path';

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
  if (!t) {
    // eslint-disable-next-line no-console
    console.info('[mailer] SMTP not configured. Skipping send to %s with subject "%s"', mail.to, mail.subject);
    return { skipped: true } as const;
  }
  try {
    await t.transport.sendMail({ from: t.from, to: mail.to, subject: mail.subject, text: mail.text, html: mail.html });
    return { sent: true } as const;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[mailer] Failed to send mail to %s: %s', mail.to, (e as any)?.message || e);
    return { sent: false } as const;
  }
}

export function buildWebUrl(pathname: string, params?: Record<string, string>) {
  const base = process.env.WEB_BASE_URL || 'http://localhost:3001';
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
  const text = `Code de sécurité Blobinfini: ${code}

Ce code expire dans 5 minutes.

Si tu n'as pas demandé ce code, ignore cet email.`;

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #1e40af;">🔒 Code de sécurité</h2>
      <p>Voici ton code de sécurité pour accéder à ton compte Blobinfini :</p>

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
        Équipe Blobinfini
      </p>
    </div>
  `;

  return sendMail({ to, subject: '🔒 Code de sécurité Blobinfini', text, html });
}
