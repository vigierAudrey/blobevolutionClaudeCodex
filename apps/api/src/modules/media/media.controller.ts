import { Router } from 'express';
import { z } from 'zod';
import { clientPrisma as prisma } from '@blobinfini/database';
import { requireAuth, requireVerifiedEmail } from '../auth/auth.guard';
import { getObjectBuffer, storageKeyFromPublicUrl } from '../../lib/s3';
import { detectMagicBytes } from '../../lib/magic-bytes';
import { secureLogger } from '../../utils/secure-logger';
import { canViewUserPhoto } from './media.service';

export const mediaRouter = Router();

mediaRouter.use(requireAuth, requireVerifiedEmail);

const userIdSchema = z.string().uuid();
const riderPhotoKeyPattern =
  /^users\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpeg|jpg|png|webp)$/;

mediaRouter.get('/users/:userId/photo', async (req, res) => {
  try {
    const parsedUserId = userIdSchema.safeParse(req.params.userId);
    if (!parsedUserId.success) {
      return res.status(404).json({ error: 'Not found' });
    }

    const targetUserId = parsedUserId.data;
    const requesterId = (req as any).user?.id as string | undefined;
    if (!requesterId) return res.status(401).json({ error: 'Unauthorized' });

    const authorized = await canViewUserPhoto(requesterId, targetUserId);
    if (!authorized) {
      secureLogger.warn('PRIVATE_USER_MEDIA_FORBIDDEN');
      return res.status(403).json({ error: 'Forbidden' });
    }

    const profile = await prisma.riderProfile.findUnique({
      where: { userId: targetUserId },
      select: { photoUrl: true },
    });

    if (!profile?.photoUrl) {
      return res.status(404).json({ error: 'Not found' });
    }

    const key = storageKeyFromPublicUrl(profile.photoUrl);
    if (!key) {
      secureLogger.warn('PRIVATE_USER_MEDIA_INVALID_KEY');
      return res.status(404).json({ error: 'Not found' });
    }
    const match = key.match(riderPhotoKeyPattern);
    if (!match || match[1] !== targetUserId || !key.startsWith(`users/${targetUserId}/`)) {
      secureLogger.warn('PRIVATE_USER_MEDIA_INVALID_KEY');
      return res.status(404).json({ error: 'Not found' });
    }

    const object = await getObjectBuffer(key);
    if (!object) {
      return res.status(404).json({ error: 'Not found' });
    }

    const detectedMime = detectMagicBytes(object.slice(0, 12));
    if (!detectedMime) {
      secureLogger.warn('PRIVATE_USER_MEDIA_INVALID_CONTENT');
      return res.status(404).json({ error: 'Not found' });
    }

    res.setHeader('Content-Type', detectedMime);
    res.setHeader('Content-Length', object.length);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.status(200).send(object);
  } catch (err) {
    secureLogger.error('PRIVATE_USER_MEDIA_ERROR', {
      error: err instanceof Error ? err.message : String(err),
    });
    return res.status(500).json({ error: 'Internal error' });
  }
});
