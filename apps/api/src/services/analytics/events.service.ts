import crypto from 'crypto';
import {
  clientPrisma as prisma,
  Prisma,
  type AnalyticsActorType,
  type AnalyticsEventType,
  type ConsentLevel,
} from '@blobinfini/database';
import { secureLogger } from '../../utils/secure-logger';
import {
  ANALYTICS_ALLOWED_CONSENT_LEVELS,
  ANALYTICS_ZONE_GRID_DEGREES,
  DEDUPED_EVENT_TYPES,
  PUBLIC_EVENT_TYPES,
} from './definitions';

type ConsentCheckResult = {
  consented: boolean;
  level?: ConsentLevel | null;
};

type PersistEventInput = {
  eventType: AnalyticsEventType;
  actorType: AnalyticsActorType;
  actorHash: string | null;
  consented: boolean;
  contentId?: string | null;
  sport?: string | null;
  zoneLarge?: string | null;
  metadata?: Record<string, unknown> | null;
  occurredAt?: Date | null;
};

type PublicEventInput = {
  eventType: AnalyticsEventType;
  consentHash: string;
  contentId?: string | null;
  metadata?: Record<string, unknown> | null;
  originKey?: string | null;
  userId?: string | null;
  userRole?: string | null;
};

type ServerEventInput = {
  eventType: AnalyticsEventType;
  actorType: AnalyticsActorType;
  actorId: string;
  consentHash?: string | null;
  contentId?: string | null;
  sport?: string | null;
  zoneLarge?: string | null;
  metadata?: Record<string, unknown> | null;
  occurredAt?: Date | null;
};

const ANALYTICS_SALT = process.env.ANALYTICS_HASH_SALT || 'blobinfini-analytics-dev-salt';
const ANON_ORIGIN_WINDOW_MS = Number(process.env.ANALYTICS_ANON_WINDOW_MS || '300000');
const ANON_ORIGIN_MAX = Number(process.env.ANALYTICS_ANON_MAX || '60');

const anonOriginCounters = new Map<string, { count: number; resetAt: number }>();

const isAllowedConsentLevel = (level?: ConsentLevel | null) =>
  Boolean(level && ANALYTICS_ALLOWED_CONSENT_LEVELS.includes(level));

export const hashIdentifier = (value: string) =>
  crypto.createHash('sha256').update(`${value}:${ANALYTICS_SALT}`).digest('hex');

const normalizeConsentHash = (hash: string) => hash.trim().toLowerCase();

export const normalizeDay = (date: Date) => {
  const normalized = new Date(date);
  normalized.setUTCHours(0, 0, 0, 0);
  return normalized;
};

const buildDedupeKey = (input: {
  actorHash: string;
  eventType: AnalyticsEventType;
  day: Date;
  contentId?: string | null;
  sport?: string | null;
  zoneLarge?: string | null;
}) => {
  const dayIso = input.day.toISOString().slice(0, 10);
  return [
    input.actorHash,
    input.eventType,
    dayIso,
    input.contentId ?? 'none',
    input.sport ?? 'none',
    input.zoneLarge ?? 'none',
  ].join('|');
};

const shouldIgnoreAnonOrigin = (originKey?: string | null) => {
  if (!originKey) return false;
  const now = Date.now();
  const entry = anonOriginCounters.get(originKey);
  if (!entry || entry.resetAt <= now) {
    anonOriginCounters.set(originKey, { count: 1, resetAt: now + ANON_ORIGIN_WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > ANON_ORIGIN_MAX;
};

const getConsentStatus = async (consentHash: string): Promise<ConsentCheckResult> => {
  const normalized = normalizeConsentHash(consentHash);
  const record = await prisma.userConsent.findUnique({ where: { userHash: normalized } });
  if (!record) {
    return { consented: false, level: null };
  }
  const allowed = isAllowedConsentLevel(record.consentLevel);
  return { consented: allowed, level: record.consentLevel };
};

export const computeZoneLarge = (lat?: number | null, lng?: number | null) => {
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const grid = ANALYTICS_ZONE_GRID_DEGREES > 0 ? ANALYTICS_ZONE_GRID_DEGREES : 1;
  const bucketLat = Math.floor(lat / grid) * grid;
  const bucketLng = Math.floor(lng / grid) * grid;
  return `Z${bucketLat}:${bucketLng}`;
};

const persistEvent = async (input: PersistEventInput) => {
  const occurredAt = input.occurredAt ?? new Date();
  const day = normalizeDay(occurredAt);
  const actorHash = input.actorHash;
  const shouldDedupe = Boolean(actorHash && DEDUPED_EVENT_TYPES.has(input.eventType));

  if (shouldDedupe) {
    const dedupeKey = buildDedupeKey({
      actorHash: actorHash as string,
      eventType: input.eventType,
      day,
      contentId: input.contentId ?? null,
      sport: input.sport ?? null,
      zoneLarge: input.zoneLarge ?? null,
    });

    const existing = await prisma.analyticsEvent.findUnique({ where: { dedupeKey } });
    if (existing) {
      return { stored: false, deduped: true };
    }

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.analyticsEvent.create({
        data: {
          occurredAt,
          actorType: input.actorType,
          actorHash,
          eventType: input.eventType,
          contentId: input.contentId ?? null,
          sport: input.sport ?? null,
          zoneLarge: input.zoneLarge ?? null,
          metadata: input.metadata ?? null,
          consented: input.consented,
          dedupeKey,
        },
      });

      // Find or create daily aggregate
      // Note: We use findFirst + upsert pattern because Prisma doesn't handle null values well
      // in composite unique constraints where clauses
      const existingAgg = await tx.analyticsDailyAgg.findFirst({
        where: {
          day,
          actorType: input.actorType,
          eventType: input.eventType,
          contentId: input.contentId ?? null,
          sport: input.sport ?? null,
          zoneLarge: input.zoneLarge ?? null,
        },
      });

      if (existingAgg) {
        await tx.analyticsDailyAgg.update({
          where: { id: existingAgg.id },
          data: { count: { increment: 1 }, updatedAt: new Date() },
        });
      } else {
        await tx.analyticsDailyAgg.create({
          data: {
            day,
            actorType: input.actorType,
            eventType: input.eventType,
            contentId: input.contentId ?? null,
            sport: input.sport ?? null,
            zoneLarge: input.zoneLarge ?? null,
            count: 1,
          },
        });
      }
    });

    return { stored: true, deduped: false };
  }

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.analyticsEvent.create({
      data: {
        occurredAt,
        actorType: input.actorType,
        actorHash,
        eventType: input.eventType,
        contentId: input.contentId ?? null,
        sport: input.sport ?? null,
        zoneLarge: input.zoneLarge ?? null,
        metadata: input.metadata ?? null,
        consented: input.consented,
      },
    });

    // Same findFirst + create/update pattern as the deduped branch above —
    // Prisma's compound-unique-key upsert() rejects null components, and
    // contentId/sport/zoneLarge are frequently null here.
    const existingAgg = await tx.analyticsDailyAgg.findFirst({
      where: {
        day,
        actorType: input.actorType,
        eventType: input.eventType,
        contentId: input.contentId ?? null,
        sport: input.sport ?? null,
        zoneLarge: input.zoneLarge ?? null,
      },
    });

    if (existingAgg) {
      await tx.analyticsDailyAgg.update({
        where: { id: existingAgg.id },
        data: { count: { increment: 1 }, updatedAt: new Date() },
      });
    } else {
      await tx.analyticsDailyAgg.create({
        data: {
          day,
          actorType: input.actorType,
          eventType: input.eventType,
          contentId: input.contentId ?? null,
          sport: input.sport ?? null,
          zoneLarge: input.zoneLarge ?? null,
          count: 1,
        },
      });
    }
  });

  return { stored: true, deduped: false };
};

const resolveActorType = (role?: string | null): AnalyticsActorType => {
  if (role === 'PRO') return 'PRO';
  if (role === 'RIDER') return 'RIDER';
  return 'ANON';
};

export const ingestPublicAnalyticsEvent = async (payload: PublicEventInput) => {
  if (!PUBLIC_EVENT_TYPES.includes(payload.eventType)) {
    return { status: 'forbidden' as const, reason: 'event-type' };
  }
  const consentHash = normalizeConsentHash(payload.consentHash);
  const consent = await getConsentStatus(consentHash);
  if (!consent.consented) {
    return { status: 'forbidden' as const, reason: 'consent' };
  }

  const actorType = resolveActorType(payload.userRole ?? null);
  if (actorType === 'ANON' && shouldIgnoreAnonOrigin(payload.originKey)) {
    return { status: 'ignored' as const, reason: 'anon-throttle' };
  }

  const actorHash = payload.userId
    ? hashIdentifier(payload.userId)
    : hashIdentifier(consentHash);

  const result = await persistEvent({
    eventType: payload.eventType,
    actorType,
    actorHash,
    consented: true,
    contentId: payload.contentId ?? null,
    metadata: payload.metadata ?? null,
    occurredAt: new Date(),
  });

  return { status: 'ok' as const, stored: result.stored };
};

export const recordServerAnalyticsEvent = async (payload: ServerEventInput) => {
  try {
    const consentHash = payload.consentHash ? normalizeConsentHash(payload.consentHash) : null;
    if (!consentHash) {
      return { status: 'skipped' as const, reason: 'missing-consent' };
    }

    const consent = await getConsentStatus(consentHash);
    if (!consent.consented) {
      return { status: 'skipped' as const, reason: 'consent' };
    }

    const actorHash = hashIdentifier(payload.actorId);

    await persistEvent({
      eventType: payload.eventType,
      actorType: payload.actorType,
      actorHash,
      consented: true,
      contentId: payload.contentId ?? null,
      sport: payload.sport ?? null,
      zoneLarge: payload.zoneLarge ?? null,
      metadata: payload.metadata ?? null,
      occurredAt: payload.occurredAt ?? new Date(),
    });

    return { status: 'ok' as const };
  } catch (error) {
    secureLogger.error('Analytics event ingestion failed', {
      eventType: payload.eventType,
      actorType: payload.actorType,
      error: error instanceof Error ? error.message : String(error),
    });
    return { status: 'error' as const };
  }
};
