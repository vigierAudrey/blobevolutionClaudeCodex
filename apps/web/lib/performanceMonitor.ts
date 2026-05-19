/**
 * Performance monitoring for API optimizations
 * Tracks and reports API performance improvements
 */

interface PerformanceMetric {
  name: string;
  duration: number;
  timestamp: number;
  cacheHit?: boolean;
  endpoint?: string;
  metadata?: Record<string, unknown>;
}

interface PerformanceStats {
  averageDuration: number;
  minDuration: number;
  maxDuration: number;
  totalRequests: number;
  cacheHitRate?: number;
  p50: number;
  p90: number;
  p95: number;
}

class PerformanceMonitor {
  private metrics: PerformanceMetric[] = [];
  private maxMetrics = 1000; // Keep last 1000 metrics

  /**
   * Record a performance metric
   */
  record(metric: PerformanceMetric): void {
    this.metrics.push(metric);

    // Keep only last N metrics to prevent memory bloat
    if (this.metrics.length > this.maxMetrics) {
      this.metrics = this.metrics.slice(-this.maxMetrics);
    }

    // Log performance in development
    if (process.env.NODE_ENV === 'development') {
      const cacheStatus = metric.cacheHit ? ' [CACHED]' : '';
      console.log(`⏱️ ${metric.name}: ${metric.duration.toFixed(1)}ms${cacheStatus}`);
    }
  }

  /**
   * Get performance statistics for a specific metric name
   */
  getStats(name?: string): PerformanceStats | null {
    const filteredMetrics = name
      ? this.metrics.filter(m => m.name === name)
      : this.metrics;

    if (filteredMetrics.length === 0) return null;

    const durations = filteredMetrics.map(m => m.duration).sort((a, b) => a - b);
    const cacheHits = filteredMetrics.filter(m => m.cacheHit).length;

    return {
      averageDuration: durations.reduce((sum, d) => sum + d, 0) / durations.length,
      minDuration: durations[0],
      maxDuration: durations[durations.length - 1],
      totalRequests: durations.length,
      cacheHitRate: cacheHits / durations.length,
      p50: this.percentile(durations, 50),
      p90: this.percentile(durations, 90),
      p95: this.percentile(durations, 95),
    };
  }

  /**
   * Get all performance data grouped by metric name
   */
  getAllStats(): Record<string, PerformanceStats> {
    const groupedMetrics = this.metrics.reduce((groups, metric) => {
      if (!groups[metric.name]) {
        groups[metric.name] = [];
      }
      groups[metric.name].push(metric);
      return groups;
    }, {} as Record<string, PerformanceMetric[]>);

    const stats: Record<string, PerformanceStats> = {};

    for (const [name, metrics] of Object.entries(groupedMetrics)) {
      const durations = metrics.map(m => m.duration).sort((a, b) => a - b);
      const cacheHits = metrics.filter(m => m.cacheHit).length;

      stats[name] = {
        averageDuration: durations.reduce((sum, d) => sum + d, 0) / durations.length,
        minDuration: durations[0],
        maxDuration: durations[durations.length - 1],
        totalRequests: durations.length,
        cacheHitRate: cacheHits / durations.length,
        p50: this.percentile(durations, 50),
        p90: this.percentile(durations, 90),
        p95: this.percentile(durations, 95),
      };
    }

    return stats;
  }

  /**
   * Get recent metrics within a time window
   */
  getRecentMetrics(windowMs: number = 60000): PerformanceMetric[] {
    const cutoff = Date.now() - windowMs;
    return this.metrics.filter(m => m.timestamp >= cutoff);
  }

  /**
   * Clear all metrics
   */
  clear(): void {
    this.metrics = [];
  }

  /**
   * Export metrics as CSV for analysis
   */
  exportCSV(): string {
    const headers = ['name', 'duration', 'timestamp', 'cacheHit', 'endpoint'];
    const rows = this.metrics.map(m => [
      m.name,
      m.duration.toFixed(2),
      new Date(m.timestamp).toISOString(),
      m.cacheHit ? 'true' : 'false',
      m.endpoint || '',
    ]);

    return [headers, ...rows].map(row => row.join(',')).join('\n');
  }

  /**
   * Generate performance report
   */
  generateReport(): string {
    const stats = this.getAllStats();
    const totalMetrics = this.metrics.length;

    let report = `📊 Performance Report (${totalMetrics} requests)\n`;
    report += `Generated at: ${new Date().toISOString()}\n\n`;

    if (totalMetrics === 0) {
      report += 'No metrics recorded yet.\n';
      return report;
    }

    // Overall cache performance
    const allCacheHits = this.metrics.filter(m => m.cacheHit).length;
    const overallCacheRate = (allCacheHits / totalMetrics) * 100;
    report += `🚀 Overall Cache Hit Rate: ${overallCacheRate.toFixed(1)}%\n\n`;

    // Individual metric stats
    Object.entries(stats).forEach(([name, stat]) => {
      report += `📈 ${name}:\n`;
      report += `  Avg: ${stat.averageDuration.toFixed(1)}ms\n`;
      report += `  P50: ${stat.p50.toFixed(1)}ms\n`;
      report += `  P90: ${stat.p90.toFixed(1)}ms\n`;
      report += `  Cache: ${(stat.cacheHitRate! * 100).toFixed(1)}%\n`;
      report += `  Requests: ${stat.totalRequests}\n\n`;
    });

    return report;
  }

  /**
   * Calculate percentile from sorted array
   */
  private percentile(sortedArray: number[], percentile: number): number {
    if (sortedArray.length === 0) return 0;
    const index = (percentile / 100) * (sortedArray.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);

    if (lower === upper) {
      return sortedArray[lower];
    }

    return sortedArray[lower] * (upper - index) + sortedArray[upper] * (index - lower);
  }
}

// Create singleton instance
export const performanceMonitor = new PerformanceMonitor();

// Helper function to create a performance measurement
export function measurePerformance(
  name: string,
  cacheHit = false,
  endpoint?: string,
  metadata?: Record<string, unknown>
) {
  const start = performance.now();
  return {
    end: () => {
      const duration = performance.now() - start;
      performanceMonitor.record({
        name,
        duration,
        timestamp: Date.now(),
        cacheHit,
        endpoint,
        metadata,
      });
      return duration;
    },
  };
}

// Development helpers
if (process.env.NODE_ENV === 'development' && typeof window !== 'undefined') {
  // Expose performance monitor for debugging
  type DebugPerformanceWindow = typeof window & {
    debugPerformance?: {
      monitor: PerformanceMonitor;
      stats: () => ReturnType<PerformanceMonitor['getAllStats']>;
      report: () => void;
      clear: () => void;
      export: () => void;
    };
  };

  (window as DebugPerformanceWindow).debugPerformance = {
    monitor: performanceMonitor,
    stats: () => performanceMonitor.getAllStats(),
    report: () => console.log(performanceMonitor.generateReport()),
    clear: () => performanceMonitor.clear(),
    export: () => {
      const csv = performanceMonitor.exportCSV();
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'performance-metrics.csv';
      a.click();
      URL.revokeObjectURL(url);
    },
  };

  // Auto-report every 2 minutes in development
  setInterval(() => {
    const stats = performanceMonitor.getAllStats();
    if (Object.keys(stats).length > 0) {
      console.log('📊 Performance Summary:', stats);
    }
  }, 2 * 60 * 1000);
}

// Real User Monitoring (RUM) - track actual user experience
export function trackWebVitals() {
  if (typeof window !== 'undefined') {
    // Track Largest Contentful Paint
    new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const lastEntry = entries[entries.length - 1];
      if (lastEntry) {
        performanceMonitor.record({
          name: 'LCP',
          duration: lastEntry.startTime,
          timestamp: Date.now(),
          metadata: { value: lastEntry.startTime },
        });
      }
    }).observe({ entryTypes: ['largest-contentful-paint'] });

    // Track First Input Delay
    new PerformanceObserver((list) => {
      const entries = list.getEntries();
      entries.forEach((entry) => {
        if ('processingStart' in entry) {
          const duration = (entry as EventTimingEntry).processingStart - entry.startTime;
          performanceMonitor.record({
            name: 'FID',
            duration,
            timestamp: Date.now(),
            metadata: { value: duration },
          });
        }
      });
    }).observe({ entryTypes: ['first-input'] });

    // Track Cumulative Layout Shift
    let clsValue = 0;
    new PerformanceObserver((list) => {
      const entries = list.getEntries();
      entries.forEach((entry) => {
        if ('hadRecentInput' in entry && 'value' in entry && !entry.hadRecentInput) {
          clsValue += (entry as LayoutShiftEntry).value;
        }
      });
      performanceMonitor.record({
        name: 'CLS',
        duration: clsValue,
        timestamp: Date.now(),
        metadata: { value: clsValue },
      });
    }).observe({ entryTypes: ['layout-shift'] });
  }
}

// Initialize Web Vitals tracking
if (typeof window !== 'undefined') {
  trackWebVitals();
}
type EventTimingEntry = PerformanceEntry & { processingStart: number };
type LayoutShiftEntry = PerformanceEntry & { value: number; hadRecentInput: boolean };
