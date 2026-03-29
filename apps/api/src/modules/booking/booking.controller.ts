import { Router, type Request, type Response, type NextFunction } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { z } from 'zod';
import { clientPrisma as prisma } from '@blobinfini/database';
import { requireAuth, requireVerifiedEmail, requireAdmin } from '../auth/auth.guard';
import { requirePermissions } from '../admin/admin.guard';
import { bookingService } from './booking.service';
import { createAvailabilitySchema } from './dto/createAvailability.dto';
import { createBookingRequestSchema } from './dto/createRequest.dto';
import { decideBookingRequestSchema } from './dto/decideRequest.dto';
import { searchAvailabilitySchema } from './dto/searchAvailability.dto';
import { prosNearbySchema } from './dto/prosNearby.dto';
import { computeZoneLarge, recordServerAnalyticsEvent } from '../../services/analytics/events.service';
import { getClientIp } from '../../lib/client-ip';
import { hashIpHmacSafe } from '../../lib/hash-ip';
import {
  assertFranceLaunchLocation,
  assertFranceLaunchLocationPresence,
  isFranceLaunchGuardError,
} from '../../lib/france-launch-guard';
import { secureLogger } from '../../utils/secure-logger';

const isBookingRequestRateLimitDisabled = () =>
  String(process.env.RATE_LIMIT_DISABLED_FOR_BOOKING_REQUESTS ?? '').toLowerCase() === 'true';

const shouldSkipBookingRequestRateLimit = () => {
  if (process.env.NODE_ENV === 'test') {
    return process.env.ENABLE_RATE_LIMIT_IN_TESTS !== 'true';
  }
  if (process.env.NODE_ENV !== 'production' && isBookingRequestRateLimitDisabled()) {
    return true;
  }
  return false;
};

// Anti-spam: max 5 booking requests per 15-minute window per rider
const bookingRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skip: shouldSkipBookingRequestRateLimit,
  keyGenerator: (req: Request) => {
    const userId = (req as { user?: { id: string } }).user?.id;
    return userId ? `rider:${userId}:booking_request` : ipKeyGenerator(req.ip ?? '');
  },
  handler: (req: Request, res: Response) => {
    const userId = (req as { user?: { id: string } }).user?.id;
    secureLogger.security('Rate limit exceeded: POST /booking/requests', {
      userId,
      ipHash: hashIpHmacSafe(getClientIp(req)),
    });
    const retryAfter = Math.ceil(
      (((req as { rateLimit?: { resetTime?: Date } }).rateLimit?.resetTime?.getTime() ?? Date.now() + 900_000) - Date.now()) / 1000
    );
    return res.status(429).json({ error: 'RATE_LIMIT_EXCEEDED', retryAfter });
  },
});

export const bookingRouter = Router();

bookingRouter.use(requireAuth, requireVerifiedEmail);

type AuthenticatedRequest = Request & { user?: { id: string; role?: string } };
type ErrorWithStatus = { status?: number; message?: string };

const isErrorWithStatus = (error: unknown): error is ErrorWithStatus =>
  typeof error === 'object' && error !== null && ('status' in error || 'message' in error);

const getErrorStatus = (error: unknown): number =>
  isErrorWithStatus(error) && typeof error.status === 'number' ? error.status : 500;

const getErrorMessage = (error: unknown): string =>
  isErrorWithStatus(error) && typeof error.message === 'string' ? error.message : 'Internal error';

const sendFranceLaunchGuardError = (res: Response, error: unknown): Response | null => {
  if (!isFranceLaunchGuardError(error)) {
    return null;
  }

  return res.status(error.status).json({
    error: error.code,
    message: error.message,
    ...(error.details ? { details: error.details } : {}),
  });
};

const getConsentHash = (req: Request) => {
  const header = req.headers['x-consent-hash'];
  return typeof header === 'string' && header.trim().length > 0 ? header : null;
};

const ensureRole =
  (role: 'RIDER' | 'PRO') => (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const current = req.user;
  if (!current || current.role !== role) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  return next();
};

bookingRouter.post('/availability', ensureRole('PRO'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = createAvailabilitySchema.parse(req.body);
    const current = req.user;
    if (!current) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const availability = await bookingService.createAvailability(current.id, body);
    const consentHash = getConsentHash(req);
    void recordServerAnalyticsEvent({
      eventType: 'PRO_SLOTS_UPDATE',
      actorType: 'PRO',
      actorId: current.id,
      consentHash,
      sport: availability.sport,
      zoneLarge: computeZoneLarge(availability.spotLat, availability.spotLng),
      occurredAt: availability.createdAt,
    });
    return res.status(201).json(availability);
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    const franceLaunchError = sendFranceLaunchGuardError(res, error);
    if (franceLaunchError) {
      return franceLaunchError;
    }
    const status = getErrorStatus(error);
    return res.status(status).json({ error: getErrorMessage(error) });
  }
});

bookingRouter.get('/availability/me', ensureRole('PRO'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const current = req.user;
    if (!current) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const availabilities = await bookingService.listAvailabilities(current.id, {});
    return res.json({ availabilities });
  } catch (error: unknown) {
    const status = getErrorStatus(error);
    return res.status(status).json({ error: getErrorMessage(error) });
  }
});

bookingRouter.get('/availability/me/stats', ensureRole('PRO'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const current = req.user;
    if (!current) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const stats = await bookingService.getProAvailabilityStats(current.id);
    return res.json(stats);
  } catch (error: unknown) {
    const status = getErrorStatus(error);
    return res.status(status).json({ error: getErrorMessage(error) });
  }
});

bookingRouter.patch('/availability/:id', ensureRole('PRO'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const schema = createAvailabilitySchema.partial();
    const body = schema.parse(req.body);
    const current = req.user;
    if (!current) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const availability = await bookingService.updateAvailability(current.id, req.params.id, body);
    const consentHash = getConsentHash(req);
    void recordServerAnalyticsEvent({
      eventType: 'PRO_SLOTS_UPDATE',
      actorType: 'PRO',
      actorId: current.id,
      consentHash,
      sport: availability.sport,
      zoneLarge: computeZoneLarge(availability.spotLat, availability.spotLng),
      occurredAt: availability.updatedAt,
    });
    return res.json(availability);
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    const franceLaunchError = sendFranceLaunchGuardError(res, error);
    if (franceLaunchError) {
      return franceLaunchError;
    }
    const status = getErrorStatus(error);
    return res.status(status).json({ error: getErrorMessage(error) });
  }
});

bookingRouter.patch(
  '/availability/:id/adjust-booked',
  requireAdmin,
  requirePermissions('bookings.manage'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const schema = z.object({
        delta:  z.number().int().min(-10).max(10),
        reason: z.string().min(10).max(500),
      });
      const { delta, reason } = schema.parse(req.body);
      const current = req.user;
      if (!current) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      const availability = await bookingService.adjustBookedCount(current.id, req.params.id, delta, reason);
      return res.json(availability);
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid input', details: error.errors });
      }
      const status = getErrorStatus(error);
      return res.status(status).json({ error: getErrorMessage(error) });
    }
  }
);

bookingRouter.delete('/availability/:id', ensureRole('PRO'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const current = req.user;
    if (!current) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const result = await bookingService.deleteAvailability(current.id, req.params.id);
    return res.json(result);
  } catch (error: unknown) {
    const status = getErrorStatus(error);
    return res.status(status).json({ error: getErrorMessage(error) });
  }
});

bookingRouter.get('/availability/search', async (req: AuthenticatedRequest, res: Response) => {
  try {
    assertFranceLaunchLocationPresence(req.query.lat !== undefined, req.query.lng !== undefined);
    const query = searchAvailabilitySchema.parse({
      ...req.query,
      lat: req.query.lat !== undefined ? Number(req.query.lat) : undefined,
      lng: req.query.lng !== undefined ? Number(req.query.lng) : undefined,
      radiusKm: req.query.radiusKm ? Number(req.query.radiusKm) : undefined,
      page: req.query.page ? Number(req.query.page) : undefined,
      pageSize: req.query.pageSize ? Number(req.query.pageSize) : undefined,
    });
    assertFranceLaunchLocation({ lat: query.lat, lng: query.lng });
    const results = await bookingService.searchAvailabilities(query);
    if (req.user?.role === 'RIDER') {
      const consentHash = getConsentHash(req);
      void recordServerAnalyticsEvent({
        eventType: 'RIDER_SEARCH_PROS',
        actorType: 'RIDER',
        actorId: req.user.id,
        consentHash,
        sport: query.sport,
        zoneLarge: computeZoneLarge(query.lat, query.lng),
      });
    }
    return res.json({ results });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    const franceLaunchError = sendFranceLaunchGuardError(res, error);
    if (franceLaunchError) {
      return franceLaunchError;
    }
    const status = getErrorStatus(error);
    return res.status(status).json({ error: getErrorMessage(error) });
  }
});

bookingRouter.post('/availability/:id/track', ensureRole('RIDER'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const trackInteractionSchema = z.object({
      eventType: z.enum(['VIEW', 'CLICK']),
    });
    const { eventType } = trackInteractionSchema.parse(req.body);
    const current = req.user;
    if (!current) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const availabilityId = req.params.id;

    await bookingService.trackAvailabilityInteraction(availabilityId, current.id, eventType);
    return res.status(204).send();
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    const status = getErrorStatus(error);
    return res.status(status).json({ error: getErrorMessage(error) });
  }
});

bookingRouter.get('/pros/nearby', ensureRole('RIDER'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    assertFranceLaunchLocationPresence(req.query.lat !== undefined, req.query.lng !== undefined);
    const query = prosNearbySchema.parse({
      lat: req.query.lat !== undefined ? Number(req.query.lat) : undefined,
      lng: req.query.lng !== undefined ? Number(req.query.lng) : undefined,
      radiusKm: req.query.radiusKm ? Number(req.query.radiusKm) : undefined,
      sport: typeof req.query.sport === 'string' ? req.query.sport : undefined,
    });
    assertFranceLaunchLocation({ lat: query.lat, lng: query.lng });

    const pros = await bookingService.listNearbyPros(query);
    const consentHash = getConsentHash(req);
    void recordServerAnalyticsEvent({
      eventType: 'RIDER_SEARCH_PROS',
      actorType: 'RIDER',
      actorId: req.user?.id as string,
      consentHash,
      sport: query.sport ?? null,
      zoneLarge: computeZoneLarge(query.lat, query.lng),
    });
    return res.json({ pros });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    const franceLaunchError = sendFranceLaunchGuardError(res, error);
    if (franceLaunchError) {
      return franceLaunchError;
    }
    const status = getErrorStatus(error);
    return res.status(status).json({ error: getErrorMessage(error) });
  }
});

bookingRouter.post('/requests', ensureRole('RIDER'), bookingRequestLimiter, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = createBookingRequestSchema.parse(req.body);
    const current = req.user;
    if (!current) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const request = await bookingService.createRequest(current.id, body);
    const availability = await prisma.proAvailability.findUnique({
      where: { id: body.availabilityId },
      select: { sport: true, spotLat: true, spotLng: true },
    });
    const consentHash = getConsentHash(req);
    void recordServerAnalyticsEvent({
      eventType: 'RIDER_BOOKING_REQUEST',
      actorType: 'RIDER',
      actorId: current.id,
      consentHash,
      sport: availability?.sport ?? null,
      zoneLarge: computeZoneLarge(availability?.spotLat ?? null, availability?.spotLng ?? null),
      occurredAt: request.createdAt,
    });
    return res.status(201).json(request);
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    const status = getErrorStatus(error);
    return res.status(status).json({ error: getErrorMessage(error) });
  }
});

bookingRouter.get('/requests/me', ensureRole('RIDER'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const current = req.user;
    if (!current) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const requests = await bookingService.listRiderRequests(current.id);
    return res.json({ requests });
  } catch (error: unknown) {
    const status = getErrorStatus(error);
    return res.status(status).json({ error: getErrorMessage(error) });
  }
});

bookingRouter.get('/requests/inbox', ensureRole('PRO'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const current = req.user;
    if (!current) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const requests = await bookingService.listProRequests(current.id);
    return res.json({ requests });
  } catch (error: unknown) {
    const status = getErrorStatus(error);
    return res.status(status).json({ error: getErrorMessage(error) });
  }
});

bookingRouter.post('/requests/:id/decision', ensureRole('PRO'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { action } = decideBookingRequestSchema.parse(req.body);
    const current = req.user;
    if (!current) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const result = await bookingService.decideRequest(current.id, req.params.id, action);
    const requestRow = await prisma.bookingRequest.findUnique({
      where: { id: req.params.id },
      select: {
        respondedAt: true,
        availability: { select: { sport: true, spotLat: true, spotLng: true } },
      },
    });
    const consentHash = getConsentHash(req);
    void recordServerAnalyticsEvent({
      eventType: 'PRO_BOOKING_RESPONSE',
      actorType: 'PRO',
      actorId: current.id,
      consentHash,
      sport: requestRow?.availability?.sport ?? null,
      zoneLarge: computeZoneLarge(
        requestRow?.availability?.spotLat ?? null,
        requestRow?.availability?.spotLng ?? null
      ),
      occurredAt: requestRow?.respondedAt ?? new Date(),
    });
    return res.json(result);
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    const status = getErrorStatus(error);
    return res.status(status).json({ error: getErrorMessage(error) });
  }
});


bookingRouter.get('/bookings/me', ensureRole('PRO'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const current = req.user;
    if (!current) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const bookings = await bookingService.listProBookings(current.id);
    return res.json({ bookings });
  } catch (error: unknown) {
    const status = getErrorStatus(error);
    return res.status(status).json({ error: getErrorMessage(error) });
  }
});

bookingRouter.get('/bookings/rider/me', ensureRole('RIDER'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const current = req.user;
    if (!current) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const bookings = await bookingService.listRiderBookings(current.id);
    return res.json({ bookings });
  } catch (error: unknown) {
    const status = getErrorStatus(error);
    return res.status(status).json({ error: getErrorMessage(error) });
  }
});

// Annulation d'un booking — RIDER ou PRO, acteur déduit du JWT, authz dans la transaction
// POST (et non DELETE) : on ne supprime pas la ressource, on effectue une transition de statut
bookingRouter.post('/bookings/:id/cancel', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const current = req.user;
    if (!current) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const callerRole = current.role;
    if (callerRole !== 'RIDER' && callerRole !== 'PRO') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const bookingId = req.params.id;
    if (!/^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(bookingId)) {
      return res.status(400).json({ error: 'Invalid booking id' });
    }
    const result = await bookingService.cancelBooking(current.id, callerRole as 'RIDER' | 'PRO', bookingId);
    return res.json(result);
  } catch (error: unknown) {
    const status = getErrorStatus(error);
    return res.status(status).json({ error: getErrorMessage(error) });
  }
});
