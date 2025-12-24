/**
 * @fileoverview Rating source definitions and configuration.
 * @module config/ratingSources
 */

export const RATING_SOURCES = {
  // COMPETITIONS (lens: competition)
  decanter: {
    name: 'Decanter World Wine Awards',
    short_name: 'DWWA',
    lens: 'competition',
    credibility: 1.0,
    scope: 'global',
    home_regions: [],
    score_type: 'medal',
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
    lens: 'competition',
    credibility: 1.0,
    scope: 'global',
    home_regions: [],
    score_type: 'medal',
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
    lens: 'competition',
    credibility: 1.0,
    scope: 'global',
    home_regions: [],
    score_type: 'medal',
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
    lens: 'competition',
    credibility: 0.95,
    scope: 'global',
    home_regions: [],
    score_type: 'medal',
    medal_bands: {
      grand_gold: { min: 92, max: 100, label: 'Grand Gold' },
      gold: { min: 85, max: 91.9, label: 'Gold' },
      silver: { min: 82, max: 84.9, label: 'Silver' }
    }
  },
  mundus_vini: {
    name: 'Mundus Vini',
    short_name: 'Mundus Vini',
    lens: 'competition',
    credibility: 0.85,
    scope: 'global',
    home_regions: [],
    score_type: 'medal',
    medal_bands: {
      grand_gold: { min: 95, max: 100, label: 'Grand Gold' },
      gold: { min: 90, max: 94, label: 'Gold' },
      silver: { min: 85, max: 89, label: 'Silver' }
    }
  },

  // REGIONAL COMPETITIONS (lens: competition, regional relevance)
  veritas: {
    name: 'Veritas Awards',
    short_name: 'Veritas',
    lens: 'competition',
    credibility: 0.9,
    scope: 'national',
    home_regions: ['South Africa'],
    score_type: 'medal',
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
    lens: 'competition',
    credibility: 0.9,
    scope: 'national',
    home_regions: ['South Africa'],
    score_type: 'medal',
    medal_bands: {
      trophy: { min: 95, max: 100, label: 'Trophy' },
      gold: { min: 90, max: 94, label: 'Gold' },
      silver: { min: 85, max: 89, label: 'Silver' },
      bronze: { min: 80, max: 84, label: 'Bronze' }
    }
  },
  chardonnay_du_monde: {
    name: 'Chardonnay du Monde',
    short_name: 'Chard du Monde',
    lens: 'competition',
    credibility: 0.85,
    scope: 'varietal',
    home_regions: [],
    applicable_styles: ['Chardonnay'],
    score_type: 'medal',
    medal_bands: {
      gold: { min: 92, max: 100, label: 'Gold' },
      silver: { min: 85, max: 91, label: 'Silver' },
      bronze: { min: 80, max: 84, label: 'Bronze' }
    }
  },
  syrah_du_monde: {
    name: 'Syrah du Monde',
    short_name: 'Syrah du Monde',
    lens: 'competition',
    credibility: 0.85,
    scope: 'varietal',
    home_regions: [],
    applicable_styles: ['Syrah', 'Shiraz'],
    score_type: 'medal',
    medal_bands: {
      gold: { min: 92, max: 100, label: 'Gold' },
      silver: { min: 85, max: 91, label: 'Silver' },
      bronze: { min: 80, max: 84, label: 'Bronze' }
    }
  },
  grenaches_du_monde: {
    name: 'Grenaches du Monde',
    short_name: 'Grenaches du Monde',
    lens: 'competition',
    credibility: 0.85,
    scope: 'varietal',
    home_regions: [],
    applicable_styles: ['Grenache', 'Garnacha'],
    score_type: 'medal',
    medal_bands: {
      grand_gold: { min: 95, max: 100, label: 'Grand Gold' },
      gold: { min: 90, max: 94, label: 'Gold' },
      silver: { min: 85, max: 89, label: 'Silver' },
      bronze: { min: 80, max: 84, label: 'Bronze' }
    }
  },

  // ============================================
  // PANEL GUIDES (lens: panel_guide)
  // Regional authorities with panel-based assessment
  // ============================================

  // Australia
  halliday: {
    name: 'Halliday Wine Companion',
    short_name: 'Halliday',
    lens: 'panel_guide',
    credibility: 0.85,
    scope: 'national',
    home_regions: ['Australia'],
    score_type: 'points',
    points_scale: { min: 80, max: 100 }
  },
  gourmet_traveller_wine: {
    name: 'Gourmet Traveller Wine',
    short_name: 'GT Wine',
    lens: 'panel_guide',
    credibility: 0.75,
    scope: 'national',
    home_regions: ['Australia'],
    score_type: 'points',
    points_scale: { min: 80, max: 100 }
  },

  // Spain
  guia_penin: {
    name: 'Guía Peñín',
    short_name: 'Peñín',
    lens: 'panel_guide',
    credibility: 0.85,
    scope: 'national',
    home_regions: ['Spain'],
    score_type: 'points',
    points_scale: { min: 50, max: 100 }
  },

  // Italy
  gambero_rosso: {
    name: 'Gambero Rosso',
    short_name: 'Gambero Rosso',
    lens: 'panel_guide',
    credibility: 0.90,
    scope: 'national',
    home_regions: ['Italy'],
    score_type: 'symbol',
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
    lens: 'panel_guide',
    credibility: 0.80,
    scope: 'national',
    home_regions: ['Italy'],
    score_type: 'symbol',
    symbol_conversion: {
      '5_grappoli': { min: 95, max: 100, label: '5 Grappoli' },
      '4_grappoli': { min: 90, max: 94, label: '4 Grappoli' },
      '3_grappoli': { min: 85, max: 89, label: '3 Grappoli' },
      '2_grappoli': { min: 78, max: 84, label: '2 Grappoli' }
    }
  },

  // France
  guide_hachette: {
    name: 'Guide Hachette des Vins',
    short_name: 'Hachette',
    lens: 'panel_guide',
    credibility: 0.80,
    scope: 'national',
    home_regions: ['France'],
    score_type: 'stars',
    stars_conversion: {
      3: { min: 92, max: 100, label: '3 Stars' },
      2: { min: 85, max: 91, label: '2 Stars' },
      1: { min: 78, max: 84, label: '1 Star' }
    }
  },
  rvf: {
    name: 'Revue du Vin de France',
    short_name: 'RVF',
    lens: 'panel_guide',
    credibility: 0.85,
    scope: 'national',
    home_regions: ['France'],
    score_type: 'points',
    points_scale: { min: 10, max: 20 }  // Uses 20-point scale
  },
  bettane_desseauve: {
    name: 'Bettane+Desseauve',
    short_name: 'B+D',
    lens: 'panel_guide',
    credibility: 0.85,
    scope: 'national',
    home_regions: ['France'],
    score_type: 'points',
    points_scale: { min: 10, max: 20 }  // Uses 20-point scale
  },

  // Germany / Austria / Switzerland
  falstaff: {
    name: 'Falstaff',
    short_name: 'Falstaff',
    lens: 'panel_guide',
    credibility: 0.80,
    scope: 'regional',
    home_regions: ['Germany', 'Austria'],
    score_type: 'points',
    points_scale: { min: 80, max: 100 }
  },
  vinum: {
    name: 'Vinum',
    short_name: 'Vinum',
    lens: 'panel_guide',
    credibility: 0.75,
    scope: 'regional',
    home_regions: ['Switzerland', 'Germany', 'Austria'],
    score_type: 'points',
    points_scale: { min: 10, max: 20 }  // Uses 20-point scale
  },

  // Portugal
  revista_vinhos: {
    name: 'Revista de Vinhos',
    short_name: 'Revista Vinhos',
    lens: 'panel_guide',
    credibility: 0.80,
    scope: 'national',
    home_regions: ['Portugal'],
    score_type: 'points',
    points_scale: { min: 80, max: 100 }
  },

  // Greece
  elloinos: {
    name: 'Elloinos',
    short_name: 'Elloinos',
    lens: 'panel_guide',
    credibility: 0.75,
    scope: 'national',
    home_regions: ['Greece'],
    score_type: 'points',
    points_scale: { min: 80, max: 100 }
  },

  // South America
  vinomanos: {
    name: 'Vinómanos',
    short_name: 'Vinómanos',
    lens: 'panel_guide',
    credibility: 0.75,
    scope: 'regional',
    home_regions: ['Chile', 'Argentina'],
    score_type: 'points',
    points_scale: { min: 80, max: 100 }
  },

  // ============================================
  // CRITICS (lens: critic)
  // Individual critics and publications
  // ============================================

  // South Africa specialists
  tim_atkin: {
    name: 'Tim Atkin MW',
    short_name: 'Tim Atkin',
    lens: 'critic',
    credibility: 0.80,
    scope: 'regional',
    home_regions: ['South Africa', 'Argentina'],
    score_type: 'points',
    points_scale: { min: 80, max: 100 }
  },
  platters: {
    name: "Platter's Wine Guide",
    short_name: "Platter's",
    lens: 'panel_guide',
    credibility: 0.85,
    scope: 'national',
    home_regions: ['South Africa'],
    score_type: 'stars',
    stars_conversion: {
      5: { min: 95, max: 100, label: '5 Stars' },
      4.5: { min: 90, max: 94, label: '4.5 Stars' },
      4: { min: 85, max: 89, label: '4 Stars' },
      3.5: { min: 80, max: 84, label: '3.5 Stars' },
      3: { min: 75, max: 79, label: '3 Stars' }
    }
  },

  // Australia/NZ critics
  huon_hooke: {
    name: 'Huon Hooke',
    short_name: 'Huon Hooke',
    lens: 'critic',
    credibility: 0.75,
    scope: 'national',
    home_regions: ['Australia'],
    score_type: 'points',
    points_scale: { min: 80, max: 100 }
  },
  bob_campbell: {
    name: 'Bob Campbell MW',
    short_name: 'Bob Campbell',
    lens: 'critic',
    credibility: 0.80,
    scope: 'national',
    home_regions: ['New Zealand'],
    score_type: 'points',
    points_scale: { min: 80, max: 100 }
  },
  wine_orbit: {
    name: 'Wine Orbit',
    short_name: 'Wine Orbit',
    lens: 'critic',
    credibility: 0.70,
    scope: 'national',
    home_regions: ['New Zealand'],
    score_type: 'points',
    points_scale: { min: 80, max: 100 }
  },

  // Spain
  guia_proensa: {
    name: 'Guía Proensa',
    short_name: 'Proensa',
    lens: 'critic',
    credibility: 0.70,
    scope: 'national',
    home_regions: ['Spain'],
    score_type: 'points',
    points_scale: { min: 80, max: 100 }
  },

  // Italy
  vinous: {
    name: 'Vinous (Antonio Galloni)',
    short_name: 'Vinous',
    lens: 'critic',
    credibility: 0.85,
    scope: 'global',
    home_regions: ['Italy', 'USA', 'France'],
    score_type: 'points',
    points_scale: { min: 80, max: 100 }
  },
  doctor_wine: {
    name: 'Doctor Wine',
    short_name: 'Doctor Wine',
    lens: 'critic',
    credibility: 0.75,
    scope: 'national',
    home_regions: ['Italy'],
    score_type: 'points',
    points_scale: { min: 80, max: 100 }
  },

  // Germany
  weinwisser: {
    name: 'Weinwisser',
    short_name: 'Weinwisser',
    lens: 'critic',
    credibility: 0.75,
    scope: 'national',
    home_regions: ['Germany'],
    score_type: 'points',
    points_scale: { min: 80, max: 100 }
  },

  // South America
  descorchados: {
    name: 'Descorchados',
    short_name: 'Descorchados',
    lens: 'critic',
    credibility: 0.80,
    scope: 'regional',
    home_regions: ['Chile', 'Argentina'],
    score_type: 'points',
    points_scale: { min: 80, max: 100 }
  },

  // Global critics
  wine_advocate: {
    name: 'Wine Advocate / Robert Parker',
    short_name: 'Wine Advocate',
    lens: 'critic',
    credibility: 0.75,
    scope: 'global',
    home_regions: [],
    score_type: 'points',
    points_scale: { min: 50, max: 100 }
  },
  wine_spectator: {
    name: 'Wine Spectator',
    short_name: 'Wine Spectator',
    lens: 'critic',
    credibility: 0.70,
    scope: 'global',
    home_regions: [],
    score_type: 'points',
    points_scale: { min: 50, max: 100 }
  },
  james_suckling: {
    name: 'James Suckling',
    short_name: 'Suckling',
    lens: 'critic',
    credibility: 0.65,
    scope: 'global',
    home_regions: [],
    score_type: 'points',
    points_scale: { min: 50, max: 100 }
  },
  jancis_robinson: {
    name: 'Jancis Robinson',
    short_name: 'Jancis Robinson',
    lens: 'critic',
    credibility: 0.80,
    scope: 'global',
    home_regions: [],
    score_type: 'points',
    points_scale: { min: 12, max: 20 }  // Uses 20-point scale
  },
  decanter_magazine: {
    name: 'Decanter Magazine',
    short_name: 'Decanter Mag',
    lens: 'critic',
    credibility: 0.75,
    scope: 'global',
    home_regions: [],
    score_type: 'points',
    points_scale: { min: 0, max: 100 }
  },
  wine_enthusiast: {
    name: 'Wine Enthusiast',
    short_name: 'Wine Enthusiast',
    lens: 'critic',
    credibility: 0.70,
    scope: 'global',
    home_regions: [],
    score_type: 'points',
    points_scale: { min: 50, max: 100 }
  },
  natalie_maclean: {
    name: 'Natalie MacLean',
    short_name: 'N. MacLean',
    lens: 'critic',
    credibility: 0.60,
    scope: 'global',
    home_regions: ['Canada'],
    score_type: 'points',
    points_scale: { min: 0, max: 100 }
  },
  cellar_tracker: {
    name: 'CellarTracker',
    short_name: 'CellarTracker',
    lens: 'community',
    credibility: 0.55,
    scope: 'global',
    home_regions: [],
    score_type: 'points',
    points_scale: { min: 50, max: 100 }
  },
  wine_align: {
    name: 'WineAlign',
    short_name: 'WineAlign',
    lens: 'community',
    credibility: 0.60,
    scope: 'global',
    home_regions: ['Canada'],
    score_type: 'points',
    points_scale: { min: 50, max: 100 }
  },

  // COMMUNITY (lens: community)
  vivino: {
    name: 'Vivino',
    short_name: 'Vivino',
    lens: 'community',
    credibility: 0.5,
    scope: 'global',
    home_regions: [],
    score_type: 'stars',
    stars_conversion: {
      4.5: { min: 92, max: 100 },
      4.2: { min: 88, max: 91 },
      4.0: { min: 85, max: 87 },
      3.7: { min: 82, max: 84 },
      3.4: { min: 78, max: 81 },
      3.0: { min: 74, max: 77 },
      2.5: { min: 70, max: 73 },
      2.0: { min: 60, max: 69 }
    },
    min_ratings_for_confidence: 100
  },

  // AGGREGATORS (sites that consolidate ratings from multiple sources)
  // Ratings from aggregators are discounted - the original source gets credit
  // but with AGGREGATOR_CREDIBILITY_DISCOUNT applied (0.85)

  wine_searcher: {
    name: 'Wine-Searcher',
    short_name: 'Wine-Searcher',
    lens: 'aggregator',
    credibility: 0.85,
    scope: 'global',
    home_regions: [],
    score_type: 'aggregated',
    is_aggregator: true,
    aggregates_sources: ['wine_advocate', 'wine_spectator', 'jancis_robinson', 'james_suckling', 'vinous', 'decanter', 'wine_enthusiast', 'falstaff', 'guia_penin', 'halliday'],
    notes: 'Best global coverage. Aggregates 30+ critic sources.'
  },
  dan_murphys: {
    name: "Dan Murphy's",
    short_name: "Dan Murphy's",
    lens: 'aggregator',
    credibility: 0.80,
    scope: 'national',
    home_regions: ['Australia'],
    score_type: 'aggregated',
    is_aggregator: true,
    aggregates_sources: ['halliday', 'huon_hooke', 'wine_orbit', 'decanter'],
    notes: "Australia's largest wine retailer. Shows Halliday, Campbell, Hooke scores."
  },
  bodeboca: {
    name: 'Bodeboca',
    short_name: 'Bodeboca',
    lens: 'aggregator',
    credibility: 0.80,
    scope: 'national',
    home_regions: ['Spain'],
    score_type: 'aggregated',
    is_aggregator: true,
    aggregates_sources: ['guia_penin', 'wine_advocate', 'james_suckling', 'decanter'],
    notes: "Spain's largest online retailer. Shows Peñín, Parker, Suckling scores."
  },
  wine_co_za: {
    name: 'Wine.co.za',
    short_name: 'Wine.co.za',
    lens: 'aggregator',
    credibility: 0.85,
    scope: 'national',
    home_regions: ['South Africa'],
    score_type: 'aggregated',
    is_aggregator: true,
    aggregates_sources: ['platters', 'tim_atkin', 'decanter', 'veritas', 'iwc', 'iwsc'],
    notes: 'SA wine info site. Shows ratings from Platters, Tim Atkin, DWWA, etc.'
  },
  bbr: {
    name: 'Berry Bros & Rudd',
    short_name: 'BBR',
    lens: 'aggregator',
    credibility: 0.85,
    scope: 'global',
    home_regions: [],
    score_type: 'aggregated',
    is_aggregator: true,
    aggregates_sources: ['wine_advocate', 'jancis_robinson', 'vinous', 'decanter', 'wine_spectator'],
    notes: 'Oldest wine merchant. Curates critic scores for fine wine.'
  }
};

/**
 * Lens order for display and aggregation.
 * panel_guide and critic are both grouped under "critics" in the UI.
 * Aggregators show under the lens of the original cited source.
 */
export const LENS_ORDER = ['competition', 'panel_guide', 'critic', 'community', 'aggregator'];

/**
 * Mapping for UI display - consolidates panel_guide and critic into "critics".
 * Aggregator ratings display under their original source's lens.
 */
export const LENS_DISPLAY_MAP = {
  competition: 'competition',
  panel_guide: 'critics',
  critic: 'critics',
  community: 'community',
  aggregator: 'critics'  // Default for aggregator citations without specific source
};

/**
 * Get source configuration by ID.
 * @param {string} sourceId - Source identifier
 * @returns {Object|null} Source configuration
 */
export function getSourceConfig(sourceId) {
  return RATING_SOURCES[sourceId] || null;
}

/**
 * Get all sources for a given lens.
 * @param {string} lens - Lens type (competition, panel_guide, critic, community)
 * @returns {Array} Array of source configs with IDs
 */
export function getSourcesByLens(lens) {
  return Object.entries(RATING_SOURCES)
    .filter(([_id, config]) => config.lens === lens)
    .map(([id, config]) => ({ id, ...config }));
}

/**
 * Get all sources for display category.
 * Maps panel_guide and critic both to "critics" category.
 * @param {string} displayLens - Display lens (competition, critics, community)
 * @returns {Array} Array of source configs with IDs
 */
export function getSourcesByDisplayLens(displayLens) {
  return Object.entries(RATING_SOURCES)
    .filter(([_id, config]) => {
      const mappedLens = LENS_DISPLAY_MAP[config.lens] || config.lens;
      return mappedLens === displayLens;
    })
    .map(([id, config]) => ({ id, ...config }));
}
