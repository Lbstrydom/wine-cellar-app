/**
 * @fileoverview Configuration constants for web scraping services.
 * Centralizes timeout values and scraping parameters.
 * @module config/scraperConfig
 */

/**
 * Timeout configuration for scraping operations.
 * All values in milliseconds.
 */
export const TIMEOUTS = {
  // Page loading timeouts
  SPA_RENDER_WAIT: 5000,        // Time for JS SPAs (React/Next.js) to render
  COOKIE_CONSENT_WAIT: 2000,    // Wait after clicking cookie consent
  PAGE_LOAD_WAIT: 5000,         // General page load wait
  SEARCH_RESULTS_WAIT: 5000,    // Wait for search results to load

  // API request timeouts
  SERP_API_TIMEOUT: 45000,      // Bright Data SERP API (increased for slow responses)
  WEB_UNLOCKER_TIMEOUT: 30000,  // Bright Data Web Unlocker
  VIVINO_FETCH_TIMEOUT: 45000,  // Vivino (needs JS rendering)
  STANDARD_FETCH_TIMEOUT: 10000, // Regular fetch requests

  // MCP/Puppeteer timeouts
  MCP_SERVER_START: 3000,       // Time for MCP server to start
  MCP_REQUEST_TIMEOUT: 60000,   // Default MCP tool call timeout
  CLIENT_IDLE_TIMEOUT: 60000    // Close client after 1 minute idle
};

/**
 * Cookie consent button selectors by site.
 * Each site has an array of selectors to try in order.
 */
export const COOKIE_CONSENT_SELECTORS = {
  vivino: [
    // Vivino uses a simple button with "Agree" text
    { type: 'text', value: 'Agree' }
  ],
  decanter: [
    // Decanter uses OneTrust and other consent frameworks
    { type: 'selector', value: '#onetrust-accept-btn-handler' },
    { type: 'selector', value: 'button.fc-cta-consent' },
    { type: 'selector', value: '[class*="consent"] button' },
    { type: 'selector', value: 'button[class*="agree"]' },
    { type: 'text', value: 'agree' }
  ],
  generic: [
    // Common consent button patterns
    { type: 'selector', value: '#onetrust-accept-btn-handler' },
    { type: 'selector', value: '[data-consent="agree"]' },
    { type: 'selector', value: '[class*="cookie-accept"]' },
    { type: 'text', value: 'agree' },
    { type: 'text', value: 'accept' }
  ]
};

/**
 * Selectors for extracting wine data from Vivino pages.
 */
export const VIVINO_SELECTORS = {
  rating: [
    '.vivinoRating_averageValue__uDdPM',
    '[class*="averageValue"]',
    '.average__number'
  ],
  ratingCount: [
    '.vivinoRating_caption__xL84P',
    '[class*="ratingCount"]',
    '[class*="caption"]'
  ],
  wineName: ['h1'],
  winery: [
    '[class*="winery"]',
    'a[href*="/wineries/"]'
  ],
  region: [
    '[class*="location"]',
    'a[href*="/wine-regions/"]'
  ],
  grape: [
    '[class*="grape"]',
    'a[href*="/grapes/"]'
  ],
  price: ['[class*="price"]']
};

/**
 * Grape variety keywords for wine name parsing.
 * Used to extract winery name from wine name.
 */
export const GRAPE_KEYWORDS = [
  'cabernet', 'sauvignon', 'merlot', 'shiraz', 'syrah', 'pinot',
  'chardonnay', 'riesling', 'chenin', 'pinotage', 'malbec',
  'tempranillo', 'sangiovese', 'nebbiolo', 'grenache', 'zinfandel'
];

export default {
  TIMEOUTS,
  COOKIE_CONSENT_SELECTORS,
  VIVINO_SELECTORS,
  GRAPE_KEYWORDS
};
