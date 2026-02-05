/**
 * @fileoverview Drinking window analysis and fridge candidate logic.
 * Extracted from cellarAnalysis.js to keep each module under 300 lines.
 * @module services/drinkingStrategy
 */

// ───────────────────────────────────────────────────────────
// Drinking window helpers
// ───────────────────────────────────────────────────────────

/**
 * Get effective drink-by year from either drinking_windows or wines table.
 * @param {Object} wine - Wine object with drink_by_year and/or drink_until
 * @returns {number|null} The effective drink-by year
 */
export function getEffectiveDrinkByYear(wine) {
  // Prefer drink_by_year from drinking_windows table (more accurate)
  if (wine.drink_by_year) return wine.drink_by_year;
  // Fall back to drink_until from wines table
  if (wine.drink_until) return wine.drink_until;
  return null;
}

// ───────────────────────────────────────────────────────────
// Fridge candidates
// ───────────────────────────────────────────────────────────

/**
 * Styles that should be consumed young (within 2 years).
 * @type {string[]}
 */
const YOUNG_STYLES = ['sauvignon', 'pinot grigio', 'muscadet', 'vinho verde'];

/**
 * Check if a wine matches a young-drinking style.
 * @param {Object} wine - Wine object
 * @returns {boolean}
 */
function isYoungStyle(wine) {
  return YOUNG_STYLES.some(s =>
    (wine.style || '').toLowerCase().includes(s) ||
    (wine.wine_name || '').toLowerCase().includes(s)
  );
}

/**
 * Get wines that should be moved to fridge (drink soon).
 * @param {Array} wines - All wines
 * @param {number} [currentYear] - Current year (defaults to now)
 * @returns {Array} Fridge candidates with reason strings
 */
export function getFridgeCandidates(wines, currentYear = new Date().getFullYear()) {
  return wines.filter(wine => {
    // Skip if already in fridge
    const slotId = wine.slot_id || wine.location_code;
    if (slotId && slotId.startsWith('F')) return false;

    // Check drink_by_year (from drinking_windows) or drink_until (from wines)
    const drinkByYear = getEffectiveDrinkByYear(wine);
    if (drinkByYear && drinkByYear <= currentYear) {
      return true;
    }

    // Check vintage age for wines that should be drunk young
    if (wine.vintage) {
      const age = currentYear - wine.vintage;

      // Light whites, rose, simple sparkling - drink within 2-3 years
      if (wine.colour === 'white' || wine.colour === 'rose') {
        if (isYoungStyle(wine) && age >= 2) return true;
      }

      // Sparkling (non-vintage champagne)
      if (wine.colour === 'sparkling' && age >= 3) {
        return true;
      }
    }

    return false;
  }).map(wine => {
    const drinkByYear = getEffectiveDrinkByYear(wine);
    return {
      wineId: wine.id,
      name: wine.wine_name,
      vintage: wine.vintage,
      currentSlot: wine.slot_id || wine.location_code,
      drinkByYear,
      reason: drinkByYear
        ? `Drink by ${drinkByYear} - past optimal window`
        : `${wine.colour} wine from ${wine.vintage} - drink soon`
    };
  });
}
