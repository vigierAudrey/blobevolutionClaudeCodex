import { clientPrisma as prisma, type AnalyticsActorType, type AnalyticsEventType } from '@blobinfini/database';
import {
  ANALYTICS_DEFINITIONS,
  type AnalyticsPeriod,
  PERIOD_TO_DAYS,
  PRIVACY_THRESHOLD,
  PRO_ACTIVITY_EVENTS,
  RIDER_ACTIVITY_EVENTS,
} from './definitions';
import { computeZoneLarge, hashIdentifier, normalizeDay } from './events.service';
import { loadPublishedBlobosphereArticles } from '../blobosphere-content.service';

const ACTIVITY_EVENTS_BY_ROLE: Record<'RIDER' | 'PRO', readonly AnalyticsEventType[]> = {
  RIDER: RIDER_ACTIVITY_EVENTS,
  PRO: PRO_ACTIVITY_EVENTS,
};

const toDayKey = (date: Date) => normalizeDay(date).toISOString().slice(0, 10);

const buildDayRange = (start: Date, end: Date) => {
  const days: string[] = [];
  const cursor = normalizeDay(start);
  const last = normalizeDay(end);
  while (cursor <= last) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
};

const getPeriodStart = (period: AnalyticsPeriod, now = new Date()) => {
  const days = PERIOD_TO_DAYS[period] ?? 30;
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
};

const computePercentile = (values: number[], percentile: number) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((percentile / 100) * sorted.length) - 1));
  return sorted[index];
};

const computeRetention = async (role: 'RIDER' | 'PRO', period: AnalyticsPeriod) => {
  const now = new Date();
  const startDate = getPeriodStart(period, now);
  const users = await prisma.user.findMany({
    where: {
      role,
      deletedAt: null,
      createdAt: { gte: startDate, lte: now },
    },
    select: { id: true, createdAt: true },
  });

  const cohortSize = users.length;
  if (cohortSize === 0) {
    return {
      cohortSize: 0,
      day1: { eligible: 0, retained: null, rate: null, masked: true },
      day7: { eligible: 0, retained: null, rate: null, masked: true },
      day30: { eligible: 0, retained: null, rate: null, masked: true },
    };
  }

  const hashes = users.map((user) => ({
    id: user.id,
    createdAt: user.createdAt,
    hash: hashIdentifier(user.id),
  }));

  const events = await prisma.analyticsEvent.findMany({
    where: {
      actorHash: { in: hashes.map((entry) => entry.hash) },
      actorType: role as AnalyticsActorType,
      eventType: { in: ACTIVITY_EVENTS_BY_ROLE[role] },
      occurredAt: { gte: startDate, lte: now },
      consented: true,
    },
    select: { actorHash: true, occurredAt: true },
  });

  const activityDays = new Map<string, Set<string>>();
  for (const event of events) {
    if (!event.actorHash) continue;
    const day = toDayKey(event.occurredAt);
    const set = activityDays.get(event.actorHash) ?? new Set<string>();
    set.add(day);
    activityDays.set(event.actorHash, set);
  }

  const computeOffset = (offsetDays: number) => {
    const cutoff = new Date(now.getTime() - offsetDays * 24 * 60 * 60 * 1000);
    const eligible = hashes.filter((entry) => entry.createdAt <= cutoff);
    const eligibleCount = eligible.length;
    const retainedCount = eligible.reduce((count, entry) => {
      const day = normalizeDay(entry.createdAt);
      day.setUTCDate(day.getUTCDate() + offsetDays);
      const key = day.toISOString().slice(0, 10);
      return activityDays.get(entry.hash)?.has(key) ? count + 1 : count;
    }, 0);

    if (eligibleCount < PRIVACY_THRESHOLD) {
      return { eligible: eligibleCount, retained: null, rate: null, masked: true };
    }

    return {
      eligible: eligibleCount,
      retained: retainedCount,
      rate: eligibleCount > 0 ? (retainedCount / eligibleCount) * 100 : 0,
      masked: false,
    };
  };

  return {
    cohortSize,
    day1: computeOffset(1),
    day7: computeOffset(7),
    day30: computeOffset(30),
  };
};

const computeStickiness = async (period: AnalyticsPeriod) => {
  const now = new Date();
  const startDate = getPeriodStart(period, now);
  const days = buildDayRange(startDate, now);

  const events = await prisma.analyticsEvent.findMany({
    where: {
      actorType: { in: ['RIDER', 'PRO'] },
      eventType: { in: [...RIDER_ACTIVITY_EVENTS, ...PRO_ACTIVITY_EVENTS] },
      occurredAt: { gte: startDate, lte: now },
      consented: true,
    },
    select: { actorHash: true, actorType: true, occurredAt: true },
  });

  const perDay = new Map<string, { total: Set<string>; riders: Set<string>; pros: Set<string> }>();
  const mau = {
    total: new Set<string>(),
    riders: new Set<string>(),
    pros: new Set<string>(),
  };

  for (const event of events) {
    if (!event.actorHash) continue;
    const day = toDayKey(event.occurredAt);
    const bucket = perDay.get(day) ?? {
      total: new Set<string>(),
      riders: new Set<string>(),
      pros: new Set<string>(),
    };
    bucket.total.add(event.actorHash);
    if (event.actorType === 'RIDER') bucket.riders.add(event.actorHash);
    if (event.actorType === 'PRO') bucket.pros.add(event.actorHash);
    perDay.set(day, bucket);

    mau.total.add(event.actorHash);
    if (event.actorType === 'RIDER') mau.riders.add(event.actorHash);
    if (event.actorType === 'PRO') mau.pros.add(event.actorHash);
  }

  const totals = {
    total: 0,
    riders: 0,
    pros: 0,
  };

  const timeline = days.map((day) => {
    const bucket = perDay.get(day);
    const total = bucket?.total.size ?? 0;
    const riders = bucket?.riders.size ?? 0;
    const pros = bucket?.pros.size ?? 0;
    totals.total += total;
    totals.riders += riders;
    totals.pros += pros;
    return { day, total, riders, pros };
  });

  const avg = {
    total: days.length > 0 ? totals.total / days.length : 0,
    riders: days.length > 0 ? totals.riders / days.length : 0,
    pros: days.length > 0 ? totals.pros / days.length : 0,
  };

  const stickiness = {
    total: mau.total.size > 0 ? (avg.total / mau.total.size) * 100 : 0,
    riders: mau.riders.size > 0 ? (avg.riders / mau.riders.size) * 100 : 0,
    pros: mau.pros.size > 0 ? (avg.pros / mau.pros.size) * 100 : 0,
  };

  return {
    dauAverage: {
      total: avg.total,
      riders: avg.riders,
      pros: avg.pros,
    },
    mau: {
      total: mau.total.size,
      riders: mau.riders.size,
      pros: mau.pros.size,
    },
    stickiness,
    timeline,
  };
};

const computeTtfvRiders = async (period: AnalyticsPeriod) => {
  const now = new Date();
  const startDate = getPeriodStart(period, now);
  const riders = await prisma.user.findMany({
    where: { role: 'RIDER', deletedAt: null, createdAt: { gte: startDate, lte: now } },
    select: { id: true, createdAt: true },
  });

  if (riders.length === 0) {
    return { sampleSize: 0, medianMinutes: null, p90Minutes: null, masked: true };
  }

  const riderIds = riders.map((r) => r.id);

  const bookingRequests = await prisma.bookingRequest.groupBy({
    by: ['riderUserId'],
    where: { riderUserId: { in: riderIds } },
    _min: { createdAt: true },
  });

  const messages = await prisma.message.groupBy({
    by: ['senderId'],
    where: { senderId: { in: riderIds } },
    _min: { createdAt: true },
  });

  const decisions = await prisma.matchDecision.groupBy({
    by: ['actorUserId'],
    where: { actorUserId: { in: riderIds }, decision: 'ACCEPT' },
    _min: { createdAt: true },
  });

  const bookingMap = new Map(bookingRequests.map((row) => [row.riderUserId, row._min?.createdAt]));
  const messageMap = new Map(messages.map((row) => [row.senderId, row._min?.createdAt]));
  const decisionMap = new Map(decisions.map((row) => [row.actorUserId, row._min?.createdAt]));

  const durations: number[] = [];
  for (const rider of riders) {
    const first = [bookingMap.get(rider.id), messageMap.get(rider.id), decisionMap.get(rider.id)]
      .filter((value): value is Date => value instanceof Date)
      .filter((value) => value >= rider.createdAt)
      .sort((a, b) => a.getTime() - b.getTime())[0];
    if (!first) continue;
    durations.push((first.getTime() - rider.createdAt.getTime()) / (60 * 1000));
  }

  if (durations.length < PRIVACY_THRESHOLD) {
    return { sampleSize: durations.length, medianMinutes: null, p90Minutes: null, masked: true };
  }

  return {
    sampleSize: durations.length,
    medianMinutes: computePercentile(durations, 50),
    p90Minutes: computePercentile(durations, 90),
    masked: false,
  };
};

const computeTtfvPros = async (period: AnalyticsPeriod) => {
  const now = new Date();
  const startDate = getPeriodStart(period, now);
  const pros = await prisma.proProfile.findMany({
    where: {
      verified: true,
      verifiedAt: { not: null, gte: startDate, lte: now },
      user: { deletedAt: null },
    },
    select: { userId: true, verifiedAt: true },
  });

  if (pros.length === 0) {
    return { sampleSize: 0, medianMinutes: null, p90Minutes: null, masked: true };
  }

  const proIds = pros.map((p) => p.userId);

  const requests = await prisma.bookingRequest.findMany({
    where: {
      availability: { proUserId: { in: proIds } },
    },
    select: {
      createdAt: true,
      availability: { select: { proUserId: true } },
    },
  });

  const requestMap = new Map<string, Date>();
  for (const request of requests) {
    const proId = request.availability?.proUserId;
    if (!proId) continue;
    const existing = requestMap.get(proId);
    if (!existing || request.createdAt < existing) {
      requestMap.set(proId, request.createdAt);
    }
  }

  const messages = await prisma.message.groupBy({
    by: ['senderId'],
    where: { senderId: { in: proIds } },
    _min: { createdAt: true },
  });
  const messageMap = new Map(messages.map((row) => [row.senderId, row._min?.createdAt]));

  const durations: number[] = [];
  for (const pro of pros) {
    if (!pro.verifiedAt) continue;
    const first = [requestMap.get(pro.userId), messageMap.get(pro.userId)]
      .filter((value): value is Date => value instanceof Date)
      .filter((value) => value >= pro.verifiedAt)
      .sort((a, b) => a.getTime() - b.getTime())[0];
    if (!first) continue;
    durations.push((first.getTime() - pro.verifiedAt.getTime()) / (60 * 1000));
  }

  if (durations.length < PRIVACY_THRESHOLD) {
    return { sampleSize: durations.length, medianMinutes: null, p90Minutes: null, masked: true };
  }

  return {
    sampleSize: durations.length,
    medianMinutes: computePercentile(durations, 50),
    p90Minutes: computePercentile(durations, 90),
    masked: false,
  };
};

const computeMarketplaceHealth = async (period: AnalyticsPeriod) => {
  const now = new Date();
  const startDate = getPeriodStart(period, now);

  const bookingRequests = await prisma.bookingRequest.findMany({
    where: { createdAt: { gte: startDate, lte: now } },
    select: {
      status: true,
      createdAt: true,
      respondedAt: true,
      availability: { select: { sport: true, spotLat: true, spotLng: true } },
    },
  });

  const availabilitySupply = await prisma.proAvailability.findMany({
    where: {
      createdAt: { gte: startDate, lte: now },
      status: 'OPEN',
      endAt: { gt: now },
    },
    select: { sport: true, spotLat: true, spotLng: true },
  });

  const demandMap = new Map<string, { sport: string; zoneLarge: string; count: number }>();
  for (const request of bookingRequests) {
    const sport = request.availability?.sport ?? null;
    const zoneLarge = computeZoneLarge(request.availability?.spotLat ?? null, request.availability?.spotLng ?? null);
    if (!sport || !zoneLarge) continue;
    const key = `${sport}|${zoneLarge}`;
    const entry = demandMap.get(key) ?? { sport, zoneLarge, count: 0 };
    entry.count += 1;
    demandMap.set(key, entry);
  }

  const supplyMap = new Map<string, { sport: string; zoneLarge: string; count: number }>();
  for (const availability of availabilitySupply) {
    const sport = availability.sport ?? null;
    const zoneLarge = computeZoneLarge(availability.spotLat ?? null, availability.spotLng ?? null);
    if (!sport || !zoneLarge) continue;
    const key = `${sport}|${zoneLarge}`;
    const entry = supplyMap.get(key) ?? { sport, zoneLarge, count: 0 };
    entry.count += 1;
    supplyMap.set(key, entry);
  }

  const segmentKeys = new Set<string>([...demandMap.keys(), ...supplyMap.keys()]);
  const segments = Array.from(segmentKeys).map((key) => {
    const demand = demandMap.get(key);
    const supply = supplyMap.get(key);
    const total = (demand?.count ?? 0) + (supply?.count ?? 0);
    const masked = total < PRIVACY_THRESHOLD;
    return {
      sport: demand?.sport ?? supply?.sport ?? 'unknown',
      zoneLarge: demand?.zoneLarge ?? supply?.zoneLarge ?? 'unknown',
      demandRequests: masked ? null : demand?.count ?? 0,
      supplyAvailabilities: masked ? null : supply?.count ?? 0,
      ratio: masked
        ? null
        : (supply?.count ?? 0) > 0
          ? (demand?.count ?? 0) / (supply?.count ?? 1)
          : null,
      sampleSize: total,
      masked,
    };
  });

  const totalRequests = bookingRequests.length;
  const acceptedRequests = bookingRequests.filter((request) => request.status === 'ACCEPTED').length;
  const responseDurations = bookingRequests
    .filter((request) => request.respondedAt)
    .map((request) => (request.respondedAt!.getTime() - request.createdAt.getTime()) / (60 * 60 * 1000));

  const acceptanceMasked = totalRequests < PRIVACY_THRESHOLD;
  const medianResponseHours = responseDurations.length
    ? computePercentile(responseDurations, 50)
    : 0;

  const acceptanceBySportMap = new Map<string, { total: number; accepted: number; responseTimes: number[] }>();
  for (const request of bookingRequests) {
    const sport = request.availability?.sport ?? 'unknown';
    const entry = acceptanceBySportMap.get(sport) ?? { total: 0, accepted: 0, responseTimes: [] };
    entry.total += 1;
    if (request.status === 'ACCEPTED') entry.accepted += 1;
    if (request.respondedAt) {
      entry.responseTimes.push((request.respondedAt.getTime() - request.createdAt.getTime()) / (60 * 60 * 1000));
    }
    acceptanceBySportMap.set(sport, entry);
  }

  const acceptanceBySport = Array.from(acceptanceBySportMap.entries()).map(([sport, entry]) => {
    const masked = entry.total < PRIVACY_THRESHOLD;
    return {
      sport,
      totalRequests: entry.total,
      acceptedRequests: masked ? null : entry.accepted,
      acceptanceRate: masked ? null : entry.total > 0 ? (entry.accepted / entry.total) * 100 : 0,
      medianResponseHours: masked
        ? null
        : entry.responseTimes.length
          ? computePercentile(entry.responseTimes, 50)
          : 0,
      masked,
    };
  });

  return {
    supplyDemand: segments,
    acceptance: {
      totalRequests,
      acceptedRequests: acceptanceMasked ? null : acceptedRequests,
      acceptanceRate: acceptanceMasked ? null : totalRequests > 0 ? (acceptedRequests / totalRequests) * 100 : 0,
      medianResponseHours: acceptanceMasked ? null : medianResponseHours,
      responseSampleSize: responseDurations.length,
      masked: acceptanceMasked,
    },
    acceptanceBySport,
  };
};

const computeTrustSafety = async (period: AnalyticsPeriod) => {
  const now = new Date();
  const startDate = getPeriodStart(period, now);

  const [totalPros, verifiedPros, totalUsers, reportsTotal] = await Promise.all([
    prisma.user.count({ where: { role: 'PRO', deletedAt: null } }),
    prisma.proProfile.count({ where: { verified: true, user: { deletedAt: null } } }),
    prisma.user.count({ where: { deletedAt: null } }),
    prisma.profileReport.count({ where: { createdAt: { gte: startDate, lte: now } } }),
  ]);

  const reportsMasked = totalUsers < PRIVACY_THRESHOLD;
  const reportsPer1k = totalUsers > 0 ? (reportsTotal / totalUsers) * 1000 : 0;

  const auditLogs = await prisma.auditLog.findMany({
    where: {
      action: 'admin:report:action',
      createdAt: { gte: startDate, lte: now },
    },
    select: { createdAt: true, metadata: true },
  });

  const moderationDurations: number[] = [];
  for (const log of auditLogs) {
    const metadata = log.metadata as { reportCreatedAt?: string } | null;
    if (!metadata?.reportCreatedAt) continue;
    const createdAt = new Date(metadata.reportCreatedAt);
    if (Number.isNaN(createdAt.getTime())) continue;
    moderationDurations.push((log.createdAt.getTime() - createdAt.getTime()) / (60 * 60 * 1000));
  }

  const moderationMasked = moderationDurations.length < PRIVACY_THRESHOLD;

  return {
    verifiedProsCount: verifiedPros,
    totalPros,
    verifiedProsRate: totalPros > 0 ? (verifiedPros / totalPros) * 100 : 0,
    reportsTotal: reportsMasked ? null : reportsTotal,
    reportsPer1kUsers: reportsMasked ? null : reportsPer1k,
    reportsMasked,
    moderationMedianHours: moderationMasked ? null : computePercentile(moderationDurations, 50),
    moderationSampleSize: moderationDurations.length,
    moderationMasked,
  };
};

const computeBlobosphereAnalytics = async (period: AnalyticsPeriod) => {
  const now = new Date();
  const startDate = getPeriodStart(period, now);
  const articles = await loadPublishedBlobosphereArticles();

  const aggregates = await prisma.analyticsDailyAgg.findMany({
    where: {
      eventType: { in: ['BLOBOSPHERE_VIEW', 'BLOBOSPHERE_OUTBOUND', 'BLOBOSPHERE_SIGNUP'] },
      day: { gte: startDate, lte: now },
    },
    select: { eventType: true, contentId: true, count: true },
  });

  const counts = new Map<string, { views: number; outbound: number; signups: number }>();
  for (const agg of aggregates) {
    if (!agg.contentId) continue;
    const entry = counts.get(agg.contentId) ?? { views: 0, outbound: 0, signups: 0 };
    if (agg.eventType === 'BLOBOSPHERE_VIEW') entry.views += agg.count;
    if (agg.eventType === 'BLOBOSPHERE_OUTBOUND') entry.outbound += agg.count;
    if (agg.eventType === 'BLOBOSPHERE_SIGNUP') entry.signups += agg.count;
    counts.set(agg.contentId, entry);
  }

  const readingSpeed = Number(process.env.ANALYTICS_READING_SPEED_WPM || '200');
  const sanitizedSpeed = readingSpeed > 0 ? readingSpeed : 200;

  const items = articles.map((article) => {
    const entry = counts.get(article.slug) ?? { views: 0, outbound: 0, signups: 0 };
    const masked = entry.views < PRIVACY_THRESHOLD;
    const readingTimeMinutes = article.wordCount > 0
      ? Math.max(1, Math.round(article.wordCount / sanitizedSpeed))
      : 0;
    return {
      slug: article.slug,
      title: article.title,
      publishedAt: article.publishedAt,
      cover: article.cover,
      readingTimeMinutes,
      pageviews: masked ? null : entry.views,
      outboundClicks: masked ? null : entry.outbound,
      signupConversions: masked ? null : entry.signups,
      sampleSize: entry.views,
      masked,
    };
  });

  const totals = Array.from(counts.values()).reduce(
    (acc, entry) => {
      acc.pageviews += entry.views;
      acc.outboundClicks += entry.outbound;
      acc.signupConversions += entry.signups;
      return acc;
    },
    { pageviews: 0, outboundClicks: 0, signupConversions: 0 }
  );

  return {
    totals,
    items,
  };
};

export const analyticsReportService = {
  async getTraction(period: AnalyticsPeriod) {
    const now = new Date();
    const startDate = getPeriodStart(period, now);

    const [riders, pros, stickiness, riderRetention, proRetention] = await Promise.all([
      prisma.user.count({ where: { role: 'RIDER', deletedAt: null } }),
      prisma.user.count({ where: { role: 'PRO', deletedAt: null } }),
      computeStickiness(period),
      computeRetention('RIDER', period),
      computeRetention('PRO', period),
    ]);

    const newRiders = await prisma.user.count({
      where: { role: 'RIDER', deletedAt: null, createdAt: { gte: startDate, lte: now } },
    });
    const newPros = await prisma.user.count({
      where: { role: 'PRO', deletedAt: null, createdAt: { gte: startDate, lte: now } },
    });

    return {
      period,
      privacyThreshold: PRIVACY_THRESHOLD,
      definitions: {
        riderActiveDay: ANALYTICS_DEFINITIONS.riderActiveDay,
        proActiveDay: ANALYTICS_DEFINITIONS.proActiveDay,
        stickiness: ANALYTICS_DEFINITIONS.stickiness,
        retention: ANALYTICS_DEFINITIONS.retention,
      },
      totals: {
        riders,
        pros,
        users: riders + pros,
        newRiders,
        newPros,
      },
      stickiness,
      retention: {
        riders: riderRetention,
        pros: proRetention,
      },
    };
  },

  async getMarketplaceHealth(period: AnalyticsPeriod) {
    const marketplace = await computeMarketplaceHealth(period);
    return {
      period,
      privacyThreshold: PRIVACY_THRESHOLD,
      definitions: {
        supplyDemand: ANALYTICS_DEFINITIONS.supplyDemand,
      },
      ...marketplace,
    };
  },

  async getTrustAndContent(period: AnalyticsPeriod) {
    const [trustSafety, blobosphere] = await Promise.all([
      computeTrustSafety(period),
      computeBlobosphereAnalytics(period),
    ]);
    return {
      period,
      privacyThreshold: PRIVACY_THRESHOLD,
      definitions: {
        trustSafety: ANALYTICS_DEFINITIONS.trustSafety,
        blobosphere: ANALYTICS_DEFINITIONS.blobosphere,
      },
      trustSafety,
      blobosphere,
    };
  },

  async getTtfv(period: AnalyticsPeriod) {
    const [rider, pro] = await Promise.all([
      computeTtfvRiders(period),
      computeTtfvPros(period),
    ]);
    return {
      period,
      privacyThreshold: PRIVACY_THRESHOLD,
      definitions: {
        ttfvRider: ANALYTICS_DEFINITIONS.ttfvRider,
        ttfvPro: ANALYTICS_DEFINITIONS.ttfvPro,
      },
      riders: rider,
      pros: pro,
    };
  },
};
