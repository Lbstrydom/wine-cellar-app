/**
 * @fileoverview Pairing session persistence and feedback management.
 * Captures every Find Pairing interaction for learning and profile building.
 */

import db from '../db/index.js';

/**
 * Failure reason vocabulary (controlled, not free text)
 */
export const FAILURE_REASONS = [
  'too_tannic',
  'too_acidic', 
  'too_sweet',
  'too_oaky',
  'too_light',
  'too_heavy',
  'clashed_with_spice',
  'clashed_with_sauce',
  'overwhelmed_dish',
  'underwhelmed_dish',
  'wrong_temperature',
  'other'
];

/**
 * Create a new pairing session record.
 * Called automatically when getSommelierRecommendation returns successfully.
 * 
 * @param {Object} params
 * @param {string} params.dish - Original dish description
 * @param {string} params.source - 'all' | 'reduce_now'
 * @param {string} params.colour - 'any' | 'red' | 'white' | 'rose' | 'sparkling'
 * @param {string[]} params.foodSignals - Extracted food signals
 * @param {string} params.dishAnalysis - AI's dish interpretation
 * @param {Object[]} params.recommendations - Ranked recommendations with wine_ids
 * @param {string} [params.userId='default'] - User identifier
 * @returns {Promise<number>} Session ID
 */
export async function createPairingSession({
  dish,
  source,
  colour,
  foodSignals,
  dishAnalysis,
  recommendations,
  userId = 'default'
}) {
  const result = await db.prepare(`
    INSERT INTO pairing_sessions (
      user_id,
      dish_description,
      source_filter,
      colour_filter,
      food_signals,
      dish_analysis,
      recommendations
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING id
  `).get(
    userId,
    dish,
    source,
    colour,
    JSON.stringify(foodSignals),
    dishAnalysis,
    JSON.stringify(recommendations)
  );
  
  return result.id;
}

/**
 * Record which wine the user chose from recommendations.
 * 
 * @param {number} sessionId - Pairing session ID
 * @param {number} wineId - Chosen wine ID
 * @param {number} rank - Which rank was chosen (1, 2, or 3)
 * @returns {Promise<void>}
 */
export async function recordWineChoice(sessionId, wineId, rank) {
  await db.prepare(`
    UPDATE pairing_sessions
    SET chosen_wine_id = $1,
        chosen_rank = $2,
        chosen_at = NOW()
    WHERE id = $3
  `).run(wineId, rank, sessionId);
}

/**
 * Link a pairing session to a consumption event.
 * Called when user logs consumption of a wine that has a recent pairing session.
 * 
 * @param {number} sessionId - Pairing session ID
 * @param {number} consumptionLogId - ID from consumption_log table
 * @returns {Promise<void>}
 */
export async function linkConsumption(sessionId, consumptionLogId) {
  await db.prepare(`
    UPDATE pairing_sessions
    SET consumption_log_id = $1,
        confirmed_consumed = TRUE
    WHERE id = $2
  `).run(consumptionLogId, sessionId);
}

/**
 * Record user feedback on a pairing.
 * 
 * @param {number} sessionId - Pairing session ID
 * @param {Object} feedback
 * @param {number} feedback.pairingFitRating - 1.0-5.0 in 0.5 steps
 * @param {boolean} feedback.wouldPairAgain - Would they pair these again?
 * @param {string[]} [feedback.failureReasons] - If rating <= 2.5, what went wrong
 * @param {string} [feedback.notes] - Optional free text (never injected into prompts)
 * @returns {Promise<void>}
 */
export async function recordFeedback(sessionId, {
  pairingFitRating,
  wouldPairAgain,
  failureReasons = null,
  notes = null
}) {
  // Validate rating
  if (pairingFitRating < 1 || pairingFitRating > 5) {
    throw new Error('Pairing fit rating must be between 1 and 5');
  }
  
  // Validate failure reasons if provided
  if (failureReasons) {
    const invalid = failureReasons.filter(r => !FAILURE_REASONS.includes(r));
    if (invalid.length > 0) {
      throw new Error(`Invalid failure reasons: ${invalid.join(', ')}`);
    }
  }
  
  await db.prepare(`
    UPDATE pairing_sessions
    SET pairing_fit_rating = $1,
        would_pair_again = $2,
        failure_reasons = $3,
        feedback_notes = $4,
        feedback_at = NOW()
    WHERE id = $5
  `).run(
    pairingFitRating,
    wouldPairAgain,
    failureReasons ? JSON.stringify(failureReasons) : null,
    notes,
    sessionId
  );
}

/**
 * Find pairing sessions pending feedback.
 * Used by feedback trigger logic.
 * 
 * @param {string} [userId='default'] - User identifier
 * @param {number} [maxAgeDays=2] - Only return sessions within this many days
 * @returns {Promise<Object[]>} Sessions needing feedback
 */
export async function getPendingFeedbackSessions(userId = 'default', maxAgeDays = 2) {
  // Safe: INTERVAL '${days} days' pattern safe with numeric input
  const intervalDays = `INTERVAL '${maxAgeDays} days'`;

  const results = await db.prepare(`
    SELECT 
      ps.id,
      ps.dish_description,
      ps.chosen_wine_id,
      ps.chosen_at,
      ps.confirmed_consumed,
      w.wine_name,
      w.vintage
    FROM pairing_sessions ps
    LEFT JOIN wines w ON ps.chosen_wine_id = w.id
    WHERE ps.user_id = $1
      AND ps.chosen_wine_id IS NOT NULL
      AND ps.pairing_fit_rating IS NULL
      AND ps.created_at > NOW() - ${intervalDays}
    ORDER BY ps.created_at DESC
  `).all(userId);
  
  return results;
}

/**
 * Find recent pairing session for a specific wine.
 * Used when user logs consumption to auto-link sessions.
 * 
 * @param {number} wineId - Wine ID
 * @param {string} [userId='default'] - User identifier
 * @param {number} [maxAgeHours=48] - Look back this many hours
 * @returns {Promise<Object|null>} Most recent matching session or null
 */
export async function findRecentSessionForWine(wineId, userId = 'default', maxAgeHours = 48) {
  // Safe: INTERVAL '${hours} hours' pattern safe with numeric input
  const intervalHours = `INTERVAL '${maxAgeHours} hours'`;

  const result = await db.prepare(`
    SELECT id, dish_description, created_at
    FROM pairing_sessions
    WHERE user_id = $1
      AND chosen_wine_id = $2
      AND consumption_log_id IS NULL
      AND created_at > NOW() - ${intervalHours}
    ORDER BY created_at DESC
    LIMIT 1
  `).get(userId, wineId);
  
  return result || null;
}

/**
 * Get pairing history for a user.
 * Used for "Past Pairings" review section.
 * 
 * @param {string} [userId='default'] - User identifier
 * @param {Object} [options]
 * @param {number} [options.limit=20] - Max results
 * @param {number} [options.offset=0] - Pagination offset
 * @param {boolean} [options.feedbackOnly=false] - Only sessions with feedback
 * @returns {Promise<Object[]>} Pairing history
 */
export async function getPairingHistory(userId = 'default', { limit = 20, offset = 0, feedbackOnly = false } = {}) {
  // Safe: feedbackFilter is a conditional clause string, all values from whitelist
  const feedbackFilter = feedbackOnly ? 'AND ps.pairing_fit_rating IS NOT NULL' : '';
  
  const results = await db.prepare(`
    SELECT 
      ps.id,
      ps.dish_description,
      ps.food_signals,
      ps.created_at,
      ps.chosen_wine_id,
      ps.chosen_rank,
      ps.confirmed_consumed,
      ps.pairing_fit_rating,
      ps.would_pair_again,
      ps.failure_reasons,
      w.wine_name,
      w.vintage,
      w.colour
    FROM pairing_sessions ps
    LEFT JOIN wines w ON ps.chosen_wine_id = w.id
    WHERE ps.user_id = $1
      ${feedbackFilter}
    ORDER BY ps.created_at DESC
    LIMIT $2 OFFSET $3
  `).all(userId, limit, offset);
  
  return results.map(r => ({
    ...r,
    food_signals: r.food_signals ? JSON.parse(r.food_signals) : [],
    failure_reasons: r.failure_reasons ? JSON.parse(r.failure_reasons) : null
  }));
}

/**
 * Get aggregate statistics for pairing feedback.
 * Used for profile calculation and UI display.
 * 
 * @param {string} [userId='default'] - User identifier
 * @returns {Promise<Object>} Aggregate stats
 */
export async function getPairingStats(userId = 'default') {
  const result = await db.prepare(`
    SELECT 
      COUNT(*) as total_sessions,
      COUNT(chosen_wine_id) as sessions_with_choice,
      COUNT(pairing_fit_rating) as sessions_with_feedback,
      AVG(pairing_fit_rating) as avg_pairing_rating,
      SUM(CASE WHEN would_pair_again THEN 1 ELSE 0 END) as would_pair_again_count,
      SUM(CASE WHEN confirmed_consumed THEN 1 ELSE 0 END) as confirmed_consumed_count
    FROM pairing_sessions
    WHERE user_id = $1
  `).get(userId);
  
  return {
    totalSessions: result.total_sessions,
    sessionsWithChoice: result.sessions_with_choice,
    sessionsWithFeedback: result.sessions_with_feedback,
    avgPairingRating: result.avg_pairing_rating ? parseFloat(result.avg_pairing_rating.toFixed(2)) : null,
    wouldPairAgainRate: result.sessions_with_feedback > 0 
      ? (result.would_pair_again_count / result.sessions_with_feedback * 100).toFixed(1)
      : null,
    consumptionConfirmationRate: result.sessions_with_choice > 0
      ? (result.confirmed_consumed_count / result.sessions_with_choice * 100).toFixed(1)
      : null
  };
}
