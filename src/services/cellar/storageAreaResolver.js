/**
 * @fileoverview Storage area resolution helpers.
 * Single source of truth for resolving and validating storage area IDs.
 * All slot-touching endpoints use these helpers to thread area identity
 * through queries. With continuous row numbering, UNIQUE(cellar_id, location_code)
 * is permanent — resolveAreaFromSlot() is a valid permanent fallback.
 * @module services/cellar/storageAreaResolver
 */

import db from '../../db/index.js';
import { AppError, ErrorCodes } from '../../utils/errorResponse.js';

/**
 * Resolve and validate a storage area ID for a cellar.
 * - If storageAreaId is provided, validates it belongs to this cellar.
 * - If null/undefined, returns the first area of the given storageType.
 * - Throws AppError(404) if no matching area exists.
 *
 * @param {string} cellarId - Cellar UUID from req.cellarId
 * @param {string|null|undefined} storageAreaId - From request body/query (optional)
 * @param {string} [storageType='cellar'] - Fallback type when storageAreaId is null
 * @returns {Promise<{id: string, storage_type: string, name: string}>} Validated area
 * @throws {AppError} 404 if area not found or doesn't belong to cellar
 */
export async function resolveStorageAreaId(cellarId, storageAreaId, storageType = 'cellar') {
  if (storageAreaId) {
    const area = await db.prepare(
      'SELECT id, storage_type, name FROM storage_areas WHERE id = $1 AND cellar_id = $2'
    ).get(storageAreaId, cellarId);

    if (!area) {
      throw new AppError(
        `Storage area ${storageAreaId} not found or does not belong to this cellar`,
        ErrorCodes.NOT_FOUND
      );
    }
    return area;
  }

  // Fall back to first area of the given storage type
  const area = await db.prepare(`
    SELECT id, storage_type, name
    FROM storage_areas
    WHERE cellar_id = $1 AND storage_type = $2
    ORDER BY display_order NULLS LAST, created_at
    LIMIT 1
  `).get(cellarId, storageType);

  if (!area) {
    throw new AppError(
      `No storage area of type '${storageType}' found for this cellar`,
      ErrorCodes.NOT_FOUND
    );
  }
  return area;
}

/**
 * Look up the storage_area_id for a slot by (cellar_id, location_code).
 * Used by param-based endpoints where the caller sends location only.
 *
 * PERMANENT FALLBACK: With continuous row numbering, UNIQUE(cellar_id, location_code)
 * holds indefinitely, so this lookup is always unambiguous. Callers should send
 * storage_area_id explicitly when available (avoids the extra DB query), but this
 * fallback is retained for paths where the area is not cheaply known (e.g. pairing.js).
 *
 * @param {string} cellarId - Cellar UUID
 * @param {string} locationCode - Slot location code (e.g. 'R5C3', 'F2')
 * @returns {Promise<string>} storage_area_id UUID
 * @throws {AppError} 404 if slot not found
 * @throws {AppError} 409 if multiple slots match — defence-in-depth; should not
 *   occur while unique constraint exists, but guards against silent wrong-slot
 *   resolution if constraint is ever relaxed without removing this function first
 */
export async function resolveAreaFromSlot(cellarId, locationCode) {
  const rows = await db.prepare(
    'SELECT storage_area_id FROM slots WHERE cellar_id = $1 AND location_code = $2'
  ).all(cellarId, locationCode);

  if (!rows || rows.length === 0) {
    throw new AppError(
      `Slot ${locationCode} not found`,
      ErrorCodes.NOT_FOUND
    );
  }

  if (rows.length > 1) {
    throw new AppError(
      `Ambiguous slot lookup: ${rows.length} slots match (${locationCode}) — ` +
      'supply storage_area_id explicitly',
      ErrorCodes.CONFLICT
    );
  }

  const storageAreaId = rows[0].storage_area_id;
  if (!storageAreaId) {
    throw new AppError(
      `Slot ${locationCode} has no storage area assigned`,
      ErrorCodes.NOT_FOUND
    );
  }

  return storageAreaId;
}
