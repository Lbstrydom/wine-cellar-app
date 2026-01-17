/**
 * @fileoverview Pairing scoring logic.
 * @module services/pairing
 */

import { stringAgg } from '../db/helpers.js';

/**
 * Score wines against food signals.
 * @param {Database} db - Database connection
 * @param {string[]} signals - Food signals
 * @param {boolean} preferReduceNow - Prioritise reduce-now wines
 * @param {number} limit - Max suggestions to return
 * @returns {Promise<Object>} Pairing suggestions
 */
export async function scorePairing(db, signals, preferReduceNow, limit) {
  const placeholders = signals.map(() => '?').join(',');

  const styleScoresSql = [
    'SELECT',
    '  wine_style_bucket,',
    '  SUM(CASE match_level',
    "    WHEN 'primary' THEN 3",
    "    WHEN 'good' THEN 2",
    "    WHEN 'fallback' THEN 1",
    '    ELSE 0 END) as score',
    'FROM pairing_rules',
    'WHERE food_signal IN (' + placeholders + ')',
    'GROUP BY wine_style_bucket',
    'ORDER BY score DESC'
  ].join('\n');
  const styleScores = await db.prepare(styleScoresSql).all(...signals);
  // Safe: placeholders generated from signals array length, data passed to .all()

  const locationAgg = stringAgg('s.location_code', ',', true);
  const orderByClause = preferReduceNow ? 'reduce_priority ASC,' : '';

  const winesSql = [
    'SELECT',
    '  w.id,',
    '  w.style,',
    '  w.colour,',
    '  w.wine_name,',
    '  w.vintage,',
    '  w.vivino_rating,',
    '  COUNT(s.id) as bottle_count,',
    '  ' + locationAgg + ' as locations,',
    "  MAX(CASE WHEN s.zone = 'fridge' THEN 1 ELSE 0 END) as in_fridge,",
    '  COALESCE(MIN(rn.priority), 99) as reduce_priority,',
    '  MAX(rn.reduce_reason) as reduce_reason',
    'FROM wines w',
    'JOIN slots s ON s.wine_id = w.id',
    'LEFT JOIN reduce_now rn ON w.id = rn.wine_id',
    'GROUP BY w.id, w.style, w.colour, w.wine_name, w.vintage, w.vivino_rating',
    'HAVING COUNT(s.id) > 0',
    'ORDER BY ' + orderByClause + ' w.vivino_rating DESC'
  ].join('\n');
  const wines = await db.prepare(winesSql).all();

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
