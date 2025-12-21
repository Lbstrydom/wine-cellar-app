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

  // CRITICS / GUIDES (lens: critics)
  tim_atkin: {
    name: 'Tim Atkin MW',
    short_name: 'Tim Atkin',
    lens: 'critics',
    credibility: 0.8,
    scope: 'regional',
    home_regions: ['South Africa', 'Argentina'],
    score_type: 'points',
    points_scale: { min: 0, max: 100 }
  },
  platters: {
    name: "Platter's Wine Guide",
    short_name: "Platter's",
    lens: 'critics',
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
  }
};

export const LENS_ORDER = ['competition', 'critics', 'community'];

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
 * @param {string} lens - Lens type (competition, critics, community)
 * @returns {Array} Array of source configs with IDs
 */
export function getSourcesByLens(lens) {
  return Object.entries(RATING_SOURCES)
    .filter(([_id, config]) => config.lens === lens)
    .map(([id, config]) => ({ id, ...config }));
}
