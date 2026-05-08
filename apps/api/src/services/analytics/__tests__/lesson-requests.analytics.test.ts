import { clientPrisma as prisma } from '@blobinfini/database';
import { analyticsReportService } from '../reports.service';

const EMAIL_PREFIX = 'lr-analytics-';
const buildEmail = (suffix: string) => `${EMAIL_PREFIX}${suffix}@test.com`;

async function cleanup() {
  const testUsers = await prisma.user.findMany({
    where: { email: { startsWith: EMAIL_PREFIX } },
    select: { id: true, email: true },
  });
  const emails = testUsers.map((u) => u.email);
  const ids = testUsers.map((u) => u.id);

  if (ids.length > 0) {
    await prisma.contactRequestResponse.deleteMany({
      where: { OR: [{ rider: { id: { in: ids } } }, { contactRequest: { pro: { id: { in: ids } } } }] },
    });
    await prisma.contactRequest.deleteMany({ where: { pro: { id: { in: ids } } } });
    await prisma.conversationMember.deleteMany({ where: { userId: { in: ids } } });
    await prisma.message.deleteMany({ where: { senderId: { in: ids } } });
    await prisma.conversation.deleteMany({ where: { members: { some: { userId: { in: ids } } } } });
    await prisma.riderProfile.deleteMany({ where: { userId: { in: ids } } });
    await prisma.proProfile.deleteMany({ where: { userId: { in: ids } } });
  }

  if (emails.length > 0) {
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
  }
}

async function createRider(suffix: string, lessonData?: {
  wantsLesson?: boolean;
  lessonSport?: string;
  lessonStudentCount?: number;
  lessonLat?: number;
  lessonLng?: number;
}) {
  const user = await prisma.user.create({
    data: { email: buildEmail(suffix), password: 'hash', role: 'RIDER', emailVerified: true },
  });
  await prisma.riderProfile.create({
    data: {
      userId: user.id,
      displayName: `Rider ${suffix}`,
      wantsLesson: lessonData?.wantsLesson ?? false,
      lessonSport: lessonData?.lessonSport ?? null,
      lessonStudentCount: lessonData?.lessonStudentCount ?? 1,
      lessonLat: lessonData?.lessonLat ?? null,
      lessonLng: lessonData?.lessonLng ?? null,
    },
  });
  return user;
}

async function createPro(suffix: string) {
  const user = await prisma.user.create({
    data: { email: buildEmail(suffix), password: 'hash', role: 'PRO', emailVerified: true },
  });
  await prisma.proProfile.create({
    data: { userId: user.id, businessName: `Pro ${suffix}`, verified: true },
  });
  return user;
}

async function createContactRequest(proId: string, riderId: string) {
  const conversation = await prisma.conversation.create({
    data: { type: 'RIDER_TO_PRO' },
  });
  await prisma.conversationMember.createMany({
    data: [
      { conversationId: conversation.id, userId: proId },
      { conversationId: conversation.id, userId: riderId },
    ],
  });
  await prisma.contactRequest.create({
    data: { proUserId: proId, conversationId: conversation.id },
  });
  return conversation;
}

describe('getLessonRequests analytics', () => {
  beforeEach(async () => {
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
  });

  it('returns correct structure and shape', async () => {
    const report = await analyticsReportService.getLessonRequests('30d');

    expect(report.period).toBe('30d');
    expect(report.privacyThreshold).toBeGreaterThan(0);
    expect(report.definitions.lessonRequests).toBeTruthy();

    // Shape assertions — exact counts may vary with shared test DB data
    expect(typeof report.snapshot.totalActive).toBe('number');
    expect(typeof report.snapshot.newInPeriod).toBe('number');
    expect(typeof report.snapshot.bySport.surf).toBe('number');
    expect(typeof report.snapshot.bySport.kitesurf).toBe('number');
    expect(typeof report.snapshot.bySport.other).toBe('number');
    expect(typeof report.snapshot.byStudentCount.solo).toBe('number');
    expect(typeof report.snapshot.byStudentCount.duo).toBe('number');
    expect(typeof report.snapshot.byStudentCount.group).toBe('number');
    expect(Array.isArray(report.byZone)).toBe(true);
    expect(typeof report.proContactStats.totalContacts).toBe('number');
    expect(typeof report.proContactStats.masked).toBe('boolean');

    // Invariant: sport counts sum to totalActive
    const sportSum = report.snapshot.bySport.surf + report.snapshot.bySport.kitesurf + report.snapshot.bySport.other;
    expect(sportSum).toBe(report.snapshot.totalActive);

    // Invariant: student count buckets sum to totalActive
    const scSum = report.snapshot.byStudentCount.solo + report.snapshot.byStudentCount.duo + report.snapshot.byStudentCount.group;
    expect(scSum).toBe(report.snapshot.totalActive);
  });

  it('counts only riders with wantsLesson=true', async () => {
    await createRider('active-1', { wantsLesson: true, lessonSport: 'surf' });
    await createRider('active-2', { wantsLesson: true, lessonSport: 'kitesurf' });
    await createRider('inactive', { wantsLesson: false, lessonSport: 'surf' });

    const report = await analyticsReportService.getLessonRequests('30d');

    expect(report.snapshot.totalActive).toBe(2);
  });

  it('breaks down by sport correctly', async () => {
    await createRider('sport-surf-1', { wantsLesson: true, lessonSport: 'surf' });
    await createRider('sport-surf-2', { wantsLesson: true, lessonSport: 'surf' });
    await createRider('sport-kite', { wantsLesson: true, lessonSport: 'kitesurf' });
    await createRider('sport-none', { wantsLesson: true, lessonSport: null });

    const report = await analyticsReportService.getLessonRequests('30d');

    expect(report.snapshot.bySport.surf).toBe(2);
    expect(report.snapshot.bySport.kitesurf).toBe(1);
    expect(report.snapshot.bySport.other).toBe(1);
  });

  it('breaks down by student count correctly', async () => {
    await createRider('sc-solo', { wantsLesson: true, lessonStudentCount: 1 });
    await createRider('sc-duo', { wantsLesson: true, lessonStudentCount: 2 });
    await createRider('sc-group1', { wantsLesson: true, lessonStudentCount: 3 });
    await createRider('sc-group2', { wantsLesson: true, lessonStudentCount: 5 });

    const report = await analyticsReportService.getLessonRequests('30d');

    expect(report.snapshot.byStudentCount.solo).toBe(1);
    expect(report.snapshot.byStudentCount.duo).toBe(1);
    expect(report.snapshot.byStudentCount.group).toBe(2);
  });

  it('masks geo zones below privacy threshold', async () => {
    // 2 riders in the same zone → below PRIVACY_THRESHOLD (20)
    await createRider('geo-1', { wantsLesson: true, lessonLat: 43.5, lessonLng: -1.5 });
    await createRider('geo-2', { wantsLesson: true, lessonLat: 43.7, lessonLng: -1.3 });

    const report = await analyticsReportService.getLessonRequests('30d');

    // Both should land in zone Z43:-2 (grid=1°)
    expect(report.byZone.length).toBeGreaterThan(0);
    const zone = report.byZone[0];
    expect(zone.masked).toBe(true);
    expect(zone.count).toBeNull();
    expect(zone.sampleSize).toBeGreaterThan(0);
  });

  it('does not count ContactRequest for rider without wantsLesson', async () => {
    const pro = await createPro('no-lesson-pro');
    const rider = await createRider('no-lesson-rider', { wantsLesson: false });
    await createContactRequest(pro.id, rider.id);

    const report = await analyticsReportService.getLessonRequests('30d');

    expect(report.proContactStats.totalContacts).toBe(0);
  });

  it('counts ContactRequest when rider has wantsLesson=true', async () => {
    const pro = await createPro('lesson-contact-pro');
    const rider = await createRider('lesson-contact-rider', { wantsLesson: true, lessonSport: 'surf' });
    await createContactRequest(pro.id, rider.id);

    const report = await analyticsReportService.getLessonRequests('30d');

    expect(report.proContactStats.totalContacts).toBe(1);
    // Still masked (1 rider < PRIVACY_THRESHOLD)
    expect(report.proContactStats.masked).toBe(true);
    expect(report.proContactStats.distinctRidersContacted).toBeNull();
  });

  it('returns all periods without error', async () => {
    await createRider('period-test', { wantsLesson: true, lessonSport: 'kitesurf' });

    const results = await Promise.all([
      analyticsReportService.getLessonRequests('7d'),
      analyticsReportService.getLessonRequests('30d'),
      analyticsReportService.getLessonRequests('90d'),
      analyticsReportService.getLessonRequests('1y'),
    ]);

    for (const r of results) {
      expect(r.snapshot).toBeDefined();
      expect(r.byZone).toBeDefined();
      expect(r.proContactStats).toBeDefined();
    }
    expect(results[0].period).toBe('7d');
    expect(results[3].period).toBe('1y');
  });
});
