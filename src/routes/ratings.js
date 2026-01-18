/**
 * @fileoverview Wine rating endpoints.
 * Implements 3-Tier Waterfall Strategy for sync fetch:
 *   Tier 1: Quick SERP AI (~3-8s) - Extract from AI Overview, Knowledge Graph
 *   Tier 2: Gemini Hybrid (~15-45s) - Gemini grounded search + Claude extraction
 *   Tier 3: Legacy Deep Scraping - Full web scraping with page fetches
 * @module routes/ratings
 */

import { Router } from 'express';
import db from '../db/index.js';
import { SOURCES as RATING_SOURCES, SOURCES as SOURCE_REGISTRY } from '../config/unifiedSources.js';
import { normalizeScore, calculateWineRatings, buildIdentityTokensFromWine, validateRatingsWithIdentity } from '../services/ratings.js';
import { fetchWineRatings } from '../services/claude.js';
import { hybridWineSearch, isGeminiSearchAvailable } from '../services/geminiSearch.js';
import { quickSerpAiExtraction, isSerpAiAvailable } from '../services/serpAi.js';
import { filterRatingsByVintageSensitivity, getVintageSensitivity } from '../config/vintageSensitivity.js';
import { withCircuitBreaker, isCircuitOpen } from '../services/circuitBreaker.js';
import jobQueue from '../services/jobQueue.js';
import { getCacheStats, purgeExpiredCache } from '../services/cacheService.js';
import logger from '../utils/logger.js';
import { getWineAwards } from '../services/awards.js';

// Timeout constants for tier waterfall
const GEMINI_TIMEOUT_MS = 45000; // 45 seconds for Gemini + Claude
const SERP_AI_TIMEOUT_MS = 15000; // 15 seconds for SERP AI extraction

/**
 * Log tier resolution for cost tracking and latency analysis.
 * @param {string} tier - Tier that resolved the request
 * @param {Object} wine - Wine object
 * @param {number} startTime - Start timestamp
 * @param {number} ratingsFound - Number of ratings found
 */
function logTierResolution(tier, wine, startTime, ratingsFound = 0) {
  const latencyMs = Date.now() - startTime;
  logger.info('CostTrack', JSON.stringify({
    wineId: wine.id,
    wineName: wine.wine_name,
    vintage: wine.vintage,
    tier,
    ratingsFound,
    latencyMs,
    timestamp: new Date().toISOString(),
    endpoint: 'sync'
  }));
}

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
 * Fetch ratings from web using 3-tier waterfall strategy.
 * Uses transactional replacement - only deletes if we have valid replacements.
 *
 * 3-Tier Waterfall:
 *   Tier 1: Quick SERP AI (~3-8s) - Extract from AI Overview, Knowledge Graph
 *   Tier 2: Gemini Hybrid (~15-45s) - Gemini grounded search + Claude extraction
 *   Tier 3: Legacy Deep Scraping - Full web scraping with page fetches
 *
 * @route POST /api/wines/:wineId/ratings/fetch
 */
router.post('/:wineId/ratings/fetch', async (req, res) => {
  const { wineId } = req.params;

  const wine = await db.prepare('SELECT * FROM wines WHERE cellar_id = $1 AND id = $2').get(req.cellarId, wineId);
  if (!wine) {
    return res.status(404).json({ error: 'Wine not found' });
  }

  try {
    let result;
    let usedMethod = 'legacy_tier3';
    let serpForReuse = null;
    const startTime = Date.now();
    const identityTokens = buildIdentityTokensFromWine(wine);

    // ═══════════════════════════════════════════════════════════════════════════
    // TIER 1: Quick SERP AI (~3-8s)
    // Extract ratings from AI Overview, Knowledge Graph, Featured Snippets
    // ═══════════════════════════════════════════════════════════════════════════
    if (isSerpAiAvailable() && !isCircuitOpen('serp_ai')) {
      try {
        logger.info('Ratings', `Tier 1: Quick SERP AI for wine ${wineId} (${SERP_AI_TIMEOUT_MS}ms timeout)`);

        const tier1Promise = withCircuitBreaker('serp_ai', () =>
          quickSerpAiExtraction(wine, identityTokens)
        );

        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Tier 1 SERP AI timed out')), SERP_AI_TIMEOUT_MS)
        );

        const tier1 = await Promise.race([tier1Promise, timeoutPromise]);

        // Save rawSerp for Tier 3 reuse
        if (tier1.rawSerp) {
          serpForReuse = tier1.rawSerp;
          logger.info('Ratings', `Tier 1: Captured ${serpForReuse.organic?.length || 0} organic results for Tier 3 reuse`);
        }

        if (tier1.success && tier1.ratings?.length > 0) {
          const { ratings: validatedTier1 } = validateRatingsWithIdentity(wine, tier1.ratings, identityTokens);

          if (validatedTier1.length > 0) {
            result = {
              ratings: validatedTier1,
              tasting_notes: tier1.tasting_notes,
              search_notes: tier1.search_notes
            };
            usedMethod = 'serp_ai_tier1';
            logTierResolution('tier1_serp_ai', wine, startTime, tier1.ratings.length);
            logger.info('Ratings', `Tier 1 SUCCESS: ${tier1.ratings.length} ratings in ${Date.now() - startTime}ms`);
          } else {
            logger.info('Ratings', 'Tier 1: Identity gate rejected all ratings, proceeding to Tier 2');
          }
        } else {
          logger.info('Ratings', 'Tier 1: No ratings found, proceeding to Tier 2');
        }
      } catch (err) {
        logger.warn('Ratings', `Tier 1 failed: ${err.message}`);
      }
    } else if (!isSerpAiAvailable()) {
      logger.info('Ratings', 'Tier 1: SERP AI not available (missing API keys)');
    } else {
      logger.info('Ratings', 'Tier 1: Circuit open, skipping');
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // TIER 2: Gemini Hybrid (~15-45s)
    // Uses Gemini grounded search + Claude extraction for comprehensive coverage
    // ═══════════════════════════════════════════════════════════════════════════
    if (!result && isGeminiSearchAvailable() && !isCircuitOpen('gemini_hybrid')) {
      try {
        logger.info('Ratings', `Tier 2: Gemini Hybrid for wine ${wineId} (${GEMINI_TIMEOUT_MS}ms timeout)`);

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);

        try {
          const hybridResult = await withCircuitBreaker('gemini_hybrid', async () => {
            const res = await hybridWineSearch(wine);
            if (controller.signal.aborted) {
              throw new Error('Gemini search aborted due to timeout');
            }
            return res;
          });

          clearTimeout(timeoutId);

          if (hybridResult?.ratings?.length > 0) {
            const normalizedRatings = hybridResult.ratings.map(r => ({
              source: r.source ? r.source.toLowerCase().replace(/[^a-z0-9]/g, '_') : 'unknown',
              source_lens: r.source_lens || 'critics',
              score_type: r.score_type || 'points',
              raw_score: r.raw_score,
              raw_score_numeric: r.raw_score_numeric,
              vintage_match: r.vintage_match || 'inferred',
              match_confidence: r.confidence || 'medium',
              source_url: r.source_url,
              tasting_notes: r.tasting_notes
            }));

            const { ratings: validatedTier2 } = validateRatingsWithIdentity(wine, normalizedRatings, identityTokens);

            if (validatedTier2.length > 0) {
              result = {
                ratings: validatedTier2,
                tasting_notes: hybridResult.tasting_notes ? JSON.stringify(hybridResult.tasting_notes) : null,
                search_notes: `Found via Gemini Hybrid (${hybridResult._metadata?.sources_count || 0} sources)`
              };
              usedMethod = 'gemini_tier2';
              logTierResolution('tier2_gemini', wine, startTime, hybridResult.ratings.length);
              logger.info('Ratings', `Tier 2 SUCCESS: ${hybridResult.ratings.length} ratings in ${Date.now() - startTime}ms`);
            } else {
              logger.info('Ratings', 'Tier 2: Identity gate rejected all ratings, proceeding to Tier 3');
            }
          } else {
            logger.info('Ratings', 'Tier 2: No ratings found, proceeding to Tier 3');
          }
        } catch (err) {
          clearTimeout(timeoutId);
          throw err;
        }
      } catch (err) {
        logger.warn('Ratings', `Tier 2 failed: ${err.message}`);
      }
    } else if (!result && !isGeminiSearchAvailable()) {
      logger.info('Ratings', 'Tier 2: Gemini not available (missing API key)');
    } else if (!result) {
      logger.info('Ratings', 'Tier 2: Circuit open, skipping');
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // TIER 3: Legacy Deep Scraping
    // Full web scraping with Claude extraction - slower but comprehensive
    // Reuses SERP results from Tier 1 to avoid duplicate API calls
    // ═══════════════════════════════════════════════════════════════════════════
    if (!result) {
      logger.info('Ratings', `Tier 3: Legacy Scraping for wine ${wineId}`);
      const tier3 = await fetchWineRatings(wine, { existingSerpResults: serpForReuse });
      const { ratings: validatedTier3 } = validateRatingsWithIdentity(wine, tier3.ratings || [], identityTokens);

      result = { ...tier3, ratings: validatedTier3 };
      usedMethod = 'legacy_tier3';
      logTierResolution('tier3_legacy', wine, startTime, result.ratings?.length || 0);
      logger.info('Ratings', `Tier 3 COMPLETE: ${result.ratings?.length || 0} ratings in ${Date.now() - startTime}ms`);
    }

    // Get existing ratings count for comparison
    const existingRatings = await db.prepare(
      'SELECT * FROM wine_ratings WHERE wine_id = $1 AND (is_user_override IS NOT TRUE)'
    ).all(wineId);

    const rawRatings = result.ratings || [];

    // Identity validation (defensive) and vintage sensitivity filter
    const { ratings: identityValidRatings } = validateRatingsWithIdentity(wine, rawRatings, identityTokens);

    const sensitivity = getVintageSensitivity(wine);
    const newRatings = filterRatingsByVintageSensitivity(wine, identityValidRatings);

    if (rawRatings.length > newRatings.length) {
      logger.info('Ratings', `Filtered ${rawRatings.length - newRatings.length} ratings due to vintage mismatch (sensitivity: ${sensitivity})`);
    }

    // ONLY delete if we have valid replacements
    // This prevents losing data when search/extraction fails
    if (newRatings.length === 0) {
      logger.info('Ratings', `No new ratings found via ${usedMethod}, keeping ${existingRatings.length} existing`);
      return res.json({
        message: 'No new ratings found, existing ratings preserved',
        search_notes: result.search_notes,
        ratings_kept: existingRatings.length,
        method: usedMethod
      });
    }

    // Deduplicate by source before inserting
    const seenSources = new Set();
    const uniqueRatings = [];

    for (const rating of newRatings) {
      // Create a unique key for deduplication
      const sourceKey = rating.source ? rating.source.toLowerCase() : 'unknown';
      const yearKey = rating.competition_year || rating.vintage_match || 'any';
      const key = `${sourceKey}-${yearKey}`;

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
      WHERE wine_id = $1 AND (is_user_override IS NOT TRUE)
    `).run(wineId);

    logger.info('Ratings', `Cleared ${existingRatings.length} existing auto-ratings for wine ${wineId}`);

    // Insert new ratings
    let insertedCount = 0;
    for (const rating of uniqueRatings) {
      // Normalize source ID
      const sourceId = rating.source ? rating.source.toLowerCase().replace(/[^a-z0-9]/g, '_') : 'unknown';
      const sourceConfig = RATING_SOURCES[sourceId] || SOURCE_REGISTRY[sourceId] || { lens: rating.source_lens || 'critics' };

      // Skip ratings without valid scores (e.g., paywalled content)
      if (!rating.raw_score || rating.raw_score === 'null' || rating.raw_score === '') {
        logger.warn('Ratings', `No score found for ${rating.source}, skipping (likely paywalled)`);
        continue;
      }

      try {
        const normalized = normalizeScore(sourceId, rating.score_type, rating.raw_score);

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
            identity_score, identity_reason,
            vintage_match, match_confidence, fetched_at, is_user_override
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, CURRENT_TIMESTAMP, FALSE)
        `).run(
          wineId,
          wine.vintage,
          sourceId,
          rating.lens || rating.source_lens || sourceConfig.lens,
          rating.score_type || 'points',
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
          rating.identity_score ?? null,
          rating.identity_reason || null,
          rating.vintage_match || 'inferred',
          rating.match_confidence || 'medium'
        );
        insertedCount++;
      } catch (err) {
        logger.error('Ratings', `Failed to insert rating from ${rating.source}: ${err.message}`);
      }
    }

    logger.info('Ratings', `Inserted ${insertedCount} ratings via ${usedMethod}`);

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
      message: `Found ${insertedCount} ratings (replaced ${existingRatings.length} existing) via ${usedMethod}`,
      search_notes: result.search_notes,
      tasting_notes: tastingNotes,
      method: usedMethod,
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
  const validateSql = 'SELECT id FROM wines WHERE cellar_id = $1 AND id IN (' + placeholders + ')';
  const allowed = await db.prepare(validateSql).all(req.cellarId, ...numericIds);
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

// =============================================================================
// EXPERIMENTAL: GEMINI HYBRID SEARCH
// =============================================================================

/**
 * Test hybrid search using Gemini + Claude.
 * @route POST /api/wines/:wineId/ratings/hybrid-search
 */
router.post('/:wineId/ratings/hybrid-search', async (req, res) => {
  try {
    const { wineId } = req.params;

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
  } catch (error) {
    logger.error('HybridSearch', `Failed: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/ratings/:wineId/identity-diagnostics
 * Get identity validation diagnostics for a wine's ratings
 */
router.get('/:wineId/identity-diagnostics', async (req, res) => {
  try {
    const { wineId } = req.params;

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
  } catch (error) {
    console.error('Identity diagnostics error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
