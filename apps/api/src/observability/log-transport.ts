import { once } from 'node:events';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'security';
export type BreakerState = 'closed' | 'open' | 'half-open';

export type StructuredLogEntry = {
  timestamp: string;
  level: LogLevel;
  event: string;
  requestId: string;
  actorRef: string;
  source: string;
  routeOrJob?: string;
  context?: Record<string, unknown>;
};

type QueueEntry = {
  line: string;
  level: LogLevel;
};

type LogWriter = (line: string, stream: 'stdout' | 'stderr') => Promise<void>;

type TransportMetrics = {
  queued: number;
  sent: number;
  dropped: number;
  failed: number;
  breakerState: BreakerState;
};

const LOG_QUEUE_MAX = Number(process.env.LOG_QUEUE_MAX || '1000');
const BREAKER_FAILURE_THRESHOLD = Number(process.env.LOG_BREAKER_FAILURE_THRESHOLD || '5');
const BREAKER_COOLDOWN_MS = Number(process.env.LOG_BREAKER_COOLDOWN_MS || '30000');
const DEFAULT_FLUSH_TIMEOUT_MS = Number(process.env.LOG_SHUTDOWN_FLUSH_TIMEOUT_MS || '2000');

const queue: QueueEntry[] = [];
const metrics: TransportMetrics = {
  queued: 0,
  sent: 0,
  dropped: 0,
  failed: 0,
  breakerState: 'closed',
};

let currentWriter: LogWriter = async (line, stream) => {
  const target = stream === 'stderr' ? process.stderr : process.stdout;
  if (target.write(`${line}\n`)) {
    return;
  }
  await once(target, 'drain');
};

let processing = false;
let consecutiveFailures = 0;
let breakerTimer: NodeJS.Timeout | null = null;
let breakerOpenedAt = 0;
let shutdownHandlersRegistered = false;

const getPriority = (level: LogLevel): number => {
  switch (level) {
    case 'security':
      return 50;
    case 'error':
      return 40;
    case 'warn':
      return 30;
    case 'info':
      return 20;
    default:
      return 10;
  }
};

const targetStream = (level: LogLevel): 'stdout' | 'stderr' =>
  level === 'warn' || level === 'error' || level === 'security' ? 'stderr' : 'stdout';

function refreshQueuedMetric(): void {
  metrics.queued = queue.length;
}

function clearBreakerTimer(): void {
  if (breakerTimer) {
    clearTimeout(breakerTimer);
    breakerTimer = null;
  }
}

function scheduleBreakerRecovery(): void {
  clearBreakerTimer();
  breakerTimer = setTimeout(() => {
    metrics.breakerState = 'half-open';
    breakerTimer = null;
    void pumpQueue();
  }, BREAKER_COOLDOWN_MS);
}

function openBreaker(): void {
  metrics.breakerState = 'open';
  breakerOpenedAt = Date.now();
  scheduleBreakerRecovery();
}

function closeBreaker(): void {
  metrics.breakerState = 'closed';
  consecutiveFailures = 0;
  breakerOpenedAt = 0;
  clearBreakerTimer();
}

function evictLowerPriorityEntry(incomingLevel: LogLevel): boolean {
  const incomingPriority = getPriority(incomingLevel);
  const candidateIndex = queue.findIndex((entry) => getPriority(entry.level) < incomingPriority);

  if (candidateIndex === -1) {
    return false;
  }

  queue.splice(candidateIndex, 1);
  metrics.dropped += 1;
  refreshQueuedMetric();
  return true;
}

function shouldDropForBreaker(level: LogLevel): boolean {
  if (metrics.breakerState === 'open' && Date.now() - breakerOpenedAt < BREAKER_COOLDOWN_MS) {
    return level === 'debug';
  }

  return false;
}

async function writeQueueEntry(entry: QueueEntry): Promise<void> {
  await currentWriter(entry.line, targetStream(entry.level));
}

async function pumpQueue(): Promise<void> {
  if (processing) {
    return;
  }

  processing = true;

  try {
    while (queue.length > 0) {
      if (metrics.breakerState === 'open' && Date.now() - breakerOpenedAt < BREAKER_COOLDOWN_MS) {
        return;
      }

      if (metrics.breakerState === 'open') {
        metrics.breakerState = 'half-open';
      }

      const entry = queue.shift();
      refreshQueuedMetric();

      if (!entry) {
        return;
      }

      try {
        await writeQueueEntry(entry);
        metrics.sent += 1;
        closeBreaker();
      } catch {
        metrics.failed += 1;
        consecutiveFailures += 1;

        if (metrics.breakerState === 'half-open' || consecutiveFailures >= BREAKER_FAILURE_THRESHOLD) {
          openBreaker();
          return;
        }
      }
    }
  } finally {
    processing = false;
  }
}

export function enqueueLogEntry(entry: StructuredLogEntry): void {
  if (shouldDropForBreaker(entry.level)) {
    metrics.dropped += 1;
    return;
  }

  const queueEntry: QueueEntry = {
    line: JSON.stringify(entry),
    level: entry.level,
  };

  if (queue.length >= LOG_QUEUE_MAX && !evictLowerPriorityEntry(entry.level)) {
    metrics.dropped += 1;
    refreshQueuedMetric();
    return;
  }

  queue.push(queueEntry);
  refreshQueuedMetric();
  void pumpQueue();
}

export function getLogTransportMetrics(): TransportMetrics {
  return {
    ...metrics,
    queued: queue.length,
  };
}

export async function flushLogTransport(timeoutMs = DEFAULT_FLUSH_TIMEOUT_MS): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while ((queue.length > 0 || processing) && Date.now() < deadline) {
    if (!processing) {
      await pumpQueue();
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  const flushed = queue.length === 0 && !processing;
  if (!flushed) {
    metrics.dropped += queue.length;
    queue.length = 0;
    refreshQueuedMetric();
  }

  return flushed;
}

export function registerLogTransportShutdownHandlers(): void {
  if (shutdownHandlersRegistered || process.env.NODE_ENV === 'test') {
    return;
  }

  shutdownHandlersRegistered = true;
  const handler = async () => {
    await flushLogTransport();
  };

  process.once('SIGINT', () => {
    void handler().finally(() => process.exit(130));
  });
  process.once('SIGTERM', () => {
    void handler().finally(() => process.exit(143));
  });
}

export function setLogWriterForTests(writer: LogWriter | null): void {
  currentWriter = writer ?? (async (line, stream) => {
    const target = stream === 'stderr' ? process.stderr : process.stdout;
    if (target.write(`${line}\n`)) {
      return;
    }
    await once(target, 'drain');
  });
}

export function resetLogTransportForTests(): void {
  queue.length = 0;
  processing = false;
  consecutiveFailures = 0;
  metrics.sent = 0;
  metrics.dropped = 0;
  metrics.failed = 0;
  metrics.breakerState = 'closed';
  refreshQueuedMetric();
  clearBreakerTimer();
}
