const BUCKET_UPPER_MS = [50, 100, 250, 500, 1000, 3000, 5000] as const;
const NUM_BUCKETS = BUCKET_UPPER_MS.length + 1;

type LatencyHistogram = {
  counts: number[];
  total: number;
};

type EmailTypeMetrics = {
  sent_total: number;
  failed_total: number;
  timeout_total: number;
  latency: LatencyHistogram;
};

type EmailMetricsStore = {
  sent_total: number;
  failed_total: number;
  timeout_total: number;
  latency: LatencyHistogram;
  byType: Record<string, EmailTypeMetrics>;
};

function newHistogram(): LatencyHistogram {
  return { counts: new Array<number>(NUM_BUCKETS).fill(0), total: 0 };
}

function recordSample(hist: LatencyHistogram, ms: number): void {
  hist.total++;
  let i = 0;
  while (i < BUCKET_UPPER_MS.length && ms >= BUCKET_UPPER_MS[i]) {
    i++;
  }
  hist.counts[i]++;
}

function percentileFromHistogram(hist: LatencyHistogram, p: number): number {
  if (hist.total === 0) return 0;
  const target = Math.ceil((p / 100) * hist.total);
  let cumulative = 0;
  for (let i = 0; i < hist.counts.length; i++) {
    cumulative += hist.counts[i];
    if (cumulative >= target) {
      return i < BUCKET_UPPER_MS.length
        ? BUCKET_UPPER_MS[i]
        : BUCKET_UPPER_MS[BUCKET_UPPER_MS.length - 1];
    }
  }
  return 0;
}

function newTypeMetrics(): EmailTypeMetrics {
  return {
    sent_total: 0,
    failed_total: 0,
    timeout_total: 0,
    latency: newHistogram(),
  };
}

const store: EmailMetricsStore = {
  sent_total: 0,
  failed_total: 0,
  timeout_total: 0,
  latency: newHistogram(),
  byType: {},
};

function getTypeMetrics(type: string): EmailTypeMetrics {
  if (!store.byType[type]) {
    store.byType[type] = newTypeMetrics();
  }
  return store.byType[type];
}

export function recordEmailSendSuccess(type: string, latencyMs: number): void {
  store.sent_total++;
  recordSample(store.latency, latencyMs);

  const typeMetrics = getTypeMetrics(type);
  typeMetrics.sent_total++;
  recordSample(typeMetrics.latency, latencyMs);
}

export function recordEmailSendFailure(type: string, latencyMs: number, timedOut: boolean): void {
  store.failed_total++;
  if (timedOut) {
    store.timeout_total++;
  }
  recordSample(store.latency, latencyMs);

  const typeMetrics = getTypeMetrics(type);
  typeMetrics.failed_total++;
  if (timedOut) {
    typeMetrics.timeout_total++;
  }
  recordSample(typeMetrics.latency, latencyMs);
}

export type EmailMetricsSnapshot = {
  email_sent_total: number;
  email_failed_total: number;
  email_timeout_total: number;
  email_latency_ms: {
    p50: number;
    p95: number;
    p99: number;
  };
  by_type: Record<string, {
    email_sent_total: number;
    email_failed_total: number;
    email_timeout_total: number;
    email_latency_ms: {
      p50: number;
      p95: number;
      p99: number;
    };
  }>;
};

export function getEmailMetricsSnapshot(): EmailMetricsSnapshot {
  return {
    email_sent_total: store.sent_total,
    email_failed_total: store.failed_total,
    email_timeout_total: store.timeout_total,
    email_latency_ms: {
      p50: percentileFromHistogram(store.latency, 50),
      p95: percentileFromHistogram(store.latency, 95),
      p99: percentileFromHistogram(store.latency, 99),
    },
    by_type: Object.fromEntries(
      Object.entries(store.byType).map(([type, metrics]) => [
        type,
        {
          email_sent_total: metrics.sent_total,
          email_failed_total: metrics.failed_total,
          email_timeout_total: metrics.timeout_total,
          email_latency_ms: {
            p50: percentileFromHistogram(metrics.latency, 50),
            p95: percentileFromHistogram(metrics.latency, 95),
            p99: percentileFromHistogram(metrics.latency, 99),
          },
        },
      ]),
    ),
  };
}

export function resetEmailMetrics(): void {
  store.sent_total = 0;
  store.failed_total = 0;
  store.timeout_total = 0;
  store.latency = newHistogram();
  store.byType = {};
}
