/**
 * @fileoverview Wine rating source registry with geographic and quality metadata.
 * @module config/sourceRegistry
 */

/**
 * Source lenses (methodology categories).
 */
export const LENS = {
  COMPETITION: 'competition',
  PANEL_GUIDE: 'panel_guide',
  CRITIC: 'critic',
  COMMUNITY: 'community'
};

/**
 * Credibility weights by lens.
 * Higher = more trusted for purchase decisions.
 */
export const LENS_CREDIBILITY = {
  [LENS.COMPETITION]: 3.0,
  [LENS.PANEL_GUIDE]: 2.5,
  [LENS.CRITIC]: 1.5,
  [LENS.COMMUNITY]: 1.0
};

/**
 * Region to source priority mapping.
 * Lists preferred sources in priority order for each wine-producing region.
 * Includes premium critics as secondary sources for major regions.
 */
export const REGION_SOURCE_PRIORITY = {
  'Australia': ['halliday', 'huon_hooke', 'gourmet_traveller_wine', 'james_suckling', 'decanter', 'vivino'],
  'New Zealand': ['bob_campbell', 'wine_orbit', 'james_suckling', 'decanter', 'vivino'],
  'Spain': ['guia_penin', 'guia_proensa', 'decanter', 'tim_atkin', 'james_suckling', 'vivino'],
  'Chile': ['descorchados', 'vinomanos', 'tim_atkin', 'james_suckling', 'decanter', 'vivino'],
  'Argentina': ['descorchados', 'tim_atkin', 'james_suckling', 'decanter', 'vivino'],
  'Italy': ['gambero_rosso', 'vinous', 'doctor_wine', 'bibenda', 'james_suckling', 'decanter', 'vivino'],
  'France': ['guide_hachette', 'rvf', 'bettane_desseauve', 'jancis_robinson', 'wine_advocate', 'decanter', 'vivino'],
  'South Africa': ['platters', 'tim_atkin', 'veritas', 'old_mutual', 'vivino'],
  'USA': ['wine_spectator', 'wine_enthusiast', 'vinous', 'wine_advocate', 'james_suckling', 'decanter', 'vivino'],
  'Germany': ['falstaff', 'weinwisser', 'vinum', 'jancis_robinson', 'decanter', 'vivino'],
  'Austria': ['falstaff', 'vinum', 'decanter', 'vivino'],
  'Portugal': ['revista_vinhos', 'jancis_robinson', 'decanter', 'vivino'],
  'Greece': ['elloinos', 'decanter', 'vivino'],
  'Switzerland': ['vinum', 'falstaff', 'decanter', 'vivino'],
  '_default': ['decanter', 'wine_enthusiast', 'james_suckling', 'vivino', 'cellar_tracker'],
  // Premium tier wines get extra critic coverage regardless of region
  '_premium': ['wine_advocate', 'jancis_robinson', 'vinous', 'wine_spectator', 'james_suckling']
};

/**
 * Master source registry.
 * Each source has metadata for search planning and result weighting.
 *
 * Schema fields:
 * - id: unique identifier (object key)
 * - name: full display name
 * - short_name: abbreviated name for UI
 * - lens: 'competition' | 'panel_guide' | 'critic' | 'community'
 * - domain: primary website domain
 * - alt_domains: alternative domains (optional)
 * - home_regions: countries where this source is authoritative (empty = global)
 * - language: primary language ('en' | 'es' | 'it' | 'fr' | 'de')
 * - grape_affinity: grape varieties this source specializes in (null = all)
 * - score_type: 'points' | 'stars' | 'medal' | 'symbol'
 * - score_format: regex pattern for extracting scores (optional)
 * - query_template: search query template
 */
export const SOURCE_REGISTRY = {
  // ============================================
  // COMPETITIONS (lens: competition, credibility: 3.0)
  // ============================================

  // Global competitions
  decanter: {
    name: 'Decanter World Wine Awards',
    short_name: 'DWWA',
    lens: LENS.COMPETITION,
    domain: 'decanter.com',
    home_regions: [],
    language: 'en',
    grape_affinity: null,
    score_type: 'medal',
    score_format: 'Platinum|Gold|Silver|Bronze|Commended',
    query_template: '{wine} {vintage} site:decanter.com award medal',
    medal_bands: {
      platinum: { min: 97, max: 100 },
      gold: { min: 95, max: 96 },
      silver: { min: 90, max: 94 },
      bronze: { min: 86, max: 89 },
      commended: { min: 83, max: 85 }
    }
  },

  iwc: {
    name: 'International Wine Challenge',
    short_name: 'IWC',
    lens: LENS.COMPETITION,
    domain: 'internationalwinechallenge.com',
    home_regions: [],
    language: 'en',
    grape_affinity: null,
    score_type: 'medal',
    score_format: 'Trophy|Gold|Silver|Bronze|Commended',
    query_template: '{wine} {vintage} site:internationalwinechallenge.com',
    medal_bands: {
      trophy: { min: 97, max: 100 },
      gold: { min: 95, max: 100 },
      silver: { min: 90, max: 94 },
      bronze: { min: 85, max: 89 }
    }
  },

  iwsc: {
    name: 'International Wine & Spirit Competition',
    short_name: 'IWSC',
    lens: LENS.COMPETITION,
    domain: 'iwsc.net',
    home_regions: [],
    language: 'en',
    grape_affinity: null,
    score_type: 'medal',
    score_format: 'Gold Outstanding|Gold|Silver|Bronze',
    query_template: '{wine} {vintage} site:iwsc.net',
    medal_bands: {
      gold_outstanding: { min: 98, max: 100 },
      gold: { min: 95, max: 97 },
      silver: { min: 90, max: 94 },
      bronze: { min: 85, max: 89 }
    }
  },

  concours_mondial: {
    name: 'Concours Mondial de Bruxelles',
    short_name: 'CMB',
    lens: LENS.COMPETITION,
    domain: 'concoursmondial.com',
    home_regions: [],
    language: 'en',
    grape_affinity: null,
    score_type: 'medal',
    score_format: 'Grand Gold|Gold|Silver',
    query_template: '{wine} {vintage} site:concoursmondial.com',
    medal_bands: {
      grand_gold: { min: 92, max: 100 },
      gold: { min: 85, max: 91 },
      silver: { min: 82, max: 84 }
    }
  },

  mundus_vini: {
    name: 'Mundus Vini',
    short_name: 'Mundus Vini',
    lens: LENS.COMPETITION,
    domain: 'mundusvini.com',
    home_regions: [],
    language: 'en',
    grape_affinity: null,
    score_type: 'medal',
    score_format: 'Grand Gold|Gold|Silver',
    query_template: '{wine} {vintage} site:mundusvini.com',
    medal_bands: {
      grand_gold: { min: 95, max: 100 },
      gold: { min: 90, max: 94 },
      silver: { min: 85, max: 89 }
    }
  },

  // Grape-specific competitions
  chardonnay_du_monde: {
    name: 'Chardonnay du Monde',
    short_name: 'Chardonnay du Monde',
    lens: LENS.COMPETITION,
    domain: 'chardonnay-du-monde.com',
    home_regions: [],
    language: 'fr',
    grape_affinity: ['chardonnay'],
    score_type: 'medal',
    score_format: 'Grand Gold|Gold|Silver|Bronze',
    query_template: '{wine} {vintage} Chardonnay du Monde'
  },

  syrah_du_monde: {
    name: 'Syrah du Monde',
    short_name: 'Syrah du Monde',
    lens: LENS.COMPETITION,
    domain: 'syrahdumonde.com',
    home_regions: [],
    language: 'fr',
    grape_affinity: ['syrah', 'shiraz'],
    score_type: 'medal',
    score_format: 'Grand Gold|Gold|Silver|Bronze',
    query_template: '{wine} {vintage} Syrah du Monde'
  },

  grenaches_du_monde: {
    name: 'Grenaches du Monde',
    short_name: 'Grenaches du Monde',
    lens: LENS.COMPETITION,
    domain: 'grenachesdumonde.com',
    home_regions: [],
    language: 'fr',
    grape_affinity: ['grenache', 'garnacha'],
    score_type: 'medal',
    score_format: 'Grand Gold|Gold|Silver|Bronze',
    query_template: '{wine} {vintage} Grenaches du Monde'
  },

  // Regional competitions
  veritas: {
    name: 'Veritas Awards',
    short_name: 'Veritas',
    lens: LENS.COMPETITION,
    domain: 'veritas.co.za',
    home_regions: ['South Africa'],
    language: 'en',
    grape_affinity: null,
    score_type: 'medal',
    score_format: 'Double Gold|Gold|Silver|Bronze',
    query_template: '{wine} {vintage} Veritas award',
    medal_bands: {
      double_gold: { min: 95, max: 100 },
      gold: { min: 90, max: 94 },
      silver: { min: 85, max: 89 },
      bronze: { min: 80, max: 84 }
    }
  },

  old_mutual: {
    name: 'Old Mutual Trophy Wine Show',
    short_name: 'Old Mutual',
    lens: LENS.COMPETITION,
    domain: 'trophywineshow.co.za',
    home_regions: ['South Africa'],
    language: 'en',
    grape_affinity: null,
    score_type: 'medal',
    score_format: 'Trophy|Gold|Silver|Bronze',
    query_template: '{wine} {vintage} Old Mutual Trophy',
    medal_bands: {
      trophy: { min: 95, max: 100 },
      gold: { min: 90, max: 94 },
      silver: { min: 85, max: 89 },
      bronze: { min: 80, max: 84 }
    }
  },

  // ============================================
  // PANEL GUIDES (lens: panel_guide, credibility: 2.5)
  // ============================================

  // South Africa
  platters: {
    name: "Platter's Wine Guide",
    short_name: "Platter's",
    lens: LENS.PANEL_GUIDE,
    domain: 'wineonaplatter.com',
    alt_domains: ['platterwineguide.com'],
    home_regions: ['South Africa'],
    language: 'en',
    grape_affinity: null,
    score_type: 'stars',
    score_format: '\\d(\\.5)?\\s*stars?',
    query_template: "{wine} {vintage} Platter's stars rating",
    stars_to_points: {
      5: 95, 4.5: 90, 4: 85, 3.5: 80, 3: 75
    }
  },

  // Australia
  halliday: {
    name: 'Halliday Wine Companion',
    short_name: 'Halliday',
    lens: LENS.CRITIC,
    domain: 'winecompanion.com.au',
    home_regions: ['Australia'],
    language: 'en',
    grape_affinity: null,
    score_type: 'points',
    score_format: '\\d{2,3}\\s*points?',
    query_template: '{wine} {vintage} site:winecompanion.com.au'
  },

  huon_hooke: {
    name: 'Huon Hooke',
    short_name: 'Huon Hooke',
    lens: LENS.CRITIC,
    domain: 'huonhooke.com',
    home_regions: ['Australia'],
    language: 'en',
    grape_affinity: null,
    score_type: 'points',
    score_format: '\\d{2}(\\.\\d)?/100',
    query_template: '{wine} {vintage} site:huonhooke.com'
  },

  gourmet_traveller_wine: {
    name: 'Gourmet Traveller Wine',
    short_name: 'GT Wine',
    lens: LENS.PANEL_GUIDE,
    domain: 'gourmettravellerwine.com.au',
    home_regions: ['Australia'],
    language: 'en',
    grape_affinity: null,
    score_type: 'points',
    score_format: '\\d{2,3}',
    query_template: '{wine} {vintage} site:gourmettravellerwine.com.au'
  },

  // New Zealand
  bob_campbell: {
    name: 'Bob Campbell MW',
    short_name: 'Bob Campbell',
    lens: LENS.CRITIC,
    domain: 'bobcampbell.nz',
    home_regions: ['New Zealand'],
    language: 'en',
    grape_affinity: null,
    score_type: 'points',
    score_format: '\\d{2,3}',
    query_template: '{wine} {vintage} site:bobcampbell.nz'
  },

  wine_orbit: {
    name: 'Wine Orbit',
    short_name: 'Wine Orbit',
    lens: LENS.CRITIC,
    domain: 'wineorbit.co.nz',
    home_regions: ['New Zealand'],
    language: 'en',
    grape_affinity: null,
    score_type: 'points',
    score_format: '\\d{2,3}',
    query_template: '{wine} {vintage} site:wineorbit.co.nz'
  },

  // Spain
  guia_penin: {
    name: 'Guía Peñín',
    short_name: 'Peñín',
    lens: LENS.PANEL_GUIDE,
    domain: 'guiapenin.com',
    home_regions: ['Spain'],
    language: 'es',
    grape_affinity: null,
    score_type: 'points',
    score_format: '\\d{2,3}\\s*(puntos)?',
    query_template: '{wine} {vintage} Guía Peñín puntos'
  },

  guia_proensa: {
    name: 'Guía Proensa',
    short_name: 'Proensa',
    lens: LENS.CRITIC,
    domain: 'guiaproensa.com',
    home_regions: ['Spain'],
    language: 'es',
    grape_affinity: null,
    score_type: 'points',
    score_format: '\\d{2,3}',
    query_template: '{wine} {vintage} Guía Proensa'
  },

  // Italy
  gambero_rosso: {
    name: 'Gambero Rosso',
    short_name: 'Gambero Rosso',
    lens: LENS.PANEL_GUIDE,
    domain: 'gamberorosso.it',
    home_regions: ['Italy'],
    language: 'it',
    grape_affinity: null,
    score_type: 'symbol',
    score_format: 'Tre Bicchieri|Due Bicchieri Rossi|Due Bicchieri|Un Bicchiere',
    query_template: '{wine} {vintage} Gambero Rosso bicchieri'
  },

  doctor_wine: {
    name: 'Doctor Wine',
    short_name: 'Doctor Wine',
    lens: LENS.CRITIC,
    domain: 'doctorwine.it',
    home_regions: ['Italy'],
    language: 'it',
    grape_affinity: null,
    score_type: 'points',
    score_format: '\\d{2,3}',
    query_template: '{wine} {vintage} site:doctorwine.it'
  },

  bibenda: {
    name: 'Bibenda',
    short_name: 'Bibenda',
    lens: LENS.PANEL_GUIDE,
    domain: 'bibenda.it',
    home_regions: ['Italy'],
    language: 'it',
    grape_affinity: null,
    score_type: 'symbol',
    score_format: '[1-5]\\s*grappoli|cinque grappoli|quattro grappoli',
    query_template: '{wine} {vintage} Bibenda grappoli'
  },

  vinous: {
    name: 'Vinous (Antonio Galloni)',
    short_name: 'Vinous',
    lens: LENS.CRITIC,
    domain: 'vinous.com',
    home_regions: ['Italy', 'USA', 'France'],
    language: 'en',
    grape_affinity: null,
    score_type: 'points',
    score_format: '\\d{2,3}\\+?',
    paywalled: true,
    snippet_extraction: true,
    query_template: '{wine} {vintage} site:vinous.com',
    notes: 'Italian specialist, ex-Parker reviewer. Scores often in snippets.'
  },

  // France
  guide_hachette: {
    name: 'Guide Hachette',
    short_name: 'Hachette',
    lens: LENS.PANEL_GUIDE,
    domain: 'hachette-vins.com',
    home_regions: ['France'],
    language: 'fr',
    grape_affinity: null,
    score_type: 'symbol',
    score_format: '★{1,3}|Coup de C[oœ]ur',
    query_template: '{wine} {vintage} Guide Hachette'
  },

  rvf: {
    name: 'Revue du Vin de France',
    short_name: 'RVF',
    lens: LENS.PANEL_GUIDE,
    domain: 'larvf.com',
    home_regions: ['France'],
    language: 'fr',
    grape_affinity: null,
    score_type: 'points',
    score_format: '\\d{1,2}/20|\\d{2,3}/100',
    query_template: '{wine} {vintage} Revue du Vin de France'
  },

  bettane_desseauve: {
    name: 'Bettane+Desseauve',
    short_name: 'B+D',
    lens: LENS.PANEL_GUIDE,
    domain: 'mybettanedesseauve.fr',
    home_regions: ['France'],
    language: 'fr',
    grape_affinity: null,
    score_type: 'points',
    score_format: '\\d{1,2}/20|\\d{2,3}',
    query_template: '{wine} {vintage} Bettane Desseauve'
  },

  // Germany / Austria
  falstaff: {
    name: 'Falstaff',
    short_name: 'Falstaff',
    lens: LENS.PANEL_GUIDE,
    domain: 'falstaff.com',
    home_regions: ['Germany', 'Austria'],
    language: 'de',
    grape_affinity: null,
    score_type: 'points',
    score_format: '\\d{2,3}',
    query_template: '{wine} {vintage} site:falstaff.com'
  },

  weinwisser: {
    name: 'Weinwisser',
    short_name: 'Weinwisser',
    lens: LENS.CRITIC,
    domain: 'weinwisser.com',
    home_regions: ['Germany'],
    language: 'de',
    grape_affinity: null,
    score_type: 'points',
    score_format: '\\d{2,3}',
    query_template: '{wine} {vintage} site:weinwisser.com'
  },

  vinum: {
    name: 'Vinum',
    short_name: 'Vinum',
    lens: LENS.PANEL_GUIDE,
    domain: 'vinum.eu',
    home_regions: ['Switzerland', 'Germany', 'Austria'],
    language: 'de',
    grape_affinity: null,
    score_type: 'points',
    score_format: '\\d{1,2}/20|\\d{2,3}',
    points_scale: 20,
    query_template: '{wine} {vintage} Vinum'
  },

  // Portugal
  revista_vinhos: {
    name: 'Revista de Vinhos',
    short_name: 'Revista Vinhos',
    lens: LENS.PANEL_GUIDE,
    domain: 'revistadevinhos.pt',
    home_regions: ['Portugal'],
    language: 'pt',
    grape_affinity: null,
    score_type: 'points',
    score_format: '\\d{2,3}',
    query_template: '{wine} {vintage} Revista de Vinhos'
  },

  // Greece
  elloinos: {
    name: 'Elloinos',
    short_name: 'Elloinos',
    lens: LENS.PANEL_GUIDE,
    domain: 'elloinos.com',
    home_regions: ['Greece'],
    language: 'el',
    grape_affinity: null,
    score_type: 'points',
    score_format: '\\d{2,3}',
    query_template: '{wine} {vintage} Elloinos'
  },

  // ============================================
  // CRITICS (lens: critic, credibility: 1.5)
  // ============================================

  tim_atkin: {
    name: 'Tim Atkin MW',
    short_name: 'Tim Atkin',
    lens: LENS.CRITIC,
    domain: 'timatkin.com',
    home_regions: ['South Africa', 'Argentina'],
    language: 'en',
    grape_affinity: null,
    score_type: 'points',
    score_format: '\\d{2,3}',
    query_template: '{wine} {vintage} site:timatkin.com'
  },

  jancis_robinson: {
    name: 'Jancis Robinson',
    short_name: 'Jancis Robinson',
    lens: LENS.CRITIC,
    domain: 'jancisrobinson.com',
    home_regions: [],
    language: 'en',
    grape_affinity: null,
    score_type: 'points',
    score_format: '\\d{1,2}(\\.\\d)?/20',
    points_scale: 20,
    paywalled: true,
    snippet_extraction: true,
    query_template: '{wine} {vintage} site:jancisrobinson.com',
    notes: '20-point scale. Global authority, especially Burgundy.'
  },

  wine_advocate: {
    name: 'Wine Advocate / Robert Parker',
    short_name: 'Wine Advocate',
    lens: LENS.CRITIC,
    domain: 'robertparker.com',
    alt_domains: ['erobertparker.com', 'wineadvocate.com'],
    home_regions: [],
    language: 'en',
    grape_affinity: null,
    score_type: 'points',
    score_format: '\\d{2,3}\\+?',
    paywalled: true,
    snippet_extraction: true,
    query_template: '{wine} {vintage} Wine Advocate OR Robert Parker points',
    notes: 'Benchmark for Bordeaux, Napa, Rhône. Scores often in snippets.'
  },

  wine_spectator: {
    name: 'Wine Spectator',
    short_name: 'Wine Spectator',
    lens: LENS.CRITIC,
    domain: 'winespectator.com',
    home_regions: [],
    language: 'en',
    grape_affinity: null,
    score_type: 'points',
    score_format: '\\d{2,3}',
    paywalled: true,
    snippet_extraction: true,
    query_template: '{wine} {vintage} site:winespectator.com',
    notes: 'US market influence. Top 100 lists.'
  },

  james_suckling: {
    name: 'James Suckling',
    short_name: 'Suckling',
    lens: LENS.CRITIC,
    domain: 'jamessuckling.com',
    home_regions: [],
    language: 'en',
    grape_affinity: null,
    score_type: 'points',
    score_format: '\\d{2,3}',
    paywalled: false,
    snippet_extraction: true,
    query_template: '{wine} {vintage} site:jamessuckling.com',
    notes: 'High volume, global coverage. Often in snippets.'
  },

  descorchados: {
    name: 'Descorchados',
    short_name: 'Descorchados',
    lens: LENS.CRITIC,
    domain: 'descorchados.com',
    home_regions: ['Chile', 'Argentina'],
    language: 'es',
    grape_affinity: null,
    score_type: 'points',
    score_format: '\\d{2,3}',
    query_template: '{wine} {vintage} Descorchados puntos'
  },

  vinomanos: {
    name: 'Vinómanos',
    short_name: 'Vinómanos',
    lens: LENS.PANEL_GUIDE,
    domain: 'vinomanos.com',
    home_regions: ['Chile', 'Argentina'],
    language: 'es',
    grape_affinity: null,
    score_type: 'points',
    score_format: '\\d{2,3}',
    query_template: '{wine} {vintage} Vinómanos'
  },

  decanter_magazine: {
    name: 'Decanter Magazine',
    short_name: 'Decanter Mag',
    lens: LENS.CRITIC,
    domain: 'decanter.com',
    home_regions: [],
    language: 'en',
    grape_affinity: null,
    score_type: 'points',
    score_format: '\\d{2,3}',
    query_template: '{wine} {vintage} site:decanter.com review'
  },

  wine_enthusiast: {
    name: 'Wine Enthusiast',
    short_name: 'Wine Enthusiast',
    lens: LENS.CRITIC,
    domain: 'winemag.com',
    home_regions: [],
    language: 'en',
    grape_affinity: null,
    score_type: 'points',
    score_format: '\\d{2,3}',
    query_template: '{wine} {vintage} site:winemag.com'
  },

  natalie_maclean: {
    name: 'Natalie MacLean',
    short_name: 'N. MacLean',
    lens: LENS.CRITIC,
    domain: 'nataliemaclean.com',
    home_regions: ['Canada'],
    language: 'en',
    grape_affinity: null,
    score_type: 'points',
    score_format: '\\d{2,3}',
    query_template: '{wine} {vintage} site:nataliemaclean.com'
  },

  // ============================================
  // COMMUNITY (lens: community, credibility: 1.0)
  // ============================================

  cellar_tracker: {
    name: 'CellarTracker',
    short_name: 'CellarTracker',
    lens: LENS.COMMUNITY,
    domain: 'cellartracker.com',
    home_regions: [],
    language: 'en',
    grape_affinity: null,
    score_type: 'points',
    score_format: '\\d{2,3}',
    query_template: '{wine} {vintage} site:cellartracker.com'
  },

  wine_align: {
    name: 'WineAlign',
    short_name: 'WineAlign',
    lens: LENS.COMMUNITY,
    domain: 'winealign.com',
    home_regions: ['Canada'],
    language: 'en',
    grape_affinity: null,
    score_type: 'points',
    score_format: '\\d{2,3}',
    query_template: '{wine} {vintage} site:winealign.com'
  },

  vivino: {
    name: 'Vivino',
    short_name: 'Vivino',
    lens: LENS.COMMUNITY,
    domain: 'vivino.com',
    home_regions: [],
    language: 'en',
    grape_affinity: null,
    score_type: 'stars',
    score_format: '\\d(\\.\\d)?\\s*stars?',
    query_template: '{wine} {vintage} site:vivino.com',
    min_ratings_for_confidence: 100,
    stars_to_points: {
      4.5: 92, 4.2: 88, 4.0: 85, 3.7: 82, 3.4: 78, 3.0: 74
    }
  }
};

/**
 * Get sources relevant for a given country.
 * If country unknown, include all sources (regional ones at medium relevance).
 * Returns sources sorted by expected value (credibility × relevance).
 * @param {string} country - Wine's country of origin (can be null/empty)
 * @returns {Object[]} Sorted array of source configs with relevance scores
 */
export function getSourcesForCountry(country) {
  const sources = [];
  const countryKnown = country && country.toLowerCase() !== 'unknown' && country.trim() !== '';

  for (const [id, config] of Object.entries(SOURCE_REGISTRY)) {
    let relevance;

    if (config.home_regions.length === 0) {
      // Global source - always fully relevant
      relevance = 1.0;
    } else if (countryKnown && config.home_regions.includes(country)) {
      // Regional source matching wine's country - fully relevant
      relevance = 1.0;
    } else if (countryKnown) {
      // Regional source NOT matching wine's country - low relevance
      relevance = 0.1;
    } else {
      // Country unknown - include regional sources at medium relevance
      // This ensures we search Tim Atkin, Platter's, etc. even without country
      relevance = 0.5;
    }

    const credibility = LENS_CREDIBILITY[config.lens] || 1.0;
    const score = credibility * relevance;

    sources.push({
      id,
      ...config,
      relevance,
      credibility,
      score
    });
  }

  // Sort by score descending (highest value sources first)
  return sources.sort((a, b) => b.score - a.score);
}

/**
 * Get domains to search for a given country.
 * If country unknown, include regional domains too.
 * @param {string} country - Wine's country of origin
 * @returns {string[]} Array of domains
 */
export function getDomainsForCountry(country) {
  const sources = getSourcesForCountry(country);
  const domains = new Set();

  for (const source of sources) {
    // Include if relevance >= 0.3 (captures unknown country regional sources at 0.5)
    if (source.relevance >= 0.3) {
      domains.add(source.domain);
      if (source.alt_domains) {
        source.alt_domains.forEach(d => domains.add(d));
      }
    }
  }

  return Array.from(domains);
}

/**
 * Get source config by ID.
 * @param {string} sourceId
 * @returns {Object|null}
 */
export function getSourceConfig(sourceId) {
  return SOURCE_REGISTRY[sourceId] || null;
}
