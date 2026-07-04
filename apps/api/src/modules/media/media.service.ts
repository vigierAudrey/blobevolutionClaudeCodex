import { clientPrisma as prisma } from '@blobinfini/database';

/**
 * Decide whether `requesterId` may retrieve the profile photo of `targetUserId`.
 *
 * Default-deny: only an authenticated, email-verified RIDER (guards on the
 * router) may retrieve a rider photo — their own or another rider's. The
 * photo is a mandatory onboarding step whose purpose is to be shown on the
 * matching cards, the match modal and conversations ("Visible dans le
 * matching"), so rider→rider visibility is the product contract.
 * PRO and ADMIN remain denied (unchanged behaviour).
 */
export async function canViewUserPhoto(
  requesterId: string,
  targetUserId: string,
): Promise<boolean> {
  void targetUserId; // authorization depends on the requester's role only

  const user = await prisma.user.findUnique({
    where: { id: requesterId },
    select: { role: true },
  });

  return user?.role === 'RIDER';
}
