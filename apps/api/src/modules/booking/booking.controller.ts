import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireVerifiedEmail } from '../auth/auth.guard';
import { bookingService } from './booking.service';
import { createAvailabilitySchema } from './dto/createAvailability.dto';
import { createBookingRequestSchema } from './dto/createRequest.dto';
import { decideBookingRequestSchema } from './dto/decideRequest.dto';
import { searchAvailabilitySchema } from './dto/searchAvailability.dto';

export const bookingRouter = Router();

bookingRouter.use(requireAuth, requireVerifiedEmail);

const ensureRole = (role: 'RIDER' | 'PRO') => (req: any, res: any, next: any) => {
  const current = (req as any).user as { id: string; role: string } | undefined;
  if (!current || current.role !== role) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  return next();
};

bookingRouter.post('/availability', ensureRole('PRO'), async (req, res) => {
  try {
    const body = createAvailabilitySchema.parse(req.body);
    const current = (req as any).user as { id: string };
    const availability = await bookingService.createAvailability(current.id, body);
    return res.status(201).json(availability);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    const status = error?.status ?? 500;
    return res.status(status).json({ error: error?.message || 'Internal error' });
  }
});

bookingRouter.get('/availability/me', ensureRole('PRO'), async (req, res) => {
  try {
    const current = (req as any).user as { id: string };
    const availabilities = await bookingService.listAvailabilities(current.id, {});
    return res.json({ availabilities });
  } catch (error: any) {
    const status = error?.status ?? 500;
    return res.status(status).json({ error: error?.message || 'Internal error' });
  }
});

bookingRouter.patch('/availability/:id', ensureRole('PRO'), async (req, res) => {
  try {
    const schema = createAvailabilitySchema.partial();
    const body = schema.parse(req.body);
    const current = (req as any).user as { id: string };
    const availability = await bookingService.updateAvailability(current.id, req.params.id, body);
    return res.json(availability);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    const status = error?.status ?? 500;
    return res.status(status).json({ error: error?.message || 'Internal error' });
  }
});

bookingRouter.delete('/availability/:id', ensureRole('PRO'), async (req, res) => {
  try {
    const current = (req as any).user as { id: string };
    const result = await bookingService.deleteAvailability(current.id, req.params.id);
    return res.json(result);
  } catch (error: any) {
    const status = error?.status ?? 500;
    return res.status(status).json({ error: error?.message || 'Internal error' });
  }
});

bookingRouter.get('/availability/search', async (req, res) => {
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
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    const status = error?.status ?? 500;
    return res.status(status).json({ error: error?.message || 'Internal error' });
  }
});

bookingRouter.post('/requests', ensureRole('RIDER'), async (req, res) => {
  try {
    const body = createBookingRequestSchema.parse(req.body);
    const current = (req as any).user as { id: string };
    const request = await bookingService.createRequest(current.id, body);
    return res.status(201).json(request);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    const status = error?.status ?? 500;
    return res.status(status).json({ error: error?.message || 'Internal error' });
  }
});

bookingRouter.get('/requests/me', ensureRole('RIDER'), async (req, res) => {
  try {
    const current = (req as any).user as { id: string };
    const requests = await bookingService.listRiderRequests(current.id);
    return res.json({ requests });
  } catch (error: any) {
    const status = error?.status ?? 500;
    return res.status(status).json({ error: error?.message || 'Internal error' });
  }
});

bookingRouter.get('/requests/inbox', ensureRole('PRO'), async (req, res) => {
  try {
    const current = (req as any).user as { id: string };
    const requests = await bookingService.listProRequests(current.id);
    return res.json({ requests });
  } catch (error: any) {
    const status = error?.status ?? 500;
    return res.status(status).json({ error: error?.message || 'Internal error' });
  }
});

bookingRouter.post('/requests/:id/decision', ensureRole('PRO'), async (req, res) => {
  try {
    const { action } = decideBookingRequestSchema.parse(req.body);
    const current = (req as any).user as { id: string };
    const result = await bookingService.decideRequest(current.id, req.params.id, action);
    return res.json(result);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    const status = error?.status ?? 500;
    return res.status(status).json({ error: error?.message || 'Internal error' });
  }
});

bookingRouter.post('/bookings/manual', ensureRole('PRO'), async (req, res) => {
  try {
    const schema = z.object({
      availabilityId: z.string().uuid(),
      riderUserId: z.string().uuid(),
    });
    const body = schema.parse(req.body);
    const current = (req as any).user as { id: string };
    const booking = await bookingService.addManualBooking(current.id, body);
    return res.status(201).json(booking);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    const status = error?.status ?? 500;
    return res.status(status).json({ error: error?.message || 'Internal error' });
  }
});

bookingRouter.get('/bookings/me', ensureRole('PRO'), async (req, res) => {
  try {
    const current = (req as any).user as { id: string };
    const bookings = await bookingService.listProBookings(current.id);
    return res.json({ bookings });
  } catch (error: any) {
    const status = error?.status ?? 500;
    return res.status(status).json({ error: error?.message || 'Internal error' });
  }
});
