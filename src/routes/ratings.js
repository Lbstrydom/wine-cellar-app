/**
 * @fileoverview Wine rating endpoints.
 * @module routes/ratings
 */

import { Router } from 'express';
import db from '../db/index.js';
import { SOURCES as RATING_SOURCES, SOURCES as SOURCE_REGISTRY } from '../config/unifiedSources.js';
import { normalizeScore, calculateWineRatings } from '../services/ratings.js';
import { fetchWineRatings } from '../services/claude.js';
import { filterRatingsByVintageSensitivity, getVintageSensitivity } from '../config/vintageSensitivity.js';
import jobQueue from '../services/jobQueue.js';
import { getCacheStats, purgeExpiredCache } from '../services/cacheService.js';
import logger from '../utils/logger.js';
import { getWineAwards } from '../services/awards.js';

const router = Router();

/**
 * Get all ratings for a wine.
 * @route GET /api/wines/:wineId/ratings
 */
router.get('/:wineId/ratings', async (req, res) => {
  try {
    const { wineId } = req.params;
    const vintage = req.query.vintage;

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
  } catch (error) {
    console.error('Get ratings error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Fetch ratings from web using multi-provider search.
 * Uses transactional replacement - only deletes if we have valid replacements.
 * @route POST /api/wines/:wineId/ratings/fetch
 */
router.post('/:wineId/ratings/fetch', async (req, res) => {
  const { wineId } = req.params;

  const wine = await db.prepare('SELECT * FROM wines WHERE cellar_id = $1 AND id = $2').get(req.cellarId, wineId);
  if (!wine) {
    return res.status(404).json({ error: 'Wine not found' });
  }

  try {
    const result = await fetchWineRatings(wine);

    // Get existing ratings count for comparison
    const existingRatings = await db.prepare(
      'SELECT * FROM wine_ratings WHERE wine_id = $1 AND (is_user_override != 1 OR is_user_override IS NULL)'
    ).all(wineId);

    const rawRatings = result.ratings || [];

    // Filter ratings by vintage sensitivity
    const sensitivity = getVintageSensitivity(wine);
    const newRatings = filterRatingsByVintageSensitivity(wine, rawRatings);

    if (rawRatings.length > newRatings.length) {
      logger.info('Ratings', `Filtered ${rawRatings.length - newRatings.length} ratings due to vintage mismatch (sensitivity: ${sensitivity})`);
    }

    // ONLY delete if we have valid replacements
    // This prevents losing data when search/extraction fails
    if (newRatings.length === 0) {
      logger.info('Ratings', `No new ratings found, keeping ${existingRatings.length} existing`);
      return res.json({
        message: 'No new ratings found, existing ratings preserved',
        search_notes: result.search_notes,
        ratings_kept: existingRatings.length
      });
    }

    // Deduplicate by source before inserting
    const seenSources = new Set();
    const uniqueRatings = [];

    for (const rating of newRatings) {
      const key = `${rating.source}-${rating.competition_year || 'any'}`;
      if (!seenSources.has(key)) {
        seenSources.add(key);
        uniqueRatings.push(rating);
      } else {
        logger.info('Ratings', `Skipping duplicate ${rating.source} rating`);
      }
    }

    // Delete existing auto-fetched ratings (keep user overrides)
    await db.prepare(`
      DELETE FROM wine_ratings
      WHERE wine_id = $1 AND (is_user_override != 1 OR is_user_override IS NULL)
    `).run(wineId);

    logger.info('Ratings', `Cleared ${existingRatings.length} existing auto-ratings for wine ${wineId}`);

    // Insert new ratings
    let insertedCount = 0;
    for (const rating of uniqueRatings) {
      const sourceConfig = RATING_SOURCES[rating.source] || SOURCE_REGISTRY[rating.source];
      if (!sourceConfig) {
        logger.warn('Ratings', `Unknown source: ${rating.source}, skipping`);
        continue;
      }

      // Skip ratings without valid scores (e.g., paywalled content)
      if (!rating.raw_score || rating.raw_score === 'null' || rating.raw_score === '') {
        logger.warn('Ratings', `No score found for ${rating.source}, skipping (likely paywalled)`);
        continue;
      }

      try {
        const normalized = normalizeScore(rating.source, rating.score_type, rating.raw_score);

        // Validate normalized values are actual numbers
        if (isNaN(normalized.min) || isNaN(normalized.max) || isNaN(normalized.mid)) {
          logger.warn('Ratings', `Invalid normalized score for ${rating.source}: ${rating.raw_score}, skipping`);
          continue;
        }

        const numericScore = parseFloat(String(rating.raw_score).replace(/\/\d+$/, '')) || null;

        await db.prepare(`
          INSERT INTO wine_ratings (
            wine_id, vintage, source, source_lens, score_type, raw_score, raw_score_numeric,
            normalized_min, normalized_max, normalized_mid,
            award_name, competition_year, rating_count,
            source_url, evidence_excerpt, matched_wine_label,
            vintage_match, match_confidence, fetched_at, is_user_override
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, CURRENT_TIMESTAMP, 0)
        `).run(
          wineId,
          wine.vintage,
          rating.source,
          rating.lens || sourceConfig.lens,
          rating.score_type,
          rating.raw_score,
          numericScore,
          normalized.min,
          normalized.max,
          normalized.mid,
          rating.award_name || null,
          rating.competition_year || null,
          rating.rating_count || null,
          rating.source_url || null,
          rating.evidence_excerpt || null,
          rating.matched_wine_label || null,
          rating.vintage_match || 'inferred',
          rating.match_confidence || 'medium'
        );
        insertedCount++;
      } catch (err) {
        logger.error('Ratings', `Failed to insert rating from ${rating.source}: ${err.message}`);
      }
    }

    logger.info('Ratings', `Inserted ${insertedCount} ratings for wine ${wineId}`);

    // Update aggregates
    const ratings = await db.prepare('SELECT * FROM wine_ratings WHERE wine_id = $1').all(wineId);
    const prefSetting = await db.prepare("SELECT value FROM user_settings WHERE cellar_id = $1 AND key = $2").get(req.cellarId, 'rating_preference');
    const preference = parseInt(prefSetting?.value || '40');
    const aggregates = calculateWineRatings(ratings, wine, preference);

    const tastingNotes = result.tasting_notes || null;

    await db.prepare(`
      UPDATE wines SET
        competition_index = $1, critics_index = $2, community_index = $3,
        purchase_score = $4, purchase_stars = $5, confidence_level = $6,
        tasting_notes = COALESCE($7, tasting_notes),
        ratings_updated_at = CURRENT_TIMESTAMP
      WHERE cellar_id = $8 AND id = $9
    `).run(
      aggregates.competition_index,
      aggregates.critics_index,
      aggregates.community_index,
      aggregates.purchase_score,
      aggregates.purchase_stars,
      aggregates.confidence_level,
      tastingNotes,
      req.cellarId,
      wineId
    );

    res.json({
      message: `Found ${insertedCount} ratings (replaced ${existingRatings.length} existing)`,
      search_notes: result.search_notes,
      tasting_notes: tastingNotes,
      ...aggregates
    });

  } catch (error) {
    logger.error('Ratings', `Fetch error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Add manual rating.
 * @route POST /api/wines/:wineId/ratings
 */
router.post('/:wineId/ratings', async (req, res) => {
  try {
    const { wineId } = req.params;
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
  } catch (error) {
    console.error('Add rating error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Update/override a rating.
 * @route PUT /api/wines/:wineId/ratings/:ratingId
 */
router.put('/:wineId/ratings/:ratingId', async (req, res) => {
  try {
    const { wineId, ratingId } = req.params;
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
  } catch (error) {
    console.error('Update rating error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Delete a rating.
 * @route DELETE /api/wines/:wineId/ratings/:ratingId
 */
router.delete('/:wineId/ratings/:ratingId', async (req, res) => {
  try {
    const { wineId, ratingId } = req.params;

    const wine = await db.prepare('SELECT id FROM wines WHERE cellar_id = $1 AND id = $2').get(req.cellarId, wineId);
    if (!wine) {
      return res.status(404).json({ error: 'Wine not found' });
    }

    await db.prepare('DELETE FROM wine_ratings WHERE id = $1 AND wine_id = $2').run(ratingId, wineId);

    res.json({ message: 'Rating deleted' });
  } catch (error) {
    console.error('Delete rating error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Cleanup duplicate ratings in database.
 * @route POST /api/ratings/cleanup
 */
router.post('/cleanup', async (req, res) => {
  try {
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
    const duplicates = await db.prepare(`
      SELECT id FROM wine_ratings
      WHERE wine_id IN (${wineIdPlaceholders}) AND id NOT IN (
        SELECT MIN(id) FROM wine_ratings
        WHERE wine_id IN (${wineIdPlaceholders})
        GROUP BY wine_id, source
      )
    `).all(req.cellarId, ...cellarWineIds.map(w => w.id));

    if (duplicates.length > 0) {
      // Use parameterized query to prevent SQL injection
      const ids = duplicates.map(d => d.id);
      const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
      await db.prepare(`DELETE FROM wine_ratings WHERE id IN (${placeholders})`).run(...ids);
      logger.info('Cleanup', `Removed ${duplicates.length} duplicate ratings`);
    }

    res.json({
      message: `Cleaned up ${duplicates.length} duplicate ratings`,
      removed_count: duplicates.length
    });
  } catch (error) {
    console.error('Cleanup error:', error);
    res.status(500).json({ error: error.message });
  }
});

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
router.get('/logs', async (req, res) => {
  const fs = await import('node:fs');
  const logPath = logger.getLogPath();

  try {
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
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// =============================================================================
// ASYNC JOB ENDPOINTS
// =============================================================================

/**
 * Queue async rating fetch (returns job ID immediately).
 * @route POST /api/wines/:wineId/ratings/fetch-async
 */
router.post('/:wineId/ratings/fetch-async', async (req, res) => {
  const { wineId } = req.params;
  const { forceRefresh = false } = req.body;

  const wine = await db.prepare('SELECT * FROM wines WHERE cellar_id = $1 AND id = $2').get(req.cellarId, wineId);
  if (!wine) {
    return res.status(404).json({ error: 'Wine not found' });
  }

  try {
    const jobId = await jobQueue.enqueue('rating_fetch', {
      wineId: parseInt(wineId),
      forceRefresh
    }, { priority: 3 });

    res.status(202).json({
      message: 'Rating fetch queued',
      jobId,
      statusUrl: `/api/jobs/${jobId}/status`
    });
  } catch (error) {
    logger.error('Ratings', `Failed to queue job: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Queue batch rating fetch for multiple wines.
 * @route POST /api/ratings/batch-fetch
 */
router.post('/batch-fetch', async (req, res) => {
  const { wineIds, forceRefresh = false } = req.body;

  if (!wineIds || !Array.isArray(wineIds)) {
    return res.status(400).json({ error: 'wineIds array required' });
  }

  if (wineIds.length === 0) {
    return res.status(400).json({ error: 'wineIds array is empty' });
  }

  if (wineIds.length > 100) {
    return res.status(400).json({ error: 'Maximum 100 wines per batch' });
  }

  // Validate wineIds belong to this cellar
  const numericIds = wineIds.map(id => parseInt(id, 10)).filter(Number.isFinite);
  const placeholders = numericIds.map((_, i) => `$${i + 2}`).join(',');
  const allowed = await db.prepare(
    `SELECT id FROM wines WHERE cellar_id = $1 AND id IN (${placeholders})`
  ).all(req.cellarId, ...numericIds);
  if (allowed.length !== numericIds.length) {
    return res.status(403).json({ error: 'One or more wines are not in this cellar' });
  }

  try {
    const jobId = await jobQueue.enqueue('batch_fetch', {
      wineIds: numericIds,
      options: { forceRefresh }
    }, { priority: 5 });

    res.status(202).json({
      message: `Batch fetch queued for ${wineIds.length} wines`,
      jobId,
      statusUrl: `/api/jobs/${jobId}/status`
    });
  } catch (error) {
    logger.error('Ratings', `Failed to queue batch job: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get job status.
 * @route GET /api/jobs/:jobId/status
 */
router.get('/jobs/:jobId/status', async (req, res) => {
  const { jobId } = req.params;

  try {
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
  } catch (error) {
    logger.error('Jobs', `Failed to get job status: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Cancel a pending job.
 * @route DELETE /api/jobs/:jobId
 */
router.delete('/jobs/:jobId', async (req, res) => {
  const { jobId } = req.params;

  try {
    const cancelled = await jobQueue.cancelJob(jobId);

    if (!cancelled) {
      return res.status(404).json({ error: 'Job not found or already completed' });
    }

    res.json({ message: 'Job cancelled' });
  } catch (error) {
    logger.error('Jobs', `Failed to cancel job: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get job queue statistics (for this cellar).
 * @route GET /api/jobs/stats
 */
router.get('/jobs/stats', async (req, res) => {
  try {
    const stats = await jobQueue.getStats();
    res.json(stats);
  } catch (error) {
    logger.error('Jobs', `Failed to get stats: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// =============================================================================
// CACHE ENDPOINTS
// =============================================================================

/**
 * Get cache statistics (for this cellar).
 * @route GET /api/cache/stats
 */
router.get('/cache/stats', async (req, res) => {
  try {
    const stats = getCacheStats();
    res.json(stats);
  } catch (error) {
    logger.error('Cache', `Failed to get stats: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Purge expired cache entries (for this cellar).
 * @route POST /api/cache/purge
 */
router.post('/cache/purge', async (req, res) => {
  try {
    const result = purgeExpiredCache();
    res.json({
      message: 'Cache purged',
      purged: result
    });
  } catch (error) {
    logger.error('Cache', `Failed to purge cache: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

export default router;
