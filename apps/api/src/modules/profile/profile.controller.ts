import { Router } from 'express';
import { z } from 'zod';
import { clientPrisma as prisma } from '@blobinfini/database';
import { requireAuth, requireVerifiedEmail } from '../auth/auth.guard';
import { validate } from '../../middleware/validate';
import { ensureBucket, presignPutObject, publicUrlForKey } from '../../lib/s3';
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

export const profileRouter = Router();
profileRouter.use(requireAuth, requireVerifiedEmail);

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
  photoUrl: z.string().url().nullable().optional().refine(
    (val) => {
      if (!val) return true;
      const base = process.env.S3_PUBLIC_URL_BASE || '';
      return base ? val.startsWith(base) : true;
    },
    { message: 'photoUrl must point to the configured storage domain' }
  ),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  // Lesson intent (visible on BloboMap Pro)
  wantsLesson: z.boolean().optional(),
  lessonSport: z.enum(['surf','kitesurf']).nullable().optional().or(z.literal('').transform(() => null)),
  lessonLevel: z.enum(['beginner','intermediate','advanced']).nullable().optional().or(z.literal('').transform(() => null)),
  lessonDate: z.string().nullish().transform(val => (val && val !== '') ? new Date(val) : null),
  lessonPlace: z.string().max(200).nullable().optional().or(z.literal('').transform(() => null)),
  lessonStudentCount: z.number().int().min(1).max(6).nullable().optional(),
});

const adminUpsertSchema = z.object({
  displayName: z.string().min(1).max(60).optional().or(z.literal('').transform(() => undefined)),
});

profileRouter.get('/me', async (req, res) => {
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

profileRouter.put('/me', validate(upsertSchema), async (req, res) => {
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
      // Body is already validated and parsed by the validate middleware
      const body = req.body;
      if (process.env.NODE_ENV !== 'production') {
        // eslint-disable-next-line no-console
        secureLogger.debug('PROFILE_RIDER_UPDATE_REQUEST', { userId, fields: Object.keys(body ?? {}) });
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
    return res.status(500).json({ error: 'Internal error' });
  }
});

// Disciplines (sport + level) CRUD
const sportEnum = ['surf', 'kitesurf'] as const;
const levelEnum = ['beginner', 'intermediate', 'advanced'] as const;
const disciplineSchema = z.object({ sport: z.enum(sportEnum), level: z.enum(levelEnum) });

profileRouter.get('/disciplines', async (req, res) => {
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

profileRouter.put('/disciplines', async (req, res) => {
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
profileRouter.post('/photo/upload-url', validate(z.object({ contentType: z.string().min(1) })), async (req, res) => {
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
    const uploadUrl = await presignPutObject(key, contentType, 900);
    const fileUrl = publicUrlForKey(key);

    return res.json({ uploadUrl, key, fileUrl });
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

// GDPR Data Export endpoint (Article 20 - Right to data portability)
profileRouter.get('/export', exportRateLimiter, async (req, res) => {
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
profileRouter.post('/delete-account', async (req, res) => {
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
profileRouter.post('/cancel-deletion', async (req, res) => {
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
profileRouter.get('/deletion-status', async (req, res) => {
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
  notifyBookingAccepted: z.boolean().optional(),
  notifyBookingRejected: z.boolean().optional(),
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
      notifyBookingAccepted: preferences.notifyBookingAccepted,
      notifyBookingRejected: preferences.notifyBookingRejected,
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
profileRouter.put('/notifications', validate(notificationPreferencesSchema), async (req, res) => {
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
      if (body.notifyBookingAccepted !== undefined) allowedFields.notifyBookingAccepted = body.notifyBookingAccepted;
      if (body.notifyBookingRejected !== undefined) allowedFields.notifyBookingRejected = body.notifyBookingRejected;
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
      notifyBookingAccepted: preferences.notifyBookingAccepted,
      notifyBookingRejected: preferences.notifyBookingRejected,
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
