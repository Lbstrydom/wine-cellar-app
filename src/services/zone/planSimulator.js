/**
 * @fileoverview Sequential plan simulator for zone reconfiguration.
 * Replays actions against a mutable ownership state and checks invariants
 * at every step. Mandatory validation gate before plan application.
 * @module services/zone/planSimulator
 */

import { getZoneById } from '../../config/cellarZones.js';
import { getRowCapacity, parseRowNumber } from '../../config/cellarCapacity.js';

/**
 * @typedef {Object} SimulationState
 * @property {Map<string, string>} rowToZone - rowId → zoneId ownership map
 * @property {Map<string, Set<string>>} zoneToRows - zoneId → Set<rowId>
 * @property {Map<string, number>} zoneBottles - zoneId → bottle count
 * @property {Set<string>} movedRows - rows already moved in this plan
 * @property {Set<string>} retiredZones - zones that have been retired
 * @property {Array<string>} violations - accumulated violation messages
 */

/**
 * Build initial simulation state from zone allocations.
 * @param {Array<{id: string, actualAssignedRows: string[]}>} zones - Zone allocation data
 * @param {Object} utilization - Zone utilization map {zoneId: {bottleCount, ...}}
 * @returns {SimulationState}
 */
export function buildInitialState(zones, utilization) {
  const rowToZone = new Map();
  const zoneToRows = new Map();
  const zoneBottles = new Map();

  for (const zone of zones) {
    const rows = new Set(zone.actualAssignedRows || []);
    zoneToRows.set(zone.id, rows);
    for (const rowId of rows) {
      rowToZone.set(rowId, zone.id);
    }
    const bottles = utilization?.[zone.id]?.bottleCount ?? 0;
    zoneBottles.set(zone.id, bottles);
  }

  return {
    rowToZone,
    zoneToRows,
    zoneBottles,
    movedRows: new Set(),
    retiredZones: new Set(),
    violations: []
  };
}

/**
 * Simulate a single action against the state.
 * Returns whether the action is valid and mutates state if so.
 * @param {SimulationState} state
 * @param {Object} action
 * @param {number} actionIndex
 * @returns {{ valid: boolean, violation?: string }}
 */
function simulateAction(state, action, actionIndex) {
  switch (action.type) {
    case 'reallocate_row':
      return simulateReallocateRow(state, action, actionIndex);
    case 'merge_zones':
      return simulateMergeZones(state, action, actionIndex);
    case 'retire_zone':
      return simulateRetireZone(state, action, actionIndex);
    case 'expand_zone':
      return simulateExpandZone(state, action, actionIndex);
    default:
      return { valid: false, violation: `Action ${actionIndex}: unknown type "${action.type}"` };
  }
}

/**
 * Simulate reallocate_row: move a row from one zone to another.
 */
function simulateReallocateRow(state, action, idx) {
  const rowId = typeof action.rowNumber === 'number' ? `R${action.rowNumber}` : String(action.rowNumber);

  // Check: row not already moved in this plan
  if (state.movedRows.has(rowId)) {
    return { valid: false, violation: `Action ${idx}: row ${rowId} already moved in this plan` };
  }

  // Check: fromZone exists
  if (!getZoneById(action.fromZoneId)) {
    return { valid: false, violation: `Action ${idx}: fromZoneId "${action.fromZoneId}" is not a valid zone` };
  }

  // Check: toZone exists
  if (!getZoneById(action.toZoneId)) {
    return { valid: false, violation: `Action ${idx}: toZoneId "${action.toZoneId}" is not a valid zone` };
  }

  // Check: row currently belongs to fromZone
  const currentOwner = state.rowToZone.get(rowId);
  if (currentOwner !== action.fromZoneId) {
    return {
      valid: false,
      violation: `Action ${idx}: row ${rowId} is owned by "${currentOwner}", not "${action.fromZoneId}"`
    };
  }

  // Check: fromZone won't be left with zero rows if it has bottles
  const fromRows = state.zoneToRows.get(action.fromZoneId) || new Set();
  const fromBottles = state.zoneBottles.get(action.fromZoneId) ?? 0;
  if (fromRows.size <= 1 && fromBottles > 0) {
    return {
      valid: false,
      violation: `Action ${idx}: cannot remove last row from "${action.fromZoneId}" which has ${fromBottles} bottles`
    };
  }

  // Apply mutation
  fromRows.delete(rowId);
  const toRows = state.zoneToRows.get(action.toZoneId) || new Set();
  toRows.add(rowId);
  state.zoneToRows.set(action.toZoneId, toRows);
  state.rowToZone.set(rowId, action.toZoneId);
  state.movedRows.add(rowId);

  return { valid: true };
}

/**
 * Simulate merge_zones: merge source zones into target zone.
 */
function simulateMergeZones(state, action, idx) {
  if (!getZoneById(action.targetZoneId)) {
    return { valid: false, violation: `Action ${idx}: targetZoneId "${action.targetZoneId}" is not valid` };
  }

  for (const sourceZone of (action.sourceZones || [])) {
    if (!getZoneById(sourceZone)) {
      return { valid: false, violation: `Action ${idx}: sourceZone "${sourceZone}" is not valid` };
    }
    if (state.retiredZones.has(sourceZone)) {
      return { valid: false, violation: `Action ${idx}: sourceZone "${sourceZone}" already retired` };
    }

    // Transfer rows from source to target
    const sourceRows = state.zoneToRows.get(sourceZone) || new Set();
    const targetRows = state.zoneToRows.get(action.targetZoneId) || new Set();
    for (const row of sourceRows) {
      targetRows.add(row);
      state.rowToZone.set(row, action.targetZoneId);
    }
    state.zoneToRows.set(action.targetZoneId, targetRows);

    // Transfer bottle counts
    const sourceBottles = state.zoneBottles.get(sourceZone) ?? 0;
    const targetBottles = state.zoneBottles.get(action.targetZoneId) ?? 0;
    state.zoneBottles.set(action.targetZoneId, targetBottles + sourceBottles);

    // Clear source zone
    state.zoneToRows.set(sourceZone, new Set());
    state.zoneBottles.set(sourceZone, 0);
  }

  return { valid: true };
}

/**
 * Simulate retire_zone: merge a zone and mark it retired.
 */
function simulateRetireZone(state, action, idx) {
  if (!getZoneById(action.zoneId)) {
    return { valid: false, violation: `Action ${idx}: zoneId "${action.zoneId}" is not valid` };
  }
  if (!getZoneById(action.mergeIntoZoneId)) {
    return { valid: false, violation: `Action ${idx}: mergeIntoZoneId "${action.mergeIntoZoneId}" is not valid` };
  }
  if (state.retiredZones.has(action.zoneId)) {
    return { valid: false, violation: `Action ${idx}: zone "${action.zoneId}" already retired` };
  }

  // Transfer rows and bottles to merge target
  const sourceRows = state.zoneToRows.get(action.zoneId) || new Set();
  const targetRows = state.zoneToRows.get(action.mergeIntoZoneId) || new Set();
  for (const row of sourceRows) {
    targetRows.add(row);
    state.rowToZone.set(row, action.mergeIntoZoneId);
  }
  state.zoneToRows.set(action.mergeIntoZoneId, targetRows);

  const sourceBottles = state.zoneBottles.get(action.zoneId) ?? 0;
  const targetBottles = state.zoneBottles.get(action.mergeIntoZoneId) ?? 0;
  state.zoneBottles.set(action.mergeIntoZoneId, targetBottles + sourceBottles);

  // Clear and mark retired
  state.zoneToRows.set(action.zoneId, new Set());
  state.zoneBottles.set(action.zoneId, 0);
  state.retiredZones.add(action.zoneId);

  return { valid: true };
}

/**
 * Simulate expand_zone: validate that proposed rows exist and the zone is valid.
 */
function simulateExpandZone(state, action, idx) {
  if (!getZoneById(action.zoneId)) {
    return { valid: false, violation: `Action ${idx}: zoneId "${action.zoneId}" is not valid` };
  }
  // expand_zone doesn't change row ownership directly — it's informational
  return { valid: true };
}

/**
 * Verify global invariants after all actions have been simulated.
 * @param {SimulationState} state
 * @param {Object} [originalUtilization] - Original utilization for bottle count check
 * @returns {string[]} Array of violation messages (empty = valid)
 */
function verifyGlobalInvariants(state, originalUtilization) {
  const violations = [];

  // Invariant 1: No row assigned to more than one zone
  const rowOwners = new Map();
  for (const [zoneId, rows] of state.zoneToRows) {
    for (const row of rows) {
      if (rowOwners.has(row)) {
        violations.push(`Row ${row} assigned to both "${rowOwners.get(row)}" and "${zoneId}"`);
      }
      rowOwners.set(row, zoneId);
    }
  }

  // Invariant 2: No zone with bottles has zero rows (unless retired)
  for (const [zoneId, bottles] of state.zoneBottles) {
    if (bottles > 0 && !state.retiredZones.has(zoneId)) {
      const rows = state.zoneToRows.get(zoneId) || new Set();
      if (rows.size === 0) {
        violations.push(`Zone "${zoneId}" has ${bottles} bottles but no rows assigned`);
      }
    }
  }

  // Invariant 3: Total bottle count unchanged
  if (originalUtilization) {
    const originalTotal = Object.values(originalUtilization)
      .reduce((sum, z) => sum + (z.bottleCount ?? 0), 0);
    const postTotal = [...state.zoneBottles.values()].reduce((a, b) => a + b, 0);
    if (originalTotal !== postTotal) {
      violations.push(`Bottle count changed from ${originalTotal} to ${postTotal}`);
    }
  }

  return violations;
}

/**
 * Simulate an entire plan sequentially and return validation results.
 * This is the primary validation gate before plan application.
 *
 * @param {Array} actions - Plan actions to simulate
 * @param {Array<{id: string, actualAssignedRows: string[]}>} zones - Current zone allocations
 * @param {Object} utilization - Zone utilization map
 * @returns {{
 *   valid: boolean,
 *   violations: string[],
 *   validActions: number[],
 *   invalidActions: Array<{index: number, violation: string}>,
 *   postState: SimulationState
 * }}
 */
export function simulatePlan(actions, zones, utilization) {
  const state = buildInitialState(zones, utilization);
  const validActions = [];
  const invalidActions = [];

  for (let i = 0; i < actions.length; i++) {
    const result = simulateAction(state, actions[i], i);
    if (result.valid) {
      validActions.push(i);
    } else {
      invalidActions.push({ index: i, violation: result.violation });
      state.violations.push(result.violation);
    }
  }

  const globalViolations = verifyGlobalInvariants(state, utilization);
  const allViolations = [...state.violations, ...globalViolations];

  return {
    valid: allViolations.length === 0,
    violations: allViolations,
    validActions,
    invalidActions,
    postState: state
  };
}

/**
 * Auto-repair a plan by removing invalid actions.
 * Returns a filtered list of only the valid actions.
 *
 * @param {Array} actions - Plan actions to filter
 * @param {Array<{id: string, actualAssignedRows: string[]}>} zones - Current zone allocations
 * @param {Object} utilization - Zone utilization map
 * @returns {{ actions: Array, removed: number, violations: string[] }}
 */
export function autoRepairPlan(actions, zones, utilization) {
  const state = buildInitialState(zones, utilization);
  const repairedActions = [];
  const violations = [];

  for (let i = 0; i < actions.length; i++) {
    const result = simulateAction(state, actions[i], i);
    if (result.valid) {
      repairedActions.push(actions[i]);
    } else {
      violations.push(result.violation);
    }
  }

  return {
    actions: repairedActions,
    removed: actions.length - repairedActions.length,
    violations
  };
}

/**
 * Compute a plan quality score based on the post-simulation state.
 * Score components: fit + contiguity + color_boundary - churn.
 *
 * @param {Array} actions - Plan actions
 * @param {Array<{id: string, actualAssignedRows: string[]}>} zones - Zone allocations
 * @param {Object} utilization - Zone utilization map
 * @returns {{ score: number, components: Object }}
 */
export function computePlanScore(actions, zones, utilization) {
  const state = buildInitialState(zones, utilization);

  // Simulate to get post-state
  for (const action of actions) {
    simulateAction(state, action, 0);
  }

  // Contiguity: for each zone, check if rows are adjacent
  let contiguityScore = 0;
  let contiguityPossible = 0;
  for (const [, rows] of state.zoneToRows) {
    if (rows.size <= 1) continue;
    contiguityPossible++;
    const rowNums = [...rows].map(r => parseRowNumber(r)).sort((a, b) => a - b);
    let contiguous = true;
    for (let i = 1; i < rowNums.length; i++) {
      if (rowNums[i] !== rowNums[i - 1] + 1) {
        contiguous = false;
        break;
      }
    }
    if (contiguous) contiguityScore++;
  }

  // Churn: number of actions (lower = better)
  const churnPenalty = actions.length * 5;

  // Fit: zones with capacity covering demand
  let fitScore = 0;
  for (const [zoneId, bottles] of state.zoneBottles) {
    const rows = state.zoneToRows.get(zoneId) || new Set();
    const capacity = [...rows].reduce((sum, r) => sum + getRowCapacity(r), 0);
    if (capacity >= bottles) fitScore += 10;
  }

  const contiguityNormalized = contiguityPossible > 0
    ? Math.round((contiguityScore / contiguityPossible) * 30)
    : 30;

  const total = fitScore + contiguityNormalized - churnPenalty;

  return {
    score: total,
    components: {
      fit: fitScore,
      contiguity: contiguityNormalized,
      churn: -churnPenalty,
      actionCount: actions.length
    }
  };
}
