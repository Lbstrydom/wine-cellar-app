/**
 * @fileoverview Bottle management (add multiple, etc.).
 * @module routes/bottles
 */

import { Router } from 'express';
import { z } from 'zod';
import db from '../db/index.js';
import { wrapClient } from '../db/index.js';
import { asyncHandler } from '../utils/errorResponse.js';
import { adjustZoneCountAfterBottleCrud } from '../services/cellar/cellarAllocation.js';
import { invalidateAnalysisCache } from '../services/shared/cacheService.js';
import { invalidateBuyingGuideCache } from '../services/recipe/buyingGuide.js';
import { incrementBottleChangeCount } from '../services/zone/reconfigChangeTracker.js';
import { findAdjacentToSameWine } from '../services/cellar/cellarPlacement.js';
import { getStorageAreaRows, getCellarRowCount, getStorageAreasByType } from '../services/cellar/cellarLayout.js';
import { getRowCapacity } from '../services/cellar/slotUtils.js';
import { isFridgeType } from '../config/storageTypes.js';

const router = Router();

/**
 * Build dynamic grid limits from cellar layout (replaces hardcoded GRID_CONSTANTS).
 * Falls back to legacy defaults when storage_area_rows data is absent.
 * @param {string} cellarId
 * @param {string|null} [storageAreaId] - Optional: restrict row data to a specific area
 * @returns {Promise<{cellarMaxRow: number, getColCount: Function, fridgeMaxSlot: number, storageAreaRows: Array}>}
 */
async function getGridLimits(cellarId, storageAreaId = null) {
  const [storageAreaRows, totalCellarRows, areasByType] = await Promise.all([
    getStorageAreaRows(cellarId, storageAreaId),
    getCellarRowCount(cellarId),
    getStorageAreasByType(cellarId)
  ]);
  const fridgeAreas = [
    ...(areasByType.wine_fridge || []),
    ...(areasByType.kitchen_fridge || [])
  ];
  const fridgeMaxSlot = fridgeAreas.reduce((sum, area) => {
    return sum + area.rows.reduce((s, r) => s + (r.col_count || 0), 0);
  }, 0) || 9; // legacy fallback
  return {
    cellarMaxRow: totalCellarRows,
    getColCount: (rowId) => getRowCapacity(rowId, storageAreaRows),
    fridgeMaxSlot,
    storageAreaRows
  };
}

// Input validation schema
const addBottlesSchema = z.object({
  wine_id: z.number().int().positive('wine_id must be a positive integer'),
  start_location: z.string()
    .min(2, 'start_location is required')
    .regex(/^(F\d+|R\d+C\d+)$/, 'Invalid location format (expected F# or R#C#)'),
  quantity: z.number().int().min(1).max(50).default(1),
  storage_area_id: z.string().uuid().optional().nullable()
});

/**
 * Derive the zone rows containing the start location for adjacency search.
 * Returns all rows in the same "zone band" (nearby rows).
 * @param {string} startLocation - Start location code (R#C#)
 * @returns {string[]} Row IDs to search for adjacency
 */
function getZoneRowsForLocation(startLocation, cellarMaxRow) {
  const match = startLocation.match(/R(\d+)C(\d+)/);
  if (!match) return [];
  const startRow = parseInt(match[1]);
  // Search a band of rows around the start location (±3 rows)
  const rows = [];
  for (let r = Math.max(1, startRow - 3); r <= Math.min(cellarMaxRow, startRow + 3); r++) {
    rows.push(`R${r}`);
  }
  return rows;
}

/**
 * Add bottle(s) with adjacency-aware placement and transactional writes.
 * For cellar locations with existing same-wine bottles, prefers adjacent slots.
 * All slot fills are wrapped in a transaction with atomic guards.
 * @route POST /api/bottles/add
 */
router.post('/add', asyncHandler(async (req, res) => {
  // Validate input
  const parseResult = addBottlesSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({
      error: 'Validation failed',
      details: parseResult.error.issues.map(e => e.message)
    });
  }

  const { wine_id, start_location, quantity, storage_area_id } = parseResult.data;

  // Fetch dynamic grid limits (async factory — replaces GRID_CONSTANTS)
  const gridLimits = await getGridLimits(req.cellarId, storage_area_id);

  // Verify wine exists and belongs to this cellar
  const wine = await db.prepare('SELECT id FROM wines WHERE cellar_id = $1 AND id = $2').get(req.cellarId, wine_id);
  if (!wine) {
    return res.status(404).json({ error: 'Wine not found' });
  }

  // Determine area type from storage_area_id metadata (falls back to format check)
  let isFridge = start_location.startsWith('F'); // format fallback
  if (storage_area_id) {
    const area = await db.prepare(
      'SELECT storage_type FROM storage_areas WHERE id = $1 AND cellar_id = $2'
    ).get(storage_area_id, req.cellarId);
    if (area) isFridge = isFridgeType(area.storage_type);
  }
  const consecutiveSlots = [];

  if (isFridge) {
    const startNum = parseInt(start_location.substring(1));
    for (let i = 0; i < quantity; i++) {
      const slotNum = startNum + i;
      if (slotNum > gridLimits.fridgeMaxSlot) break;
      consecutiveSlots.push(`F${slotNum}`);
    }
  } else {
    const match = start_location.match(/R(\d+)C(\d+)/);
    if (!match) {
      return res.status(400).json({ error: 'Invalid location format' });
    }

    let row = parseInt(match[1]);
    let col = parseInt(match[2]);

    for (let i = 0; i < quantity; i++) {
      const maxCol = gridLimits.getColCount(`R${row}`);
      if (col > maxCol) {
        row++;
        col = 1;
        if (row > gridLimits.cellarMaxRow) break;
      }
      consecutiveSlots.push(`R${row}C${col}`);
      col++;
    }
  }

  // Check which consecutive slots are empty
  const placeholders = consecutiveSlots.map((_, i) => `$${i + 2}`).join(',');
  const areaFilter = storage_area_id ? ` AND storage_area_id = $${consecutiveSlots.length + 2}` : '';
  const existingSlots = await db.prepare(
    'SELECT location_code, wine_id FROM slots WHERE cellar_id = $1 AND location_code IN (' + placeholders + ')' + areaFilter
  ).all(req.cellarId, ...consecutiveSlots, ...(storage_area_id ? [storage_area_id] : []));
  // Safe: placeholders generated from slots array length, data passed to .all()

  const emptyConsecutive = consecutiveSlots.filter(loc => {
    const slot = existingSlots.find(s => s.location_code === loc);
    return slot && !slot.wine_id;
  });

  // Determine final slot selection — adjacency-aware for cellar, consecutive for fridge
  let slotsToFill;

  if (!isFridge) {
    // Query existing same-wine bottle locations in cellar-type areas
    const sameWineBottles = await db.prepare(`
      SELECT s.location_code FROM slots s
      JOIN storage_areas sa ON sa.id = s.storage_area_id
        AND sa.storage_type IN ('cellar', 'rack', 'other')
      WHERE s.cellar_id = $1 AND s.wine_id = $2
    `).all(req.cellarId, wine_id);
    const sameWineSlots = sameWineBottles.map(b => b.location_code);

    if (sameWineSlots.length > 0) {
      // Try adjacency-aware placement
      const zoneRows = getZoneRowsForLocation(start_location, gridLimits.cellarMaxRow);

      // Guard: out-of-range start_location (e.g. R999C1) returns empty zoneRows.
      // An empty zoneRows would produce IN () — invalid SQL → 500 error.
      // In that case fall through to consecutive fill (same as no existing same-wine).
      if (zoneRows.length > 0) {
        // Build occupied set for all rows in the zone band
        const allRowSlots = [];
        for (const row of zoneRows) {
          const maxCol = gridLimits.getColCount(row);
          for (let c = 1; c <= maxCol; c++) allRowSlots.push(`${row}C${c}`);
        }

        const rowPlaceholders = allRowSlots.map((_, i) => `$${i + 2}`).join(',');
        const rowAreaFilter = storage_area_id ? ` AND storage_area_id = $${allRowSlots.length + 2}` : '';
        const rowOccupancy = await db.prepare(
          'SELECT location_code, wine_id FROM slots WHERE cellar_id = $1 AND location_code IN (' + rowPlaceholders + ')' + rowAreaFilter
        ).all(req.cellarId, ...allRowSlots, ...(storage_area_id ? [storage_area_id] : []));

        const occupiedSet = new Set(
          rowOccupancy.filter(s => s.wine_id).map(s => s.location_code)
        );

        // Find adjacent slots one at a time, updating occupied + sameWine after each
        const adjacentSlots = [];
        const growingSameWine = [...sameWineSlots];

        for (let i = 0; i < quantity; i++) {
          const slot = findAdjacentToSameWine(zoneRows, occupiedSet, growingSameWine);
          if (!slot) break;
          adjacentSlots.push(slot);
          occupiedSet.add(slot);          // Mark as occupied for next iteration
          growingSameWine.push(slot);      // Treat as same-wine for next adjacency calc
        }

        if (adjacentSlots.length >= quantity) {
          slotsToFill = adjacentSlots.slice(0, quantity);
        }
      }

      if (!slotsToFill) {
        // Not enough adjacent slots (or out-of-range location) — fall back to consecutive
        if (emptyConsecutive.length < quantity) {
          return res.status(400).json({
            error: `Not enough empty slots. Found ${emptyConsecutive.length}, need ${quantity}.`
          });
        }
        slotsToFill = emptyConsecutive.slice(0, quantity);
      }
    } else {
      // No existing same-wine bottles — use consecutive fill
      if (emptyConsecutive.length < quantity) {
        return res.status(400).json({
          error: `Not enough consecutive empty slots. Found ${emptyConsecutive.length}, need ${quantity}.`
        });
      }
      slotsToFill = emptyConsecutive.slice(0, quantity);
    }
  } else {
    // Fridge: always use consecutive fill
    if (emptyConsecutive.length < quantity) {
      return res.status(400).json({
        error: `Not enough consecutive empty slots. Found ${emptyConsecutive.length}, need ${quantity}.`
      });
    }
    slotsToFill = emptyConsecutive.slice(0, quantity);
  }

  // Transactional, guarded slot fill
  try {
    const filled = await db.transaction(async (client) => {
      const txDb = wrapClient(client);

      // Invariant: count occupied before
      const before = await txDb.prepare(
        'SELECT COUNT(*) as cnt FROM slots WHERE cellar_id = $1 AND wine_id IS NOT NULL'
      ).get(req.cellarId);

      let filledCount = 0;
      for (const loc of slotsToFill) {
        // Atomic guard: AND wine_id IS NULL prevents double-fill from concurrent requests
        // AND storage_area_id guards area identity when provided (Phase 1 thread-through)
        let upd;
        if (storage_area_id) {
          upd = await txDb.prepare(
            'UPDATE slots SET wine_id = $1 WHERE location_code = $2 AND cellar_id = $3 AND wine_id IS NULL AND storage_area_id = $4'
          ).run(wine_id, loc, req.cellarId, storage_area_id);
        } else {
          upd = await txDb.prepare(
            'UPDATE slots SET wine_id = $1 WHERE location_code = $2 AND cellar_id = $3 AND wine_id IS NULL'
          ).run(wine_id, loc, req.cellarId);
        }
        if (upd.changes === 0) {
          throw new Error(`Slot ${loc} was filled by a concurrent request`);
        }
        filledCount++;
      }

      // Invariant: count occupied after must equal before + filled
      const after = await txDb.prepare(
        'SELECT COUNT(*) as cnt FROM slots WHERE cellar_id = $1 AND wine_id IS NOT NULL'
      ).get(req.cellarId);
      if (parseInt(after.cnt) !== parseInt(before.cnt) + filledCount) {
        throw new Error('Data integrity violation: bottle count mismatch');
      }

      return filledCount;
    });

    // Post-transaction side effects
    await adjustZoneCountAfterBottleCrud(wine_id, req.cellarId, 'added');
    await invalidateAnalysisCache(null, req.cellarId);
    invalidateBuyingGuideCache(req.cellarId).catch(() => {});
    await incrementBottleChangeCount(req.cellarId, filled);

    res.json({
      message: `Added ${filled} bottle(s)`,
      locations: slotsToFill
    });
  } catch (err) {
    if (err.message.includes('concurrent') || err.message.includes('integrity')) {
      return res.status(409).json({ error: err.message });
    }
    throw err;
  }
}));

export default router;
