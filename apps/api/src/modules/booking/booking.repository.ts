import { clientPrisma as prisma, Prisma } from '@blobinfini/database';

export type SearchAvailabilityRow = {
  id: string;
  proUserId: string;
  sport: 'surf' | 'kitesurf';
  levels: string[];
  startAt: Date;
  endAt: Date;
  capacity: number;
  bookedCount: number;
  spotName: string | null;
  spotLat: number | null;
  spotLng: number | null;
  status: 'OPEN' | 'CLOSED';
  businessName: string | null;
  proEmail: string;
  distance_m: Prisma.Decimal | number | null;
};

export type NearbyProRow = {
  proUserId: string;
  email: string;
  businessName: string | null;
  photoUrl: string | null;
  verified: boolean;
  lat: number;
  lng: number;
  distance_m: Prisma.Decimal | number;
  sports: Array<'surf' | 'kitesurf'>;
  openAvailabilityCount: number;
};

export class BookingRepository {
  createAvailability(data: Prisma.ProAvailabilityUncheckedCreateInput) {
    return prisma.proAvailability.create({ data });
  }

  listAvailabilities(proUserId: string, params: Prisma.ProAvailabilityFindManyArgs) {
    return prisma.proAvailability.findMany({
      where: { proUserId, ...params?.where },
      orderBy: params?.orderBy ?? { startAt: 'asc' },
    });
  }

  findAvailabilityById(id: string) {
    return prisma.proAvailability.findUnique({ where: { id } });
  }

  updateAvailability(id: string, data: Prisma.ProAvailabilityUncheckedUpdateInput) {
    return prisma.proAvailability.update({ where: { id }, data });
  }

  async searchAvailabilities(params: {
    sport: 'surf' | 'kitesurf';
    level: 'beginner' | 'intermediate' | 'advanced';
    lat: number;
    lng: number;
    radiusKm: number;
    startAt?: string;
    endAt?: string;
    page: number;
    pageSize: number;
  }): Promise<SearchAvailabilityRow[]> {
    const { sport, level, lat, lng, radiusKm, startAt, endAt, page, pageSize } = params;
    const offset = (page - 1) * pageSize;

    const startCondition = startAt ? Prisma.sql`AND pa."startAt" >= ${startAt}` : Prisma.empty;
    const endCondition = endAt ? Prisma.sql`AND pa."startAt" <= ${endAt}` : Prisma.empty;
    const sportCondition =
      sport === 'surf'
        ? Prisma.sql`pa."sport" = 'surf'::"Sport"`
        : Prisma.sql`pa."sport" = 'kitesurf'::"Sport"`;

    return prisma.$queryRaw<SearchAvailabilityRow[]>(
      Prisma.sql`
        SELECT
          pa."id",
          pa."proUserId",
          pa."sport",
          pa."levels",
          pa."startAt",
          pa."endAt",
          pa."capacity",
          pa."bookedCount",
          pa."spotName",
          pa."spotLat",
          pa."spotLng",
          pa."status",
          pp."businessName",
          u."email"              AS "proEmail",
          ST_Distance(
            ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography,
            ST_SetSRID(ST_MakePoint(pa."spotLng", pa."spotLat"), 4326)::geography
          ) AS distance_m
        FROM "ProAvailability" pa
        JOIN "User" u ON u."id" = pa."proUserId"
        LEFT JOIN "ProProfile" pp ON pp."userId" = pa."proUserId"
        WHERE ${sportCondition}
          AND ${level} = ANY(pa."levels")
          AND pa."status" = 'OPEN'
          AND pa."spotLat" IS NOT NULL
          AND pa."spotLng" IS NOT NULL
          ${startCondition}
          ${endCondition}
          AND ST_DWithin(
            ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography,
            ST_SetSRID(ST_MakePoint(pa."spotLng", pa."spotLat"), 4326)::geography,
            ${radiusKm * 1000}
          )
        ORDER BY distance_m ASC
        LIMIT ${pageSize} OFFSET ${offset}
      `
    );
  }

  async findNearbyPros(params: {
    lat: number;
    lng: number;
    radiusKm: number;
    sport?: 'surf' | 'kitesurf';
  }): Promise<NearbyProRow[]> {
    const { lat, lng, radiusKm, sport } = params;

    const sportCondition = sport
      ? Prisma.sql`
        AND (
          NOT EXISTS (SELECT 1 FROM "ProAvailability" pa0 WHERE pa0."proUserId" = u."id")
          OR EXISTS (
            SELECT 1
            FROM "ProAvailability" pa
            WHERE pa."proUserId" = u."id"
              AND pa."sport" = CAST(${sport} AS "Sport")
          )
        )
      `
      : Prisma.empty;

    return prisma.$queryRaw<NearbyProRow[]>(Prisma.sql`
      SELECT
        u."id" AS "proUserId",
        u."email",
        pp."businessName",
        pp."photoUrl",
        pp."verified",
        pp."lat",
        pp."lng",
        ST_Distance(
          ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography,
          ST_SetSRID(ST_MakePoint(pp."lng", pp."lat"), 4326)::geography
        ) AS distance_m,
        COALESCE(open_stats."openAvailabilityCount", 0) AS "openAvailabilityCount",
        COALESCE(sport_stats.sports, ARRAY[]::"Sport"[]) AS sports
      FROM "User" u
      JOIN "ProProfile" pp ON pp."userId" = u."id"
      LEFT JOIN (
        SELECT "proUserId", COUNT(*) FILTER (WHERE "status" = 'OPEN') AS "openAvailabilityCount"
        FROM "ProAvailability"
        GROUP BY "proUserId"
      ) open_stats ON open_stats."proUserId" = u."id"
      LEFT JOIN (
        SELECT "proUserId", ARRAY_AGG(DISTINCT "sport") AS sports
        FROM "ProAvailability"
        GROUP BY "proUserId"
      ) sport_stats ON sport_stats."proUserId" = u."id"
      WHERE u."role" = 'PRO'
        AND u."deletedAt" IS NULL
        AND pp."lat" IS NOT NULL
        AND pp."lng" IS NOT NULL
        AND pp."verified" = true
        AND ST_DWithin(
          ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography,
          ST_SetSRID(ST_MakePoint(pp."lng", pp."lat"), 4326)::geography,
          ${radiusKm * 1000}
        )
        ${sportCondition}
      ORDER BY distance_m ASC
    `);
  }

  createRequest(data: Prisma.BookingRequestUncheckedCreateInput) {
    return prisma.bookingRequest.create({ data });
  }

  listRequests(filter: Prisma.BookingRequestFindManyArgs) {
    return prisma.bookingRequest.findMany(filter);
  }

  findRequestById(id: string, params: Prisma.BookingRequestFindUniqueArgs = {}) {
    return prisma.bookingRequest.findUnique({ where: { id }, ...params });
  }

  updateRequest(id: string, data: Prisma.BookingRequestUncheckedUpdateInput) {
    return prisma.bookingRequest.update({ where: { id }, data });
  }

  createBooking(data: Prisma.BookingUncheckedCreateInput) {
    return prisma.booking.create({ data });
  }

  listBookings(filter: Prisma.BookingFindManyArgs) {
    return prisma.booking.findMany(filter);
  }
}

export const bookingRepository = new BookingRepository();
