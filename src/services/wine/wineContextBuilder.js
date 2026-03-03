/**
 * @fileoverview Shared wine context builder for AI prompts.
 * Single source of truth for assembling enriched wine context from DB data.
 * Provides single-wine and batch variants to avoid N+1 queries.
 *
 * Used by drinkNowAI (batch) and restaurantPairing (single) to give AI
 * prompts richer context: food pairings, structured tasting notes, awards.
 *
 * @module services/wine/wineContextBuilder
 */

import db, { awardsDb } from '../../db/index.js';
import logger from '../../utils/logger.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build enriched wine context for a single wine.
 * Optionally fetches food pairings and/or competition awards from the DB.
 *
 * @param {Object} wine - Wine DB record (from wines table)
 * @param {string} cellarId - Tenant scope
 * @param {Object} [options]
 * @param {boolean} [options.includePairings=false] - Fetch food pairings
 * @param {boolean} [options.includeTastingNotes=false] - Parse structured tasting notes
 * @param {boolean} [options.includeAwards=false] - Fetch competition awards
 * @returns {Promise<Object>} Enriched context object
 */
export async function buildWineContext(wine, cellarId, options = {}) {
  const { includePairings = false, includeTastingNotes = false, includeAwards = false } = options;

  const context = _buildBaseContext(wine, includeTastingNotes);

  if (includePairings) {
    try {
      context.food_pairings = await db.prepare(`
        SELECT pairing, source, user_rating
        FROM wine_food_pairings
        WHERE wine_id = $1 AND cellar_id = $2
        ORDER BY user_rating DESC NULLS LAST, created_at ASC
        LIMIT 10
      `).all(wine.id, cellarId);
    } catch (err) {
      logger.warn('WineContextBuilder', `Pairings fetch failed for wine ${wine.id}: ${err.message}`);
    }
  }

  if (includeAwards) {
    try {
      context.awards = await awardsDb.prepare(`
        SELECT aws.competition_name AS competition, aws.year, ca.award
        FROM competition_awards ca
        JOIN award_sources aws ON aws.id = ca.source_id
        WHERE ca.matched_wine_id = $1
        ORDER BY aws.year DESC
        LIMIT 5
      `).all(wine.id);
    } catch {
      // Awards table may not exist — silently skip
    }
  }

  return context;
}

/**
 * Batch-build context for multiple wines — avoids N+1 queries.
 * Fetches all pairings and/or awards in single queries, then distributes into
 * the per-wine context map.
 *
 * @param {Object[]} wines - Array of wine DB records
 * @param {string} cellarId - Tenant scope
 * @param {Object} [options]
 * @param {boolean} [options.includePairings=false] - Batch-fetch food pairings
 * @param {boolean} [options.includeTastingNotes=false] - Parse structured tasting notes
 * @param {boolean} [options.includeAwards=false] - Batch-fetch competition awards
 * @returns {Promise<Map<number, Object>>} Map of wineId → enriched context
 */
export async function buildWineContextBatch(wines, cellarId, options = {}) {
  if (!wines || wines.length === 0) return new Map();

  const { includePairings = false, includeTastingNotes = false, includeAwards = false } = options;

  // Build base contexts from wine records (no DB round-trips)
  const contextMap = new Map();
  for (const wine of wines) {
    contextMap.set(wine.id, _buildBaseContext(wine, includeTastingNotes));
  }

  const wineIds = wines.map(w => w.id);

  // Single query: batch-fetch all food pairings, distribute by wine_id
  if (includePairings && wineIds.length > 0) {
    try {
      const placeholders = wineIds.map((_, i) => `$${i + 1}`).join(', ');
      const pairingsSql = `SELECT wine_id, pairing, source, user_rating
        FROM wine_food_pairings
        WHERE wine_id IN (${placeholders}) AND cellar_id = $${wineIds.length + 1}
        ORDER BY user_rating DESC NULLS LAST, created_at ASC`;
      const pairings = await db.prepare(pairingsSql).all(...wineIds, cellarId);

      for (const p of pairings) {
        const ctx = contextMap.get(p.wine_id);
        if (ctx) {
          ctx.food_pairings.push({ pairing: p.pairing, source: p.source, user_rating: p.user_rating });
        }
      }
    } catch (err) {
      logger.warn('WineContextBuilder', `Batch pairings fetch failed: ${err.message}`);
    }
  }

  // Single query: batch-fetch competition awards, distribute by matched_wine_id
  if (includeAwards && wineIds.length > 0) {
    try {
      const placeholders = wineIds.map((_, i) => `$${i + 1}`).join(', ');
      const awardsSql = `SELECT ca.matched_wine_id, aws.competition_name AS competition, aws.year, ca.award
        FROM competition_awards ca
        JOIN award_sources aws ON aws.id = ca.source_id
        WHERE ca.matched_wine_id IN (${placeholders})
        ORDER BY aws.year DESC`;
      const awards = await awardsDb.prepare(awardsSql).all(...wineIds);

      for (const a of awards) {
        const ctx = contextMap.get(a.matched_wine_id);
        if (ctx) {
          ctx.awards.push({ competition: a.competition, year: a.year, award: a.award });
        }
      }
    } catch {
      // Awards table may not exist — silently skip
    }
  }

  return contextMap;
}

/**
 * Format enriched context into a concise single-line string for AI prompts.
 * Suitable for appending to a wine entry in a Claude prompt.
 *
 * @param {Object} context - From buildWineContext() or a buildWineContextBatch() value
 * @returns {string}
 */
export function formatWineContextForPrompt(context) {
  const parts = [];

  // Core identity
  const identity = [
    `"${context.wine_name}"`,
    context.vintage ?? null,
    context.colour ?? null,
    context.style ?? null
  ].filter(v => v != null).join(' ');
  parts.push(identity);

  // Origin
  if (context.region || context.country) {
    parts.push([context.region, context.country].filter(Boolean).join(', '));
  }

  // Style descriptor from web search
  if (context.style_summary) {
    parts.push(context.style_summary);
  }

  // Food pairings (top 5, rated pairs get star emphasis)
  if (context.food_pairings && context.food_pairings.length > 0) {
    const pairingList = context.food_pairings.slice(0, 5).map(p => {
      const stars = p.user_rating ? '★'.repeat(Math.min(5, p.user_rating)) : null;
      return stars ? `${p.pairing} (${stars})` : p.pairing;
    }).join(', ');
    parts.push(`Pairs with: ${pairingList}`);
  }

  return parts.join(' | ');
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build the base context object from a wine DB record without any DB calls.
 * Parses tasting_notes_structured and extracted_awards defensively.
 *
 * @param {Object} wine - Wine DB record
 * @param {boolean} parseTastingNotes - Whether to parse tasting_notes_structured JSON
 * @returns {Object} Base context
 */
function _buildBaseContext(wine, parseTastingNotes) {
  const ctx = {
    id: wine.id,
    wine_name: wine.wine_name,
    vintage: wine.vintage ?? null,
    colour: wine.colour ?? null,
    style: wine.style ?? null,
    region: wine.region ?? null,
    country: wine.country ?? null,
    producer: wine.producer ?? null,
    grape_variety: wine.grape_variety ?? null,
    style_summary: wine.style_summary ?? null,
    producer_description: wine.producer_description ?? null,
    tasting_notes: wine.tasting_notes ?? null,
    tasting_notes_structured: null,
    extracted_awards: null,
    food_pairings: [],
    awards: []
  };

  // Defensive JSON parsing — fail open (return null, never throw)
  if (parseTastingNotes && wine.tasting_notes_structured) {
    try {
      ctx.tasting_notes_structured = typeof wine.tasting_notes_structured === 'string'
        ? JSON.parse(wine.tasting_notes_structured)
        : wine.tasting_notes_structured;
    } catch {
      logger.warn('WineContextBuilder', `Failed to parse tasting_notes_structured for wine ${wine.id}`);
    }
  }

  if (wine.extracted_awards) {
    try {
      ctx.extracted_awards = typeof wine.extracted_awards === 'string'
        ? JSON.parse(wine.extracted_awards)
        : wine.extracted_awards;
    } catch {
      // Invalid JSONB — silently ignore
    }
  }

  return ctx;
}
