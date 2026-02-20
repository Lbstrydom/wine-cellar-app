/**
 * @fileoverview Grape variety reference data for frontend autocomplete.
 * Single source of truth for all known grape varieties and common blends.
 * Mirrors the display names from grapeEnrichment.js GRAPE_PATTERNS.
 * @module grapeData
 */

/**
 * White grape varieties, sorted alphabetically.
 * @type {string[]}
 */
export const WHITE_GRAPES = [
  'Albariño',
  'Alvarinho',
  'Assyrtiko',
  'Chardonnay',
  'Chenin Blanc',
  'Clairette',
  'Cortese',
  'Fiano',
  'Garganega',
  'Gewürztraminer',
  'Godello',
  'Greco',
  'Grenache Blanc',
  'Gros Manseng',
  'Grüner Veltliner',
  'Loureiro',
  'Macabeo',
  'Malvasia',
  'Marsanne',
  'Melon de Bourgogne',
  'Muscadelle',
  'Muscat',
  'Parellada',
  'Petit Manseng',
  'Picpoul',
  'Pinot Blanc',
  'Pinot Grigio',
  'Riesling',
  'Roussanne',
  'Sauvignon Blanc',
  'Sémillon',
  'Torrontés',
  'Trebbiano',
  'Verdejo',
  'Vermentino',
  'Viognier',
  'Viura',
  'Xarel·lo',
];

/**
 * Red grape varieties, sorted alphabetically.
 * @type {string[]}
 */
export const RED_GRAPES = [
  'Aglianico',
  'Barbera',
  'Cabernet Franc',
  'Cabernet Sauvignon',
  'Canaiolo',
  'Carignan',
  'Carmenère',
  'Cinsault',
  'Corvina',
  'Dolcetto',
  'Graciano',
  'Grenache',
  'Malbec',
  'Merlot',
  'Molinara',
  'Mourvèdre',
  'Nebbiolo',
  'Negroamaro',
  'Nero d\'Avola',
  'Petit Verdot',
  'Petite Sirah',
  'Pinot Meunier',
  'Pinot Noir',
  'Pinotage',
  'Primitivo',
  'Rondinella',
  'Sangiovese',
  'Saperavi',
  'Shiraz',
  'Tannat',
  'Tempranillo',
  'Tinta Barroca',
  'Tinta Roriz',
  'Touriga Franca',
  'Touriga Nacional',
  'Zinfandel',
];

/**
 * All grape varieties combined (backward-compatible flat list).
 * @type {string[]}
 */
export const GRAPE_VARIETIES = [...WHITE_GRAPES, ...RED_GRAPES];

/**
 * Quick lookup: grape name → colour category.
 * @type {Map<string, 'red'|'white'>}
 */
export const GRAPE_COLOUR_MAP = new Map([
  ...WHITE_GRAPES.map(g => [g, 'white']),
  ...RED_GRAPES.map(g => [g, 'red']),
]);

/** Blend colour categories */
const BLEND_CAT_RED = 'red';
const BLEND_CAT_WHITE = 'white';
const BLEND_CAT_SPARKLING = 'sparkling';
const BLEND_CAT_ROSE = 'rosé';

/**
 * Common named blends that users may search for.
 * Each blend has a label, grapes string, and colour category.
 * @type {Array<{label: string, grapes: string, category: string}>}
 */
export const COMMON_BLENDS = [
  // Red blends
  { label: 'Bordeaux Blend (Left Bank)', grapes: 'Cabernet Sauvignon, Merlot, Cabernet Franc', category: BLEND_CAT_RED },
  { label: 'Bordeaux Blend (Right Bank)', grapes: 'Merlot, Cabernet Franc, Cabernet Sauvignon', category: BLEND_CAT_RED },
  { label: 'GSM (Rhône Blend)', grapes: 'Grenache, Shiraz, Mourvèdre', category: BLEND_CAT_RED },
  { label: 'Super Tuscan', grapes: 'Sangiovese, Cabernet Sauvignon, Merlot', category: BLEND_CAT_RED },
  { label: 'Chianti Blend', grapes: 'Sangiovese, Canaiolo, Merlot', category: BLEND_CAT_RED },
  { label: 'Amarone / Valpolicella Blend', grapes: 'Corvina, Rondinella, Molinara', category: BLEND_CAT_RED },
  { label: 'Rioja Blend', grapes: 'Tempranillo, Garnacha, Graciano', category: BLEND_CAT_RED },
  { label: 'Priorat Blend', grapes: 'Grenache, Carignan', category: BLEND_CAT_RED },
  { label: 'Cape Blend', grapes: 'Pinotage, Cabernet Sauvignon, Merlot, Shiraz', category: BLEND_CAT_RED },
  { label: 'Douro / Port Blend', grapes: 'Touriga Nacional, Touriga Franca, Tinta Roriz, Tinta Barroca', category: BLEND_CAT_RED },
  { label: 'Meritage', grapes: 'Cabernet Sauvignon, Merlot, Cabernet Franc, Petit Verdot, Malbec', category: BLEND_CAT_RED },
  { label: 'Côte-Rôtie Style', grapes: 'Shiraz, Viognier', category: BLEND_CAT_RED },
  { label: 'Bandol Blend', grapes: 'Mourvèdre, Grenache, Cinsault', category: BLEND_CAT_RED },
  { label: 'Languedoc Blend', grapes: 'Grenache, Shiraz, Mourvèdre, Carignan', category: BLEND_CAT_RED },

  // White blends
  { label: 'White Bordeaux', grapes: 'Sémillon, Sauvignon Blanc, Muscadelle', category: BLEND_CAT_WHITE },
  { label: 'Sauternes (Sweet Bordeaux)', grapes: 'Sémillon, Sauvignon Blanc', category: BLEND_CAT_WHITE },
  { label: 'White Rhône', grapes: 'Marsanne, Roussanne', category: BLEND_CAT_WHITE },
  { label: 'Jurançon Blend', grapes: 'Gros Manseng, Petit Manseng', category: BLEND_CAT_WHITE },
  { label: 'Vinho Verde Blend', grapes: 'Loureiro, Alvarinho', category: BLEND_CAT_WHITE },

  // Sparkling
  { label: 'Champagne Blend', grapes: 'Chardonnay, Pinot Noir, Pinot Meunier', category: BLEND_CAT_SPARKLING },
  { label: 'Cava Blend', grapes: 'Macabeo, Parellada, Xarel·lo', category: BLEND_CAT_SPARKLING },

  // Rosé
  { label: 'Provence Rosé', grapes: 'Grenache, Cinsault, Shiraz, Mourvèdre', category: BLEND_CAT_ROSE },
  { label: 'Tavel Rosé', grapes: 'Grenache, Cinsault, Mourvèdre', category: BLEND_CAT_ROSE },
];

/**
 * Filter categories for the autocomplete UI.
 * @type {Array<{key: string, label: string}>}
 */
export const FILTER_CATEGORIES = [
  { key: 'all', label: 'All' },
  { key: 'red', label: 'Red' },
  { key: 'white', label: 'White' },
  { key: 'rosé', label: 'Rosé' },
  { key: 'sparkling', label: 'Sparkling' },
  { key: 'blends', label: 'Blends' },
];
