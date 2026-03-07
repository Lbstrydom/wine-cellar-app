/**
 * @fileoverview Storage type classification constants and helpers.
 * Single source of truth for determining whether a storage area is
 * fridge-like or cellar-like, replacing hardcoded startsWith('R'/'F')
 * and LIKE 'R%'/'F%' heuristics throughout the codebase.
 * @module config/storageTypes
 */

/** Storage types that represent fridge-like areas */
export const FRIDGE_TYPES = new Set(['wine_fridge', 'kitchen_fridge']);

/** Storage types that represent cellar-like areas */
export const CELLAR_TYPES = new Set(['cellar', 'rack', 'other']);

/**
 * Check whether a storage type is fridge-like.
 * @param {string} storageType
 * @returns {boolean}
 */
export function isFridgeType(storageType) {
  return FRIDGE_TYPES.has(storageType);
}

/**
 * Check whether a storage type is cellar-like.
 * @param {string} storageType
 * @returns {boolean}
 */
export function isCellarType(storageType) {
  return CELLAR_TYPES.has(storageType);
}

/**
 * Build a Map<storage_area_id, storage_type> from the output of getStorageAreasByType().
 * Avoids N+1 lookups when filtering wine arrays by area type.
 * @param {Object} areasByType - { cellar: [{id, ...}], wine_fridge: [{id, ...}], ... }
 * @returns {Map<string, string>}
 */
export function buildAreaTypeMap(areasByType) {
  const map = new Map();
  if (!areasByType || typeof areasByType !== 'object') return map;
  for (const [type, areas] of Object.entries(areasByType)) {
    if (!Array.isArray(areas)) continue;
    for (const area of areas) {
      if (area?.id) map.set(area.id, type);
    }
  }
  return map;
}

/**
 * Check if a wine is in a cellar-type area using the area type map.
 * Falls back to slotUtils.isCellarSlot() format check when map is unavailable.
 * @param {Object} wine - Wine object with storage_area_id and slot_id/location_code
 * @param {Map<string, string>|null} areaTypeMap - From buildAreaTypeMap()
 * @returns {boolean}
 */
export function isWineInCellar(wine, areaTypeMap) {
  if (areaTypeMap && wine.storage_area_id) {
    const type = areaTypeMap.get(wine.storage_area_id);
    return type != null && isCellarType(type);
  }
  // Fallback: format-based check
  const slot = wine.slot_id || wine.location_code;
  return slot != null && /^R\d+C\d+$/.test(slot);
}

/**
 * Check if a wine is in a fridge-type area using the area type map.
 * Falls back to slotUtils.isFridgeSlot() format check when map is unavailable.
 * @param {Object} wine - Wine object with storage_area_id and slot_id/location_code
 * @param {Map<string, string>|null} areaTypeMap - From buildAreaTypeMap()
 * @returns {boolean}
 */
export function isWineInFridge(wine, areaTypeMap) {
  if (areaTypeMap && wine.storage_area_id) {
    const type = areaTypeMap.get(wine.storage_area_id);
    return type != null && isFridgeType(type);
  }
  // Fallback: format-based check
  const slot = wine.slot_id || wine.location_code;
  return slot != null && /^F\d+$/.test(slot);
}
