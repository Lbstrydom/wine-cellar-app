/**
 * @fileoverview Centralized style taxonomy — single source of truth for
 * the 11 wine style bucket IDs, labels, and shopping suggestions.
 * Consumed by buyingGuide.js, buyingGuideCart.js, Zod schemas, and frontend.
 * @module config/styleIds
 */

/** All valid style bucket IDs. */
export const STYLE_IDS = [
  'white_crisp', 'white_medium', 'white_oaked', 'white_aromatic',
  'rose_dry', 'red_light', 'red_medium', 'red_full',
  'sparkling_dry', 'sparkling_rose', 'dessert'
];

/** Human-readable labels keyed by style ID. */
export const STYLE_LABELS = {
  white_crisp: 'Crisp White',
  white_medium: 'Medium White',
  white_oaked: 'Oaked White',
  white_aromatic: 'Aromatic White',
  rose_dry: 'Dry Rosé',
  red_light: 'Light Red',
  red_medium: 'Medium Red',
  red_full: 'Full Red',
  sparkling_dry: 'Sparkling',
  sparkling_rose: 'Sparkling Rosé',
  dessert: 'Dessert'
};

/** Shopping suggestions per style bucket. */
export const SHOPPING_SUGGESTIONS = {
  white_crisp: ['Sauvignon Blanc', 'Pinot Grigio', 'Albariño', 'Muscadet', 'Vermentino'],
  white_medium: ['Chardonnay (unoaked)', 'Chenin Blanc', 'Pinot Blanc', 'Grüner Veltliner'],
  white_oaked: ['Oaked Chardonnay', 'White Burgundy', 'White Rioja', 'Fumé Blanc'],
  white_aromatic: ['Riesling', 'Gewürztraminer', 'Viognier', 'Torrontés'],
  rose_dry: ['Provence Rosé', 'Côtes de Provence', 'Tavel', 'Grenache Rosé'],
  red_light: ['Pinot Noir', 'Gamay', 'Beaujolais', 'Valpolicella'],
  red_medium: ['Merlot', 'Côtes du Rhône', 'Chianti', 'Rioja', 'Pinotage'],
  red_full: ['Cabernet Sauvignon', 'Shiraz', 'Malbec', 'Barolo', 'Pinotage'],
  sparkling_dry: ['Champagne', 'Prosecco', 'Cava', 'Crémant', 'Cap Classique'],
  sparkling_rose: ['Rosé Champagne', 'Rosé Prosecco', 'Rosé Cap Classique'],
  dessert: ['Sauternes', 'Port', 'Ice Wine', 'PX Sherry', 'Muscat de Beaumes-de-Venise']
};
