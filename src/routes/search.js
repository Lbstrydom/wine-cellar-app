/**
 * @fileoverview Search metrics endpoints for Phase 6 wine search integration.
 * @module routes/search
 */

import { Router } from 'express';
import db from '../db/index.js';

const router = Router();

/**
 * Get search metrics summary for this cellar.
 * @route GET /api/search/metrics
 */
router.get('/metrics', async (req, res) => {
  try {
    const summary = await db.prepare(`
      SELECT
        COUNT(*) as total_searches,
        AVG(latency_ms) as avg_latency_ms,
        AVG(total_cost_cents) as avg_cost_cents,
        AVG(match_confidence) as avg_match_confidence
      FROM search_metrics
      WHERE cellar_id = $1
    `).get(req.cellarId);

    res.json({
      data: {
        total_searches: Number(summary?.total_searches || 0),
        avg_latency_ms: summary?.avg_latency_ms ? Math.round(summary.avg_latency_ms) : null,
        avg_cost_cents: summary?.avg_cost_cents ? Number(summary.avg_cost_cents) : 0,
        avg_match_confidence: summary?.avg_match_confidence ? Number(summary.avg_match_confidence) : null
      }
    });
  } catch (error) {
    console.error('Search metrics error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
