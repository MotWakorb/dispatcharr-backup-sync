import { createLogger } from '../services/logger.js';

const log = createLogger('metrics');

/**
 * Counter metric - monotonically increasing value
 */
interface CounterMetric {
  type: 'counter';
  value: number;
  labels: Record<string, string>;
  description: string;
}

/**
 * Gauge metric - value that can go up or down
 */
interface GaugeMetric {
  type: 'gauge';
  value: number;
  labels: Record<string, string>;
  description: string;
}

/**
 * Histogram metric - distribution of values
 */
interface HistogramMetric {
  type: 'histogram';
  count: number;
  sum: number;
  buckets: Map<number, number>; // bucket upper bound -> count
  labels: Record<string, string>;
  description: string;
}

type Metric = CounterMetric | GaugeMetric | HistogramMetric;

/**
 * Default histogram buckets for latency measurements (in ms)
 */
const DEFAULT_LATENCY_BUCKETS = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

/**
 * Simple metrics collector for monitoring application performance.
 * Collects counters, gauges, and histograms.
 */
class MetricsCollector {
  private metrics: Map<string, Metric> = new Map();
  private startTime = Date.now();

  /**
   * Increment a counter
   */
  incrementCounter(name: string, labels: Record<string, string> = {}, delta: number = 1): void {
    const key = this.buildKey(name, labels);
    const existing = this.metrics.get(key);

    if (existing && existing.type === 'counter') {
      existing.value += delta;
    } else {
      this.metrics.set(key, {
        type: 'counter',
        value: delta,
        labels,
        description: name,
      });
    }
  }

  /**
   * Set a gauge value
   */
  setGauge(name: string, value: number, labels: Record<string, string> = {}): void {
    const key = this.buildKey(name, labels);
    this.metrics.set(key, {
      type: 'gauge',
      value,
      labels,
      description: name,
    });
  }

  /**
   * Increment a gauge value
   */
  incrementGauge(name: string, labels: Record<string, string> = {}, delta: number = 1): void {
    const key = this.buildKey(name, labels);
    const existing = this.metrics.get(key);

    if (existing && existing.type === 'gauge') {
      existing.value += delta;
    } else {
      this.setGauge(name, delta, labels);
    }
  }

  /**
   * Decrement a gauge value
   */
  decrementGauge(name: string, labels: Record<string, string> = {}, delta: number = 1): void {
    this.incrementGauge(name, labels, -delta);
  }

  /**
   * Record a histogram observation
   */
  observeHistogram(
    name: string,
    value: number,
    labels: Record<string, string> = {},
    buckets: number[] = DEFAULT_LATENCY_BUCKETS
  ): void {
    const key = this.buildKey(name, labels);
    let existing = this.metrics.get(key);

    if (!existing || existing.type !== 'histogram') {
      existing = {
        type: 'histogram',
        count: 0,
        sum: 0,
        buckets: new Map(buckets.map((b) => [b, 0])),
        labels,
        description: name,
      };
      this.metrics.set(key, existing);
    }

    const histogram = existing as HistogramMetric;
    histogram.count++;
    histogram.sum += value;

    // Update bucket counts
    for (const bucket of buckets) {
      if (value <= bucket) {
        histogram.buckets.set(bucket, (histogram.buckets.get(bucket) || 0) + 1);
      }
    }
  }

  /**
   * Timer helper - returns a function to call when operation completes
   */
  startTimer(name: string, labels: Record<string, string> = {}): () => number {
    const start = Date.now();
    return () => {
      const duration = Date.now() - start;
      this.observeHistogram(name, duration, labels);
      return duration;
    };
  }

  /**
   * Build a unique key for a metric with labels
   */
  private buildKey(name: string, labels: Record<string, string>): string {
    const sortedLabels = Object.keys(labels)
      .sort()
      .map((k) => `${k}="${labels[k]}"`)
      .join(',');
    return sortedLabels ? `${name}{${sortedLabels}}` : name;
  }

  /**
   * Get all metrics in a structured format
   */
  getMetrics(): Record<string, unknown> {
    const result: Record<string, unknown> = {
      uptime: Date.now() - this.startTime,
      timestamp: new Date().toISOString(),
      metrics: {} as Record<string, unknown>,
    };

    const metricsObj = result.metrics as Record<string, unknown>;

    for (const [key, metric] of this.metrics) {
      if (metric.type === 'histogram') {
        metricsObj[key] = {
          type: 'histogram',
          count: metric.count,
          sum: metric.sum,
          avg: metric.count > 0 ? Math.round(metric.sum / metric.count) : 0,
          buckets: Object.fromEntries(metric.buckets),
          labels: metric.labels,
        };
      } else {
        metricsObj[key] = {
          type: metric.type,
          value: metric.value,
          labels: metric.labels,
        };
      }
    }

    return result;
  }

  /**
   * Get a summary of key metrics
   */
  getSummary(): Record<string, unknown> {
    const counters: Record<string, number> = {};
    const gauges: Record<string, number> = {};
    const histogramSummaries: Record<string, { count: number; avg: number }> = {};

    for (const [key, metric] of this.metrics) {
      const baseName = key.split('{')[0];

      if (metric.type === 'counter') {
        counters[baseName] = (counters[baseName] || 0) + metric.value;
      } else if (metric.type === 'gauge') {
        gauges[baseName] = metric.value;
      } else if (metric.type === 'histogram') {
        const existing = histogramSummaries[baseName] || { count: 0, avg: 0 };
        const totalCount = existing.count + metric.count;
        const totalSum = existing.avg * existing.count + metric.sum;
        histogramSummaries[baseName] = {
          count: totalCount,
          avg: totalCount > 0 ? Math.round(totalSum / totalCount) : 0,
        };
      }
    }

    return {
      uptime: Date.now() - this.startTime,
      counters,
      gauges,
      histograms: histogramSummaries,
    };
  }

  /**
   * Reset all metrics
   */
  reset(): void {
    this.metrics.clear();
    this.startTime = Date.now();
    log.info('Metrics reset');
  }
}

/**
 * Singleton metrics collector instance
 */
export const metrics = new MetricsCollector();

/**
 * Pre-defined metric names for consistency
 */
export const MetricNames = {
  // HTTP metrics
  HTTP_REQUESTS_TOTAL: 'http_requests_total',
  HTTP_REQUEST_DURATION_MS: 'http_request_duration_ms',
  HTTP_ERRORS_TOTAL: 'http_errors_total',

  // Job metrics
  JOBS_STARTED_TOTAL: 'jobs_started_total',
  JOBS_COMPLETED_TOTAL: 'jobs_completed_total',
  JOBS_FAILED_TOTAL: 'jobs_failed_total',
  JOBS_DURATION_MS: 'jobs_duration_ms',
  JOBS_ACTIVE: 'jobs_active',

  // API client metrics
  API_REQUESTS_TOTAL: 'api_requests_total',
  API_REQUEST_DURATION_MS: 'api_request_duration_ms',
  API_ERRORS_TOTAL: 'api_errors_total',
  API_RETRIES_TOTAL: 'api_retries_total',

  // Cache metrics
  CACHE_HITS_TOTAL: 'cache_hits_total',
  CACHE_MISSES_TOTAL: 'cache_misses_total',
  CACHE_SIZE: 'cache_size',

  // WebSocket metrics
  WEBSOCKET_CONNECTIONS: 'websocket_connections',
  WEBSOCKET_MESSAGES_SENT: 'websocket_messages_sent',
  WEBSOCKET_MESSAGES_RECEIVED: 'websocket_messages_received',

  // Queue metrics
  QUEUE_LENGTH: 'queue_length',
  QUEUE_WAIT_TIME_MS: 'queue_wait_time_ms',
} as const;
