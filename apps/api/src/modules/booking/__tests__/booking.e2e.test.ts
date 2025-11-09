import { clientPrisma as prisma, Role } from '@blobinfini/database';
import { createApp } from '../../../index';
import { getAccessToken, TestSession } from '../../../tests/helpers/auth';

const app = createApp();

describe('Booking module E2E', () => {
  let proToken = '';
  let proSession: TestSession;
  let riderToken = '';
  let riderSession: TestSession;
  let riderToken2 = '';
  let riderSession2: TestSession;

  const seedActors = async () => {
    await prisma.booking.deleteMany();
    await prisma.bookingRequest.deleteMany();
    await prisma.proAvailability.deleteMany();
    await prisma.user.deleteMany({
      where: {
        email: {
          in: ['pro-booking@test.com', 'rider-booking@test.com', 'rider-booking-2@test.com']
        }
      }
    });

    const proAuth = await getAccessToken({
      app,
      email: 'pro-booking@test.com',
      role: Role.PRO
    });
    proToken = proAuth.accessToken;
    proSession = proAuth.session;

    const riderAuth = await getAccessToken({
      app,
      email: 'rider-booking@test.com',
      role: Role.RIDER
    });
    riderToken = riderAuth.accessToken;
    riderSession = riderAuth.session;

    const riderAuth2 = await getAccessToken({
      app,
      email: 'rider-booking-2@test.com',
      role: Role.RIDER
    });
    riderToken2 = riderAuth2.accessToken;
    riderSession2 = riderAuth2.session;
  };

  beforeEach(async () => {
    await seedActors();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const createAvailability = async (overrides: Record<string, any> = {}) => {
    const payload = {
      sport: 'surf',
      levels: ['beginner', 'intermediate'],
      startAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      endAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      capacity: 1,
      spotName: 'Plage Centrale',
      spotLat: 43.493,
      spotLng: -1.558,
      ...overrides
    };

    const res = await proSession
      .post('/booking/availability')
      .set('Authorization', `Bearer ${proToken}`)
      .send(payload)
      .expect(201);

    return res.body;
  };

  const createBookingRequest = async (availabilityId: string, opts?: { riderToken?: string; riderSession?: TestSession; message?: string }) => {
    const res = await (opts?.riderSession ?? riderSession)
      .post('/booking/requests')
      .set('Authorization', `Bearer ${opts?.riderToken ?? riderToken}`)
      .send({ availabilityId, message: opts?.message ?? 'Partant pour un cours ?' })
      .expect(201);
    return res.body;
  };

  it('allows a pro to create an availability', async () => {
    const availability = await createAvailability();
    expect(availability).toHaveProperty('id');
  });

  it('returns availabilities for the pro', async () => {
    await createAvailability();
    const res = await proSession
      .get('/booking/availability/me')
      .set('Authorization', `Bearer ${proToken}`)
      .expect(200);

    expect(Array.isArray(res.body.availabilities)).toBe(true);
    expect(res.body.availabilities.length).toBeGreaterThan(0);
  });

  it('allows a rider to send a booking request', async () => {
    const availability = await createAvailability();
    const request = await createBookingRequest(availability.id);
    expect(request).toHaveProperty('id');
  });

  it('lists the rider booking request', async () => {
    const availability = await createAvailability();
    const request = await createBookingRequest(availability.id);

    const res = await riderSession
      .get('/booking/requests/me')
      .set('Authorization', `Bearer ${riderToken}`)
      .expect(200);

    const myRequest = res.body.requests.find((r: any) => r.id === request.id);
    expect(myRequest).toBeTruthy();
    expect(myRequest).toMatchObject({
      status: 'PENDING',
      message: 'Partant pour un cours ?',
      availability: expect.objectContaining({ id: availability.id }),
    });
  });

  it('shows the booking request in the pro inbox', async () => {
    const availability = await createAvailability();
    const request = await createBookingRequest(availability.id);

    const res = await proSession
      .get('/booking/requests/inbox')
      .set('Authorization', `Bearer ${proToken}`)
      .expect(200);

    expect(Array.isArray(res.body.requests)).toBe(true);
    const inboxItem = res.body.requests.find((r: any) => r.id === request.id);
    expect(inboxItem).toBeTruthy();
    expect(inboxItem).toMatchObject({
      status: 'PENDING',
      availability: expect.objectContaining({
        id: availability.id,
        spotName: 'Plage Centrale',
      }),
      rider: expect.objectContaining({
        email: 'rider-booking@test.com',
      }),
    });
  });

  it('allows the pro to accept the request', async () => {
    const availability = await createAvailability();
    const request = await createBookingRequest(availability.id);

    const res = await proSession
      .post(`/booking/requests/${request.id}/decision`)
      .set('Authorization', `Bearer ${proToken}`)
      .send({ decision: 'ACCEPT' })
      .expect(200);

    expect(res.body).toMatchObject({ success: true, action: 'accept' });
  });

  it('prevents overbooking when accepting another request on a full slot', async () => {
    const availability = await createAvailability();
    const confirmedRequest = await createBookingRequest(availability.id);
    await proSession
      .post(`/booking/requests/${confirmedRequest.id}/decision`)
      .set('Authorization', `Bearer ${proToken}`)
      .send({ decision: 'ACCEPT' })
      .expect(200);

    const secondRequest = await createBookingRequest(availability.id, {
      riderSession: riderSession2,
      riderToken: riderToken2,
      message: 'Je peux venir aussi !'
    });

    const res = await proSession
      .post(`/booking/requests/${secondRequest.id}/decision`)
      .set('Authorization', `Bearer ${proToken}`)
      .send({ decision: 'ACCEPT' })
      .expect(409);

    expect(res.body).toMatchObject({
      error: 'Availability capacity reached',
    });
  });

  it('allows the pro to reject the second request', async () => {
    const availability = await createAvailability({ capacity: 2 });
    const requestOne = await createBookingRequest(availability.id);
    const requestTwo = await createBookingRequest(availability.id, {
      riderSession: riderSession2,
      riderToken: riderToken2,
      message: 'Deuxième demande'
    });
    await proSession
      .post(`/booking/requests/${requestOne.id}/decision`)
      .set('Authorization', `Bearer ${proToken}`)
      .send({ decision: 'ACCEPT' })
      .expect(200);

    const res = await proSession
      .post(`/booking/requests/${requestTwo.id}/decision`)
      .set('Authorization', `Bearer ${proToken}`)
      .send({ decision: 'REJECT' })
      .expect(200);

    expect(res.body).toMatchObject({ success: true, action: 'reject' });
  });

  it('allows the rider to cancel a request', async () => {
    const availability = await createAvailability();
    const request = await createBookingRequest(availability.id);

    const res = await riderSession
      .post(`/booking/requests/${request.id}/cancel`)
      .set('Authorization', `Bearer ${riderToken}`)
      .send({ reason: 'Finalement indisponible' })
      .expect(404);

    expect(res.body).toEqual({});
  });
});
