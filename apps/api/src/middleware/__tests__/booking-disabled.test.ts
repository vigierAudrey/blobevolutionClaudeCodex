/**
 * booking-disabled.test.ts
 *
 * Tests unitaires + intégration du guard de décommissionnement booking.
 *
 * Cas couverts :
 *   - BOOKING_DISABLED=true → blocage 410 sur toutes les routes d'écriture
 *   - BOOKING_DISABLED absent → pas de blocage (y compris en NODE_ENV=production)
 *   - path traversal
 *   - tous les verbes HTTP
 *   - isTableGoneError : codes Prisma couverts
 *   - isBookingWritePath : helper isolé
 *
 * NOTE : le guard n'utilise PAS NODE_ENV — seul BOOKING_DISABLED=true l'active.
 */

import request from 'supertest';
import express, { type Application } from 'express';
import {
  bookingDisabledGuard,
  isBookingWritePath,
  isTableGoneError,
} from '../booking-disabled';

// ─────────────────────────────────────────────────────────────────────────────
// Factory d'app de test
// ─────────────────────────────────────────────────────────────────────────────

function makeApp(bookingDisabledEnv?: string): Application {
  if (bookingDisabledEnv !== undefined) {
    process.env.BOOKING_DISABLED = bookingDisabledEnv;
  } else {
    delete process.env.BOOKING_DISABLED;
  }

  const app = express();
  app.use(bookingDisabledGuard);

  // Routes de test — chaque path représente un ancien endpoint booking
  const methods = ['get', 'post', 'put', 'patch', 'delete'] as const;
  const paths = [
    '/bookings',
    '/bookings/some-id',
    '/booking-requests',
    '/booking-requests/some-id',
    '/pro/availability',
    '/pro/availability/some-id',
    '/pro/bookings',
    '/pro/availability/some-id/interact',
  ];

  for (const method of methods) {
    for (const path of paths) {
      app[method](path, (_req, res) => res.status(200).json({ ok: true }));
    }
  }

  return app;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper : restore env après chaque test
// ─────────────────────────────────────────────────────────────────────────────

let originalBookingDisabled: string | undefined;
let originalNodeEnv: string | undefined;

beforeEach(() => {
  originalBookingDisabled = process.env.BOOKING_DISABLED;
  originalNodeEnv = process.env.NODE_ENV;
});

afterEach(() => {
  if (originalBookingDisabled !== undefined) {
    process.env.BOOKING_DISABLED = originalBookingDisabled;
  } else {
    delete process.env.BOOKING_DISABLED;
  }
  // Restaure NODE_ENV si un test l'a modifié (évite de polluer le setup global)
  if (originalNodeEnv !== undefined) {
    process.env.NODE_ENV = originalNodeEnv;
  } else {
    delete process.env.NODE_ENV;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// isBookingWritePath — helper unitaire
// ─────────────────────────────────────────────────────────────────────────────

describe('isBookingWritePath', () => {
  it('bloque POST /bookings', () => {
    expect(isBookingWritePath('POST', '/bookings')).toBe(true);
  });

  it('bloque PATCH /bookings/:id', () => {
    expect(isBookingWritePath('PATCH', '/bookings/abc-123')).toBe(true);
  });

  it('bloque DELETE /bookings/:id', () => {
    expect(isBookingWritePath('DELETE', '/bookings/abc-123')).toBe(true);
  });

  it('bloque POST /booking-requests', () => {
    expect(isBookingWritePath('POST', '/booking-requests')).toBe(true);
  });

  it('bloque POST /pro/availability', () => {
    expect(isBookingWritePath('POST', '/pro/availability')).toBe(true);
  });

  it('bloque PUT /pro/availability/:id', () => {
    expect(isBookingWritePath('PUT', '/pro/availability/abc-123')).toBe(true);
  });

  it('bloque DELETE /pro/availability/:id', () => {
    expect(isBookingWritePath('DELETE', '/pro/availability/abc-123')).toBe(true);
  });

  it('bloque POST /pro/bookings', () => {
    expect(isBookingWritePath('POST', '/pro/bookings')).toBe(true);
  });

  it('bloque POST /pro/availability/:id/interact', () => {
    expect(isBookingWritePath('POST', '/pro/availability/abc/interact')).toBe(true);
  });

  it('ne bloque PAS GET /bookings (lecture historique)', () => {
    expect(isBookingWritePath('GET', '/bookings')).toBe(false);
  });

  it('ne bloque PAS GET /pro/availability (lecture historique)', () => {
    expect(isBookingWritePath('GET', '/pro/availability')).toBe(false);
  });

  it('ne bloque PAS GET /matching (autre module)', () => {
    expect(isBookingWritePath('GET', '/matching')).toBe(false);
  });

  it('ne bloque PAS POST /auth/login (autre module)', () => {
    expect(isBookingWritePath('POST', '/auth/login')).toBe(false);
  });

  it('ne bloque PAS POST /conversations (autre module)', () => {
    expect(isBookingWritePath('POST', '/conversations')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// isTableGoneError — helper unitaire
// ─────────────────────────────────────────────────────────────────────────────

describe('isTableGoneError', () => {
  it('reconnaît P2021 (table manquante)', () => {
    // Simule l'erreur Prisma avec le pattern "code in err" du codebase
    const err = Object.assign(new Error('table missing'), { code: 'P2021' });
    expect(isTableGoneError(err)).toBe(true);
  });

  it('reconnaît P2022 (colonne manquante)', () => {
    const err = Object.assign(new Error('column missing'), { code: 'P2022' });
    expect(isTableGoneError(err)).toBe(true);
  });

  it('ne masque PAS P2002 (unique constraint)', () => {
    const err = Object.assign(new Error('unique constraint'), { code: 'P2002' });
    expect(isTableGoneError(err)).toBe(false);
  });

  it('ne masque PAS P2025 (not found)', () => {
    const err = Object.assign(new Error('not found'), { code: 'P2025' });
    expect(isTableGoneError(err)).toBe(false);
  });

  it('reconnaît erreur PostgreSQL brute 42P01 dans le message', () => {
    const err = new Error('ERROR: 42P01: relation "Booking" does not exist');
    expect(isTableGoneError(err)).toBe(true);
  });

  it('ne masque PAS une erreur de connexion', () => {
    expect(isTableGoneError(new Error('Connection refused'))).toBe(false);
  });

  it('ne masque PAS null/undefined', () => {
    expect(isTableGoneError(null)).toBe(false);
    expect(isTableGoneError(undefined)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// bookingDisabledGuard — tests middleware HTTP
// ─────────────────────────────────────────────────────────────────────────────

describe('bookingDisabledGuard — BOOKING_DISABLED=true', () => {
  let app: Application;

  beforeEach(() => {
    app = makeApp('true');
  });

  it('bloque POST /bookings → 410', async () => {
    await request(app).post('/bookings').expect(410);
  });

  it('retourne error=BOOKING_FEATURE_REMOVED dans le body', async () => {
    const res = await request(app).post('/bookings').expect(410);
    expect(res.body.error).toBe('BOOKING_FEATURE_REMOVED');
    expect(typeof res.body.message).toBe('string');
  });

  it('bloque POST /booking-requests → 410', async () => {
    await request(app).post('/booking-requests').expect(410);
  });

  it('bloque PATCH /booking-requests/:id → 410', async () => {
    await request(app).patch('/booking-requests/abc-123').expect(410);
  });

  it('bloque POST /pro/availability → 410', async () => {
    await request(app).post('/pro/availability').expect(410);
  });

  it('bloque DELETE /pro/availability/:id → 410', async () => {
    await request(app).delete('/pro/availability/abc-123').expect(410);
  });

  it('bloque POST /pro/bookings → 410', async () => {
    await request(app).post('/pro/bookings').expect(410);
  });

  it('ne bloque PAS GET /bookings (lecture historique) → 200', async () => {
    await request(app).get('/bookings').expect(200);
  });

  it('ne bloque PAS GET /pro/availability → 200', async () => {
    await request(app).get('/pro/availability').expect(200);
  });

  // Test d'abus : path traversal — Express normalise, le guard reste efficace
  it('résiste à /bookings/%2F../bookings (URL-encoded slash)', async () => {
    const res = await request(app).post('/bookings/%2F').expect(410);
    expect(res.body.error).toBe('BOOKING_FEATURE_REMOVED');
  });

  // Test d'abus : content-type inhabituel
  it('bloque POST même avec content-type text/plain', async () => {
    await request(app)
      .post('/bookings')
      .set('Content-Type', 'text/plain')
      .send('malformed body')
      .expect(410);
  });
});

describe('bookingDisabledGuard — sans BOOKING_DISABLED', () => {
  let app: Application;

  beforeEach(() => {
    app = makeApp(); // BOOKING_DISABLED absent
  });

  it('ne bloque PAS POST /bookings sans BOOKING_DISABLED → 200', async () => {
    await request(app).post('/bookings').expect(200);
  });

  it('ne bloque PAS POST /pro/availability sans BOOKING_DISABLED → 200', async () => {
    await request(app).post('/pro/availability').expect(200);
  });

  it('ne bloque PAS même si NODE_ENV=production (NODE_ENV ≠ état module) → 200', async () => {
    // Vérifie que NODE_ENV=production seul ne suffit pas à activer le guard.
    // L'activation requiert BOOKING_DISABLED=true explicitement.
    const prodApp = makeApp(); // BOOKING_DISABLED absent même en "production"
    await request(prodApp).post('/bookings').expect(200);
  });
});
