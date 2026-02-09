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
 * Grape variety keywords for wine name parsing.
 * Used to extract winery name from wine name.
 */
export const GRAPE_KEYWORDS = [
  'cabernet', 'sauvignon', 'merlot', 'shiraz', 'syrah', 'pinot',
  'chardonnay', 'riesling', 'chenin', 'pinotage', 'malbec',
  'tempranillo', 'sangiovese', 'nebbiolo', 'grenache', 'zinfandel'
];

/**
 * Safety limits for web scraping and document processing.
 * Prevents resource exhaustion and runaway operations.
 */
export const LIMITS = {
  // Document download limits
  MAX_DOCUMENT_BYTES: 5 * 1024 * 1024,      // 5MB max download size
  MAX_CONTENT_CHARS: 8000,                   // Max chars to extract from documents

  // DOCX zip-bomb protections (OWASP ASVS)
  DOCX_MAX_ENTRIES: 100,                     // Max files inside DOCX archive
  DOCX_MAX_UNCOMPRESSED_BYTES: 10 * 1024 * 1024,  // 10MB uncompressed
  DOCX_MAX_COMPRESSION_RATIO: 100,           // Max compression ratio

  // Concurrency control
  MAX_CONCURRENT_FETCHES: 5,                 // Global parallel fetch limit

  // Producer search optimization
  PRODUCER_SEARCH_DELAY_MS: 300,             // Delay before starting producer search
  MIN_DISCOVERY_CONFIDENCE: 0.7              // Min confidence to skip producer search
};

/**
 * Per-search budget caps to prevent runaway cost/latency.
 */
export const SEARCH_BUDGET = {
  MAX_SERP_CALLS: 3,               // Max SERP API calls per search
  MAX_DOCUMENT_FETCHES: 5,         // Max documents fetched per search
  MAX_TOTAL_BYTES: 15 * 1024 * 1024, // 15MB total download budget
  MAX_WALL_CLOCK_MS: 30_000        // 30s hard wall-clock budget
};

/**
 * Reranking weights for search result scoring.
 * Higher weights = more influence on final score.
 */
export const RERANK_WEIGHTS = {
  // Range qualifier matching
  RANGE_QUALIFIER_MATCH: 8,                  // Boost for matching range qualifier
  RANGE_QUALIFIER_MISS: -2,                  // Penalty for missing qualifier

  // Source credibility
  OFFICIAL_PRODUCER: 1.5,                    // Producer website multiplier
  TOP_CRITIC: 1.3,                           // Top critic multiplier
  COMPETITION: 1.2,                          // Competition results multiplier
  AGGREGATOR: 0.8,                           // Aggregator multiplier

  // Vintage matching
  EXACT_VINTAGE_MATCH: 5,                    // Boost for exact vintage match
  VINTAGE_MISSING: -1,                       // Penalty for missing vintage

  // Name matching
  FULL_NAME_MATCH: 10,                       // Boost for full name match
  PRODUCER_ONLY_MATCH: 3                     // Boost for producer-only match
};

/**
 * Producer micro-crawler configuration.
 * Controls robots.txt governance and crawl behavior.
 */
export const PRODUCER_CRAWL = {
  // Feature flags
  ENABLED: process.env.PRODUCER_CRAWL_ENABLED === 'true',
  ROBOTS_TXT_ENABLED: process.env.ROBOTS_TXT_ENABLED !== 'false',

  // Identification
  USER_AGENT: process.env.CRAWLER_USER_AGENT || 'WineCellarBot/1.0 (+https://cellar.creathyst.com/bot)',

  // Rate limiting
  DEFAULT_CRAWL_DELAY_S: parseInt(process.env.CRAWL_DELAY_S, 10) || 1,

  // Crawl limits
  MAX_PAGES_PER_DOMAIN: parseInt(process.env.MAX_PAGES_PER_DOMAIN, 10) || 20,

  // Timeouts
  PAGE_TIMEOUT_MS: parseInt(process.env.PAGE_TIMEOUT_MS, 10) || 15000,
  ROBOTS_TXT_TIMEOUT_MS: parseInt(process.env.ROBOTS_TXT_TIMEOUT_MS, 10) || 5000,

  // Cache TTLs
  CACHE_TTL_HOURS: parseInt(process.env.PAGE_CACHE_TTL_HOURS, 10) || 168,     // 7 days for page content
  ROBOTS_TTL_HOURS: parseInt(process.env.ROBOTS_TTL_HOURS, 10) || 24          // 24h for robots.txt (RFC 9309)
};

