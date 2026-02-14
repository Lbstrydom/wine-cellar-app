/**
 * @fileoverview Zone layout proposal service.
 * Generates optimal zone-to-row assignments based on current collection.
 * @module services/zone/zoneLayoutProposal
 */

import db from '../../db/index.js';
import { CELLAR_ZONES, ZONE_PRIORITY_ORDER, getZoneById } from '../../config/cellarZones.js';
import { grapeMatchesText } from '../../utils/wineNormalization.js';

// Cellar physical layout: 19 rows, row 1 has 7 slots, others have 9
const CELLAR_LAYOUT = {
  totalRows: 19,
  getRowCapacity: (rowNum) => rowNum === 1 ? 7 : 9,
  getTotalCapacity: () => 7 + (18 * 9) // 169 slots
};

/**
 * Normalize text-ish values (string, array, JSON-string) into lowercase searchable text.
 * @param {unknown} value
 * @returns {string}
 */
function toSearchableText(value) {
  if (Array.isArray(value)) {
    return value.map(v => String(v)).join(' ').toLowerCase();
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return '';

    if ((trimmed.startsWith('[') && trimmed.endsWith(']')) ||
        (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return parsed.map(v => String(v)).join(' ').toLowerCase();
        }
        if (typeof parsed === 'string') {
          return parsed.toLowerCase();
        }
      } catch {
        // Fall through to raw string normalization.
      }
    }

    return trimmed.toLowerCase();
  }

  if (value == null) return '';
  return String(value).toLowerCase();
}

/**
 * Parse assigned_rows from TEXT JSON or JSONB-decoded array.
 * @param {unknown} value
 * @returns {string[]}
 */
function parseAssignedRows(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value !== 'string') return [];

  const trimmed = value.trim();
  if (!trimmed) return [];

  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

/**
 * Get current bottle counts by zone (based on matching rules, not location).
 * @param {string} cellarId - Cellar ID for tenant isolation
 * @returns {Promise<Map<string, Object>>} Zone ID → { count, wines }
 */
async function getBottlesByZone(cellarId) {
  const wines = await db.prepare(`
    SELECT
      w.id, w.wine_name, w.vintage, w.colour, w.country, w.grapes,
      w.style, w.region, w.appellation, w.winemaking, w.sweetness,
      w.zone_id,
      s.location_code
    FROM wines w
    LEFT JOIN slots s ON s.wine_id = w.id AND s.cellar_id = ?
    WHERE w.cellar_id = ?
      AND s.location_code IS NOT NULL
      AND s.location_code LIKE 'R%'
  `).all(cellarId, cellarId);

  const zoneMap = new Map();

  // Initialize all zones
  CELLAR_ZONES.zones.forEach(zone => {
    zoneMap.set(zone.id, { count: 0, wines: [], zone });
  });

  // Classify each wine
  wines.forEach(wine => {
    const zoneId = wine.zone_id || classifyWine(wine);
    if (zoneMap.has(zoneId)) {
      const entry = zoneMap.get(zoneId);
      entry.count++;
      entry.wines.push(wine);
    }
  });

  return zoneMap;
}

/**
 * Classify a wine into a zone based on rules, using priority order.
 * @param {Object} wine - Wine object
 * @returns {string} Zone ID
 */
function classifyWine(wine) {
  const colour = toSearchableText(wine.colour);
  const grapes = toSearchableText(wine.grapes);
  const style = toSearchableText(wine.style);
  const country = toSearchableText(wine.country);
  const wineName = toSearchableText(wine.wine_name);
  const region = toSearchableText(wine.region);
  const winemaking = toSearchableText(wine.winemaking);
  const sweetness = toSearchableText(wine.sweetness);
  const searchText = `${wineName} ${style} ${region} ${winemaking}`;

  // Use priority order for classification
  for (const zoneId of ZONE_PRIORITY_ORDER) {
    const zone = getZoneById(zoneId);
    if (!zone) continue;

    const rules = zone.rules || {};

    // Special handling for dessert/fortified - require explicit markers
    if (zoneId === 'dessert_fortified') {
      // Must have dessert/fortified color, explicit sweetness, or very specific keywords
      const isDessertColour = colour === 'dessert' || colour === 'fortified';
      const hasExplicitSweetness = sweetness && (sweetness.includes('sweet') || sweetness.includes('dessert'));

      // Use word boundary regex to avoid false positives like "Portugal" matching "port"
      // Each keyword must be a complete word, not a substring
      const fortifiedPatterns = [
        /\bport\b/i,           // Port wine (not Portugal/Portuguese/Porto)
        /\btawny\b/i,          // Tawny Port
        /\bruby\b/i,           // Ruby Port (be careful, could match other things)
        /\blbv\b/i,            // Late Bottled Vintage
        /\bvintage\s+port\b/i, // Vintage Port
        /\bsherry\b/i,
        /\bmadeira\b/i,
        /\bmarsala\b/i,
        /\bsauternes\b/i,
        /\btokaji\b/i,
        /\bice\s*wine\b/i,
        /\beiswein\b/i,
        /\bpedro\s+xim[eé]nez\b/i,
        /\b(?:^|\s)px(?:\s|$)/i,  // PX as standalone
        /\blate\s+harvest\b/i,
        /\bbotrytis\b/i,
        /\bvin\s+santo\b/i,
        /\bmoscatel\b/i,        // Sweet Moscatel (different from dry Moscato)
        /\bpassito\b/i          // Italian dried grape sweet wines
      ];
      const hasFortifiedKeyword = fortifiedPatterns.some(pattern => pattern.test(searchText));

      if (isDessertColour || hasExplicitSweetness || hasFortifiedKeyword) {
        return zone.id;
      }
      // Skip this zone for normal dry wines
      continue;
    }

    // Check exclude keywords first (skip zone if any match)
    if (rules.excludeKeywords?.length > 0) {
      if (rules.excludeKeywords.some(k => searchText.includes(k.toLowerCase()))) {
        continue; // Skip this zone
      }
    }

    // Check winemaking match (high priority for appassimento, etc.)
    if (rules.winemaking?.length > 0) {
      if (rules.winemaking.some(w => winemaking.includes(w.toLowerCase()) || searchText.includes(w.toLowerCase()))) {
        return zone.id;
      }
    }

    // Check grape match (word-boundary-aware to prevent e.g. "sauvignon" matching "cabernet sauvignon")
    if (rules.grapes?.length > 0) {
      if (rules.grapes.some(g => grapeMatchesText(grapes, g.toLowerCase()))) {
        return zone.id;
      }
    }

    // Check keyword match
    if (rules.keywords?.length > 0) {
      if (rules.keywords.some(k => searchText.includes(k.toLowerCase()))) {
        return zone.id;
      }
    }

    // Check country match (only if it's a primary rule, not just supporting)
    if (rules.countries?.length > 0 && !rules.grapes?.length && !rules.keywords?.length) {
      if (rules.countries.some(c => country.includes(c.toLowerCase()))) {
        return zone.id;
      }
    }
  }

  // Default to buffer zones based on colour
  if (colour === 'white' || colour === 'rose' || colour === 'sparkling') {
    return 'white_buffer';
  }
  return 'red_buffer';
}

/**
 * Propose optimal zone layout based on collection.
 * @param {string} cellarId - Cellar ID for tenant isolation
 * @returns {Promise<Object>} Proposed layout with zone assignments
 */
export async function proposeZoneLayout(cellarId) {
  const bottlesByZone = await getBottlesByZone(cellarId);

  // Sort zones by preferred row order (whites first, then reds)
  const zoneOrder = [
    // Whites (rows 1-7)
    'sauvignon_blanc', 'chenin_blanc', 'aromatic_whites', 'chardonnay',
    'loire_light', 'rose_sparkling', 'dessert_fortified',
    // Transitional (rows 8-9)
    'white_buffer',
    // Reds - Iberian (rows 10-11)
    'iberian_fresh', 'rioja_ribera', 'portugal',
    // Reds - French (rows 12-13)
    'southern_france', 'pinot_noir',
    // Reds - Italian (rows 14-16)
    'romagna_tuscany', 'piedmont', 'puglia_primitivo', 'appassimento',
    // Reds - New World (rows 17-19)
    'cabernet', 'sa_blends', 'shiraz', 'chile_argentina',
    // Overflow
    'red_buffer', 'curiosities', 'unclassified'
  ];

  // Calculate required rows per zone
  const proposals = [];
  let currentRow = 1;

  zoneOrder.forEach(zoneId => {
    const entry = bottlesByZone.get(zoneId);
    if (!entry || entry.count === 0) return; // Skip empty zones

    const zone = entry.zone;
    const bottleCount = entry.count;

    // Calculate rows needed (round up)
    let slotsNeeded = bottleCount;
    const assignedRows = [];
    let totalCapacity = 0;

    while (slotsNeeded > 0 && currentRow <= CELLAR_LAYOUT.totalRows) {
      const capacity = CELLAR_LAYOUT.getRowCapacity(currentRow);
      assignedRows.push(`R${currentRow}`);
      totalCapacity += capacity;
      slotsNeeded -= capacity;
      currentRow++;
    }

    proposals.push({
      zoneId,
      displayName: zone?.displayName || zoneId,
      bottleCount,
      assignedRows,
      totalCapacity,
      utilizationPercent: Math.round((bottleCount / totalCapacity) * 100),
      wines: entry.wines.map(w => ({
        id: w.id,
        name: w.wine_name,
        vintage: w.vintage,
        currentSlot: w.location_code
      }))
    });
  });

  return {
    timestamp: new Date().toISOString(),
    totalBottles: Array.from(bottlesByZone.values()).reduce((sum, e) => sum + e.count, 0),
    totalRows: currentRow - 1,
    proposals,
    unassignedRows: currentRow <= 19 ?
      Array.from({length: 19 - currentRow + 1}, (_, i) => `R${currentRow + i}`) : []
  };
}

/**
 * Save confirmed zone layout to database.
 * @param {Array} assignments - Array of { zoneId, assignedRows }
 * @param {string} cellarId - Cellar ID for tenant isolation
 */
export async function saveZoneLayout(assignments, cellarId) {
  // Clear existing allocations for this cellar
  await db.prepare('DELETE FROM zone_allocations WHERE cellar_id = ?').run(cellarId);

  // Insert new allocations
  for (const { zoneId, assignedRows, bottleCount } of assignments) {
    await db.prepare(`
      INSERT INTO zone_allocations (cellar_id, zone_id, assigned_rows, wine_count, first_wine_date, updated_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run(cellarId, zoneId, JSON.stringify(assignedRows), bottleCount || 0);
  }
}

/**
 * Get current saved zone layout.
 * @param {string} cellarId - Cellar ID for tenant isolation
 * @returns {Promise<Array>} Zone allocations
 */
export async function getSavedZoneLayout(cellarId) {
  const rows = await db.prepare(`
    SELECT zone_id, assigned_rows, wine_count, updated_at
    FROM zone_allocations
    WHERE cellar_id = ?
    ORDER BY zone_id
  `).all(cellarId);

  return rows.map(row => ({
    zoneId: row.zone_id,
    assignedRows: parseAssignedRows(row.assigned_rows),
    wineCount: row.wine_count,
    updatedAt: row.updated_at
  }));
}

/**
 * Generate specific moves to consolidate wines into their assigned zones.
 * @param {string} cellarId - Cellar ID for tenant isolation
 * @returns {Promise<Object>} Move instructions
 */
export async function generateConsolidationMoves(cellarId) {
  const layout = await getSavedZoneLayout(cellarId);
  if (layout.length === 0) {
    return { error: 'No zone layout configured. Please confirm a zone layout first.' };
  }

  // Build zone → rows mapping
  const zoneRows = new Map();
  layout.forEach(z => {
    zoneRows.set(z.zoneId, z.assignedRows);
  });

  // Get all wines with their current locations
  const wines = await db.prepare(`
    SELECT
      w.id, w.wine_name, w.vintage, w.zone_id,
      s.location_code as current_slot
    FROM wines w
    JOIN slots s ON s.wine_id = w.id AND s.cellar_id = ?
    WHERE w.cellar_id = ?
      AND s.location_code LIKE 'R%'
  `).all(cellarId, cellarId);

  // Get all empty slots
  const emptySlotsResult = await db.prepare(`
    SELECT location_code
    FROM slots
    WHERE cellar_id = ? AND wine_id IS NULL AND location_code LIKE 'R%'
    ORDER BY location_code
  `).all(cellarId);
  const emptySlots = emptySlotsResult.map(s => s.location_code);

  const moves = [];
  const usedSlots = new Set();

  // For each wine, check if it's in the correct zone
  wines.forEach(wine => {
    const zoneId = wine.zone_id || classifyWine(wine);
    const targetRows = zoneRows.get(zoneId) || [];

    if (targetRows.length === 0) return; // No assigned rows for this zone

    const currentRow = wine.current_slot?.match(/R(\d+)/)?.[0];

    // Check if already in correct zone
    if (targetRows.includes(currentRow)) {
      return; // Already in place
    }

    // Find empty slot in target zone
    const targetSlot = emptySlots.find(slot => {
      const row = slot.match(/R(\d+)/)?.[0];
      return targetRows.includes(row) && !usedSlots.has(slot);
    });

    if (targetSlot) {
      usedSlots.add(targetSlot);
      moves.push({
        wineId: wine.id,
        wineName: wine.wine_name,
        vintage: wine.vintage,
        zoneId,
        fromSlot: wine.current_slot,
        toSlot: targetSlot,
        reason: `Move to ${zoneId} zone (${targetRows.join(', ')})`
      });
    }
  });

  // Group moves by target zone for easier execution
  const movesByZone = {};
  moves.forEach(move => {
    if (!movesByZone[move.zoneId]) {
      movesByZone[move.zoneId] = [];
    }
    movesByZone[move.zoneId].push(move);
  });

  return {
    totalMoves: moves.length,
    movesByZone,
    moves
  };
}
