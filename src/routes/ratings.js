/**
 * @fileoverview Wine rating CRUD, async jobs, cache, and diagnostic endpoints.
 * The 3-Tier Waterfall sync fetch lives in ratingsTier.js.
 * @module routes/ratings
 */

import { Router } from 'express';
import db from '../db/index.js';
import { SOURCES as RATING_SOURCES } from '../config/unifiedSources.js';
import { normalizeScore, calculateWineRatings } from '../services/ratings.js';
import jobQueue from '../services/jobQueue.js';
import { getCacheStats, purgeExpiredCache } from '../services/cacheService.js';
import logger from '../utils/logger.js';
import { getWineAwards } from '../services/awards.js';
import { asyncHandler } from '../utils/errorResponse.js';
import { validateBody, validateQuery, validateParams } from '../middleware/validate.js';
import {
  ratingWineIdSchema,
  ratingParamsSchema,
  ratingsQuerySchema,
  addRatingSchema,
  overrideRatingSchema,
  fetchAsyncSchema,
  batchFetchSchema,
  jobIdSchema
} from '../schemas/rating.js';

const router = Router();

/**
 * Get all ratings for a wine.
 * @route GET /api/wines/:wineId/ratings
 */
router.get('/:wineId/ratings', validateParams(ratingWineIdSchema), validateQuery(ratingsQuerySchema), asyncHandler(async (req, res) => {
  const wineId = req.validated?.params?.wineId ?? parseInt(req.params.wineId, 10);
  const vintage = req.validated?.query?.vintage ?? req.query.vintage;

  let query = `SELECT * FROM wine_ratings WHERE wine_id = $1`;
  const params = [wineId];
  let paramIdx = 1;

  if (vintage) {
    paramIdx++;
    query += ` AND (vintage = $${paramIdx} OR vintage IS NULL)`;
    params.push(vintage);
  }

  query += ` ORDER BY source_lens, normalized_mid DESC`;

  const ratings = await db.prepare(query).all(...params);
  const wine = await db.prepare('SELECT * FROM wines WHERE cellar_id = $1 AND id = $2').get(req.cellarId, wineId);

  if (!wine) {
    return res.status(404).json({ error: 'Wine not found' });
  }

  // Get local awards from awards database
  let localAwards = [];
  try {
    localAwards = await getWineAwards(parseInt(wineId, 10));
  } catch (_err) {
    // Awards table may not exist yet
  }

  // Get user preference (scoped to cellar)
  const prefSetting = await db.prepare("SELECT value FROM user_settings WHERE cellar_id = $1 AND key = $2").get(req.cellarId, 'rating_preference');
  const preference = parseInt(prefSetting?.value || '40');

  // Calculate aggregates
  const aggregates = calculateWineRatings(ratings, wine, preference);

  res.json({
    wine_id: wineId,
    wine_name: wine.wine_name,
    vintage: wine.vintage,
    ...aggregates,
    ratings: ratings.map(r => ({
      ...r,
      source_name: RATING_SOURCES[r.source]?.name || r.source,
      source_short: RATING_SOURCES[r.source]?.short_name || r.source
    })),
    local_awards: localAwards.map(a => ({
      id: a.id,
      competition: a.competition_name,
      year: a.competition_year,
      award: a.award,
      category: a.category,
      credibility: a.credibility || 0.85
    }))
  });
}));

/**
 * Add manual rating.
 * @route POST /api/wines/:wineId/ratings
 */
router.post('/:wineId/ratings', validateParams(ratingWineIdSchema), validateBody(addRatingSchema), asyncHandler(async (req, res) => {
  const wineId = req.validated?.params?.wineId ?? parseInt(req.params.wineId, 10);
  const { source, score_type, raw_score, competition_year, award_name, source_url, notes, custom_source_name } = req.body;

  const wine = await db.prepare('SELECT * FROM wines WHERE cellar_id = $1 AND id = $2').get(req.cellarId, wineId);
  if (!wine) {
    return res.status(404).json({ error: 'Wine not found' });
  }

  // Get source config, or use defaults for "other" custom sources
  const sourceConfig = RATING_SOURCES[source];
  let sourceLens = 'critics'; // Default lens for unknown sources
  let normalized;

  if (sourceConfig) {
    sourceLens = sourceConfig.lens;
    normalized = normalizeScore(source, score_type, raw_score);
  } else if (source === 'other') {
    // Handle custom "other" source - use generic normalization
    normalized = normalizeScore('other', score_type, raw_score);
  } else {
    return res.status(400).json({ error: 'Unknown rating source' });
  }

  // Use custom source name if provided, otherwise use source ID
  const sourceToStore = source === 'other' && custom_source_name ? custom_source_name : source;

  const result = await db.prepare(`
    INSERT INTO wine_ratings (
      wine_id, vintage, source, source_lens, score_type, raw_score,
      normalized_min, normalized_max, normalized_mid,
      award_name, competition_year, source_url,
      is_user_override, override_note
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
  `).run(
    wineId, wine.vintage, sourceToStore, sourceLens, score_type, raw_score,
    normalized.min, normalized.max, normalized.mid,
    award_name || null, competition_year || null, source_url || null,
    1, notes || null
  );

  res.json({ id: result.lastInsertRowid, message: 'Rating added' });
}));

/**
 * Update/override a rating.
 * @route PUT /api/wines/:wineId/ratings/:ratingId
 */
router.put('/:wineId/ratings/:ratingId', validateParams(ratingParamsSchema), validateBody(overrideRatingSchema), asyncHandler(async (req, res) => {
  const wineId = req.validated?.params?.wineId ?? parseInt(req.params.wineId, 10);
  const ratingId = req.validated?.params?.ratingId ?? parseInt(req.params.ratingId, 10);
  const { override_normalized_mid, override_note } = req.body;

  const wine = await db.prepare('SELECT id FROM wines WHERE cellar_id = $1 AND id = $2').get(req.cellarId, wineId);
  if (!wine) {
    return res.status(404).json({ error: 'Wine not found' });
  }

  await db.prepare(`
    UPDATE wine_ratings
    SET is_user_override = $1, override_normalized_mid = $2, override_note = $3
    WHERE id = $4 AND wine_id = $5
  `).run(1, override_normalized_mid, override_note || null, ratingId, wineId);

  res.json({ message: 'Rating updated' });
}));

/**
 * Delete a rating.
 * @route DELETE /api/wines/:wineId/ratings/:ratingId
 */
router.delete('/:wineId/ratings/:ratingId', validateParams(ratingParamsSchema), asyncHandler(async (req, res) => {
  const wineId = req.validated?.params?.wineId ?? parseInt(req.params.wineId, 10);
  const ratingId = req.validated?.params?.ratingId ?? parseInt(req.params.ratingId, 10);

  const wine = await db.prepare('SELECT id FROM wines WHERE cellar_id = $1 AND id = $2').get(req.cellarId, wineId);
  if (!wine) {
    return res.status(404).json({ error: 'Wine not found' });
  }

  await db.prepare('DELETE FROM wine_ratings WHERE id = $1 AND wine_id = $2').run(ratingId, wineId);

  res.json({ message: 'Rating deleted' });
}));

/**
 * Cleanup duplicate ratings in database.
 * @route POST /api/ratings/cleanup
 */
router.post('/cleanup', asyncHandler(async (req, res) => {
  // Find and remove duplicate ratings for this cellar only (keep lowest ID for each wine_id + source combo)
  const cellarWineIds = await db.prepare(`
    SELECT id FROM wines WHERE cellar_id = $1
  `).all(req.cellarId);

  if (cellarWineIds.length === 0) {
    return res.json({
      message: 'No duplicates found',
      removed_count: 0
    });
  }

  const wineIdPlaceholders = cellarWineIds.map((_, i) => `$${i + 2}`).join(',');
  // Safe: wineIdPlaceholders are generated indices ($2, $3, ...), data in .all() params
  const duplicatesSql = [
    'SELECT id FROM wine_ratings',
    'WHERE wine_id IN (' + wineIdPlaceholders + ') AND id NOT IN (',
    '  SELECT MIN(id) FROM wine_ratings',
    '  WHERE wine_id IN (' + wineIdPlaceholders + ')',
    '  GROUP BY wine_id, source',
    ')'
  ].join('\n');
  const duplicates = await db.prepare(duplicatesSql).all(req.cellarId, ...cellarWineIds.map(w => w.id));

  if (duplicates.length > 0) {
    // Use parameterized query to prevent SQL injection
    const ids = duplicates.map(d => d.id);
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
    // Safe: placeholders are generated indices ($1, $2, ...), data in .run() params
    await db.prepare('DELETE FROM wine_ratings WHERE id IN (' + placeholders + ')').run(...ids);
    logger.info('Cleanup', `Removed ${duplicates.length} duplicate ratings`);
  }

  res.json({
    message: `Cleaned up ${duplicates.length} duplicate ratings`,
    removed_count: duplicates.length
  });
}));

/**
 * Get available rating sources.
 * @route GET /api/ratings/sources
 */
router.get('/sources', (req, res) => {
  const sources = Object.entries(RATING_SOURCES).map(([id, config]) => ({
    id,
    name: config.name,
    short_name: config.short_name,
    lens: config.lens,
    scope: config.scope,
    score_type: config.score_type
  }));
  res.json(sources);
});

/**
 * Get rating search logs (for this cellar).
 * @route GET /api/ratings/logs
 */
router.get('/logs', asyncHandler(async (req, res) => {
  const fs = await import('node:fs');
  const logPath = logger.getLogPath();

  if (!fs.existsSync(logPath)) {
    return res.json({ logs: [], message: 'No log file yet' });
  }

  const content = fs.readFileSync(logPath, 'utf-8');
  const lines = content.split('\n').filter(l => l.trim());

  // Return last 200 lines
  const recentLines = lines.slice(-200);

  res.json({
    log_path: logPath,
    total_lines: lines.length,
    showing: recentLines.length,
    logs: recentLines
  });
}));

// =============================================================================
// ASYNC JOB ENDPOINTS
// =============================================================================

/**
 * Queue async rating fetch (returns job ID immediately).
 * @route POST /api/wines/:wineId/ratings/fetch-async
 */
router.post('/:wineId/ratings/fetch-async', validateParams(ratingWineIdSchema), validateBody(fetchAsyncSchema), asyncHandler(async (req, res) => {
  const wineId = req.validated?.params?.wineId ?? parseInt(req.params.wineId, 10);
  const { forceRefresh = false } = req.body;

  const wine = await db.prepare('SELECT * FROM wines WHERE cellar_id = $1 AND id = $2').get(req.cellarId, wineId);
  if (!wine) {
    return res.status(404).json({ error: 'Wine not found' });
  }

  const jobId = await jobQueue.enqueue('rating_fetch', {
    wineId: parseInt(wineId),
    forceRefresh
  }, { priority: 3 });

  res.status(202).json({
    message: 'Rating fetch queued',
    jobId,
    statusUrl: `/api/jobs/${jobId}/status`
  });
}));

/**
 * Queue batch rating fetch for multiple wines.
 * @route POST /api/ratings/batch-fetch
 */
router.post('/batch-fetch', validateBody(batchFetchSchema), asyncHandler(async (req, res) => {
  const { wineIds, forceRefresh = false } = req.body;

  // Zod already validates: non-empty array, max 100, positive integers
  const numericIds = wineIds;
  const placeholders = numericIds.map((_, i) => `$${i + 2}`).join(',');
  const validateSql = 'SELECT id FROM wines WHERE cellar_id = $1 AND id IN (' + placeholders + ')';
  const allowed = await db.prepare(validateSql).all(req.cellarId, ...numericIds);
  if (allowed.length !== numericIds.length) {
    return res.status(403).json({ error: 'One or more wines are not in this cellar' });
  }

  const jobId = await jobQueue.enqueue('batch_fetch', {
    wineIds: numericIds,
    options: { forceRefresh }
  }, { priority: 5 });

  res.status(202).json({
    message: `Batch fetch queued for ${wineIds.length} wines`,
    jobId,
    statusUrl: `/api/jobs/${jobId}/status`
  });
}));

/**
 * Get job status.
 * @route GET /api/jobs/:jobId/status
 */
router.get('/jobs/:jobId/status', validateParams(jobIdSchema), asyncHandler(async (req, res) => {
  const { jobId } = req.params;

  const status = await jobQueue.getJobStatus(jobId);

  if (!status) {
    return res.status(404).json({ error: 'Job not found' });
  }

  // Parse result if it's a JSON string
  let result = status.result;
  if (result && typeof result === 'string') {
    try {
      result = JSON.parse(result);
    } catch {
      // Keep as string if not valid JSON
    }
  }

  res.json({
    ...status,
    result
  });
}));

/**
 * Cancel a pending job.
 * @route DELETE /api/jobs/:jobId
 */
router.delete('/jobs/:jobId', validateParams(jobIdSchema), asyncHandler(async (req, res) => {
  const { jobId } = req.params;

  const cancelled = await jobQueue.cancelJob(jobId);

  if (!cancelled) {
    return res.status(404).json({ error: 'Job not found or already completed' });
  }

  res.json({ message: 'Job cancelled' });
}));

/**
 * Get job queue statistics (for this cellar).
 * @route GET /api/jobs/stats
 */
router.get('/jobs/stats', asyncHandler(async (req, res) => {
  const stats = await jobQueue.getStats();
  res.json(stats);
}));

// =============================================================================
// CACHE ENDPOINTS
// =============================================================================

/**
 * Get cache statistics (for this cellar).
 * @route GET /api/cache/stats
 */
router.get('/cache/stats', asyncHandler(async (req, res) => {
  const stats = getCacheStats();
  res.json(stats);
}));

/**
 * Purge expired cache entries (for this cellar).
 * @route POST /api/cache/purge
 */
router.post('/cache/purge', asyncHandler(async (req, res) => {
  const result = purgeExpiredCache();
  res.json({
    message: 'Cache purged',
    purged: result
  });
}));

// =============================================================================
// EXPERIMENTAL: GEMINI HYBRID SEARCH
// =============================================================================

/**
 * Test hybrid search using Gemini + Claude.
 * @route POST /api/wines/:wineId/ratings/hybrid-search
 */
router.post('/:wineId/ratings/hybrid-search', validateParams(ratingWineIdSchema), asyncHandler(async (req, res) => {
  const wineId = req.validated?.params?.wineId ?? parseInt(req.params.wineId, 10);

  // Get wine details
  const wine = await db.prepare(`
    SELECT id, wine_name, vintage, colour, grapes, producer, region, country
    FROM wines WHERE cellar_id = $1 AND id = $2
  `).get(req.cellarId, wineId);

  if (!wine) {
    return res.status(404).json({ error: 'Wine not found' });
  }

  // Import hybrid search
  const { hybridWineSearch, isGeminiSearchAvailable } = await import('../services/geminiSearch.js');

  if (!isGeminiSearchAvailable()) {
    return res.status(503).json({
      error: 'Gemini search not configured',
      message: 'Set GEMINI_API_KEY environment variable to enable hybrid search'
    });
  }

  logger.info('HybridSearch', `Starting hybrid search for wine ${wineId}: ${wine.wine_name}`);

  const results = await hybridWineSearch(wine);

  if (!results) {
    return res.json({
      success: false,
      message: 'No results found',
      wine_name: wine.wine_name,
      vintage: wine.vintage
    });
  }

  // Return results for review before saving
  res.json({
    success: true,
    wine_id: wine.id,
    wine_name: wine.wine_name,
    vintage: wine.vintage,
    results: {
      ratings: results.ratings || [],
      tasting_notes: results.tasting_notes || null,
      drinking_window: results.drinking_window || null,
      food_pairings: results.food_pairings || [],
      style_summary: results.style_summary || null
    },
    metadata: results._metadata,
    sources: results._sources,
    raw_content_preview: (results._raw_content || '').substring(0, 500) + '...'
  });
}));

/**
 * GET /api/ratings/:wineId/identity-diagnostics
 * Get identity validation diagnostics for a wine's ratings
 */
router.get('/:wineId/identity-diagnostics', validateParams(ratingWineIdSchema), asyncHandler(async (req, res) => {
  const wineId = req.validated?.params?.wineId ?? parseInt(req.params.wineId, 10);

  // Verify wine belongs to this cellar
  const wine = await db.prepare('SELECT * FROM wines WHERE id = $1 AND cellar_id = $2')
    .get(wineId, req.cellarId);

  if (!wine) {
    return res.status(404).json({ error: 'Wine not found' });
  }

  const ratings = await db.prepare(`
    SELECT
      source,
      source_lens,
      raw_score,
      normalized_mid,
      vintage_match,
      match_confidence,
      identity_score,
      identity_reason,
      source_url,
      evidence_excerpt,
      matched_wine_label,
      fetched_at
    FROM wine_ratings
    WHERE wine_id = $1 AND cellar_id = $2
    ORDER BY fetched_at DESC
  `).all(wineId, req.cellarId);

  // Calculate summary stats
  const summary = {
    total_ratings: ratings.length,
    exact_vintage_matches: ratings.filter(r => r.vintage_match === 'exact').length,
    inferred_vintage_matches: ratings.filter(r => r.vintage_match === 'inferred').length,
    high_confidence: ratings.filter(r => r.match_confidence === 'high').length,
    medium_confidence: ratings.filter(r => r.match_confidence === 'medium').length,
    low_confidence: ratings.filter(r => r.match_confidence === 'low').length,
    avg_identity_score: ratings.length > 0
      ? (ratings.reduce((sum, r) => sum + (r.identity_score || 0), 0) / ratings.length).toFixed(2)
      : 0
  };

  res.json({
    data: {
      wine: {
        id: wine.id,
        name: wine.wine_name,
        vintage: wine.vintage,
        producer: wine.producer
      },
      summary,
      ratings: ratings.map(r => ({
        source: r.source,
        lens: r.source_lens,
        score: r.raw_score,
        normalized: r.normalized_mid,
        vintage_match: r.vintage_match,
        confidence: r.match_confidence,
        identity_score: r.identity_score,
        identity_reason: r.identity_reason,
        url: r.source_url,
        evidence: r.evidence_excerpt?.substring(0, 150),
        matched_label: r.matched_wine_label,
        fetched_at: r.fetched_at
      }))
    }
  });
}));

export default router;
