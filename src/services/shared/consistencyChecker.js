/**
 * @fileoverview Wine data consistency checking service.
 * Advisory-only — never blocking. All logic wrapped defensively; returns null on internal error.
 * @module services/shared/consistencyChecker
 */

import { normalizeColour, normalizeGrape, parseGrapesField, keywordMatchesText } from '../../utils/wineNormalization.js';
import { getExpectedColours, findException } from '../../config/grapeColourMap.js';
import db from '../../db/index.js';

/** Colours that represent winemaking method, not grape colour. Fully exempt from checks. */
const METHOD_COLOURS = new Set(['sparkling', 'dessert', 'fortified']);

/** Keywords that indicate sparkling/dessert/fortified method even when stored as white/red. */
const METHOD_KEYWORDS = [
  'champagne', 'prosecco', 'cava', 'crémant', 'cremant',
  'sparkling', 'brut', 'spumante', 'sekt', 'cap classique',
  'mcc', 'méthode traditionnelle', 'methode cap classique',
  'mousseux', 'franciacorta', 'asti',
  'port', 'porto', 'sherry', 'madeira', 'marsala',
  'sauternes', 'tokaji', 'ice wine', 'eiswein', 'late harvest',
  'noble rot', 'botrytis', 'passito', 'recioto',
  'dessert', 'fortified',
];

/**
 * Check a single wine for grape/colour consistency.
 * Must never throw — returns null on any internal error.
 * @param {Object} wine - Wine data
 * @param {number} [wine.id] - Wine ID
 * @param {string} [wine.wine_name] - Wine name
 * @param {number} [wine.vintage] - Vintage year
 * @param {string} [wine.colour] - Wine colour
 * @param {string|string[]} [wine.grapes] - Grape(s)
 * @param {string} [wine.style] - Wine style
 * @returns {Object|null} Finding object or null if consistent/not checkable
 */
export function checkWineConsistency(wine) {
  try {
    if (!wine) return null;

    const colour = normalizeColour(wine.colour);
    if (!colour) return null;

    // Method-type colours fully exempt (R1-#4)
    if (METHOD_COLOURS.has(colour)) return null;

    // Rosé fully exempt — any grape can make rosé (R1-#5)
    if (colour === 'rose') return null;

    const grapes = parseGrapesField(wine.grapes);
    if (grapes.length === 0) return null;

    const wineName = wine.wine_name || '';
    const style = wine.style || '';
    const searchText = (wineName + ' ' + style).toLowerCase();

    // Method keyword bypass — catches "sparkling stored as white" etc.
    if (METHOD_KEYWORDS.some(k => keywordMatchesText(searchText, k))) return null;

    // Known exception bypass (Blanc de Noirs, orange wine, skin contact, etc.)
    if (findException(wineName, style)) return null;

    // Check each grape against expected colours
    const mismatches = [];
    const unknownGrapes = [];
    let suggestedColour = null;

    for (const rawGrape of grapes) {
      const canonical = normalizeGrape(rawGrape);
      if (!canonical) continue;

      const expected = getExpectedColours(canonical);
      if (!expected) {
        unknownGrapes.push(rawGrape);
        continue;
      }

      // Orange handling: allow white grapes for orange colour (skin-contact whites)
      if (colour === 'orange' && expected.has('white')) continue;

      if (!expected.has(colour)) {
        mismatches.push({
          grape: rawGrape,
          canonical,
          expectedColours: [...expected],
          actualColour: colour,
        });
        // Track the most likely correct colour
        if (!suggestedColour) {
          suggestedColour = [...expected][0];
        }
      }
    }

    // All grapes unknown → info severity (R1-#6)
    if (unknownGrapes.length > 0 && mismatches.length === 0 && unknownGrapes.length === grapes.length) {
      return {
        wineId: wine.id,
        wineName: wine.wine_name,
        vintage: wine.vintage,
        issue: 'unknown_grapes',
        severity: 'info',
        message: `All ${unknownGrapes.length} grape(s) are not in the known database`,
        details: {
          mismatches: [],
          unknownGrapes,
          currentColour: colour,
          suggestedColour: null,
        },
        suggestedFix: null,
      };
    }

    // No mismatches — consistent
    if (mismatches.length === 0) return null;

    // Determine severity: error if ALL known grapes mismatch, warning if partial
    const knownGrapeCount = grapes.length - unknownGrapes.length;
    const severity = mismatches.length >= knownGrapeCount ? 'error' : 'warning';

    return {
      wineId: wine.id,
      wineName: wine.wine_name,
      vintage: wine.vintage,
      issue: 'colour_mismatch',
      severity,
      message: severity === 'error'
        ? `${wine.wine_name || 'Wine'} is marked as '${colour}' but all known grapes suggest '${suggestedColour}'`
        : `${wine.wine_name || 'Wine'} is marked as '${colour}' but some grapes suggest a different colour`,
      details: {
        mismatches,
        unknownGrapes,
        currentColour: colour,
        suggestedColour,
      },
      suggestedFix: suggestedColour,
    };
  } catch {
    // Must never throw (R2-#11) — return null on any internal error
    return null;
  }
}

/**
 * Audit all wines in a cellar for consistency.
 * @param {number} cellarId - Cellar ID to audit
 * @param {Object} [options] - Audit options
 * @param {number} [options.limit=100] - Max results to return
 * @param {number} [options.offset=0] - Offset for pagination
 * @param {string} [options.severity] - Filter by severity (error, warning, info)
 * @param {boolean} [options.includeUnknown=false] - Include unknown grape findings
 * @returns {Promise<Object>} Audit results with findings, summary, pagination
 */
export async function auditCellar(cellarId, options = {}) {
  const { limit = 100, offset = 0, severity, includeUnknown = false } = options;

  // Query ALL wines to get accurate totalWines count, then filter in code
  const allWines = await db.prepare(`
    SELECT id, wine_name, vintage, colour, grapes, style
    FROM wines
    WHERE cellar_id = ?
    ORDER BY id
  `).all(cellarId);

  const allFindings = [];
  let skippedNoGrapes = 0;
  let unknownGrapeCount = 0;

  for (const wine of allWines) {
    // Skip wines with no grapes data
    if (!wine.grapes || wine.grapes.trim() === '') {
      skippedNoGrapes++;
      continue;
    }

    const finding = checkWineConsistency(wine);
    if (!finding) continue;

    if (finding.issue === 'unknown_grapes') {
      unknownGrapeCount += finding.details.unknownGrapes.length;
      if (!includeUnknown) continue;
    }

    if (severity && finding.severity !== severity) continue;

    allFindings.push(finding);
  }

  const checked = allWines.length - skippedNoGrapes;
  const total = allFindings.length;
  const paginated = allFindings.slice(offset, offset + limit);

  const errors = allFindings.filter(f => f.severity === 'error').length;
  const warnings = allFindings.filter(f => f.severity === 'warning').length;
  const infos = allFindings.filter(f => f.severity === 'info').length;

  return {
    data: paginated,
    summary: {
      totalWines: allWines.length,
      checked,
      skippedNoGrapes,
      issuesFound: total,
      errors,
      warnings,
      infos,
      unknownGrapeCount,
    },
    pagination: {
      limit,
      offset,
      total,
    },
  };
}
