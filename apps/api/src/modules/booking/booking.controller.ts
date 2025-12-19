import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth, requireVerifiedEmail } from '../auth/auth.guard';
import { bookingService } from './booking.service';
import { createAvailabilitySchema } from './dto/createAvailability.dto';
import { createBookingRequestSchema } from './dto/createRequest.dto';
import { decideBookingRequestSchema } from './dto/decideRequest.dto';
import { searchAvailabilitySchema } from './dto/searchAvailability.dto';
import { prosNearbySchema } from './dto/prosNearby.dto';

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
    return res.status(201).json(availability);
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
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
    return res.json(availability);
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    const status = getErrorStatus(error);
    return res.status(status).json({ error: getErrorMessage(error) });
  }
});

bookingRouter.patch('/availability/:id/adjust-booked', ensureRole('PRO'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const schema = z.object({
      delta: z.number().int().min(-10).max(10),
    });
    const { delta } = schema.parse(req.body);
    const current = req.user;
    if (!current) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const availability = await bookingService.adjustBookedCount(current.id, req.params.id, delta);
    return res.json(availability);
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    const status = getErrorStatus(error);
    return res.status(status).json({ error: getErrorMessage(error) });
  }
});

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

bookingRouter.get('/availability/search', async (req: Request, res: Response) => {
  try {
    const query = searchAvailabilitySchema.parse({
      ...req.query,
      lat: req.query.lat ? Number(req.query.lat) : undefined,
      lng: req.query.lng ? Number(req.query.lng) : undefined,
      radiusKm: req.query.radiusKm ? Number(req.query.radiusKm) : undefined,
      page: req.query.page ? Number(req.query.page) : undefined,
      pageSize: req.query.pageSize ? Number(req.query.pageSize) : undefined,
    });
    const results = await bookingService.searchAvailabilities(query);
    return res.json({ results });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
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
    const query = prosNearbySchema.parse({
      lat: req.query.lat ? Number(req.query.lat) : undefined,
      lng: req.query.lng ? Number(req.query.lng) : undefined,
      radiusKm: req.query.radiusKm ? Number(req.query.radiusKm) : undefined,
      sport: typeof req.query.sport === 'string' ? req.query.sport : undefined,
    });

    const pros = await bookingService.listNearbyPros(query);
    return res.json({ pros });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    const status = getErrorStatus(error);
    return res.status(status).json({ error: getErrorMessage(error) });
  }
});

bookingRouter.post('/requests', ensureRole('RIDER'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = createBookingRequestSchema.parse(req.body);
    const current = req.user;
    if (!current) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const request = await bookingService.createRequest(current.id, body);
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
    return res.json(result);
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    const status = getErrorStatus(error);
    return res.status(status).json({ error: getErrorMessage(error) });
  }
});

bookingRouter.post('/bookings/manual', ensureRole('PRO'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const schema = z.object({
      availabilityId: z.string().uuid(),
      riderUserId: z.string().uuid(),
    });
    const body = schema.parse(req.body);
    const current = req.user;
    if (!current) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const booking = await bookingService.addManualBooking(current.id, body);
    return res.status(201).json(booking);
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
