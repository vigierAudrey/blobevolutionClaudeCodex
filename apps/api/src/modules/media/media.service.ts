import { clientPrisma as prisma } from '@blobinfini/database';

/**
 * Decide whether `requesterId` may retrieve the profile photo of `targetUserId`.
 *
 * Default-deny: only a RIDER user may access their own photo.
 * No DB query is made when the IDs differ — the short-circuit prevents
 * any existence-based side-channel for the target.
 */
export async function canViewUserPhoto(
  requesterId: string,
  targetUserId: string,
): Promise<boolean> {
  if (requesterId !== targetUserId) return false;

  const user = await prisma.user.findUnique({
    where: { id: requesterId },
    select: { role: true },
  });

  return user?.role === 'RIDER';
}
