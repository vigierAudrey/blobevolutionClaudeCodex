import { clientPrisma as prisma, Prisma } from '@blobinfini/database';

type WeeklyRow = { week: Date; count: bigint };
type CountRow = { count: bigint };

export interface WeeklyBucket {
  week: string; // ISO date of Monday (date_trunc output)
  count: number;
}

export interface ProDashboardStats {
  // 7 jours glissants
  receivedRequests: number;
  readNotifications: number;
  sentContacts: number;
  connectedContacts: number;
  pendingContacts: number;
  connectionRate: number | null; // pct arrondi à 1 décimale, null si sentContacts=0
  // Alias rétrocompatibles: ACCEPTED = mise en relation ouverte, pas cours accepté.
  acceptedContacts: number;
  acceptanceRate: number | null;
  // Historique 2 dernières semaines ISO
  weeklyNotifications: WeeklyBucket[];
  weeklyContacts: WeeklyBucket[];
  // Activité en cours
  activeNearbyRequests: number;
  // C20 : demandes archivées (toutes périodes — compteur global)
  archivedCount: number;
}

export async function getProDashboardStats(userId: string): Promise<ProDashboardStats> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

  // Récupération du profil pro pour la requête géospatiale
  const proProfile = await prisma.proProfile.findUnique({
    where: { userId },
    select: { lat: true, lng: true, radiusKm: true },
  });

  // Toutes les stats en parallèle — pas de N+1
  const [
    receivedRequests,
    readNotifications,
    sentContacts,
    connectedContacts,
    pendingContacts,
    weeklyNotifRows,
    weeklyContactRows,
    activeNearbyRequests,
    archivedCount,
  ]: [number, number, number, number, number, WeeklyRow[], WeeklyRow[], number, number] = await Promise.all([
    prisma.notification.count({
      where: {
        userId,
        type: 'LESSON_REQUEST_NEARBY',
        createdAt: { gte: sevenDaysAgo },
      },
    }),
    prisma.notification.count({
      where: {
        userId,
        type: 'LESSON_REQUEST_NEARBY',
        createdAt: { gte: sevenDaysAgo },
        readAt: { not: null },
      },
    }),
    prisma.contactRequest.count({
      where: { proUserId: userId, createdAt: { gte: sevenDaysAgo } },
    }),
    prisma.contactRequest.count({
      where: { proUserId: userId, createdAt: { gte: sevenDaysAgo }, status: 'ACCEPTED' },
    }),
    prisma.contactRequest.count({
      where: { proUserId: userId, createdAt: { gte: sevenDaysAgo }, status: 'PENDING' },
    }),
    // Groupement hebdomadaire notifications — index [userId, createdAt DESC] utilisé
    prisma.$queryRaw<WeeklyRow[]>(Prisma.sql`
      SELECT
        date_trunc('week', "createdAt") AS week,
        COUNT(*) AS count
      FROM "Notification"
      WHERE "userId"    = ${userId}
        AND "type"      = 'LESSON_REQUEST_NEARBY'
        AND "createdAt" >= ${fourteenDaysAgo}
      GROUP BY week
      ORDER BY week ASC
    `),
    // Groupement hebdomadaire contacts — index [proUserId] utilisé
    prisma.$queryRaw<WeeklyRow[]>(Prisma.sql`
      SELECT
        date_trunc('week', "createdAt") AS week,
        COUNT(*) AS count
      FROM "ContactRequest"
      WHERE "proUserId"  = ${userId}
        AND "createdAt"  >= ${fourteenDaysAgo}
      GROUP BY week
      ORDER BY week ASC
    `),
    // Demandes actives dans la zone du pro — 0 si pas de localisation
    proProfile?.lat != null && proProfile?.lng != null
      ? fetchActiveNearbyCount(proProfile.lat, proProfile.lng, proProfile.radiusKm ?? 25)
      : Promise.resolve(0),
    // C20 : total archivé (toutes périodes — préférence UI pro)
    prisma.contactRequest.count({
      where: { proUserId: userId, archivedByPro: true },
    }),
  ]);

  const connectionRate =
    sentContacts > 0
      ? Math.round((connectedContacts / sentContacts) * 1000) / 10
      : null;

  return {
    receivedRequests,
    readNotifications,
    sentContacts,
    connectedContacts,
    pendingContacts,
    connectionRate,
    acceptedContacts: connectedContacts,
    acceptanceRate: connectionRate,
    weeklyNotifications: weeklyNotifRows.map((r) => ({
      week: r.week.toISOString().split('T')[0]!,
      count: Number(r.count),
    })),
    weeklyContacts: weeklyContactRows.map((r) => ({
      week: r.week.toISOString().split('T')[0]!,
      count: Number(r.count),
    })),
    activeNearbyRequests,
    archivedCount,
  };
}

async function fetchActiveNearbyCount(lat: number, lng: number, radiusKm: number): Promise<number> {
  const rows = await prisma.$queryRaw<CountRow[]>(Prisma.sql`
    SELECT COUNT(*) AS count
    FROM "RiderProfile" rp
    WHERE rp."wantsLesson" = true
      AND rp."lessonLat"   IS NOT NULL
      AND rp."lessonLng"   IS NOT NULL
      AND ST_DWithin(
        ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography,
        ST_SetSRID(ST_MakePoint(rp."lessonLng", rp."lessonLat"), 4326)::geography,
        ${radiusKm * 1000}
      )
  `);
  return Number(rows[0]?.count ?? 0);
}
