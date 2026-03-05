/**
 * @fileoverview Unified wine search fetch route for ratings.
 * Uses unifiedWineSearch (claudeWineSearch.js) for search,
 * then handles route-specific DB persistence with cellar scoping.
 * @module routes/ratingsTier
 */

import { Router } from 'express';
import db from '../db/index.js';
import { SOURCES as RATING_SOURCES, SOURCES as SOURCE_REGISTRY } from '../config/unifiedSources.js';
import { normalizeScore, calculateWineRatings, buildIdentityTokensFromWine, validateRatingsWithIdentity, countSaveableRatings } from '../services/ratings/ratings.js';
import { filterRatingsByVintageSensitivity, getVintageSensitivity } from '../config/vintageSensitivity.js';
import { unifiedWineSearch } from '../services/search/claudeWineSearch.js';
import { saveExtractedWindows } from '../services/ratings/ratingExtraction.js';
import { getWineAwards } from '../services/awards/index.js';
import { persistSearchResults } from '../services/shared/wineUpdateService.js';
import logger from '../utils/logger.js';
import { asyncHandler } from '../utils/errorResponse.js';
import { validateParams } from '../middleware/validate.js';
import { ratingWineIdSchema } from '../schemas/rating.js';

const router = Router();

/**
 * Fetch ratings from web using 3-tier waterfall strategy.
 * Uses transactional replacement - only deletes if we have valid replacements.
 *
 * @route POST /api/wines/:wineId/ratings/fetch
 */
router.post('/:wineId/ratings/fetch', validateParams(ratingWineIdSchema), asyncHandler(async (req, res) => {
  const wineId = req.validated?.params?.wineId ?? parseInt(req.params.wineId, 10);

  const wine = await db.prepare('SELECT * FROM wines WHERE cellar_id = $1 AND id = $2').get(req.cellarId, wineId);
  if (!wine) {
    return res.status(404).json({ error: 'Wine not found' });
  }

  const identityTokens = buildIdentityTokensFromWine(wine);

  // Run unified Claude Web Search (single API call replacing 3-tier waterfall)
  const result = await unifiedWineSearch(wine);
  if (!result) {
    return res.status(503).json({ error: 'Wine search unavailable or returned no results' });
  }
  const usedMethod = result._metadata?.method || 'unified_claude_search';

  // ═══════════════════════════════════════════════════════════════════════════
  // GRAPE PERSISTENCE: Save discovered grape varieties if wine has none
  // ═══════════════════════════════════════════════════════════════════════════
  const discoveredGrapes = result.grape_varieties || [];
  if (discoveredGrapes.length > 0 && (!wine.grapes || wine.grapes.trim() === '')) {
    const grapeString = discoveredGrapes.join(', ');
    await db.prepare("UPDATE wines SET grapes = $1 WHERE id = $2 AND cellar_id = $3 AND (grapes IS NULL OR grapes = '')")
      .run(grapeString, wineId, req.cellarId);
    logger.info('Ratings', `Saved discovered grapes for wine ${wineId}: ${grapeString}`);
  }

  // Get existing ratings count for comparison
  const existingRatings = await db.prepare(
    'SELECT * FROM wine_ratings WHERE wine_id = $1 AND (is_user_override IS NOT TRUE)'
  ).all(wineId);

  const rawRatings = result.ratings || [];

  // Identity validation (defensive) and vintage sensitivity filter
  // searchContext: ratings came from our targeted search for this wine — inject wine identity
  // as baseline validation text so the gate doesn't reject on missing metadata fields
  const searchContext = `${wine.producer_name || ''} ${wine.wine_name} ${wine.vintage || ''}`.trim();
  const { ratings: identityValidRatings, rejected: identityRejected } = validateRatingsWithIdentity(wine, rawRatings, identityTokens, { searchContext });

  const { accepted: newRatings, rejected: vintageRejected } = filterRatingsByVintageSensitivity(wine, identityValidRatings);

  // ONLY delete if we have valid replacements
  // This prevents losing data when search/extraction fails
  if (newRatings.length === 0) {
    const identityRejectedCount = identityRejected?.length ?? (rawRatings.length - identityValidRatings.length);
    const vintageRejectedCount = vintageRejected.length;
    logger.info('Ratings', `No new ratings found via ${usedMethod}, keeping ${existingRatings.length} existing (${identityRejectedCount} identity, ${vintageRejectedCount} vintage)`);

    let message = 'No new ratings found, existing ratings preserved';
    if (vintageRejectedCount > 0) {
      message = `Found ${rawRatings.length} ratings but ${vintageRejectedCount} rejected by vintage filter (${getVintageSensitivity(wine)} sensitivity)`;
    } else if (identityRejectedCount > 0) {
      message = `Found ${rawRatings.length} ratings but all rejected by identity validation`;
    }

    return res.json({
      message,
      ratings_kept: existingRatings.length,
      identity_rejected: identityRejectedCount,
      vintage_rejected: vintageRejectedCount > 0 ? vintageRejectedCount : undefined,
      vintage_sensitivity: vintageRejectedCount > 0 ? getVintageSensitivity(wine) : undefined,
      grapes_discovered: discoveredGrapes.length > 0 ? discoveredGrapes : undefined
    });
  }

  // Deduplicate by source before inserting
  const seenSources = new Set();
  const uniqueRatings = [];

  for (const rating of newRatings) {
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

  // Pre-validate: ensure at least one rating has a known source ID and valid score.
  // Prevents wiping existing ratings when Claude returns display names instead of registry IDs.
  const saveableCount = countSaveableRatings(uniqueRatings);
  if (saveableCount === 0) {
    logger.warn('Ratings', `All ${uniqueRatings.length} ratings have unknown source IDs — keeping existing ratings`);
    return res.json({
      message: `Found ${uniqueRatings.length} ratings but all had unknown source IDs, existing ratings preserved`,
      ratings_kept: existingRatings.length
    });
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

  // ═══════════════════════════════════════════════════════════════════════════
  // DRINKING WINDOW: Persist top-level window from Phase 2 extraction
  // ═══════════════════════════════════════════════════════════════════════════
  if (result.drinking_window) {
    const windowRatings = [{
      source: 'unified_search',
      drinking_window: {
        drink_from_year: result.drinking_window.drink_from,
        drink_by_year: result.drinking_window.drink_by,
        peak_year: result.drinking_window.peak
      }
    }];
    const windowsSaved = await saveExtractedWindows(wineId, windowRatings);
    if (windowsSaved > 0) {
      logger.info('Ratings', `Saved ${windowsSaved} drinking window(s) for wine ${wineId}`);
    }
  }

  // Update aggregates
  const ratings = await db.prepare('SELECT * FROM wine_ratings WHERE wine_id = $1').all(wineId);
  const prefSetting = await db.prepare("SELECT value FROM user_settings WHERE cellar_id = $1 AND key = $2").get(req.cellarId, 'rating_preference');
  const preference = parseInt(prefSetting?.value || '40');

  let localAwards = [];
  try {
    localAwards = await getWineAwards(Number.parseInt(wineId, 10));
  } catch {
    // awardsDb may not exist in all environments — degrade gracefully
  }
  const aggregates = calculateWineRatings(ratings, wine, preference, localAwards);

  const tastingNotes = result._narrative || null;

  // ═══════════════════════════════════════════════════════════════════════════
  // PERSIST: Update wines + food pairings via shared helper
  // Persists aggregates, tasting notes, style_summary, producer_description,
  // extracted_awards, and food pairings in a single consistent operation.
  // ═══════════════════════════════════════════════════════════════════════════
  await persistSearchResults(wineId, req.cellarId, wine, aggregates, {
    narrative: tastingNotes,
    tastingNotesStructured: result.tasting_notes || null,
    styleSummary: result.style_summary || null,
    producerInfo: result.producer_info || null,
    awards: result.awards || [],
    foodPairings: result.food_pairings || []
  });

  res.json({
    message: `Found ${insertedCount} ratings (replaced ${existingRatings.length} existing) via ${usedMethod}`,
    tasting_notes: tastingNotes,
    ...aggregates
  });
}));

export default router;
