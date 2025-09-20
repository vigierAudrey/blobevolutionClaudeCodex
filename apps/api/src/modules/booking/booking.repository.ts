import { prisma } from '@blobinfini/database';
import { Prisma } from '@prisma/client';

export class BookingRepository {
  createAvailability(data: any) {
    return prisma.proAvailability.create({ data });
  }

  listAvailabilities(proUserId: string, params: any) {
    return prisma.proAvailability.findMany({
      where: { proUserId, ...params?.where },
      orderBy: params?.orderBy ?? { startAt: 'asc' },
    });
  }

  findAvailabilityById(id: string) {
    return prisma.proAvailability.findUnique({ where: { id } });
  }

  updateAvailability(id: string, data: any) {
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
  }) {
    const { sport, level, lat, lng, radiusKm, startAt, endAt, page, pageSize } = params;
    const offset = (page - 1) * pageSize;

    const startCondition = startAt ? Prisma.sql`AND pa."startAt" >= ${startAt}` : Prisma.empty;
    const endCondition = endAt ? Prisma.sql`AND pa."startAt" <= ${endAt}` : Prisma.empty;
    const sportCondition =
      sport === 'surf'
        ? Prisma.sql`pa."sport" = 'surf'::"Sport"`
        : Prisma.sql`pa."sport" = 'kitesurf'::"Sport"`;

    return prisma.$queryRaw<Array<any>>(
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

  createRequest(data: any) {
    return prisma.bookingRequest.create({ data });
  }

  listRequests(filter: any) {
    return prisma.bookingRequest.findMany(filter);
  }

  findRequestById(id: string, params: any = {}) {
    return prisma.bookingRequest.findUnique({ where: { id }, ...params });
  }

  updateRequest(id: string, data: any) {
    return prisma.bookingRequest.update({ where: { id }, data });
  }

  createBooking(data: any) {
    return prisma.booking.create({ data });
  }

  listBookings(filter: any) {
    return prisma.booking.findMany(filter);
  }
}

export const bookingRepository = new BookingRepository();
