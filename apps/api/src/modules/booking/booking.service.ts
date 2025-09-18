import { Prisma, BookingRequestStatus } from '@prisma/client';
import { prisma } from '@blobinfini/database';
import { bookingRepository } from './booking.repository';

export class BookingService {
  async createAvailability(proUserId: string, data: any) {
    // TODO: validate overlap, compute geo point
    return bookingRepository.createAvailability({ ...data, proUserId });
  }

  async listAvailabilities(proUserId: string, query: any) {
    return bookingRepository.listAvailabilities(proUserId, query);
  }

  async updateAvailability(proUserId: string, availabilityId: string, data: any) {
    const availability = await bookingRepository.findAvailabilityById(availabilityId);
    if (!availability || availability.proUserId !== proUserId) {
      throw Object.assign(new Error('Availability not found'), { status: 404 });
    }
    return bookingRepository.updateAvailability(availabilityId, data);
  }

  async searchAvailabilities(filters: any) {
    const page = filters.page ?? 1;
    const pageSize = filters.pageSize ?? 20;
    const rows = await bookingRepository.searchAvailabilities({
      sport: filters.sport,
      level: filters.level,
      lat: filters.lat,
      lng: filters.lng,
      radiusKm: filters.radiusKm,
      startAt: filters.startAt,
      endAt: filters.endAt,
      page,
      pageSize,
    });

    const availabilityIds = rows.map((row: any) => row.id);
    const bookings = availabilityIds.length
      ? await bookingRepository.listBookings({
          where: { availabilityId: { in: availabilityIds } },
          include: {
            rider: {
              select: {
                id: true,
                email: true,
                riderProfile: {
                  select: {
                    displayName: true,
                    photoUrl: true,
                  },
                },
              },
            },
          },
        })
      : [];

    const ridersByAvailability = new Map<string, Array<{ id: string; displayName: string; avatarUrl: string | null }>>();
    for (const booking of bookings as any[]) {
      const rider = booking.rider;
      const collection = ridersByAvailability.get(booking.availabilityId) ?? [];
      collection.push({
        id: rider.id,
        displayName: rider.riderProfile?.displayName ?? rider.email,
        avatarUrl: rider.riderProfile?.photoUrl ?? null,
      });
      ridersByAvailability.set(booking.availabilityId, collection.slice(0, 6));
    }

    return rows.map((row: any) => ({
      id: row.id,
      pro: {
        userId: row.proUserId,
        email: row.proEmail,
        businessName: row.businessName ?? null,
      },
      sport: row.sport,
      levels: row.levels,
      startAt: row.startAt,
      endAt: row.endAt,
      capacity: Number(row.capacity),
      bookedCount: Number(row.bookedCount),
      spotName: row.spotName,
      spotLat: row.spotLat,
      spotLng: row.spotLng,
      distanceKm: row.distance_m != null ? Number(row.distance_m) / 1000 : null,
      riders: ridersByAvailability.get(row.id) ?? [],
    }));
  }

  async createRequest(riderUserId: string, data: any) {
    return bookingRepository.createRequest({ ...data, riderUserId });
  }

  async listRiderRequests(riderUserId: string) {
    return bookingRepository.listRequests({
      where: { riderUserId },
      include: {
        availability: {
          select: {
            id: true,
            sport: true,
            levels: true,
            startAt: true,
            endAt: true,
            spotName: true,
            pro: {
              select: {
                email: true,
                proProfile: {
                  select: {
                    businessName: true,
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listProRequests(proUserId: string) {
    return bookingRepository.listRequests({
      where: {
        availability: { proUserId },
      },
      include: {
        rider: {
          select: {
            id: true,
            email: true,
            riderProfile: {
              select: {
                displayName: true,
                photoUrl: true,
              },
            },
          },
        },
        availability: {
          select: {
            id: true,
            sport: true,
            levels: true,
            startAt: true,
            endAt: true,
            capacity: true,
            bookedCount: true,
            status: true,
            spotName: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async decideRequest(proUserId: string, requestId: string, action: 'accept' | 'reject') {
    return prisma.$transaction(async (tx) => {
      const request = await tx.bookingRequest.findUnique({
        where: { id: requestId },
        include: {
          availability: true,
        },
      });

      if (!request || request.availability?.proUserId !== proUserId) {
        throw Object.assign(new Error('Request not found'), { status: 404 });
      }

      if (request.status !== BookingRequestStatus.PENDING) {
        throw Object.assign(new Error('Request already handled'), { status: 409 });
      }

      if (action === 'accept') {
        const availabilityRow = await tx.$queryRaw<Array<{ bookedCount: number; capacity: number; status: 'OPEN' | 'CLOSED' }>>`
          SELECT "bookedCount", "capacity", "status"
          FROM "ProAvailability"
          WHERE "id" = ${request.availabilityId}
          FOR UPDATE
        `;

        if (!availabilityRow.length) {
          throw Object.assign(new Error('Availability not found'), { status: 404 });
        }

        const availability = availabilityRow[0];
        if (Number(availability.bookedCount) >= Number(availability.capacity)) {
          throw Object.assign(new Error('Availability capacity reached'), { status: 409 });
        }
        if (availability.status !== 'OPEN') {
          throw Object.assign(new Error('Availability is closed'), { status: 409 });
        }

        await tx.booking.create({
          data: {
            availabilityId: request.availabilityId,
            riderUserId: request.riderUserId,
          },
        });

        await tx.proAvailability.update({
          where: { id: request.availabilityId },
          data: {
            bookedCount: { increment: 1 },
            ...(Number(availability.bookedCount) + 1 >= Number(availability.capacity)
              ? { status: 'CLOSED' as const }
              : {}),
          },
        });

        await tx.bookingRequest.update({
          where: { id: requestId },
          data: {
            status: BookingRequestStatus.ACCEPTED,
            respondedAt: new Date(),
          },
        });
      } else {
        await tx.bookingRequest.update({
          where: { id: requestId },
          data: {
            status: BookingRequestStatus.REJECTED,
            respondedAt: new Date(),
          },
        });
      }

      return { success: true, action };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async addManualBooking(proUserId: string, data: any) {
    const availability = await bookingRepository.findAvailabilityById(data.availabilityId);
    if (!availability || availability.proUserId !== proUserId) {
      throw Object.assign(new Error('Availability not found'), { status: 404 });
    }
    const booking = await bookingRepository.createBooking({
      availabilityId: data.availabilityId,
      riderUserId: data.riderUserId,
    });
    await bookingRepository.updateAvailability(data.availabilityId, {
      bookedCount: { increment: 1 },
    });
    return booking;
  }

  async listProBookings(proUserId: string) {
    return bookingRepository.listBookings({
      where: {
        availability: { proUserId },
      },
    });
  }
}

export const bookingService = new BookingService();
