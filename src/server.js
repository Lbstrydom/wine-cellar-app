/**
 * @fileoverview Express server setup.
 * @module server
 */

// Load environment variables BEFORE any other imports
import 'dotenv/config';

import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import routes from './routes/index.js';
import jobQueue from './services/jobQueue.js';
import handleRatingFetch from './jobs/ratingFetchJob.js';
import handleBatchFetch from './jobs/batchFetchJob.js';
import { purgeExpiredCache } from './services/cacheService.js';
import { generalRateLimiter } from './middleware/rateLimiter.js';
import { cspMiddleware, cspDevMiddleware } from './middleware/csp.js';
import healthRoutes from './routes/health.js';
import { errorHandler, notFoundHandler } from './utils/errorResponse.js';
import { metricsMiddleware, metricsHandler } from './middleware/metrics.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

// Security headers (CSP)
const isDevelopment = process.env.NODE_ENV !== 'production';
app.use(isDevelopment ? cspDevMiddleware() : cspMiddleware());

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' })); // Increased for base64 image uploads

// Metrics collection (before rate limiting)
app.use(metricsMiddleware());

// Apply rate limiting to API routes
app.use('/api', generalRateLimiter());

app.use(express.static(path.join(__dirname, '..', 'public')));

// Health check routes (no rate limiting for load balancer probes)
app.use('/health', healthRoutes);

// Metrics endpoint (Prometheus-compatible)
app.get('/metrics', metricsHandler);

// API routes
app.use('/api', routes);

// 404 handler for undefined routes
app.use('/api/*', notFoundHandler);

// Global error handler (must be last)
app.use(errorHandler);

// Register job handlers
jobQueue.registerHandler('rating_fetch', handleRatingFetch);
jobQueue.registerHandler('batch_fetch', handleBatchFetch);

// Start job queue processor
jobQueue.start();

// Schedule periodic cache cleanup (every 6 hours)
const CACHE_CLEANUP_INTERVAL = 6 * 60 * 60 * 1000;
setInterval(() => {
  console.log('[Cache] Running scheduled cache cleanup...');
  try {
    const result = purgeExpiredCache();
    console.log('[Cache] Cleanup complete:', result);
  } catch (err) {
    console.error('[Cache] Cleanup failed:', err.message);
  }
}, CACHE_CLEANUP_INTERVAL);

// Start server
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Wine cellar app running on http://0.0.0.0:${PORT}`);
  console.log('[Jobs] Job queue started');
});

// Graceful shutdown handling
let isShuttingDown = false;

async function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`\n[Server] ${signal} received, starting graceful shutdown...`);

  // Stop accepting new connections
  server.close(() => {
    console.log('[Server] HTTP server closed');
  });

  try {
    // Stop job queue (let current jobs finish)
    console.log('[Jobs] Stopping job queue...');
    jobQueue.stop();
    console.log('[Jobs] Job queue stopped');

    console.log('[Server] Graceful shutdown complete');
    process.exit(0);
  } catch (err) {
    console.error('[Server] Error during shutdown:', err);
    process.exit(1);
  }
}

// Handle shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
