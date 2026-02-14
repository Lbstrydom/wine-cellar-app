/**
 * @fileoverview Dynamic row allocation service for cellar zones.
 * Manages zone → row mappings that are allocated on demand.
 * @module services/cellar/cellarAllocation
 */

import db from '../../db/index.js';
import { CELLAR_ZONES, getZoneById } from '../../config/cellarZones.js';

/**
 * Parse assigned_rows from DB row into a normalized string array.
 * Supports both TEXT-stored JSON and PostgreSQL JSONB decoded values.
 * @param {unknown} value
 * @returns {string[]}
 */
function parseAssignedRows(value) {
  if (Array.isArray(value)) {
    return value.map(String).filter(Boolean);
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
    } catch {
      return [];
    }
  }

  return [];
}

/**
 * Get currently allocated rows for a zone.
 * @param {string} zoneId
 * @param {string} cellarId - Cellar ID for tenant isolation
 * @returns {Promise<string[]>} Array of row IDs (e.g., ['R5', 'R6'])
 */
export async function getZoneRows(zoneId, cellarId) {
  const zone = getZoneById(zoneId);
  if (!zone) return [];

  // Buffer/fallback zones don't get dedicated rows
  if (zone.isBufferZone || zone.isFallbackZone || zone.isCuratedZone) {
    return [];
  }

  const allocation = await db.prepare(
    'SELECT assigned_rows FROM zone_allocations WHERE cellar_id = ? AND zone_id = ?'
  ).get(cellarId, zoneId);

  return allocation ? parseAssignedRows(allocation.assigned_rows) : [];
}

/**
 * Allocate a row to a zone (called when first wine added to zone).
 * @param {string} zoneId
 * @returns {Promise<string>} Assigned row ID
 * @throws {Error} If no rows available
 */
export async function allocateRowToZone(zoneId, cellarId, options = {}) {
  const { incrementWineCount = true } = options;
  const zone = getZoneById(zoneId);
  if (!zone) throw new Error(`Unknown zone: ${zoneId}`);

  // Get all currently allocated rows for this cellar
  const allocations = await db.prepare('SELECT assigned_rows FROM zone_allocations WHERE cellar_id = ?').all(cellarId);
  const usedRows = new Set();
  allocations.forEach(a => {
    parseAssignedRows(a.assigned_rows).forEach(r => usedRows.add(r));
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
    'SELECT assigned_rows FROM zone_allocations WHERE cellar_id = ? AND zone_id = ?'
  ).get(cellarId, zoneId);

  if (existing) {
    // Add to existing allocation
    const rows = parseAssignedRows(existing.assigned_rows);
    rows.push(assignedRow);
    if (incrementWineCount) {
      await db.prepare(
        `UPDATE zone_allocations
         SET assigned_rows = ?, wine_count = wine_count + 1, updated_at = CURRENT_TIMESTAMP
         WHERE cellar_id = ? AND zone_id = ?`
      ).run(JSON.stringify(rows), cellarId, zoneId);
    } else {
      await db.prepare(
        `UPDATE zone_allocations
         SET assigned_rows = ?, updated_at = CURRENT_TIMESTAMP
         WHERE cellar_id = ? AND zone_id = ?`
      ).run(JSON.stringify(rows), cellarId, zoneId);
    }
  } else {
    // Create new allocation
    await db.prepare(
      `INSERT INTO zone_allocations (cellar_id, zone_id, assigned_rows, first_wine_date, wine_count)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?)`
    ).run(cellarId, zoneId, JSON.stringify([assignedRow]), incrementWineCount ? 1 : 0);
  }

  return assignedRow;
}

/**
 * Update wine count for a zone.
 * @param {string} zoneId
 * @param {string} cellarId - Cellar ID for tenant isolation
 * @param {number} delta - +1 or -1
 */
export async function updateZoneWineCount(zoneId, cellarId, delta) {
  const zone = getZoneById(zoneId);

  // Buffer/fallback zones don't track counts
  if (!zone || zone.isBufferZone || zone.isFallbackZone || zone.isCuratedZone) {
    return;
  }

  await db.prepare(
    `UPDATE zone_allocations
     SET wine_count = wine_count + ?, updated_at = CURRENT_TIMESTAMP
     WHERE cellar_id = ? AND zone_id = ?`
  ).run(delta, cellarId, zoneId);

  // Deallocate if empty
  if (delta < 0) {
    const allocation = await db.prepare(
      'SELECT wine_count FROM zone_allocations WHERE cellar_id = ? AND zone_id = ?'
    ).get(cellarId, zoneId);
    if (allocation && allocation.wine_count <= 0) {
      await db.prepare('DELETE FROM zone_allocations WHERE cellar_id = ? AND zone_id = ?').run(cellarId, zoneId);
    }
  }
}

/**
 * Get current zone → row mapping for UI display.
 * @param {string} cellarId - Cellar ID for tenant isolation
 * @returns {Promise<Object>} Map of rowId -> zone info
 */
export async function getActiveZoneMap(cellarId) {
  const allocations = await db.prepare(
    `SELECT zone_id, assigned_rows, wine_count FROM zone_allocations WHERE cellar_id = ? AND wine_count > 0`
  ).all(cellarId);

  const zoneMap = {};
  for (const alloc of allocations) {
    const zone = getZoneById(alloc.zone_id);
    const rows = parseAssignedRows(alloc.assigned_rows);

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
 * @param {string} cellarId - Cellar ID for tenant isolation
 * @returns {Promise<Array>} Array of zone allocation objects
 */
export async function getAllZoneAllocations(cellarId) {
  const allocations = await db.prepare(
    `SELECT zone_id, assigned_rows, wine_count, first_wine_date, updated_at
     FROM zone_allocations
     WHERE cellar_id = ?
     ORDER BY first_wine_date`
  ).all(cellarId);

  return allocations.map(alloc => {
    const zone = getZoneById(alloc.zone_id);
    return {
      ...alloc,
      assigned_rows: parseAssignedRows(alloc.assigned_rows),
      displayName: zone?.displayName || alloc.zone_id,
      color: zone?.color || null
    };
  });
}

/**
 * Get all zones with their current allocation status.
 * @param {string} cellarId - Cellar ID for tenant isolation
 * @returns {Promise<Array>} Array of zone status objects
 */
export async function getZoneStatuses(cellarId) {
  const allocations = await db.prepare(
    'SELECT zone_id, assigned_rows, wine_count FROM zone_allocations WHERE cellar_id = ?'
  ).all(cellarId);

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
      assignedRows: alloc ? parseAssignedRows(alloc.assigned_rows) : [],
      wineCount: alloc?.wine_count || 0,
      preferredRowRange: zone.preferredRowRange || []
    };
  });
}
