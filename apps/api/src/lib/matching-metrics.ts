/**
 * Matching module metrics — module-level counters & bucketed latency histograms.
 *
 * Rules:
 *  - No PII, no tokens, no request-scoped identifiers stored here.
 *  - Latency is stored as a bucketed histogram — O(constant) memory regardless of
 *    request volume.  No unbounded arrays, no rolling-window buffers.
 *  - p50/p95/p99 are approximations based on bucket cumulative sums.
 *  - Snapshot exported via GET /internal/metrics under the "matching" key (aggregated with http + log_transport + process).
 *  - resetMatchingMetrics() is for tests only — never call in production handlers.
 *
 * Histogram design:
 *  Bucket upper bounds (ms): [10, 25, 50, 100, 250, 500, 1000, 2000, 5000, ∞]
 *  - A sample with ms < 10   falls in bucket 0 (represented as ≤10ms)
 *  - A sample with ms < 25   falls in bucket 1 (represented as ≤25ms)
 *  - ...
 *  - A sample with ms < 2000 falls in bucket 7 (represented as ≤2000ms)
 *  - A sample with ms < 5000 falls in bucket 8 (represented as ≤5000ms)
 *  - A sample with ms ≥ 5000 falls in the overflow bucket (represented as 5000ms)
 *
 *  p-value approximation:
 *    For percentile p, find the first bucket where the cumulative count reaches
 *    ⌈p/100 × total⌉, then return its upper bound.  This over-estimates by at
 *    most one bucket width — acceptable for operational monitoring.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Histogram internals
// ─────────────────────────────────────────────────────────────────────────────

/** Upper bound (exclusive) for each bucket.  Last bucket is open (≥ last value). */
const BUCKET_UPPER_MS = [10, 25, 50, 100, 250, 500, 1000, 2000, 5000] as const;
const NUM_BUCKETS = BUCKET_UPPER_MS.length + 1; // +1 for the ">5000" overflow bucket

type LatencyHistogram = {
  /** counts[i] = number of samples that fall in bucket i */
  counts: number[];
  total: number;
};

function newHistogram(): LatencyHistogram {
  return { counts: new Array(NUM_BUCKETS).fill(0), total: 0 };
}

function recordSample(hist: LatencyHistogram, ms: number): void {
  hist.total++;
  let i = 0;
  while (i < BUCKET_UPPER_MS.length && ms >= BUCKET_UPPER_MS[i]) {
    i++;
  }
  hist.counts[i]++;
}

/**
 * Returns the approximate p-th percentile from a histogram.
 *
 * Algorithm: cumulative scan — find the first bucket whose running count
 * reaches ⌈(p/100) × total⌉, then return the bucket's upper bound.
 * The overflow bucket (>1000ms) is represented as 1000 (its lower bound).
 */
function percentileFromHistogram(hist: LatencyHistogram, p: number): number {
  if (hist.total === 0) return 0;
  const target = Math.ceil((p / 100) * hist.total);
  let cumulative = 0;
  for (let i = 0; i < hist.counts.length; i++) {
    cumulative += hist.counts[i];
    if (cumulative >= target) {
      // For all finite buckets return the upper bound.
      // For the overflow bucket (i === BUCKET_UPPER_MS.length), return the
      // lower bound (1000) — signals "at least 1000ms".
      return i < BUCKET_UPPER_MS.length
        ? BUCKET_UPPER_MS[i]
        : BUCKET_UPPER_MS[BUCKET_UPPER_MS.length - 1];
    }
  }
  return 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Store
// ─────────────────────────────────────────────────────────────────────────────

type MatchingMetricsStore = {
  search_requests: number;
  search_cache_hits: number;
  search_cache_misses: number;
  search_errors_4xx: number;
  search_errors_5xx: number;
  search_latency: LatencyHistogram;
  decisions_requests: number;
  decisions_accept: number;
  decisions_refuse: number;
  decisions_errors_4xx: number;
  decisions_errors_5xx: number;
  decisions_latency: LatencyHistogram;
};

const store: MatchingMetricsStore = {
  search_requests: 0,
  search_cache_hits: 0,
  search_cache_misses: 0,
  search_errors_4xx: 0,
  search_errors_5xx: 0,
  search_latency: newHistogram(),
  decisions_requests: 0,
  decisions_accept: 0,
  decisions_refuse: 0,
  decisions_errors_4xx: 0,
  decisions_errors_5xx: 0,
  decisions_latency: newHistogram(),
};

// ── Search ────────────────────────────────────────────────────────────────────

export function incSearchRequest(): void {
  store.search_requests++;
}

export function incSearchCacheHit(): void {
  store.search_cache_hits++;
}

export function incSearchCacheMiss(): void {
  store.search_cache_misses++;
}

export function incSearchError4xx(): void {
  store.search_errors_4xx++;
}

export function incSearchError5xx(): void {
  store.search_errors_5xx++;
}

export function recordSearchLatency(ms: number): void {
  recordSample(store.search_latency, ms);
}

// ── Decisions ─────────────────────────────────────────────────────────────────

export function incDecisionsRequest(): void {
  store.decisions_requests++;
}

export function incDecisionsAccept(count: number): void {
  store.decisions_accept += count;
}

export function incDecisionsRefuse(count: number): void {
  store.decisions_refuse += count;
}

export function incDecisionsError4xx(): void {
  store.decisions_errors_4xx++;
}

export function incDecisionsError5xx(): void {
  store.decisions_errors_5xx++;
}

export function recordDecisionsLatency(ms: number): void {
  recordSample(store.decisions_latency, ms);
}

// ── Snapshot ──────────────────────────────────────────────────────────────────

export function getMatchingMetricsSnapshot() {
  return {
    search: {
      requests: store.search_requests,
      cache_hits: store.search_cache_hits,
      cache_misses: store.search_cache_misses,
      cache_hit_rate:
        store.search_requests > 0
          ? Math.round((store.search_cache_hits / store.search_requests) * 100) / 100
          : 0,
      errors_4xx: store.search_errors_4xx,
      errors_5xx: store.search_errors_5xx,
      latency_p50_ms: percentileFromHistogram(store.search_latency, 50),
      latency_p95_ms: percentileFromHistogram(store.search_latency, 95),
      latency_p99_ms: percentileFromHistogram(store.search_latency, 99),
    },
    decisions: {
      requests: store.decisions_requests,
      accept_total: store.decisions_accept,
      refuse_total: store.decisions_refuse,
      errors_4xx: store.decisions_errors_4xx,
      errors_5xx: store.decisions_errors_5xx,
      latency_p50_ms: percentileFromHistogram(store.decisions_latency, 50),
      latency_p95_ms: percentileFromHistogram(store.decisions_latency, 95),
      latency_p99_ms: percentileFromHistogram(store.decisions_latency, 99),
    },
  };
}

/** Reset all counters and histograms — for use in tests only. */
export function resetMatchingMetrics(): void {
  store.search_requests = 0;
  store.search_cache_hits = 0;
  store.search_cache_misses = 0;
  store.search_errors_4xx = 0;
  store.search_errors_5xx = 0;
  store.search_latency = newHistogram();
  store.decisions_requests = 0;
  store.decisions_accept = 0;
  store.decisions_refuse = 0;
  store.decisions_errors_4xx = 0;
  store.decisions_errors_5xx = 0;
  store.decisions_latency = newHistogram();
}
