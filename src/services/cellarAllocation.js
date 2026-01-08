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
 * @returns {Promise<string[]>} Array of row IDs (e.g., ['R5', 'R6'])
 */
export async function getZoneRows(zoneId) {
  const zone = getZoneById(zoneId);
  if (!zone) return [];

  // Buffer/fallback zones don't get dedicated rows
  if (zone.isBufferZone || zone.isFallbackZone || zone.isCuratedZone) {
    return [];
  }

  const allocation = await db.prepare(
    'SELECT assigned_rows FROM zone_allocations WHERE zone_id = ?'
  ).get(zoneId);

  return allocation ? JSON.parse(allocation.assigned_rows) : [];
}

/**
 * Allocate a row to a zone (called when first wine added to zone).
 * @param {string} zoneId
 * @returns {Promise<string>} Assigned row ID
 * @throws {Error} If no rows available
 */
export async function allocateRowToZone(zoneId, options = {}) {
  const { incrementWineCount = true } = options;
  const zone = getZoneById(zoneId);
  if (!zone) throw new Error(`Unknown zone: ${zoneId}`);

  // Get all currently allocated rows
  const allocations = await db.prepare('SELECT assigned_rows FROM zone_allocations').all();
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
  const existing = await db.prepare(
    'SELECT assigned_rows FROM zone_allocations WHERE zone_id = ?'
  ).get(zoneId);

  if (existing) {
    // Add to existing allocation
    const rows = JSON.parse(existing.assigned_rows);
    rows.push(assignedRow);
    if (incrementWineCount) {
      await db.prepare(
        `UPDATE zone_allocations
         SET assigned_rows = ?, wine_count = wine_count + 1, updated_at = CURRENT_TIMESTAMP
         WHERE zone_id = ?`
      ).run(JSON.stringify(rows), zoneId);
    } else {
      await db.prepare(
        `UPDATE zone_allocations
         SET assigned_rows = ?, updated_at = CURRENT_TIMESTAMP
         WHERE zone_id = ?`
      ).run(JSON.stringify(rows), zoneId);
    }
  } else {
    // Create new allocation
    await db.prepare(
      `INSERT INTO zone_allocations (zone_id, assigned_rows, first_wine_date, wine_count)
       VALUES (?, ?, CURRENT_TIMESTAMP, ?)`
    ).run(zoneId, JSON.stringify([assignedRow]), incrementWineCount ? 1 : 0);
  }

  return assignedRow;
}

/**
 * Update wine count for a zone.
 * @param {string} zoneId
 * @param {number} delta - +1 or -1
 */
export async function updateZoneWineCount(zoneId, delta) {
  const zone = getZoneById(zoneId);

  // Buffer/fallback zones don't track counts
  if (!zone || zone.isBufferZone || zone.isFallbackZone || zone.isCuratedZone) {
    return;
  }

  await db.prepare(
    `UPDATE zone_allocations
     SET wine_count = wine_count + ?, updated_at = CURRENT_TIMESTAMP
     WHERE zone_id = ?`
  ).run(delta, zoneId);

  // Deallocate if empty
  if (delta < 0) {
    const allocation = await db.prepare(
      'SELECT wine_count FROM zone_allocations WHERE zone_id = ?'
    ).get(zoneId);
    if (allocation && allocation.wine_count <= 0) {
      await db.prepare('DELETE FROM zone_allocations WHERE zone_id = ?').run(zoneId);
    }
  }
}

/**
 * Get current zone → row mapping for UI display.
 * @returns {Promise<Object>} Map of rowId -> zone info
 */
export async function getActiveZoneMap() {
  const allocations = await db.prepare(
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
 * @returns {Promise<Array>} Array of zone allocation objects
 */
export async function getAllZoneAllocations() {
  const allocations = await db.prepare(
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
 * @returns {Promise<Object|null>} Zone info if allocated, null otherwise
 */
export async function getRowAllocation(rowId) {
  const allocations = await db.prepare('SELECT zone_id, assigned_rows FROM zone_allocations').all();

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
 * @returns {Promise<Array>} Array of zone status objects
 */
export async function getZoneStatuses() {
  const allocations = await db.prepare(
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
