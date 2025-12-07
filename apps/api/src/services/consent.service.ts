import crypto from 'crypto';
import { clientPrisma as prisma } from '@blobinfini/database';
import type { ConsentLevel, ConsentSignal, UserConsent } from '@blobinfini/database';

const CONSENT_TTL_MONTHS = 13;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

type CachedConsent = {
  value: UserConsent | null;
  expiresAt: number;
};

const consentCache = new Map<string, CachedConsent>();

export type ConsentPayload = {
  userHash: string;
  consentLevel: ConsentLevel;
  ad_storage: ConsentSignal;
  ad_user_data: ConsentSignal;
  ad_personalization: ConsentSignal;
  cmpVersion?: string | null;
};

const HEX_SHA256_REGEX = /^[a-f0-9]{64}$/i;

const sanitizeHash = (input: string) => {
  const trimmed = (input || '').trim();
  if (!trimmed) {
    throw new Error('Invalid user hash');
  }
  if (HEX_SHA256_REGEX.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  return crypto.createHash('sha256').update(trimmed).digest('hex');
};

const getCachedConsent = (hash: string): UserConsent | null | undefined => {
  const cached = consentCache.get(hash);
  if (!cached) return undefined;
  if (cached.expiresAt < Date.now()) {
    consentCache.delete(hash);
    return undefined;
  }
  return cached.value;
};

const setCachedConsent = (hash: string, value: UserConsent | null) => {
  consentCache.set(hash, {
    value,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
};

const clearConsentCache = () => consentCache.clear();

export async function purgeOldConsents(now: Date = new Date()): Promise<number> {
  const threshold = new Date(now);
  threshold.setMonth(threshold.getMonth() - CONSENT_TTL_MONTHS);

  const result = await prisma.userConsent.deleteMany({
    where: {
      updatedAt: { lt: threshold },
    },
  });

  if (result.count > 0) {
    clearConsentCache();
  }

  return result.count;
}

export async function getConsent(userHash: string) {
  const normalizedHash = sanitizeHash(userHash);
  const cached = getCachedConsent(normalizedHash);
  if (cached !== undefined) {
    return cached;
  }

  const consent = await prisma.userConsent.findUnique({
    where: { userHash: normalizedHash },
  });

  setCachedConsent(normalizedHash, consent);
  return consent;
}

export async function createOrUpdateConsent(payload: ConsentPayload) {
  const normalizedHash = sanitizeHash(payload.userHash);

  const existing = await prisma.userConsent.findUnique({
    where: { userHash: normalizedHash },
  });

  const data = {
    userHash: normalizedHash,
    consentLevel: payload.consentLevel,
    ad_storage: payload.ad_storage,
    ad_user_data: payload.ad_user_data,
    ad_personalization: payload.ad_personalization,
    cmpVersion: payload.cmpVersion ?? null,
  };

  if (
    existing &&
    existing.consentLevel === data.consentLevel &&
    existing.ad_storage === data.ad_storage &&
    existing.ad_user_data === data.ad_user_data &&
    existing.ad_personalization === data.ad_personalization &&
   existing.cmpVersion === data.cmpVersion
  ) {
    setCachedConsent(normalizedHash, existing);
    return existing;
  }

  const record = await prisma.userConsent.upsert({
    where: { userHash: normalizedHash },
    create: data,
    update: data,
  });

  setCachedConsent(normalizedHash, record);
  return record;
}

export function __clearConsentCache() {
  clearConsentCache();
}
