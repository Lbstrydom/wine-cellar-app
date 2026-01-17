/**
 * @fileoverview Storage placement service
 * Provides temperature-aware wine placement recommendations based on wine type and storage area.
 * Handles placement logic, temperature compatibility, and drinking window adjustments.
 * @module services/storagePlacement
 */

/**
 * Ideal and acceptable storage for each wine type
 * Used for placement recommendations
 */
const IDEAL_STORAGE = {
  sparkling: {
    ideal: ['cellar', 'wine_fridge'],
    acceptable: ['kitchen_fridge'],
    avoid: ['rack']
  },
  white_drink_soon: {
    ideal: ['wine_fridge'],
    acceptable: ['cellar'],
    avoid: ['rack', 'kitchen_fridge']
  },
  white_age_worthy: {
    ideal: ['cellar'],
    acceptable: ['wine_fridge'],
    avoid: ['rack', 'kitchen_fridge']
  },
  rose: {
    ideal: ['wine_fridge'],
    acceptable: ['cellar'],
    avoid: ['rack', 'kitchen_fridge']
  },
  red_light: {
    ideal: ['cellar'],
    acceptable: ['wine_fridge'],
    avoid: ['kitchen_fridge', 'rack']
  },
  red_full: {
    ideal: ['cellar'],
    acceptable: ['rack'],
    avoid: ['wine_fridge', 'kitchen_fridge']
  }
};

/**
 * Aging adjustment factors by temperature zone
 * Used to adjust drinking windows based on storage location
 */
const STORAGE_ADJUSTMENT_FACTORS = {
  cold: null,           // Kitchen fridge: N/A - excluded from aging (chilling state)
  cool: 1.0,            // Wine fridge (10-14°C): ideal storage, no adjustment
  cellar: 1.0,          // Cellar (12-16°C): ideal storage, no adjustment
  ambient: 0.85         // Rack (18-25°C): 15% faster aging (0.85 multiplier)
};

/**
 * Categorize a wine by type for placement recommendations
 * @param {Object} wine - Wine object with tasting profile info
 * @returns {string} Wine category (sparkling, white_drink_soon, etc.)
 */
export function categorizeWineType(wine) {
  // Check tasting profile for palate characteristics
  const profile = wine.tasting_profile || {};
  const { tannins, acidity, body, maturity, cellarAge } = profile;

  // Sparkling wines
  if (wine.colour?.includes('sparkling')) {
    return 'sparkling';
  }

  // White wines
  if (wine.colour === 'white') {
    // Check if it's meant to age
    const isAgeWorthy =
      (acidity === 'high' && body === 'medium') ||  // Rieslings, older Sauternes
      wine.vintage < new Date().getFullYear() - 5;  // Older whites

    return isAgeWorthy ? 'white_age_worthy' : 'white_drink_soon';
  }

  // Rosé wines
  if (wine.colour === 'rose') {
    return 'rose';
  }

  // Red wines
  if (wine.colour === 'red') {
    // Light reds: low tannins, lower alcohol (Pinot, Beaujolais)
    const isLight =
      tannins === 'low' ||
      (body === 'light' && acidity === 'high');

    return isLight ? 'red_light' : 'red_full';
  }

  // Default to full red for unknown reds
  return 'red_full';
}

/**
 * Determine if a storage area is suitable for a wine type
 * @param {Object} area - Storage area {storage_type, temp_zone}
 * @param {string} wineCategory - Wine category (sparkling, red_full, etc.)
 * @returns {Object} {suitability: 'ideal'|'acceptable'|'avoid', reason: string}
 */
export function evaluatePlacement(area, wineCategory) {
  const preferences = IDEAL_STORAGE[wineCategory];

  if (!preferences) {
    return {
      suitability: 'unknown',
      reason: `Unknown wine category: ${wineCategory}`
    };
  }

  if (preferences.ideal.includes(area.storage_type)) {
    const reasons = {
      'cellar': 'Cellar is ideal for long-term aging',
      'wine_fridge': 'Wine fridge is ideal for optimal temperature control',
      'kitchen_fridge': 'Perfect for chilling before serving'
    };
    return {
      suitability: 'ideal',
      reason: reasons[area.storage_type] || 'Ideal storage for this wine'
    };
  }

  if (preferences.acceptable.includes(area.storage_type)) {
    return {
      suitability: 'acceptable',
      reason: 'Acceptable storage but not ideal'
    };
  }

  if (preferences.avoid.includes(area.storage_type)) {
    const reasons = {
      'kitchen_fridge': 'Too cold for storage - use for chilling only',
      'rack': 'Ambient temperature will accelerate aging',
      'wine_fridge': 'Better suited to cellar storage'
    };
    return {
      suitability: 'avoid',
      reason: reasons[area.storage_type] || 'Not recommended for this wine'
    };
  }

  return {
    suitability: 'unknown',
    reason: 'Unable to determine suitability'
  };
}

/**
 * Get aging adjustment factor for a storage area
 * Used to adjust drinking windows based on storage temperature
 * @param {string} tempZone - Temperature zone (cold, cool, cellar, ambient)
 * @returns {number|null} Adjustment multiplier (1.0 = no change, 0.85 = 15% faster)
 *                        or null if excluded from aging (kitchen fridge)
 */
export function getAgingAdjustmentFactor(tempZone) {
  return STORAGE_ADJUSTMENT_FACTORS[tempZone] ?? 1.0;
}

/**
 * Calculate adjusted drinking window based on storage location
 * @param {Object} wine - Wine with drinking_window_default {start_year, end_year}
 * @param {string} tempZone - Temperature zone of storage area
 * @returns {Object} Adjusted window {start_year, end_year} or null if chilling-only
 */
export function adjustDrinkingWindow(wine, tempZone) {
  // Kitchen fridge is not for storage, no aging happens
  if (tempZone === 'cold') {
    return null;  // Not applicable - chilling state only
  }

  const factor = getAgingAdjustmentFactor(tempZone);
  if (factor === null) {
    return null;
  }

  // If factor is 1.0 (cellar or wine fridge), no adjustment needed
  if (factor === 1.0) {
    return wine.drinking_window_default;
  }

  // For ambient/rack (0.85), reduce the window by 15%
  // Example: 5-year window becomes 4.25 years
  const { start_year, end_year } = wine.drinking_window_default || {};
  if (!start_year || !end_year) {
    return null;
  }

  const currentYear = new Date().getFullYear();
  const yearsUntilStart = start_year - currentYear;
  const yearsUntilEnd = end_year - currentYear;

  return {
    start_year: currentYear + Math.ceil(yearsUntilStart * factor),
    end_year: currentYear + Math.ceil(yearsUntilEnd * factor)
  };
}

/**
 * Check if wine has been chilling too long in kitchen fridge
 * @param {number} chillingDays - Days since wine moved to kitchen fridge
 * @param {Object} settings - User settings with thresholds (optional)
 * @returns {Object} {status: 'ok'|'warn'|'alert', message: string}
 */
export function checkChillingStatus(chillingDays, settings = {}) {
  const warnDays = settings.chilling_warn_days ?? 7;
  const alertDays = settings.chilling_alert_days ?? 14;

  if (chillingDays === null || chillingDays === undefined) {
    return { status: 'ok', message: null };
  }

  if (chillingDays > alertDays) {
    return {
      status: 'alert',
      message: `Wine has been chilling for ${Math.floor(chillingDays)} days - move to proper storage`
    };
  }

  if (chillingDays > warnDays) {
    return {
      status: 'warn',
      message: `Consider moving back to storage (chilling for ${Math.floor(chillingDays)} days)`
    };
  }

  return { status: 'ok', message: null };
}

/**
 * Generate human-readable placement suggestion
 * @param {Object} area - Storage area
 * @param {Object} wine - Wine object
 * @returns {string} HTML-safe placement suggestion
 */
export function generatePlacementSuggestion(area, wine) {
  const category = categorizeWineType(wine);
  const evaluation = evaluatePlacement(area, category);
  const adjustment = adjustDrinkingWindow(wine, area.temp_zone);

  const suitabilityEmoji = {
    ideal: '✓',
    acceptable: '~',
    avoid: '✗',
    unknown: '?'
  };

  let suggestion = `${suitabilityEmoji[evaluation.suitability]} ${evaluation.reason}`;

  if (adjustment) {
    const adjustedUntil = adjustment.end_year;
    suggestion += `. Drink by ${adjustedUntil}`;
  } else if (adjustment === null && area.temp_zone === 'cold') {
    suggestion += '. Chilling only - move to storage after serving.';
  }

  return suggestion;
}

export default {
  categorizeWineType,
  evaluatePlacement,
  getAgingAdjustmentFactor,
  adjustDrinkingWindow,
  checkChillingStatus,
  generatePlacementSuggestion
};
