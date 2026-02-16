/**
 * @fileoverview Zone layout proposal service.
 * Generates optimal zone-to-row assignments based on current collection.
 * @module services/zone/zoneLayoutProposal
 */

import db from '../../db/index.js';
import { CELLAR_ZONES } from '../../config/cellarZones.js';
import { getCellarLayoutSettings } from '../shared/cellarLayoutSettings.js';
import { findBestZone } from '../cellar/cellarPlacement.js';

// Cellar physical layout: 19 rows, row 1 has 7 slots, others have 9
const CELLAR_LAYOUT = {
  totalRows: 19,
  getRowCapacity: (rowNum) => rowNum === 1 ? 7 : 9,
  getTotalCapacity: () => 7 + (18 * 9) // 169 slots
};

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
 * Classify a wine into a zone using the scored classifier (findBestZone).
 *
 * Previously this was an independent first-match implementation that could
 * disagree with findBestZone (used by analysis). Unifying them ensures
 * layout proposals and analysis produce identical classifications.
 *
 * @param {Object} wine - Wine object
 * @returns {string} Zone ID
 */
function classifyWine(wine) {
  const result = findBestZone(wine);
  return result.zoneId;
}

/**
 * Propose optimal zone layout based on collection.
 * @param {string} cellarId - Cellar ID for tenant isolation
 * @returns {Promise<Object>} Proposed layout with zone assignments
 */
export async function proposeZoneLayout(cellarId) {
  const bottlesByZone = await getBottlesByZone(cellarId);
  const layoutSettings = await getCellarLayoutSettings(cellarId);
  const isRedsTop = layoutSettings.colourOrder === 'reds-top';

  // Zone groups by colour family
  const whiteZones = [
    'sauvignon_blanc', 'chenin_blanc', 'aromatic_whites', 'chardonnay',
    'loire_light', 'rose_sparkling', 'dessert_fortified',
    'white_buffer'
  ];
  const redZones = [
    'iberian_fresh', 'rioja_ribera', 'portugal',
    'southern_france', 'pinot_noir',
    'romagna_tuscany', 'piedmont', 'puglia_primitivo', 'appassimento',
    'cabernet', 'sa_blends', 'shiraz', 'chile_argentina',
    'red_buffer', 'curiosities', 'unclassified'
  ];

  // Respect colourOrder setting: whites-top or reds-top
  const zoneOrder = isRedsTop
    ? [...redZones, ...whiteZones]
    : [...whiteZones, ...redZones];

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
