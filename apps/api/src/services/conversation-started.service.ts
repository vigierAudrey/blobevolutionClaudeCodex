import { clientPrisma as prisma, Prisma } from '@blobinfini/database';

export interface ProConversationStartedStats {
  conversationsStartedCount: number;
  conversationStartRate: number | null;
}

export interface ConversationAnalyticsBySport {
  sport: string;
  connectedContactsCount: number;
  conversationsStartedCount: number;
  conversationStartRate: number | null;
}

export interface ConversationAnalyticsTimelinePoint {
  day: string;
  conversationsStartedCount: number;
}

export interface AdminConversationAnalytics {
  windowDays: number;
  connectedContactsCount: number;
  conversationsStartedCount: number;
  conversationStartRate: number | null;
  bySport: ConversationAnalyticsBySport[];
  timeline: ConversationAnalyticsTimelinePoint[];
}

type ProStartedRow = {
  conversationsStartedCount: bigint;
};

type AdminSummaryRow = {
  connectedContactsCount: bigint;
  conversationsStartedCount: bigint;
  conversation_start_rate: number | null;
};

type SportRow = {
  sport: string;
  connectedContactsCount: bigint;
  conversationsStartedCount: bigint;
  conversation_start_rate: number | null;
};

type TimelineRow = {
  day: Date;
  conversationsStartedCount: bigint;
};

function toRate(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

export async function getProConversationStartedStats(
  proUserId: string,
  windowStart: Date,
  connectedContactsCount: number,
): Promise<ProConversationStartedStats> {
  const [row] = await prisma.$queryRaw<ProStartedRow[]>(Prisma.sql`
    WITH accepted_requests AS (
      SELECT
        cr."id",
        cr."conversationId",
        MAX(crr."createdAt") AS "acceptedAt"
      FROM "ContactRequest" cr
      JOIN "ContactRequestResponse" crr
        ON crr."contactRequestId" = cr."id"
      WHERE cr."proUserId" = ${proUserId}
        AND cr."status"::text = 'ACCEPTED'
        AND cr."createdAt" >= ${windowStart}::timestamptz
      GROUP BY cr."id", cr."conversationId"
    )
    SELECT COUNT(*) AS "conversationsStartedCount"
    FROM accepted_requests ar
    WHERE ar."acceptedAt" IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM "Message" m
        JOIN "ConversationMember" cm
          ON cm."conversationId" = m."conversationId"
         AND cm."userId" = m."senderId"
        WHERE m."conversationId" = ar."conversationId"
          AND m."createdAt" >= ar."acceptedAt"
          AND m."type"::text IN ('TEXT', 'PROPOSAL')
          AND COALESCE(m."meta"->>'kind', '') <> 'SYSTEM'
          AND length(btrim(m."content")) > 0
        LIMIT 1
      )
  `);

  const conversationsStartedCount = Number(row?.conversationsStartedCount ?? 0);
  return {
    conversationsStartedCount,
    conversationStartRate: toRate(conversationsStartedCount, connectedContactsCount),
  };
}

export async function getAdminConversationAnalytics(windowDays: number): Promise<AdminConversationAnalytics> {
  const boundedWindowDays = Math.min(Math.max(windowDays, 1), 90);
  const windowStart = new Date(Date.now() - boundedWindowDays * 24 * 60 * 60 * 1000);

  const [summaryRows, sportRows, timelineRows]: [AdminSummaryRow[], SportRow[], TimelineRow[]] = await Promise.all([
    prisma.$queryRaw<AdminSummaryRow[]>(Prisma.sql`
      WITH accepted_requests AS (
        SELECT
          cr."id",
          cr."conversationId",
          MAX(crr."createdAt") AS "acceptedAt"
        FROM "ContactRequest" cr
        JOIN "ContactRequestResponse" crr
          ON crr."contactRequestId" = cr."id"
        WHERE cr."status"::text = 'ACCEPTED'
        GROUP BY cr."id", cr."conversationId"
        HAVING MAX(crr."createdAt") >= ${windowStart}::timestamptz
      ),
      started_requests AS (
        SELECT
          ar."id",
          MIN(m."createdAt") AS "startedAt"
        FROM accepted_requests ar
        JOIN "Message" m
          ON m."conversationId" = ar."conversationId"
         AND m."createdAt" >= ar."acceptedAt"
         AND m."type"::text IN ('TEXT', 'PROPOSAL')
         AND COALESCE(m."meta"->>'kind', '') <> 'SYSTEM'
         AND length(btrim(m."content")) > 0
        JOIN "ConversationMember" cm
          ON cm."conversationId" = m."conversationId"
         AND cm."userId" = m."senderId"
        GROUP BY ar."id"
      )
      SELECT
        COUNT(ar."id") AS "connectedContactsCount",
        COUNT(sr."id") AS "conversationsStartedCount",
        ROUND(COUNT(sr."id")::numeric / NULLIF(COUNT(ar."id"), 0) * 100, 1)::float AS "conversation_start_rate"
      FROM accepted_requests ar
      LEFT JOIN started_requests sr
        ON sr."id" = ar."id"
    `),

    prisma.$queryRaw<SportRow[]>(Prisma.sql`
      WITH accepted_requests AS (
        SELECT
          cr."id",
          cr."conversationId",
          cr."lessonRequestId",
          MAX(crr."createdAt") AS "acceptedAt"
        FROM "ContactRequest" cr
        JOIN "ContactRequestResponse" crr
          ON crr."contactRequestId" = cr."id"
        WHERE cr."status"::text = 'ACCEPTED'
        GROUP BY cr."id", cr."conversationId", cr."lessonRequestId"
        HAVING MAX(crr."createdAt") >= ${windowStart}::timestamptz
      ),
      started_requests AS (
        SELECT
          ar."id",
          MIN(m."createdAt") AS "startedAt"
        FROM accepted_requests ar
        JOIN "Message" m
          ON m."conversationId" = ar."conversationId"
         AND m."createdAt" >= ar."acceptedAt"
         AND m."type"::text IN ('TEXT', 'PROPOSAL')
         AND COALESCE(m."meta"->>'kind', '') <> 'SYSTEM'
         AND length(btrim(m."content")) > 0
        JOIN "ConversationMember" cm
          ON cm."conversationId" = m."conversationId"
         AND cm."userId" = m."senderId"
        GROUP BY ar."id"
      ),
      sport_lookup AS (
        SELECT DISTINCT ON (lf."lessonRequestId")
          lf."lessonRequestId",
          COALESCE(lf."sport", 'unknown') AS "sport"
        FROM "LessonFanout" lf
        JOIN accepted_requests ar
          ON ar."lessonRequestId" = lf."lessonRequestId"
        ORDER BY lf."lessonRequestId", lf."createdAt" DESC
      )
      SELECT
        COALESCE(sl."sport", 'unknown') AS "sport",
        COUNT(ar."id") AS "connectedContactsCount",
        COUNT(sr."id") AS "conversationsStartedCount",
        ROUND(COUNT(sr."id")::numeric / NULLIF(COUNT(ar."id"), 0) * 100, 1)::float AS "conversation_start_rate"
      FROM accepted_requests ar
      LEFT JOIN started_requests sr
        ON sr."id" = ar."id"
      LEFT JOIN sport_lookup sl
        ON sl."lessonRequestId" = ar."lessonRequestId"
      GROUP BY COALESCE(sl."sport", 'unknown')
      ORDER BY COALESCE(sl."sport", 'unknown')
    `),

    prisma.$queryRaw<TimelineRow[]>(Prisma.sql`
      WITH accepted_requests AS (
        SELECT
          cr."id",
          cr."conversationId",
          MAX(crr."createdAt") AS "acceptedAt"
        FROM "ContactRequest" cr
        JOIN "ContactRequestResponse" crr
          ON crr."contactRequestId" = cr."id"
        WHERE cr."status"::text = 'ACCEPTED'
        GROUP BY cr."id", cr."conversationId"
        HAVING MAX(crr."createdAt") >= ${windowStart}::timestamptz
      ),
      started_requests AS (
        SELECT
          ar."id",
          MIN(m."createdAt") AS "startedAt"
        FROM accepted_requests ar
        JOIN "Message" m
          ON m."conversationId" = ar."conversationId"
         AND m."createdAt" >= ar."acceptedAt"
         AND m."type"::text IN ('TEXT', 'PROPOSAL')
         AND COALESCE(m."meta"->>'kind', '') <> 'SYSTEM'
         AND length(btrim(m."content")) > 0
        JOIN "ConversationMember" cm
          ON cm."conversationId" = m."conversationId"
         AND cm."userId" = m."senderId"
        GROUP BY ar."id"
      )
      SELECT
        date_trunc('day', sr."startedAt") AS "day",
        COUNT(*) AS "conversationsStartedCount"
      FROM started_requests sr
      WHERE sr."startedAt" >= ${windowStart}::timestamptz
      GROUP BY day
      ORDER BY day ASC
    `),
  ]);

  const summary = summaryRows[0];
  return {
    windowDays: boundedWindowDays,
    connectedContactsCount: Number(summary?.connectedContactsCount ?? 0),
    conversationsStartedCount: Number(summary?.conversationsStartedCount ?? 0),
    conversationStartRate: summary?.conversation_start_rate ?? null,
    bySport: sportRows.map((row) => ({
      sport: row.sport,
      connectedContactsCount: Number(row.connectedContactsCount),
      conversationsStartedCount: Number(row.conversationsStartedCount),
      conversationStartRate: row.conversation_start_rate,
    })),
    timeline: timelineRows.map((row) => ({
      day: row.day.toISOString().slice(0, 10),
      conversationsStartedCount: Number(row.conversationsStartedCount),
    })),
  };
}
