import { clientPrisma as prisma, Prisma, BookingRequestStatus } from '@blobinfini/database';
import type { ProAvailability } from '@blobinfini/database';
import { bookingRepository, type SearchAvailabilityRow } from './booking.repository';
import { cacheService, CacheKeys } from '../../services/cache.service';
import { notifyBookingAccepted, notifyBookingRejected, notifyNewLessonRequest } from '../push/push.controller';
import { notifyUser } from '../../lib/socket';
import { withTransactionRetry } from '../../utils/transaction-retry';
import type { CreateAvailabilityInput } from './dto/createAvailability.dto';
import type { SearchAvailabilityInput } from './dto/searchAvailability.dto';
import type { CreateBookingRequestInput } from './dto/createRequest.dto';
import type { ProsNearbyInput } from './dto/prosNearby.dto';
import { secureLogger } from '../../utils/secure-logger';

type SearchAvailabilityFilters = SearchAvailabilityInput & {
  cursor?: string;
  limit?: number;
};

type CachedAvailability = { id: string };

type BookingRiderRow = {
  availabilityId: string;
  riderId: string;
  displayName: string | null;
  photoUrl: string | null;
};

type ManualBookingInput = {
  availabilityId: string;
  riderUserId: string;
};

const availabilityInteractionSelect = {
  eventType: true,
  riderUserId: true,
  createdAt: true,
} as const;

const availabilityStatsSelect = {
  id: true,
  sport: true,
  startAt: true,
  endAt: true,
  spotName: true,
  interactions: {
    select: availabilityInteractionSelect,
  },
} as const;

type AvailabilityInteraction = Prisma.ProAvailabilityInteractionGetPayload<{
  select: typeof availabilityInteractionSelect;
}>;

type AvailabilityStatsRow = Prisma.ProAvailabilityGetPayload<{
  select: typeof availabilityStatsSelect;
}>;

const riderRequestSelect = {
  id: true,
  riderUserId: true,
  availabilityId: true,
  message: true,
  status: true,
  respondedAt: true,
  createdAt: true,
  updatedAt: true,
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
          proProfile: {
            select: {
              id: true,
              businessName: true,
            },
          },
        },
      },
    },
  },
} as const;

type RiderRequestRow = Prisma.BookingRequestGetPayload<{
  select: typeof riderRequestSelect;
}>;

export class BookingService {
  private toUtcDayKey(dateInput: Date | string): string {
    return new Date(dateInput).toISOString().slice(0, 10);
  }

  private getUtcDayRange(dateInput: Date | string): { dayStartUtc: Date; nextDayStartUtc: Date } {
    const dayKey = this.toUtcDayKey(dateInput);
    const dayStartUtc = new Date(`${dayKey}T00:00:00.000Z`);
    const nextDayStartUtc = new Date(dayStartUtc.getTime() + 24 * 60 * 60 * 1000);
    return { dayStartUtc, nextDayStartUtc };
  }

  async createAvailability(proUserId: string, data: CreateAvailabilityInput) {
    await this.assertProHasGeo(proUserId);
    // Validate geographic coordinates
    this.validateGeoPoint(data.spotLat, data.spotLng);

    const dayKeyUtc = this.toUtcDayKey(data.startAt);

    // Advisory lock per (proUserId, UTC day) prevents concurrent creates from bypassing
    // the 1-per-day quota while avoiding unnecessary cross-day serialization.
    const availability = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${proUserId}), hashtext(${dayKeyUtc}))`;

      // Validate only one offer per day (inside lock so concurrent requests can't both pass)
      await this.validateOnlyOneOfferPerDay(proUserId, data.startAt, undefined, tx);

      // Validate time overlap with existing availabilities
      await this.validateTimeOverlap(proUserId, data.startAt, data.endAt, tx);

      return tx.proAvailability.create({ data: { ...data, proUserId } });
    });

    // Invalidate availability caches near this location to keep search results fresh
    try {
      await cacheService.invalidateAvailabilities(data.spotLat ?? undefined, data.spotLng ?? undefined);
    } catch (error) {
      secureLogger.warn('Failed to invalidate availability cache after creation', { error });
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

  private async validateOnlyOneOfferPerDay(
    proUserId: string,
    startAt: Date | string,
    excludeId?: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const db = tx ?? prisma;
    const { dayStartUtc, nextDayStartUtc } = this.getUtcDayRange(startAt);
    const dayKey = this.toUtcDayKey(startAt);

    // Check if there's already an availability for this calendar date
    const existingAvailabilities = await db.proAvailability.findMany({
      where: {
        proUserId,
        ...(excludeId ? { id: { not: excludeId } } : {}),
        startAt: {
          gte: dayStartUtc,
          lt: nextDayStartUtc
        }
      }
    });

    if (existingAvailabilities.length > 0) {
      throw Object.assign(
        new Error(`Vous avez déjà publié une offre le ${dayKey} (UTC). Limite : une offre par jour.`),
        { status: 409 }
      );
    }
  }

  private async validateTimeOverlap(
    proUserId: string,
    startAt: Date | string,
    endAt: Date | string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const db = tx ?? prisma;
    const start = new Date(startAt);
    const end = new Date(endAt);

    if (start >= end) {
      throw Object.assign(new Error('Start time must be before end time'), { status: 400 });
    }

    // Check for overlapping availabilities
    const overlappingAvailabilities = await db.proAvailability.findMany({
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
    await this.assertProHasGeo(proUserId);
    const availability = await bookingRepository.findAvailabilityById(availabilityId);
    if (!availability || availability.proUserId !== proUserId) {
      throw Object.assign(new Error('Availability not found'), { status: 404 });
    }

    // Validate geographic coordinates if provided
    if (data.spotLat !== undefined || data.spotLng !== undefined) {
      this.validateGeoPoint(data.spotLat ?? availability.spotLat, data.spotLng ?? availability.spotLng);
    }

    // Validate only one offer per day if date is being changed
    if (data.startAt !== undefined) {
      await this.validateOnlyOneOfferPerDay(proUserId, data.startAt, availabilityId);
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
      secureLogger.warn('Failed to invalidate availability cache after update', { error });
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
      secureLogger.warn('Failed to invalidate availability cache after bookedCount adjustment', { error });
    }

    return updatedAvailability;
  }

  async deleteAvailability(proUserId: string, availabilityId: string) {
    const availability = await bookingRepository.findAvailabilityById(availabilityId);
    if (!availability || availability.proUserId !== proUserId) {
      throw Object.assign(new Error('Availability not found'), { status: 404 });
    }

    // Check if there are bookings or pending requests
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
      secureLogger.warn('Failed to invalidate availability cache after deletion', { error });
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
    // Legacy key MUST include page+pageSize: same sport/location with page=2 != page=1
    const cacheKey = useCursorPagination
      ? `${CacheKeys.availabilities(filters.sport, filters.level, filters.lat, filters.lng, filters.radiusKm || 25)}:cursor:${cursor || 'start'}:limit:${effectiveLimit}`
      : `${CacheKeys.availabilities(filters.sport, filters.level, filters.lat, filters.lng, filters.radiusKm || 25)}:p${page}:s${effectiveLimit}`;

    const cachedAvailabilities = await cacheService.getAvailabilities(cacheKey) as CachedAvailability[] | null;
    if (cachedAvailabilities && cacheService.isAvailable()) {
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
    }) as SearchAvailabilityRow[];

    // Level filter in JS: Prisma 6 cannot reliably parametrize text = ANY(text[]) in raw queries
    const levelFilteredRows = rows.filter((row) =>
      Array.isArray(row.levels) && row.levels.includes(filters.level)
    );

    // Get booking data via ORM to avoid Prisma 6 raw-query type coercion issues with IN clauses
    const availabilityIds = levelFilteredRows.map((row) => row.id);
    type BookingWithRider = {
      availabilityId: string;
      riderUserId: string;
      createdAt: Date;
      rider: { id: string; riderProfile: { displayName: string | null; photoUrl: string | null } | null };
    };
    const bookingOrmRows: BookingWithRider[] = availabilityIds.length > 0
      ? await prisma.booking.findMany({
          where: { availabilityId: { in: availabilityIds } },
          select: {
            availabilityId: true,
            riderUserId: true,
            createdAt: true,
            rider: {
              select: {
                id: true,
                riderProfile: { select: { displayName: true, photoUrl: true } },
              },
            },
          },
          orderBy: { createdAt: 'desc' },
        })
      : [];
    const bookingsData: BookingRiderRow[] = bookingOrmRows.map((b) => ({
      availabilityId: b.availabilityId,
      riderId: b.rider.id,
      displayName: b.rider.riderProfile?.displayName ?? null,
      photoUrl: b.rider.riderProfile?.photoUrl ?? null,
    }));

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

    const formattedResults = levelFilteredRows.map((row) => ({
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
      // GPS précis délibérément absent: le rider voit spotName + distanceKm uniquement
      distanceKm: row.distance_m != null ? Number(row.distance_m) / 1000 : null,
      riders: ridersByAvailability.get(row.id) ?? [],
    }));

    // Cache the results for future requests
    if (formattedResults.length > 0 && cacheService.isAvailable()) {
      await cacheService.setAvailabilities(cacheKey, formattedResults, 180); // 3 minutes cache
    }

    return formattedResults;
  }

  async createRequest(riderUserId: string, data: CreateBookingRequestInput) {
    const request = await bookingRepository.createRequest({ ...data, riderUserId });

    // Notify nearby PROs about the new lesson request (non-blocking)
    this.notifyNearbyProsAboutRequest(riderUserId, request.id, data.availabilityId).catch((error) => {
      secureLogger.error('Failed to notify nearby PROs about lesson request', {
        requestId: request.id,
        error
      });
    });

    return request;
  }

  private async notifyNearbyProsAboutRequest(
    riderUserId: string,
    requestId: string,
    availabilityId: string
  ): Promise<void> {
    try {
      // Get rider info and availability details
      const [rider, availability] = await Promise.all([
        prisma.user.findUnique({
          where: { id: riderUserId },
          select: {
            riderProfile: {
              select: {
                displayName: true,
                lessonSport: true,
                lessonDate: true,
                lessonPlace: true
              }
            }
          }
        }),
        prisma.proAvailability.findUnique({
          where: { id: availabilityId },
          select: {
            spotLat: true,
            spotLng: true,
            spotName: true,
            sport: true
          }
        })
      ]);

      if (!availability?.spotLat || !availability?.spotLng) {
        secureLogger.warn('Cannot notify PROs - availability has no location', { availabilityId });
        return;
      }

      const riderName = rider?.riderProfile?.displayName || 'Un rider';
      const sport = availability.sport;
      const spotName = availability.spotName || rider?.riderProfile?.lessonPlace;
      const lessonDate = rider?.riderProfile?.lessonDate?.toISOString();

      // Find all PROs within their configured radius using PostGIS
      type NearbyProRow = {
        userId: string;
        radiusKm: number;
        distanceKm: number;
        notificationPreferences: any;
      };

      const nearbyPros = await prisma.$queryRaw<NearbyProRow[]>`
        SELECT
          pp."userId",
          pp."radiusKm",
          pp."notificationPreferences",
          ST_Distance(
            ST_SetSRID(ST_MakePoint(${availability.spotLng}, ${availability.spotLat}), 4326)::geography,
            ST_SetSRID(ST_MakePoint(pp."lng", pp."lat"), 4326)::geography
          ) / 1000.0 AS "distanceKm"
        FROM "ProProfile" pp
        WHERE pp."lat" IS NOT NULL
          AND pp."lng" IS NOT NULL
          AND ST_DWithin(
            ST_SetSRID(ST_MakePoint(${availability.spotLng}, ${availability.spotLat}), 4326)::geography,
            ST_SetSRID(ST_MakePoint(pp."lng", pp."lat"), 4326)::geography,
            pp."radiusKm" * 1000
          )
          AND pp."userId" != (
            SELECT "proUserId" FROM "ProAvailability" WHERE "id" = ${availabilityId}
          )
        LIMIT 100
      `;

      if (nearbyPros.length === 0) {
        secureLogger.info('No nearby PROs found for lesson request notification', {
          requestId,
          location: { lat: availability.spotLat, lng: availability.spotLng }
        });
        return;
      }

      // Filter PROs based on notification preferences
      const eligiblePros = nearbyPros.filter((pro: NearbyProRow) => {
        const prefs = pro.notificationPreferences || {};

        // Default to enabled if preferences not set
        const pushEnabled = prefs.pushEnabled !== false;

        // Check sport-specific preferences
        const sportKey = sport === 'surf' ? 'notifyForSurf' : 'notifyForKitesurf';
        const sportEnabled = prefs[sportKey] !== false; // Default to true

        return pushEnabled && sportEnabled;
      });

      if (eligiblePros.length === 0) {
        secureLogger.info('No eligible PROs after filtering preferences', {
          requestId,
          totalNearby: nearbyPros.length,
          sport
        });
        return;
      }

      // Check Redis throttling (5-minute window) and send notifications
      const redisClient = cacheService.getClient();
      const notificationPromises = eligiblePros.map(async (pro: NearbyProRow) => {
        try {
          // Throttle key: pro:{userId}:lesson-request-notif
          const throttleKey = `pro:${pro.userId}:lesson-request-notif`;

          if (redisClient) {
            // Check if notification was sent in last 5 minutes
            const lastNotified = await redisClient.get(throttleKey);
            if (lastNotified) {
              secureLogger.debug('Notification throttled', {
                proUserId: pro.userId,
                lastNotified
              });
              return; // Skip this PRO due to throttling
            }

            // Set throttle with 5-minute expiry
            await redisClient.setex(throttleKey, 300, new Date().toISOString());
          }

          // Send push notification
          await notifyNewLessonRequest(pro.userId, {
            riderName,
            sport,
            distanceKm: pro.distanceKm,
            lessonDate,
            spotName: spotName || undefined
          });

          // Send Socket.io real-time notification
          notifyUser(pro.userId, 'new-lesson-request', {
            requestId,
            riderName,
            sport,
            distanceKm: Math.round(pro.distanceKm * 10) / 10,
            lessonDate,
            spotName,
            spotLat: availability.spotLat,
            spotLng: availability.spotLng
          });
        } catch (error) {
          secureLogger.error('Failed to notify individual PRO', { proUserId: pro.userId, error });
        }
      });

      const results = await Promise.allSettled(notificationPromises);
      const successCount = results.filter((r: PromiseSettledResult<void>) => r.status === 'fulfilled').length;

      secureLogger.info('Notified nearby PROs about lesson request', {
        requestId,
        totalNearby: nearbyPros.length,
        eligiblePros: eligiblePros.length,
        successCount
      });
    } catch (error) {
      secureLogger.error('Error in notifyNearbyProsAboutRequest', { requestId, error });
      throw error;
    }
  }

  async listRiderRequests(riderUserId: string) {
    const requests: RiderRequestRow[] = await prisma.bookingRequest.findMany({
      where: { riderUserId },
      select: riderRequestSelect,
      orderBy: { createdAt: 'desc' },
    });

    return requests.map((request) => ({
      ...request,
      availability: {
        ...request.availability,
        pro: {
          proPublicId: request.availability.pro?.proProfile?.id ?? null,
          businessName: request.availability.pro?.proProfile?.businessName ?? null,
        },
      },
    }));
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
      let conversationId: string | undefined;
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

        // Re-check request status after acquiring the lock (TOCTOU guard):
        // concurrent accepts could both pass the initial PENDING check before either commits.
        const freshRequest = await tx.bookingRequest.findUnique({
          where: { id: requestId },
          select: { status: true },
        });
        if (!freshRequest || freshRequest.status !== BookingRequestStatus.PENDING) {
          throw Object.assign(new Error('Request already handled'), { status: 409 });
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

        conversationId = conversation.id;
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
        requestData: request, // Return request data for notifications
        conversationId
      };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    }, 7, 150);

    // After successful transaction, send push notifications
    try {
      const { requestData, conversationId } = result;

      if (action === 'accept') {
        await notifyBookingAccepted(requestData.riderUserId, {
          proName: requestData.availability?.pro?.proProfile?.businessName || 'Instructeur',
          spotName: requestData.availability?.spotName || 'Spot à définir',
          dateTime: requestData.availability?.startAt?.toISOString() || new Date().toISOString(),
          conversationId, // Conversation créée automatiquement
        });
      } else {
        await notifyBookingRejected(requestData.riderUserId, {
          proName: requestData.availability?.pro?.proProfile?.businessName || 'Instructeur',
          spotName: requestData.availability?.spotName || 'Spot à définir',
          reason: 'Le créneau n\'est plus disponible'
        });
      }
    } catch (notificationError) {
      // Log notification errors but don't fail the request
      secureLogger.error('Failed to send push notification', { error: notificationError });
    }

    return { success: true, action };
  }

  async addManualBooking(proUserId: string, data: ManualBookingInput) {
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

  async trackAvailabilityInteraction(availabilityId: string, riderUserId: string, eventType: 'VIEW' | 'CLICK') {
    // Fetch availability to check existence and prevent self-tracking
    const availability = await prisma.proAvailability.findUnique({
      where: { id: availabilityId },
      select: { proUserId: true },
    });

    if (!availability) {
      throw Object.assign(new Error('Availability not found'), { status: 404 });
    }

    // Prevent PROs from tracking their own availabilities
    if (availability.proUserId === riderUserId) {
      throw Object.assign(new Error('Cannot track your own availability'), { status: 403 });
    }

    // Upsert interaction for idempotence
    await prisma.proAvailabilityInteraction.upsert({
      where: {
        availabilityId_riderUserId_eventType: {
          availabilityId,
          riderUserId,
          eventType,
        },
      },
      update: {
        // Update timestamp on re-interaction
        createdAt: new Date(),
      },
      create: {
        availabilityId,
        riderUserId,
        eventType,
      },
    });
  }

  async getProAvailabilityStats(proUserId: string) {
    // Get all availabilities for this PRO
    const availabilities: AvailabilityStatsRow[] = await prisma.proAvailability.findMany({
      where: { proUserId },
      select: availabilityStatsSelect,
      orderBy: {
        startAt: 'desc',
      },
    });

    let totalViews = 0;
    let totalClicks = 0;

    const slots = availabilities.map((availability) => {
      const interactions = availability.interactions as AvailabilityInteraction[];
      // Count unique riders per event type
      const uniqueViewers = new Set(
        interactions
          .filter((i) => i.eventType === 'VIEW')
          .map((i) => i.riderUserId)
      );
      const uniqueClickers = new Set(
        interactions
          .filter((i) => i.eventType === 'CLICK')
          .map((i) => i.riderUserId)
      );

      const uniqueViews = uniqueViewers.size;
      const uniqueClicks = uniqueClickers.size;

      totalViews += uniqueViews;
      totalClicks += uniqueClicks;

      // Calculate conversion rate (clicks / views)
      const conversionRate = uniqueViews > 0 ? ((uniqueClicks / uniqueViews) * 100).toFixed(1) : '0.0';

      // Find last interaction
      const sortedInteractions = interactions.sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
      );
      const lastInteraction = sortedInteractions[0];

      return {
        availabilityId: availability.id,
        sport: availability.sport,
        startAt: availability.startAt,
        endAt: availability.endAt,
        spotName: availability.spotName,
        stats: {
          uniqueViews,
          uniqueClicks,
          conversionRate,
          lastInteractionAt: lastInteraction?.createdAt || null,
          lastInteractionType: lastInteraction?.eventType || null,
        },
      };
    });

    // Calculate average conversion rate across all slots with views
    const slotsWithViews = slots.filter((s) => s.stats.uniqueViews > 0);
    const avgConversionRate =
      slotsWithViews.length > 0
        ? (
            slotsWithViews.reduce((sum, s) => sum + parseFloat(s.stats.conversionRate), 0) /
            slotsWithViews.length
          ).toFixed(1)
        : '0.0';

    return {
      summary: {
        totalSlots: availabilities.length,
        totalViews,
        totalClicks,
        averageConversionRate: avgConversionRate,
      },
      slots,
    };
  }

  private async assertProHasGeo(proUserId: string) {
    const profile = await prisma.proProfile.findUnique({
      where: { userId: proUserId },
      select: { lat: true, lng: true },
    });

    if (!profile || profile.lat == null || profile.lng == null) {
      throw Object.assign(new Error('Localisation obligatoire pour publier des créneaux. Ajoutez votre géolocalisation dans votre profil.'), { status: 400 });
    }
  }

  async listNearbyPros(params: ProsNearbyInput) {
    this.validateGeoPoint(params.lat, params.lng);
    const rows = await bookingRepository.findNearbyPros(params);

    return rows.map((row) => ({
      proId: row.proUserId,
      proPublicId: row.proPublicId,
      businessName: row.businessName,
      photoUrl: row.photoUrl,
      verified: row.verified,
      lat: row.lat,
      lng: row.lng,
      distanceKm: Number(row.distance_m) / 1000,
      sports: row.sports ?? [],
      openAvailabilityCount: Number(row.openAvailabilityCount ?? 0),
    }));
  }
}

export const bookingService = new BookingService();
