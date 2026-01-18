/**
 * @fileoverview Helper utilities for calculating accuracy metrics from rating data.
 * @module services/accuracyMetrics
 */

/**
 * Calculate accuracy metrics from a set of ratings for a search session.
 * @param {Array} ratings - Array of rating objects with identity metadata
 * @param {Array} rejected - Array of rejected ratings from identity gate
 * @returns {{
 *   vintageMismatchCount: number,
 *   wrongWineCount: number,
 *   identityRejectionCount: number,
 *   avgIdentityScore: number|null
 * }}
 */
export function calculateAccuracyMetrics(ratings, rejected = []) {
  const vintageMismatchCount = ratings.filter(
    r => r.vintage_match && r.vintage_match !== 'exact'
  ).length;

  // Wrong wine count would come from user feedback, not directly calculable here
  // This is a placeholder for future integration with user correction tracking
  const wrongWineCount = 0;

  const identityRejectionCount = rejected.length;

  const avgIdentityScore = ratings.length > 0
    ? ratings.reduce((sum, r) => sum + (r.identity_score || 0), 0) / ratings.length
    : null;

  return {
    vintageMismatchCount,
    wrongWineCount,
    identityRejectionCount,
    avgIdentityScore: avgIdentityScore !== null ? Number(avgIdentityScore.toFixed(2)) : null
  };
}

/**
 * Get wrong wine correction count for a cellar from tasting notes.
 * @param {Object} db - Database connection
 * @param {string|number} cellarId - Cellar ID
 * @param {Date} since - Count corrections since this date
 * @returns {Promise<number>} Count of wrong wine corrections
 */
export async function getWrongWineCorrections(db, cellarId, since = null) {
  try {
    const query = since
      ? `SELECT COUNT(*) as count FROM tasting_notes 
         WHERE cellar_id = $1 AND issue_type = 'wrong_wine' AND reported_at >= $2`
      : `SELECT COUNT(*) as count FROM tasting_notes 
         WHERE cellar_id = $1 AND issue_type = 'wrong_wine'`;

    const params = since ? [cellarId, since.toISOString()] : [cellarId];
    const result = await db.prepare(query).get(...params);
    
    return result?.count || 0;
  } catch (err) {
    console.error('Error fetching wrong wine corrections:', err);
    return 0;
  }
}

/**
 * Calculate vintage mismatch rate from search_metrics history.
 * @param {Object} db - Database connection
 * @param {string|number} cellarId - Cellar ID
 * @param {number} daysBack - Number of days to look back (default: 30)
 * @returns {Promise<{rate: number, total_searches: number, total_mismatches: number}>}
 */
export async function getVintageMismatchRate(db, cellarId, daysBack = 30) {
  try {
    const result = await db.prepare(`
      SELECT
        COUNT(*) as total_searches,
        SUM(vintage_mismatch_count) as total_mismatches,
        SUM(ratings_found) as total_ratings
      FROM search_metrics
      WHERE cellar_id = $1
        AND created_at >= datetime('now', '-' || $2 || ' days')
        AND ratings_found > 0
    `).get(cellarId, daysBack);

    const totalRatings = result?.total_ratings || 0;
    const totalMismatches = result?.total_mismatches || 0;
    
    return {
      rate: totalRatings > 0 ? (totalMismatches / totalRatings) : 0,
      total_searches: result?.total_searches || 0,
      total_mismatches: totalMismatches
    };
  } catch (err) {
    console.error('Error calculating vintage mismatch rate:', err);
    return { rate: 0, total_searches: 0, total_mismatches: 0 };
  }
}
