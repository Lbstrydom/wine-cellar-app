/**
 * @fileoverview Zone layout proposal service.
 * Generates optimal zone-to-row assignments based on current collection.
 * @module services/zoneLayoutProposal
 */

import db from '../db/index.js';
import { CELLAR_ZONES } from '../config/cellarZones.js';

// Cellar physical layout: 19 rows, row 1 has 7 slots, others have 9
const CELLAR_LAYOUT = {
  totalRows: 19,
  getRowCapacity: (rowNum) => rowNum === 1 ? 7 : 9,
  getTotalCapacity: () => 7 + (18 * 9) // 169 slots
};

/**
 * Get current bottle counts by zone (based on matching rules, not location).
 * @returns {Map<string, Object>} Zone ID → { count, wines }
 */
function getBottlesByZone() {
  const wines = db.prepare(`
    SELECT
      w.id, w.wine_name, w.vintage, w.colour, w.country, w.grapes,
      w.style, w.region, w.appellation, w.winemaking, w.sweetness,
      w.zone_id,
      s.location_code
    FROM wines w
    LEFT JOIN slots s ON s.wine_id = w.id
    WHERE s.location_code IS NOT NULL
      AND s.location_code LIKE 'R%'
  `).all();

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
 * Classify a wine into a zone based on rules.
 * @param {Object} wine - Wine object
 * @returns {string} Zone ID
 */
function classifyWine(wine) {
  const colour = (wine.colour || '').toLowerCase();
  const grapes = (wine.grapes || '').toLowerCase();
  const style = (wine.style || '').toLowerCase();
  const country = (wine.country || '').toLowerCase();
  const wineName = (wine.wine_name || '').toLowerCase();
  const region = (wine.region || '').toLowerCase();
  const winemaking = (wine.winemaking || '').toLowerCase();

  for (const zone of CELLAR_ZONES.zones) {
    const rules = zone.rules || {};

    // Check grape match
    if (rules.grapes?.length > 0) {
      if (rules.grapes.some(g => grapes.includes(g.toLowerCase()))) {
        return zone.id;
      }
    }

    // Check keyword match
    if (rules.keywords?.length > 0) {
      const searchText = `${wineName} ${style} ${region} ${winemaking}`;
      if (rules.keywords.some(k => searchText.includes(k.toLowerCase()))) {
        return zone.id;
      }
    }

    // Check country match
    if (rules.countries?.length > 0) {
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
 * @returns {Object} Proposed layout with zone assignments
 */
export function proposeZoneLayout() {
  const bottlesByZone = getBottlesByZone();

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
    let rowsNeeded = 0;
    let assignedRows = [];
    let totalCapacity = 0;

    while (slotsNeeded > 0 && currentRow <= CELLAR_LAYOUT.totalRows) {
      const capacity = CELLAR_LAYOUT.getRowCapacity(currentRow);
      assignedRows.push(`R${currentRow}`);
      totalCapacity += capacity;
      slotsNeeded -= capacity;
      rowsNeeded++;
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
 */
export function saveZoneLayout(assignments) {
  const upsert = db.prepare(`
    INSERT INTO zone_allocations (zone_id, assigned_rows, wine_count, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(zone_id) DO UPDATE SET
      assigned_rows = excluded.assigned_rows,
      wine_count = excluded.wine_count,
      updated_at = datetime('now')
  `);

  const transaction = db.transaction((items) => {
    // Clear existing allocations
    db.prepare('DELETE FROM zone_allocations').run();

    // Insert new allocations
    items.forEach(({ zoneId, assignedRows, bottleCount }) => {
      upsert.run(zoneId, JSON.stringify(assignedRows), bottleCount || 0);
    });
  });

  transaction(assignments);
}

/**
 * Get current saved zone layout.
 * @returns {Array} Zone allocations
 */
export function getSavedZoneLayout() {
  return db.prepare(`
    SELECT zone_id, assigned_rows, wine_count, updated_at
    FROM zone_allocations
    ORDER BY rowid
  `).all().map(row => ({
    zoneId: row.zone_id,
    assignedRows: JSON.parse(row.assigned_rows || '[]'),
    wineCount: row.wine_count,
    updatedAt: row.updated_at
  }));
}

/**
 * Generate specific moves to consolidate wines into their assigned zones.
 * @returns {Array} Move instructions
 */
export function generateConsolidationMoves() {
  const layout = getSavedZoneLayout();
  if (layout.length === 0) {
    return { error: 'No zone layout configured. Please confirm a zone layout first.' };
  }

  // Build zone → rows mapping
  const zoneRows = new Map();
  layout.forEach(z => {
    zoneRows.set(z.zoneId, z.assignedRows);
  });

  // Get all wines with their current locations
  const wines = db.prepare(`
    SELECT
      w.id, w.wine_name, w.vintage, w.zone_id,
      s.location_code as current_slot
    FROM wines w
    JOIN slots s ON s.wine_id = w.id
    WHERE s.location_code LIKE 'R%'
  `).all();

  // Get all empty slots
  const emptySlots = db.prepare(`
    SELECT location_code
    FROM slots
    WHERE wine_id IS NULL AND location_code LIKE 'R%'
    ORDER BY location_code
  `).all().map(s => s.location_code);

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
