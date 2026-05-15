import { clientPrisma as prisma } from '@blobinfini/database';
import { analyticsReportService } from '../reports.service';
import { hashIdentifier, normalizeDay } from '../events.service';

const EMAIL_PREFIX = 'analytics-';
const DAY_MS = 24 * 60 * 60 * 1000;

const buildEmail = (suffix: string) => `${EMAIL_PREFIX}${suffix}@test.com`;

async function cleanup() {
  // Find all test users first to get their IDs
  const testUsers = await prisma.user.findMany({
    where: { email: { startsWith: EMAIL_PREFIX } },
    select: { id: true }
  });
  const testUserIds = testUsers.map(u => u.id);

  if (testUserIds.length > 0) {
    // Delete dependent records by user IDs
    await prisma.bookingRequest.deleteMany({ where: { riderUserId: { in: testUserIds } } });
    await prisma.proAvailability.deleteMany({ where: { proUserId: { in: testUserIds } } });
    await prisma.proProfile.deleteMany({ where: { userId: { in: testUserIds } } });
    await prisma.riderProfile.deleteMany({ where: { userId: { in: testUserIds } } });
  }

  // Clean up analytics data (global cleanup)
  await prisma.analyticsEvent.deleteMany({});
  await prisma.analyticsDailyAgg.deleteMany({});

  // Finally delete users
  await prisma.user.deleteMany({ where: { email: { startsWith: EMAIL_PREFIX } } });
}

describe('Analytics report service', () => {
  beforeAll(async () => {
    // Ensure clean state before all tests
    await cleanup();
  });

  beforeEach(async () => {
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
  });

  it('returns frozen empty marketplace health (booking feature removed)', async () => {
    const report = await analyticsReportService.getMarketplaceHealth('7d');

    expect(report.acceptance.masked).toBe(true);
    expect(report.acceptance.totalRequests).toBe(0);
    expect(report.acceptance.acceptedRequests).toBeNull();
    expect(report.acceptance.acceptanceRate).toBeNull();
    expect(report.supplyDemand).toEqual([]);
    expect(report.acceptanceBySport).toEqual([]);
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

    // Cohort may include riders from parallel tests, so check >= 25 (our test riders)
    expect(retention.cohortSize).toBeGreaterThanOrEqual(25);
    expect(retention.day1.masked).toBe(false);
    // Our 25 test riders all have day1 activity, so retained >= 25
    expect(retention.day1.retained).toBeGreaterThanOrEqual(25);
    expect(retention.day1.rate).toBeGreaterThanOrEqual(60); // At least 60% (15/25)
    // Our first 15 riders have day7 activity, so retained >= 15
    expect(retention.day7.retained).toBeGreaterThanOrEqual(15);
    expect(retention.day7.rate).toBeGreaterThan(0); // Some retention
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

  it('marketplace health shape is stable regardless of period (booking feature removed)', async () => {
    const report = await analyticsReportService.getMarketplaceHealth('30d');

    expect(report).toMatchObject({
      period: '30d',
      privacyThreshold: expect.any(Number),
      supplyDemand: [],
      acceptance: {
        totalRequests: 0,
        acceptedRequests: null,
        acceptanceRate: null,
        medianResponseHours: null,
        responseSampleSize: 0,
        masked: true,
      },
      acceptanceBySport: [],
    });
  });
});
