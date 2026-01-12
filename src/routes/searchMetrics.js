/**
 * @fileoverview API endpoints for search metrics and analytics.
 * @module routes/searchMetrics
 */

import { Router } from 'express';
import db from '../db/index.js';

const router = Router();

// Global metrics storage - in production, this would be persisted to database
const metricsHistory = [];
const MAX_HISTORY_SIZE = 1000;

/**
 * Store a metrics snapshot in history
 * @param {Object} metrics - Metrics summary object
 */
function storeMetricsSnapshot(metrics) {
  metricsHistory.push({
    timestamp: new Date().toISOString(),
    ...metrics
  });
  
  // Keep history size bounded
  if (metricsHistory.length > MAX_HISTORY_SIZE) {
    metricsHistory.shift();
  }
}

/**
 * GET /api/metrics/search/summary
 * Get the most recent search metrics summary
 */
router.get('/search/summary', async (req, res) => {
  try {
    if (metricsHistory.length === 0) {
      return res.json({
        data: null,
        message: 'No search metrics collected yet'
      });
    }

    const latest = metricsHistory[metricsHistory.length - 1];
    res.json({
      data: latest,
      message: 'Latest search metrics summary'
    });
  } catch (error) {
    console.error('Error fetching search metrics:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/metrics/search/history
 * Get historical metrics (last N entries)
 */
router.get('/search/history', async (req, res) => {
  try {
    const limit = Math.min(Number.parseInt(req.query.limit || '50', 10), 500) || 50;
    const history = metricsHistory.slice(-limit);

    res.json({
      data: history,
      count: history.length,
      totalCollected: metricsHistory.length
    });
  } catch (error) {
    console.error('Error fetching metrics history:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/metrics/search/record
 * Record a new metrics snapshot (called by search operations)
 * 
 * Body: {
 *   summary: { totalDuration, totalCost, costCents },
 *   apiCalls: { serpCalls, unlockerCalls, claudeExtractions },
 *   cache: { hits, misses, hitRate },
 *   byDomain: { domain: { calls, hits, hitRate } },
 *   byLens: { lens: { hits, misses, hitRate, avgTokensPerExtraction } }
 * }
 */
router.post('/search/record', async (req, res) => {
  try {
    const { summary, apiCalls, cache, byDomain: _byDomain, byLens: _byLens } = req.body;

    if (!summary || !apiCalls) {
      return res.status(400).json({ error: 'Missing required metrics fields' });
    }

    // Store in memory history
    storeMetricsSnapshot(req.body);

    // Optionally persist to database if schema exists
    try {
      await db.prepare(`
        INSERT INTO search_metrics_history (
          timestamp, total_duration, total_cost_cents,
          serp_calls, unlocker_calls, claude_extractions,
          cache_hits, cache_misses, metrics_json
        ) VALUES (CURRENT_TIMESTAMP, $1, $2, $3, $4, $5, $6, $7, $8)
      `).run(
        summary.totalDuration,
        summary.costCents || 0,
        apiCalls.serpCalls || 0,
        apiCalls.unlockerCalls || 0,
        apiCalls.claudeExtractions || 0,
        cache.hits || 0,
        cache.misses || 0,
        JSON.stringify(req.body)
      );
    } catch (dbErr) {
      // Database table might not exist yet - that's ok, metrics still stored in memory
      console.debug('Could not persist metrics to DB:', dbErr.message);
    }

    res.json({
      message: 'Metrics recorded successfully',
      data: {
        timestamp: new Date().toISOString(),
        ...req.body
      }
    });
  } catch (error) {
    console.error('Error recording metrics:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/metrics/search/stats
 * Get aggregated statistics across all collected metrics
 */
router.get('/search/stats', async (req, res) => {
  try {
    if (metricsHistory.length === 0) {
      return res.json({
        data: null,
        message: 'No metrics collected yet'
      });
    }

    // Calculate aggregates
    const totalSearches = metricsHistory.length;
    const totalCost = metricsHistory.reduce((sum, m) => sum + (m.summary?.costCents || 0), 0);
    const totalDuration = metricsHistory.reduce((sum, m) => sum + (m.summary?.totalDuration || 0), 0);
    const totalSerpCalls = metricsHistory.reduce((sum, m) => sum + (m.apiCalls?.serpCalls || 0), 0);
    const totalUnlockerCalls = metricsHistory.reduce((sum, m) => sum + (m.apiCalls?.unlockerCalls || 0), 0);
    const totalClaudeCalls = metricsHistory.reduce((sum, m) => sum + (m.apiCalls?.claudeExtractions || 0), 0);
    const totalCacheHits = metricsHistory.reduce((sum, m) => sum + (m.cache?.hits || 0), 0);
    const totalCacheMisses = metricsHistory.reduce((sum, m) => sum + (m.cache?.misses || 0), 0);

    const aggregates = {
      totalSearches,
      totalCostCents: totalCost,
      totalCostFormatted: `$${(totalCost / 100).toFixed(2)}`,
      averageCostPerSearch: (totalCost / totalSearches / 100).toFixed(4),
      averageDurationMs: Math.round(totalDuration / totalSearches),
      totalApiCalls: totalSerpCalls + totalUnlockerCalls + totalClaudeCalls,
      breakdown: {
        serpCalls: totalSerpCalls,
        unlockerCalls: totalUnlockerCalls,
        claudeExtractions: totalClaudeCalls
      },
      cache: {
        totalHits: totalCacheHits,
        totalMisses: totalCacheMisses,
        hitRate: totalCacheHits + totalCacheMisses > 0
          ? (totalCacheHits / (totalCacheHits + totalCacheMisses)).toFixed(3)
          : 'N/A'
      }
    };

    res.json({
      data: aggregates,
      timeRange: {
        first: metricsHistory[0]?.timestamp,
        last: metricsHistory[metricsHistory.length - 1]?.timestamp
      }
    });
  } catch (error) {
    console.error('Error calculating stats:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/metrics/search/clear
 * Clear all metrics history (admin only in production)
 */
router.delete('/search/clear', async (req, res) => {
  try {
    metricsHistory.length = 0;
    res.json({ message: 'Metrics history cleared' });
  } catch (error) {
    console.error('Error clearing metrics:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
