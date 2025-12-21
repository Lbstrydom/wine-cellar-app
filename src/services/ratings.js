/**
 * @fileoverview Rating aggregation and calculation logic.
 * @module services/ratings
 */

import { RATING_SOURCES } from '../config/ratingSources.js';

/**
 * Normalize a raw score to the 0-100 scale.
 * @param {string} source - Source ID
 * @param {string} scoreType - 'medal', 'points', 'stars'
 * @param {string} rawScore - Raw score value
 * @returns {Object} { min, max, mid }
 */
export function normalizeScore(source, scoreType, rawScore) {
  const config = RATING_SOURCES[source];
  if (!config) throw new Error(`Unknown source: ${source}`);

  if (scoreType === 'points') {
    const points = parseFloat(rawScore);
    return { min: points, max: points, mid: points };
  }

  if (scoreType === 'medal') {
    const medalKey = rawScore.toLowerCase().replace(/\s+/g, '_');
    const band = config.medal_bands?.[medalKey];
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

  if (scoreType === 'stars') {
    const stars = parseFloat(rawScore);
    const conversion = config.stars_conversion;

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
 * Get relevance weight for a source given a wine.
 * @param {string} sourceId - Source ID
 * @param {Object} wine - Wine object with country and style
 * @returns {number} Relevance weight (0.0 to 1.0)
 */
export function getRelevance(sourceId, wine) {
  const config = RATING_SOURCES[sourceId];
  if (!config) return 0;

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
    const credibility = source?.credibility || 0.5;
    const effectiveWeight = credibility * relevance;

    // Use override if present, otherwise midpoint
    const score = r.is_user_override && r.override_normalized_mid
      ? r.override_normalized_mid
      : r.normalized_mid;

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
 * Calculate all indices and purchase score for a wine.
 * @param {Array} ratings - All ratings for the wine
 * @param {Object} wine - Wine object
 * @param {number} preferenceSlider - User preference (-100 to +100)
 * @returns {Object} Aggregated rating data
 */
export function calculateWineRatings(ratings, wine, preferenceSlider = 40) {
  // Group by lens
  const byLens = {
    competition: ratings.filter(r => r.source_lens === 'competition'),
    critics: ratings.filter(r => r.source_lens === 'critics'),
    community: ratings.filter(r => r.source_lens === 'community')
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
