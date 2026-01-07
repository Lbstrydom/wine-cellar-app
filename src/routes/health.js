/**
 * @fileoverview Health check endpoints for load balancers and monitoring.
 * @module routes/health
 */

import express from 'express';
import db from '../db/index.js';

const router = express.Router();

// Track server start time for uptime calculation
const startTime = Date.now();

/**
 * GET /health
 * Basic health check - returns 200 if server is responding.
 * Used by load balancers for quick health probes.
 */
router.get('/', async (_req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString()
  });
});

/**
 * GET /health/ready
 * Readiness check - verifies database connectivity.
 * Returns 503 if database is unavailable.
 */
router.get('/ready', async (_req, res) => {
  try {
    // Test database connectivity
    await db.prepare('SELECT 1').get();

    res.json({
      status: 'ready',
      timestamp: new Date().toISOString(),
      checks: {
        database: 'connected'
      }
    });
  } catch (err) {
    res.status(503).json({
      status: 'not_ready',
      timestamp: new Date().toISOString(),
      checks: {
        database: 'disconnected'
      },
      error: err.message
    });
  }
});

/**
 * GET /health/live
 * Liveness check - detailed health with metrics.
 * Used for monitoring dashboards.
 */
router.get('/live', async (_req, res) => {
  const uptimeMs = Date.now() - startTime;
  const uptimeSeconds = Math.floor(uptimeMs / 1000);

  let dbStatus;
  let wineCount = 0;
  let slotCount = 0;

  try {
    await db.prepare('SELECT 1').get();
    dbStatus = 'connected';

    // Get basic stats
    const wineResult = await db.prepare('SELECT COUNT(*) as count FROM wines').get();
    const slotResult = await db.prepare('SELECT COUNT(*) as count FROM slots WHERE wine_id IS NOT NULL').get();
    wineCount = wineResult?.count || 0;
    slotCount = slotResult?.count || 0;
  } catch {
    dbStatus = 'error';
  }

  res.json({
    status: dbStatus === 'connected' ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    uptime: {
      seconds: uptimeSeconds,
      formatted: formatUptime(uptimeSeconds)
    },
    version: process.env.npm_package_version || '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    checks: {
      database: dbStatus
    },
    stats: {
      wines: wineCount,
      bottles: slotCount
    },
    memory: {
      heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
      unit: 'MB'
    }
  });
});

/**
 * Format uptime in human-readable format.
 * @param {number} seconds - Uptime in seconds
 * @returns {string} Formatted uptime
 */
function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  parts.push(`${secs}s`);

  return parts.join(' ');
}

export default router;
