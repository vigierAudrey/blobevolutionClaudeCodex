import { prisma } from '@blobinfini/database';
import bcrypt from 'bcrypt';
import { createHash } from 'crypto';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { sendPasswordResetEmail, sendVerificationEmail } from '../../lib/mailer';
import { secureLogger } from '../../utils/secure-logger';

const ACCESS_TTL = '15m';
const REFRESH_TTL_DAYS = 30; // pour calculer l'expiration effective
const EMAIL_VERIFY_TTL_HOURS = 24;
const MIN_SECRET_LENGTH = 64;

function ensureStrongSecret(key: 'JWT_SECRET' | 'JWT_REFRESH_SECRET') {
  const value = process.env[key];
  if (!value) {
    secureLogger.error('MISSING_SECRET', { key });
    throw new Error(`${key} must be set (see scripts/generate-secrets.sh)`);
  }

  // ✅ CORRIGÉ : En développement, accepter les secrets faibles mais logger un warning
  if (value.length < MIN_SECRET_LENGTH) {
    if (process.env.NODE_ENV === 'production') {
      secureLogger.error('WEAK_SECRET_REJECTED', { key });
      throw new Error(`${key} must be at least ${MIN_SECRET_LENGTH} characters long`);
    } else {
      // En dev, juste un warning (déjà loggé au démarrage via WEAK_SECRETS_DETECTED)
      secureLogger.warn('WEAK_SECRET_ALLOWED_IN_DEV', { key, length: value.length });
    }
  }
  return value;
}

export class AuthService {
  private hashToken(raw: string) {
    return createHash('sha256').update(raw).digest('hex');
  }
  private static readonly CONSENT_VERSION = 'v1.0.0';

  async register(
    data: { email: string; password: string; role: 'RIDER' | 'PRO' | 'ADMIN'; consentAccepted?: boolean },
    opts?: { consentIp?: string },
  ) {
    try {
      const hashed = await bcrypt.hash(data.password, 12);
      const user = await prisma.user.create({
        data: {
          email: data.email,
          password: hashed,
          role: data.role,
          consentedAt: new Date(),
          consentVersion: AuthService.CONSENT_VERSION,
          consentIp: opts?.consentIp,
        },
      });
      // Génère un token de vérification email
      const verification = await this.createEmailVerification(user.id);
      // Envoi d'email (meilleure-effort)
      try {
        await sendVerificationEmail(user.email, verification.token);
      } catch (_) {}
      return {
        message: 'Account created. Please verify your email.',
        userId: user.id,
        // En test uniquement, on expose le token brut pour simplifier les tests
        ...(process.env.NODE_ENV === 'test' ? { verificationToken: verification.token } : {}),
      };
    } catch (error: any) {
      // Gestion des erreurs Prisma
      if (error.code === 'P2002' && error.meta?.target?.includes('email')) {
        throw { code: 'EMAIL_ALREADY_EXISTS', message: 'This email is already registered' };
      }
      throw error;
    }
  }

  async generateTokens(user: any, opts?: { consentAccepted?: boolean; consentIp?: string }) {
    // Exiger la dernière version du consentement pour les comptes existants
    const needsConsent = !user.consentedAt || user.consentVersion !== AuthService.CONSENT_VERSION;
    if (needsConsent) {
      if (opts?.consentAccepted) {
        await prisma.user.update({
          where: { id: user.id },
          data: { consentedAt: new Date(), consentVersion: AuthService.CONSENT_VERSION, consentIp: opts?.consentIp },
        });
      } else {
        throw { code: 'CONSENT_REQUIRED' };
      }
    }

    const accessToken = jwt.sign(
      { sub: user.id, role: user.role },
      ensureStrongSecret('JWT_SECRET'),
      { expiresIn: ACCESS_TTL },
    );

    const refreshPayload = { sub: user.id, jti: crypto.randomUUID() } as const;
    const refreshToken = jwt.sign(refreshPayload, ensureStrongSecret('JWT_REFRESH_SECRET'), {
      expiresIn: `${REFRESH_TTL_DAYS}d`,
    });

    // On stocke le hash du refresh pour permettre l'invalidation ultérieure
    const tokenHash = this.hashToken(refreshToken);
    const expiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);
    await prisma.refreshToken.create({
      data: { userId: user.id, tokenHash, expiresAt },
    });

    return { accessToken, refreshToken };
  }

  async login(email: string, password: string, opts?: { consentAccepted?: boolean; consentIp?: string }) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) throw { code: 'UNAUTHORIZED' };
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) throw { code: 'UNAUTHORIZED' };

    // Optionnel: bloquer la connexion si l'email n'est pas vérifié
    const requireVerified = String(process.env.AUTH_REQUIRE_VERIFIED || 'false').toLowerCase() === 'true';
    if (requireVerified && !user.emailVerified) {
      throw { code: 'EMAIL_NOT_VERIFIED' };
    }

    return this.generateTokens(user, opts);
  }

  async refresh(refreshToken: string) {
    // Vérifier la signature du JWT refresh
    let decoded: any;
    try {
      decoded = jwt.verify(refreshToken, ensureStrongSecret('JWT_REFRESH_SECRET'));
    } catch (e) {
      throw { code: 'UNAUTHORIZED', message: 'Invalid refresh token' };
    }

    const userId = decoded?.sub as string | undefined;
    if (!userId) throw { code: 'UNAUTHORIZED' };

    // Retrouver un token valide en base (non révoqué, non expiré) et match par hash
    const candidates = await prisma.refreshToken.findMany({
      where: {
        userId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    let dbToken: { id: string; tokenHash: string } | null = null;
    const rHash = this.hashToken(refreshToken);
    for (const t of candidates) {
      if (t.tokenHash === rHash) {
        dbToken = { id: t.id, tokenHash: t.tokenHash };
        break;
      }
    }

    if (!dbToken) throw { code: 'UNAUTHORIZED', message: 'Refresh not found' };

    // Rotation de refresh token avec garde anti-réutilisation (update conditionnel)
    const newRefresh = jwt.sign({ sub: userId, jti: crypto.randomUUID() }, ensureStrongSecret('JWT_REFRESH_SECRET'), {
      expiresIn: `${REFRESH_TTL_DAYS}d`,
    });
    const newHash = this.hashToken(newRefresh);
    const newExpiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);

    const now = new Date();
    const result = await prisma.$transaction(async (tx) => {
      // Politique simple et sûre: invalider tous les refresh actifs de l'utilisateur
      // pour empêcher toute réutilisation du token précédent (même en cas de duplication inattendue).
      const { count } = await tx.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now },
      });

      // Si aucun token actif ne correspondait, c'est probablement une réutilisation ou un token invalide
      if (count === 0) {
        return { rotated: false as const };
      }

      await tx.refreshToken.create({
        data: { userId, tokenHash: newHash, expiresAt: newExpiresAt },
      });
      return { rotated: true as const };
    });

    if (!result.rotated) {
      throw { code: 'UNAUTHORIZED', message: 'Refresh already used' };
    }

    // Générer un nouvel access token
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw { code: 'UNAUTHORIZED' };

    const accessToken = jwt.sign({ sub: user.id, role: user.role }, ensureStrongSecret('JWT_SECRET'), {
      expiresIn: ACCESS_TTL,
    });

    return { accessToken, refreshToken: newRefresh };
  }

  async logoutAll(userId: string) {
    await prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { message: 'Logged out from all devices' };
  }

  async logoutSingle(userId: string, refreshToken: string) {
    // Trouver le refresh correspondant à ce token et le révoquer
    const candidates = await prisma.refreshToken.findMany({
      where: {
        userId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
    const rHash2 = this.hashToken(refreshToken);
    for (const t of candidates) {
      if (t.tokenHash === rHash2) {
        await prisma.refreshToken.update({ where: { id: t.id }, data: { revokedAt: new Date() } });
        return { message: 'Logged out from current device' };
      }
    }
    // Rien trouvé → pas d’erreur dure pour éviter info leak
    return { message: 'Logged out' };
  }

  async forgotPassword(email: string) {
    const user = await prisma.user.findUnique({ where: { email } });
    // Toujours répondre pareil pour ne pas divulguer si l'email existe
    const generic = { message: 'If the email exists, a reset link was sent' } as any;
    if (!user) return generic;

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = await bcrypt.hash(rawToken, 10);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1h
    await prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash, expiresAt },
    });

    if (process.env.NODE_ENV === 'test') {
      // En test, renvoyer le token brut pour pouvoir lutiliser dans les tests
      return { ...generic, resetToken: rawToken };
    }
    // Envoi d'email (meilleure-effort)
    try {
      await sendPasswordResetEmail(user.email, rawToken);
    } catch (_) {}
    return generic;
  }

  async resetPassword(token: string, newPassword: string) {
    // Trouver un token non utilisé et non expiré qui correspond au token brut
    const candidates = await prisma.passwordResetToken.findMany({
      where: {
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    let match: (typeof candidates)[number] | undefined;
    for (const t of candidates) {
      const ok = await bcrypt.compare(token, t.tokenHash);
      if (ok) {
        match = t;
        break;
      }
    }
    if (!match) throw { code: 'UNAUTHORIZED', message: 'Invalid or expired token' };

    const hashed = await bcrypt.hash(newPassword, 12);

    await prisma.$transaction([
      prisma.user.update({ where: { id: match.userId }, data: { password: hashed } }),
      prisma.passwordResetToken.update({ where: { id: match.id }, data: { usedAt: new Date() } }),
      // Optionnel: révoquer tous les refresh tokens existants
      prisma.refreshToken.updateMany({
        where: { userId: match.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    return { message: 'Password updated' };
  }

  // Email verification
  async createEmailVerification(userId: string) {
    const raw = crypto.randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(raw);
    const expiresAt = new Date(Date.now() + EMAIL_VERIFY_TTL_HOURS * 60 * 60 * 1000);
    await prisma.emailVerificationToken.create({
      data: { userId, tokenHash, expiresAt },
    });
    // Ici, en production, on enverrait un e-mail contenant `raw`
    return { token: raw, expiresAt };
  }

  async verifyEmail(rawToken: string) {
    const tokenHash = this.hashToken(rawToken);
    const tok = await prisma.emailVerificationToken.findFirst({
      where: { tokenHash, usedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!tok) throw { code: 'UNAUTHORIZED', message: 'Invalid or expired token' };

    await prisma.$transaction([
      prisma.user.update({ where: { id: tok.userId }, data: { emailVerified: true } }),
      prisma.emailVerificationToken.update({ where: { id: tok.id }, data: { usedAt: new Date() } }),
      // Optionnel: invalider autres tokens de vérification existants
      prisma.emailVerificationToken.updateMany({
        where: { userId: tok.userId, id: { not: tok.id }, usedAt: null },
        data: { usedAt: new Date() },
      }),
    ]);

    return { message: 'Email verified' };
  }

  async resendEmailVerification(email: string) {
    const generic = { message: 'If the account exists, a verification email was sent' } as any;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return generic;
    if (user.emailVerified) return generic;

    // Invalider les tokens précédents non utilisés
    await prisma.emailVerificationToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    const res = await this.createEmailVerification(user.id);
    try {
      await sendVerificationEmail(user.email, res.token);
    } catch (_) {}
    if (process.env.NODE_ENV === 'test') {
      return { ...generic, verificationToken: res.token };
    }
    return generic;
  }
}
