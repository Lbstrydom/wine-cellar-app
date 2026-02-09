/**
 * @fileoverview Score normalisation for non-numeric wine scores.
 * Converts medals, symbols, and other formats to 0-100 scale.
 * @module services/ratings/scoreNormalization
 */

/**
 * Score normalisation map for non-numeric scores.
 * Converts medals, symbols, and other formats to 0-100 scale.
 */
const SCORE_NORMALISATION = {
  // Medal awards
  'Grand Gold': 98,
  'Platinum': 98,
  'Trophy': 98,
  'Double Gold': 96,
  'Gold Outstanding': 96,
  'Gold': 94,
  'Silver': 88,
  'Bronze': 82,
  'Commended': 78,

  // Gambero Rosso (Italian)
  'Tre Bicchieri': 95,
  'Due Bicchieri Rossi': 90,
  'Due Bicchieri': 87,
  'Un Bicchiere': 82,

  // Bibenda grappoli (Italian)
  '5 grappoli': 95,
  'cinque grappoli': 95,
  '4 grappoli': 90,
  'quattro grappoli': 90,
  '3 grappoli': 85,
  'tre grappoli': 85,
  '2 grappoli': 80,
  'due grappoli': 80,

  // Hachette (French)
  '★★★': 94,
  '★★': 88,
  '★': 82,
  'Coup de Coeur': 96,
  'Coup de Cœur': 96
};

/**
 * Normalise a raw score to 0-100 scale.
 * @param {string} rawScore - Raw score string
 * @param {string} _scoreType - Type of score ('points', 'stars', 'medal', 'symbol') - reserved for future use
 * @returns {number|null} Normalised score or null if unable to convert
 */
export function normaliseScore(rawScore, _scoreType) {
  if (!rawScore) return null;

  const rawStr = String(rawScore).trim();

  // Direct lookup for symbols/medals
  if (SCORE_NORMALISATION[rawStr]) {
    return SCORE_NORMALISATION[rawStr];
  }

  // Check for partial matches in normalisation map
  for (const [key, value] of Object.entries(SCORE_NORMALISATION)) {
    if (rawStr.toLowerCase().includes(key.toLowerCase())) {
      return value;
    }
  }

  // Handle numeric scores
  const numericMatch = rawStr.match(/(\d+(?:\.\d+)?)/);
  if (numericMatch) {
    const value = parseFloat(numericMatch[1]);

    // Already on 100-point scale (50-100 range is typical for wine)
    if (value >= 50 && value <= 100) {
      return Math.round(value);
    }

    // 20-point scale (French system)
    if (value <= 20) {
      return Math.round((value / 20) * 100);
    }

    // 5-star scale
    if (value <= 5) {
      return Math.round((value / 5) * 100);
    }
  }

  return null; // Unable to normalise
}
