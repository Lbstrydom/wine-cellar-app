/**
 * @fileoverview Unified wine rating source configuration.
 * Single source of truth for all rating source metadata.
 * @module config/unifiedSources
 */

// =============================================================================
// LENS DEFINITIONS
// =============================================================================

/**
 * Source methodology categories (lenses).
 */
export const LENS = {
  COMPETITION: 'competition',
  PANEL_GUIDE: 'panel_guide',
  CRITIC: 'critic',
  COMMUNITY: 'community',
  AGGREGATOR: 'aggregator',
  PRODUCER: 'producer'
};

/**
 * Credibility weights by lens.
 * Higher = more trusted for purchase decisions.
 */
export const LENS_CREDIBILITY = {
  [LENS.COMPETITION]: 3.0,
  [LENS.PANEL_GUIDE]: 2.5,
  [LENS.CRITIC]: 1.5,
  [LENS.COMMUNITY]: 1.0,
  [LENS.AGGREGATOR]: 0.85,
  [LENS.PRODUCER]: 1.2
};

/**
 * Lens display order for UI.
 */
export const LENS_ORDER = [
  LENS.COMPETITION,
  LENS.PANEL_GUIDE,
  LENS.CRITIC,
  LENS.COMMUNITY,
  LENS.AGGREGATOR,
  LENS.PRODUCER
];

/**
 * Mapping for UI display - consolidates panel_guide and critic.
 */
export const LENS_DISPLAY_MAP = {
  [LENS.COMPETITION]: 'competition',
  [LENS.PANEL_GUIDE]: 'critics',
  [LENS.CRITIC]: 'critics',
  [LENS.COMMUNITY]: 'community',
  [LENS.AGGREGATOR]: 'critics',
  [LENS.PRODUCER]: 'competition'
};

/**
 * Credibility discount for ratings found via aggregator.
 */
export const AGGREGATOR_CREDIBILITY_DISCOUNT = 0.85;

// =============================================================================
// SCORE NORMALIZATION FUNCTIONS
// =============================================================================

/**
 * Standard 100-point normalizer.
 */
const normalise100Point = (raw) => {
  const match = raw.match(/(\d{2,3})/);
  return match ? parseInt(match[1]) : null;
};

/**
 * 20-point scale normalizer (multiply by 5).
 */
const normalise20Point = (raw) => {
  const match = raw.match(/(\d{1,2}(?:\.\d)?)/);
  if (match) {
    const score = parseFloat(match[1]);
    return score <= 20 ? Math.round(score * 5) : score;
  }
  return null;
};

/**
 * Star rating normalizer (multiply by 20).
 */
const normaliseStars = (raw) => {
  // Check for half star notation
  const halfMatch = raw.match(/(\d)½/);
  if (halfMatch) {
    return Math.round((parseInt(halfMatch[1]) + 0.5) * 20);
  }
  // Check for decimal notation
  const decMatch = raw.match(/(\d(?:\.\d)?)\s*stars?/i);
  if (decMatch) {
    return Math.round(parseFloat(decMatch[1]) * 20);
  }
  // Count star symbols
  const starCount = (raw.match(/★/g) || []).length;
  const halfStarCount = (raw.match(/½/g) || []).length;
  if (starCount > 0) {
    return Math.round((starCount + halfStarCount * 0.5) * 20);
  }
  return null;
};

// =============================================================================
// UNIFIED SOURCE REGISTRY
// =============================================================================

/**
 * Complete source configuration.
 *
 * Schema:
 * - name: Full display name
 * - short_name: Abbreviated name for UI
 * - lens: Source methodology category
 * - credibility: Source credibility (0-1 scale)
 * - scope: 'global' | 'national' | 'regional' | 'varietal'
 * - home_regions: Countries where authoritative (empty = global)
 * - domain: Primary website domain
 * - alt_domains: Alternative domains (optional)
 * - language: Primary language code
 * - grape_affinity: Grape varieties specialization (null = all)
 * - score_type: 'points' | 'stars' | 'medal' | 'symbol'
 * - score_scale: Numeric scale (100, 20, 5)
 * - score_format: Regex pattern for score extraction
 * - query_template: Search query template
 * - normalise: Function to convert raw score to 0-100
 * - examples: Example score formats
 * - medal_bands: Medal to points mapping (for medal types)
 * - symbol_conversion: Symbol to points mapping (for symbol types)
 * - stars_conversion: Star to points mapping (for star types)
 * - is_aggregator: True if source aggregates other sources
 * - aggregates_sources: Array of source IDs this aggregates
 * - paywalled: True if content is paywalled
 * - snippet_extraction: True if scores often appear in search snippets
 * - notes: Additional information
 */
export const SOURCES = {
  // ===========================================================================
  // COMPETITIONS - Global
  // ===========================================================================
  decanter: {
    name: 'Decanter World Wine Awards',
    short_name: 'DWWA',
    lens: LENS.COMPETITION,
    credibility: 1.0,
    scope: 'global',
    home_regions: [],
    domain: 'decanter.com',
    language: 'en',
    grape_affinity: null,
    score_type: 'medal',
    score_format: /Platinum|Gold|Silver|Bronze|Commended|Best in Show/i,
    query_template: '{wine} {vintage} site:decanter.com award medal',
    examples: ['Best in Show', 'Platinum', 'Gold', 'Silver', 'Bronze', 'Commended'],
    normalise: (raw) => {
      const lower = raw.toLowerCase();
      if (lower.includes('best in show')) return 99;
      if (lower.includes('platinum')) return 97;
      if (lower.includes('gold')) return 94;
      if (lower.includes('silver')) return 88;
      if (lower.includes('bronze')) return 82;
      if (lower.includes('commended')) return 78;
      return null;
    },
    medal_bands: {
      platinum: { min: 97, max: 100, label: 'Platinum' },
      gold: { min: 95, max: 96, label: 'Gold' },
      silver: { min: 90, max: 94, label: 'Silver' },
      bronze: { min: 86, max: 89, label: 'Bronze' },
      commended: { min: 83, max: 85, label: 'Commended' }
    }
  },

  iwc: {
    name: 'International Wine Challenge',
    short_name: 'IWC',
    lens: LENS.COMPETITION,
    credibility: 1.0,
    scope: 'global',
    home_regions: [],
    domain: 'internationalwinechallenge.com',
    language: 'en',
    grape_affinity: null,
    score_type: 'medal',
    score_format: /Trophy|Gold|Silver|Bronze|Commended/i,
    query_template: '{wine} {vintage} site:internationalwinechallenge.com',
    examples: ['Trophy', 'Gold', 'Silver', 'Bronze', 'Commended'],
    normalise: (raw) => {
      const lower = raw.toLowerCase();
      if (lower.includes('trophy')) return 98;
      if (lower.includes('gold')) return 94;
      if (lower.includes('silver')) return 88;
      if (lower.includes('bronze')) return 82;
      if (lower.includes('commended')) return 78;
      return null;
    },
    medal_bands: {
      trophy: { min: 97, max: 100, label: 'Trophy' },
      gold: { min: 95, max: 100, label: 'Gold' },
      silver: { min: 90, max: 94, label: 'Silver' },
      bronze: { min: 85, max: 89, label: 'Bronze' },
      commended: { min: 80, max: 84, label: 'Commended' }
    }
  },

  iwsc: {
    name: 'International Wine & Spirit Competition',
    short_name: 'IWSC',
    lens: LENS.COMPETITION,
    credibility: 1.0,
    scope: 'global',
    home_regions: [],
    domain: 'iwsc.net',
    language: 'en',
    grape_affinity: null,
    score_type: 'medal',
    score_format: /Gold Outstanding|Gold|Silver Outstanding|Silver|Bronze|Trophy/i,
    query_template: '{wine} {vintage} site:iwsc.net',
    examples: ['Trophy', 'Gold Outstanding', 'Gold', 'Silver Outstanding', 'Silver', 'Bronze'],
    normalise: (raw) => {
      const lower = raw.toLowerCase();
      if (lower.includes('trophy')) return 98;
      if (lower.includes('gold outstanding')) return 96;
      if (lower.includes('gold')) return 94;
      if (lower.includes('silver outstanding')) return 90;
      if (lower.includes('silver')) return 88;
      if (lower.includes('bronze')) return 82;
      return null;
    },
    medal_bands: {
      gold_outstanding: { min: 98, max: 100, label: 'Gold Outstanding' },
      gold: { min: 95, max: 97, label: 'Gold' },
      silver: { min: 90, max: 94, label: 'Silver' },
      bronze: { min: 85, max: 89, label: 'Bronze' }
    }
  },

  concours_mondial: {
    name: 'Concours Mondial de Bruxelles',
    short_name: 'CMB',
    lens: LENS.COMPETITION,
    credibility: 0.95,
    scope: 'global',
    home_regions: [],
    domain: 'concoursmondial.com',
    language: 'en',
    grape_affinity: null,
    score_type: 'medal',
    score_format: /Grand Gold|Gold|Silver/i,
    query_template: '{wine} {vintage} site:concoursmondial.com',
    examples: ['Grand Gold', 'Gold', 'Silver'],
    normalise: (raw) => {
      const lower = raw.toLowerCase();
      if (lower.includes('grand gold')) return 96;
      if (lower.includes('gold')) return 90;
      if (lower.includes('silver')) return 84;
      return null;
    },
    medal_bands: {
      grand_gold: { min: 92, max: 100, label: 'Grand Gold' },
      gold: { min: 85, max: 91.9, label: 'Gold' },
      silver: { min: 82, max: 84.9, label: 'Silver' }
    }
  },

  mundus_vini: {
    name: 'Mundus Vini',
    short_name: 'Mundus Vini',
    lens: LENS.COMPETITION,
    credibility: 0.85,
    scope: 'global',
    home_regions: [],
    domain: 'mundusvini.com',
    language: 'en',
    grape_affinity: null,
    score_type: 'medal',
    score_format: /Grand Gold|Gold|Silver/i,
    query_template: '{wine} {vintage} site:mundusvini.com',
    examples: ['Grand Gold', 'Gold', 'Silver'],
    normalise: (raw) => {
      const lower = raw.toLowerCase();
      if (lower.includes('grand gold')) return 96;
      if (lower.includes('gold')) return 92;
      if (lower.includes('silver')) return 86;
      return null;
    },
    medal_bands: {
      grand_gold: { min: 95, max: 100, label: 'Grand Gold' },
      gold: { min: 90, max: 94, label: 'Gold' },
      silver: { min: 85, max: 89, label: 'Silver' }
    }
  },

  // ===========================================================================
  // COMPETITIONS - Regional (South Africa)
  // ===========================================================================
  veritas: {
    name: 'Veritas Awards',
    short_name: 'Veritas',
    lens: LENS.COMPETITION,
    credibility: 0.9,
    scope: 'national',
    home_regions: ['South Africa'],
    domain: 'veritas.co.za',
    language: 'en',
    grape_affinity: null,
    score_type: 'medal',
    score_format: /Double Gold|Gold|Silver|Bronze/i,
    query_template: '{wine} {vintage} Veritas award',
    examples: ['Double Gold', 'Gold', 'Silver', 'Bronze'],
    normalise: (raw) => {
      const lower = raw.toLowerCase();
      if (lower.includes('double gold')) return 96;
      if (lower.includes('gold')) return 92;
      if (lower.includes('silver')) return 86;
      if (lower.includes('bronze')) return 80;
      return null;
    },
    medal_bands: {
      double_gold: { min: 95, max: 100, label: 'Double Gold' },
      gold: { min: 90, max: 94, label: 'Gold' },
      silver: { min: 85, max: 89, label: 'Silver' },
      bronze: { min: 80, max: 84, label: 'Bronze' }
    }
  },

  old_mutual: {
    name: 'Old Mutual Trophy Wine Show',
    short_name: 'Old Mutual',
    lens: LENS.COMPETITION,
    credibility: 0.9,
    scope: 'national',
    home_regions: ['South Africa'],
    domain: 'trophywineshow.co.za',
    language: 'en',
    grape_affinity: null,
    score_type: 'medal',
    score_format: /Trophy|Gold|Silver|Bronze/i,
    query_template: '{wine} {vintage} Old Mutual Trophy',
    examples: ['Trophy', 'Gold', 'Silver', 'Bronze'],
    normalise: (raw) => {
      const lower = raw.toLowerCase();
      if (lower.includes('trophy')) return 98;
      if (lower.includes('gold')) return 92;
      if (lower.includes('silver')) return 86;
      if (lower.includes('bronze')) return 80;
      return null;
    },
    medal_bands: {
      trophy: { min: 95, max: 100, label: 'Trophy' },
      gold: { min: 90, max: 94, label: 'Gold' },
      silver: { min: 85, max: 89, label: 'Silver' },
      bronze: { min: 80, max: 84, label: 'Bronze' }
    }
  },

  // ===========================================================================
  // COMPETITIONS - Varietal
  // ===========================================================================
  chardonnay_du_monde: {
    name: 'Chardonnay du Monde',
    short_name: 'Chard du Monde',
    lens: LENS.COMPETITION,
    credibility: 0.85,
    scope: 'varietal',
    home_regions: [],
    domain: 'chardonnay-du-monde.com',
    language: 'fr',
    grape_affinity: ['chardonnay'],
    score_type: 'medal',
    score_format: /Gold|Silver|Bronze/i,
    query_template: '{wine} {vintage} Chardonnay du Monde',
    examples: ['Gold', 'Silver', 'Bronze'],
    normalise: (raw) => {
      const lower = raw.toLowerCase();
      if (lower.includes('gold')) return 94;
      if (lower.includes('silver')) return 88;
      if (lower.includes('bronze')) return 82;
      return null;
    },
    medal_bands: {
      gold: { min: 92, max: 100, label: 'Gold' },
      silver: { min: 85, max: 91, label: 'Silver' },
      bronze: { min: 80, max: 84, label: 'Bronze' }
    }
  },

  syrah_du_monde: {
    name: 'Syrah du Monde',
    short_name: 'Syrah du Monde',
    lens: LENS.COMPETITION,
    credibility: 0.85,
    scope: 'varietal',
    home_regions: [],
    domain: 'syrahdumonde.com',
    language: 'fr',
    grape_affinity: ['syrah', 'shiraz'],
    score_type: 'medal',
    score_format: /Gold|Silver|Bronze/i,
    query_template: '{wine} {vintage} Syrah du Monde',
    examples: ['Gold', 'Silver', 'Bronze'],
    normalise: (raw) => {
      const lower = raw.toLowerCase();
      if (lower.includes('gold')) return 94;
      if (lower.includes('silver')) return 88;
      if (lower.includes('bronze')) return 82;
      return null;
    },
    medal_bands: {
      gold: { min: 92, max: 100, label: 'Gold' },
      silver: { min: 85, max: 91, label: 'Silver' },
      bronze: { min: 80, max: 84, label: 'Bronze' }
    }
  },

  grenaches_du_monde: {
    name: 'Grenaches du Monde',
    short_name: 'Grenaches du Monde',
    lens: LENS.COMPETITION,
    credibility: 0.85,
    scope: 'varietal',
    home_regions: [],
    domain: 'grenachesdumonde.com',
    language: 'fr',
    grape_affinity: ['grenache', 'garnacha'],
    score_type: 'medal',
    score_format: /Grand Gold|Gold|Silver|Bronze/i,
    query_template: '{wine} {vintage} Grenaches du Monde',
    examples: ['Grand Gold', 'Gold', 'Silver', 'Bronze'],
    normalise: (raw) => {
      const lower = raw.toLowerCase();
      if (lower.includes('grand gold')) return 96;
      if (lower.includes('gold')) return 92;
      if (lower.includes('silver')) return 86;
      if (lower.includes('bronze')) return 80;
      return null;
    },
    medal_bands: {
      grand_gold: { min: 95, max: 100, label: 'Grand Gold' },
      gold: { min: 90, max: 94, label: 'Gold' },
      silver: { min: 85, max: 89, label: 'Silver' },
      bronze: { min: 80, max: 84, label: 'Bronze' }
    }
  },

  // ===========================================================================
  // PANEL GUIDES - South Africa
  // ===========================================================================
  platters: {
    name: "Platter's Wine Guide",
    short_name: "Platter's",
    lens: LENS.PANEL_GUIDE,
    credibility: 0.85,
    scope: 'national',
    home_regions: ['South Africa'],
    domain: 'wineonaplatter.com',
    alt_domains: ['platterwineguide.com'],
    language: 'en',
    grape_affinity: null,
    score_type: 'stars',
    score_scale: 5,
    score_format: /\d(?:\.\d)?\s*stars?|★+½?/i,
    query_template: "{wine} {vintage} Platter's stars rating",
    examples: ['5 stars', '4.5 stars', '4 stars', '★★★★★', '★★★★½'],
    normalise: normaliseStars,
    stars_conversion: {
      5: { min: 95, max: 100, label: '5 Stars' },
      4.5: { min: 90, max: 94, label: '4.5 Stars' },
      4: { min: 85, max: 89, label: '4 Stars' },
      3.5: { min: 80, max: 84, label: '3.5 Stars' },
      3: { min: 75, max: 79, label: '3 Stars' }
    }
  },

  // ===========================================================================
  // PANEL GUIDES - Australia
  // ===========================================================================
  halliday: {
    name: 'Halliday Wine Companion',
    short_name: 'Halliday',
    lens: LENS.PANEL_GUIDE,
    credibility: 0.85,
    scope: 'national',
    home_regions: ['Australia'],
    domain: 'winecompanion.com.au',
    language: 'en',
    grape_affinity: null,
    score_type: 'points',
    score_scale: 100,
    score_format: /\d{2,3}\s*points?/i,
    query_template: '{wine} {vintage} site:winecompanion.com.au',
    examples: ['95', '92', '97'],
    normalise: normalise100Point
  },

  gourmet_traveller_wine: {
    name: 'Gourmet Traveller Wine',
    short_name: 'GT Wine',
    lens: LENS.PANEL_GUIDE,
    credibility: 0.75,
    scope: 'national',
    home_regions: ['Australia'],
    domain: 'gourmettravellerwine.com.au',
    language: 'en',
    grape_affinity: null,
    score_type: 'points',
    score_scale: 100,
    score_format: /\d{2,3}/,
    query_template: '{wine} {vintage} site:gourmettravellerwine.com.au',
    examples: ['93', '90', '95'],
    normalise: normalise100Point
  },

  // ===========================================================================
  // PANEL GUIDES - Spain
  // ===========================================================================
  guia_penin: {
    name: 'Guía Peñín',
    short_name: 'Peñín',
    lens: LENS.PANEL_GUIDE,
    credibility: 0.85,
    scope: 'national',
    home_regions: ['Spain'],
    domain: 'guiapenin.com',
    language: 'es',
    grape_affinity: null,
    score_type: 'points',
    score_scale: 100,
    score_format: /\d{2,3}\s*(puntos)?/i,
    query_template: '{wine} {vintage} Guía Peñín puntos',
    examples: ['92', '88', '95'],
    normalise: normalise100Point
  },

  // ===========================================================================
  // PANEL GUIDES - Italy
  // ===========================================================================
  gambero_rosso: {
    name: 'Gambero Rosso',
    short_name: 'Gambero Rosso',
    lens: LENS.PANEL_GUIDE,
    credibility: 0.90,
    scope: 'national',
    home_regions: ['Italy'],
    domain: 'gamberorosso.it',
    language: 'it',
    grape_affinity: null,
    score_type: 'symbol',
    score_format: /Tre Bicchieri|Due Bicchieri Rossi|Due Bicchieri|Un Bicchiere/i,
    query_template: '{wine} {vintage} Gambero Rosso bicchieri',
    examples: ['Tre Bicchieri', 'Due Bicchieri Rossi', 'Due Bicchieri', 'Un Bicchiere'],
    normalise: (raw) => {
      const lower = raw.toLowerCase();
      if (lower.includes('tre bicchieri')) return 95;
      if (lower.includes('due bicchieri rossi')) return 90;
      if (lower.includes('due bicchieri')) return 87;
      if (lower.includes('un bicchiere') || lower.includes('uno bicchiere')) return 80;
      const numMatch = lower.match(/(\d)\s*bicchieri/);
      if (numMatch) {
        const count = parseInt(numMatch[1]);
        if (count === 3) return 95;
        if (count === 2) return 87;
        if (count === 1) return 80;
      }
      return null;
    },
    symbol_conversion: {
      'tre_bicchieri': { min: 95, max: 100, label: 'Tre Bicchieri' },
      'due_bicchieri_rossi': { min: 90, max: 94, label: 'Due Bicchieri Rossi' },
      'due_bicchieri': { min: 85, max: 89, label: 'Due Bicchieri' },
      'un_bicchiere': { min: 78, max: 84, label: 'Un Bicchiere' }
    }
  },

  bibenda: {
    name: 'Bibenda',
    short_name: 'Bibenda',
    lens: LENS.PANEL_GUIDE,
    credibility: 0.80,
    scope: 'national',
    home_regions: ['Italy'],
    domain: 'bibenda.it',
    language: 'it',
    grape_affinity: null,
    score_type: 'symbol',
    score_format: /[1-5]\s*grappoli|cinque grappoli|quattro grappoli/i,
    query_template: '{wine} {vintage} Bibenda grappoli',
    examples: ['5 grappoli', 'cinque grappoli', '4 grappoli', 'quattro grappoli'],
    normalise: (raw) => {
      const lower = raw.toLowerCase();
      if (lower.includes('cinque') || lower.includes('5 grappoli')) return 95;
      if (lower.includes('quattro') || lower.includes('4 grappoli')) return 90;
      if (lower.includes('tre') || lower.includes('3 grappoli')) return 85;
      if (lower.includes('due') || lower.includes('2 grappoli')) return 80;
      return null;
    },
    symbol_conversion: {
      '5_grappoli': { min: 95, max: 100, label: '5 Grappoli' },
      '4_grappoli': { min: 90, max: 94, label: '4 Grappoli' },
      '3_grappoli': { min: 85, max: 89, label: '3 Grappoli' },
      '2_grappoli': { min: 78, max: 84, label: '2 Grappoli' }
    }
  },

  // ===========================================================================
  // PANEL GUIDES - France
  // ===========================================================================
  guide_hachette: {
    name: 'Guide Hachette des Vins',
    short_name: 'Hachette',
    lens: LENS.PANEL_GUIDE,
    credibility: 0.80,
    scope: 'national',
    home_regions: ['France'],
    domain: 'hachette-vins.com',
    language: 'fr',
    grape_affinity: null,
    score_type: 'symbol',
    score_format: /★{1,3}|Coup de C[oœ]ur|[1-3]\s*étoiles?/i,
    query_template: '{wine} {vintage} Guide Hachette',
    examples: ['★★★', '★★', '★', 'Coup de Cœur', '3 étoiles', '2 étoiles'],
    normalise: (raw) => {
      const lower = raw.toLowerCase();
      if (lower.includes('coup de') || lower.includes('cœur') || lower.includes('coeur')) return 96;
      const starCount = (raw.match(/★/g) || []).length;
      if (starCount === 3 || lower.includes('3 étoiles') || lower.includes('trois étoiles')) return 94;
      if (starCount === 2 || lower.includes('2 étoiles') || lower.includes('deux étoiles')) return 88;
      if (starCount === 1 || lower.includes('1 étoile') || lower.includes('une étoile')) return 82;
      return null;
    },
    stars_conversion: {
      3: { min: 92, max: 100, label: '3 Stars' },
      2: { min: 85, max: 91, label: '2 Stars' },
      1: { min: 78, max: 84, label: '1 Star' }
    }
  },

  rvf: {
    name: 'Revue du Vin de France',
    short_name: 'RVF',
    lens: LENS.PANEL_GUIDE,
    credibility: 0.85,
    scope: 'national',
    home_regions: ['France'],
    domain: 'larvf.com',
    language: 'fr',
    grape_affinity: null,
    score_type: 'points',
    score_scale: 20,
    score_format: /\d{1,2}\/20|\d{2,3}\/100/,
    query_template: '{wine} {vintage} Revue du Vin de France',
    examples: ['17/20', '16', '18.5/20'],
    normalise: normalise20Point
  },

  bettane_desseauve: {
    name: 'Bettane+Desseauve',
    short_name: 'B+D',
    lens: LENS.PANEL_GUIDE,
    credibility: 0.85,
    scope: 'national',
    home_regions: ['France'],
    domain: 'mybettanedesseauve.fr',
    language: 'fr',
    grape_affinity: null,
    score_type: 'points',
    score_scale: 20,
    score_format: /\d{1,2}\/20|\d{2,3}/,
    query_template: '{wine} {vintage} Bettane Desseauve',
    examples: ['16/20', '17.5', '15'],
    normalise: normalise20Point
  },

  // ===========================================================================
  // PANEL GUIDES - Germany/Austria/Switzerland
  // ===========================================================================
  falstaff: {
    name: 'Falstaff',
    short_name: 'Falstaff',
    lens: LENS.PANEL_GUIDE,
    credibility: 0.80,
    scope: 'regional',
    home_regions: ['Germany', 'Austria'],
    domain: 'falstaff.com',
    language: 'de',
    grape_affinity: null,
    score_type: 'points',
    score_scale: 100,
    score_format: /\d{2,3}/,
    query_template: '{wine} {vintage} site:falstaff.com',
    examples: ['93', '90', '95'],
    normalise: normalise100Point
  },

  vinum: {
    name: 'Vinum',
    short_name: 'Vinum',
    lens: LENS.PANEL_GUIDE,
    credibility: 0.75,
    scope: 'regional',
    home_regions: ['Switzerland', 'Germany', 'Austria'],
    domain: 'vinum.eu',
    language: 'de',
    grape_affinity: null,
    score_type: 'points',
    score_scale: 20,
    score_format: /\d{1,2}\/20|\d{2,3}/,
    query_template: '{wine} {vintage} Vinum',
    examples: ['17/20', '16', '18'],
    normalise: normalise20Point
  },

  // ===========================================================================
  // PANEL GUIDES - Portugal
  // ===========================================================================
  revista_vinhos: {
    name: 'Revista de Vinhos',
    short_name: 'Revista Vinhos',
    lens: LENS.PANEL_GUIDE,
    credibility: 0.80,
    scope: 'national',
    home_regions: ['Portugal'],
    domain: 'revistadevinhos.pt',
    language: 'pt',
    grape_affinity: null,
    score_type: 'points',
    score_scale: 100,
    score_format: /\d{2,3}/,
    query_template: '{wine} {vintage} Revista de Vinhos',
    examples: ['92', '88', '95'],
    normalise: normalise100Point
  },

  // ===========================================================================
  // PANEL GUIDES - Greece
  // ===========================================================================
  elloinos: {
    name: 'Elloinos',
    short_name: 'Elloinos',
    lens: LENS.PANEL_GUIDE,
    credibility: 0.75,
    scope: 'national',
    home_regions: ['Greece'],
    domain: 'elloinos.com',
    language: 'el',
    grape_affinity: null,
    score_type: 'points',
    score_scale: 100,
    score_format: /\d{2,3}/,
    query_template: '{wine} {vintage} Elloinos',
    examples: ['92', '88', '95'],
    normalise: normalise100Point
  },

  // ===========================================================================
  // PANEL GUIDES - South America
  // ===========================================================================
  vinomanos: {
    name: 'Vinómanos',
    short_name: 'Vinómanos',
    lens: LENS.PANEL_GUIDE,
    credibility: 0.75,
    scope: 'regional',
    home_regions: ['Chile', 'Argentina'],
    domain: 'vinomanos.com',
    language: 'es',
    grape_affinity: null,
    score_type: 'points',
    score_scale: 100,
    score_format: /\d{2,3}/,
    query_template: '{wine} {vintage} Vinómanos',
    examples: ['92', '88', '95'],
    normalise: normalise100Point
  },

  // ===========================================================================
  // CRITICS - South Africa
  // ===========================================================================
  tim_atkin: {
    name: 'Tim Atkin MW',
    short_name: 'Tim Atkin',
    lens: LENS.CRITIC,
    credibility: 0.80,
    scope: 'regional',
    home_regions: ['South Africa', 'Argentina'],
    domain: 'timatkin.com',
    language: 'en',
    grape_affinity: null,
    score_type: 'points',
    score_scale: 100,
    score_format: /\d{2,3}/,
    query_template: '{wine} {vintage} site:timatkin.com',
    examples: ['94', '91', '97'],
    normalise: normalise100Point
  },

  // ===========================================================================
  // CRITICS - Australia/New Zealand
  // ===========================================================================
  huon_hooke: {
    name: 'Huon Hooke',
    short_name: 'Huon Hooke',
    lens: LENS.CRITIC,
    credibility: 0.75,
    scope: 'national',
    home_regions: ['Australia'],
    domain: 'huonhooke.com',
    language: 'en',
    grape_affinity: null,
    score_type: 'points',
    score_scale: 100,
    score_format: /\d{2}(?:\.\d)?\/100/,
    query_template: '{wine} {vintage} site:huonhooke.com',
    examples: ['93', '90.5/100', '95'],
    normalise: normalise100Point
  },

  bob_campbell: {
    name: 'Bob Campbell MW',
    short_name: 'Bob Campbell',
    lens: LENS.CRITIC,
    credibility: 0.80,
    scope: 'national',
    home_regions: ['New Zealand'],
    domain: 'bobcampbell.nz',
    language: 'en',
    grape_affinity: null,
    score_type: 'points',
    score_scale: 100,
    score_format: /\d{2,3}/,
    query_template: '{wine} {vintage} site:bobcampbell.nz',
    examples: ['93', '90', '95'],
    normalise: normalise100Point
  },

  wine_orbit: {
    name: 'Wine Orbit',
    short_name: 'Wine Orbit',
    lens: LENS.CRITIC,
    credibility: 0.70,
    scope: 'national',
    home_regions: ['New Zealand'],
    domain: 'wineorbit.co.nz',
    language: 'en',
    grape_affinity: null,
    score_type: 'points',
    score_scale: 100,
    score_format: /\d{2,3}/,
    query_template: '{wine} {vintage} site:wineorbit.co.nz',
    examples: ['93', '90', '95'],
    normalise: normalise100Point
  },

  // ===========================================================================
  // CRITICS - Spain
  // ===========================================================================
  guia_proensa: {
    name: 'Guía Proensa',
    short_name: 'Proensa',
    lens: LENS.CRITIC,
    credibility: 0.70,
    scope: 'national',
    home_regions: ['Spain'],
    domain: 'guiaproensa.com',
    language: 'es',
    grape_affinity: null,
    score_type: 'points',
    score_scale: 100,
    score_format: /\d{2,3}/,
    query_template: '{wine} {vintage} Guía Proensa',
    examples: ['92', '88', '95'],
    normalise: normalise100Point
  },

  // ===========================================================================
  // CRITICS - Italy
  // ===========================================================================
  vinous: {
    name: 'Vinous (Antonio Galloni)',
    short_name: 'Vinous',
    lens: LENS.CRITIC,
    credibility: 0.85,
    scope: 'global',
    home_regions: ['Italy', 'USA', 'France'],
    domain: 'vinous.com',
    language: 'en',
    grape_affinity: null,
    score_type: 'points',
    score_scale: 100,
    score_format: /\d{2,3}\+?/,
    query_template: '{wine} {vintage} site:vinous.com',
    examples: ['93', '91+', '89-91'],
    normalise: normalise100Point,
    paywalled: true,
    snippet_extraction: true,
    notes: 'Italian specialist, ex-Parker reviewer. Scores often in snippets.'
  },

  doctor_wine: {
    name: 'Doctor Wine',
    short_name: 'Doctor Wine',
    lens: LENS.CRITIC,
    credibility: 0.75,
    scope: 'national',
    home_regions: ['Italy'],
    domain: 'doctorwine.it',
    language: 'it',
    grape_affinity: null,
    score_type: 'points',
    score_scale: 100,
    score_format: /\d{2,3}/,
    query_template: '{wine} {vintage} site:doctorwine.it',
    examples: ['93', '90', '95'],
    normalise: normalise100Point
  },

  // ===========================================================================
  // CRITICS - Germany
  // ===========================================================================
  weinwisser: {
    name: 'Weinwisser',
    short_name: 'Weinwisser',
    lens: LENS.CRITIC,
    credibility: 0.75,
    scope: 'national',
    home_regions: ['Germany'],
    domain: 'weinwisser.com',
    language: 'de',
    grape_affinity: null,
    score_type: 'points',
    score_scale: 100,
    score_format: /\d{2,3}/,
    query_template: '{wine} {vintage} site:weinwisser.com',
    examples: ['93', '90', '95'],
    normalise: normalise100Point
  },

  // ===========================================================================
  // CRITICS - South America
  // ===========================================================================
  descorchados: {
    name: 'Descorchados',
    short_name: 'Descorchados',
    lens: LENS.CRITIC,
    credibility: 0.80,
    scope: 'regional',
    home_regions: ['Chile', 'Argentina'],
    domain: 'descorchados.com',
    language: 'es',
    grape_affinity: null,
    score_type: 'points',
    score_scale: 100,
    score_format: /\d{2,3}/,
    query_template: '{wine} {vintage} Descorchados puntos',
    examples: ['92', '88', '95'],
    normalise: normalise100Point
  },

  // ===========================================================================
  // CRITICS - Global
  // ===========================================================================
  wine_advocate: {
    name: 'Wine Advocate / Robert Parker',
    short_name: 'Wine Advocate',
    lens: LENS.CRITIC,
    credibility: 0.75,
    scope: 'global',
    home_regions: [],
    domain: 'robertparker.com',
    alt_domains: ['erobertparker.com', 'wineadvocate.com'],
    language: 'en',
    grape_affinity: null,
    score_type: 'points',
    score_scale: 100,
    score_format: /\d{2,3}\+?/,
    query_template: '{wine} {vintage} Wine Advocate OR Robert Parker points',
    examples: ['92', '95+', '88-90', '96-98'],
    normalise: normalise100Point,
    paywalled: true,
    snippet_extraction: true,
    notes: 'Benchmark for Bordeaux, Napa, Rhône. Scores often in snippets.'
  },

  wine_spectator: {
    name: 'Wine Spectator',
    short_name: 'Wine Spectator',
    lens: LENS.CRITIC,
    credibility: 0.70,
    scope: 'global',
    home_regions: [],
    domain: 'winespectator.com',
    language: 'en',
    grape_affinity: null,
    score_type: 'points',
    score_scale: 100,
    score_format: /\d{2,3}/,
    query_template: '{wine} {vintage} site:winespectator.com',
    examples: ['92', '88', '95'],
    normalise: normalise100Point,
    paywalled: true,
    snippet_extraction: true,
    notes: 'US market influence. Top 100 lists.'
  },

  james_suckling: {
    name: 'James Suckling',
    short_name: 'Suckling',
    lens: LENS.CRITIC,
    credibility: 0.65,
    scope: 'global',
    home_regions: [],
    domain: 'jamessuckling.com',
    language: 'en',
    grape_affinity: null,
    score_type: 'points',
    score_scale: 100,
    score_format: /\d{2,3}/,
    query_template: '{wine} {vintage} site:jamessuckling.com',
    examples: ['94', '91', '97'],
    normalise: normalise100Point,
    paywalled: false,
    snippet_extraction: true,
    notes: 'High volume, global coverage. Often in snippets.'
  },

  jancis_robinson: {
    name: 'Jancis Robinson',
    short_name: 'Jancis Robinson',
    lens: LENS.CRITIC,
    credibility: 0.80,
    scope: 'global',
    home_regions: [],
    domain: 'jancisrobinson.com',
    language: 'en',
    grape_affinity: null,
    score_type: 'points',
    score_scale: 20,
    score_format: /\d{1,2}(?:\.\d)?\/20/,
    query_template: '{wine} {vintage} site:jancisrobinson.com',
    examples: ['17/20', '16.5', '18.5/20', '15.5'],
    normalise: normalise20Point,
    paywalled: true,
    snippet_extraction: true,
    notes: '20-point scale. Global authority, especially Burgundy.'
  },

  decanter_magazine: {
    name: 'Decanter Magazine',
    short_name: 'Decanter Mag',
    lens: LENS.CRITIC,
    credibility: 0.75,
    scope: 'global',
    home_regions: [],
    domain: 'decanter.com',
    language: 'en',
    grape_affinity: null,
    score_type: 'points',
    score_scale: 100,
    score_format: /\d{2,3}/,
    query_template: '{wine} {vintage} site:decanter.com review',
    examples: ['92', '89', '95'],
    normalise: normalise100Point
  },

  wine_enthusiast: {
    name: 'Wine Enthusiast',
    short_name: 'Wine Enthusiast',
    lens: LENS.CRITIC,
    credibility: 0.70,
    scope: 'global',
    home_regions: [],
    domain: 'winemag.com',
    language: 'en',
    grape_affinity: null,
    score_type: 'points',
    score_scale: 100,
    score_format: /\d{2,3}/,
    query_template: '{wine} {vintage} site:winemag.com',
    examples: ['90', '87', '93'],
    normalise: normalise100Point
  },

  natalie_maclean: {
    name: 'Natalie MacLean',
    short_name: 'N. MacLean',
    lens: LENS.CRITIC,
    credibility: 0.60,
    scope: 'global',
    home_regions: ['Canada'],
    domain: 'nataliemaclean.com',
    language: 'en',
    grape_affinity: null,
    score_type: 'points',
    score_scale: 100,
    score_format: /\d{2,3}/,
    query_template: '{wine} {vintage} site:nataliemaclean.com',
    examples: ['90', '87', '93'],
    normalise: normalise100Point
  },

  // ===========================================================================
  // COMMUNITY
  // ===========================================================================
  cellar_tracker: {
    name: 'CellarTracker',
    short_name: 'CellarTracker',
    lens: LENS.COMMUNITY,
    credibility: 0.55,
    scope: 'global',
    home_regions: [],
    domain: 'cellartracker.com',
    language: 'en',
    grape_affinity: null,
    score_type: 'points',
    score_scale: 100,
    score_format: /CT\d{2,3}|\d{2,3}(?:\.\d)?/,
    query_template: '{wine} {vintage} site:cellartracker.com',
    examples: ['CT89', '91', '87.5'],
    normalise: (raw) => {
      const match = raw.match(/(\d{2,3}(?:\.\d)?)/);
      return match ? Math.round(parseFloat(match[1])) : null;
    }
  },

  wine_align: {
    name: 'WineAlign',
    short_name: 'WineAlign',
    lens: LENS.COMMUNITY,
    credibility: 0.60,
    scope: 'global',
    home_regions: ['Canada'],
    domain: 'winealign.com',
    language: 'en',
    grape_affinity: null,
    score_type: 'points',
    score_scale: 100,
    score_format: /\d{2,3}/,
    query_template: '{wine} {vintage} site:winealign.com',
    examples: ['90', '87', '93'],
    normalise: normalise100Point
  },

  vivino: {
    name: 'Vivino',
    short_name: 'Vivino',
    lens: LENS.COMMUNITY,
    credibility: 0.50,
    scope: 'global',
    home_regions: [],
    domain: 'vivino.com',
    language: 'en',
    grape_affinity: null,
    score_type: 'stars',
    score_scale: 5,
    score_format: /\d(?:\.\d)?\s*stars?/i,
    query_template: '{wine} {vintage} site:vivino.com',
    examples: ['4.2', '3.8', '4.5/5', '4.1 stars'],
    normalise: (raw) => {
      const match = raw.match(/(\d(?:\.\d)?)/);
      if (match) {
        const rating = parseFloat(match[1]);
        return rating <= 5 ? Math.round(rating * 20) : rating;
      }
      return null;
    },
    min_ratings_for_confidence: 100,
    stars_conversion: {
      4.5: { min: 92, max: 100 },
      4.2: { min: 88, max: 91 },
      4.0: { min: 85, max: 87 },
      3.7: { min: 82, max: 84 },
      3.4: { min: 78, max: 81 },
      3.0: { min: 74, max: 77 },
      2.5: { min: 70, max: 73 },
      2.0: { min: 60, max: 69 }
    }
  },

  // ===========================================================================
  // AGGREGATORS
  // ===========================================================================
  wine_searcher: {
    name: 'Wine-Searcher',
    short_name: 'Wine-Searcher',
    lens: LENS.AGGREGATOR,
    credibility: 0.85,
    scope: 'global',
    home_regions: [],
    domain: 'wine-searcher.com',
    language: 'en',
    grape_affinity: null,
    score_type: 'aggregated',
    is_aggregator: true,
    aggregates_sources: [
      'wine_advocate', 'wine_spectator', 'jancis_robinson', 'james_suckling',
      'vinous', 'decanter', 'wine_enthusiast', 'falstaff', 'guia_penin', 'halliday'
    ],
    query_template: '"{wine}" {vintage} site:wine-searcher.com "critic score" OR "points"',
    notes: 'Best global coverage. Aggregates 30+ critic sources.'
  },

  dan_murphys: {
    name: "Dan Murphy's",
    short_name: "Dan Murphy's",
    lens: LENS.AGGREGATOR,
    credibility: 0.80,
    scope: 'national',
    home_regions: ['Australia'],
    domain: 'danmurphys.com.au',
    language: 'en',
    grape_affinity: null,
    score_type: 'aggregated',
    is_aggregator: true,
    aggregates_sources: ['halliday', 'huon_hooke', 'wine_orbit', 'decanter'],
    query_template: '{wine} {vintage} site:danmurphys.com.au',
    notes: "Australia's largest wine retailer. Shows Halliday, Campbell, Hooke scores."
  },

  bodeboca: {
    name: 'Bodeboca',
    short_name: 'Bodeboca',
    lens: LENS.AGGREGATOR,
    credibility: 0.80,
    scope: 'national',
    home_regions: ['Spain'],
    domain: 'bodeboca.com',
    language: 'es',
    grape_affinity: null,
    score_type: 'aggregated',
    is_aggregator: true,
    aggregates_sources: ['guia_penin', 'wine_advocate', 'james_suckling', 'decanter'],
    query_template: '{wine} {vintage} site:bodeboca.com',
    notes: "Spain's largest online retailer. Shows Peñín, Parker, Suckling scores."
  },

  wine_co_za: {
    name: 'Wine.co.za',
    short_name: 'Wine.co.za',
    lens: LENS.AGGREGATOR,
    credibility: 0.85,
    scope: 'national',
    home_regions: ['South Africa'],
    domain: 'wine.co.za',
    language: 'en',
    grape_affinity: null,
    score_type: 'aggregated',
    is_aggregator: true,
    aggregates_sources: ['platters', 'tim_atkin', 'decanter', 'veritas', 'iwc', 'iwsc'],
    query_template: '{wine} {vintage} site:wine.co.za',
    notes: 'SA wine info site. Shows Platters, Tim Atkin, DWWA scores.'
  },

  bbr: {
    name: 'Berry Bros & Rudd',
    short_name: 'BBR',
    lens: LENS.AGGREGATOR,
    credibility: 0.85,
    scope: 'global',
    home_regions: [],
    domain: 'bbr.com',
    language: 'en',
    grape_affinity: null,
    score_type: 'aggregated',
    is_aggregator: true,
    aggregates_sources: ['wine_advocate', 'jancis_robinson', 'vinous', 'decanter', 'wine_spectator'],
    query_template: '{wine} {vintage} site:bbr.com',
    notes: 'Oldest wine merchant. Curates critic scores for fine wine.'
  },

  // Taste Atlas - Global food and wine aggregator
  // Excellent for competition medal aggregation - includes DWWA, Concours Mondial, etc.
  taste_atlas: {
    name: 'Taste Atlas',
    short_name: 'TasteAtlas',
    lens: LENS.AGGREGATOR,
    credibility: 0.75,
    scope: 'global',
    home_regions: [],
    domain: 'tasteatlas.com',
    language: 'en',
    grape_affinity: null,
    score_type: 'aggregated',
    is_aggregator: true,
    aggregates_sources: ['concours_mondial', 'decanter', 'iwc', 'iwsc', 'mundus_vini'],
    query_template: '{wine} {vintage} site:tasteatlas.com',
    normalise: (raw) => {
      // Taste Atlas aggregates competition medals
      const lower = raw.toLowerCase();
      if (lower.includes('gold')) return 94;
      if (lower.includes('silver')) return 88;
      if (lower.includes('bronze')) return 82;
      return null;
    },
    medal_bands: {
      gold: { min: 94, max: 100, label: 'Gold' },
      silver: { min: 88, max: 93, label: 'Silver' },
      bronze: { min: 82, max: 87, label: 'Bronze' }
    },
    notes: 'Global food/wine aggregator. Aggregates major competition awards and user ratings.'
  },

  // ===========================================================================
  // PRODUCER WEBSITE
  // ===========================================================================
  producer_website: {
    name: 'Producer Website',
    short_name: 'Winery',
    lens: LENS.PRODUCER,
    credibility: 0.70,
    scope: 'global',
    home_regions: [],
    domain: null, // Dynamic - varies per producer
    language: 'en',
    grape_affinity: null,
    score_type: 'cited',
    cites_sources: true,
    normalise: (raw) => {
      const lower = raw.toLowerCase();
      if (lower.includes('gold')) return 94;
      if (lower.includes('silver')) return 88;
      if (lower.includes('bronze')) return 82;
      return null;
    },
    medal_bands: {
      gold: { min: 94, max: 100, label: 'Gold' },
      silver: { min: 88, max: 93, label: 'Silver' },
      bronze: { min: 82, max: 87, label: 'Bronze' }
    },
    notes: 'Winery official website. Look for awards, medals, accolades sections.'
  }
};

// =============================================================================
// REGION TO SOURCE PRIORITY MAPPING
// =============================================================================

/**
 * Region to source priority mapping.
 * Lists preferred sources in priority order for each wine-producing region.
 */
export const REGION_SOURCE_PRIORITY = {
  'Australia': ['halliday', 'huon_hooke', 'gourmet_traveller_wine', 'james_suckling', 'decanter', 'vivino', 'dan_murphys', 'wine_searcher'],
  'New Zealand': ['bob_campbell', 'wine_orbit', 'james_suckling', 'decanter', 'vivino', 'wine_searcher'],
  'Spain': ['guia_penin', 'tim_atkin', 'guia_proensa', 'decanter', 'james_suckling', 'vivino', 'bodeboca', 'wine_searcher'],
  'Chile': ['descorchados', 'tim_atkin', 'vinomanos', 'james_suckling', 'decanter', 'vivino', 'wine_searcher'],
  'Argentina': ['descorchados', 'tim_atkin', 'james_suckling', 'decanter', 'vivino', 'wine_searcher'],
  'Italy': ['gambero_rosso', 'vinous', 'doctor_wine', 'bibenda', 'james_suckling', 'decanter', 'vivino', 'wine_searcher'],
  'France': ['guide_hachette', 'rvf', 'bettane_desseauve', 'jancis_robinson', 'wine_advocate', 'decanter', 'vivino', 'bbr', 'wine_searcher'],
  'South Africa': ['wine_co_za', 'platters', 'tim_atkin', 'veritas', 'old_mutual', 'decanter', 'vivino', 'wine_searcher'],
  'USA': ['wine_spectator', 'wine_enthusiast', 'vinous', 'wine_advocate', 'james_suckling', 'decanter', 'vivino', 'wine_searcher'],
  'Germany': ['falstaff', 'weinwisser', 'vinum', 'jancis_robinson', 'decanter', 'vivino', 'wine_searcher'],
  'Austria': ['falstaff', 'vinum', 'decanter', 'vivino', 'wine_searcher'],
  'Portugal': ['revista_vinhos', 'jancis_robinson', 'tim_atkin', 'decanter', 'vivino', 'wine_searcher'],
  'Greece': ['elloinos', 'decanter', 'vivino', 'wine_searcher'],
  'Switzerland': ['vinum', 'falstaff', 'decanter', 'vivino', 'wine_searcher'],
  '_default': ['decanter', 'wine_enthusiast', 'james_suckling', 'tim_atkin', 'vivino', 'taste_atlas', 'cellar_tracker', 'wine_searcher'],
  '_premium': ['wine_advocate', 'jancis_robinson', 'vinous', 'wine_spectator', 'james_suckling', 'tim_atkin']
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get source configuration by ID.
 * @param {string} sourceId - Source identifier
 * @returns {Object|null} Source configuration or null
 */
export function getSource(sourceId) {
  return SOURCES[sourceId] || null;
}

/**
 * Get all sources for a given lens.
 * @param {string} lens - Lens type
 * @returns {Array} Array of source configs with IDs
 */
export function getSourcesByLens(lens) {
  return Object.entries(SOURCES)
    .filter(([, config]) => config.lens === lens)
    .map(([id, config]) => ({ id, ...config }));
}

/**
 * Get all sources for display category.
 * Maps panel_guide and critic both to "critics" category.
 * @param {string} displayLens - Display lens (competition, critics, community)
 * @returns {Array} Array of source configs with IDs
 */
export function getSourcesByDisplayLens(displayLens) {
  return Object.entries(SOURCES)
    .filter(([, config]) => {
      const mappedLens = LENS_DISPLAY_MAP[config.lens] || config.lens;
      return mappedLens === displayLens;
    })
    .map(([id, config]) => ({ id, ...config }));
}

/**
 * Get sources relevant for a given country.
 * @param {string} country - Wine's country of origin
 * @returns {Object[]} Sorted array of source configs with relevance scores
 */
export function getSourcesForCountry(country) {
  const sources = [];
  const countryKnown = country && country.toLowerCase() !== 'unknown' && country.trim() !== '';

  for (const [id, config] of Object.entries(SOURCES)) {
    let relevance;

    if (config.home_regions.length === 0) {
      relevance = 1.0;
    } else if (countryKnown && config.home_regions.includes(country)) {
      relevance = 1.0;
    } else if (countryKnown) {
      relevance = 0.1;
    } else {
      relevance = 0.5;
    }

    const lensCredibility = LENS_CREDIBILITY[config.lens] || 1.0;
    const score = lensCredibility * relevance * config.credibility;

    sources.push({
      id,
      ...config,
      relevance,
      lensCredibility,
      score
    });
  }

  return sources.sort((a, b) => b.score - a.score);
}

/**
 * Get domains to search for a given country.
 * @param {string} country - Wine's country of origin
 * @returns {string[]} Array of domains
 */
export function getDomainsForCountry(country) {
  const sources = getSourcesForCountry(country);
  const domains = new Set();

  for (const source of sources) {
    if (source.relevance >= 0.3 && source.domain) {
      domains.add(source.domain);
      if (source.alt_domains) {
        source.alt_domains.forEach(d => domains.add(d));
      }
    }
  }

  return Array.from(domains);
}

/**
 * Get score format info for prompt building.
 * @param {string[]} sourceIds - Array of source identifiers
 * @returns {Object[]} Array of relevant score formats
 */
export function getScoreFormatsForSources(sourceIds) {
  return sourceIds
    .map(id => {
      const source = SOURCES[id];
      if (source) {
        return {
          id,
          name: source.name,
          type: source.score_type,
          scale: source.score_scale,
          examples: source.examples || []
        };
      }
      return null;
    })
    .filter(Boolean);
}

/**
 * Build prompt instructions for score extraction.
 * @param {string[]} sourceIds - Source identifiers found in search
 * @returns {string} Prompt text for score extraction
 */
export function buildScoreFormatPrompt(sourceIds) {
  const formats = getScoreFormatsForSources(sourceIds);
  if (formats.length === 0) return '';

  return `
Score formats to recognise:
${formats.map(f => `- ${f.name}: ${f.examples.join(', ')}`).join('\n')}
`;
}

export default SOURCES;
