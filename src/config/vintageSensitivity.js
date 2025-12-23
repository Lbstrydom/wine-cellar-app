/**
 * @fileoverview Vintage sensitivity configuration for rating matching.
 * @module config/vintageSensitivity
 */

/**
 * Vintage sensitivity levels:
 * - HIGH: Only exact vintage matches valid (age-worthy wines where each vintage differs)
 * - MEDIUM: Accept ±1 year for similar vintages
 * - LOW: Accept ±2 years or NV (everyday wines, consistent house styles)
 */

/**
 * Wine types and their vintage sensitivity.
 */
export const vintageSensitivityByType = {
  // High sensitivity - each vintage is unique
  high: [
    // French Classics
    'barolo', 'barbaresco', 'brunello', 'burgundy', 'bordeaux_classified',
    'champagne_vintage', 'hermitage', 'cote_rotie', 'cornas',
    'sauternes', 'alsace_grand_cru', 'pauillac', 'margaux', 'saint_julien',
    'saint_emilion_grand_cru', 'pomerol', 'pessac_leognan', 'meursault',
    'puligny_montrachet', 'chassagne_montrachet', 'corton_charlemagne',
    'montrachet', 'gevrey_chambertin', 'chambolle_musigny', 'vosne_romanee',
    'nuits_saint_georges', 'clos_vougeot', 'romanee_conti',

    // Italian Classics
    'amarone', 'taurasi', 'brunello_di_montalcino', 'barolo_single_vineyard',
    'supertuscan', 'sassicaia', 'ornellaia', 'tignanello',

    // Spanish Premium
    'rioja_gran_reserva', 'ribera_gran_reserva', 'priorat', 'vega_sicilia',
    'pingus', 'unico',

    // German Premium
    'trockenbeerenauslese', 'auslese', 'spatlese', 'eiswein',
    'grosse_lage', 'grosses_gewachs',

    // Port
    'vintage_port', 'single_quinta_vintage_port',

    // Premium New World
    'napa_cult', 'penfolds_grange', 'hill_of_grace', 'screaming_eagle',
    'opus_one', 'harlan', 'scarecrow', 'almaviva', 'sena'
  ],

  // Medium sensitivity - vintage matters but similar years comparable
  medium: [
    // French Regional
    'chablis', 'chablis_premier_cru', 'chablis_grand_cru',
    'rhone', 'chateauneuf_du_pape', 'gigondas', 'vacqueyras',
    'loire', 'sancerre', 'pouilly_fume', 'vouvray',
    'alsace', 'bordeaux', 'saint_emilion', 'medoc', 'haut_medoc',

    // Italian Regional
    'chianti_classico', 'chianti_classico_riserva',
    'valpolicella_ripasso', 'valpolicella_superiore',
    'barolo_entry', 'barbaresco_entry', 'montepulciano',

    // Spanish Regional
    'rioja_reserva', 'ribera_reserva', 'rueda', 'albarino',

    // New World Premium
    'barossa_shiraz', 'margaret_river', 'stellenbosch', 'mendoza_premium',
    'central_otago_pinot', 'martinborough_pinot', 'willamette_pinot',
    'russian_river_pinot', 'sonoma_coast_pinot', 'santa_rita_hills',

    // Age-worthy wines generally
    'oak_aged_white', 'reserve_red', 'gran_reserva', 'reserva',
    'riserva', 'selection', 'prestige_cuvee'
  ],

  // Low sensitivity - consistent style, vintage less critical
  low: [
    // Everyday Whites
    'marlborough_sauvignon', 'pinot_grigio', 'prosecco', 'cava',
    'albarino', 'verdejo', 'vermentino', 'vinho_verde',
    'muscadet', 'gruner_veltliner', 'riesling_trocken',

    // Everyday Reds
    'chianti', 'cotes_du_rhone', 'malbec', 'carmenere',
    'cotes_du_ventoux', 'languedoc', 'pays_doc', 'vin_de_pays',
    'vinho_regional', 'vino_de_mesa',

    // House Styles & NV
    'nv_champagne', 'nv_sparkling', 'cremant', 'franciacorta_nv',
    'ruby_port', 'tawny_port', 'fino_sherry', 'manzanilla',

    // Commercial/Supermarket
    'commercial_brand', 'supermarket_wine', 'bag_in_box',
    'entry_level', 'house_wine', 'table_wine'
  ]
};

/**
 * Price thresholds for sensitivity override.
 */
const PRICE_THRESHOLDS = {
  high: 75,    // Wines >= $75 get high sensitivity
  medium: 30,  // Wines >= $30 get medium sensitivity
  low: 12      // Wines < $12 get low sensitivity
};

/**
 * Normalise string for matching.
 * @param {string} value - Value to normalise
 * @returns {string|null} Normalised value or null
 */
function normaliseForMatch(value) {
  if (!value) return null;
  return value.toLowerCase()
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

/**
 * Determine vintage sensitivity for a wine.
 * @param {Object} wine - Wine object
 * @returns {'high'|'medium'|'low'} Sensitivity level
 */
export function getVintageSensitivity(wine) {
  const { grape, region, style, wine_name, price } = wine;

  // Price-based override
  if (price) {
    if (price >= PRICE_THRESHOLDS.high) return 'high';
    if (price >= PRICE_THRESHOLDS.medium) return 'medium';
    if (price < PRICE_THRESHOLDS.low) return 'low';
  }

  // Check explicit matches in wine name, region, style, or grape
  const searchStrings = [
    normaliseForMatch(wine_name),
    normaliseForMatch(region),
    normaliseForMatch(style),
    normaliseForMatch(grape)
  ].filter(Boolean);

  for (const [sensitivity, types] of Object.entries(vintageSensitivityByType)) {
    for (const type of types) {
      const normType = normaliseForMatch(type);
      for (const searchStr of searchStrings) {
        if (searchStr.includes(normType)) {
          return sensitivity;
        }
      }
    }
  }

  // Default based on colour
  const colour = wine.colour?.toLowerCase();
  if (colour === 'sparkling') return 'medium';
  if (colour === 'dessert' || colour === 'fortified') return 'medium';
  if (colour === 'white' || colour === 'rose' || colour === 'rosé') return 'low';

  return 'medium'; // Default for reds
}

/**
 * Check if a vintage match is acceptable given wine sensitivity.
 * @param {Object} wine - Wine object
 * @param {number|null} wineVintage - Wine's vintage year
 * @param {number|null} ratingVintage - Rating's vintage year
 * @param {'exact'|'inferred'|'non_vintage'} matchType - Type of vintage match
 * @returns {boolean} True if match is acceptable
 */
export function isVintageMatchAcceptable(wine, wineVintage, ratingVintage, matchType) {
  // Exact matches are always acceptable
  if (matchType === 'exact') return true;

  // NV wines accept any rating
  if (!wineVintage) return true;

  const sensitivity = getVintageSensitivity(wine);

  // Non-vintage ratings
  if (matchType === 'non_vintage') {
    return sensitivity === 'low';
  }

  // Inferred vintage matches
  if (matchType === 'inferred' && ratingVintage) {
    const diff = Math.abs(wineVintage - ratingVintage);

    switch (sensitivity) {
      case 'high':
        return false; // Never accept inferred for high sensitivity wines
      case 'medium':
        return diff <= 1; // Accept ±1 year
      case 'low':
        return diff <= 2; // Accept ±2 years
      default:
        return diff <= 1;
    }
  }

  return false;
}

/**
 * Filter ratings by vintage sensitivity.
 * @param {Object} wine - Wine object
 * @param {Array} ratings - Extracted ratings
 * @returns {Array} Filtered ratings
 */
export function filterRatingsByVintageSensitivity(wine, ratings) {
  if (!ratings || !Array.isArray(ratings)) return [];

  const wineVintage = wine.vintage ? parseInt(wine.vintage) : null;

  return ratings.filter(rating => {
    const ratingVintage = rating.vintage_year || rating.vintageYear;
    const matchType = rating.vintage_match || rating.vintageMatch || 'inferred';

    const acceptable = isVintageMatchAcceptable(
      wine,
      wineVintage,
      ratingVintage,
      matchType
    );

    if (!acceptable) {
      console.log(`[Vintage] Rejecting ${rating.source} rating: ${matchType} match ` +
        `(wine: ${wineVintage}, rating: ${ratingVintage}) for ${getVintageSensitivity(wine)} sensitivity wine`);
    }

    return acceptable;
  });
}

/**
 * Get sensitivity level description.
 * @param {'high'|'medium'|'low'} level - Sensitivity level
 * @returns {string} Description
 */
export function getSensitivityDescription(level) {
  switch (level) {
    case 'high':
      return 'Only exact vintage matches accepted (age-worthy wine)';
    case 'medium':
      return 'Accepts ratings from ±1 year';
    case 'low':
      return 'Accepts ratings from ±2 years or NV';
    default:
      return 'Unknown sensitivity level';
  }
}
