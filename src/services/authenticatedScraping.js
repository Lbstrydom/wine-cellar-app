/**
 * @fileoverview Authenticated/premium scraping for Decanter.
 * Manages credentials and uses Web Unlocker with Puppeteer fallback.
 * @module services/authenticatedScraping
 */

import logger from '../utils/logger.js';
import db from '../db/index.js';
import { decrypt } from './encryption.js';
import { searchDecanterWithPuppeteer } from './puppeteerScraper.js';
import { searchDecanterWithWebUnlocker } from './decanterScraper.js';

/**
 * Get decrypted credentials for a source.
 * @param {string} sourceId - Source ID (vivino, decanter, cellartracker)
 * @returns {Promise<Object|null>} { username, password } or null if not configured
 */
export async function getCredentials(sourceId) {
  try {
    const cred = await db.prepare(
      'SELECT username_encrypted, password_encrypted, auth_status FROM source_credentials WHERE source_id = ?'
    ).get(sourceId);

    if (!cred || !cred.username_encrypted || !cred.password_encrypted) {
      return null;
    }

    const username = decrypt(cred.username_encrypted);
    const password = decrypt(cred.password_encrypted);

    if (!username || !password) {
      return null;
    }

    return { username, password, authStatus: cred.auth_status };
  } catch (err) {
    logger.error('Credentials', `Failed to get credentials for ${sourceId}: ${err.message}`);
    return null;
  }
}

/**
 * Update credential auth status.
 * @param {string} sourceId - Source ID
 * @param {string} status - 'valid', 'failed', or 'none'
 */
export async function updateCredentialStatus(sourceId, status) {
  try {
    await db.prepare(
      'UPDATE source_credentials SET auth_status = ?, last_used_at = CURRENT_TIMESTAMP WHERE source_id = ?'
    ).run(status, sourceId);
  } catch (err) {
    logger.error('Credentials', `Failed to update status for ${sourceId}: ${err.message}`);
  }
}

// NOTE: Vivino authenticated fetch removed.
// Their API calls are blocked by CloudFront WAF, making direct API access unreliable.
// Using Bright Data Web Unlocker for page content is more effective.

// NOTE: CellarTracker credential support removed.
// Their API (xlquery.asp) only searches the user's personal cellar, not global wine database.
// This made it useless for discovering ratings on wines not already in the user's CT account.
// CellarTracker ratings can still be found via web search snippets.

/**
 * Fetch wine data from Decanter.
 * Uses Web Unlocker (preferred - works in Docker) with Puppeteer fallback.
 * @param {string} wineName - Wine name to search
 * @param {string|number} vintage - Vintage year
 * @returns {Promise<Object|null>} Wine data or null
 */
export async function fetchDecanterAuthenticated(wineName, vintage) {
  logger.info('Decanter', `Searching: ${wineName} ${vintage}`);

  let reviewData = null;

  // Try Web Unlocker first (preferred - works in Docker, faster)
  const bdWebZone = process.env.BRIGHTDATA_WEB_ZONE;
  if (bdWebZone) {
    reviewData = await searchDecanterWithWebUnlocker(wineName, vintage);
  }

  // Fall back to Puppeteer for local development
  if (!reviewData) {
    try {
      logger.info('Decanter', 'Trying Puppeteer fallback...');
      reviewData = await searchDecanterWithPuppeteer(wineName, vintage);
    } catch (err) {
      logger.warn('Decanter', `Puppeteer fallback failed: ${err.message}`);
    }
  }

  if (!reviewData) {
    logger.info('Decanter', 'No review found');
    return null;
  }

  // Use extracted vintage from page, fall back to requested vintage
  const foundVintage = reviewData.vintage || vintage;

  const result = {
    source: 'decanter',
    lens: 'panel_guide',
    score_type: 'points',
    raw_score: String(reviewData.score),
    rating_count: null,
    wine_name: reviewData.wineName || wineName,
    vintage_found: foundVintage,
    vintage_matches: reviewData.vintage ? reviewData.vintage === vintage : null,
    source_url: reviewData.url,
    drinking_window: reviewData.drinkFrom && reviewData.drinkTo ? {
      drink_from_year: reviewData.drinkFrom,
      drink_by_year: reviewData.drinkTo,
      raw_text: `Drink ${reviewData.drinkFrom}-${reviewData.drinkTo}`
    } : null,
    tasting_notes: reviewData.tastingNotes || null,
    match_confidence: reviewData.vintage && reviewData.vintage === vintage ? 'high' : 'medium'
  };

  logger.info('Decanter', `Found: ${result.raw_score} points${result.drinking_window ? ` (${result.drinking_window.raw_text})` : ''}${result.tasting_notes ? ' [with notes]' : ''}`);
  return result;
}

/**
 * Try authenticated fetch for Decanter ratings.
 * Vivino auth has been removed - using Bright Data Web Unlocker instead.
 *
 * @param {string} wineName - Wine name
 * @param {string|number} vintage - Vintage year
 * @returns {Promise<Object[]>} Array of ratings from authenticated sources
 */
export async function fetchAuthenticatedRatings(wineName, vintage) {
  const ratings = [];

  // Only try Decanter (Vivino uses Web Unlocker now)
  const decanterResult = await fetchDecanterAuthenticated(wineName, vintage);

  if (decanterResult) {
    ratings.push(decanterResult);
  }

  return ratings;
}
