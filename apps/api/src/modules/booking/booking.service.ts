import { clientPrisma as prisma, Prisma, BookingRequestStatus } from '@blobinfini/database';
import type { ProAvailability } from '@blobinfini/database';
import { bookingRepository } from './booking.repository';
import { cacheService, CacheKeys } from '../../services/cache.service';
import { notifyBookingAccepted, notifyBookingRejected } from '../push/push.controller';
import { withTransactionRetry } from '../../utils/transaction-retry';
import type { CreateAvailabilityInput } from './dto/createAvailability.dto';
import type { SearchAvailabilityInput } from './dto/searchAvailability.dto';

type SearchAvailabilityFilters = SearchAvailabilityInput & {
  cursor?: string;
  limit?: number;
};

type CachedAvailability = { id: string };

export class BookingService {
  async createAvailability(proUserId: string, data: CreateAvailabilityInput) {
    // Validate geographic coordinates
    this.validateGeoPoint(data.spotLat, data.spotLng);

    // Validate time overlap with existing availabilities
    await this.validateTimeOverlap(proUserId, data.startAt, data.endAt);

    const availability = await bookingRepository.createAvailability({ ...data, proUserId });

    // Invalidate availability caches near this location to keep search results fresh
    try {
      await cacheService.invalidateAvailabilities(data.spotLat ?? undefined, data.spotLng ?? undefined);
    } catch (error) {
      console.warn('⚠️  Failed to invalidate availability cache after creation', error);
    }

    return availability;
  }

  private validateGeoPoint(lat?: number, lng?: number): void {
    if (lat !== undefined && lng !== undefined) {
      if (lat < -90 || lat > 90) {
        throw Object.assign(new Error('Invalid latitude: must be between -90 and 90'), { status: 400 });
      }
      if (lng < -180 || lng > 180) {
        throw Object.assign(new Error('Invalid longitude: must be between -180 and 180'), { status: 400 });
      }
    }
  }

  private async validateTimeOverlap(proUserId: string, startAt: Date | string, endAt: Date | string): Promise<void> {
    const start = new Date(startAt);
    const end = new Date(endAt);

    if (start >= end) {
      throw Object.assign(new Error('Start time must be before end time'), { status: 400 });
    }

    // Check for overlapping availabilities
    const overlappingAvailabilities = await prisma.proAvailability.findMany({
      where: {
        proUserId,
        OR: [
          // New availability starts during existing one
          {
            startAt: { lte: start },
            endAt: { gt: start }
          },
          // New availability ends during existing one
          {
            startAt: { lt: end },
            endAt: { gte: end }
          },
          // New availability completely contains existing one
          {
            startAt: { gte: start },
            endAt: { lte: end }
          }
        ]
      }
    }) as ProAvailability[];

    if (overlappingAvailabilities.length > 0) {
      const conflictTimes = overlappingAvailabilities
        .map((availability: ProAvailability) => `${availability.startAt.toISOString()} - ${availability.endAt.toISOString()}`)
        .join(', ');
      throw Object.assign(
        new Error(`Time overlap detected with existing availability: ${conflictTimes}`),
        { status: 409 }
      );
    }
  }

  private async validateTimeOverlapForUpdate(
    proUserId: string,
    availabilityId: string,
    startAt: Date | string,
    endAt: Date | string
  ): Promise<void> {
    const start = new Date(startAt);
    const end = new Date(endAt);

    if (start >= end) {
      throw Object.assign(new Error('Start time must be before end time'), { status: 400 });
    }

    // Check for overlapping availabilities (excluding the current one being updated)
    const overlappingAvailabilities = await prisma.proAvailability.findMany({
      where: {
        proUserId,
        id: { not: availabilityId }, // Exclude current availability
        OR: [
          // New availability starts during existing one
          {
            startAt: { lte: start },
            endAt: { gt: start }
          },
          // New availability ends during existing one
          {
            startAt: { lt: end },
            endAt: { gte: end }
          },
          // New availability completely contains existing one
          {
            startAt: { gte: start },
            endAt: { lte: end }
          }
        ]
      }
    }) as ProAvailability[];

    if (overlappingAvailabilities.length > 0) {
      const conflictTimes = overlappingAvailabilities
        .map((availability: ProAvailability) => `${availability.startAt.toISOString()} - ${availability.endAt.toISOString()}`)
        .join(', ');
      throw Object.assign(
        new Error(`Time overlap detected with existing availability: ${conflictTimes}`),
        { status: 409 }
      );
    }
  }

  async listAvailabilities(proUserId: string, query: Prisma.ProAvailabilityFindManyArgs) {
    return bookingRepository.listAvailabilities(proUserId, query);
  }

  async updateAvailability(proUserId: string, availabilityId: string, data: Partial<CreateAvailabilityInput>) {
    const availability = await bookingRepository.findAvailabilityById(availabilityId);
    if (!availability || availability.proUserId !== proUserId) {
      throw Object.assign(new Error('Availability not found'), { status: 404 });
    }

    // Validate geographic coordinates if provided
    if (data.spotLat !== undefined || data.spotLng !== undefined) {
      this.validateGeoPoint(data.spotLat ?? availability.spotLat, data.spotLng ?? availability.spotLng);
    }

    // Validate time overlap if dates are being changed
    if (data.startAt !== undefined || data.endAt !== undefined) {
      await this.validateTimeOverlapForUpdate(
        proUserId,
        availabilityId,
        data.startAt ?? availability.startAt,
        data.endAt ?? availability.endAt
      );
    }

    const updated = await bookingRepository.updateAvailability(availabilityId, data);

    try {
      await cacheService.invalidateAvailabilities(updated.spotLat ?? undefined, updated.spotLng ?? undefined);
    } catch (error) {
      console.warn('⚠️  Failed to invalidate availability cache after update', error);
    }

    return updated;
  }

  async adjustBookedCount(proUserId: string, availabilityId: string, delta: number) {
    const updatedAvailability = await withTransactionRetry(async () => {
      return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const availabilityRow = await tx.$queryRaw<Array<{
          proUserId: string;
          bookedCount: number;
          capacity: number;
          status: 'OPEN' | 'CLOSED';
          spotLat: number | null;
          spotLng: number | null;
        }>>`
          SELECT "proUserId", "bookedCount", "capacity", "status", "spotLat", "spotLng"
          FROM "ProAvailability"
          WHERE "id" = ${availabilityId}
          FOR UPDATE
        `;

        const availability = availabilityRow[0];

        if (!availability || availability.proUserId !== proUserId) {
          throw Object.assign(new Error('Availability not found'), { status: 404 });
        }

        const confirmedBookings = await tx.booking.count({
          where: { availabilityId }
        });

        const nextBookedCount = availability.bookedCount + delta;

        if (nextBookedCount < confirmedBookings) {
          throw Object.assign(
            new Error('Cannot set bookedCount below confirmed bookings'),
            { status: 409 }
          );
        }

        if (nextBookedCount < 0) {
          throw Object.assign(new Error('Booked count cannot be negative'), { status: 400 });
        }

        if (nextBookedCount > availability.capacity) {
          throw Object.assign(
            new Error('Cannot exceed availability capacity'),
            { status: 409 }
          );
        }

        const nextStatus = nextBookedCount >= availability.capacity ? 'CLOSED' as const : 'OPEN' as const;

        return tx.proAvailability.update({
          where: { id: availabilityId },
          data: {
            bookedCount: nextBookedCount,
            status: nextStatus
          }
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    }, 7, 150);

    try {
      await cacheService.invalidateAvailabilities(
        updatedAvailability.spotLat ?? undefined,
        updatedAvailability.spotLng ?? undefined
      );
    } catch (error) {
      console.warn('⚠️  Failed to invalidate availability cache after bookedCount adjustment', error);
    }

    return updatedAvailability;
  }

  async deleteAvailability(proUserId: string, availabilityId: string) {
    const availability = await bookingRepository.findAvailabilityById(availabilityId);
    if (!availability || availability.proUserId !== proUserId) {
      throw Object.assign(new Error('Availability not found'), { status: 404 });
    }

    // Check if there are any bookings or pending requests
    const bookingCount = await prisma.booking.count({
      where: { availabilityId },
    });

    const pendingRequestCount = await prisma.bookingRequest.count({
      where: {
        availabilityId,
        status: BookingRequestStatus.PENDING,
      },
    });

    if (bookingCount > 0) {
      throw Object.assign(
        new Error('Cannot delete availability with existing bookings'),
        { status: 409 }
      );
    }

    if (pendingRequestCount > 0) {
      throw Object.assign(
        new Error('Cannot delete availability with pending requests'),
        { status: 409 }
      );
    }

    // Delete the availability
    await prisma.proAvailability.delete({
      where: { id: availabilityId },
    });

    // Invalidate cache
    try {
      await cacheService.invalidateAvailabilities(availability.spotLat ?? undefined, availability.spotLng ?? undefined);
    } catch (error) {
      console.warn('⚠️  Failed to invalidate availability cache after deletion', error);
    }

    return { success: true, message: 'Availability deleted' };
  }

  async searchAvailabilities(filters: SearchAvailabilityFilters) {
    // Support both cursor-based and legacy pagination
    const cursor = filters.cursor;
    const limit = filters.limit ?? 20;
    const page = filters.page ?? 1;
    const pageSize = filters.pageSize ?? 20;

    const useCursorPagination = cursor !== undefined || !page;
    const effectiveLimit = limit || pageSize;

    // Check cache first for availability search (cursor-aware)
    const cacheKey = useCursorPagination
      ? `${CacheKeys.availabilities(filters.sport, filters.level, filters.lat, filters.lng, filters.radiusKm || 25)}:cursor:${cursor || 'start'}`
      : CacheKeys.availabilities(filters.sport, filters.level, filters.lat, filters.lng, filters.radiusKm || 25);

    const cachedAvailabilities = await cacheService.getAvailabilities(cacheKey) as CachedAvailability[] | null;
    if (cachedAvailabilities && cacheService.isAvailable()) {
      console.log('🚀 Cache hit for availabilities');

      if (useCursorPagination) {
        // Cursor-based pagination on cached results
        const startIndex = cursor ? cachedAvailabilities.findIndex((availability: CachedAvailability) => availability.id === cursor) + 1 : 0;
        const endIndex = Math.min(startIndex + effectiveLimit, cachedAvailabilities.length);
        return cachedAvailabilities.slice(startIndex, endIndex);
      }

      // Legacy pagination on cached results
      const offset = (page - 1) * effectiveLimit;
      return cachedAvailabilities.slice(offset, offset + effectiveLimit);
    }

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

    // Get booking data with a single optimized query instead of N+1
    const availabilityIds = rows.map((row: { id: string }) => row.id);
    const bookingsData = availabilityIds.length > 0
      ? await prisma.$queryRaw<Array<any>>`
          SELECT
            b."availabilityId",
            ru."id" as "riderId",
            ru."email" as "riderEmail",
            rp."displayName",
            rp."photoUrl"
          FROM "Booking" b
          JOIN "User" ru ON ru."id" = b."riderUserId"
          LEFT JOIN "RiderProfile" rp ON rp."userId" = ru."id"
          WHERE b."availabilityId" IN (${Prisma.join(availabilityIds)})
          ORDER BY b."createdAt" DESC
        `
      : [];

    // Group bookings by availability for efficient lookup
    const ridersByAvailability = new Map<string, Array<{ id: string; displayName: string; avatarUrl: string | null }>>();
    for (const booking of bookingsData) {
      const collection = ridersByAvailability.get(booking.availabilityId) ?? [];
      collection.push({
        id: booking.riderId,
        displayName: booking.displayName ?? 'Rider',
        avatarUrl: booking.photoUrl ?? null,
      });
      ridersByAvailability.set(booking.availabilityId, collection.slice(0, 6));
    }

    const formattedResults = rows.map((row: any) => ({
      id: row.id,
      pro: {
        userId: row.proUserId,
        businessName: row.businessName ?? null,
      },
      sport: row.sport,
      levels: row.levels,
      startAt: row.startAt,
      endAt: row.endAt,
      capacity: Number(row.capacity),
      bookedCount: Number(row.bookedCount),
      status: row.status,
      spotName: row.spotName,
      spotLat: row.spotLat,
      spotLng: row.spotLng,
      distanceKm: row.distance_m != null ? Number(row.distance_m) / 1000 : null,
      riders: ridersByAvailability.get(row.id) ?? [],
    }));

    // Cache the results for future requests
    if (formattedResults.length > 0 && cacheService.isAvailable()) {
      await cacheService.setAvailabilities(cacheKey, formattedResults, 180); // 3 minutes cache
      console.log(`💾 Cached ${formattedResults.length} availability results`);
    }

    return formattedResults;
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
    // Execute the database transaction with retry logic for serialization failures
    const result = await withTransactionRetry(async () => {
      return await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const request = await tx.bookingRequest.findUnique({
        where: { id: requestId },
        include: {
          availability: {
            include: {
              pro: {
                include: {
                  proProfile: true
                }
              }
            }
          }
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

        // 💬 Créer automatiquement une conversation entre le PRO et le Rider
        let conversation = await tx.conversation.findFirst({
          where: {
            members: {
              every: {
                userId: { in: [proUserId, request.riderUserId] }
              }
            }
          }
        });

        if (!conversation) {
          conversation = await tx.conversation.create({ data: {} });
          await tx.conversationMember.createMany({
            data: [
              { conversationId: conversation.id, userId: proUserId },
              { conversationId: conversation.id, userId: request.riderUserId },
            ],
            skipDuplicates: true,
          });
        }

        // Stocker l'ID de la conversation pour l'envoyer dans la notification
        (request as any).conversationId = conversation.id;
      } else {
        await tx.bookingRequest.update({
          where: { id: requestId },
          data: {
            status: BookingRequestStatus.REJECTED,
            respondedAt: new Date(),
          },
        });
      }

      return {
        success: true,
        action,
        requestData: request // Return request data for notifications
      };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    }, 7, 150);

    // After successful transaction, send push notifications
    try {
      const { requestData } = result;

      if (action === 'accept') {
        console.log('📬 Sending booking accepted notification');
        await notifyBookingAccepted(requestData.riderUserId, {
          proName: requestData.availability?.pro?.proProfile?.businessName || 'Instructeur',
          spotName: requestData.availability?.spotName || 'Spot à définir',
          dateTime: requestData.availability?.startAt?.toISOString() || new Date().toISOString(),
          conversationId: (requestData as any).conversationId, // Conversation créée automatiquement
        });
      } else {
        console.log('📬 Sending booking rejected notification');
        await notifyBookingRejected(requestData.riderUserId, {
          proName: requestData.availability?.pro?.proProfile?.businessName || 'Instructeur',
          spotName: requestData.availability?.spotName || 'Spot à définir',
          reason: 'Le créneau n\'est plus disponible'
        });
      }
    } catch (notificationError) {
      // Log notification errors but don't fail the request
      console.error('❌ Failed to send push notification:', notificationError);
    }

    return { success: true, action };
  }

  async addManualBooking(proUserId: string, data: any) {
    return await withTransactionRetry(async () => {
      return await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const availability = await tx.proAvailability.findUnique({
          where: { id: data.availabilityId }
        });

        if (!availability || availability.proUserId !== proUserId) {
          throw Object.assign(new Error('Availability not found'), { status: 404 });
        }

        const booking = await tx.booking.create({
          data: {
            availabilityId: data.availabilityId,
            riderUserId: data.riderUserId,
          },
        });

        const nextBookedCount = availability.bookedCount + 1;
        await tx.proAvailability.update({
          where: { id: data.availabilityId },
          data: {
            bookedCount: { increment: 1 },
            ...(nextBookedCount >= availability.capacity ? { status: 'CLOSED' as const } : {}),
          },
        });

        return booking;
      });
    }, 7, 150);
  }

  async listProBookings(proUserId: string) {
    return bookingRepository.listBookings({
      where: {
        availability: { proUserId },
      },
      include: {
        rider: {
          select: {
            id: true,
            riderProfile: {
              select: {
                id: true,
                displayName: true,
                photoUrl: true,
                sex: true,
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
            spotName: true,
            spotLat: true,
            spotLng: true,
            capacity: true,
            bookedCount: true,
            status: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async listRiderBookings(riderUserId: string) {
    return bookingRepository.listBookings({
      where: {
        riderUserId,
      },
      include: {
        availability: {
          select: {
            id: true,
            sport: true,
            levels: true,
            startAt: true,
            endAt: true,
            spotName: true,
            spotLat: true,
            spotLng: true,
            capacity: true,
            bookedCount: true,
            status: true,
            pro: {
              select: {
                id: true,
                proProfile: {
                  select: {
                    businessName: true,
                    photoUrl: true,
                  },
                },
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }
}

export const bookingService = new BookingService();
