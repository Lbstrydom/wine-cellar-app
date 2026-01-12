/**
 * @fileoverview Market-specific source packs for wine search.
 * Implements Phase 4 of Wine Search Implementation Plan v1.1.
 * @module config/marketPacks
 */

import { LANGUAGE_QUERY_TEMPLATES, SOURCE_LANGUAGE_MAP } from './languageConfig.js';

/**
 * Market pack priorities define source importance per market.
 * Higher priority = search earlier in the process.
 */
const MARKET_PACK_PRIORITIES = {
  merchant: 100,      // E-commerce sites with pricing
  national_critic: 90, // National wine critics/publications
  competition: 80,     // Wine competitions and awards
  global_critic: 70,   // International critics (Parker, Decanter)
  database: 60,        // Wine databases (Vivino, CellarTracker)
  regional: 50         // Regional publications
};

/**
 * USA Market Pack
 * Focus: American critics, US merchants, international databases
 */
const USA_MARKET_PACK = {
  market: 'usa',
  locale: 'en-US',
  currency: 'USD',
  merchants: [
    {
      sourceId: 'wine_com',
      name: 'Wine.com',
      priority: MARKET_PACK_PRIORITIES.merchant,
      pricingAvailable: true,
      shipsTo: ['usa']
    },
    {
      sourceId: 'totalwine',
      name: 'Total Wine & More',
      priority: MARKET_PACK_PRIORITIES.merchant,
      pricingAvailable: true,
      shipsTo: ['usa']
    },
    {
      sourceId: 'wine_searcher',
      name: 'Wine-Searcher',
      priority: MARKET_PACK_PRIORITIES.database,
      pricingAvailable: true,
      shipsTo: ['global']
    }
  ],
  critics: [
    {
      sourceId: 'wine_advocate',
      name: 'Wine Advocate (Robert Parker)',
      priority: MARKET_PACK_PRIORITIES.global_critic,
      scoreScale: '100-point'
    },
    {
      sourceId: 'wine_spectator',
      name: 'Wine Spectator',
      priority: MARKET_PACK_PRIORITIES.global_critic,
      scoreScale: '100-point'
    },
    {
      sourceId: 'wine_enthusiast',
      name: 'Wine Enthusiast',
      priority: MARKET_PACK_PRIORITIES.global_critic,
      scoreScale: '100-point'
    },
    {
      sourceId: 'jancis_robinson',
      name: 'Jancis Robinson',
      priority: MARKET_PACK_PRIORITIES.global_critic,
      scoreScale: '20-point'
    }
  ],
  databases: [
    {
      sourceId: 'vivino',
      name: 'Vivino',
      priority: MARKET_PACK_PRIORITIES.database,
      scoreScale: '5-point',
      language: 'en'
    },
    {
      sourceId: 'cellartracker',
      name: 'CellarTracker',
      priority: MARKET_PACK_PRIORITIES.database,
      scoreScale: '100-point',
      language: 'en'
    }
  ],
  competitions: [
    {
      sourceId: 'decanter_awards',
      name: 'Decanter World Wine Awards',
      priority: MARKET_PACK_PRIORITIES.competition,
      scoreScale: 'medal'
    },
    {
      sourceId: 'iwsc',
      name: 'International Wine & Spirit Competition',
      priority: MARKET_PACK_PRIORITIES.competition,
      scoreScale: 'medal'
    }
  ]
};

/**
 * Netherlands Market Pack
 * Focus: Dutch critics, local merchants, European sources
 */
const NETHERLANDS_MARKET_PACK = {
  market: 'netherlands',
  locale: 'nl-NL',
  currency: 'EUR',
  merchants: [
    {
      sourceId: 'gall_gall',
      name: 'Gall & Gall',
      priority: MARKET_PACK_PRIORITIES.merchant,
      pricingAvailable: true,
      shipsTo: ['netherlands']
    },
    {
      sourceId: 'wijnvoordeel',
      name: 'Wijnvoordeel',
      priority: MARKET_PACK_PRIORITIES.merchant,
      pricingAvailable: true,
      shipsTo: ['netherlands', 'belgium']
    },
    {
      sourceId: 'wine_searcher',
      name: 'Wine-Searcher',
      priority: MARKET_PACK_PRIORITIES.database,
      pricingAvailable: true,
      shipsTo: ['global']
    }
  ],
  critics: [
    {
      sourceId: 'hamersma',
      name: 'Harold Hamersma',
      priority: MARKET_PACK_PRIORITIES.national_critic,
      scoreScale: '10-point',
      language: 'nl'
    },
    {
      sourceId: 'perswijn',
      name: 'Perswijn',
      priority: MARKET_PACK_PRIORITIES.national_critic,
      scoreScale: '20-point',
      language: 'nl'
    },
    {
      sourceId: 'jancis_robinson',
      name: 'Jancis Robinson',
      priority: MARKET_PACK_PRIORITIES.global_critic,
      scoreScale: '20-point'
    }
  ],
  databases: [
    {
      sourceId: 'vivino_nl',
      name: 'Vivino Netherlands',
      priority: MARKET_PACK_PRIORITIES.database,
      scoreScale: '5-point',
      language: 'nl'
    }
  ],
  competitions: [
    {
      sourceId: 'decanter_awards',
      name: 'Decanter World Wine Awards',
      priority: MARKET_PACK_PRIORITIES.competition,
      scoreScale: 'medal'
    }
  ]
};

/**
 * Canada Market Pack
 * Focus: Canadian critics, LCBO/SAQ, North American sources
 */
const CANADA_MARKET_PACK = {
  market: 'canada',
  locale: 'en-CA',
  currency: 'CAD',
  merchants: [
    {
      sourceId: 'lcbo',
      name: 'LCBO (Liquor Control Board of Ontario)',
      priority: MARKET_PACK_PRIORITIES.merchant,
      pricingAvailable: true,
      shipsTo: ['ontario']
    },
    {
      sourceId: 'saq',
      name: 'SAQ (Société des alcools du Québec)',
      priority: MARKET_PACK_PRIORITIES.merchant,
      pricingAvailable: true,
      shipsTo: ['quebec'],
      language: 'fr'
    },
    {
      sourceId: 'wine_searcher',
      name: 'Wine-Searcher',
      priority: MARKET_PACK_PRIORITIES.database,
      pricingAvailable: true,
      shipsTo: ['global']
    }
  ],
  critics: [
    {
      sourceId: 'wine_advocate',
      name: 'Wine Advocate (Robert Parker)',
      priority: MARKET_PACK_PRIORITIES.global_critic,
      scoreScale: '100-point'
    },
    {
      sourceId: 'wine_spectator',
      name: 'Wine Spectator',
      priority: MARKET_PACK_PRIORITIES.global_critic,
      scoreScale: '100-point'
    },
    {
      sourceId: 'jancis_robinson',
      name: 'Jancis Robinson',
      priority: MARKET_PACK_PRIORITIES.global_critic,
      scoreScale: '20-point'
    },
    {
      sourceId: 'natalie_maclean',
      name: 'Natalie MacLean',
      priority: MARKET_PACK_PRIORITIES.national_critic,
      scoreScale: '100-point',
      language: 'en'
    }
  ],
  databases: [
    {
      sourceId: 'vivino',
      name: 'Vivino',
      priority: MARKET_PACK_PRIORITIES.database,
      scoreScale: '5-point',
      language: 'en'
    }
  ],
  competitions: [
    {
      sourceId: 'decanter_awards',
      name: 'Decanter World Wine Awards',
      priority: MARKET_PACK_PRIORITIES.competition,
      scoreScale: 'medal'
    }
  ]
};

/**
 * Default/Global Market Pack
 * Fallback when no specific market is detected
 */
const GLOBAL_MARKET_PACK = {
  market: 'global',
  locale: 'en-US',
  currency: 'USD',
  merchants: [
    {
      sourceId: 'wine_searcher',
      name: 'Wine-Searcher',
      priority: MARKET_PACK_PRIORITIES.database,
      pricingAvailable: true,
      shipsTo: ['global']
    }
  ],
  critics: [
    {
      sourceId: 'wine_advocate',
      name: 'Wine Advocate (Robert Parker)',
      priority: MARKET_PACK_PRIORITIES.global_critic,
      scoreScale: '100-point'
    },
    {
      sourceId: 'jancis_robinson',
      name: 'Jancis Robinson',
      priority: MARKET_PACK_PRIORITIES.global_critic,
      scoreScale: '20-point'
    },
    {
      sourceId: 'decanter',
      name: 'Decanter',
      priority: MARKET_PACK_PRIORITIES.global_critic,
      scoreScale: '100-point'
    }
  ],
  databases: [
    {
      sourceId: 'vivino',
      name: 'Vivino',
      priority: MARKET_PACK_PRIORITIES.database,
      scoreScale: '5-point',
      language: 'en'
    },
    {
      sourceId: 'cellartracker',
      name: 'CellarTracker',
      priority: MARKET_PACK_PRIORITIES.database,
      scoreScale: '100-point',
      language: 'en'
    }
  ],
  competitions: [
    {
      sourceId: 'decanter_awards',
      name: 'Decanter World Wine Awards',
      priority: MARKET_PACK_PRIORITIES.competition,
      scoreScale: 'medal'
    },
    {
      sourceId: 'iwsc',
      name: 'International Wine & Spirit Competition',
      priority: MARKET_PACK_PRIORITIES.competition,
      scoreScale: 'medal'
    }
  ]
};

/**
 * All market packs indexed by market code
 */
const MARKET_PACKS = {
  usa: USA_MARKET_PACK,
  netherlands: NETHERLANDS_MARKET_PACK,
  canada: CANADA_MARKET_PACK,
  global: GLOBAL_MARKET_PACK
};

/**
 * Get market pack for a specific market code.
 * @param {string} marketCode - Market code (usa, netherlands, canada, global)
 * @returns {Object|null} Market pack or null if not found
 */
export function getMarketPack(marketCode) {
  return MARKET_PACKS[marketCode] || null;
}

/**
 * Detect market from user locale string.
 * @param {string} userLocale - User locale (e.g., 'en-US', 'nl-NL', 'en-CA', 'fr-CA')
 * @returns {string} Market code
 */
export function detectMarketFromLocale(userLocale) {
  if (!userLocale) return 'global';

  const locale = userLocale.toLowerCase();

  // Match country code from locale
  if (locale.includes('us')) return 'usa';
  if (locale.includes('nl')) return 'netherlands';
  if (locale.includes('ca')) return 'canada';
  if (locale.includes('be')) return 'netherlands'; // Belgium uses NL market pack

  return 'global';
}

/**
 * Get all sources from a market pack, sorted by priority.
 * @param {string} marketCode - Market code
 * @returns {Array<Object>} All sources with priority, sorted descending
 */
export function getMarketSources(marketCode) {
  const pack = getMarketPack(marketCode);
  if (!pack) return [];

  const allSources = [
    ...pack.merchants,
    ...pack.critics,
    ...pack.databases,
    ...pack.competitions
  ];

  // Sort by priority (highest first)
  return allSources.sort((a, b) => b.priority - a.priority);
}

/**
 * Get sources by category from a market pack.
 * @param {string} marketCode - Market code
 * @param {string} category - Category (merchants, critics, databases, competitions)
 * @returns {Array<Object>} Sources in the category, sorted by priority
 */
export function getMarketSourcesByCategory(marketCode, category) {
  const pack = getMarketPack(marketCode);
  if (!pack || !pack[category]) return [];

  return [...pack[category]].sort((a, b) => b.priority - a.priority);
}

/**
 * Check if a source is available in a market pack.
 * @param {string} marketCode - Market code
 * @param {string} sourceId - Source ID to check
 * @returns {boolean}
 */
export function isSourceAvailableInMarket(marketCode, sourceId) {
  const sources = getMarketSources(marketCode);
  return sources.some(s => s.sourceId === sourceId);
}

/**
 * Get merchant sources with pricing for a market.
 * @param {string} marketCode - Market code
 * @returns {Array<Object>} Merchants with pricing
 */
export function getMerchantsWithPricing(marketCode) {
  const merchants = getMarketSourcesByCategory(marketCode, 'merchants');
  return merchants.filter(m => m.pricingAvailable);
}

/**
 * Get national critics for a market (higher priority than global critics).
 * @param {string} marketCode - Market code
 * @returns {Array<Object>} National critics
 */
export function getNationalCritics(marketCode) {
  const critics = getMarketSourcesByCategory(marketCode, 'critics');
  return critics.filter(c => c.priority === MARKET_PACK_PRIORITIES.national_critic);
}

/**
 * Get query template for source with market context.
 * Uses Phase 1 languageConfig integration.
 * @param {string} marketCode - Market code
 * @param {string} sourceId - Source ID
 * @param {string} wine - Wine name
 * @param {number} vintage - Vintage year
 * @returns {string|null} Query template or null if not available
 */
export function getMarketQueryTemplate(marketCode, sourceId, wine, vintage) {
  const pack = getMarketPack(marketCode);
  if (!pack) return null;

  // Find source in market pack to get language preference
  const sources = getMarketSources(marketCode);
  const source = sources.find(s => s.sourceId === sourceId);

  if (!source) return null;

  // Get language for source (from source or from SOURCE_LANGUAGE_MAP)
  const language = source.language || SOURCE_LANGUAGE_MAP[sourceId] || 'en';

  // Get template from Phase 1 languageConfig
  const templates = LANGUAGE_QUERY_TEMPLATES[language];
  if (!templates || !templates[sourceId]) return null;

  return templates[sourceId]
    .replaceAll('{wine}', wine)
    .replaceAll('{vintage}', String(vintage));
}

/**
 * Get available markets list.
 * @returns {Array<string>} List of market codes
 */
export function getAvailableMarkets() {
  return Object.keys(MARKET_PACKS);
}

/**
 * Get market pack summary (counts, locale, currency).
 * @param {string} marketCode - Market code
 * @returns {Object|null} Summary object or null
 */
export function getMarketSummary(marketCode) {
  const pack = getMarketPack(marketCode);
  if (!pack) return null;

  return {
    market: pack.market,
    locale: pack.locale,
    currency: pack.currency,
    sourceCount: {
      merchants: pack.merchants.length,
      critics: pack.critics.length,
      databases: pack.databases.length,
      competitions: pack.competitions.length,
      total: pack.merchants.length + pack.critics.length + 
             pack.databases.length + pack.competitions.length
    }
  };
}

export {
  MARKET_PACKS,
  MARKET_PACK_PRIORITIES,
  USA_MARKET_PACK,
  NETHERLANDS_MARKET_PACK,
  CANADA_MARKET_PACK,
  GLOBAL_MARKET_PACK
};
