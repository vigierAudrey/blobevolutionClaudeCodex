import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  incHttpRequest,
  incHttp5xx,
  recordHttpLatency,
  isExcludedPath,
  getHttpMetricsSnapshot,
  resetHttpMetrics,
} from '../http-metrics';

describe('http-metrics', () => {
  beforeEach(() => {
    resetHttpMetrics();
  });

  // ── isExcludedPath ──────────────────────────────────────────────────────────

  describe('isExcludedPath', () => {
    it('excludes /health', () => {
      expect(isExcludedPath('/health')).toBe(true);
    });

    it('excludes /internal/metrics', () => {
      expect(isExcludedPath('/internal/metrics')).toBe(true);
    });

    it('excludes /security/health', () => {
      expect(isExcludedPath('/security/health')).toBe(true);
    });

    it('excludes /security/observability', () => {
      expect(isExcludedPath('/security/observability')).toBe(true);
    });

    it('does not exclude /auth/login', () => {
      expect(isExcludedPath('/auth/login')).toBe(false);
    });

    it('does not exclude /matching/search', () => {
      expect(isExcludedPath('/matching/search')).toBe(false);
    });

    it('does not exclude /', () => {
      expect(isExcludedPath('/')).toBe(false);
    });
  });

  // ── Initial state ───────────────────────────────────────────────────────────

  describe('initial state', () => {
    it('starts at zero', () => {
      const snap = getHttpMetricsSnapshot();
      expect(snap.requests_total).toBe(0);
      expect(snap.errors_5xx_total).toBe(0);
      expect(snap.error_5xx_rate).toBe(0);
      expect(snap.latency_p50_ms).toBe(0);
      expect(snap.latency_p95_ms).toBe(0);
      expect(snap.latency_p99_ms).toBe(0);
    });
  });

  // ── Counters ────────────────────────────────────────────────────────────────

  describe('incHttpRequest', () => {
    it('increments requests_total', () => {
      incHttpRequest();
      incHttpRequest();
      expect(getHttpMetricsSnapshot().requests_total).toBe(2);
    });
  });

  describe('incHttp5xx', () => {
    it('increments errors_5xx_total', () => {
      incHttp5xx();
      expect(getHttpMetricsSnapshot().errors_5xx_total).toBe(1);
    });

    it('computes error_5xx_rate correctly', () => {
      incHttpRequest();
      incHttpRequest();
      incHttpRequest();
      incHttpRequest();
      incHttp5xx();
      // 1/4 = 0.25
      expect(getHttpMetricsSnapshot().error_5xx_rate).toBe(0.25);
    });

    it('error_5xx_rate is 0 when no requests', () => {
      incHttp5xx();
      expect(getHttpMetricsSnapshot().error_5xx_rate).toBe(0);
    });
  });

  // ── Latency histogram ───────────────────────────────────────────────────────

  describe('recordHttpLatency', () => {
    it('p50 falls in correct bucket for a single fast sample', () => {
      recordHttpLatency(5); // < 10ms bucket
      const snap = getHttpMetricsSnapshot();
      expect(snap.latency_p50_ms).toBe(10);
    });

    it('recordHttpLatency(10) falls in [10, 25) bucket — p50 returns 25', () => {
      // ms=10 satisfies ms >= BUCKET_UPPER_MS[0] (10), so the loop moves to index 1.
      // Bucket index 1 has upper bound 25ms → percentile returns 25.
      // This pins the boundary behaviour: 10ms is NOT in the [0, 10) bucket.
      recordHttpLatency(10);
      const snap = getHttpMetricsSnapshot();
      expect(snap.latency_p50_ms).toBe(25);
    });

    it('p50/p95/p99 are 0 when no samples', () => {
      const snap = getHttpMetricsSnapshot();
      expect(snap.latency_p50_ms).toBe(0);
      expect(snap.latency_p95_ms).toBe(0);
      expect(snap.latency_p99_ms).toBe(0);
    });

    it('p99 reflects slow outliers when 2% of requests are slow', () => {
      // 98 fast + 2 slow out of 100 total.
      // p99 = ceil(0.99 * 100) = 99th sample → falls in the slow bucket.
      for (let i = 0; i < 98; i++) recordHttpLatency(5);
      recordHttpLatency(2000);
      recordHttpLatency(2000);
      const snap = getHttpMetricsSnapshot();
      expect(snap.latency_p50_ms).toBeLessThanOrEqual(25);
      expect(snap.latency_p99_ms).toBeGreaterThanOrEqual(1000);
    });

    it('all samples in same bucket give same p50/p95/p99', () => {
      for (let i = 0; i < 10; i++) recordHttpLatency(300); // 250–500ms bucket
      const snap = getHttpMetricsSnapshot();
      expect(snap.latency_p50_ms).toBe(500);
      expect(snap.latency_p95_ms).toBe(500);
      expect(snap.latency_p99_ms).toBe(500);
    });
  });

  // ── resetHttpMetrics ────────────────────────────────────────────────────────

  describe('resetHttpMetrics', () => {
    it('clears all counters and histogram', () => {
      incHttpRequest();
      incHttp5xx();
      recordHttpLatency(100);
      resetHttpMetrics();
      const snap = getHttpMetricsSnapshot();
      expect(snap.requests_total).toBe(0);
      expect(snap.errors_5xx_total).toBe(0);
      expect(snap.error_5xx_rate).toBe(0);
      expect(snap.latency_p50_ms).toBe(0);
    });
  });

  // ── Snapshot shape ──────────────────────────────────────────────────────────

  describe('getHttpMetricsSnapshot shape', () => {
    it('returns all required fields', () => {
      const snap = getHttpMetricsSnapshot();
      expect(snap).toHaveProperty('requests_total');
      expect(snap).toHaveProperty('errors_5xx_total');
      expect(snap).toHaveProperty('error_5xx_rate');
      expect(snap).toHaveProperty('latency_p50_ms');
      expect(snap).toHaveProperty('latency_p95_ms');
      expect(snap).toHaveProperty('latency_p99_ms');
    });

    it('snapshot is a plain object (no functions, no circular refs)', () => {
      incHttpRequest();
      recordHttpLatency(50);
      const snap = getHttpMetricsSnapshot();
      expect(() => JSON.stringify(snap)).not.toThrow();
    });

    it('error_5xx_rate is rounded to 4 decimal places', () => {
      // 1/3 ≈ 0.3333...
      incHttpRequest();
      incHttpRequest();
      incHttpRequest();
      incHttp5xx();
      const rate = getHttpMetricsSnapshot().error_5xx_rate;
      expect(rate).toBe(Math.round((1 / 3) * 10000) / 10000);
    });
  });
});
