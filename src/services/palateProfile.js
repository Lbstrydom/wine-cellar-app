/**
 * @fileoverview Palate profile service for tracking and learning user preferences.
 * @module services/palateProfile
 */

import db from '../db/index.js';
import logger from '../utils/logger.js';

/**
 * Record consumption feedback for a wine.
 * @param {Object} feedback - Feedback data
 * @param {number} feedback.wineId - Wine ID
 * @param {number} [feedback.consumptionId] - Consumption log ID
 * @param {boolean} [feedback.wouldBuyAgain] - Would buy again?
 * @param {number} [feedback.personalRating] - 1-5 star rating
 * @param {string[]} [feedback.pairedWith] - Food tags
 * @param {string} [feedback.occasion] - Occasion type
 * @param {string} [feedback.notes] - Free-text notes
 * @returns {Promise<Object>} Created feedback record
 */
export async function recordFeedback(feedback) {
  const {
    wineId,
    consumptionId,
    wouldBuyAgain,
    personalRating,
    pairedWith,
    occasion,
    notes
  } = feedback;

  const result = await db.prepare(`
    INSERT INTO consumption_feedback (
      wine_id, consumption_id, would_buy_again, personal_rating,
      paired_with, occasion, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    wineId,
    consumptionId || null,
    wouldBuyAgain === true ? 1 : wouldBuyAgain === false ? 0 : null,
    personalRating || null,
    pairedWith ? JSON.stringify(pairedWith) : null,
    occasion || null,
    notes || null
  );

  // Update palate profile asynchronously
  updatePalateProfile(wineId, feedback).catch(err => {
    logger.error('PalateProfile', `Failed to update profile: ${err.message}`);
  });

  return {
    id: result.lastInsertRowid,
    wineId,
    message: 'Feedback recorded'
  };
}

/**
 * Get feedback for a wine.
 * @param {number} wineId - Wine ID
 * @returns {Promise<Array>} Feedback records
 */
export async function getWineFeedback(wineId) {
  const feedbacks = await db.prepare(`
    SELECT * FROM consumption_feedback
    WHERE wine_id = ?
    ORDER BY created_at DESC
  `).all(wineId);

  return feedbacks.map(f => ({
    ...f,
    pairedWith: f.paired_with ? JSON.parse(f.paired_with) : [],
    wouldBuyAgain: f.would_buy_again === 1 ? true : f.would_buy_again === 0 ? false : null,
    personalRating: f.personal_rating
  }));
}

/**
 * Update palate profile based on new feedback.
 * @param {number} wineId - Wine ID
 * @param {Object} feedback - Feedback data
 */
async function updatePalateProfile(wineId, feedback) {
  // Get wine details
  const wine = await db.prepare('SELECT * FROM wines WHERE id = ?').get(wineId);
  if (!wine) return;

  const updates = [];

  // Score delta based on feedback
  const rating = feedback.personalRating || 3;
  const scoreDelta = (rating - 3) * 0.5; // -1 to +1 range
  const buyAgainBonus = feedback.wouldBuyAgain === true ? 0.5 : feedback.wouldBuyAgain === false ? -0.5 : 0;
  const totalDelta = scoreDelta + buyAgainBonus;

  // Extract preference keys from wine
  if (wine.style) {
    // Extract grape varieties from style
    const grapes = extractGrapes(wine.style);
    grapes.forEach(grape => {
      updates.push({
        key: `grape:${grape.toLowerCase()}`,
        category: 'grape',
        value: grape.toLowerCase(),
        scoreDelta: totalDelta,
        rating
      });
    });
  }

  if (wine.country) {
    updates.push({
      key: `country:${wine.country.toLowerCase()}`,
      category: 'country',
      value: wine.country.toLowerCase(),
      scoreDelta: totalDelta,
      rating
    });
  }

  if (wine.colour) {
    updates.push({
      key: `colour:${wine.colour.toLowerCase()}`,
      category: 'colour',
      value: wine.colour.toLowerCase(),
      scoreDelta: totalDelta,
      rating
    });
  }

  // Style keywords (oaked, tannic, etc.)
  const styleKeywords = extractStyleKeywords(wine.style || '', wine.winemaking || '');
  styleKeywords.forEach(kw => {
    updates.push({
      key: `style:${kw}`,
      category: 'style',
      value: kw,
      scoreDelta: totalDelta,
      rating
    });
  });

  // Price range
  if (wine.price_eur) {
    const priceRange = getPriceRange(wine.price_eur);
    updates.push({
      key: `price_range:${priceRange}`,
      category: 'price_range',
      value: priceRange,
      scoreDelta: totalDelta,
      rating
    });
  }

  // Food pairings
  if (feedback.pairedWith && feedback.pairedWith.length > 0) {
    feedback.pairedWith.forEach(food => {
      updates.push({
        key: `pairing:${food.toLowerCase()}`,
        category: 'pairing',
        value: food.toLowerCase(),
        scoreDelta: totalDelta,
        rating
      });
    });
  }

  // Apply updates to palate_profile
  for (const update of updates) {
    await upsertPreference(update);
  }
}

/**
 * Upsert a preference in the palate profile.
 * @param {Object} update - Update data
 */
async function upsertPreference(update) {
  const existing = await db.prepare(
    'SELECT * FROM palate_profile WHERE preference_key = ?'
  ).get(update.key);

  if (existing) {
    // Update existing preference with weighted average
    const newSampleCount = existing.sample_count + 1;
    const newScore = Math.max(-5, Math.min(5,
      (existing.score * existing.sample_count + update.scoreDelta) / newSampleCount * newSampleCount / existing.sample_count
    ));
    const newAvgRating = existing.avg_rating
      ? (existing.avg_rating * existing.sample_count + update.rating) / newSampleCount
      : update.rating;
    const newConfidence = Math.min(1, newSampleCount / 10); // Full confidence at 10 samples

    await db.prepare(`
      UPDATE palate_profile SET
        score = ?,
        confidence = ?,
        sample_count = ?,
        avg_rating = ?,
        last_updated = CURRENT_TIMESTAMP
      WHERE preference_key = ?
    `).run(newScore, newConfidence, newSampleCount, newAvgRating, update.key);
  } else {
    // Insert new preference
    await db.prepare(`
      INSERT INTO palate_profile (
        preference_key, preference_category, preference_value,
        score, confidence, sample_count, avg_rating
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      update.key,
      update.category,
      update.value,
      update.scoreDelta,
      0.1, // Low initial confidence
      1,
      update.rating
    );
  }
}

/**
 * Get the full palate profile.
 * @returns {Promise<Object>} Profile data
 */
export async function getPalateProfile() {
  const preferences = await db.prepare(`
    SELECT pp.*, pw.weight
    FROM palate_profile pp
    LEFT JOIN preference_weights pw ON pp.preference_category = pw.preference_type
    ORDER BY pp.preference_category, ABS(pp.score) DESC
  `).all();

  // Group by category
  const profile = {
    likes: [],
    dislikes: [],
    byCategory: {}
  };

  for (const pref of preferences) {
    const item = {
      key: pref.preference_key,
      value: pref.preference_value,
      score: pref.score,
      confidence: pref.confidence,
      sampleCount: pref.sample_count,
      avgRating: pref.avg_rating,
      weightedScore: pref.score * (pref.weight || 1)
    };

    // Add to likes/dislikes
    if (pref.confidence >= 0.3) {
      if (pref.score > 0.5) {
        profile.likes.push(item);
      } else if (pref.score < -0.5) {
        profile.dislikes.push(item);
      }
    }

    // Group by category
    if (!profile.byCategory[pref.preference_category]) {
      profile.byCategory[pref.preference_category] = [];
    }
    profile.byCategory[pref.preference_category].push(item);
  }

  // Sort likes/dislikes by weighted score
  profile.likes.sort((a, b) => b.weightedScore - a.weightedScore);
  profile.dislikes.sort((a, b) => a.weightedScore - b.weightedScore);

  return profile;
}

/**
 * Get personalized wine score based on palate profile.
 * @param {Object} wine - Wine object
 * @returns {Promise<Object>} Score and explanation
 */
export async function getPersonalizedScore(wine) {
  const profile = await getPalateProfile();
  let totalScore = 0;
  let totalWeight = 0;
  const factors = [];

  // Check grape match
  if (wine.style) {
    const grapes = extractGrapes(wine.style);
    for (const grape of grapes) {
      const pref = profile.byCategory.grape?.find(p => p.value === grape.toLowerCase());
      if (pref && pref.confidence >= 0.3) {
        totalScore += pref.weightedScore;
        totalWeight += Math.abs(pref.weightedScore);
        factors.push({
          type: 'grape',
          value: grape,
          impact: pref.score > 0 ? 'positive' : 'negative',
          score: pref.score
        });
      }
    }
  }

  // Check country match
  if (wine.country) {
    const pref = profile.byCategory.country?.find(p => p.value === wine.country.toLowerCase());
    if (pref && pref.confidence >= 0.3) {
      totalScore += pref.weightedScore;
      totalWeight += Math.abs(pref.weightedScore);
      factors.push({
        type: 'country',
        value: wine.country,
        impact: pref.score > 0 ? 'positive' : 'negative',
        score: pref.score
      });
    }
  }

  // Check colour match
  if (wine.colour) {
    const pref = profile.byCategory.colour?.find(p => p.value === wine.colour.toLowerCase());
    if (pref && pref.confidence >= 0.3) {
      totalScore += pref.weightedScore;
      totalWeight += Math.abs(pref.weightedScore);
      factors.push({
        type: 'colour',
        value: wine.colour,
        impact: pref.score > 0 ? 'positive' : 'negative',
        score: pref.score
      });
    }
  }

  // Normalize to -1 to +1 range
  const normalizedScore = totalWeight > 0 ? totalScore / totalWeight : 0;

  return {
    personalScore: normalizedScore,
    confidence: Math.min(1, factors.length / 3),
    factors,
    recommendation: normalizedScore > 0.3 ? 'likely_enjoy' :
                    normalizedScore < -0.3 ? 'may_not_enjoy' : 'neutral'
  };
}

/**
 * Get wine recommendations based on palate profile.
 * @param {number} limit - Max recommendations
 * @returns {Promise<Array>} Recommended wines
 */
export async function getPersonalizedRecommendations(limit = 10) {
  // Get wines in cellar
  const wines = await db.prepare(`
    SELECT w.*, COUNT(s.id) as bottle_count
    FROM wines w
    JOIN slots s ON s.wine_id = w.id
    GROUP BY w.id
    HAVING bottle_count > 0
  `).all();

  // Score each wine
  const scoredWines = [];
  for (const wine of wines) {
    const scoring = await getPersonalizedScore(wine);
    scoredWines.push({
      ...wine,
      personalScore: scoring.personalScore,
      scoreConfidence: scoring.confidence,
      factors: scoring.factors,
      recommendation: scoring.recommendation
    });
  }

  // Sort by personal score
  scoredWines.sort((a, b) => b.personalScore - a.personalScore);

  return scoredWines.slice(0, limit);
}

/**
 * Extract grape varieties from style string.
 * @param {string} style - Wine style
 * @returns {string[]} Grape varieties
 */
function extractGrapes(style) {
  const grapes = [];
  const common = [
    'cabernet sauvignon', 'merlot', 'pinot noir', 'syrah', 'shiraz',
    'grenache', 'tempranillo', 'sangiovese', 'nebbiolo', 'malbec',
    'chardonnay', 'sauvignon blanc', 'riesling', 'pinot grigio',
    'gewurztraminer', 'chenin blanc', 'viognier', 'semillon',
    'gamay', 'zinfandel', 'mourvedre', 'barbera', 'pinotage'
  ];

  const styleLower = style.toLowerCase();
  for (const grape of common) {
    if (styleLower.includes(grape)) {
      grapes.push(grape);
    }
  }

  // If no common grapes found, use the full style as-is
  if (grapes.length === 0 && style.length > 0 && style.length < 30) {
    grapes.push(style.toLowerCase());
  }

  return grapes;
}

/**
 * Extract style keywords (oaked, tannic, etc.).
 * @param {string} style - Wine style
 * @param {string} winemaking - Winemaking notes
 * @returns {string[]} Style keywords
 */
function extractStyleKeywords(style, winemaking) {
  const keywords = [];
  const text = `${style} ${winemaking}`.toLowerCase();

  const patterns = [
    'oaked', 'unoaked', 'barrel', 'tank',
    'tannic', 'soft', 'smooth',
    'dry', 'sweet', 'off-dry', 'semi-sweet',
    'light', 'medium', 'full', 'bold',
    'crisp', 'buttery', 'fruity', 'mineral'
  ];

  for (const pattern of patterns) {
    if (text.includes(pattern)) {
      keywords.push(pattern);
    }
  }

  return keywords;
}

/**
 * Get price range category.
 * @param {number} price - Price in EUR
 * @returns {string} Price range category
 */
function getPriceRange(price) {
  if (price < 10) return 'budget';
  if (price < 20) return 'everyday';
  if (price < 40) return 'premium';
  if (price < 80) return 'fine';
  return 'luxury';
}

/**
 * Get available food tags for pairing feedback.
 * @returns {string[]} Food tags
 */
export function getFoodTags() {
  return [
    // Proteins
    'beef', 'lamb', 'pork', 'chicken', 'duck', 'fish', 'shellfish', 'vegetarian',
    // Preparations
    'grilled', 'roasted', 'braised', 'fried', 'raw',
    // Cuisines
    'italian', 'french', 'asian', 'indian', 'mexican', 'mediterranean',
    // Occasions
    'cheese', 'charcuterie', 'pizza', 'pasta', 'salad', 'soup', 'dessert'
  ];
}

/**
 * Get occasion types.
 * @returns {string[]} Occasion types
 */
export function getOccasionTypes() {
  return [
    'weeknight',
    'dinner_party',
    'special_occasion',
    'celebration',
    'casual',
    'romantic',
    'solo'
  ];
}
