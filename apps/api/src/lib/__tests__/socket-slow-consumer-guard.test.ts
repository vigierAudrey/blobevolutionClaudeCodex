import { EventEmitter } from 'events';

type SlowGuardModule = {
  attachSlowConsumerGuard: (socket: any) => void;
  getSlowConsumerMetrics: () => {
    enabled: boolean;
    overLimit: number;
    disconnectCount: number;
    typingDropped: number;
  };
  registerTypingDrop: () => void;
  resetSlowConsumerMetricsForTests: () => void;
};

class FakeSocket extends EventEmitter {
  id = 'socket-test-123';
  conn: any;
  disconnectCalled = false;
  disconnectReason: unknown = null;

  constructor() {
    super();
    this.conn = {
      transport: { writable: false },
      writeBuffer: new Array(200).fill({ packet: 'x' })
    };
  }

  disconnect(reason?: unknown) {
    this.disconnectCalled = true;
    this.disconnectReason = reason;
    this.emit('disconnect');
    return this as any;
  }
}

describe('Socket slow consumer guard', () => {
  const previousEnv = {
    mode: process.env.WS_SLOW_CONSUMER_GUARD,
    checkMs: process.env.WS_SLOW_CONSUMER_CHECK_INTERVAL_MS,
    maxStreak: process.env.WS_SLOW_CONSUMER_MAX_STREAK,
    maxPackets: process.env.WS_SLOW_CONSUMER_MAX_BUFFERED_PACKETS
  };

  beforeAll(() => {
    jest.useFakeTimers();
    process.env.WS_SLOW_CONSUMER_GUARD = 'on';
    process.env.WS_SLOW_CONSUMER_CHECK_INTERVAL_MS = '100';
    process.env.WS_SLOW_CONSUMER_MAX_STREAK = '3';
    process.env.WS_SLOW_CONSUMER_MAX_BUFFERED_PACKETS = '64';
    jest.resetModules();
  });

  afterAll(() => {
    jest.useRealTimers();
    // Restore or delete — assigning undefined stringifies to "undefined" in process.env,
    // which breaks strict comparisons (=== 'on') in modules loaded by later test files.
    const restore = (key: string, value: string | undefined) => {
      if (value === undefined) delete (process.env as any)[key];
      else process.env[key] = value;
    };
    restore('WS_SLOW_CONSUMER_GUARD', previousEnv.mode);
    restore('WS_SLOW_CONSUMER_CHECK_INTERVAL_MS', previousEnv.checkMs);
    restore('WS_SLOW_CONSUMER_MAX_STREAK', previousEnv.maxStreak);
    restore('WS_SLOW_CONSUMER_MAX_BUFFERED_PACKETS', previousEnv.maxPackets);
  });

  it('disconnects on persistent congestion and records metrics', () => {
    const module = require('../socket-slow-consumer-guard') as SlowGuardModule;
    module.resetSlowConsumerMetricsForTests();

    const socket = new FakeSocket();
    module.attachSlowConsumerGuard(socket as any);

    jest.advanceTimersByTime(350);

    expect(socket.disconnectCalled).toBe(true);
    const metrics = module.getSlowConsumerMetrics();
    expect(metrics.enabled).toBe(true);
    expect(metrics.overLimit).toBeGreaterThan(0);
    expect(metrics.disconnectCount).toBeGreaterThanOrEqual(1);
  });

  it('tracks explicit typing drops', () => {
    const module = require('../socket-slow-consumer-guard') as SlowGuardModule;
    module.resetSlowConsumerMetricsForTests();

    module.registerTypingDrop();
    module.registerTypingDrop();

    expect(module.getSlowConsumerMetrics().typingDropped).toBe(2);
  });
});
