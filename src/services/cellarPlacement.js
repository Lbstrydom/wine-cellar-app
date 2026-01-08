/**
 * @fileoverview Placement algorithm for cellar zone matching.
 * Determines the best zone for a wine and finds available slots.
 * @module services/cellarPlacement
 */

import { ZONE_PRIORITY_ORDER, getZoneById } from '../config/cellarZones.js';
import { CONFIDENCE_THRESHOLDS, SCORING_WEIGHTS } from '../config/cellarThresholds.js';
import { getZoneRows, allocateRowToZone, getActiveZoneMap } from './cellarAllocation.js';

/**
 * Determine the best zone for a wine based on its attributes.
 * @param {Object} wine - Wine object with canonical fields
 * @returns {Object} Zone match result with confidence and alternatives
 */
export function findBestZone(wine) {
  const normalizedWine = normalizeWineAttributes(wine);
  const matches = [];

  for (const zoneId of ZONE_PRIORITY_ORDER) {
    const zone = getZoneById(zoneId);
    if (!zone) continue;

    // Skip buffer/fallback zones in primary matching
    if (zone.isBufferZone || zone.isFallbackZone) continue;

    const matchResult = calculateZoneMatch(normalizedWine, zone);

    if (matchResult.score > 0) {
      matches.push({
        zoneId,
        zone,
        score: matchResult.score,
        matchedOn: matchResult.matchedOn
      });
    }
  }

  matches.sort((a, b) => b.score - a.score);

  // If no matches, check curiosities then fallback
  if (matches.length === 0) {
    const curiositiesZone = getZoneById('curiosities');
    if (curiositiesZone) {
      const curiositiesMatch = calculateZoneMatch(normalizedWine, curiositiesZone);

      if (curiositiesMatch.score > 30) {
        return {
          zoneId: 'curiosities',
          displayName: 'Curiosities',
          confidence: 'medium',
          score: curiositiesMatch.score,
          reason: `Unusual variety/region: ${curiositiesMatch.matchedOn.join(', ')}`,
          alternativeZones: [],
          requiresReview: false
        };
      }
    }

    return {
      zoneId: 'unclassified',
      displayName: 'Unclassified',
      confidence: 'low',
      score: 0,
      reason: 'No matching zone found - requires manual classification',
      alternativeZones: [],
      requiresReview: true
    };
  }

  const best = matches[0];
  const confidence = calculateConfidence(best.score, matches);

  return {
    zoneId: best.zoneId,
    displayName: best.zone.displayName,
    confidence,
    score: best.score,
    reason: `Matched on: ${best.matchedOn.join(', ')}`,
    alternativeZones: matches.slice(1, 4).map(m => ({
      zoneId: m.zoneId,
      displayName: m.zone.displayName,
      score: m.score,
      matchedOn: m.matchedOn
    })),
    requiresReview: confidence === 'low'
  };
}

/**
 * Calculate how well a wine matches a zone's rules.
 * @param {Object} wine - Normalized wine object
 * @param {Object} zone - Zone configuration
 * @returns {Object} Match result with score and matched criteria
 */
function calculateZoneMatch(wine, zone) {
  const rules = zone.rules;
  if (!rules) return { score: 0, matchedOn: [] };

  let earnedPoints = 0;
  let possiblePoints = 0;
  const matchedOn = [];

  // Color match
  if (zone.color) {
    possiblePoints += SCORING_WEIGHTS.color;
    const zoneColors = Array.isArray(zone.color) ? zone.color : [zone.color];
    if (wine.color && zoneColors.includes(wine.color.toLowerCase())) {
      earnedPoints += SCORING_WEIGHTS.color;
      matchedOn.push(`color: ${wine.color}`);
    } else if (wine.color && !zoneColors.includes(wine.color.toLowerCase())) {
      return { score: 0, matchedOn: [] }; // Wrong color = disqualify
    }
  }

  // Grape match
  if (rules.grapes && rules.grapes.length > 0) {
    possiblePoints += SCORING_WEIGHTS.grape;
    const grapeMatch = wine.grapes.find(g =>
      rules.grapes.some(rg => g.toLowerCase().includes(rg.toLowerCase()))
    );
    if (grapeMatch) {
      earnedPoints += SCORING_WEIGHTS.grape;
      matchedOn.push(`grape: ${grapeMatch}`);
    }
  }

  // Keyword match
  if (rules.keywords && rules.keywords.length > 0) {
    possiblePoints += SCORING_WEIGHTS.keyword;
    const searchText = `${wine.name} ${wine.style} ${wine.appellation}`.toLowerCase();
    const keywordMatch = rules.keywords.find(k => searchText.includes(k.toLowerCase()));
    if (keywordMatch) {
      earnedPoints += SCORING_WEIGHTS.keyword;
      matchedOn.push(`keyword: ${keywordMatch}`);
    }
  }

  // Country match
  if (rules.countries && rules.countries.length > 0) {
    possiblePoints += SCORING_WEIGHTS.country;
    if (wine.country && rules.countries.some(c =>
      wine.country.toLowerCase() === c.toLowerCase()
    )) {
      earnedPoints += SCORING_WEIGHTS.country;
      matchedOn.push(`country: ${wine.country}`);
    }
  }

  // Region match
  if (rules.regions && rules.regions.length > 0) {
    possiblePoints += SCORING_WEIGHTS.region;
    if (wine.region && rules.regions.some(r =>
      wine.region.toLowerCase().includes(r.toLowerCase())
    )) {
      earnedPoints += SCORING_WEIGHTS.region;
      matchedOn.push(`region: ${wine.region}`);
    }
  }

  // Appellation match
  if (rules.appellations && rules.appellations.length > 0) {
    possiblePoints += SCORING_WEIGHTS.appellation;
    if (wine.appellation && rules.appellations.some(a =>
      wine.appellation.toLowerCase().includes(a.toLowerCase())
    )) {
      earnedPoints += SCORING_WEIGHTS.appellation;
      matchedOn.push(`appellation: ${wine.appellation}`);
    }
  }

  // Winemaking match
  if (rules.winemaking && rules.winemaking.length > 0) {
    possiblePoints += SCORING_WEIGHTS.winemaking;
    const wmMatch = wine.winemaking.find(wm =>
      rules.winemaking.some(rwm => wm.toLowerCase().includes(rwm.toLowerCase()))
    );
    if (wmMatch) {
      earnedPoints += SCORING_WEIGHTS.winemaking;
      matchedOn.push(`winemaking: ${wmMatch}`);
    }
  }

  // Exclusion checks - disqualify if matched
  if (rules.excludeKeywords) {
    const searchText = `${wine.name} ${wine.style} ${wine.appellation}`.toLowerCase();
    if (rules.excludeKeywords.some(k => searchText.includes(k.toLowerCase()))) {
      return { score: 0, matchedOn: [] };
    }
  }

  if (rules.excludeRegions && wine.region) {
    if (rules.excludeRegions.some(r => wine.region.toLowerCase().includes(r.toLowerCase()))) {
      return { score: 0, matchedOn: [] };
    }
  }

  if (rules.excludeWinemaking && wine.winemaking.length > 0) {
    if (rules.excludeWinemaking.some(wm =>
      wine.winemaking.some(wwm => wwm.toLowerCase().includes(wm.toLowerCase()))
    )) {
      return { score: 0, matchedOn: [] };
    }
  }

  // Minimum grape percentage check (for single-varietal zones)
  if (rules.minGrapePercent && wine.grapePercentages && wine.grapePercentages.length > 0) {
    const dominantGrape = wine.grapePercentages[0];
    const matchesZoneGrape = rules.grapes?.some(g =>
      dominantGrape.grape.toLowerCase().includes(g.toLowerCase())
    );
    if (matchesZoneGrape && dominantGrape.percent < rules.minGrapePercent) {
      return { score: 0, matchedOn: [] };
    }
  }

  // Minimum number of grapes check (for blend zones)
  if (rules.minGrapes && wine.grapes.length < rules.minGrapes) {
    return { score: 0, matchedOn: [] };
  }

  // Calculate final score (0-100), capped
  const score = possiblePoints > 0
    ? Math.min(100, Math.round((earnedPoints / possiblePoints) * 100))
    : 0;

  return { score, matchedOn };
}

/**
 * Calculate confidence based on score and alternatives.
 * @param {number} bestScore
 * @param {Array} allMatches
 * @returns {string} 'high' | 'medium' | 'low'
 */
function calculateConfidence(bestScore, allMatches) {
  if (bestScore >= CONFIDENCE_THRESHOLDS.high) {
    if (allMatches.length === 1 ||
        allMatches[1].score < bestScore - CONFIDENCE_THRESHOLDS.clearWinnerMargin) {
      return 'high';
    }
    return 'medium';
  }
  if (bestScore >= CONFIDENCE_THRESHOLDS.medium) {
    return 'medium';
  }
  return 'low';
}

/**
 * Find an available slot for a wine in a zone.
 * @param {string} zoneId
 * @param {Array|Set} occupiedSlots - Currently occupied slot IDs
 * @param {Object} wine - Wine object (for color-based preference in fallback)
 * @returns {Promise<Object|null>} Slot placement result
 */
export async function findAvailableSlot(zoneId, occupiedSlots, wine = null) {
  let options = arguments.length > 3 ? arguments[3] : undefined;
  if (!options) options = {};
  const {
    allowFallback = true,
    enforceAffinity = false,
    rootZoneId = zoneId,
    _visited = new Set()
  } = options;

  const zone = getZoneById(zoneId);
  if (!zone) return null;

  if (_visited.has(zoneId)) return null;
  _visited.add(zoneId);

  const occupied = occupiedSlots instanceof Set ? occupiedSlots : new Set(occupiedSlots);

  // Standard zones - get or allocate rows
  if (!zone.isBufferZone && !zone.isFallbackZone && !zone.isCuratedZone) {
    let rows = await getZoneRows(zoneId);

    // If zone has no rows yet, allocate one
    if (rows.length === 0) {
      try {
        const newRow = await allocateRowToZone(zoneId);
        rows = [newRow];
      } catch (_err) {
        // No rows available - fall through to overflow
      }
    }

    if (rows.length > 0) {
      const slot = findSlotInRows(rows, occupied);
      if (slot) {
        return { slotId: slot, zoneId, isOverflow: false, requiresSwap: false };
      }
    }
  }

  // Buffer zones - find gaps in preferred row range
  // When enforceAffinity is true, only use rows not allocated to other zones
  if (zone.isBufferZone && zone.preferredRowRange) {
    const zoneMap = enforceAffinity ? await getActiveZoneMap() : null;
    const allocatedRows = zoneMap ? new Set(Object.keys(zoneMap)) : new Set();

    for (const rowNum of zone.preferredRowRange) {
      const rowId = `R${rowNum}`;

      // If enforcing affinity, skip rows allocated to other zones
      if (enforceAffinity && allocatedRows.has(rowId)) {
        continue;
      }

      const slot = findSlotInRows([rowId], occupied);
      if (slot) {
        return { slotId: slot, zoneId, isOverflow: true, requiresSwap: false };
      }
    }
  }

  // Fallback/curated zones - search entire cellar
  if (zone.isFallbackZone || zone.isCuratedZone) {
    if (!allowFallback) return null;
    const slot = findAnyAvailableSlot(occupied, wine);
    if (slot) {
      return { slotId: slot, zoneId, isOverflow: true, requiresSwap: false };
    }
  }

  // Try overflow zone chain
  if (zone.overflowZoneId) {
    const overflowZoneId = zone.overflowZoneId;
    if (enforceAffinity) {
      const rootZone = getZoneById(rootZoneId);
      const overflowZone = getZoneById(overflowZoneId);
      if (!isSensibleOverflow(rootZone, overflowZone, wine)) {
        return null;
      }
    }

    const overflowResult = await findAvailableSlot(overflowZoneId, occupied, wine, {
      ...options,
      rootZoneId,
      _visited
    });
    if (overflowResult) {
      const overflowPath = overflowResult.overflowPath || [];
      return {
        ...overflowResult,
        isOverflow: true,
        overflowPath: [zoneId, ...overflowPath]
      };
    }
  }

  return null;
}

/**
 * Determine whether overflowing from one zone into another is "sensible".
 * This is intentionally conservative: it allows buffer zones by colour,
 * or direct rule overlap (grape/country/region/winemaking/keywords).
 * @param {Object|undefined} fromZone
 * @param {Object|undefined} toZone
 * @param {Object|null} wine
 * @returns {boolean}
 */
function isSensibleOverflow(fromZone, toZone, wine) {
  if (!fromZone || !toZone) return false;
  if (fromZone.id === toZone.id) return true;

  // Buffer zones are acceptable if colour matches.
  if (toZone.isBufferZone) {
    return zonesShareColour(fromZone, toZone, wine);
  }

  // Never treat the global fallback as a "sensible" overflow.
  if (toZone.isFallbackZone) return false;

  // If zones share colour and have any direct rule overlap, allow.
  if (!zonesShareColour(fromZone, toZone, wine)) return false;

  const fromTokens = getZoneAffinityTokens(fromZone);
  const toTokens = getZoneAffinityTokens(toZone);
  for (const t of fromTokens) {
    if (toTokens.has(t)) return true;
  }

  return false;
}

function zonesShareColour(fromZone, toZone, wine) {
  const fromColours = normalizeColours(fromZone.color);
  const toColours = normalizeColours(toZone.color);

  // If a wine is provided, use its inferred colour as a tie-breaker.
  const wineColour = (wine?.colour || wine?.color || '').toLowerCase();
  if (wineColour && toColours.has(wineColour) && fromColours.has(wineColour)) {
    return true;
  }

  for (const c of fromColours) {
    if (toColours.has(c)) return true;
  }
  return false;
}

function normalizeColours(color) {
  if (!color) return new Set();
  const arr = Array.isArray(color) ? color : [color];
  return new Set(arr.map(c => String(c).toLowerCase()));
}

function getZoneAffinityTokens(zone) {
  const rules = zone.rules || {};
  const tokens = new Set();

  addTokens(tokens, rules.grapes, 'grape');
  addTokens(tokens, rules.countries, 'country');
  addTokens(tokens, rules.regions, 'region');
  addTokens(tokens, rules.appellations, 'appellation');
  addTokens(tokens, rules.winemaking, 'winemaking');
  addTokens(tokens, rules.keywords, 'keyword');

  return tokens;
}

function addTokens(tokenSet, values, prefix) {
  if (!Array.isArray(values)) return;
  for (const v of values) {
    if (!v) continue;
    tokenSet.add(`${prefix}:${String(v).toLowerCase().trim()}`);
  }
}

/**
 * Find first available slot in given rows.
 * @param {string[]} rows - Row IDs to search
 * @param {Set} occupiedSet - Set of occupied slot IDs
 * @returns {string|null} Slot ID or null
 */
function findSlotInRows(rows, occupiedSet) {
  const sortedRows = [...rows].sort((a, b) => {
    const numA = parseInt(a.replace('R', ''));
    const numB = parseInt(b.replace('R', ''));
    return numA - numB;
  });

  for (const row of sortedRows) {
    for (let col = 1; col <= 9; col++) {
      const slotId = `${row}C${col}`;
      if (!occupiedSet.has(slotId)) {
        return slotId;
      }
    }
  }
  return null;
}

/**
 * Find any available slot in entire cellar (for fallback zones).
 * @param {Set} occupiedSet
 * @param {Object} wine - Wine object for color preference
 * @returns {string|null} Slot ID or null
 */
function findAnyAvailableSlot(occupiedSet, wine = null) {
  let preferredRows, fallbackRows;

  if (wine?.color === 'white' || wine?.color === 'rose' || wine?.color === 'sparkling' ||
      wine?.color === 'dessert' || wine?.color === 'fortified') {
    preferredRows = [1, 2, 3, 4, 5, 6, 7];
    fallbackRows = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
  } else {
    preferredRows = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
    fallbackRows = [1, 2, 3, 4, 5, 6, 7];
  }

  for (const rowNum of [...preferredRows, ...fallbackRows]) {
    for (let col = 1; col <= 9; col++) {
      const slotId = `R${rowNum}C${col}`;
      if (!occupiedSet.has(slotId)) {
        return slotId;
      }
    }
  }

  return null;
}

/**
 * Normalize wine attributes for matching.
 * @param {Object} wine - Raw wine object
 * @returns {Object} Normalized wine object
 */
function normalizeWineAttributes(wine) {
  return {
    name: wine.wine_name || wine.name || '',
    grapes: parseJsonArray(wine.grapes) || extractGrapesFromText(wine),
    style: wine.style || '',
    color: wine.colour || wine.color || inferColor(wine),
    country: wine.country || '',
    region: wine.region || '',
    appellation: wine.appellation || '',
    winemaking: parseJsonArray(wine.winemaking) || extractWinemakingFromText(wine),
    sweetness: wine.sweetness || 'dry',
    grapePercentages: parseJsonArray(wine.grapePercentages) || [],
    vintage: wine.vintage
  };
}

/**
 * Parse a JSON array from string or return array as-is.
 * @param {*} value
 * @returns {Array|null}
 */
function parseJsonArray(value) {
  if (!value) return null;
  if (Array.isArray(value)) return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/**
 * Infer wine color from name and style.
 * @param {Object} wine
 * @returns {string|null}
 */
function inferColor(wine) {
  const text = `${wine.wine_name || ''} ${wine.style || ''}`.toLowerCase();

  if (text.includes('rosé') || text.includes('rose') || text.includes('rosado')) return 'rose';
  if (text.includes('sparkling') || text.includes('champagne') || text.includes('prosecco') ||
      text.includes('cava') || text.includes('crémant')) return 'sparkling';
  if (text.includes('port') || text.includes('sherry') || text.includes('madeira')) return 'fortified';

  const whiteGrapes = ['chardonnay', 'sauvignon', 'riesling', 'chenin', 'pinot grigio', 'gewürz', 'viognier'];
  const redGrapes = ['cabernet', 'merlot', 'shiraz', 'syrah', 'pinot noir', 'tempranillo', 'sangiovese', 'nebbiolo', 'primitivo'];

  if (whiteGrapes.some(g => text.includes(g))) return 'white';
  if (redGrapes.some(g => text.includes(g))) return 'red';

  return null;
}

/**
 * Extract grape varieties from wine name/style text.
 * @param {Object} wine
 * @returns {string[]}
 */
function extractGrapesFromText(wine) {
  const grapePatterns = [
    'sauvignon blanc', 'chenin blanc', 'chardonnay', 'riesling',
    'gewürztraminer', 'gewurztraminer', 'viognier', 'malvasia', 'albariño', 'albarino',
    'cabernet sauvignon', 'merlot', 'pinot noir', 'shiraz', 'syrah',
    'tempranillo', 'garnacha', 'grenache', 'sangiovese', 'nebbiolo',
    'primitivo', 'negroamaro', 'corvina', 'barbera', 'dolcetto',
    'touriga nacional', 'saperavi', 'malbec', 'carmenere', 'carmenère', 'pinotage',
    'cabernet franc', 'petit verdot', 'mourvedre', 'mourvèdre', 'cinsault'
  ];
  const text = `${wine.wine_name || ''} ${wine.style || ''}`.toLowerCase();
  return grapePatterns.filter(grape => text.includes(grape));
}

/**
 * Extract winemaking methods from wine name/style text.
 * @param {Object} wine
 * @returns {string[]}
 */
function extractWinemakingFromText(wine) {
  const wmPatterns = ['appassimento', 'ripasso', 'oak', 'unoaked', 'organic', 'biodynamic', 'reserve', 'reserva'];
  const text = `${wine.wine_name || ''} ${wine.style || ''}`.toLowerCase();
  return wmPatterns.filter(wm => text.includes(wm));
}

/**
 * Recommend placement for a new bottle being added.
 * Returns both zone and specific slot suggestion.
 * @param {Object} wine - Wine object with attributes
 * @param {Set<string>} occupiedSlots - Currently occupied slot IDs
 * @returns {Promise<Object>} Placement recommendation with zone, slot, and rationale
 */
export async function recommendPlacement(wine, occupiedSlots) {
  // Find best zone match
  const zoneMatch = findBestZone(wine);
  
  // Find available slot in that zone
  const slotSuggestion = await findAvailableSlot(zoneMatch.zoneId, occupiedSlots, wine);
  
  // Build comprehensive recommendation
  const recommendation = {
    wine: {
      id: wine.id,
      name: wine.wine_name,
      vintage: wine.vintage
    },
    zone: {
      id: zoneMatch.zoneId,
      displayName: zoneMatch.displayName,
      confidence: zoneMatch.confidence,
      score: zoneMatch.score,
      reason: zoneMatch.reason,
      alternatives: zoneMatch.alternativeZones || []
    },
    slot: slotSuggestion ? {
      slotId: slotSuggestion.slotId,
      row: slotSuggestion.row,
      isOverflow: slotSuggestion.isOverflow || false,
      message: slotSuggestion.isOverflow 
        ? `${zoneMatch.displayName} is full - suggested overflow location`
        : `Available in ${zoneMatch.displayName}`
    } : {
      slotId: null,
      message: `${zoneMatch.displayName} and overflow zones are full - manual placement required`
    },
    requiresReview: zoneMatch.requiresReview || !slotSuggestion
  };
  
  return recommendation;
}
