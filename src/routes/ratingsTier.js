/**
 * @fileoverview 3-Tier Waterfall fetch route for wine ratings.
 * Uses the shared threeTierWaterfall module for tier resolution,
 * then handles route-specific DB persistence with cellar scoping.
 * @module routes/ratingsTier
 */

import { Router } from 'express';
import db from '../db/index.js';
import { SOURCES as RATING_SOURCES, SOURCES as SOURCE_REGISTRY } from '../config/unifiedSources.js';
import { normalizeScore, calculateWineRatings, buildIdentityTokensFromWine, validateRatingsWithIdentity } from '../services/ratings/ratings.js';
import { filterRatingsByVintageSensitivity, getVintageSensitivity } from '../config/vintageSensitivity.js';
import { threeTierWaterfall } from '../services/search/threeTierWaterfall.js';
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

  // Run 3-tier waterfall (shared logic — no DB operations)
  const { result, usedMethod } = await threeTierWaterfall(wine, identityTokens, {
    endpoint: 'sync'
  });

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
  const { ratings: identityValidRatings, rejected: identityRejected } = validateRatingsWithIdentity(wine, rawRatings, identityTokens);

  const sensitivity = getVintageSensitivity(wine);
  const newRatings = filterRatingsByVintageSensitivity(wine, identityValidRatings);

  if (rawRatings.length > newRatings.length) {
    logger.info('Ratings', `Filtered ${rawRatings.length - newRatings.length} ratings due to vintage mismatch (sensitivity: ${sensitivity})`);
  }

  // ONLY delete if we have valid replacements
  // This prevents losing data when search/extraction fails
  if (newRatings.length === 0) {
    const identityRejectedCount = identityRejected?.length ?? (rawRatings.length - identityValidRatings.length);
    logger.info('Ratings', `No new ratings found via ${usedMethod}, keeping ${existingRatings.length} existing (${identityRejectedCount} rejected by identity gate)`);

    const message = identityRejectedCount > 0
      ? `Found ${rawRatings.length} ratings but all rejected by identity validation`
      : 'No new ratings found, existing ratings preserved';

    return res.json({
      message,
      search_notes: result.search_notes,
      ratings_kept: existingRatings.length,
      identity_rejected: identityRejectedCount,
      method: usedMethod,
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
}));

export default router;
