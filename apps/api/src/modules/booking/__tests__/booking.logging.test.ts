import { clientPrisma as prisma } from '@blobinfini/database';
import { runJobWithLogContext } from '../../../observability/log-context';
import {
  flushLogTransport,
  resetLogTransportForTests,
  setLogWriterForTests,
} from '../../../observability/log-transport';
import { bookingService } from '../booking.service';

type StructuredLog = {
  event: string;
  context?: Record<string, unknown>;
};

describe('booking logging', () => {
  const capturedLogs: StructuredLog[] = [];
  let previousEnableTestLogs: string | undefined;

  beforeEach(() => {
    previousEnableTestLogs = process.env.ENABLE_TEST_LOGS;
    process.env.ENABLE_TEST_LOGS = 'true';
    capturedLogs.length = 0;
    setLogWriterForTests(async (line) => {
      capturedLogs.push(JSON.parse(line) as StructuredLog);
    });
  });

  afterEach(async () => {
    await flushLogTransport(200);
    resetLogTransportForTests();
    setLogWriterForTests(null);
    jest.restoreAllMocks();
    if (previousEnableTestLogs === undefined) {
      delete process.env.ENABLE_TEST_LOGS;
    } else {
      process.env.ENABLE_TEST_LOGS = previousEnableTestLogs;
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('does not emit precise location when no nearby pros are found', async () => {
    jest.spyOn(prisma.user, 'findUnique').mockResolvedValue(null as never);
    jest.spyOn(prisma.proAvailability, 'findUnique').mockResolvedValue({
      spotLat: 43.48721,
      spotLng: -1.56292,
      spotName: 'Secret spot',
      sport: 'surf',
    } as never);
    jest.spyOn(prisma, '$queryRaw').mockResolvedValue([] as never);

    const notifyNearbyProsAboutRequest = Reflect.get(
      bookingService,
      'notifyNearbyProsAboutRequest',
    ) as (riderUserId: string, requestId: string, availabilityId: string) => Promise<void>;

    await runJobWithLogContext('booking:no-nearby-test', async () => {
      await notifyNearbyProsAboutRequest.call(bookingService, 'rider-123', 'request-123', 'availability-123');
    });
    await flushLogTransport(200);

    const bookingLog = capturedLogs.find(
      (entry) => entry.event === 'No nearby PROs found for lesson request notification',
    );

    expect(bookingLog).toBeDefined();
    expect(bookingLog?.context).toMatchObject({
      requestId: 'request-123',
      searchAreaProvided: true,
    });

    const serializedLog = JSON.stringify(bookingLog);
    expect(serializedLog).not.toContain('43.48721');
    expect(serializedLog).not.toContain('-1.56292');
    expect(serializedLog).not.toContain('"lat"');
    expect(serializedLog).not.toContain('"lng"');
  });
});
