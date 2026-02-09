/**
 * @fileoverview API endpoints for holistic zone reconfiguration, undo, and move execution.
 * @module routes/cellarReconfiguration
 */

import express from 'express';
import db from '../db/index.js';
import { getZoneById } from '../config/cellarZones.js';
import { invalidateAnalysisCache } from '../services/shared/cacheService.js';
import { validateMovePlan } from '../services/cellar/movePlanner.js';
import { ensureReconfigurationTables } from '../services/zone/reconfigurationTables.js';
import { putPlan, getPlan, deletePlan } from '../services/zone/reconfigurationPlanStore.js';
import { generateReconfigurationPlan } from '../services/zone/zoneReconfigurationPlanner.js';
import { asyncHandler } from '../utils/errorResponse.js';
import logger from '../utils/logger.js';
import { getAllWinesWithSlots } from './cellar.js';
import { runAnalysis } from './cellarAnalysis.js';

const router = express.Router();

/**
 * POST /api/cellar/reconfiguration-plan
 * Generate a holistic zone reconfiguration plan.
 */
router.post('/reconfiguration-plan', asyncHandler(async (req, res) => {
  const {
    includeRetirements = true,
    includeNewZones = true,
    stabilityBias = 'moderate'
  } = req.body || {};

  const wines = await getAllWinesWithSlots(req.cellarId);
  const report = await runAnalysis(wines, req.cellarId);

  const plan = await generateReconfigurationPlan(report, {
    includeRetirements,
    includeNewZones,
    stabilityBias,
    cellarId: req.cellarId
  });

  const planId = putPlan({
    generatedAt: new Date().toISOString(),
    options: { includeRetirements, includeNewZones, stabilityBias },
    plan
  });

  res.json({
    success: true,
    planId,
    plan
  });
}));

/**
 * Extract affected zone IDs from a reconfiguration plan.
 * @param {Object} plan - Reconfiguration plan
 * @returns {string[]} Array of zone IDs
 */
function getAffectedZoneIdsFromPlan(plan) {
  const zoneIds = new Set();
  const actions = Array.isArray(plan?.actions) ? plan.actions : [];

  for (const action of actions) {
    if (!action || typeof action !== 'object') continue;

    if (action.type === 'reallocate_row') {
      if (action.fromZoneId) zoneIds.add(action.fromZoneId);
      if (action.toZoneId) zoneIds.add(action.toZoneId);
    } else if (action.type === 'expand_zone' && action.zoneId) {
      zoneIds.add(action.zoneId);
    } else if (action.type === 'merge_zones') {
      if (Array.isArray(action.sourceZones)) {
        action.sourceZones.forEach(z => zoneIds.add(z));
      }
      if (action.targetZoneId) zoneIds.add(action.targetZoneId);
    } else if (action.type === 'retire_zone') {
      if (action.zoneId) zoneIds.add(action.zoneId);
      if (action.mergeIntoZoneId) zoneIds.add(action.mergeIntoZoneId);
    }
  }

  return Array.from(zoneIds);
}

/**
 * Allocate a row to a zone within a transaction.
 * @param {Object} client - Database transaction client
 * @param {string} cellarId - Cellar ID
 * @param {string} zoneId - Zone ID to allocate to
 * @param {Set<string>} usedRows - Set of already-used row IDs
 * @returns {Promise<string>} Assigned row ID
 */
async function allocateRowTransactional(client, cellarId, zoneId, usedRows) {
  const zone = getZoneById(zoneId);
  if (!zone) throw new Error(`Unknown zone: ${zoneId}`);

  const preferredRange = zone.preferredRowRange || [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
  let assignedRow = null;

  for (const rowNum of preferredRange) {
    const rowId = `R${rowNum}`;
    if (!usedRows.has(rowId)) {
      assignedRow = rowId;
      break;
    }
  }

  if (!assignedRow) {
    for (let rowNum = 1; rowNum <= 19; rowNum++) {
      const rowId = `R${rowNum}`;
      if (!usedRows.has(rowId)) {
        assignedRow = rowId;
        break;
      }
    }
  }

  if (!assignedRow) throw new Error('No available rows - cellar at maximum zone capacity');

  const existing = await client.query(
    'SELECT assigned_rows, wine_count, first_wine_date FROM zone_allocations WHERE cellar_id = $1 AND zone_id = $2',
    [cellarId, zoneId]
  );

  if (existing.rows.length > 0) {
    const rows = JSON.parse(existing.rows[0].assigned_rows || '[]');
    rows.push(assignedRow);
    await client.query(
      'UPDATE zone_allocations SET assigned_rows = $1, updated_at = NOW() WHERE cellar_id = $2 AND zone_id = $3',
      [JSON.stringify(rows), cellarId, zoneId]
    );
  } else {
    await client.query(
      'INSERT INTO zone_allocations (cellar_id, zone_id, assigned_rows, first_wine_date, wine_count) VALUES ($1, $2, $3, NOW(), $4)',
      [cellarId, zoneId, JSON.stringify([assignedRow]), 0]
    );
  }

  usedRows.add(assignedRow);
  return assignedRow;
}

/**
 * Merge wines and allocated rows from one zone into another within a transaction.
 * @param {Object} client - Database transaction client
 * @param {string} cellarId - Cellar ID
 * @param {string} sourceZoneId - Source zone to merge from
 * @param {string} targetZoneId - Target zone to merge into
 * @returns {Promise<string[]>} Merged row list
 */
async function mergeZonesTransactional(client, cellarId, sourceZoneId, targetZoneId) {
  if (sourceZoneId === targetZoneId) return;

  const sourceAlloc = await client.query(
    'SELECT assigned_rows, wine_count FROM zone_allocations WHERE cellar_id = $1 AND zone_id = $2',
    [cellarId, sourceZoneId]
  );
  const targetAlloc = await client.query(
    'SELECT assigned_rows, wine_count FROM zone_allocations WHERE cellar_id = $1 AND zone_id = $2',
    [cellarId, targetZoneId]
  );

  const sourceRows = sourceAlloc.rows[0]?.assigned_rows ? JSON.parse(sourceAlloc.rows[0].assigned_rows) : [];
  const targetRows = targetAlloc.rows[0]?.assigned_rows ? JSON.parse(targetAlloc.rows[0].assigned_rows) : [];
  const mergedRows = [...targetRows, ...sourceRows].filter(Boolean);

  await client.query('UPDATE wines SET zone_id = $1 WHERE cellar_id = $2 AND zone_id = $3', [targetZoneId, cellarId, sourceZoneId]);

  const mergedWineCount = (targetAlloc.rows[0]?.wine_count || 0) + (sourceAlloc.rows[0]?.wine_count || 0);

  if (targetAlloc.rows.length > 0) {
    await client.query(
      'UPDATE zone_allocations SET assigned_rows = $1, wine_count = $2, updated_at = NOW() WHERE cellar_id = $3 AND zone_id = $4',
      [JSON.stringify(mergedRows), mergedWineCount, cellarId, targetZoneId]
    );
  } else {
    await client.query(
      'INSERT INTO zone_allocations (cellar_id, zone_id, assigned_rows, first_wine_date, wine_count) VALUES ($1, $2, $3, NOW(), $4)',
      [cellarId, targetZoneId, JSON.stringify(mergedRows), mergedWineCount]
    );
  }

  await client.query('DELETE FROM zone_allocations WHERE cellar_id = $1 AND zone_id = $2', [cellarId, sourceZoneId]);

  return mergedRows;
}

/**
 * Reallocate a specific row from one zone to another.
 * Works within the fixed physical constraints of the cellar.
 * @param {Object} client - Database transaction client
 * @param {string} cellarId - Cellar ID
 * @param {string} fromZoneId - Source zone
 * @param {string} toZoneId - Target zone
 * @param {number|string} rowNumber - Row number or ID to reallocate
 * @returns {Promise<Object>} Result with success/skipped status
 */
async function reallocateRowTransactional(client, cellarId, fromZoneId, toZoneId, rowNumber) {
  if (fromZoneId === toZoneId) return { success: true, skipped: true, reason: 'same zone' };

  const rowId = typeof rowNumber === 'number' ? `R${rowNumber}` : String(rowNumber);

  // Get current allocations
  const fromAlloc = await client.query(
    'SELECT assigned_rows, wine_count FROM zone_allocations WHERE cellar_id = $1 AND zone_id = $2',
    [cellarId, fromZoneId]
  );
  const toAlloc = await client.query(
    'SELECT assigned_rows, wine_count FROM zone_allocations WHERE cellar_id = $1 AND zone_id = $2',
    [cellarId, toZoneId]
  );

  const fromRows = fromAlloc.rows[0]?.assigned_rows ? JSON.parse(fromAlloc.rows[0].assigned_rows) : [];
  const toRows = toAlloc.rows[0]?.assigned_rows ? JSON.parse(toAlloc.rows[0].assigned_rows) : [];

  // Verify the row belongs to fromZone - return skip status instead of throwing
  if (!fromRows.includes(rowId)) {
    logger.warn('Reconfig', `reallocateRowTransactional skipping: ${rowId} not in ${fromZoneId}'s rows ${JSON.stringify(fromRows)}`);
    return { success: false, skipped: true, reason: `Row ${rowId} is not assigned to zone ${fromZoneId}` };
  }

  // Remove from source zone
  const updatedFromRows = fromRows.filter(r => r !== rowId);
  // Add to target zone
  const updatedToRows = [...toRows, rowId].filter(Boolean);

  // Update source zone allocation
  if (updatedFromRows.length > 0) {
    await client.query(
      'UPDATE zone_allocations SET assigned_rows = $1, updated_at = NOW() WHERE cellar_id = $2 AND zone_id = $3',
      [JSON.stringify(updatedFromRows), cellarId, fromZoneId]
    );
  } else {
    // Zone has no rows left - keep the allocation record but empty
    await client.query(
      'UPDATE zone_allocations SET assigned_rows = $1, updated_at = NOW() WHERE cellar_id = $2 AND zone_id = $3',
      [JSON.stringify([]), cellarId, fromZoneId]
    );
  }

  // Update or create target zone allocation
  if (toAlloc.rows.length > 0) {
    await client.query(
      'UPDATE zone_allocations SET assigned_rows = $1, updated_at = NOW() WHERE cellar_id = $2 AND zone_id = $3',
      [JSON.stringify(updatedToRows), cellarId, toZoneId]
    );
  } else {
    await client.query(
      'INSERT INTO zone_allocations (cellar_id, zone_id, assigned_rows, first_wine_date, wine_count) VALUES ($1, $2, $3, NOW(), $4)',
      [cellarId, toZoneId, JSON.stringify(updatedToRows), 0]
    );
  }

  return { success: true, skipped: false, fromRows: updatedFromRows, toRows: updatedToRows };
}

/**
 * POST /api/cellar/reconfiguration-plan/apply
 * Apply a previously generated holistic plan.
 */
router.post('/reconfiguration-plan/apply', asyncHandler(async (req, res) => {
  const { planId, skipActions = [] } = req.body || {};
  if (!planId) {
    return res.status(400).json({ success: false, error: 'planId required' });
  }

  const stored = getPlan(planId);
  if (!stored?.plan) {
    return res.status(400).json({ success: false, error: 'Plan not found or expired. Generate a new plan.' });
  }

  await ensureReconfigurationTables();

  const plan = stored.plan;
  const actions = Array.isArray(plan.actions) ? plan.actions : [];
  const skipSet = new Set(Array.isArray(skipActions) ? skipActions : []);
  const affectedZones = getAffectedZoneIdsFromPlan(plan);

  const result = await db.transaction(async (client) => {
    // Snapshot before-state for undo
    const beforeAlloc = affectedZones.length
      ? await client.query(
        'SELECT cellar_id, zone_id, assigned_rows, wine_count, first_wine_date, updated_at FROM zone_allocations WHERE cellar_id = $1 AND zone_id = ANY($2::text[])',
        [req.cellarId, affectedZones]
      )
      : { rows: [] };
    const beforeWines = affectedZones.length
      ? await client.query(
        'SELECT id, zone_id FROM wines WHERE cellar_id = $1 AND zone_id = ANY($2::text[])',
        [req.cellarId, affectedZones]
      )
      : { rows: [] };

    // Build used row set
    const allAlloc = await client.query('SELECT assigned_rows FROM zone_allocations WHERE cellar_id = $1', [req.cellarId]);
    const usedRows = new Set();
    for (const r of allAlloc.rows) {
      try {
        JSON.parse(r.assigned_rows || '[]').forEach(rowId => usedRows.add(rowId));
      } catch {
        // ignore
      }
    }

    // Build current zone allocation map for validation at apply time
    const zoneAllocMap = new Map();
    const allocWithZone = await client.query('SELECT zone_id, assigned_rows FROM zone_allocations WHERE cellar_id = $1', [req.cellarId]);
    for (const r of allocWithZone.rows) {
      try {
        zoneAllocMap.set(r.zone_id, JSON.parse(r.assigned_rows || '[]'));
      } catch {
        zoneAllocMap.set(r.zone_id, []);
      }
    }

    let zonesChanged = 0;
    let actionsAutoSkipped = 0;

    for (let i = 0; i < actions.length; i++) {
      if (skipSet.has(i)) continue;
      const action = actions[i];
      if (!action || typeof action !== 'object') continue;

      if (action.type === 'reallocate_row') {
        // Move a row from one zone to another (within fixed 19-row limit)
        const { fromZoneId, toZoneId, rowNumber } = action;
        if (!fromZoneId || !toZoneId || rowNumber == null) continue;

        // reallocateRowTransactional now handles validation internally and returns status
        const result = await reallocateRowTransactional(client, req.cellarId, fromZoneId, toZoneId, rowNumber);

        if (result.skipped) {
          logger.warn('Reconfig', `Apply skipped reallocate_row action: ${result.reason}`);
          actionsAutoSkipped++;
          continue;
        }

        // Update our local map so subsequent actions see the change
        const rowId = typeof rowNumber === 'number' ? `R${rowNumber}` : String(rowNumber);
        const fromRows = zoneAllocMap.get(fromZoneId) || [];
        zoneAllocMap.set(fromZoneId, fromRows.filter(r => r !== rowId));
        const toRows = zoneAllocMap.get(toZoneId) || [];
        zoneAllocMap.set(toZoneId, [...toRows, rowId]);
        zonesChanged++;
      } else if (action.type === 'expand_zone') {
        const zoneId = action.zoneId;
        if (!zoneId) continue;

        const currentRows = Array.isArray(action.currentRows) ? action.currentRows : [];
        const proposedRows = Array.isArray(action.proposedRows) ? action.proposedRows : [];
        const needed = Math.max(1, proposedRows.length - currentRows.length);

        for (let n = 0; n < needed; n++) {
          await allocateRowTransactional(client, req.cellarId, zoneId, usedRows);
        }
        zonesChanged++;
      } else if (action.type === 'merge_zones') {
        const targetZoneId = action.targetZoneId;
        const sources = Array.isArray(action.sourceZones) ? action.sourceZones : [];
        if (!targetZoneId || sources.length === 0) continue;
        for (const sourceZoneId of sources) {
          await mergeZonesTransactional(client, req.cellarId, sourceZoneId, targetZoneId);
        }
        zonesChanged++;
      } else if (action.type === 'retire_zone') {
        const zoneId = action.zoneId;
        const mergeIntoZoneId = action.mergeIntoZoneId;
        if (!zoneId || !mergeIntoZoneId) continue;
        await mergeZonesTransactional(client, req.cellarId, zoneId, mergeIntoZoneId);
        zonesChanged++;
      }
    }

    const planJson = {
      planId,
      plan,
      options: stored.options || null,
      applied: {
        skipped: Array.from(skipSet),
        appliedAt: new Date().toISOString()
      },
      before: {
        affectedZones,
        zone_allocations: beforeAlloc.rows,
        wines: beforeWines.rows
      }
    };

    const insert = await client.query(
      `INSERT INTO zone_reconfigurations
       (plan_json, changes_summary, bottles_affected, misplaced_before, misplaced_after)
       VALUES ($1::jsonb, $2, $3, $4, $5)
       RETURNING id`,
      [
        JSON.stringify(planJson),
        plan.reasoning || null,
        plan.summary?.bottlesAffected ?? null,
        plan.summary?.misplacedBefore ?? null,
        plan.summary?.misplacedAfter ?? null
      ]
    );

    return {
      reconfigurationId: insert.rows[0].id,
      zonesChanged,
      actionsAutoSkipped
    };
  });

  deletePlan(planId);
  await invalidateAnalysisCache(null, req.cellarId);

  res.json({
    success: true,
    reconfigurationId: result.reconfigurationId,
    applied: {
      zonesChanged: result.zonesChanged,
      actionsAutoSkipped: result.actionsAutoSkipped,
      bottlesMoved: 0
    },
    canUndo: true
  });
}));

/**
 * POST /api/cellar/reconfiguration/:id/undo
 * Undo an applied reconfiguration.
 */
router.post('/reconfiguration/:id/undo', asyncHandler(async (req, res) => {
  const reconfigurationId = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(reconfigurationId)) {
    return res.status(400).json({ success: false, error: 'Invalid reconfiguration id' });
  }

  await ensureReconfigurationTables();

  await db.transaction(async (client) => {
    const row = await client.query(
      'SELECT id, plan_json, undone_at FROM zone_reconfigurations WHERE cellar_id = $1 AND id = $2',
      [req.cellarId, reconfigurationId]
    );

    const rec = row.rows[0];
    if (!rec) throw new Error('Reconfiguration not found');
    if (rec.undone_at) throw new Error('Reconfiguration already undone');

    const planJson = typeof rec.plan_json === 'string' ? JSON.parse(rec.plan_json) : rec.plan_json;
    const before = planJson?.before || {};
    const affectedZones = Array.isArray(before.affectedZones) ? before.affectedZones : [];
    const beforeAlloc = Array.isArray(before.zone_allocations) ? before.zone_allocations : [];
    const beforeWines = Array.isArray(before.wines) ? before.wines : [];

    if (affectedZones.length > 0) {
      await client.query('DELETE FROM zone_allocations WHERE cellar_id = $1 AND zone_id = ANY($2::text[])', [req.cellarId, affectedZones]);
    }

    for (const alloc of beforeAlloc) {
      await client.query(
        `INSERT INTO zone_allocations (cellar_id, zone_id, assigned_rows, wine_count, first_wine_date, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (cellar_id, zone_id) DO UPDATE SET
           assigned_rows = EXCLUDED.assigned_rows,
           wine_count = EXCLUDED.wine_count,
           first_wine_date = EXCLUDED.first_wine_date,
           updated_at = EXCLUDED.updated_at`,
        [
          alloc.cellar_id || req.cellarId,
          alloc.zone_id,
          alloc.assigned_rows,
          alloc.wine_count ?? 0,
          alloc.first_wine_date || null,
          alloc.updated_at || null
        ]
      );
    }

    for (const wine of beforeWines) {
      await client.query('UPDATE wines SET zone_id = $1 WHERE cellar_id = $2 AND id = $3', [wine.zone_id, req.cellarId, wine.id]);
    }

    await client.query('UPDATE zone_reconfigurations SET undone_at = NOW() WHERE id = $1', [reconfigurationId]);
  });

  await invalidateAnalysisCache(null, req.cellarId);

  res.json({ success: true, undone: true });
}));

/**
 * POST /api/cellar/execute-moves
 * Execute wine moves with validation and atomicity.
 */
router.post('/execute-moves', asyncHandler(async (req, res) => {
  const { moves } = req.body;
  if (!Array.isArray(moves) || moves.length === 0) {
    return res.status(400).json({ error: 'Moves array required' });
  }

  // Validate move plan before execution
  const validation = await validateMovePlan(moves, req.cellarId);

  if (!validation.valid) {
    return res.status(400).json({
      success: false,
      error: 'Move plan validation failed',
      validation,
      message: `Cannot execute moves: ${validation.summary.errorCount} validation error(s) detected`
    });
  }

  // Execute all moves in a transaction
  const results = [];

  await db.transaction(async (client) => {
    // Capture bottle count before moves for invariant check
    const beforeResult = await client.query(
      'SELECT COUNT(*) as count FROM slots WHERE wine_id IS NOT NULL AND cellar_id = $1',
      [req.cellarId]
    );
    const beforeCount = Number(beforeResult.rows[0].count);

    for (const move of moves) {
      // Clear source slot
      await client.query(
        'UPDATE slots SET wine_id = $1 WHERE cellar_id = $2 AND location_code = $3',
        [null, req.cellarId, move.from]
      );

      // Set target slot
      await client.query(
        'UPDATE slots SET wine_id = $1 WHERE cellar_id = $2 AND location_code = $3',
        [move.wineId, req.cellarId, move.to]
      );

      // Update wine zone assignment
      if (move.zoneId) {
        await client.query(
          'UPDATE wines SET zone_id = $1, zone_confidence = $2 WHERE cellar_id = $3 AND id = $4',
          [move.zoneId, move.confidence || 'medium', req.cellarId, move.wineId]
        );
      }

      results.push({
        wineId: move.wineId,
        from: move.from,
        to: move.to,
        success: true
      });
    }

    // Invariant check: bottle count must not change after moves
    const afterResult = await client.query(
      'SELECT COUNT(*) as count FROM slots WHERE wine_id IS NOT NULL AND cellar_id = $1',
      [req.cellarId]
    );
    const afterCount = Number(afterResult.rows[0].count);
    if (afterCount !== beforeCount) {
      throw new Error(`Invariant violation: bottle count changed from ${beforeCount} to ${afterCount}`);
    }
  });

  // Invalidate analysis cache after successful moves
  await invalidateAnalysisCache(null, req.cellarId);

  res.json({
    success: true,
    moved: results.length,
    results,
    validation
  });
}));

export default router;
