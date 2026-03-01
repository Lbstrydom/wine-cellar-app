/**
 * @fileoverview Wine region data client.
 * Fetches from /api/config/wine-regions (canonical source: src/config/wineRegions.js).
 * Caches in memory after first fetch. Falls back to minimal list if offline.
 * @module config/wineRegions
 */

import { fetch } from '../api/base.js';

/**
 * Minimal offline fallback (matches legacy WINE_COUNTRIES).
 * Used when API is unreachable or data hasn't loaded yet.
 * @type {string[]}
 */
const FALLBACK_COUNTRIES = [
  'Argentina', 'Australia', 'Austria', 'Chile', 'France', 'Germany',
  'Greece', 'Italy', 'New Zealand', 'Portugal', 'South Africa', 'Spain', 'USA'
];

/** @type {string[]|null} */
let _countries = null;

/** @type {Object<string, string[]>|null} */
let _regions = null;

/** @type {Promise<void>|null} */
let _fetchPromise = null;

/**
 * Fetch and cache region data from the API.
 * Safe to call multiple times — deduplicates in-flight requests.
 * @returns {Promise<void>}
 */
export async function loadWineRegions() {
  if (_countries) return; // Already loaded
  if (_fetchPromise) return _fetchPromise; // In-flight

  _fetchPromise = (async () => {
    try {
      const res = await fetch('/api/config/wine-regions');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      _countries = data.countries;
      _regions = data.regions;
    } catch {
      // Offline or error — use fallback
      _countries = FALLBACK_COUNTRIES;
      _regions = {};
    } finally {
      _fetchPromise = null;
    }
  })();

  return _fetchPromise;
}

/**
 * Get country list (sync after loadWineRegions resolves, fallback otherwise).
 * @returns {string[]}
 */
export function getCountries() {
  return _countries || FALLBACK_COUNTRIES;
}

/**
 * Get regions for a country (empty array if not loaded or unknown country).
 * @param {string} country - Country name
 * @returns {string[]}
 */
export function getRegionsForCountry(country) {
  if (!_regions || !_regions[country]) return [];
  return _regions[country].slice().sort();
}
