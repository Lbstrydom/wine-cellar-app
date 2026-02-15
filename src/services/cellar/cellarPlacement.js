/**
 * @fileoverview Placement algorithm for cellar zone matching.
 * Determines the best zone for a wine and finds available slots.
 * @module services/cellar/cellarPlacement
 */

import { ZONE_PRIORITY_ORDER, getZoneById } from '../../config/cellarZones.js';
import { CONFIDENCE_THRESHOLDS, SCORING_WEIGHTS } from '../../config/cellarThresholds.js';
import { getZoneRows, allocateRowToZone, getActiveZoneMap } from './cellarAllocation.js';
import { grapeMatchesText } from '../../utils/wineNormalization.js';
import { isWhiteFamily, getCellarLayoutSettings, getDynamicColourRowRanges, LAYOUT_DEFAULTS } from '../shared/cellarLayoutSettings.js';

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

  // Grape match (word-boundary-aware to prevent overlap like "sauvignon" vs "cabernet sauvignon")
  if (rules.grapes && rules.grapes.length > 0) {
    possiblePoints += SCORING_WEIGHTS.grape;
    const grapeMatch = wine.grapes.find(g =>
      rules.grapes.some(rg => grapeMatchesText(g.toLowerCase(), rg.toLowerCase()))
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
      grapeMatchesText(dominantGrape.grape.toLowerCase(), g.toLowerCase())
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
  let {
    allowFallback = true,
    enforceAffinity = false,
    rootZoneId = zoneId,
    cellarId,
    fillDirection,
    colourOrder,
    _visited = new Set()
  } = options;

  // Resolve layout settings + dynamic row ranges on top-level call
  let whiteRows, redRows;
  if (cellarId && fillDirection === undefined && colourOrder === undefined) {
    try {
      const layoutSettings = await getCellarLayoutSettings(cellarId);
      fillDirection = layoutSettings.fillDirection;
      colourOrder = layoutSettings.colourOrder;
      const dynamic = await getDynamicColourRowRanges(cellarId, colourOrder);
      whiteRows = dynamic.whiteRows;
      redRows = dynamic.redRows;
      options = { ...options, fillDirection, colourOrder, whiteRows, redRows };
    } catch (err) {
      console.error('[findAvailableSlot] Failed to load layout settings, using defaults:', err.message);
      fillDirection = LAYOUT_DEFAULTS.fillDirection;
      colourOrder = LAYOUT_DEFAULTS.colourOrder;
      options = { ...options, fillDirection, colourOrder };
    }
  } else {
    whiteRows = options.whiteRows;
    redRows = options.redRows;
  }
  if (!fillDirection) fillDirection = 'left';
  if (!colourOrder) colourOrder = 'whites-top';

  const zone = getZoneById(zoneId);
  if (!zone) return null;

  if (_visited.has(zoneId)) return null;
  _visited.add(zoneId);

  const occupied = occupiedSlots instanceof Set ? occupiedSlots : new Set(occupiedSlots);

  // Standard zones - get or allocate rows
  if (!zone.isBufferZone && !zone.isFallbackZone && !zone.isCuratedZone) {
    let rows = await getZoneRows(zoneId, cellarId);

    // Filter zone rows against dynamic colour ranges to prevent
    // cross-colour-boundary moves (e.g., whites moving to red-region rows)
    if (rows.length > 0 && whiteRows && redRows) {
      const zoneColor = zone.color;
      const primaryColor = Array.isArray(zoneColor) ? zoneColor[0] : zoneColor;
      const zoneIsWhite = isWhiteFamily(primaryColor);
      const validRowNums = new Set(zoneIsWhite ? whiteRows : redRows);
      const filtered = rows.filter(r => {
        const num = parseInt(r.replace('R', ''), 10);
        return validRowNums.has(num);
      });
      rows = filtered; // Empty forces new allocation or overflow
    }

    // If zone has no rows yet, allocate one
    if (rows.length === 0) {
      try {
        const newRow = await allocateRowToZone(zoneId, cellarId);
        rows = [newRow];
      } catch (_err) {
        // No rows available - fall through to overflow
      }
    }

    if (rows.length > 0) {
      const slot = findSlotInRows(rows, occupied, fillDirection);
      if (slot) {
        return { slotId: slot, zoneId, isOverflow: false, requiresSwap: false };
      }
    }
  }

  // Buffer zones - find gaps in preferred row range
  // When enforceAffinity is true, only use rows not allocated to other zones
  if (zone.isBufferZone && zone.preferredRowRange) {
    const zoneMap = enforceAffinity ? await getActiveZoneMap(cellarId) : null;
    const allocatedRows = zoneMap ? new Set(Object.keys(zoneMap)) : new Set();

    for (const rowNum of zone.preferredRowRange) {
      const rowId = `R${rowNum}`;

      // If enforcing affinity, skip rows allocated to other zones
      if (enforceAffinity && allocatedRows.has(rowId)) {
        continue;
      }

      const slot = findSlotInRows([rowId], occupied, fillDirection);
      if (slot) {
        return { slotId: slot, zoneId, isOverflow: true, requiresSwap: false };
      }
    }
  }

  // Fallback/curated zones - search entire cellar
  if (zone.isFallbackZone || zone.isCuratedZone) {
    if (!allowFallback) return null;
    const slot = findAnyAvailableSlot(occupied, wine, fillDirection, colourOrder, whiteRows, redRows);
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
 * @param {string} [fillDirection='left'] - Fill from 'left' or 'right'
 * @returns {string|null} Slot ID or null
 */
function findSlotInRows(rows, occupiedSet, fillDirection = 'left') {
  const sortedRows = [...rows].sort((a, b) => {
    const numA = parseInt(a.replace('R', ''));
    const numB = parseInt(b.replace('R', ''));
    return numA - numB;
  });

  for (const row of sortedRows) {
    const maxCol = row === 'R1' ? 7 : 9;
    if (fillDirection === 'right') {
      for (let col = maxCol; col >= 1; col--) {
        const slotId = `${row}C${col}`;
        if (!occupiedSet.has(slotId)) {
          return slotId;
        }
      }
    } else {
      for (let col = 1; col <= maxCol; col++) {
        const slotId = `${row}C${col}`;
        if (!occupiedSet.has(slotId)) {
          return slotId;
        }
      }
    }
  }
  return null;
}

/**
 * Find any available slot in entire cellar (for fallback zones).
 * Uses dynamic row ranges when provided, falling back to even 50/50 split.
 * @param {Set} occupiedSet
 * @param {Object} wine - Wine object for color preference
 * @param {string} [fillDirection='left'] - Fill from 'left' or 'right'
 * @param {string} [colourOrder='whites-top'] - Colour ordering preference
 * @param {number[]} [dynWhiteRows] - Dynamic white-family row numbers
 * @param {number[]} [dynRedRows] - Dynamic red-family row numbers
 * @returns {string|null} Slot ID or null
 */
function findAnyAvailableSlot(occupiedSet, wine = null, fillDirection = 'left', colourOrder = 'whites-top', dynWhiteRows, dynRedRows) {
  // Use dynamic ranges if provided, otherwise fallback to full range split
  const allRows = Array.from({ length: 19 }, (_, i) => i + 1);
  let wRows = dynWhiteRows && dynWhiteRows.length > 0 ? dynWhiteRows : null;
  let rRows = dynRedRows && dynRedRows.length > 0 ? dynRedRows : null;
  if (!wRows || !rRows) {
    // Fallback: even split
    wRows = colourOrder === 'reds-top' ? allRows.slice(10) : allRows.slice(0, 10);
    rRows = colourOrder === 'reds-top' ? allRows.slice(0, 10) : allRows.slice(10);
  }

  let preferredRows, fallbackRows;
  const wineColour = wine?.color || wine?.colour || '';

  if (isWhiteFamily(wineColour)) {
    preferredRows = wRows;
    fallbackRows = rRows;
  } else {
    preferredRows = rRows;
    fallbackRows = wRows;
  }

  for (const rowNum of [...preferredRows, ...fallbackRows]) {
    const maxCol = rowNum === 1 ? 7 : 9;
    if (fillDirection === 'right') {
      for (let col = maxCol; col >= 1; col--) {
        const slotId = `R${rowNum}C${col}`;
        if (!occupiedSet.has(slotId)) {
          return slotId;
        }
      }
    } else {
      for (let col = 1; col <= maxCol; col++) {
        const slotId = `R${rowNum}C${col}`;
        if (!occupiedSet.has(slotId)) {
          return slotId;
        }
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
  const parsedGrapes = parseTextArray(wine.grapes);
  const parsedWinemaking = parseTextArray(wine.winemaking);

  return {
    name: wine.wine_name || wine.name || '',
    grapes: parsedGrapes.length > 0 ? parsedGrapes : extractGrapesFromText(wine),
    style: wine.style || '',
    color: wine.colour || wine.color || inferColor(wine),
    country: wine.country || '',
    region: wine.region || '',
    appellation: wine.appellation || '',
    winemaking: parsedWinemaking.length > 0 ? parsedWinemaking : extractWinemakingFromText(wine),
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
  if (typeof value !== 'string') return null;

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Parse text-array fields (grapes, winemaking) from JSON array, delimited text, or scalar values.
 * @param {unknown} value
 * @returns {string[]}
 */
function parseTextArray(value) {
  if (!value) return [];

  if (Array.isArray(value)) {
    return value.map(v => String(v).trim()).filter(Boolean);
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];

    const parsedJson = parseJsonArray(trimmed);
    if (parsedJson) {
      return parsedJson.map(v => String(v).trim()).filter(Boolean);
    }

    if (trimmed.includes(',') || trimmed.includes(';') || trimmed.includes('/')) {
      return trimmed
        .split(/[,;/]/)
        .map(part => part.trim())
        .filter(Boolean);
    }

    return [trimmed];
  }

  return [String(value)];
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

  const redPatterns = [
    /\bcabernet(\s+sauvignon)?\b/,
    /\bmerlot\b/,
    /\bshiraz\b/,
    /\bsyrah\b/,
    /\bpinot\s+noir\b/,
    /\btempranillo\b/,
    /\bsangiovese\b/,
    /\bnebbiolo\b/,
    /\bprimitivo\b/
  ];
  const whitePatterns = [
    /\bchardonnay\b/,
    /\bsauvignon\s+blanc\b/,
    /\bsauv\s+blanc\b/,
    /\briesling\b/,
    /\bchenin\b/,
    /\bpinot\s+grigio\b/,
    /\bgew(?:u|ü)rz/,
    /\bviognier\b/
  ];

  // Check reds first so "Cabernet Sauvignon" is never inferred as white.
  if (redPatterns.some(pattern => pattern.test(text))) return 'red';
  if (whitePatterns.some(pattern => pattern.test(text))) return 'white';

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
