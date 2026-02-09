/**
 * @fileoverview Constants and configuration maps shared across search modules.
 * @module services/search/searchConstants
 */

/**
 * Domains known to block standard scrapers - use Bright Data for these.
 * Vivino and Decanter now use Web Unlocker (works in Docker) with Puppeteer fallback.
 * CellarTracker removed - their public pages work fine.
 */
export const BLOCKED_DOMAINS = [
  'wine-searcher.com', // Blocks direct scraping (403)
  'danmurphys.com.au', // May block scrapers
  'bodeboca.com',      // May block scrapers
  'bbr.com'            // May have anti-bot measures
];

/** Bright Data API endpoint */
export const BRIGHTDATA_API_URL = 'https://api.brightdata.com/request';

/**
 * Range/tier qualifiers that distinguish wine product lines.
 * These are NOT stripped from the original name - they're used for precision matching.
 * "Vineyard Selection" vs "Cellar Selection" are DIFFERENT wines.
 * "Crianza" vs "Gran Reserva" are DIFFERENT aging classifications.
 */
export const RANGE_QUALIFIERS = [
  // Product line/tier names (distinct ranges)
  'vineyard selection', 'cellar selection', 'family selection',
  'estate selection', 'special selection', 'limited edition',
  'private collection', 'family reserve', 'barrel select',
  // Spanish aging classifications (legally defined)
  'crianza', 'reserva', 'gran reserva', 'joven',
  // Italian classifications
  'riserva', 'selezione', 'classico', 'superiore',
  // German classifications
  'spätlese', 'auslese', 'kabinett', 'trockenbeerenauslese',
  // French designations
  'cuvée', 'grande cuvée', 'prestige', 'vieilles vignes', 'grand cru', 'premier cru'
];
