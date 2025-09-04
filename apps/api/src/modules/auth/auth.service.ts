import { prisma } from '@blobinfini/database';
import bcrypt from 'bcrypt';
import { createHash } from 'crypto';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

const ACCESS_TTL = '15m';
const REFRESH_TTL_DAYS = 30; // pour calculer l'expiration effective

export class AuthService {
  private hashToken(raw: string) {
    return createHash('sha256').update(raw).digest('hex');
  }
  async register(data: { email: string; password: string; role: 'RIDER' | 'PRO' }) {
    const hashed = await bcrypt.hash(data.password, 12);
    const user = await prisma.user.create({
      data: { email: data.email, password: hashed, role: data.role },
    });
    // TODO: envoyer email de vérification (stub)
    return { message: 'Account created. Please verify your email.', userId: user.id };
  }

  async login(email: string, password: string) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) throw { code: 'UNAUTHORIZED' };
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) throw { code: 'UNAUTHORIZED' };

    const accessToken = jwt.sign(
      { sub: user.id, role: user.role },
      process.env.JWT_SECRET as string,
      { expiresIn: ACCESS_TTL },
    );

    const refreshPayload = { sub: user.id, jti: crypto.randomUUID() } as const;
    const refreshToken = jwt.sign(refreshPayload, process.env.JWT_REFRESH_SECRET as string, {
      expiresIn: `${REFRESH_TTL_DAYS}d`,
    });

    // On stocke le hash du refresh pour permettre l’invalidation ultérieure
    const tokenHash = this.hashToken(refreshToken);
    const expiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);
    await prisma.refreshToken.create({
      data: { userId: user.id, tokenHash, expiresAt },
    });

    return { accessToken, refreshToken };
  }

  async refresh(refreshToken: string) {
    // Vérifier la signature du JWT refresh
    let decoded: any;
    try {
      decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET as string);
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
    const newRefresh = jwt.sign(
      { sub: userId, jti: crypto.randomUUID() },
      process.env.JWT_REFRESH_SECRET as string,
      {
        expiresIn: `${REFRESH_TTL_DAYS}d`,
      },
    );
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

    const accessToken = jwt.sign(
      { sub: user.id, role: user.role },
      process.env.JWT_SECRET as string,
      { expiresIn: ACCESS_TTL },
    );

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
    // En prod, on enverrait un e-mail ici
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
}
