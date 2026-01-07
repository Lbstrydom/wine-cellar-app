/**
 * Default Drinking Window Service
 *
 * Provides fallback drinking window estimates based on grape variety, region,
 * style, and quality tier when no critic or user-defined window exists.
 */

import db from '../db/index.js';
import { parseWineName } from './wineNameParser.js';

/**
 * Get estimated drinking window from defaults matrix
 * @param {object} wine - Wine object with grape, region, country, colour, style, price
 * @param {number} vintage - Vintage year
 * @returns {object|null} - { drink_from, drink_by, peak, confidence, source, notes }
 */
export function getDefaultDrinkingWindow(wine, vintage) {
  if (!vintage) return null;

  // Start with wine's structured fields
  const { grape: wineGrape, region: wineRegion, country, colour, style: wineStyle } = wine;
  let grape = wineGrape;
  let region = wineRegion;
  let style = wineStyle;

  // Also check wine_name field (used in wines table)
  const wineName = wine.name || wine.wine_name;

  // If missing, try to parse from wine name
  if (!grape || !region || !style) {
    const parsed = parseWineName(wineName);
    grape = grape || parsed.grape;
    region = region || parsed.region;
    style = style || parsed.style;
  }

  const qualityTier = estimateQualityTier(wine);

  // Normalise inputs for matching
  const normGrape = normaliseGrape(grape);
  const normRegion = normaliseRegion(region);
  const normStyle = normaliseStyle(style);
  const normColour = normaliseColour(colour);

  try {
    // Query with fallback matching - most specific first (lowest priority number)
    const defaultWindow = db.prepare(`
      SELECT
        drink_from_offset,
        drink_by_offset,
        peak_offset,
        confidence,
        notes
      FROM drinking_window_defaults
      WHERE
        (grape = ? OR grape IS NULL)
        AND (region = ? OR region IS NULL)
        AND (style = ? OR style IS NULL)
        AND (colour = ? OR colour IS NULL)
        AND (quality_tier = ? OR quality_tier IS NULL)
        AND (country = ? OR country IS NULL)
      ORDER BY priority ASC
      LIMIT 1
    `).get(normGrape, normRegion, normStyle, normColour, qualityTier, country);

    if (!defaultWindow) {
      // Ultimate fallback based on colour only
      return getFallbackByColour(colour, vintage);
    }

    return {
      drink_from: vintage + defaultWindow.drink_from_offset,
      drink_by: vintage + defaultWindow.drink_by_offset,
      peak: defaultWindow.peak_offset ? vintage + defaultWindow.peak_offset : null,
      confidence: defaultWindow.confidence,
      source: 'default_matrix',
      notes: defaultWindow.notes
    };
  } catch (error) {
    console.error('Error looking up default drinking window:', error);
    return getFallbackByColour(colour, vintage);
  }
}

/**
 * Estimate quality tier from price and other signals
 * @param {object} wine - Wine object
 * @returns {string|null} - 'icon', 'premium', 'mid', 'entry', or null
 */
export function estimateQualityTier(wine) {
  const price = wine.price || wine.purchase_price;

  if (!price) return null;

  // EUR thresholds
  if (price >= 100) return 'icon';
  if (price >= 30) return 'premium';
  if (price >= 12) return 'mid';
  return 'entry';
}

/**
 * Normalise grape name for matching
 * @param {string} grape - Grape variety name
 * @returns {string|null} - Normalised grape name
 */
export function normaliseGrape(grape) {
  if (!grape) return null;

  const grapeMap = {
    // Aliases
    'shiraz': 'shiraz',  // Keep separate from syrah for regional matching
    'syrah': 'syrah',
    'pinot noir': 'pinot_noir',
    'pinot nero': 'pinot_noir',
    'cabernet sauvignon': 'cabernet_sauvignon',
    'cab sauv': 'cabernet_sauvignon',
    'sauv blanc': 'sauvignon_blanc',
    'sauvignon blanc': 'sauvignon_blanc',
    'pinot grigio': 'pinot_grigio',
    'pinot gris': 'pinot_gris',
    'gruner veltliner': 'gruner_veltliner',
    'gewurztraminer': 'gewurztraminer',
    'nero d\'avola': 'nero_davola',
    'nero davola': 'nero_davola',
    'touriga nacional': 'touriga_nacional',
    'chenin blanc': 'chenin_blanc',
    'albarino': 'albarino'
  };

  const lower = grape.toLowerCase().trim();
  return grapeMap[lower] || lower.replace(/\s+/g, '_');
}

/**
 * Normalise region for matching
 * @param {string} region - Region name
 * @returns {string|null} - Normalised region name
 */
export function normaliseRegion(region) {
  if (!region) return null;

  const regionMap = {
    // Italian
    'barolo': 'barolo',
    'barbaresco': 'barbaresco',
    'brunello di montalcino': 'brunello',
    'chianti classico': 'chianti_classico',
    'chianti': 'chianti',
    'romagna': 'romagna',
    'valpolicella': 'valpolicella',
    'amarone': 'amarone',
    'alto adige': 'alto_adige',
    'friuli': 'friuli',

    // French
    'bordeaux': 'bordeaux',
    'burgundy': 'burgundy',
    'bourgogne': 'burgundy',
    'chablis': 'chablis',
    'champagne': 'champagne',
    'rhone': 'rhone',
    'northern rhone': 'rhone',
    'southern rhone': 'rhone',
    'hermitage': 'hermitage',
    'cote rotie': 'cote_rotie',
    'chateauneuf du pape': 'chateauneuf',
    'alsace': 'alsace',
    'loire': 'loire',
    'sancerre': 'sancerre',
    'vouvray': 'vouvray',
    'provence': 'provence',
    'sauternes': 'sauternes',
    'pomerol': 'pomerol',
    'saint emilion': 'saint_emilion',

    // Spanish
    'rioja': 'rioja',
    'ribera del duero': 'ribera_del_duero',
    'priorat': 'priorat',
    'carinena': 'carinena',
    'rias baixas': 'rias_baixas',
    'rueda': 'rueda',
    'toro': 'toro',
    'navarra': 'navarra',

    // Portuguese
    'douro': 'douro',
    'dao': 'dao',
    'port': 'port',
    'porto': 'port',
    'madeira': 'madeira',

    // German/Austrian
    'mosel': 'mosel',
    'rheingau': 'rheingau',
    'wachau': 'wachau',

    // Australian
    'barossa': 'barossa',
    'barossa valley': 'barossa',
    'mclaren vale': 'mclaren_vale',
    'hunter valley': 'hunter_valley',
    'clare valley': 'clare_valley',
    'eden valley': 'eden_valley',
    'margaret river': 'margaret_river',
    'coonawarra': 'coonawarra',

    // New Zealand
    'marlborough': 'marlborough',
    'central otago': 'central_otago',

    // South African
    'stellenbosch': 'stellenbosch',
    'constantia': 'constantia',
    'swartland': 'swartland',

    // American
    'napa': 'napa',
    'napa valley': 'napa',
    'sonoma': 'sonoma',
    'oregon': 'oregon',
    'willamette': 'oregon',

    // Argentine
    'mendoza': 'mendoza',
    'uco valley': 'uco_valley',

    // Chilean
    'chile': 'chile',
    'maipo': 'chile',
    'colchagua': 'chile'
  };

  const lower = region.toLowerCase().trim();
  return regionMap[lower] || lower.replace(/\s+/g, '_');
}

/**
 * Normalise style keywords
 * @param {string} style - Wine style
 * @returns {string|null} - Normalised style
 */
export function normaliseStyle(style) {
  if (!style) return null;

  const styleMap = {
    'riserva': 'riserva',
    'reserva': 'reserva',
    'gran reserva': 'gran_reserva',
    'gran riserva': 'gran_reserva',
    'crianza': 'crianza',
    'joven': 'joven',
    'ripasso': 'ripasso',
    'superiore': 'superiore',
    'appassimento': 'appassimento',
    'passito': 'appassimento',
    'vintage': 'vintage',
    'non vintage': 'nv',
    'nv': 'nv',
    'brut': 'brut',
    'grand cru': 'grand_cru',
    'premier cru': 'premier_cru',
    '1er cru': 'premier_cru',
    'smaragd': 'smaragd',
    'federspiel': 'federspiel',
    'steinfeder': 'steinfeder',
    'kabinett': 'kabinett',
    'spatlese': 'spatlese',
    'auslese': 'auslese',
    'trockenbeerenauslese': 'trockenbeerenauslese',
    'tba': 'trockenbeerenauslese',
    'eiswein': 'eiswein',
    'ice wine': 'icewine',
    'late harvest': 'late_harvest',
    'vendange tardive': 'vendange_tardive',
    'moelleux': 'moelleux',
    'sec': 'sec',
    'unoaked': 'unoaked',
    'oaked': 'oaked',
    'gran selezione': 'gran_selezione'
  };

  const lower = style.toLowerCase().trim();
  return styleMap[lower] || lower.replace(/\s+/g, '_');
}

/**
 * Normalise colour
 * @param {string} colour - Wine colour
 * @returns {string|null} - Normalised colour
 */
export function normaliseColour(colour) {
  if (!colour) return null;

  const colourMap = {
    'red': 'red',
    'white': 'white',
    'rose': 'rose',
    'rosado': 'rose',
    'sparkling': 'sparkling',
    'champagne': 'sparkling',
    'dessert': 'dessert',
    'sweet': 'dessert',
    'fortified': 'dessert'
  };

  return colourMap[colour.toLowerCase().trim()] || colour.toLowerCase();
}

/**
 * Storage temperature adjustment factors.
 * Based on simplified Q10 approximation - warmer storage = faster ageing.
 * Values represent percentage reduction of drinking window.
 */
const STORAGE_ADJUSTMENT_FACTORS = {
  'cool': 0,        // 10-15°C - ideal cellar, no adjustment
  'moderate': 0.10, // 15-20°C - typical home, 10% reduction
  'warm': 0.20,     // 20-24°C - warm room, 20% reduction
  'hot': 0.30       // 24°C+ - garage/hot climate, 30% reduction
};

/**
 * Adjust a drinking window based on storage conditions.
 * This is a global adjustment applied to all windows when storage settings are configured.
 *
 * @param {object} window - Drinking window { drink_from, drink_by, peak, ... }
 * @param {number} vintage - Vintage year
 * @param {object} storageSettings - User's storage settings from user_settings
 * @returns {object} - Adjusted window with storage_adjusted flag
 */
export function adjustForStorage(window, vintage, storageSettings) {
  // If no window or adjustment disabled, return as-is
  if (!window || !storageSettings) return window;
  if (storageSettings.storage_adjustment_enabled !== 'true') return window;

  // Get adjustment factor based on temperature bucket
  const tempBucket = storageSettings.storage_temp_bucket || 'cool';
  const factor = STORAGE_ADJUSTMENT_FACTORS[tempBucket] || 0;

  // If no adjustment needed, return original
  if (factor === 0 && storageSettings.storage_heat_risk !== 'true') {
    return window;
  }

  // Calculate the window span and reduction
  const drinkFrom = window.drink_from || vintage;
  const drinkBy = window.drink_by || (vintage + 10);
  const windowSpan = drinkBy - drinkFrom;
  const reduction = Math.round(windowSpan * factor);

  // Build adjusted window
  const adjusted = {
    ...window,
    drink_by: drinkBy - reduction,
    storage_adjusted: factor > 0,
    storage_adjustment_years: reduction,
    storage_temp_bucket: tempBucket
  };

  // Adjust peak if present (reduce by half the amount)
  if (window.peak) {
    adjusted.peak = window.peak - Math.round(reduction / 2);
  }

  // Add heat risk warning if flagged
  if (storageSettings.storage_heat_risk === 'true') {
    adjusted.heat_warning = true;
    adjusted.confidence = 'low'; // Override confidence when heat risk present
  }

  return adjusted;
}

/**
 * Get storage settings from database.
 * @returns {Promise<object>} Storage settings object
 */
export async function getStorageSettings() {
  try {
    const rows = await db.prepare(`
      SELECT key, value FROM user_settings
      WHERE key IN ('storage_mode', 'storage_temp_bucket', 'storage_heat_risk', 'storage_adjustment_enabled')
    `).all();

    const settings = {};
    for (const row of rows) {
      settings[row.key] = row.value;
    }
    return settings;
  } catch (error) {
    console.error('Error loading storage settings:', error);
    return {};
  }
}

/**
 * Ultimate fallback by colour
 * @param {string} colour - Wine colour
 * @param {number} vintage - Vintage year
 * @returns {object} - Default window based on colour
 */
export function getFallbackByColour(colour, vintage) {
  const fallbacks = {
    'red': { from: 2, by: 8, peak: 4 },
    'white': { from: 1, by: 5, peak: 2 },
    'rose': { from: 1, by: 2, peak: 1 },
    'sparkling': { from: 1, by: 4, peak: 2 },
    'dessert': { from: 3, by: 20, peak: 10 }
  };

  const f = fallbacks[normaliseColour(colour)] || fallbacks['red'];

  return {
    drink_from: vintage + f.from,
    drink_by: vintage + f.by,
    peak: vintage + f.peak,
    confidence: 'low',
    source: 'colour_fallback',
    notes: 'Generic fallback by colour - no specific match found'
  };
}
