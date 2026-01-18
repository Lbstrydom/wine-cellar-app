/**
 * @fileoverview Rating aggregation and calculation logic.
 * @module services/ratings
 */

import { SOURCES as RATING_SOURCES, SOURCES as SOURCE_REGISTRY, LENS } from '../config/unifiedSources.js';
import db from '../db/index.js';
import logger from '../utils/logger.js';
import { generateIdentityTokens, calculateIdentityScore } from './wineIdentity.js';

/**
 * Sources using 20-point scale that need conversion.
 */
const TWENTY_POINT_SOURCES = ['jancis_robinson', 'rvf', 'bettane_desseauve', 'vinum'];

/**
 * Normalize a raw score to the 0-100 scale.
 * @param {string} source - Source ID
 * @param {string} scoreType - 'medal', 'points', 'stars', 'symbol'
 * @param {string} rawScore - Raw score value
 * @returns {Object} { min, max, mid }
 */
export function normalizeScore(source, scoreType, rawScore) {
  const config = RATING_SOURCES[source];

  // Handle "other" custom sources with generic normalization
  if (!config && source !== 'other') {
    throw new Error(`Unknown source: ${source}`);
  }

  if (scoreType === 'points') {
    // Handle formats like "91/100", "91 points", "91", "17/20"
    let scoreStr = String(rawScore).trim();

    // Check for /20 format first
    const twentyMatch = scoreStr.match(/^(\d+(?:\.\d+)?)\s*\/\s*20$/);
    if (twentyMatch) {
      const points = Number.parseFloat(twentyMatch[1]);
      const normalized = (points / 20) * 100;
      return { min: normalized, max: normalized, mid: normalized };
    }

    scoreStr = scoreStr.replace(/\/\d+$/, '').replace(/\s*points?$/i, '').trim();
    const points = Number.parseFloat(scoreStr);

    if (Number.isNaN(points)) {
      // Fallback for unparseable scores
      return { min: 85, max: 90, mid: 87.5 };
    }

    // Handle 20-point scale sources (Jancis Robinson, RVF, Bettane+Desseauve, Vinum)
    if (TWENTY_POINT_SOURCES.includes(source) && points <= 20) {
      // Convert 20-point scale to 100-point scale
      // 20 = 100, 18 = 90, 16 = 80, etc.
      const normalized = (points / 20) * 100;
      return { min: normalized, max: normalized, mid: normalized };
    }

    return { min: points, max: points, mid: points };
  }

  if (scoreType === 'medal') {
    const medalKey = rawScore.toLowerCase().replaceAll(/\s+/g, '_');
    const band = config?.medal_bands?.[medalKey];
    if (band) {
      return {
        min: band.min,
        max: band.max,
        mid: (band.min + band.max) / 2
      };
    }
    // Unknown medal - conservative estimate
    return { min: 80, max: 85, mid: 82.5 };
  }

  if (scoreType === 'symbol') {
    // Handle Italian symbols (Tre Bicchieri, grappoli) and French symbols (Coup de Coeur)
    const symbolKey = rawScore.toLowerCase().replaceAll(/\s+/g, '_');
    const conversion = config?.symbol_conversion;

    if (conversion) {
      const band = conversion[symbolKey];
      if (band) {
        return { min: band.min, max: band.max, mid: (band.min + band.max) / 2 };
      }
    }

    // Generic symbol normalization based on common patterns
    const symbolStr = rawScore.toLowerCase();
    if (symbolStr.includes('tre bicchieri') || symbolStr.includes('5 grappoli') || symbolStr.includes('coup de coeur')) {
      return { min: 95, max: 100, mid: 97.5 };
    }
    if (symbolStr.includes('due bicchieri rossi') || symbolStr.includes('4 grappoli')) {
      return { min: 90, max: 94, mid: 92 };
    }
    if (symbolStr.includes('due bicchieri') || symbolStr.includes('3 grappoli')) {
      return { min: 85, max: 89, mid: 87 };
    }
    if (symbolStr.includes('un bicchiere') || symbolStr.includes('2 grappoli')) {
      return { min: 78, max: 84, mid: 81 };
    }

    // Fallback for unknown symbols
    return { min: 82, max: 88, mid: 85 };
  }

  if (scoreType === 'stars') {
    const stars = Number.parseFloat(rawScore);
    const conversion = config?.stars_conversion;

    // For "other" sources or sources without conversion, use generic mapping
    if (!conversion) {
      // Generic: 5 stars = 95, 4 stars = 85, 3 stars = 75, etc.
      const normalized = 55 + (stars * 8);
      return { min: normalized, max: normalized, mid: normalized };
    }

    // Find closest star bracket
    const brackets = Object.keys(conversion).map(Number).sort((a, b) => b - a);
    for (const bracket of brackets) {
      if (stars >= bracket) {
        const band = conversion[bracket];
        return { min: band.min, max: band.max, mid: (band.min + band.max) / 2 };
      }
    }
    return { min: 60, max: 70, mid: 65 };
  }

  throw new Error(`Unknown score type: ${scoreType}`);
}

/**
 * Build identity tokens from a wine row.
 * @param {Object} wine - Wine object
 * @returns {Object} Identity tokens
 */
export function buildIdentityTokensFromWine(wine) {
  return generateIdentityTokens({
    producer_name: wine.producer || wine.winery || '',
    winery: wine.producer || wine.winery || '',
    range_name: wine.wine_name || '',
    grape_variety: wine.grapes || '',
    country: wine.country || '',
    region: wine.region || '',
    wine_type: wine.colour || wine.style || 'unknown',
    vintage: wine.vintage
  });
}

function deriveMatchConfidence(rating, identityScore) {
  const lens = rating.source_lens || 'critics';
  const isLowCredLens = lens === LENS.COMMUNITY || lens === LENS.AGGREGATOR;

  if (!rating.source_url && isLowCredLens) return 'low';

  if (identityScore >= 5 && !isLowCredLens) return 'high';

  if (isLowCredLens) {
    return rating.rating_count && rating.rating_count > 50 ? 'medium' : 'low';
  }

  return 'medium';
}

/**
 * Validate ratings against wine identity tokens and annotate confidence.
 * @param {Object} wine - Wine object
 * @param {Array} ratings - Ratings to validate
 * @param {Object} [identityTokens] - Precomputed identity tokens
 * @returns {{ratings: Array, rejected: Array}}
 */
export function validateRatingsWithIdentity(wine, ratings, identityTokens = null) {
  if (!ratings || ratings.length === 0) {
    return { ratings: [], rejected: [] };
  }

  const tokens = identityTokens || buildIdentityTokensFromWine(wine);

  const validated = [];
  const rejected = [];

  for (const rating of ratings) {
    const validationText = [
      rating.matched_wine_label,
      rating.evidence_excerpt,
      rating.source_url,
      rating.search_snippet,
      rating.label_text
    ].filter(Boolean).join(' ');

    const identity = calculateIdentityScore(validationText || rating.source || '', tokens);

    if (!identity.valid) {
      rejected.push({ rating, reason: identity.reason });
      continue;
    }

    const match_confidence = deriveMatchConfidence(rating, identity.score);
    const vintage_match = rating.vintage_match || (identity.matches?.vintageMatch ? 'exact' : 'inferred');

    validated.push({
      ...rating,
      match_confidence,
      vintage_match,
      identity_score: identity.score,
      identity_reason: identity.reason,
      identity_matches: identity.matches
    });
  }

  if (rejected.length > 0) {
    logger.info('Ratings', `Identity gate rejected ${rejected.length} rating(s)`);
  }

  return { ratings: validated, rejected };
}

/**
 * Save ratings to the database.
 * @param {number} wineId - Wine ID
 * @param {string|number} vintage - Wine vintage
 * @param {Array} ratings - Array of rating objects
 * @param {string} [cellarId] - Cellar ID (required for PostgreSQL, auto-looked up if not provided)
 * @returns {Promise<number>} Number of ratings saved
 */
export async function saveRatings(wineId, vintage, ratings, cellarId = null) {
  if (!ratings || ratings.length === 0) return 0;

  // If cellarId not provided, look it up from the wine
  if (!cellarId) {
    const wine = await db.prepare('SELECT cellar_id FROM wines WHERE id = ?').get(wineId);
    cellarId = wine?.cellar_id;
  }

  if (!cellarId) {
    console.error(`[Ratings] Cannot save ratings: no cellar_id for wine ${wineId}`);
    return 0;
  }

  let insertedCount = 0;

  for (const rating of ratings) {
    const sourceConfig = RATING_SOURCES[rating.source] || SOURCE_REGISTRY[rating.source];
    if (!sourceConfig) {
      console.warn(`[Ratings] Unknown source: ${rating.source}, skipping`);
      continue;
    }

    // Skip ratings without valid scores
    if (!rating.raw_score || rating.raw_score === 'null' || rating.raw_score === '') {
      console.warn(`[Ratings] No score found for ${rating.source}, skipping`);
      continue;
    }

    try {
      const normalized = normalizeScore(rating.source, rating.score_type, rating.raw_score);

      // Validate normalized values
      if (isNaN(normalized.min) || isNaN(normalized.max) || isNaN(normalized.mid)) {
        console.warn(`[Ratings] Invalid normalized score for ${rating.source}: ${rating.raw_score}, skipping`);
        continue;
      }

      const numericScore = parseFloat(String(rating.raw_score).replace(/\/\d+$/, '')) || null;

      await db.prepare(`
        INSERT INTO wine_ratings (
          cellar_id, wine_id, vintage, source, source_lens, score_type, raw_score, raw_score_numeric,
          normalized_min, normalized_max, normalized_mid,
          award_name, competition_year, rating_count,
          source_url, evidence_excerpt, matched_wine_label,
          identity_score, identity_reason,
          vintage_match, match_confidence, fetched_at, is_user_override
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, FALSE)
      `).run(
        cellarId,
        wineId,
        vintage,
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
        rating.identity_score ?? null,
        rating.identity_reason || null,
        rating.vintage_match || 'inferred',
        rating.match_confidence || 'medium'
      );
      insertedCount++;
    } catch (err) {
      console.error(`[Ratings] Failed to insert rating from ${rating.source}: ${err.message}`);
    }
  }

  return insertedCount;
}

/**
 * Get relevance weight for a source given a wine.
 * @param {string} sourceId - Source ID
 * @param {Object} wine - Wine object with country and style
 * @returns {number} Relevance weight (0.0 to 1.0)
 */
export function getRelevance(sourceId, wine) {
  const config = RATING_SOURCES[sourceId];

  // For unknown/custom sources (manual entries), give a reasonable default weight
  // This ensures manual ratings are included in aggregations
  if (!config) return 0.7;

  if (config.scope === 'global') return 1.0;

  if (config.scope === 'varietal') {
    const wineStyle = (wine.style || '').toLowerCase();
    const matches = config.applicable_styles?.some(s =>
      wineStyle.includes(s.toLowerCase())
    );
    return matches ? 1.0 : 0.0;
  }

  if (config.home_regions?.includes(wine.country)) {
    return 1.0;
  }

  return 0.1;
}

/**
 * Calculate weighted median (robust to outliers).
 * @param {Array} items - Array of { score, weight }
 * @returns {number} Weighted median score
 */
function weightedMedian(items) {
  items.sort((a, b) => a.score - b.score);

  const totalWeight = items.reduce((sum, i) => sum + i.weight, 0);
  let cumulative = 0;

  for (const item of items) {
    cumulative += item.weight;
    if (cumulative >= totalWeight / 2) {
      return item.score;
    }
  }

  return items[items.length - 1].score;
}

/**
 * Calculate variance of values.
 * @param {Array} values - Array of numbers
 * @returns {number} Variance
 */
function calculateVariance(values) {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
}

/**
 * Calculate confidence level based on rating data.
 * @param {Array} weightedItems - Array of weighted rating items
 * @returns {string} 'high', 'medium', or 'low'
 */
function calculateConfidence(weightedItems) {
  const count = weightedItems.length;
  const scores = weightedItems.map(w => w.score);
  const variance = calculateVariance(scores);
  const hasExactVintage = weightedItems.some(w => w.rating.vintage_match === 'exact');
  const avgMatchConfidence = weightedItems.reduce((sum, w) => {
    const conf = { high: 1, medium: 0.6, low: 0.3 }[w.rating.match_confidence] || 0.5;
    return sum + conf;
  }, 0) / count;

  // High: multiple sources, low variance, exact vintage, high match confidence
  if (count >= 2 && variance < 15 && hasExactVintage && avgMatchConfidence > 0.8) {
    return 'high';
  }

  // Medium: at least one decent source
  if (count >= 1 && avgMatchConfidence > 0.5) {
    return 'medium';
  }

  return 'low';
}

/**
 * Calculate index for a single lens (competition/critics/community).
 * Uses weighted median for robustness.
 * @param {Array} ratings - Ratings for this lens
 * @param {Object} wine - Wine object (for relevance calc)
 * @returns {Object} { index, sourceCount, confidence }
 */
function calculateLensIndex(ratings, wine) {
  if (!ratings || ratings.length === 0) {
    return { index: null, sourceCount: 0, confidence: 'unrated' };
  }

  // Calculate weighted scores
  const weighted = ratings.map(r => {
    const source = RATING_SOURCES[r.source];
    const relevance = getRelevance(r.source, wine);
    // For unknown sources (manual entries), use a reasonable default credibility
    const credibility = source?.credibility || 0.65;
    // Confidence factor influences weight: high=1.0, medium=0.8, low=0.5
    const confFactor = r.match_confidence === 'high' ? 1.0 : r.match_confidence === 'medium' ? 0.8 : 0.5;
    let effectiveWeight = credibility * relevance * confFactor;

    // Use override if present, otherwise midpoint
    let score = r.is_user_override && r.override_normalized_mid
      ? r.override_normalized_mid
      : r.normalized_mid;

    // Aggregator unattributed discount: reduce impact if no original source URL
    const lens = (r.source_lens || '').toLowerCase();
    const isAggregator = lens === 'aggregator';
    const unattributed = isAggregator && (!r.source_url || r.source_url === '');
    if (unattributed) {
      score = Math.round(score * 0.7 * 10) / 10; // 0.7x with rounding
    }

    // Confidence gate: exclude low-confidence community/aggregator from purchase score
    const isCommunity = lens === 'community';
    if ((isCommunity || isAggregator) && r.match_confidence === 'low') {
      effectiveWeight = 0; // does not contribute unless user opts in (future setting)
    }

    return { score, weight: effectiveWeight, rating: r };
  }).filter(w => w.weight > 0);

  if (weighted.length === 0) {
    return { index: null, sourceCount: 0, confidence: 'unrated' };
  }

  // Weighted median (robust to outliers)
  const index = weightedMedian(weighted);

  // Confidence based on coverage, variance, vintage match
  const confidence = calculateConfidence(weighted);

  return {
    index: Math.round(index * 10) / 10,
    sourceCount: weighted.length,
    confidence
  };
}

/**
 * Convert points to stars (0.5 increments).
 * @param {number} points - Score in 0-100 scale
 * @returns {number} Stars (1.0 to 5.0)
 */
export function pointsToStars(points) {
  if (points >= 95) return 5.0;
  if (points >= 92) return 4.5;
  if (points >= 89) return 4.0;
  if (points >= 86) return 3.5;
  if (points >= 82) return 3.0;
  if (points >= 78) return 2.5;
  if (points >= 74) return 2.0;
  if (points >= 70) return 1.5;
  return 1.0;
}

/**
 * Get descriptive label for star rating.
 * @param {number} stars - Star rating
 * @returns {string} Label
 */
export function getStarLabel(stars) {
  if (stars >= 4.5) return 'Exceptional';
  if (stars >= 4.0) return 'Very Good';
  if (stars >= 3.5) return 'Good';
  if (stars >= 3.0) return 'Acceptable';
  if (stars >= 2.5) return 'Below Average';
  if (stars >= 2.0) return 'Poor';
  return 'Not Recommended';
}

/**
 * Calculate final purchase score from lens indices.
 * @param {Object} lensIndices - { competition, critics, community }
 * @param {number} preferenceSlider - -100 to +100 (default +40)
 * @returns {Object} { score, stars, confidence }
 */
function calculatePurchaseScore(lensIndices, preferenceSlider = 40) {
  const pref = preferenceSlider / 100;

  const multipliers = {
    competition: 1 + 0.75 * pref,   // 0.25 to 1.75
    critics: 1.0,                    // neutral
    community: 1 - 0.75 * pref       // 1.75 to 0.25
  };

  let totalWeight = 0;
  let weightedSum = 0;
  const confidences = [];

  for (const [lens, data] of Object.entries(lensIndices)) {
    if (data.index !== null) {
      const weight = multipliers[lens] * data.sourceCount;
      weightedSum += data.index * weight;
      totalWeight += weight;
      confidences.push(data.confidence);
    }
  }

  if (totalWeight === 0) {
    return { score: null, stars: null, confidence: 'unrated' };
  }

  const score = Math.round((weightedSum / totalWeight) * 10) / 10;
  const stars = pointsToStars(score);

  // Overall confidence is the minimum of lens confidences
  const confidenceOrder = ['unrated', 'low', 'medium', 'high'];
  const minConfidence = confidences.reduce((min, c) =>
    confidenceOrder.indexOf(c) < confidenceOrder.indexOf(min) ? c : min
  , 'high');

  return { score, stars, confidence: minConfidence };
}

/**
 * Map source lens to display lens for grouping.
 * panel_guide and critic both map to "critics" for aggregation.
 * @param {string} sourceLens - Source lens value
 * @returns {string} Display lens
 */
function mapToDisplayLens(sourceLens) {
  if (sourceLens === 'panel_guide' || sourceLens === 'critic' || sourceLens === 'critics') {
    return 'critics';
  }
  // Producer website awards (usually competition citations) map to competition lens
  if (sourceLens === 'producer') {
    return 'competition';
  }
  return sourceLens;
}

/**
 * Calculate all indices and purchase score for a wine.
 * @param {Array} ratings - All ratings for the wine
 * @param {Object} wine - Wine object
 * @param {number} preferenceSlider - User preference (-100 to +100)
 * @returns {Object} Aggregated rating data
 */
export function calculateWineRatings(ratings, wine, preferenceSlider = 40) {
  // Group by display lens (maps panel_guide and critic to "critics")
  const byLens = {
    competition: ratings.filter(r => mapToDisplayLens(r.source_lens) === 'competition'),
    critics: ratings.filter(r => mapToDisplayLens(r.source_lens) === 'critics'),
    community: ratings.filter(r => mapToDisplayLens(r.source_lens) === 'community')
  };

  // Calculate lens indices
  const lensIndices = {};
  for (const [lens, lensRatings] of Object.entries(byLens)) {
    lensIndices[lens] = calculateLensIndex(lensRatings, wine);
  }

  // Calculate purchase score
  const purchase = calculatePurchaseScore(lensIndices, preferenceSlider);

  return {
    competition_index: lensIndices.competition.index,
    critics_index: lensIndices.critics.index,
    community_index: lensIndices.community.index,
    purchase_score: purchase.score,
    purchase_stars: purchase.stars,
    confidence_level: purchase.confidence,
    lens_details: lensIndices
  };
}
