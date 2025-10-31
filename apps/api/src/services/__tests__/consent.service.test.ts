import { prisma } from '@blobinfini/database';
import type { ConsentLevel, ConsentSignal } from '@prisma/client';
import {
  __clearConsentCache,
  createOrUpdateConsent,
  getConsent,
  purgeOldConsents,
} from '../consent.service';

const HEX_HASH = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const toSignal = (value: ConsentSignal) => value;

const buildPayload = (mode: ConsentLevel) => ({
  userHash: HEX_HASH,
  consentLevel: mode,
  ad_storage: toSignal(mode === 'personalized' ? 'granted' : mode === 'npa' ? 'granted' : 'denied'),
  ad_user_data: toSignal(mode === 'personalized' ? 'granted' : 'denied'),
  ad_personalization: toSignal(mode === 'personalized' ? 'granted' : 'denied'),
  cmpVersion: 'jest-suite',
});

describe('consent.service', () => {
  beforeEach(async () => {
    await prisma.userConsent.deleteMany();
    __clearConsentCache();
  });

  afterAll(async () => {
    await prisma.userConsent.deleteMany();
    await prisma.$disconnect();
  });

  it('creates a consent record and updates it without duplicating', async () => {
    const created = await createOrUpdateConsent(buildPayload('personalized'));

    const updated = await createOrUpdateConsent({
      ...buildPayload('personalized'),
      cmpVersion: 'jest-suite-v2',
    });

    expect(updated.id).toBe(created.id);
    expect(updated.cmpVersion).toBe('jest-suite-v2');

    const total = await prisma.userConsent.count();
    expect(total).toBe(1);

    const fetched = await getConsent(HEX_HASH);
    expect(fetched?.id).toBe(created.id);
  });

  it('purges records older than 13 months', async () => {
    await createOrUpdateConsent(buildPayload('npa'));

    const threshold = new Date();
    threshold.setMonth(threshold.getMonth() - 14);

    await prisma.userConsent.update({
      where: { userHash: HEX_HASH },
      data: { updatedAt: threshold },
    });

    const purged = await purgeOldConsents(new Date());
    expect(purged).toBeGreaterThanOrEqual(1);

    const remaining = await getConsent(HEX_HASH);
    expect(remaining).toBeNull();
  });
});
