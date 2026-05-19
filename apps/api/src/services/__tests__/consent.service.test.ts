import { clientPrisma as prisma } from '@blobinfini/database';
import type { ConsentLevel, ConsentSignal } from '@blobinfini/database';
import {
  __clearConsentCache,
  createOrUpdateConsent,
  getConsent,
  purgeOldConsents,
  getConsentCacheSize,
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

  describe('sanitizeHash — invalid inputs rejected without DB access', () => {
    it('rejects a single character hash', async () => {
      await expect(getConsent('a')).rejects.toThrow('Invalid user hash');
    });

    it('rejects an empty string', async () => {
      await expect(getConsent('')).rejects.toThrow('Invalid user hash');
    });

    it('rejects a 63-char hex string (too short)', async () => {
      await expect(
        getConsent('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcde'),
      ).rejects.toThrow('Invalid user hash');
    });

    it('rejects a 65-char hex string (too long)', async () => {
      await expect(
        getConsent('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0'),
      ).rejects.toThrow('Invalid user hash');
    });

    it('rejects uppercase hex (strict lowercase policy)', async () => {
      await expect(
        getConsent('0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF'),
      ).rejects.toThrow('Invalid user hash');
    });

    it('rejects a hash with non-hex characters', async () => {
      await expect(
        getConsent('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdeg'),
      ).rejects.toThrow('Invalid user hash');
    });

    it('does not populate the cache on invalid input', async () => {
      const sizeBefore = getConsentCacheSize();
      await expect(getConsent('bad')).rejects.toThrow();
      expect(getConsentCacheSize()).toBe(sizeBefore);
    });

    it('accepts a valid lowercase 64-char hex hash and returns null when absent from DB', async () => {
      const result = await getConsent(HEX_HASH);
      expect(result).toBeNull();
    });

    it('accepts a valid lowercase 64-char hex hash and returns the record when present', async () => {
      await createOrUpdateConsent(buildPayload('none'));
      const result = await getConsent(HEX_HASH);
      expect(result).not.toBeNull();
      expect(result?.userHash).toBe(HEX_HASH);
    });
  });
});
