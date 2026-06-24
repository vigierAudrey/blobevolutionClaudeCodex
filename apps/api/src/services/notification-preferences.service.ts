import { clientPrisma as prisma } from '@blobinfini/database';
import { secureLogger } from '../utils/secure-logger';
import type { NotificationType } from './notification.service';

/**
 * Central notification gating.
 *
 * Model = N+M (channel masters × per-event toggles), NOT N×M.
 * A send is allowed IFF:
 *   - the channel master switch is on (inAppEnabled / pushEnabled), AND
 *   - the per-event toggle for that NotificationType is on (resolved by role).
 *
 * Every in-app and push send goes through {@link shouldNotifyUser} so that no
 * toggle exposed in the UI is decorative. EMAIL is intentionally NOT gated here:
 * the only non-transactional email today is the PRO lesson-request email, gated
 * by ProProfile.emailNotif at fan-out time (see lesson-notification.service.ts).
 * Transactional/security emails (verification, reset, 2FA, deletion, admin
 * alerts) are never governed by preferences.
 */
export type NotificationChannel = 'IN_APP' | 'PUSH';

type Role = 'RIDER' | 'PRO' | 'ADMIN';

// Per-event preference field, resolved by recipient role.
// `null` field => no per-event gate for that role (channel master only).
function preferenceFieldFor(type: NotificationType, role: Role): NotifyField | null {
  switch (type) {
    case 'NEW_MESSAGE':
      return role === 'PRO' ? 'notifyProMessages' : 'notifyMessages';
    case 'NEW_MATCH':
      return 'notifyMatches';
    case 'GROUP_INVITATION':
      return 'notifyInvitations';
    case 'LESSON_REQUEST_NEARBY':
      return 'notifyLessonRequests';
    case 'SYSTEM':
      // System/account-critical alerts are not opt-out-able per event.
      return null;
    default:
      return null;
  }
}

type NotifyField =
  | 'notifyMessages'
  | 'notifyMatches'
  | 'notifyInvitations'
  | 'notifyProMessages'
  | 'notifyLessonRequests';

const PREF_SELECT = {
  inAppEnabled: true,
  pushEnabled: true,
  notifyMessages: true,
  notifyMatches: true,
  notifyInvitations: true,
  notifyProMessages: true,
  notifyLessonRequests: true,
} as const;

/**
 * Returns true if a notification of `type` may be delivered to `userId` on `channel`.
 *
 * Failure policy is per-channel (a preference lookup that throws must not become a
 * vector for unwanted outbound delivery):
 *   - IN_APP  => fail-OPEN. An in-app bell entry is low-risk and only visible
 *                inside the app; losing one on an infra hiccup is worse than
 *                showing one the user muted.
 *   - PUSH    => fail-CLOSED. Push leaves the app (device/browser) and is the
 *                channel a user is most likely to have deliberately muted; on
 *                error we suppress rather than risk an unwanted device alert.
 * Security/transactional emails never reach this resolver. Non-transactional
 * email (pro lesson-request) is gated by ProProfile.emailNotif at fan-out and is
 * naturally fail-closed (a failed query sends nothing).
 *
 * Absent preferences row => schema defaults (all channels + events on).
 */
export async function shouldNotifyUser(
  userId: string,
  type: NotificationType,
  channel: NotificationChannel,
): Promise<boolean> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, notificationPreferences: { select: PREF_SELECT } },
    });

    if (!user) return false;
    const prefs = user.notificationPreferences;

    // No prefs row yet => schema defaults: everything on.
    if (!prefs) return true;

    // 1) Channel master switch.
    const channelOn = channel === 'PUSH' ? prefs.pushEnabled : prefs.inAppEnabled;
    if (!channelOn) return false;

    // 2) Per-event toggle (role-resolved).
    const field = preferenceFieldFor(type, user.role as Role);
    if (field === null) return true; // e.g. SYSTEM
    return prefs[field] !== false;
  } catch (error) {
    secureLogger.warn('NOTIFICATION_PREF_LOOKUP_FAILED', {
      type,
      channel,
      error: error instanceof Error ? error.message : String(error),
    });
    // Per-channel failure policy: IN_APP fails open, PUSH fails closed.
    return channel === 'IN_APP';
  }
}
