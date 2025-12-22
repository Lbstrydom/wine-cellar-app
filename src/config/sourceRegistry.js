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
 * Master source registry.
 * Each source has metadata for search planning and result weighting.
 */
export const SOURCE_REGISTRY = {
  // COMPETITIONS (lens: competition, credibility: 3.0)
  decanter: {
    name: 'Decanter World Wine Awards',
    short_name: 'DWWA',
    lens: LENS.COMPETITION,
    domain: 'decanter.com',
    home_regions: [],
    score_type: 'medal',
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
    score_type: 'medal',
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
    score_type: 'medal',
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
    score_type: 'medal',
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
    score_type: 'medal',
    query_template: '{wine} {vintage} site:mundusvini.com',
    medal_bands: {
      grand_gold: { min: 95, max: 100 },
      gold: { min: 90, max: 94 },
      silver: { min: 85, max: 89 }
    }
  },

  // Regional competitions
  veritas: {
    name: 'Veritas Awards',
    short_name: 'Veritas',
    lens: LENS.COMPETITION,
    domain: 'veritas.co.za',
    home_regions: ['South Africa'],
    score_type: 'medal',
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
    score_type: 'medal',
    query_template: '{wine} {vintage} Old Mutual Trophy',
    medal_bands: {
      trophy: { min: 95, max: 100 },
      gold: { min: 90, max: 94 },
      silver: { min: 85, max: 89 },
      bronze: { min: 80, max: 84 }
    }
  },

  // PANEL GUIDES (lens: panel_guide, credibility: 2.5)
  platters: {
    name: "Platter's Wine Guide",
    short_name: "Platter's",
    lens: LENS.PANEL_GUIDE,
    domain: 'wineonaplatter.com',
    alt_domains: ['platterwineguide.com'],
    home_regions: ['South Africa'],
    score_type: 'stars',
    query_template: "{wine} {vintage} Platter's stars rating",
    stars_to_points: {
      5: 95, 4.5: 90, 4: 85, 3.5: 80, 3: 75
    }
  },

  halliday: {
    name: 'Halliday Wine Companion',
    short_name: 'Halliday',
    lens: LENS.PANEL_GUIDE,
    domain: 'winecompanion.com.au',
    home_regions: ['Australia', 'New Zealand'],
    score_type: 'points',
    query_template: '{wine} {vintage} site:winecompanion.com.au'
  },

  guia_penin: {
    name: 'Guía Peñín',
    short_name: 'Peñín',
    lens: LENS.PANEL_GUIDE,
    domain: 'guiapenin.com',
    home_regions: ['Spain'],
    score_type: 'points',
    query_template: '{wine} {vintage} Guía Peñín puntos'
  },

  gambero_rosso: {
    name: 'Gambero Rosso',
    short_name: 'Gambero Rosso',
    lens: LENS.PANEL_GUIDE,
    domain: 'gamberorosso.it',
    home_regions: ['Italy'],
    score_type: 'glasses',
    query_template: '{wine} {vintage} Gambero Rosso bicchieri'
  },

  // CRITICS (lens: critic, credibility: 1.5)
  tim_atkin: {
    name: 'Tim Atkin MW',
    short_name: 'Tim Atkin',
    lens: LENS.CRITIC,
    domain: 'timatkin.com',
    home_regions: ['South Africa', 'Argentina'],
    score_type: 'points',
    query_template: '{wine} {vintage} site:timatkin.com'
  },

  jancis_robinson: {
    name: 'Jancis Robinson',
    short_name: 'Jancis Robinson',
    lens: LENS.CRITIC,
    domain: 'jancisrobinson.com',
    home_regions: [],
    score_type: 'points',
    points_scale: 20,
    query_template: '{wine} {vintage} site:jancisrobinson.com'
  },

  wine_advocate: {
    name: 'Wine Advocate / Robert Parker',
    short_name: 'Wine Advocate',
    lens: LENS.CRITIC,
    domain: 'robertparker.com',
    home_regions: [],
    score_type: 'points',
    query_template: '{wine} {vintage} Wine Advocate OR Robert Parker points'
  },

  wine_spectator: {
    name: 'Wine Spectator',
    short_name: 'Wine Spectator',
    lens: LENS.CRITIC,
    domain: 'winespectator.com',
    home_regions: [],
    score_type: 'points',
    query_template: '{wine} {vintage} site:winespectator.com'
  },

  james_suckling: {
    name: 'James Suckling',
    short_name: 'Suckling',
    lens: LENS.CRITIC,
    domain: 'jamessuckling.com',
    home_regions: [],
    score_type: 'points',
    query_template: '{wine} {vintage} site:jamessuckling.com'
  },

  descorchados: {
    name: 'Descorchados',
    short_name: 'Descorchados',
    lens: LENS.CRITIC,
    domain: 'descorchados.com',
    home_regions: ['Chile', 'Argentina'],
    score_type: 'points',
    query_template: '{wine} {vintage} Descorchados puntos'
  },

  decanter_magazine: {
    name: 'Decanter Magazine',
    short_name: 'Decanter Mag',
    lens: LENS.CRITIC,
    domain: 'decanter.com',
    home_regions: [],
    score_type: 'points',
    query_template: '{wine} {vintage} site:decanter.com review'
  },

  wine_enthusiast: {
    name: 'Wine Enthusiast',
    short_name: 'Wine Enthusiast',
    lens: LENS.CRITIC,
    domain: 'winemag.com',
    home_regions: [],
    score_type: 'points',
    query_template: '{wine} {vintage} site:winemag.com'
  },

  natalie_maclean: {
    name: 'Natalie MacLean',
    short_name: 'N. MacLean',
    lens: LENS.CRITIC,
    domain: 'nataliemaclean.com',
    home_regions: ['Canada'],
    score_type: 'points',
    query_template: '{wine} {vintage} site:nataliemaclean.com'
  },

  // COMMUNITY (lens: community, credibility: 1.0)
  cellar_tracker: {
    name: 'CellarTracker',
    short_name: 'CellarTracker',
    lens: LENS.COMMUNITY,
    domain: 'cellartracker.com',
    home_regions: [],
    score_type: 'points',
    query_template: '{wine} {vintage} site:cellartracker.com'
  },

  wine_align: {
    name: 'WineAlign',
    short_name: 'WineAlign',
    lens: LENS.COMMUNITY,
    domain: 'winealign.com',
    home_regions: ['Canada'],
    score_type: 'points',
    query_template: '{wine} {vintage} site:winealign.com'
  },

  vivino: {
    name: 'Vivino',
    short_name: 'Vivino',
    lens: LENS.COMMUNITY,
    domain: 'vivino.com',
    home_regions: [],
    score_type: 'stars',
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
