import request from 'supertest';
import { prisma } from '@blobinfini/database';
import { createApp } from '../../../index';

const app = createApp();

describe('Booking module E2E', () => {
  let proToken = '';
  let riderToken = '';
  let riderToken2 = '';
  let availabilityId = '';
  let requestId = '';
  let requestId2 = '';

  beforeAll(async () => {
    await prisma.booking.deleteMany();
    await prisma.bookingRequest.deleteMany();
    await prisma.proAvailability.deleteMany();

    await request(app)
      .post('/auth/register')
      .send({ email: 'pro-booking@test.com', password: 'Passw0rd!', consentAccepted: true })
      .expect(201);
    await prisma.user.update({ where: { email: 'pro-booking@test.com' }, data: { role: 'PRO' } });

    const proLogin = await request(app)
      .post('/auth/login')
      .send({ email: 'pro-booking@test.com', password: 'Passw0rd!' })
      .expect(200);
    proToken = proLogin.body.accessToken as string;

    await request(app)
      .post('/auth/register')
      .send({ email: 'rider-booking@test.com', password: 'Passw0rd!', consentAccepted: true })
      .expect(201);
    const riderLogin = await request(app)
      .post('/auth/login')
      .send({ email: 'rider-booking@test.com', password: 'Passw0rd!' })
      .expect(200);
    riderToken = riderLogin.body.accessToken as string;

    await request(app)
      .post('/auth/register')
      .send({ email: 'rider-booking-2@test.com', password: 'Passw0rd!', consentAccepted: true })
      .expect(201);
    const riderLogin2 = await request(app)
      .post('/auth/login')
      .send({ email: 'rider-booking-2@test.com', password: 'Passw0rd!' })
      .expect(200);
    riderToken2 = riderLogin2.body.accessToken as string;
  });

  afterAll(async () => {
    await prisma.booking.deleteMany();
    await prisma.bookingRequest.deleteMany();
    await prisma.proAvailability.deleteMany();
    await prisma.user.deleteMany({ where: { email: { in: ['pro-booking@test.com', 'rider-booking@test.com', 'rider-booking-2@test.com'] } } });
    await prisma.$disconnect();
  });

  it('allows a pro to create an availability', async () => {
    const payload = {
      sport: 'surf',
      levels: ['beginner', 'intermediate'],
      startAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      endAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      capacity: 1,
      spotName: 'Plage Centrale',
      spotLat: 43.493,
      spotLng: -1.558,
    };

    const res = await request(app)
      .post('/booking/availability')
      .set('Authorization', `Bearer ${proToken}`)
      .send(payload)
      .expect(201);

    expect(res.body).toHaveProperty('id');
    availabilityId = res.body.id;
  });

  it('returns availabilities for the pro', async () => {
    const res = await request(app)
      .get('/booking/availability/me')
      .set('Authorization', `Bearer ${proToken}`)
      .expect(200);

    expect(Array.isArray(res.body.availabilities)).toBe(true);
    expect(res.body.availabilities.length).toBeGreaterThan(0);
  });

  it('allows a rider to send a booking request', async () => {
    const res = await request(app)
      .post('/booking/requests')
      .set('Authorization', `Bearer ${riderToken}`)
      .send({ availabilityId, message: 'Partant pour un cours ?' })
      .expect(201);

    expect(res.body).toHaveProperty('id');
    requestId = res.body.id;
  });

  it('lists the rider booking request', async () => {
    const res = await request(app)
      .get('/booking/requests/me')
      .set('Authorization', `Bearer ${riderToken}`)
      .expect(200);

    const myRequest = res.body.requests.find((r: any) => r.id === requestId);
    expect(myRequest).toBeTruthy();
    expect(myRequest).toMatchObject({
      status: 'PENDING',
      message: 'Partant pour un cours ?',
      availability: expect.objectContaining({ id: availabilityId }),
    });
  });

  it('shows the booking request in the pro inbox', async () => {
    const res = await request(app)
      .get('/booking/requests/inbox')
      .set('Authorization', `Bearer ${proToken}`)
      .expect(200);

    expect(Array.isArray(res.body.requests)).toBe(true);
    const inboxItem = res.body.requests.find((r: any) => r.id === requestId);
    expect(inboxItem).toBeTruthy();
    expect(inboxItem).toMatchObject({
      status: 'PENDING',
      availability: expect.objectContaining({
        id: availabilityId,
        spotName: 'Plage Centrale',
      }),
      rider: expect.objectContaining({
        email: 'rider-booking@test.com',
      }),
    });
  });

  it('allows the pro to accept the request', async () => {
    const res = await request(app)
      .post(`/booking/requests/${requestId}/decision`)
      .set('Authorization', `Bearer ${proToken}`)
      .send({ decision: 'ACCEPT' })
      .expect(200);

    expect(res.body).toMatchObject({ success: true, action: 'accept' });
  });

  it('prevents overbooking when accepting another request on a full slot', async () => {
    const secondRequest = await request(app)
      .post('/booking/requests')
      .set('Authorization', `Bearer ${riderToken2}`)
      .send({ availabilityId, message: 'Je peux venir aussi !' })
      .expect(201);

    requestId2 = secondRequest.body.id;

    const res = await request(app)
      .post(`/booking/requests/${requestId2}/decision`)
      .set('Authorization', `Bearer ${proToken}`)
      .send({ decision: 'ACCEPT' })
      .expect(409);

    expect(res.body).toMatchObject({ error: 'Availability capacity reached' });
  });

  it('updates inbox status and availability counts after decision', async () => {
    const inboxRes = await request(app)
      .get('/booking/requests/inbox')
      .set('Authorization', `Bearer ${proToken}`)
      .expect(200);

    const acceptedItem = inboxRes.body.requests.find((r: any) => r.id === requestId);
    expect(acceptedItem).toBeTruthy();
    expect(acceptedItem.status).toBe('ACCEPTED');
    expect(acceptedItem.respondedAt).toBeTruthy();

    const availabilityRes = await request(app)
      .get('/booking/availability/me')
      .set('Authorization', `Bearer ${proToken}`)
      .expect(200);

    const updatedSlot = availabilityRes.body.availabilities.find((a: any) => a.id === availabilityId);
    expect(updatedSlot).toBeTruthy();
    expect(Number(updatedSlot.bookedCount)).toBe(1);
  });

  it('returns 409 if the same request is accepted twice', async () => {
    const res = await request(app)
      .post(`/booking/requests/${requestId}/decision`)
      .set('Authorization', `Bearer ${proToken}`)
      .send({ decision: 'ACCEPT' })
      .expect(409);

    expect(res.body).toMatchObject({ error: 'Request already handled' });

    const availabilityRes = await request(app)
      .get('/booking/availability/me')
      .set('Authorization', `Bearer ${proToken}`)
      .expect(200);

    const slot = availabilityRes.body.availabilities.find((a: any) => a.id === availabilityId);
    expect(Number(slot.bookedCount)).toBe(1);
  });

  it('reflects the updated status in the rider requests list', async () => {
    const res = await request(app)
      .get('/booking/requests/me')
      .set('Authorization', `Bearer ${riderToken}`)
      .expect(200);

    const updated = res.body.requests.find((r: any) => r.id === requestId);
    expect(updated).toBeTruthy();
    expect(updated.status).toBe('ACCEPTED');
    expect(updated.respondedAt).toBeTruthy();
  });

  it('lists confirmed bookings for the pro', async () => {
    const res = await request(app)
      .get('/booking/bookings/me')
      .set('Authorization', `Bearer ${proToken}`)
      .expect(200);

    expect(Array.isArray(res.body.bookings)).toBe(true);
    expect(res.body.bookings.length).toBeGreaterThan(0);
  });
});
