import { clientPrisma as prisma, Prisma } from '@blobinfini/database';

export interface FunnelStep {
  count: number;
  rateFromPrevious: number | null;
}

export interface AdminFunnelAnalytics {
  period: { from: string; to: string };
  steps: {
    requestCreated: { count: number };
    proMatched: FunnelStep;
    contactSent: FunnelStep;
    connectionAccepted: FunnelStep;
    conversationStarted: FunnelStep;
  };
  globalRates: {
    requestToConversationStarted: number | null;
    contactSentToConversationStarted: number | null;
  };
}

type MainRow = {
  requestCreated: bigint;
  proMatched: bigint;
  contactSent: bigint;
};

type AcceptedRow = {
  connectionAccepted: bigint;
};

type StartedRow = {
  conversationStarted: bigint;
};

function toRate(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

// Retourne les métriques du funnel complet BlobConnect sur une période bornée.
//
// ⚠️  Sémantique de cohorte :
//   Le funnel est calculé par cohorte de demandes/contact requests créées dans
//   la période sélectionnée. Les acceptations et conversations sont rattachées
//   à cette cohorte même si elles surviennent après la borne `to`.
//   Exemple : une demande créée le 25 mai et acceptée le 2 juin sera comptée
//   dans connectionAccepted si la période inclut le 25 mai.
//   Ce choix garantit la cohérence des invariants étape N ≤ étape N-1.
//
// Cohérence des étapes :
//   Étapes 1–3 filtrent sur lf.createdAt (date du fanout/demande).
//   Étape 4 filtre sur cr.createdAt (date de création du ContactRequest).
//   Étape 5 filtre sur cr.createdAt + EXISTS(message réel après acceptation).
//
// Garantie proMatched ≤ requestCreated, contactSent ≤ requestCreated,
// connectionAccepted ≤ contactSent, conversationStarted ≤ connectionAccepted.
//
// Anti-double-comptage : COUNT(DISTINCT lessonRequestId) à chaque étape —
// plusieurs pros contactés pour la même demande ne comptent pas N fois.
export async function getAdminFunnelAnalytics(from: Date, to: Date): Promise<AdminFunnelAnalytics> {
  // Borne haute exclusive : inclut tout le jour `to` jusqu'à 23:59:59.
  const toExclusive = new Date(to.getTime() + 24 * 60 * 60 * 1000);

  const [mainRows, acceptedRows, startedRows] = await Promise.all([
    // Étapes 1–3 en une seule requête sur LessonFanout + LEFT JOIN ContactRequest.
    // Index couvrants : LessonFanout_createdAt_idx + ContactRequest_lessonRequestId_idx.
    prisma.$queryRaw<MainRow[]>(Prisma.sql`
      SELECT
        COUNT(DISTINCT lf."lessonRequestId")                                        AS "requestCreated",
        COUNT(DISTINCT CASE WHEN lf."prosFound" > 0
              THEN lf."lessonRequestId" END)                                        AS "proMatched",
        COUNT(DISTINCT cr."lessonRequestId")
          FILTER (WHERE cr."lessonRequestId" IS NOT NULL)                           AS "contactSent"
      FROM "LessonFanout" lf
      LEFT JOIN "ContactRequest" cr
        ON cr."lessonRequestId" = lf."lessonRequestId"
       AND cr."createdAt" >= ${from}::timestamptz
       AND cr."createdAt" < ${toExclusive}::timestamptz
      WHERE lf."createdAt" >= ${from}::timestamptz
        AND lf."createdAt" < ${toExclusive}::timestamptz
    `),

    // Étape 4 : mises en relation acceptées.
    // COUNT DISTINCT lessonRequestId — une demande acceptée par plusieurs pros = 1.
    prisma.$queryRaw<AcceptedRow[]>(Prisma.sql`
      SELECT COUNT(DISTINCT cr."lessonRequestId") AS "connectionAccepted"
      FROM "ContactRequest" cr
      WHERE cr."status"::text = 'ACCEPTED'
        AND cr."lessonRequestId" IS NOT NULL
        AND cr."createdAt" >= ${from}::timestamptz
        AND cr."createdAt" < ${toExclusive}::timestamptz
    `),

    // Étape 5 : conversations réellement démarrées — logique identique à C21.
    // Message réel = type TEXT/PROPOSAL, meta.kind ≠ 'SYSTEM', contenu non vide,
    // envoyé par un membre de la conversation, APRÈS la date d'acceptation.
    // COUNT DISTINCT lessonRequestId pour cohérence avec les étapes précédentes.
    prisma.$queryRaw<StartedRow[]>(Prisma.sql`
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
          AND cr."lessonRequestId" IS NOT NULL
          AND cr."createdAt" >= ${from}::timestamptz
          AND cr."createdAt" < ${toExclusive}::timestamptz
        GROUP BY cr."id", cr."conversationId", cr."lessonRequestId"
      )
      SELECT COUNT(DISTINCT ar."lessonRequestId") AS "conversationStarted"
      FROM accepted_requests ar
      WHERE EXISTS (
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
    `),
  ]);

  const requestCreated = Number(mainRows[0]?.requestCreated ?? 0n);
  const proMatched = Number(mainRows[0]?.proMatched ?? 0n);
  const contactSent = Number(mainRows[0]?.contactSent ?? 0n);
  const connectionAccepted = Number(acceptedRows[0]?.connectionAccepted ?? 0n);
  const conversationStarted = Number(startedRows[0]?.conversationStarted ?? 0n);

  return {
    period: {
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
    },
    steps: {
      requestCreated: { count: requestCreated },
      proMatched: { count: proMatched, rateFromPrevious: toRate(proMatched, requestCreated) },
      contactSent: { count: contactSent, rateFromPrevious: toRate(contactSent, proMatched) },
      connectionAccepted: {
        count: connectionAccepted,
        rateFromPrevious: toRate(connectionAccepted, contactSent),
      },
      conversationStarted: {
        count: conversationStarted,
        rateFromPrevious: toRate(conversationStarted, connectionAccepted),
      },
    },
    globalRates: {
      requestToConversationStarted: toRate(conversationStarted, requestCreated),
      contactSentToConversationStarted: toRate(conversationStarted, contactSent),
    },
  };
}
