/**
 * HTTP metrics — global request counters & latency histogram.
 *
 * Design rules:
 *  - NO PII. NO per-route labels. Counters are global to avoid cardinality
 *    explosion on dynamic path segments (/profile/:id, /booking/:id, etc.).
 *  - All counters are process-lifetime (reset on restart). Values decrease
 *    monotonically only via resetHttpMetrics() in tests.
 *  - Monitoring/healthcheck paths are excluded so they don't inflate counts.
 *  - Snapshot exported via GET /internal/metrics (aggregated in index.ts).
 *  - resetHttpMetrics() is for tests only — never call in production handlers.
 *
 * Histogram design (same bucket schema as matching-metrics.ts):
 *  Upper bounds (ms): [10, 25, 50, 100, 250, 500, 1000, 2000, 5000, ∞]
 *  p-value approximation: first bucket whose cumulative count ≥ ⌈(p/100)×total⌉.
 *  Over-estimates by at most one bucket width — acceptable for operational use.
 */

// ── Histogram internals ────────────────────────────────────────────────────────

const BUCKET_UPPER_MS = [10, 25, 50, 100, 250, 500, 1000, 2000, 5000] as const;
const NUM_BUCKETS = BUCKET_UPPER_MS.length + 1; // +1 for overflow ≥5000ms

type LatencyHistogram = {
  counts: number[];
  total: number;
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

// ── Excluded paths ─────────────────────────────────────────────────────────────
//
// Monitoring and healthcheck endpoints must not count as application traffic:
// - /health: liveness probe, called by load balancers
// - /internal/metrics: the metrics endpoint itself
// - /security/health: security posture check
// - /security/observability: log pipeline state
//
// These are excluded so that high-frequency monitoring polls do not inflate
// requests_total or distort latency percentiles.

const EXCLUDED_PATHS = new Set([
  '/health',
  '/internal/metrics',
  '/security/health',
  '/security/observability',
]);

export function isExcludedPath(path: string): boolean {
  return EXCLUDED_PATHS.has(path);
}

// ── Store ──────────────────────────────────────────────────────────────────────

type HttpMetricsStore = {
  requests_total: number;
  errors_5xx_total: number;
  latency: LatencyHistogram;
};

const store: HttpMetricsStore = {
  requests_total: 0,
  errors_5xx_total: 0,
  latency: newHistogram(),
};

// ── Mutators (called from middleware, never from request-handler bodies) ────────

export function incHttpRequest(): void {
  store.requests_total++;
}

export function incHttp5xx(): void {
  store.errors_5xx_total++;
}

export function recordHttpLatency(ms: number): void {
  recordSample(store.latency, ms);
}

// ── Snapshot ──────────────────────────────────────────────────────────────────

export type HttpMetricsSnapshot = {
  requests_total: number;
  errors_5xx_total: number;
  /** Fraction of requests that resulted in 5xx. 0 when no requests. */
  error_5xx_rate: number;
  latency_p50_ms: number;
  latency_p95_ms: number;
  latency_p99_ms: number;
};

export function getHttpMetricsSnapshot(): HttpMetricsSnapshot {
  return {
    requests_total: store.requests_total,
    errors_5xx_total: store.errors_5xx_total,
    error_5xx_rate:
      store.requests_total > 0
        ? Math.round((store.errors_5xx_total / store.requests_total) * 10000) / 10000
        : 0,
    latency_p50_ms: percentileFromHistogram(store.latency, 50),
    latency_p95_ms: percentileFromHistogram(store.latency, 95),
    latency_p99_ms: percentileFromHistogram(store.latency, 99),
  };
}

/** Reset all counters — for use in tests only. */
export function resetHttpMetrics(): void {
  store.requests_total = 0;
  store.errors_5xx_total = 0;
  store.latency = newHistogram();
}
