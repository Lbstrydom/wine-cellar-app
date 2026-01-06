/**
 * @fileoverview Pairing scoring logic.
 * @module services/pairing
 */

/**
 * Score wines against food signals.
 * @param {Database} db - Database connection
 * @param {string[]} signals - Food signals
 * @param {boolean} preferReduceNow - Prioritise reduce-now wines
 * @param {number} limit - Max suggestions to return
 * @returns {Object} Pairing suggestions
 */
export function scorePairing(db, signals, preferReduceNow, limit) {
  const placeholders = signals.map(() => '?').join(',');
  // PostgreSQL uses STRING_AGG instead of GROUP_CONCAT
  const aggFunc = process.env.DATABASE_URL ? "STRING_AGG(DISTINCT s.location_code, ',')" : 'GROUP_CONCAT(DISTINCT s.location_code)';

  const styleScores = db.prepare(`
    SELECT
      wine_style_bucket,
      SUM(CASE match_level
        WHEN 'primary' THEN 3
        WHEN 'good' THEN 2
        WHEN 'fallback' THEN 1
        ELSE 0 END) as score
    FROM pairing_rules
    WHERE food_signal IN (${placeholders})
    GROUP BY wine_style_bucket
    ORDER BY score DESC
  `).all(...signals);

  const wines = db.prepare(`
    SELECT
      w.id,
      w.style,
      w.colour,
      w.wine_name,
      w.vintage,
      w.vivino_rating,
      COUNT(s.id) as bottle_count,
      ${aggFunc} as locations,
      MAX(CASE WHEN s.zone = 'fridge' THEN 1 ELSE 0 END) as in_fridge,
      CASE WHEN rn.id IS NOT NULL THEN rn.priority ELSE 99 END as reduce_priority,
      rn.reduce_reason
    FROM wines w
    JOIN slots s ON s.wine_id = w.id
    LEFT JOIN reduce_now rn ON w.id = rn.wine_id
    GROUP BY w.id
    HAVING COUNT(s.id) > 0
    ORDER BY ${preferReduceNow ? 'reduce_priority ASC,' : ''} w.vivino_rating DESC
  `).all();

  // Match wines to scored styles
  const suggestions = [];
  for (const wine of wines) {
    // Skip wines without style - can't match to food pairings
    if (!wine.style) continue;

    const wineStyleLower = wine.style.toLowerCase();
    const styleMatch = styleScores.find(ss => {
      const bucketLower = ss.wine_style_bucket.toLowerCase();
      return wineStyleLower.includes(bucketLower.split('/')[0]) ||
        bucketLower.includes(wineStyleLower.split(' ')[0]);
    });

    if (styleMatch) {
      suggestions.push({
        ...wine,
        style_score: styleMatch.score,
        matched_style_bucket: styleMatch.wine_style_bucket
      });
    }
  }

  // Sort by reduce priority, then style score
  suggestions.sort((a, b) => {
    if (preferReduceNow && a.reduce_priority !== b.reduce_priority) {
      return a.reduce_priority - b.reduce_priority;
    }
    return b.style_score - a.style_score;
  });

  return {
    signals_used: signals,
    style_ranking: styleScores.slice(0, 5),
    suggestions: suggestions.slice(0, limit)
  };
}
