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
 *   byLens: { lens: { hits, misses, hitRate, avgTokensPerExtraction } },
 *   accuracy: { vintageMismatchCount, wrongWineCount, identityRejectionCount } (optional)
 * }
 */
router.post('/search/record', async (req, res) => {
  try {
    const { summary, apiCalls, cache, byDomain: _byDomain, byLens: _byLens, accuracy } = req.body;

    if (!summary || !apiCalls) {
      return res.status(400).json({ error: 'Missing required metrics fields' });
    }

    // Store in memory history
    storeMetricsSnapshot(req.body);

    // Optionally persist to database if schema exists
    try {
      await db.prepare(`
        INSERT INTO search_metrics (
          cellar_id, fingerprint, pipeline_version, latency_ms, total_cost_cents,
          extraction_method, match_confidence, stop_reason, details,
          vintage_mismatch_count, wrong_wine_count, identity_rejection_count
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      `).run(
        req.cellarId,
        req.body.fingerprint || null,
        req.body.pipeline_version || 1,
        summary.totalDuration || null,
        summary.costCents || 0,
        req.body.extraction_method || null,
        req.body.match_confidence || null,
        req.body.stop_reason || null,
        JSON.stringify(req.body),
        accuracy?.vintageMismatchCount || 0,
        accuracy?.wrongWineCount || 0,
        accuracy?.identityRejectionCount || 0
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

/**
 * GET /api/metrics/search/accuracy
 * Get accuracy metrics aggregated from search_metrics table
 */
router.get('/search/accuracy', async (req, res) => {
  try {
    const stats = await db.prepare(`
      SELECT
        COUNT(*) as total_searches,
        SUM(vintage_mismatch_count) as total_vintage_mismatches,
        SUM(wrong_wine_count) as total_wrong_wines,
        SUM(identity_rejection_count) as total_identity_rejections,
        AVG(CAST(vintage_mismatch_count AS FLOAT) / NULLIF(ratings_found, 0)) as avg_vintage_mismatch_rate,
        SUM(CASE WHEN vintage_mismatch_count > 0 THEN 1 ELSE 0 END) as searches_with_mismatches
      FROM search_metrics
      WHERE cellar_id = $1
    `).get(req.cellarId);

    res.json({
      data: {
        total_searches: Number(stats?.total_searches || 0),
        total_vintage_mismatches: Number(stats?.total_vintage_mismatches || 0),
        total_wrong_wines: Number(stats?.total_wrong_wines || 0),
        total_identity_rejections: Number(stats?.total_identity_rejections || 0),
        avg_vintage_mismatch_rate: stats?.avg_vintage_mismatch_rate 
          ? Number(stats.avg_vintage_mismatch_rate).toFixed(4)
          : '0.0000',
        searches_with_mismatches: Number(stats?.searches_with_mismatches || 0)
      }
    });
  } catch (error) {
    console.error('Error fetching accuracy metrics:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
