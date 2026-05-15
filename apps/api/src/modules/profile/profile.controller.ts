import { Router } from 'express';
import { z } from 'zod';
import { clientPrisma as prisma } from '@blobinfini/database';
import { requireAuth, requireVerifiedEmail } from '../auth/auth.guard';
import { requireRiderRole } from './profile.guard';
import { validate } from '../../middleware/validate';
import {
  ensureBucket, presignPutObject, publicUrlForKey,
  getObjectFirstBytes, deleteObject, __setTestGetObjectMock,
} from '../../lib/s3';
import { registerPendingUpload, claimUploadToken } from '../../lib/upload-token';
import { detectMagicBytes } from '../../lib/magic-bytes';
import { sendAccountDeletionCancelledEmail, sendAccountDeletionEmail } from '../../lib/mailer';
import { lookup as mimeLookup, extension as mimeExtension } from 'mime-types';
import crypto from 'crypto';
import { cacheService, CacheKeys } from '../../services/cache.service';
import { gdprExportService } from '../../services/gdpr-export.service';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { securityAlertService } from '../../services/security-alert.service';
import { secureLogger } from '../../utils/secure-logger';
import { getClientIp } from '../../lib/client-ip';
import { hashIpHmacSafe } from '../../lib/hash-ip';
import {
  assertFranceLaunchLocationInput,
  isFranceLaunchGuardError,
} from '../../lib/france-launch-guard';

export const profileRouter = Router();
profileRouter.use(requireAuth, requireVerifiedEmail);

// Finalize rate limiter : 10 req/5min/userId.
// Justification : un finalize légitime coûte 1 Lua + 1 HeadObject + 1 GetObject.
// Sans limite, un user authentifié peut saturer Redis/MinIO via boucle de finalizations.
// 10/5min = généreux pour les retries légitimes, bloquant pour l'automatisation.
// skip en NODE_ENV=test (sauf ENABLE_RATE_LIMIT_IN_TESTS=true) — cohérent avec le projet.
const finalizeRateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test' && !process.env.ENABLE_RATE_LIMIT_IN_TESTS,
  keyGenerator: (req) => {
    const userId = (req as any).user?.id;
    if (userId) return `finalize:user:${userId}`;
    const ip = getClientIp(req) ?? req.socket?.remoteAddress;
    return ip ? `finalize:ip:${ipKeyGenerator(ip)}` : 'finalize:anonymous';
  },
  handler: (_req, res) => {
    res.status(429).json({ error: 'RATE_LIMIT_EXCEEDED', message: 'Trop de tentatives. Réessayez dans 5 minutes.' });
  },
});

// GDPR Export rate limiter: max 3 exports per hour per user
const exportRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3,
  message: 'Trop de demandes d\'export. Veuillez réessayer dans une heure.',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Rate limit per authenticated user
    const userId = (req as any).user?.id;
    if (userId) {
      return `user:${userId}`;
    }
    const ip = req.ip || req.socket?.remoteAddress;
    return ip ? ipKeyGenerator(ip) : 'anonymous';
  },
});

const sexEnum = z.enum(['FEMALE', 'MALE', 'OTHER', 'UNSPECIFIED']);

const upsertSchema = z.object({
  displayName: z.string().min(1).max(60).optional().or(z.literal('').transform(() => undefined)),
  bio: z.string().max(1000).optional().or(z.literal('').transform(() => undefined)),
  sex: sexEnum.optional(),
  maxDistanceKm: z.number().int().min(1).max(500).optional(),
  emailNotif: z.boolean().optional(),
  // photoUrl ne peut être mis à jour que via POST /profile/photo/finalize.
  // Seul le clear explicite (null) est autorisé ici.
  photoUrl: z.null().optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  // Lesson intent (visible on BloboMap Pro)
  wantsLesson: z.boolean().optional(),
  lessonSport: z.enum(['surf','kitesurf']).nullable().optional().or(z.literal('').transform(() => null)),
  lessonLevel: z.enum(['beginner','intermediate','advanced']).nullable().optional().or(z.literal('').transform(() => null)),
  lessonDate: z.string().nullish().transform(val => (val && val !== '') ? new Date(val) : null),
  lessonPlace: z.string().max(200).nullable().optional().or(z.literal('').transform(() => null)),
  lessonStudentCount: z.number().int().min(1).max(6).nullable().optional(),
  // Coordonnées du lieu demandé — source de vérité pour le pin BloboMap.
  // Doivent être fournies ensemble ou omises ensemble (both-or-none).
  lessonLat: z.number().min(-90).max(90).nullable().optional(),
  lessonLng: z.number().min(-180).max(180).nullable().optional(),
}).superRefine((data, ctx) => {
  // Both-or-none : fournir une seule des deux coordonnées est une erreur de structure.
  // Validé ici (Zod) ET en DB (CHECK constraint) — deux lignes de défense.
  const hasLat = data.lessonLat != null;
  const hasLng = data.lessonLng != null;
  if (hasLat !== hasLng) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'lessonLat et lessonLng doivent être fournis ensemble.',
      path: [hasLat ? 'lessonLng' : 'lessonLat'],
    });
  }
});

const adminUpsertSchema = z.object({
  displayName: z.string().min(1).max(60).optional().or(z.literal('').transform(() => undefined)),
});

profileRouter.get('/me', async (req, res) => { // authz-guard-ok: role-dispatched; PRO→403+securityAlert, ADMIN→AdminProfile, RIDER→RiderProfile
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    // Récupérer le rôle et l'email de l'utilisateur
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, email: true }
    });

    if (!user) return res.status(404).json({ error: 'User not found' });

    // Gérer selon le rôle
    // Block PRO users from accessing RIDER profiles
    if (user.role === 'PRO') {
      // Extract IP and User-Agent for security audit
      const clientIp = getClientIp(req) ?? undefined;
      const userAgent = req.get('user-agent');

      // Report security violation to admin
      await securityAlertService.reportProToRiderViolation(
        userId,
        'GET /profile/me',
        user.email,
        clientIp,
        userAgent
      );

      secureLogger.warn('PROFILE_PRO_ACCESS_RIDER_DENIED', { userId });
      return res.status(403).json({
        error: 'Accès refusé : Les comptes PRO ne peuvent pas accéder aux profils RIDER. Utilisez /pro/me à la place.',
        message: 'Cette tentative d\'accès a été enregistrée et l\'administrateur en a été informé.'
      });
    }

    if (user.role === 'ADMIN') {
      let ap = await prisma.adminProfile.findUnique({ where: { userId } });
      if (!ap) {
        ap = await prisma.adminProfile.create({ data: { userId } });
      }
      return res.json(ap);
    }

    if (user.role === 'RIDER') {
      // Check cache first for rider profile
      const cachedProfile = await cacheService.getProfile(userId);
      if (cachedProfile && cacheService.isAvailable()) {
        if (process.env.NODE_ENV !== 'production') {
          // eslint-disable-next-line no-console
          secureLogger.debug('PROFILE_CACHE_HIT', { userId });
        }
        return res.json(cachedProfile);
      }

      // Comportement existant pour les riders, sécurisé contre les accès concurrents
      // Utiliser upsert pour éviter l'erreur "Unique constraint failed on the fields: (`userId`)"
      const rp = await prisma.riderProfile.upsert({
        where: { userId },
        create: { userId },
        update: {},
      });

      // Cache the profile for future requests
      if (cacheService.isAvailable()) {
        await cacheService.setProfile(userId, rp, 600); // 10 minutes cache
        if (process.env.NODE_ENV !== 'production') {
          // eslint-disable-next-line no-console
          secureLogger.debug('PROFILE_CACHE_SET', { userId });
        }
      }

      return res.json(rp);
    }

    // Invalid role
    secureLogger.warn('PROFILE_INVALID_ROLE_ACCESS_DENIED', { userId });
    return res.status(403).json({
      error: 'Accès refusé : Rôle invalide pour cet endpoint.',
      message: 'Cette tentative d\'accès a été enregistrée et l\'administrateur en a été informé.'
    });
  } catch (err) {
    return res.status(500).json({ error: 'Internal error' });
  }
});

profileRouter.put('/me', validate(upsertSchema), async (req, res) => { // authz-guard-ok: role-dispatched; PRO→403+securityAlert, handles ADMIN and RIDER separately
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    // Log incoming request (dev only)
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      secureLogger.debug('PROFILE_UPDATE_REQUEST', { fields: Object.keys(req.body ?? {}) });
    }

    // Récupérer le rôle et l'email de l'utilisateur
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, email: true }
    });

    if (!user) return res.status(404).json({ error: 'User not found' });

    // Gérer selon le rôle
    // Block PRO users from modifying RIDER profiles
    if (user.role === 'PRO') {
      // Extract IP and User-Agent for security audit
      const clientIp = getClientIp(req) ?? undefined;
      const userAgent = req.get('user-agent');

      // Report security violation to admin
      await securityAlertService.reportProToRiderViolation(
        userId,
        'PUT /profile/me',
        user.email,
        clientIp,
        userAgent
      );

      secureLogger.warn('PROFILE_PRO_MODIFY_RIDER_DENIED', { userId });
      return res.status(403).json({
        error: 'Accès refusé : Les comptes PRO ne peuvent pas modifier les profils RIDER. Utilisez /pro/me à la place.',
        message: 'Cette tentative d\'accès a été enregistrée et l\'administrateur en a été informé.'
      });
    }

    if (user.role === 'ADMIN') {
      const body = adminUpsertSchema.parse(req.body); // already validated but keeping existing parse for transformations
      if (process.env.NODE_ENV !== 'production') {
        // eslint-disable-next-line no-console
        secureLogger.debug('PROFILE_ADMIN_UPDATE_REQUEST', { userId, fields: Object.keys(body) });
      }
      const ap = await prisma.adminProfile.upsert({
        where: { userId },
        create: { userId, ...body },
        update: { ...body },
      });
      if (process.env.NODE_ENV !== 'production') {
        // eslint-disable-next-line no-console
        secureLogger.debug('PROFILE_ADMIN_UPDATED', { userId, profileId: ap.id });
      }
      return res.json(ap);
    }

    if (user.role === 'RIDER') {
      // Comportement existant pour les riders
      // Body is already validated and parsed by the validate middleware.
      // On copie pour éviter toute mutation de req.body (alias non safe).
      const body = { ...req.body };
      if (process.env.NODE_ENV !== 'production') {
        // eslint-disable-next-line no-console
        secureLogger.debug('PROFILE_RIDER_UPDATE_REQUEST', { userId, fields: Object.keys(body ?? {}) });
      }

      // Mode strict : wantsLesson=true sans coordonnées de cours → 400.
      // Règle produit : un rider ne peut pas activer une demande sans localiser
      // son spot. "Juste une ville" dans lessonPlace ne suffit pas — le champ
      // est un label d'affichage, pas une source de coords. Le rider doit
      // capturer sa position GPS via le formulaire.
      if (body.wantsLesson === true && (body.lessonLat == null || body.lessonLng == null)) {
        return res.status(400).json({
          error: 'LESSON_COORDS_REQUIRED',
          message: 'lessonLat et lessonLng sont requis pour activer une demande de cours.',
        });
      }

      // Guard France-only sur les coordonnées de demande de cours.
      // Appliqué avant tout write : coordonnées hors-France → 403.
      if (body.lessonLat != null) {
        assertFranceLaunchLocationInput({ lat: body.lessonLat, lng: body.lessonLng });
      }

      // Quand wantsLesson passe à false, on efface les coords pour éviter
      // des coordonnées orphelines qui réapparaîtraient à la réactivation.
      if (body.wantsLesson === false) {
        body.lessonLat = null;
        body.lessonLng = null;
      }

      const rp = await prisma.riderProfile.upsert({
        where: { userId },
        create: { userId, ...body },
        update: { ...body },
      });

      // Invalidate profile cache after update
      if (cacheService.isAvailable()) {
        await cacheService.del(`profile:${userId}`);
        // Also invalidate related matching cache if location changed
        if (body.lat || body.lng) {
          await cacheService.invalidateMatching();
        }
        if (process.env.NODE_ENV !== 'production') {
          // eslint-disable-next-line no-console
          secureLogger.debug('PROFILE_CACHE_INVALIDATED', {
            userId,
            invalidatedMatching: Boolean(body.lat || body.lng),
          });
        }
      }

      if (process.env.NODE_ENV !== 'production') {
        // eslint-disable-next-line no-console
        secureLogger.debug('PROFILE_RIDER_UPDATED', { userId, profileId: rp.id });
      }
      return res.json(rp);
    }

    // Invalid role
    secureLogger.warn('PROFILE_INVALID_ROLE_MODIFY_DENIED', { userId });
    return res.status(403).json({
      error: 'Accès refusé : Rôle invalide pour cet endpoint.',
      message: 'Cette tentative d\'accès a été enregistrée et l\'administrateur en a été informé.'
    });
  } catch (err: any) {
    // eslint-disable-next-line no-console
    secureLogger.error('PROFILE_UPDATE_ERROR', {
      error: err instanceof Error ? err.message : String(err),
    });
    if (err?.name === 'ZodError') {
      return res.status(400).json({ error: 'Invalid input', details: err.errors });
    }
    if (isFranceLaunchGuardError(err)) {
      return res.status(err.status).json({
        error: err.code,
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
      });
    }
    return res.status(500).json({ error: 'Internal error' });
  }
});

// Disciplines (sport + level) CRUD
const sportEnum = ['surf', 'kitesurf'] as const;
const levelEnum = ['beginner', 'intermediate', 'advanced'] as const;
const disciplineSchema = z.object({ sport: z.enum(sportEnum), level: z.enum(levelEnum) });

profileRouter.get('/disciplines', requireRiderRole, async (req, res) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const rp = await prisma.riderProfile.findUnique({ where: { userId }, select: { id: true } });
    if (!rp) return res.json([]);
    const items = await prisma.riderDiscipline.findMany({ where: { profileId: rp.id }, select: { sport: true, level: true } });
    return res.json(items);
  } catch {
    return res.status(500).json({ error: 'Internal error' });
  }
});

profileRouter.put('/disciplines', requireRiderRole, async (req, res) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const body = z.array(disciplineSchema).max(10).parse(req.body || []);
    let rp = await prisma.riderProfile.findUnique({ where: { userId } });
    if (!rp) rp = await prisma.riderProfile.create({ data: { userId } });

    // Replace strategy: clear then insert unique sports/levels
    await prisma.riderDiscipline.deleteMany({ where: { profileId: rp.id } });
    if (body.length > 0) {
      await prisma.riderDiscipline.createMany({
        data: Array.from(new Map(body.map((b) => [`${b.sport}:${b.level}`, { profileId: rp.id, sport: b.sport, level: b.level }])).values()),
        skipDuplicates: true,
      });
    }
    const after = await prisma.riderDiscipline.findMany({ where: { profileId: rp.id }, select: { sport: true, level: true } });
    return res.json(after);
  } catch (err: any) {
    if (err?.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', details: err.errors });
    return res.status(500).json({ error: 'Internal error' });
  }
});

// Generate a pre-signed URL for direct upload to S3/MinIO
profileRouter.post('/photo/upload-url', validate(z.object({ contentType: z.string().min(1) })), async (req, res) => { // authz-guard-ok: inline role guard; PRO+ADMIN blocked with securityAlert, only RIDER proceeds to S3
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    // Block PRO users from uploading to RIDER photo bucket
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, email: true }
    });

    if (!user) return res.status(404).json({ error: 'User not found' });

    // Extract IP and User-Agent for security audit
    const clientIp = getClientIp(req) ?? undefined;
    const userAgent = req.get('user-agent');

    if (user.role === 'PRO') {
      // Report security violation to admin
      await securityAlertService.reportProToRiderViolation(
        userId,
        'POST /profile/photo/upload-url',
        user.email,
        clientIp,
        userAgent
      );

      secureLogger.warn('PROFILE_PRO_UPLOAD_RIDER_PHOTO_DENIED', { userId });
      return res.status(403).json({
        error: 'Accès refusé : Les comptes PRO ne peuvent pas uploader de photos RIDER. Utilisez /pro/photo/upload-url à la place.',
        message: 'Cette tentative d\'accès a été enregistrée et l\'administrateur en a été informé.'
      });
    }

    if (user.role === 'ADMIN') {
      // ⚠️ CRITICAL: Even ADMIN should trigger alert (potential compromised account)
      await securityAlertService.reportAdminToRiderViolation(
        userId,
        'POST /profile/photo/upload-url',
        user.email,
        clientIp,
        userAgent
      );

      secureLogger.warn('PROFILE_ADMIN_UPLOAD_RIDER_PHOTO_DENIED', { userId });
      return res.status(403).json({
        error: 'Accès refusé : Les comptes ADMIN ne peuvent pas uploader de photos RIDER directement.',
        message: 'Cette tentative d\'accès a été enregistrée et l\'administrateur en a été informé.'
      });
    }

    if (user.role !== 'RIDER') {
      // Report security violation to admin
      await securityAlertService.reportInvalidRoleViolation(
        userId,
        user.role || 'UNKNOWN',
        'POST /profile/photo/upload-url',
        user.email,
        clientIp,
        userAgent
      );

      secureLogger.warn('PROFILE_INVALID_ROLE_UPLOAD_PHOTO_DENIED', { userId, role: user.role });
      return res.status(403).json({
        error: 'Accès refusé : Rôle invalide pour cet endpoint.',
        message: 'Cette tentative d\'accès a été enregistrée et l\'administrateur en a été informé.'
      });
    }

    const schema = z.object({ contentType: z.string().min(1) });
    const { contentType } = schema.parse(req.body);

    // Accept only common image types
    const allowed = new Set(['image/jpeg', 'image/png', 'image/webp']);
    if (!allowed.has(contentType)) return res.status(400).json({ error: 'Unsupported content type' });

    // Debug basic env state for S3
    // eslint-disable-next-line no-console
    secureLogger.debug('PROFILE_UPLOAD_URL_S3_CONFIG', {
      endpoint: process.env.S3_ENDPOINT,
      bucket: process.env.S3_BUCKET,
      hasKey: Boolean(process.env.S3_ACCESS_KEY_ID),
    });
    await ensureBucket();
    const ext = mimeExtension(contentType) || 'bin';
    const key = `users/${userId}/${crypto.randomUUID()}.${ext}`;
    const PRESIGN_TTL = 180;
    const uploadUrl = await presignPutObject(key, contentType, PRESIGN_TTL);
    await registerPendingUpload(key, userId, PRESIGN_TTL);
    // fileUrl non retourné ici — calculé côté serveur après finalize réussi uniquement
    return res.json({ uploadUrl, key });
  } catch (err: any) {
    // eslint-disable-next-line no-console
    secureLogger.error('PROFILE_UPLOAD_URL_ERROR', {
      error: err instanceof Error ? err.message : String(err),
    });
    if (err?.name === 'ZodError') {
      return res.status(400).json({ error: 'Invalid input', details: err.errors });
    }
    return res.status(500).json({ error: 'Internal error' });
  }
});

// Finalize photo upload — valide le contenu réel via magic bytes puis enregistre photoUrl
profileRouter.post('/photo/finalize', finalizeRateLimiter, async (req, res) => { // authz-guard-ok: inline role guard; non-RIDER rejected inside handler via user.role check
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (!user || user.role !== 'RIDER') {
      return res.status(403).json({ error: 'Unauthorized role' });
    }

    const bodySchema = z.object({
      key: z.string().min(1).max(200).regex(
        /^users\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpeg|jpg|png|webp)$/,
        'Invalid key format',
      ),
    });
    let key: string;
    try {
      ({ key } = bodySchema.parse(req.body));
    } catch {
      return res.status(400).json({ error: 'Invalid key format' });
    }

    // Vérification précoce : la clé appartient bien à cet userId
    if (!key.startsWith(`users/${userId}/`)) {
      secureLogger.warn('UPLOAD_FINALIZE_KEY_NOT_OWNED', { userId, keyPrefix: key.slice(0, 50) });
      return res.status(403).json({ error: 'Key does not belong to this user' });
    }

    // Claim atomique Redis — usage unique, anti-TOCTOU
    const claim = await claimUploadToken(key, userId);
    if (claim === 'no_redis') {
      secureLogger.error('UPLOAD_FINALIZE_NO_REDIS', { userId });
      return res.status(503).json({ error: 'Service temporarily unavailable' });
    }
    if (claim === 'not_found') {
      return res.status(410).json({ error: 'Upload token expired or not found' });
    }
    if (claim === 'wrong_user') {
      secureLogger.warn('UPLOAD_FINALIZE_WRONG_USER', { userId });
      return res.status(403).json({ error: 'Unauthorized' });
    }
    if (claim === 'already_used') {
      return res.status(409).json({ error: 'Upload already finalized' });
    }

    // Lecture partielle S3 : 12 premiers octets réels
    const firstBytes = await getObjectFirstBytes(key);
    if (!firstBytes) {
      await deleteObject(key);
      secureLogger.warn('UPLOAD_FINALIZE_OBJECT_MISSING_OR_OVERSIZED', { userId });
      return res.status(422).json({ error: 'Upload not found or exceeds size limit' });
    }

    // Validation magic bytes — jamais le Content-Type déclaré par le client
    const detectedMime = detectMagicBytes(firstBytes);
    if (!detectedMime) {
      await deleteObject(key);
      secureLogger.warn('UPLOAD_FINALIZE_INVALID_CONTENT', {
        userId,
        firstBytesHex: firstBytes.slice(0, 8).toString('hex'),
      });
      return res.status(422).json({ error: 'File content does not match an allowed image format' });
    }

    // URL finale construite côté serveur — jamais fournie par le client
    const photoUrl = publicUrlForKey(key);
    if (!photoUrl) {
      return res.status(500).json({ error: 'Storage configuration error' });
    }

    // Mise à jour DB — photoUrl devient officielle uniquement ici
    await prisma.riderProfile.upsert({
      where: { userId },
      create: { userId, photoUrl },
      update: { photoUrl },
    });

    if (cacheService.isAvailable()) {
      await cacheService.del(`profile:${userId}`);
    }

    secureLogger.info('UPLOAD_FINALIZE_SUCCESS', { userId, detectedMime });
    return res.json({ photoUrl });
  } catch (err: any) {
    secureLogger.error('UPLOAD_FINALIZE_ERROR', {
      error: err instanceof Error ? err.message : String(err),
    });
    return res.status(500).json({ error: 'Internal error' });
  }
});

// GDPR Data Export endpoint (Article 20 - Right to data portability)
profileRouter.get('/export', exportRateLimiter, async (req, res) => { // authz-guard-ok: GDPR Art.20 portability endpoint; any authenticated user exports their own data, role-neutral by design
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    // Extract IP for audit logging
    const ip = getClientIp(req) ?? undefined;

    // Generate export data
    const exportData = await gdprExportService.exportUserData(userId, ip);

    // Set appropriate headers for JSON download
    const filename = `blobinfini-data-export-${new Date().toISOString().split('T')[0]}.json`;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    // Send the data
    return res.json(exportData);
  } catch (err: any) {
    // eslint-disable-next-line no-console
    secureLogger.error('PROFILE_GDPR_EXPORT_ERROR', {
      error: err instanceof Error ? err.message : String(err),
    });
    return res.status(500).json({ error: 'Erreur lors de l\'export de vos données' });
  }
});

// GDPR Account Deletion - Request deletion with 30-day grace period
profileRouter.post('/delete-account', requireRiderRole, async (req, res) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    // Check if account is already marked for deletion
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { deletedAt: true, email: true },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.deletedAt) {
      return res.status(400).json({
        error: 'Account already scheduled for deletion',
        deletedAt: user.deletedAt,
        deletionDate: new Date(user.deletedAt.getTime() + 30 * 24 * 60 * 60 * 1000),
      });
    }

    // Mark account for deletion
    const now = new Date();
    const deletionDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    await prisma.user.update({
      where: { id: userId },
      data: { deletedAt: now },
    });

    // Log the deletion request for audit
    await prisma.auditLog.create({
      data: {
        userId,
        action: 'ACCOUNT_DELETION_REQUESTED',
        resource: 'User',
        metadata: {
          requestedAt: now.toISOString(),
          scheduledDeletionDate: deletionDate.toISOString(),
          email: user.email,
        },
        ip: hashIpHmacSafe(getClientIp(req)),
      },
    });

    await sendAccountDeletionEmail(user.email, deletionDate, 'RIDER');

    return res.json({
      message: 'Demande de suppression enregistrée',
      deletedAt: now,
      deletionDate,
      daysRemaining: 30,
    });
  } catch (err: any) {
    secureLogger.error('PROFILE_ACCOUNT_DELETION_ERROR', {
      error: err instanceof Error ? err.message : String(err),
    });
    return res.status(500).json({ error: 'Erreur lors de la demande de suppression' });
  }
});

// GDPR Account Deletion - Cancel deletion request
profileRouter.post('/cancel-deletion', requireRiderRole, async (req, res) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { deletedAt: true, email: true },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!user.deletedAt) {
      return res.status(400).json({ error: 'No deletion request to cancel' });
    }

    // Check if still within grace period (30 days)
    const now = new Date();
    const daysSinceDeletion = Math.floor((now.getTime() - user.deletedAt.getTime()) / (1000 * 60 * 60 * 24));

    if (daysSinceDeletion >= 30) {
      return res.status(400).json({
        error: 'Grace period expired - account cannot be recovered',
      });
    }

    // Cancel deletion
    await prisma.user.update({
      where: { id: userId },
      data: { deletedAt: null },
    });

    // Log the cancellation
    await prisma.auditLog.create({
      data: {
        userId,
        action: 'ACCOUNT_DELETION_CANCELLED',
        resource: 'User',
        metadata: {
          cancelledAt: now.toISOString(),
          originalDeletionRequest: user.deletedAt.toISOString(),
          daysBeforeCancellation: daysSinceDeletion,
        },
        ip: hashIpHmacSafe(getClientIp(req)),
      },
    });

    await sendAccountDeletionCancelledEmail(user.email, 'RIDER');

    return res.json({
      message: 'Suppression annulée - votre compte est réactivé',
      cancelledAt: now,
    });
  } catch (err: any) {
    secureLogger.error('PROFILE_CANCEL_DELETION_ERROR', {
      error: err instanceof Error ? err.message : String(err),
    });
    return res.status(500).json({ error: 'Erreur lors de l\'annulation' });
  }
});

// GDPR Account Deletion - Check deletion status
profileRouter.get('/deletion-status', requireRiderRole, async (req, res) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { deletedAt: true },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!user.deletedAt) {
      return res.json({ scheduled: false });
    }

    const now = new Date();
    const deletionDate = new Date(user.deletedAt.getTime() + 30 * 24 * 60 * 60 * 1000);
    const daysRemaining = Math.max(0, Math.ceil((deletionDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));

    return res.json({
      scheduled: true,
      deletedAt: user.deletedAt,
      deletionDate,
      daysRemaining,
      canCancel: daysRemaining > 0,
    });
  } catch (err: any) {
    secureLogger.error('PROFILE_DELETION_STATUS_ERROR', {
      error: err instanceof Error ? err.message : String(err),
    });
    return res.status(500).json({ error: 'Erreur lors de la récupération du statut' });
  }
});

// Notification Preferences - Validation schema
const notificationPreferencesSchema = z.object({
  pushEnabled: z.boolean().optional(),
  emailEnabled: z.boolean().optional(),
  notifyMessages: z.boolean().optional(),
  notifyMatches: z.boolean().optional(),
  notifyInvitations: z.boolean().optional(),
  notifyLessonRequests: z.boolean().optional(),
  notifyProMessages: z.boolean().optional(),
  notifyForSurf: z.boolean().optional(),
  notifyForKitesurf: z.boolean().optional(),
  emailDigestFrequency: z.enum(['NEVER', 'DAILY', 'WEEKLY']).optional(),
});

// Get notification preferences (works for both RIDER and PRO)
profileRouter.get('/notifications', async (req, res) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    // Get user role
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get or create notification preferences
    let preferences = await prisma.notificationPreferences.findUnique({
      where: { userId },
    });

    if (!preferences) {
      // Create default preferences
      preferences = await prisma.notificationPreferences.create({
        data: { userId },
      });
    }

    // Filter preferences based on role
    const basePreferences = {
      pushEnabled: preferences.pushEnabled,
      emailEnabled: preferences.emailEnabled,
      emailDigestFrequency: preferences.emailDigestFrequency,
    };

    // RIDER-specific preferences
    const riderPreferences = user.role === 'RIDER' ? {
      notifyMessages: preferences.notifyMessages,
      notifyMatches: preferences.notifyMatches,
      notifyInvitations: preferences.notifyInvitations,
    } : {};

    // PRO-specific preferences
    const proPreferences = user.role === 'PRO' ? {
      notifyLessonRequests: preferences.notifyLessonRequests,
      notifyProMessages: preferences.notifyProMessages,
      notifyForSurf: preferences.notifyForSurf,
      notifyForKitesurf: preferences.notifyForKitesurf,
    } : {};

    return res.json({
      role: user.role,
      preferences: {
        ...basePreferences,
        ...riderPreferences,
        ...proPreferences,
      },
    });
  } catch (err: any) {
    secureLogger.error('PROFILE_GET_NOTIFICATION_PREFERENCES_ERROR', {
      error: err instanceof Error ? err.message : String(err),
    });
    return res.status(500).json({ error: 'Erreur lors de la récupération des préférences' });
  }
});

// Update notification preferences (works for both RIDER and PRO)
profileRouter.put('/notifications', validate(notificationPreferencesSchema), async (req, res) => { // authz-guard-ok: role-agnostic preferences; RIDER+PRO valid, role-based field filtering enforced inside handler
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    // Get user role to filter allowed preferences
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const body = req.body;

    // Filter body based on role to prevent unauthorized preference updates
    const allowedFields: any = {
      // Common fields for all roles
      pushEnabled: body.pushEnabled,
      emailEnabled: body.emailEnabled,
      emailDigestFrequency: body.emailDigestFrequency,
    };

    // RIDER-only fields
    if (user.role === 'RIDER') {
      if (body.notifyMessages !== undefined) allowedFields.notifyMessages = body.notifyMessages;
      if (body.notifyMatches !== undefined) allowedFields.notifyMatches = body.notifyMatches;
      if (body.notifyInvitations !== undefined) allowedFields.notifyInvitations = body.notifyInvitations;
    }

    // PRO-only fields
    if (user.role === 'PRO') {
      if (body.notifyLessonRequests !== undefined) allowedFields.notifyLessonRequests = body.notifyLessonRequests;
      if (body.notifyProMessages !== undefined) allowedFields.notifyProMessages = body.notifyProMessages;
      if (body.notifyForSurf !== undefined) allowedFields.notifyForSurf = body.notifyForSurf;
      if (body.notifyForKitesurf !== undefined) allowedFields.notifyForKitesurf = body.notifyForKitesurf;
    }

    // Upsert preferences with filtered fields
    const preferences = await prisma.notificationPreferences.upsert({
      where: { userId },
      create: { userId, ...allowedFields },
      update: { ...allowedFields },
    });

    // Return only role-appropriate preferences
    const basePreferences = {
      pushEnabled: preferences.pushEnabled,
      emailEnabled: preferences.emailEnabled,
      emailDigestFrequency: preferences.emailDigestFrequency,
    };

    const riderPreferences = user.role === 'RIDER' ? {
      notifyMessages: preferences.notifyMessages,
      notifyMatches: preferences.notifyMatches,
      notifyInvitations: preferences.notifyInvitations,
    } : {};

    const proPreferences = user.role === 'PRO' ? {
      notifyLessonRequests: preferences.notifyLessonRequests,
      notifyProMessages: preferences.notifyProMessages,
      notifyForSurf: preferences.notifyForSurf,
      notifyForKitesurf: preferences.notifyForKitesurf,
    } : {};

    return res.json({
      ok: true,
      preferences: {
        ...basePreferences,
        ...riderPreferences,
        ...proPreferences,
      },
    });
  } catch (err: any) {
    secureLogger.error('PROFILE_UPDATE_NOTIFICATION_PREFERENCES_ERROR', {
      error: err instanceof Error ? err.message : String(err),
    });
    if (err?.name === 'ZodError') {
      return res.status(400).json({ error: 'Invalid input', details: err.errors });
    }
    return res.status(500).json({ error: 'Erreur lors de la mise à jour des préférences' });
  }
});
