import { clientPrisma as prisma } from '@blobinfini/database';
import { analyticsReportService } from '../reports.service';
import { hashIdentifier, normalizeDay } from '../events.service';

const EMAIL_PREFIX = 'analytics-';
const DAY_MS = 24 * 60 * 60 * 1000;

const buildEmail = (suffix: string) => `${EMAIL_PREFIX}${suffix}@test.com`;

async function cleanup() {
  await prisma.analyticsEvent.deleteMany({});
  await prisma.analyticsDailyAgg.deleteMany({});
  await prisma.bookingRequest.deleteMany({ where: { rider: { email: { startsWith: EMAIL_PREFIX } } } });
  await prisma.proAvailability.deleteMany({ where: { pro: { email: { startsWith: EMAIL_PREFIX } } } });
  await prisma.proProfile.deleteMany({ where: { user: { email: { startsWith: EMAIL_PREFIX } } } });
  await prisma.riderProfile.deleteMany({ where: { user: { email: { startsWith: EMAIL_PREFIX } } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: EMAIL_PREFIX } } });
}

describe('Analytics report service', () => {
  beforeEach(async () => {
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
  });

  it('masks marketplace segments below privacy threshold', async () => {
    const proEmail = buildEmail('market-masked-pro');
    const riderEmail = buildEmail('market-masked-rider');
    const pro = await prisma.user.create({
      data: {
        email: proEmail,
        password: 'hash',
        role: 'PRO',
        emailVerified: true,
      },
    });
    await prisma.proProfile.create({
      data: {
        userId: pro.id,
        businessName: 'Pro Test',
        verified: true,
        lat: 43.5,
        lng: -1.5,
      },
    });

    const rider = await prisma.user.create({
      data: {
        email: riderEmail,
        password: 'hash',
        role: 'RIDER',
        emailVerified: true,
      },
    });
    await prisma.riderProfile.create({
      data: {
        userId: rider.id,
        displayName: 'Rider Test',
      },
    });

    const availability = await prisma.proAvailability.create({
      data: {
        proUserId: pro.id,
        sport: 'surf',
        levels: ['beginner'],
        startAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        endAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
        capacity: 1,
        status: 'OPEN',
        spotLat: 43.5,
        spotLng: -1.5,
      },
    });

    await prisma.bookingRequest.create({
      data: {
        riderUserId: rider.id,
        availabilityId: availability.id,
        status: 'PENDING',
      },
    });

    const report = await analyticsReportService.getMarketplaceHealth('7d');

    expect(report.acceptance.masked).toBe(true);
    expect(report.supplyDemand.length).toBeGreaterThan(0);
    expect(report.supplyDemand[0].masked).toBe(true);
    expect(report.supplyDemand[0].demandRequests).toBeNull();
  });

  it('computes rider retention cohorts from activity events', async () => {
    const now = new Date();
    const createdAt = new Date(now.getTime() - 10 * DAY_MS);
    const riders = [];

    for (let i = 0; i < 25; i += 1) {
      const rider = await prisma.user.create({
        data: {
          email: buildEmail(`cohort-rider-${i}`),
          password: 'hash',
          role: 'RIDER',
          emailVerified: true,
          createdAt,
        },
      });
      riders.push(rider);
    }

    const day1 = new Date(createdAt.getTime() + DAY_MS);
    const day7 = new Date(createdAt.getTime() + 7 * DAY_MS);
    const events = riders.flatMap((rider, index) => {
      const base = {
        actorType: 'RIDER' as const,
        actorHash: hashIdentifier(rider.id),
        eventType: 'RIDER_BOOKING_REQUEST' as const,
        consented: true,
      };
      return [
        { ...base, occurredAt: day1 },
        ...(index < 15 ? [{ ...base, occurredAt: day7 }] : []),
      ];
    });

    await prisma.analyticsEvent.createMany({ data: events });

    const report = await analyticsReportService.getTraction('30d');
    const retention = report.retention.riders;

    expect(retention.cohortSize).toBe(25);
    expect(retention.day1.masked).toBe(false);
    expect(retention.day1.retained).toBe(25);
    expect(retention.day1.rate).toBeCloseTo(100, 1);
    expect(retention.day7.retained).toBe(15);
    expect(retention.day7.rate).toBeCloseTo(60, 1);
    expect(retention.day30.masked).toBe(true);
  });

  it('computes stickiness and daily actives by role', async () => {
    const now = new Date();
    const rider = await prisma.user.create({
      data: {
        email: buildEmail('stickiness-rider'),
        password: 'hash',
        role: 'RIDER',
        emailVerified: true,
      },
    });
    const pro = await prisma.user.create({
      data: {
        email: buildEmail('stickiness-pro'),
        password: 'hash',
        role: 'PRO',
        emailVerified: true,
      },
    });

    const riderDay = new Date(now.getTime() - 2 * DAY_MS);
    const proDay = new Date(now.getTime() - 1 * DAY_MS);

    await prisma.analyticsEvent.createMany({
      data: [
        {
          occurredAt: riderDay,
          actorType: 'RIDER',
          actorHash: hashIdentifier(rider.id),
          eventType: 'RIDER_SEARCH_PROS',
          consented: true,
        },
        {
          occurredAt: proDay,
          actorType: 'PRO',
          actorHash: hashIdentifier(pro.id),
          eventType: 'PRO_DASHBOARD_OPEN',
          consented: true,
        },
      ],
    });

    const report = await analyticsReportService.getTraction('30d');
    const timeline = report.stickiness.timeline;
    const riderKey = normalizeDay(riderDay).toISOString().slice(0, 10);
    const proKey = normalizeDay(proDay).toISOString().slice(0, 10);
    const riderEntry = timeline.find((entry) => entry.day === riderKey);
    const proEntry = timeline.find((entry) => entry.day === proKey);

    expect(riderEntry).toBeTruthy();
    expect(proEntry).toBeTruthy();
    expect(riderEntry).toMatchObject({ total: 1, riders: 1, pros: 0 });
    expect(proEntry).toMatchObject({ total: 1, riders: 0, pros: 1 });

    expect(report.stickiness.mau.total).toBe(2);
    expect(report.stickiness.mau.riders).toBe(1);
    expect(report.stickiness.mau.pros).toBe(1);

    const totalDays = timeline.length;
    const expectedAvg = 2 / totalDays;
    const expectedStickiness = (expectedAvg / 2) * 100;
    expect(report.stickiness.dauAverage.total).toBeCloseTo(expectedAvg, 5);
    expect(report.stickiness.stickiness.total).toBeCloseTo(expectedStickiness, 5);
  });

  it('computes marketplace acceptance metrics above the privacy threshold', async () => {
    const pro = await prisma.user.create({
      data: {
        email: buildEmail('market-acceptance-pro'),
        password: 'hash',
        role: 'PRO',
        emailVerified: true,
      },
    });

    const availability = await prisma.proAvailability.create({
      data: {
        proUserId: pro.id,
        sport: 'surf',
        levels: ['beginner'],
        startAt: new Date(Date.now() + DAY_MS),
        endAt: new Date(Date.now() + 2 * DAY_MS),
        capacity: 1,
        status: 'OPEN',
        spotLat: 43.6,
        spotLng: -1.5,
      },
    });

    const riders = [];
    for (let i = 0; i < 20; i += 1) {
      const rider = await prisma.user.create({
        data: {
          email: buildEmail(`market-acceptance-rider-${i}`),
          password: 'hash',
          role: 'RIDER',
          emailVerified: true,
        },
      });
      riders.push(rider);
    }

    const createdAt = new Date(Date.now() - 2 * DAY_MS);
    const requests = riders.map((rider, index) => ({
      riderUserId: rider.id,
      availabilityId: availability.id,
      status: index % 2 === 0 ? 'ACCEPTED' : 'REJECTED',
      createdAt,
      respondedAt: new Date(createdAt.getTime() + (index + 1) * 60 * 60 * 1000),
    }));

    await prisma.bookingRequest.createMany({ data: requests });

    const report = await analyticsReportService.getMarketplaceHealth('30d');
    const acceptance = report.acceptance;
    const acceptanceSurf = report.acceptanceBySport.find((entry) => entry.sport === 'surf');

    expect(acceptance.masked).toBe(false);
    expect(acceptance.totalRequests).toBe(20);
    expect(acceptance.acceptedRequests).toBe(10);
    expect(acceptance.acceptanceRate).toBeCloseTo(50, 1);
    expect(acceptance.medianResponseHours).toBeCloseTo(10, 1);
    expect(acceptanceSurf?.masked).toBe(false);
    expect(acceptanceSurf?.acceptanceRate).toBeCloseTo(50, 1);
  });
});
