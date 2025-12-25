/**
 * @fileoverview Dynamic row allocation service for cellar zones.
 * Manages zone → row mappings that are allocated on demand.
 * @module services/cellarAllocation
 */

import db from '../db/index.js';
import { CELLAR_ZONES, getZoneById } from '../config/cellarZones.js';

/**
 * Get currently allocated rows for a zone.
 * @param {string} zoneId
 * @returns {string[]} Array of row IDs (e.g., ['R5', 'R6'])
 */
export function getZoneRows(zoneId) {
  const zone = getZoneById(zoneId);
  if (!zone) return [];

  // Buffer/fallback zones don't get dedicated rows
  if (zone.isBufferZone || zone.isFallbackZone || zone.isCuratedZone) {
    return [];
  }

  const allocation = db.prepare(
    'SELECT assigned_rows FROM zone_allocations WHERE zone_id = ?'
  ).get(zoneId);

  return allocation ? JSON.parse(allocation.assigned_rows) : [];
}

/**
 * Allocate a row to a zone (called when first wine added to zone).
 * @param {string} zoneId
 * @returns {string} Assigned row ID
 * @throws {Error} If no rows available
 */
export function allocateRowToZone(zoneId) {
  const zone = getZoneById(zoneId);
  if (!zone) throw new Error(`Unknown zone: ${zoneId}`);

  // Get all currently allocated rows
  const allocations = db.prepare('SELECT assigned_rows FROM zone_allocations').all();
  const usedRows = new Set();
  allocations.forEach(a => {
    JSON.parse(a.assigned_rows).forEach(r => usedRows.add(r));
  });

  // Find first available row in preferred range
  const preferredRange = zone.preferredRowRange || [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
  let assignedRow = null;

  for (const rowNum of preferredRange) {
    const rowId = `R${rowNum}`;
    if (!usedRows.has(rowId)) {
      assignedRow = rowId;
      break;
    }
  }

  // If no preferred row available, try any row
  if (!assignedRow) {
    for (let rowNum = 1; rowNum <= 19; rowNum++) {
      const rowId = `R${rowNum}`;
      if (!usedRows.has(rowId)) {
        assignedRow = rowId;
        break;
      }
    }
  }

  if (!assignedRow) {
    throw new Error('No available rows - cellar at maximum zone capacity');
  }

  // Check if zone already has an allocation
  const existing = db.prepare(
    'SELECT assigned_rows FROM zone_allocations WHERE zone_id = ?'
  ).get(zoneId);

  if (existing) {
    // Add to existing allocation
    const rows = JSON.parse(existing.assigned_rows);
    rows.push(assignedRow);
    db.prepare(
      `UPDATE zone_allocations
       SET assigned_rows = ?, wine_count = wine_count + 1, updated_at = datetime('now')
       WHERE zone_id = ?`
    ).run(JSON.stringify(rows), zoneId);
  } else {
    // Create new allocation
    db.prepare(
      `INSERT INTO zone_allocations (zone_id, assigned_rows, first_wine_date, wine_count)
       VALUES (?, ?, datetime('now'), 1)`
    ).run(zoneId, JSON.stringify([assignedRow]));
  }

  return assignedRow;
}

/**
 * Update wine count for a zone.
 * @param {string} zoneId
 * @param {number} delta - +1 or -1
 */
export function updateZoneWineCount(zoneId, delta) {
  const zone = getZoneById(zoneId);

  // Buffer/fallback zones don't track counts
  if (!zone || zone.isBufferZone || zone.isFallbackZone || zone.isCuratedZone) {
    return;
  }

  db.prepare(
    `UPDATE zone_allocations
     SET wine_count = wine_count + ?, updated_at = datetime('now')
     WHERE zone_id = ?`
  ).run(delta, zoneId);

  // Deallocate if empty
  if (delta < 0) {
    const allocation = db.prepare(
      'SELECT wine_count FROM zone_allocations WHERE zone_id = ?'
    ).get(zoneId);
    if (allocation && allocation.wine_count <= 0) {
      db.prepare('DELETE FROM zone_allocations WHERE zone_id = ?').run(zoneId);
    }
  }
}

/**
 * Get current zone → row mapping for UI display.
 * @returns {Object} Map of rowId -> zone info
 */
export function getActiveZoneMap() {
  const allocations = db.prepare(
    `SELECT zone_id, assigned_rows, wine_count FROM zone_allocations WHERE wine_count > 0`
  ).all();

  const zoneMap = {};
  for (const alloc of allocations) {
    const zone = getZoneById(alloc.zone_id);
    const rows = JSON.parse(alloc.assigned_rows);

    rows.forEach((rowId, index) => {
      zoneMap[rowId] = {
        zoneId: alloc.zone_id,
        displayName: zone?.displayName || alloc.zone_id,
        rowNumber: index + 1,
        totalRows: rows.length,
        wineCount: alloc.wine_count
      };
    });
  }

  return zoneMap;
}

/**
 * Get all zone allocations with their details.
 * @returns {Array} Array of zone allocation objects
 */
export function getAllZoneAllocations() {
  const allocations = db.prepare(
    `SELECT zone_id, assigned_rows, wine_count, first_wine_date, updated_at
     FROM zone_allocations
     ORDER BY first_wine_date`
  ).all();

  return allocations.map(alloc => {
    const zone = getZoneById(alloc.zone_id);
    return {
      ...alloc,
      assigned_rows: JSON.parse(alloc.assigned_rows),
      displayName: zone?.displayName || alloc.zone_id,
      color: zone?.color || null
    };
  });
}

/**
 * Check if a specific row is allocated to any zone.
 * @param {string} rowId - Row ID (e.g., 'R5')
 * @returns {Object|null} Zone info if allocated, null otherwise
 */
export function getRowAllocation(rowId) {
  const allocations = db.prepare('SELECT zone_id, assigned_rows FROM zone_allocations').all();

  for (const alloc of allocations) {
    const rows = JSON.parse(alloc.assigned_rows);
    if (rows.includes(rowId)) {
      const zone = getZoneById(alloc.zone_id);
      return {
        zoneId: alloc.zone_id,
        displayName: zone?.displayName || alloc.zone_id
      };
    }
  }

  return null;
}

/**
 * Get all zones with their current allocation status.
 * @returns {Array} Array of zone status objects
 */
export function getZoneStatuses() {
  const allocations = db.prepare(
    'SELECT zone_id, assigned_rows, wine_count FROM zone_allocations'
  ).all();

  const allocMap = new Map(allocations.map(a => [a.zone_id, a]));

  return CELLAR_ZONES.zones.map(zone => {
    const alloc = allocMap.get(zone.id);
    return {
      id: zone.id,
      displayName: zone.displayName,
      color: zone.color,
      isBufferZone: zone.isBufferZone || false,
      isFallbackZone: zone.isFallbackZone || false,
      isCuratedZone: zone.isCuratedZone || false,
      allocated: !!alloc,
      assignedRows: alloc ? JSON.parse(alloc.assigned_rows) : [],
      wineCount: alloc?.wine_count || 0,
      preferredRowRange: zone.preferredRowRange || []
    };
  });
}
