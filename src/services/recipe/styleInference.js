/**
 * @fileoverview Style inference for buying guide items.
 * Infers the 11-bucket style ID from partial wine data using
 * grape detection and the pairing engine's style matcher.
 * @module services/recipe/styleInference
 */

import { matchWineToStyle } from '../pairing/pairingEngine.js';
import { detectGrapesFromWine } from '../wine/grapeEnrichment.js';
import { STYLE_LABELS } from '../../config/styleIds.js';
import logger from '../../utils/logger.js';

/**
 * Infer the style bucket for a buying guide item.
 *
 * Pipeline:
 * 1. If grapes missing → attempt grape detection from name/region
 * 2. If colour missing → infer from detected grapes (if any)
 * 3. Run matchWineToStyle() from pairing engine
 * 4. Return { styleId, confidence, label, matchedOn }
 *
 * @param {Object} item - Partial wine data
 * @param {string} item.wine_name - Wine name (required)
 * @param {string} [item.producer] - Producer name
 * @param {string} [item.colour] - Wine colour
 * @param {string} [item.grapes] - Grape varieties
 * @param {string} [item.region] - Wine region
 * @param {string} [item.country] - Country
 * @returns {{ styleId: string|null, confidence: string, label: string|null, matchedOn: string[] }}
 */
export function inferStyleForItem(item) {
  try {
    // Build a wine-like object for the matcher
    const wine = {
      wine_name: item.wine_name || '',
      colour: item.colour || null,
      grapes: item.grapes || null,
      style: null,
      region: item.region || null,
      country: item.country || null
    };

    // Step 1: Enrich grapes if missing
    if (!wine.grapes) {
      const detection = detectGrapesFromWine(wine);
      if (detection && detection.grapes) {
        wine.grapes = detection.grapes;
      }
    }

    // Step 2: Infer colour from grapes if missing
    if (!wine.colour && wine.grapes) {
      wine.colour = inferColourFromGrapes(wine.grapes);
    }

    // Step 3: Match to style bucket
    const match = matchWineToStyle(wine);

    if (!match) {
      return { styleId: null, confidence: 'low', label: null, matchedOn: [] };
    }

    return {
      styleId: match.styleId,
      confidence: match.confidence,
      label: STYLE_LABELS[match.styleId] || match.styleName,
      matchedOn: match.matchedBy || []
    };
  } catch (err) {
    logger.error('[styleInference] inference failed:', err.message);
    return { styleId: null, confidence: 'low', label: null, matchedOn: [] };
  }
}

/**
 * Known red grape varieties (lowercase).
 * @type {Set<string>}
 */
const RED_GRAPES = new Set([
  'cabernet sauvignon', 'merlot', 'pinot noir', 'syrah', 'shiraz',
  'malbec', 'tempranillo', 'sangiovese', 'nebbiolo', 'grenache',
  'garnacha', 'mourvèdre', 'mourvedre', 'pinotage', 'zinfandel',
  'primitivo', 'gamay', 'barbera', 'carignan', 'petit verdot',
  'cabernet franc', 'touriga nacional', 'cinsault', 'tannat'
]);

/**
 * Known white grape varieties (lowercase).
 * @type {Set<string>}
 */
const WHITE_GRAPES = new Set([
  'chardonnay', 'sauvignon blanc', 'riesling', 'pinot grigio',
  'pinot gris', 'chenin blanc', 'viognier', 'gewürztraminer',
  'gewurztraminer', 'albariño', 'albarino', 'verdejo', 'grüner veltliner',
  'gruner veltliner', 'torrontés', 'torrontes', 'vermentino',
  'muscadet', 'semillon', 'marsanne', 'roussanne', 'pinot blanc',
  'colombard', 'trebbiano', 'garganega', 'fiano', 'greco'
]);

/**
 * Infer colour from grape varieties string.
 * Returns 'Red', 'White', or null if ambiguous.
 * @param {string} grapes - Comma-separated grape names
 * @returns {string|null}
 */
function inferColourFromGrapes(grapes) {
  if (!grapes) return null;

  const parts = grapes.toLowerCase().split(',').map(g => g.trim()).filter(Boolean);
  let reds = 0;
  let whites = 0;

  for (const grape of parts) {
    if (RED_GRAPES.has(grape)) reds++;
    else if (WHITE_GRAPES.has(grape)) whites++;
  }

  if (reds > 0 && whites === 0) return 'Red';
  if (whites > 0 && reds === 0) return 'White';
  return null; // ambiguous or unknown
}
