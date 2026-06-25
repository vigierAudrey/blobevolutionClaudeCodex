import { describe, it, expect, beforeEach, afterAll, jest } from '@jest/globals';
import { clientPrisma as prisma } from '@blobinfini/database';
import bcrypt from 'bcryptjs';
import { shouldNotifyUser } from '../notification-preferences.service';

/**
 * Integration tests for the central notification gate.
 * Model = channel master (inAppEnabled / pushEnabled) AND per-event toggle,
 * resolved by recipient role. Every UI toggle must have a real effect here.
 */

const EMAIL_SUFFIX = '@notifpref.test.local';

async function makeUser(
  id: string,
  role: 'RIDER' | 'PRO',
  prefs?: Record<string, unknown> | null,
): Promise<void> {
  await prisma.user.create({
    data: {
      id,
      email: `${id}${EMAIL_SUFFIX}`,
      password: await bcrypt.hash('test-password', 12),
      role,
      consentedAt: new Date(),
      consentVersion: 'v1.0.0',
      ...(prefs === null
        ? {}
        : { notificationPreferences: { create: { ...prefs } } }),
    },
  });
}

describe('shouldNotifyUser', () => {
  beforeEach(async () => {
    await prisma.user.deleteMany({ where: { email: { endsWith: EMAIL_SUFFIX } } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { endsWith: EMAIL_SUFFIX } } });
    await prisma.$disconnect();
  });

  it('allows everything when no preferences row exists (schema defaults)', async () => {
    await makeUser('np-defaults', 'RIDER', null);
    expect(await shouldNotifyUser('np-defaults', 'NEW_MESSAGE', 'IN_APP')).toBe(true);
    expect(await shouldNotifyUser('np-defaults', 'NEW_MESSAGE', 'PUSH')).toBe(true);
    expect(await shouldNotifyUser('np-defaults', 'NEW_MATCH', 'PUSH')).toBe(true);
  });

  it('returns false for an unknown user', async () => {
    expect(await shouldNotifyUser('does-not-exist', 'NEW_MESSAGE', 'PUSH')).toBe(false);
  });

  // --- Channel master switches ---------------------------------------------
  it('pushEnabled=false blocks PUSH but not IN_APP', async () => {
    await makeUser('np-push-off', 'RIDER', { pushEnabled: false });
    expect(await shouldNotifyUser('np-push-off', 'NEW_MESSAGE', 'PUSH')).toBe(false);
    expect(await shouldNotifyUser('np-push-off', 'NEW_MESSAGE', 'IN_APP')).toBe(true);
  });

  it('inAppEnabled=false blocks IN_APP but not PUSH', async () => {
    await makeUser('np-inapp-off', 'RIDER', { inAppEnabled: false });
    expect(await shouldNotifyUser('np-inapp-off', 'NEW_MESSAGE', 'IN_APP')).toBe(false);
    expect(await shouldNotifyUser('np-inapp-off', 'NEW_MESSAGE', 'PUSH')).toBe(true);
  });

  // --- Rider per-event toggles ---------------------------------------------
  it('rider notifyMessages=false blocks message notifications on both channels', async () => {
    await makeUser('np-r-msg', 'RIDER', { notifyMessages: false });
    expect(await shouldNotifyUser('np-r-msg', 'NEW_MESSAGE', 'IN_APP')).toBe(false);
    expect(await shouldNotifyUser('np-r-msg', 'NEW_MESSAGE', 'PUSH')).toBe(false);
    // unrelated event still allowed
    expect(await shouldNotifyUser('np-r-msg', 'NEW_MATCH', 'PUSH')).toBe(true);
  });

  it('rider notifyMatches=false blocks matches only', async () => {
    await makeUser('np-r-match', 'RIDER', { notifyMatches: false });
    expect(await shouldNotifyUser('np-r-match', 'NEW_MATCH', 'PUSH')).toBe(false);
    expect(await shouldNotifyUser('np-r-match', 'NEW_MESSAGE', 'PUSH')).toBe(true);
  });

  it('rider notifyInvitations=false blocks group invitations only', async () => {
    await makeUser('np-r-inv', 'RIDER', { notifyInvitations: false });
    expect(await shouldNotifyUser('np-r-inv', 'GROUP_INVITATION', 'IN_APP')).toBe(false);
    expect(await shouldNotifyUser('np-r-inv', 'NEW_MESSAGE', 'IN_APP')).toBe(true);
  });

  // --- Role resolution: NEW_MESSAGE maps to a different field for PRO -------
  it('pro message gating uses notifyProMessages, not notifyMessages', async () => {
    // notifyMessages=false (rider field) must NOT affect a PRO recipient.
    await makeUser('np-pro-msg-a', 'PRO', { notifyMessages: false, notifyProMessages: true });
    expect(await shouldNotifyUser('np-pro-msg-a', 'NEW_MESSAGE', 'PUSH')).toBe(true);

    await makeUser('np-pro-msg-b', 'PRO', { notifyProMessages: false });
    expect(await shouldNotifyUser('np-pro-msg-b', 'NEW_MESSAGE', 'PUSH')).toBe(false);
  });

  it('pro notifyLessonRequests=false blocks lesson-request notifications', async () => {
    await makeUser('np-pro-lesson', 'PRO', { notifyLessonRequests: false });
    expect(await shouldNotifyUser('np-pro-lesson', 'LESSON_REQUEST_NEARBY', 'IN_APP')).toBe(false);
  });

  // --- SYSTEM is never opt-out-able per event ------------------------------
  it('SYSTEM notifications ignore per-event toggles but respect channel master', async () => {
    await makeUser('np-sys', 'RIDER', { notifyMessages: false });
    expect(await shouldNotifyUser('np-sys', 'SYSTEM', 'IN_APP')).toBe(true);

    await makeUser('np-sys-off', 'RIDER', { inAppEnabled: false });
    expect(await shouldNotifyUser('np-sys-off', 'SYSTEM', 'IN_APP')).toBe(false);
  });

  // --- Per-channel failure policy ------------------------------------------
  it('on lookup failure, every channel fails closed', async () => {
    const spy = jest
      .spyOn(prisma.user, 'findUnique')
      .mockRejectedValueOnce(new Error('db down'))
      .mockRejectedValueOnce(new Error('db down'));
    try {
      expect(await shouldNotifyUser('whatever', 'NEW_MESSAGE', 'IN_APP')).toBe(false);
      expect(await shouldNotifyUser('whatever', 'NEW_MESSAGE', 'PUSH')).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });
});
