/**
 * @fileoverview Application metrics middleware for monitoring.
 * Provides Prometheus-compatible metrics endpoint.
 * @module middleware/metrics
 */

/**
 * Simple in-memory metrics store.
 * For production, consider using prom-client library.
 */
const metrics = {
  // Request counters by endpoint and status
  http_requests_total: {},
  // Request duration histogram (simplified buckets)
  http_request_duration_ms: {
    sum: 0,
    count: 0,
    buckets: { 50: 0, 100: 0, 250: 0, 500: 0, 1000: 0, 2500: 0, 5000: 0, Infinity: 0 }
  },
  // Database query metrics
  db_queries_total: 0,
  db_query_errors_total: 0,
  // Job queue metrics
  job_queue_depth: 0,
  jobs_processed_total: 0,
  jobs_failed_total: 0,
  // Application metrics
  app_start_time: Date.now(),
  wines_count: 0,
  bottles_count: 0
};

/**
 * Increment request counter.
 * @param {string} method - HTTP method
 * @param {string} path - Request path
 * @param {number} status - Response status code
 */
export function incrementRequest(method, path, status) {
  const key = `${method}:${path}:${status}`;
  metrics.http_requests_total[key] = (metrics.http_requests_total[key] || 0) + 1;
}

/**
 * Record request duration.
 * @param {number} duration - Duration in milliseconds
 */
export function recordDuration(duration) {
  metrics.http_request_duration_ms.sum += duration;
  metrics.http_request_duration_ms.count++;

  // Update histogram buckets
  const buckets = Object.keys(metrics.http_request_duration_ms.buckets)
    .map(Number)
    .sort((a, b) => a - b);

  for (const bucket of buckets) {
    if (duration <= bucket) {
      metrics.http_request_duration_ms.buckets[bucket]++;
    }
  }
}

/**
 * Increment database query counter.
 * @param {boolean} success - Whether query succeeded
 */
export function incrementDbQuery(success = true) {
  metrics.db_queries_total++;
  if (!success) {
    metrics.db_query_errors_total++;
  }
}

/**
 * Update job queue metrics.
 * @param {Object} data - Job queue data
 */
export function updateJobMetrics(data) {
  if (data.depth !== undefined) metrics.job_queue_depth = data.depth;
  if (data.processed) metrics.jobs_processed_total++;
  if (data.failed) metrics.jobs_failed_total++;
}

/**
 * Update application stats.
 * @param {Object} stats - Application statistics
 */
export function updateAppStats(stats) {
  if (stats.wines !== undefined) metrics.wines_count = stats.wines;
  if (stats.bottles !== undefined) metrics.bottles_count = stats.bottles;
}

/**
 * Express middleware to collect request metrics.
 * @returns {Function} Express middleware
 */
export function metricsMiddleware() {
  return (req, res, next) => {
    const start = Date.now();

    res.on('finish', () => {
      const duration = Date.now() - start;

      // Normalize path (replace IDs with :id)
      const normalizedPath = req.path
        .replace(/\/\d+/g, '/:id')
        .replace(/\/[a-f0-9-]{36}/g, '/:uuid');

      incrementRequest(req.method, normalizedPath, res.statusCode);
      recordDuration(duration);
    });

    next();
  };
}

/**
 * Format metrics as Prometheus text format.
 * @returns {string} Prometheus-formatted metrics
 */
export function formatPrometheusMetrics() {
  const lines = [];
  const uptime = Math.floor((Date.now() - metrics.app_start_time) / 1000);

  // Help and type declarations
  lines.push('# HELP http_requests_total Total number of HTTP requests');
  lines.push('# TYPE http_requests_total counter');
  for (const [key, value] of Object.entries(metrics.http_requests_total)) {
    const [method, path, status] = key.split(':');
    lines.push(`http_requests_total{method="${method}",path="${path}",status="${status}"} ${value}`);
  }

  lines.push('# HELP http_request_duration_ms HTTP request duration in milliseconds');
  lines.push('# TYPE http_request_duration_ms histogram');
  lines.push(`http_request_duration_ms_sum ${metrics.http_request_duration_ms.sum}`);
  lines.push(`http_request_duration_ms_count ${metrics.http_request_duration_ms.count}`);

  lines.push('# HELP db_queries_total Total database queries');
  lines.push('# TYPE db_queries_total counter');
  lines.push(`db_queries_total ${metrics.db_queries_total}`);
  lines.push(`db_query_errors_total ${metrics.db_query_errors_total}`);

  lines.push('# HELP job_queue_depth Current job queue depth');
  lines.push('# TYPE job_queue_depth gauge');
  lines.push(`job_queue_depth ${metrics.job_queue_depth}`);
  lines.push(`jobs_processed_total ${metrics.jobs_processed_total}`);
  lines.push(`jobs_failed_total ${metrics.jobs_failed_total}`);

  lines.push('# HELP app_uptime_seconds Application uptime');
  lines.push('# TYPE app_uptime_seconds gauge');
  lines.push(`app_uptime_seconds ${uptime}`);

  lines.push('# HELP wines_count Total wines in database');
  lines.push('# TYPE wines_count gauge');
  lines.push(`wines_count ${metrics.wines_count}`);
  lines.push(`bottles_count ${metrics.bottles_count}`);

  return lines.join('\n');
}

/**
 * Get metrics as JSON.
 * @returns {Object} Metrics object
 */
export function getMetricsJson() {
  const uptime = Math.floor((Date.now() - metrics.app_start_time) / 1000);

  return {
    uptime_seconds: uptime,
    requests: {
      total: Object.values(metrics.http_requests_total).reduce((a, b) => a + b, 0),
      by_endpoint: metrics.http_requests_total
    },
    duration: {
      avg_ms: metrics.http_request_duration_ms.count > 0
        ? Math.round(metrics.http_request_duration_ms.sum / metrics.http_request_duration_ms.count)
        : 0,
      buckets: metrics.http_request_duration_ms.buckets
    },
    database: {
      queries_total: metrics.db_queries_total,
      errors_total: metrics.db_query_errors_total
    },
    jobs: {
      queue_depth: metrics.job_queue_depth,
      processed: metrics.jobs_processed_total,
      failed: metrics.jobs_failed_total
    },
    app: {
      wines: metrics.wines_count,
      bottles: metrics.bottles_count
    }
  };
}

/**
 * Express route handler for metrics endpoint.
 * @param {Request} req - Express request
 * @param {Response} res - Express response
 */
export function metricsHandler(req, res) {
  const format = req.query.format || 'prometheus';

  if (format === 'json') {
    res.json(getMetricsJson());
  } else {
    res.set('Content-Type', 'text/plain; version=0.0.4');
    res.send(formatPrometheusMetrics());
  }
}

export default {
  metricsMiddleware,
  metricsHandler,
  incrementRequest,
  recordDuration,
  incrementDbQuery,
  updateJobMetrics,
  updateAppStats,
  getMetricsJson,
  formatPrometheusMetrics
};
