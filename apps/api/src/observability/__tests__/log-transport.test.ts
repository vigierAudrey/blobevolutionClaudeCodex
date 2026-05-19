import {
  enqueueLogEntry,
  flushLogTransport,
  getLogTransportMetrics,
  resetLogTransportForTests,
  setLogWriterForTests,
  type StructuredLogEntry,
} from '../log-transport';

const createEntry = (level: StructuredLogEntry['level'], event: string): StructuredLogEntry => ({
  timestamp: new Date().toISOString(),
  level,
  event,
  requestId: `${event}-request`,
  actorRef: 'act_test',
  source: 'http',
  routeOrJob: 'GET /test',
});

describe('log transport', () => {
  afterEach(async () => {
    setLogWriterForTests(async () => undefined);
    await flushLogTransport(200);
    resetLogTransportForTests();
    setLogWriterForTests(null);
  });

  it('counts dropped entries on queue overflow', async () => {
    let releaseWriter: (() => void) | undefined;
    const writerGate = new Promise<void>((resolve) => {
      releaseWriter = resolve;
    });

    setLogWriterForTests(async () => {
      await writerGate;
    });

    for (let index = 0; index < 1105; index += 1) {
      enqueueLogEntry(createEntry('info', `overflow-${index}`));
    }

    const duringOverflow = getLogTransportMetrics();
    expect(duringOverflow.dropped).toBeGreaterThan(0);

    releaseWriter?.();
    await flushLogTransport(1000);
  });

  it('increments failed and opens the breaker on repeated writer failures', async () => {
    setLogWriterForTests(async () => {
      throw new Error('writer-down');
    });

    for (let index = 0; index < 6; index += 1) {
      enqueueLogEntry(createEntry('warn', `failure-${index}`));
    }

    await new Promise((resolve) => setTimeout(resolve, 50));

    const metrics = getLogTransportMetrics();
    expect(metrics.failed).toBeGreaterThanOrEqual(5);
    expect(metrics.breakerState).toBe('open');
  });

  it('drops debug logs while the breaker is open and keeps warn logs queued', async () => {
    setLogWriterForTests(async () => {
      throw new Error('writer-down');
    });

    for (let index = 0; index < 6; index += 1) {
      enqueueLogEntry(createEntry('warn', `breaker-${index}`));
    }

    await new Promise((resolve) => setTimeout(resolve, 50));

    const before = getLogTransportMetrics();
    enqueueLogEntry(createEntry('debug', 'debug-while-open'));
    enqueueLogEntry(createEntry('warn', 'warn-while-open'));

    const after = getLogTransportMetrics();
    expect(after.dropped).toBeGreaterThan(before.dropped);
    expect(after.queued).toBeGreaterThanOrEqual(before.queued);
  });

  it('flushes queued logs during shutdown best-effort', async () => {
    const written: string[] = [];
    setLogWriterForTests(async (line) => {
      written.push(line);
    });

    enqueueLogEntry(createEntry('info', 'flush-1'));
    enqueueLogEntry(createEntry('error', 'flush-2'));

    const flushed = await flushLogTransport(500);
    const metrics = getLogTransportMetrics();

    expect(flushed).toBe(true);
    expect(metrics.queued).toBe(0);
    expect(metrics.sent).toBeGreaterThanOrEqual(2);
    expect(written).toHaveLength(2);
  });
});
