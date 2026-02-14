/**
 * @fileoverview Generates holistic zone reconfiguration plans.
 * Works within physical cellar constraints (fixed row count).
 * @module services/zone/zoneReconfigurationPlanner
 */

import anthropic from '../ai/claudeClient.js';
import { getZoneById, CELLAR_ZONES } from '../../config/cellarZones.js';
import { getNeverMergeZones } from './zonePins.js';
import { getModelForTask, getThinkingConfig } from '../../config/aiModels.js';
import { extractText } from '../ai/claudeResponseUtils.js';
import { getAllZoneAllocations } from '../cellar/cellarAllocation.js';
import { getEffectiveZoneColor } from '../cellar/cellarMetrics.js';
import { getTotalRows, getTotalCapacity, getRowCapacity } from '../../config/cellarCapacity.js';
import { validateActions, LLMDeltaResponseSchema, applyDelta } from '../../schemas/reconfigurationActions.js';
import { simulatePlan, autoRepairPlan } from './planSimulator.js';
import db from '../../db/index.js';
import logger from '../../utils/logger.js';
import {
  reviewReconfigurationPlan,
  applyPatches,
  saveTelemetry,
  hashPlan,
  calculateStabilityScore
} from '../ai/openaiReviewer.js';
import { solveRowAllocation } from './rowAllocationSolver.js';

// Physical cellar constraints — derived from capacity map
const TOTAL_CELLAR_ROWS = getTotalRows();
const TOTAL_CELLAR_CAPACITY = getTotalCapacity();

function clampStabilityBias(value) {
  if (value === 'low' || value === 'moderate' || value === 'high') return value;
  return 'moderate';
}

/**
 * Build a comprehensive picture of current zone utilization.
 * Aggregates per-row analysis entries into per-zone totals.
 */
function buildZoneUtilization(report) {
  const zoneAnalysis = Array.isArray(report?.zoneAnalysis) ? report.zoneAnalysis : [];
  const utilization = {};

  for (const za of zoneAnalysis) {
    const zoneId = za.zoneId;
    if (!zoneId) continue;

    if (!utilization[zoneId]) {
      utilization[zoneId] = {
        zoneId,
        zoneName: za.displayName || za.zoneName || zoneId,
        bottleCount: 0,
        rowCount: 0,
        capacity: 0,
        utilizationPct: 0,
        isOverflowing: false,
        misplacedCount: 0,
        correctCount: 0
      };
    }

    const entry = utilization[zoneId];
    entry.bottleCount += za.currentCount ?? za.bottleCount ?? 0;
    entry.rowCount += 1;
    // Use true row capacity instead of flat constant
    const rowId = za.rowId || za.row;
    entry.capacity += za.capacity ?? (rowId ? getRowCapacity(rowId) : 9);
    entry.isOverflowing = entry.isOverflowing || (za.isOverflowing || false);
    entry.misplacedCount += za.misplaced?.length ?? 0;
    entry.correctCount += za.correctlyPlaced?.length ?? 0;
  }

  // Calculate utilization percentage after aggregation
  for (const entry of Object.values(utilization)) {
    entry.utilizationPct = entry.capacity > 0
      ? Math.round((entry.bottleCount / entry.capacity) * 100)
      : 0;
  }

  return utilization;
}

/**
 * Identify underutilized zones that could donate rows.
 */
function findUnderutilizedZones(utilization, threshold = 40) {
  return Object.values(utilization)
    .filter(z => z.utilizationPct < threshold && z.rowCount > 1)
    .sort((a, b) => a.utilizationPct - b.utilizationPct);
}

/**
 * Identify related zones that could be merged.
 */
function findMergeCandidates(overflowingZones, allZones) {
  const candidates = [];

  for (const overflow of overflowingZones) {
    const zone = getZoneById(overflow.zoneId);
    if (!zone?.rules) continue;

    // Find zones with overlapping rules (same country, grape family, style)
    for (const other of allZones) {
      if (other.zoneId === overflow.zoneId) continue;
      const otherZone = getZoneById(other.zoneId);
      if (!otherZone?.rules) continue;

      const affinity = calculateZoneAffinity(zone, otherZone);
      if (affinity > 0.5) {
        candidates.push({
          sourceZone: overflow.zoneId,
          targetZone: other.zoneId,
          affinity,
          combinedBottles: overflow.bottleCount + other.bottleCount,
          reason: getAffinityReason(zone, otherZone)
        });
      }
    }
  }

  return candidates.sort((a, b) => b.affinity - a.affinity);
}

function calculateZoneAffinity(zone1, zone2) {
  let score = 0;
  const r1 = zone1.rules || {};
  const r2 = zone2.rules || {};

  // Same color is essential
  if (zone1.color === zone2.color) score += 0.3;

  // Overlapping grapes
  const grapes1 = new Set(r1.grapes || []);
  const grapes2 = new Set(r2.grapes || []);
  const grapeOverlap = [...grapes1].filter(g => grapes2.has(g)).length;
  if (grapeOverlap > 0) score += 0.2 * Math.min(grapeOverlap / 2, 1);

  // Same country
  const countries1 = new Set(r1.countries || []);
  const countries2 = new Set(r2.countries || []);
  const countryOverlap = [...countries1].filter(c => countries2.has(c)).length;
  if (countryOverlap > 0) score += 0.2;

  // Same winemaking style
  const winemaking1 = new Set(r1.winemaking || []);
  const winemaking2 = new Set(r2.winemaking || []);
  const winemakingOverlap = [...winemaking1].filter(w => winemaking2.has(w)).length;
  if (winemakingOverlap > 0) score += 0.3;

  return score;
}

function getAffinityReason(zone1, zone2) {
  const reasons = [];
  const r1 = zone1.rules || {};
  const r2 = zone2.rules || {};

  if (zone1.color === zone2.color) reasons.push(`both ${zone1.color}`);

  const countries1 = new Set(r1.countries || []);
  const countries2 = new Set(r2.countries || []);
  const sharedCountries = [...countries1].filter(c => countries2.has(c));
  if (sharedCountries.length > 0) reasons.push(`both from ${sharedCountries[0]}`);

  const winemaking1 = new Set(r1.winemaking || []);
  const winemaking2 = new Set(r2.winemaking || []);
  const sharedWinemaking = [...winemaking1].filter(w => winemaking2.has(w));
  if (sharedWinemaking.length > 0) reasons.push(`same style: ${sharedWinemaking[0]}`);

  return reasons.length > 0 ? reasons.join(', ') : 'similar wine styles';
}

function summarizeCapacityIssues(report) {
  const alerts = Array.isArray(report?.alerts) ? report.alerts : [];
  const issues = alerts.filter(a => a.type === 'zone_capacity_issue');

  const byZone = new Map();
  for (const issue of issues) {
    const data = issue.data || {};
    const zoneId = data.overflowingZoneId;
    if (!zoneId) continue;
    const wines = Array.isArray(data.winesNeedingPlacement) ? data.winesNeedingPlacement : [];
    const currentZoneAllocation = data.currentZoneAllocation || {};
    const availableRows = Array.isArray(data.availableRows) ? data.availableRows : [];

    if (!byZone.has(zoneId)) {
      byZone.set(zoneId, {
        overflowingZoneId: zoneId,
        overflowingZoneName: data.overflowingZoneName || zoneId,
        affectedCount: 0,
        winesNeedingPlacement: [],
        currentZoneAllocation,
        availableRows
      });
    }

    const entry = byZone.get(zoneId);
    entry.affectedCount += wines.length;
    entry.winesNeedingPlacement.push(...wines);
  }

  return Array.from(byZone.values());
}

function validatePlanShape(plan) {
  if (!plan || typeof plan !== 'object') throw new Error('Invalid plan');
  if (!Array.isArray(plan.actions)) throw new Error('Plan.actions must be an array');
  if (typeof plan.reasoning !== 'string') plan.reasoning = '';
  return plan;
}

function parseJsonObject(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

/**
 * Check if a reallocate_row action would create a color adjacency violation.
 * Simulates the row move and checks whether the target zone's color matches
 * the neighboring rows.
 * @param {Object} action - { fromZoneId, toZoneId, rowNumber }
 * @param {Map} zoneRowMap - Zone ID → assigned rows
 * @returns {boolean} True if the action would create a color violation
 */
function wouldCreateColorViolation(action, zoneRowMap) {
  if (action.type !== 'reallocate_row') return false;

  const toZone = getZoneById(action.toZoneId);
  if (!toZone) return false;

  const toColor = getEffectiveZoneColor(toZone);
  if (toColor === 'any') return false;

  const rowId = typeof action.rowNumber === 'number' ? `R${action.rowNumber}` : String(action.rowNumber);
  const rowNum = parseInt(rowId.replace('R', ''), 10);

  // Build current row→zone mapping
  const rowToZone = new Map();
  for (const [zoneId, rows] of zoneRowMap) {
    for (const r of rows) {
      rowToZone.set(r, zoneId);
    }
  }

  // Simulate the move
  rowToZone.set(rowId, action.toZoneId);

  // Check adjacent rows
  for (const adjacentRowNum of [rowNum - 1, rowNum + 1]) {
    if (adjacentRowNum < 1 || adjacentRowNum > 19) continue;
    const adjacentRowId = `R${adjacentRowNum}`;
    const adjacentZoneId = rowToZone.get(adjacentRowId);
    if (!adjacentZoneId || adjacentZoneId === action.toZoneId) continue;

    const adjacentZone = getZoneById(adjacentZoneId);
    if (!adjacentZone) continue;

    const adjacentColor = getEffectiveZoneColor(adjacentZone);
    if (adjacentColor === 'any') continue;

    if (toColor !== adjacentColor) {
      return true;
    }
  }

  return false;
}

// ═══════════════════════════════════════════════════════════════
// Complexity scoring for adaptive model escalation
// ═══════════════════════════════════════════════════════════════

/**
 * Compute a complexity score (0.0 to 1.0) for a reconfiguration scenario.
 * Higher scores indicate more complex situations that benefit from Opus 4.6
 * adaptive thinking over Sonnet 4.5.
 *
 * @param {Object} params
 * @param {Array} params.overflowingZones - Zones that need more capacity
 * @param {Array} params.colorAdjacencyIssues - Unresolved color boundary violations
 * @param {Set} params.neverMerge - Active pin constraints
 * @param {number} params.solverActionCount - Actions from the deterministic solver
 * @param {Array} params.scatteredWines - Wines spread across non-adjacent rows
 * @param {number} params.totalBottles - Total bottles in cellar
 * @returns {{ score: number, factors: Object }}
 */
export function computeComplexityScore({
  overflowingZones = [],
  colorAdjacencyIssues = [],
  neverMerge = new Set(),
  solverActionCount = 0,
  scatteredWines = [],
  totalBottles = 0
}) {
  let score = 0;
  const factors = {};

  // Many deficit zones → needs strategic thinking
  if (overflowingZones.length > 3) {
    score += 0.2;
    factors.manyDeficits = true;
  }

  // Unresolved color boundary violations → spatial reasoning
  const colorIssueCount = Array.isArray(colorAdjacencyIssues) ? colorAdjacencyIssues.length : 0;
  if (colorIssueCount > 2) {
    score += 0.2;
    factors.colorConflicts = colorIssueCount;
  }

  // Many pin constraints → constrained optimization
  const pinCount = neverMerge instanceof Set ? neverMerge.size : 0;
  if (pinCount > 2) {
    score += 0.2;
    factors.pinConstraints = pinCount;
  }

  // Solver produced many actions → complex rebalancing
  if (solverActionCount > 4) {
    score += 0.2;
    factors.highSolverOutput = solverActionCount;
  }

  // Many scattered wines → consolidation requires strategic insight
  if (scatteredWines.length > 5) {
    score += 0.2;
    factors.scatteredWines = scatteredWines.length;
  }

  return { score: Math.min(score, 1.0), factors };
}

// ═══════════════════════════════════════════════════════════════
// Layer 2: LLM refinement (receives solver draft for improvement)
// ═══════════════════════════════════════════════════════════════

/**
 * Call LLM to refine/augment the solver's draft plan.
 *
 * Uses a structured delta protocol: the LLM returns patches against the
 * solver draft (accept/remove/patch/add) instead of a full rewrite.
 *
 * Escalates from Sonnet 4.5 to Opus 4.6 with adaptive thinking when the
 * complexity score exceeds 0.6 (many deficits, color conflicts, or pin constraints).
 *
 * @param {Object} ctx - All context needed for the LLM call
 * @returns {{ actions: Array, reasoning: string, telemetry: Object }}
 */
async function refinePlanWithLLM(ctx) {
  const {
    solverActions, solverReasoning,
    zonesWithAllocations, utilization, allZones,
    capacityIssues, underutilizedZones, mergeCandidates,
    neverMerge, stability, includeRetirements,
    totalBottles, misplacedBottles, misplacementPct,
    report, zoneRowMap, complexityScore
  } = ctx;

  const statePayload = {
    physicalConstraints: {
      totalRows: TOTAL_CELLAR_ROWS,
      totalCapacity: TOTAL_CELLAR_CAPACITY,
      rowCapacities: { R1: 7, default: 9 }
    },
    currentState: { totalBottles, misplaced: misplacedBottles, misplacementPct },
    zones: zonesWithAllocations,
    zoneUtilization: allZones.map(z => ({
      zoneId: z.zoneId, zoneName: z.zoneName, bottleCount: z.bottleCount,
      rowCount: z.rowCount, capacity: z.capacity,
      utilizationPct: z.utilizationPct, isOverflowing: z.isOverflowing
    })),
    overflowingZones: capacityIssues.map(i => ({
      zoneId: i.overflowingZoneId, zoneName: i.overflowingZoneName,
      affectedCount: i.affectedCount,
      currentRows: i.currentZoneAllocation?.[i.overflowingZoneId] || []
    })),
    underutilizedZones: underutilizedZones.map(z => ({
      zoneId: z.zoneId, zoneName: z.zoneName, utilizationPct: z.utilizationPct,
      rowCount: z.rowCount, bottleCount: z.bottleCount, canDonateRows: z.rowCount - 1
    })),
    mergeCandidates: mergeCandidates.slice(0, 5).map(c => ({
      sourceZone: c.sourceZone, targetZone: c.targetZone,
      affinity: c.affinity, reason: c.reason
    })),
    constraints: {
      neverMergeZones: Array.from(neverMerge),
      includeRetirements,
      stabilityBias: stability,
      flexibleColorAllocation: false
    },
    scatteredWines: (report.scatteredWines || []).slice(0, 10).map(sw => ({
      wineName: sw.wineName, bottleCount: sw.bottleCount, rows: sw.rows
    })),
    colorAdjacencyIssues: (report.colorAdjacencyIssues || []).map(ci => ({
      row1: ci.row1, zone1: ci.zone1, zone1Name: ci.zone1Name, color1: ci.color1,
      row2: ci.row2, zone2: ci.zone2, zone2Name: ci.zone2Name, color2: ci.color2
    }))
  };

  // Determine model: escalate to Opus for high complexity
  const useOpus = (complexityScore?.score ?? 0) >= 0.6;
  const taskKey = useOpus ? 'zoneReconfigEscalation' : 'zoneReconfigurationPlan';
  const modelId = getModelForTask(taskKey);
  const maxTokens = useOpus ? 16000 : 8000;

  if (useOpus) {
    logger.info('Reconfig', `Complexity score ${complexityScore.score.toFixed(2)} >= 0.6 — escalating to Opus 4.6 with adaptive thinking`);
    logger.info('Reconfig', `Complexity factors: ${JSON.stringify(complexityScore.factors)}`);
  }

  const system = `You are a sommelier REVIEWING and REFINING an algorithmically generated cellar reconfiguration plan.
The cellar has exactly ${TOTAL_CELLAR_ROWS} rows (R1 has 7 slots, R2-R19 have 9 slots each, 169 total). You CANNOT add new rows.

A deterministic solver has produced a draft plan with ${solverActions.length} action(s). Your job is to return a DELTA response:

1. accept_action_indices: indices of solver actions to keep as-is
2. remove_action_indices: indices of solver actions to remove (counterproductive)
3. patches: field-level modifications to accepted actions [{action_index, field, value}]
4. new_actions: additional actions the solver missed (max 5)
5. reasoning: strategic explanation of your refinements

${useOpus ? `DEEP ANALYSIS MODE: This is a complex reconfiguration scenario. Think carefully about:
- Multi-zone cascading effects (moving one row affects adjacent zones)
- Optimal contiguity (keep same zone's rows adjacent)
- Strategic merges that improve thematic organization
- Long-term cellar evolution (growth patterns, seasonal patterns)` : ''}

COLOR BOUNDARY RULE: White wines in lower rows (1-7), red wines in higher rows (8-19). Never adjacent.
CONSOLIDATION RULE: Same wine type should be physically near each other for easy access.

Respond with valid JSON only matching the delta schema.`;

  const draftSection = solverActions.length > 0
    ? `\n\nDRAFT PLAN (indexed for delta reference):
${solverActions.map((a, i) => `[${i}] ${JSON.stringify(a)}`).join('\n')}

Solver reasoning: ${solverReasoning}`
    : '\n\nNo solver actions — generate new_actions from scratch.';

  const user = `Review and refine within the ${TOTAL_CELLAR_ROWS}-row limit.

STATE JSON:
${JSON.stringify(statePayload, null, 2)}
${draftSection}

Return JSON delta: {
  "accept_action_indices": [0, 1, ...],
  "remove_action_indices": [2, ...],
  "patches": [{"action_index": 0, "field": "priority", "value": 1}],
  "new_actions": [{"type": "reallocate_row"|"merge_zones"|"retire_zone", ...}],
  "reasoning": "strategic explanation"
}

Action field requirements:
- reallocate_row: fromZoneId (string), toZoneId (string), rowNumber (number), reason (string), bottlesAffected (number), priority (1-5)
- merge_zones: sourceZones (string[]), targetZoneId (string), reason, bottlesAffected, priority
- retire_zone: zoneId (string), mergeIntoZoneId (string), reason, bottlesAffected, priority
Zone IDs are lowercase with underscores (e.g. "chenin_blanc").
Stability: "${stability}". neverMerge: ${JSON.stringify(Array.from(neverMerge))}`;

  const llmStart = Date.now();

  const response = await anthropic.messages.create({
    model: modelId,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: user }],
    ...(getThinkingConfig(taskKey) || {})
  });

  const llmMs = Date.now() - llmStart;
  logger.info('Reconfig', `LLM refinement completed in ${llmMs}ms (model: ${modelId})`);

  const text = extractText(response);
  const json = parseJsonObject(text);
  if (!json) throw new Error('Invalid AI response (not JSON)');

  // Try to parse as delta protocol first, fall back to legacy full-plan format
  const deltaResult = LLMDeltaResponseSchema.safeParse(json);

  let actions, reasoning;
  const llmTelemetry = {
    model: modelId,
    latencyMs: llmMs,
    usedOpus: useOpus,
    complexityScore: complexityScore?.score ?? 0,
    complexityFactors: complexityScore?.factors ?? {},
    protocol: 'unknown'
  };

  if (deltaResult.success) {
    // Delta protocol — apply patches to solver draft
    const delta = deltaResult.data;
    const merged = applyDelta(solverActions, delta);
    actions = merged.actions;
    reasoning = delta.reasoning;
    llmTelemetry.protocol = 'delta';
    llmTelemetry.patchesApplied = merged.patchesApplied;
    llmTelemetry.actionsRemoved = (delta.remove_action_indices || []).length;
    llmTelemetry.actionsAdded = (delta.new_actions || []).length;
    logger.info('Reconfig', `Delta protocol: ${merged.patchesApplied} patches, ${llmTelemetry.actionsRemoved} removed, ${llmTelemetry.actionsAdded} added`);
  } else {
    // Legacy full-plan format (backward compatible)
    const plan = validatePlanShape(json);
    actions = plan.actions;
    reasoning = plan.reasoning;
    llmTelemetry.protocol = 'legacy';
    logger.info('Reconfig', 'LLM returned legacy format, not delta protocol');
  }

  // Validate actions through schema and zone/row filters
  const { valid: schemaValid } = validateActions(actions);
  actions = filterLLMActions(schemaValid.length > 0 ? schemaValid : actions, zoneRowMap, neverMerge);

  return { actions, reasoning, llmTelemetry };
}

/**
 * Filter LLM-generated actions for validity (zone IDs, row ownership, etc.).
 * @param {Array} actions
 * @param {Map} zoneRowMap
 * @param {Set} neverMerge
 * @returns {Array} Validated actions
 */
function filterLLMActions(actions, zoneRowMap, neverMerge) {
  const originalCount = actions.length;
  const filtered = actions.filter(a => {
    if (a.type === 'reallocate_row') {
      const fromValid = !!getZoneById(a.fromZoneId);
      const toValid = !!getZoneById(a.toZoneId);
      if (!fromValid || !toValid) {
        logger.warn('Reconfig', `Filtering invalid reallocate_row: fromZoneId="${a.fromZoneId}" (valid=${fromValid}), toZoneId="${a.toZoneId}" (valid=${toValid})`);
        return false;
      }
      const fromRows = zoneRowMap.get(a.fromZoneId) || [];
      const rowId = typeof a.rowNumber === 'number' ? `R${a.rowNumber}` : String(a.rowNumber);
      if (!fromRows.includes(rowId)) {
        logger.warn('Reconfig', `Filtering invalid reallocate_row: row ${rowId} is not in ${a.fromZoneId}'s actualAssignedRows ${JSON.stringify(fromRows)}`);
        return false;
      }
      if (wouldCreateColorViolation(a, zoneRowMap)) {
        logger.warn('Reconfig', `reallocate_row ${rowId} from ${a.fromZoneId} to ${a.toZoneId} would create color adjacency violation`);
        a._colorViolationWarning = true;
      }
      return true;
    }
    if (a.type === 'expand_zone') {
      const valid = !!getZoneById(a.zoneId);
      if (!valid) logger.warn('Reconfig', `Filtering invalid expand_zone: zoneId="${a.zoneId}"`);
      return valid;
    }
    if (a.type === 'merge_zones') {
      if (!Array.isArray(a.sourceZones)) return false;
      if (!getZoneById(a.targetZoneId)) return false;
      const allValid = a.sourceZones.every(z => !!getZoneById(z));
      if (!allValid) return false;
      return a.sourceZones.every(z => !neverMerge.has(z));
    }
    if (a.type === 'retire_zone') {
      if (!getZoneById(a.zoneId) || !getZoneById(a.mergeIntoZoneId)) return false;
      return !neverMerge.has(a.zoneId);
    }
    logger.warn('Reconfig', `Filtering unknown action type: ${a.type}`);
    return false;
  });

  if (filtered.length < originalCount) {
    logger.warn('Reconfig', `Filtered ${originalCount - filtered.length} invalid LLM actions`);
  }
  return filtered;
}

// ═══════════════════════════════════════════════════════════════
// Layer 3: Heuristic gap-fill
// ═══════════════════════════════════════════════════════════════

/**
 * Patch remaining capacity deficits that the solver and LLM both missed.
 * Adds simple single-donor-per-overflow reallocation actions.
 *
 * @param {Array} existingActions - Actions from previous layers
 * @param {Array} capacityIssues - Overflowing zones
 * @param {Array} underutilizedZones
 * @param {Array} mergeCandidates
 * @param {Set} neverMerge
 * @param {Array} zonesWithAllocations
 * @param {string} stability
 * @returns {Array} Combined actions (existing + patches)
 */
function heuristicGapFill(
  existingActions, capacityIssues, underutilizedZones,
  mergeCandidates, neverMerge, zonesWithAllocations, stability
) {
  // Check which overflow zones were already addressed
  const addressedZones = new Set(
    existingActions
      .filter(a => a.type === 'reallocate_row')
      .map(a => a.toZoneId)
  );
  const addressedMerges = new Set(
    existingActions
      .filter(a => a.type === 'merge_zones' || a.type === 'retire_zone')
      .flatMap(a => a.type === 'merge_zones' ? a.sourceZones : [a.zoneId])
  );

  const rowsAlreadyMoved = new Set(
    existingActions
      .filter(a => a.type === 'reallocate_row')
      .map(a => typeof a.rowNumber === 'number' ? `R${a.rowNumber}` : String(a.rowNumber))
  );

  const newActions = [];
  const zoneRowMapHeuristic = new Map();
  for (const z of zonesWithAllocations) {
    zoneRowMapHeuristic.set(z.id, z.actualAssignedRows || []);
  }

  // Patch unaddressed capacity issues
  for (const issue of capacityIssues) {
    const toZoneId = issue.overflowingZoneId;
    if (addressedZones.has(toZoneId)) continue;
    if (!getZoneById(toZoneId)) continue;

    for (const donor of underutilizedZones) {
      if (donor.zoneId === toZoneId) continue;
      if (donor.rowCount <= 1) continue;
      if (neverMerge.has(donor.zoneId)) continue;

      const donorRows = zoneRowMapHeuristic.get(donor.zoneId) || [];
      const availableRow = donorRows.find(r => !rowsAlreadyMoved.has(r));
      if (availableRow) {
        rowsAlreadyMoved.add(availableRow);
        newActions.push({
          type: 'reallocate_row',
          priority: 3,
          fromZoneId: donor.zoneId,
          toZoneId,
          rowNumber: availableRow,
          reason: `[heuristic] ${donor.zoneName} is ${donor.utilizationPct}% full; reallocate row ${availableRow} to ${issue.overflowingZoneName}`,
          bottlesAffected: issue.affectedCount
        });
        break;
      }
    }
  }

  // If nothing was produced at all, try a merge
  if (existingActions.length === 0 && newActions.length === 0 && mergeCandidates.length > 0) {
    const best = mergeCandidates[0];
    if (!neverMerge.has(best.sourceZone) && !neverMerge.has(best.targetZone) && !addressedMerges.has(best.sourceZone)) {
      newActions.push({
        type: 'merge_zones',
        priority: 3,
        sourceZones: [best.sourceZone],
        targetZoneId: best.targetZone,
        reason: `[heuristic] Merge ${best.sourceZone} into ${best.targetZone}: ${best.reason}`,
        bottlesAffected: best.combinedBottles
      });
    }
  }

  const combined = [...existingActions, ...newActions];
  const maxActions = stability === 'high' ? 3 : stability === 'moderate' ? 6 : 10;
  return combined.slice(0, maxActions);
}

function computeSummary(report, actions) {
  const misplacedBefore = report?.summary?.misplacedBottles ?? 0;
  const bottlesAffected = actions.reduce((sum, a) => sum + (a.bottlesAffected || 0), 0);

  // Conservative estimate: we don't claim a dramatic improvement without simulating.
  const misplacedAfter = Math.max(0, misplacedBefore - Math.min(misplacedBefore, Math.round(bottlesAffected / 2)));

  return {
    zonesChanged: actions.length,
    bottlesAffected,
    misplacedBefore,
    misplacedAfter
  };
}

/**
 * Build list of all zones with their ACTUAL current row allocations from the database.
 * This is critical for the AI to know which rows each zone actually owns.
 */
async function buildZoneListWithAllocations(cellarId) {
  const zones = CELLAR_ZONES.zones || [];
  const allocations = await getAllZoneAllocations(cellarId);

  // Create a map of zoneId -> assigned_rows from database
  const allocMap = new Map();
  for (const alloc of allocations) {
    allocMap.set(alloc.zone_id, alloc.assigned_rows || []);
  }

  return zones.map(z => ({
    id: z.id,
    name: z.displayName || z.name || z.id,
    color: z.color,
    preferredRows: z.rows || z.preferredRowRange || [],
    // ACTUAL rows currently assigned in the database - this is what the AI must use
    actualAssignedRows: allocMap.get(z.id) || []
  }));
}

/**
 * Generate a holistic reconfiguration plan.
 * Works within the fixed physical constraints of the cellar (19 rows total).
 * If Claude is not configured, returns a deterministic heuristic plan.
 */
export async function generateReconfigurationPlan(report, options = {}) {
  const {
    includeRetirements = true,
    stabilityBias = 'moderate',
    cellarId
  } = options;

  const stability = clampStabilityBias(stabilityBias);
  const neverMerge = await getNeverMergeZones(cellarId);

  const capacityIssues = summarizeCapacityIssues(report);
  const totalBottles = report?.summary?.totalBottles ?? 0;
  const misplacedBottles = report?.summary?.misplacedBottles ?? 0;
  const misplacementPct = totalBottles > 0 ? Math.round((misplacedBottles / totalBottles) * 100) : 0;

  const utilization = buildZoneUtilization(report);
  const allZones = Object.values(utilization);
  const overflowingZones = allZones.filter(z => z.isOverflowing);
  const underutilizedZones = findUnderutilizedZones(utilization, 40);
  const mergeCandidates = findMergeCandidates(overflowingZones, allZones);

  const zonesWithAllocations = await buildZoneListWithAllocations(cellarId);

  // ═══════════════════════════════════════════════════════════════
  // ITERATIVE 4-LAYER PIPELINE
  //
  //   Layer 1 — Solver:     Fast deterministic baseline          (<10ms)
  //   Layer 2 — LLM:        Delta refinement with Opus escalation (~5-45s)
  //   Layer 3 — Heuristic:  Fills gaps neither layer caught       (<1ms)
  //   Layer 4 — Simulator:  Sequential validation gate            (<1ms)
  //
  // The layers are additive. The LLM uses a delta protocol (patches
  // against the solver draft). Opus 4.6 adaptive thinking is used
  // when the complexity score exceeds 0.6 for deep strategic insight.
  // ═══════════════════════════════════════════════════════════════

  // Pipeline telemetry
  const telemetry = {
    pipelineStartMs: Date.now(),
    solverLatencyMs: 0,
    llmLatencyMs: 0,
    heuristicLatencyMs: 0,
    simulatorLatencyMs: 0,
    complexityScore: 0,
    complexityFactors: {},
    llmModel: null,
    llmProtocol: null,
    usedOpus: false,
    actionsBySource: { solver: 0, llm: 0, heuristic: 0 },
    simulatorResult: null,
    autoRepaired: 0
  };

  // Shared row map for validation across all layers
  const zoneRowMap = new Map();
  for (const z of zonesWithAllocations) {
    zoneRowMap.set(z.id, [...(z.actualAssignedRows || [])]);
  }

  // ─── Layer 1: Deterministic solver ───────────────────────────
  let solverActions = [];
  let solverReasoning = '';
  try {
    const solverStart = Date.now();
    const solverResult = solveRowAllocation({
      zones: zonesWithAllocations,
      utilization,
      overflowingZones,
      underutilizedZones,
      mergeCandidates,
      neverMerge,
      stabilityBias: stability,
      scatteredWines: report.scatteredWines || [],
      colorAdjacencyIssues: report.colorAdjacencyIssues || []
    });
    telemetry.solverLatencyMs = Date.now() - solverStart;
    logger.info('Reconfig', `Solver completed in ${telemetry.solverLatencyMs}ms with ${solverResult.actions.length} action(s)`);
    solverActions = solverResult.actions;
    solverReasoning = solverResult.reasoning;
    telemetry.actionsBySource.solver = solverActions.length;
  } catch (solverErr) {
    logger.error('Reconfig', `Solver failed: ${solverErr.message}`);
  }

  // ─── Complexity scoring (determines Sonnet vs Opus) ──────────
  const complexityScore = computeComplexityScore({
    overflowingZones,
    colorAdjacencyIssues: report.colorAdjacencyIssues || [],
    neverMerge,
    solverActionCount: solverActions.length,
    scatteredWines: report.scatteredWines || [],
    totalBottles
  });
  telemetry.complexityScore = complexityScore.score;
  telemetry.complexityFactors = complexityScore.factors;

  // ─── Layer 2: LLM refinement (delta protocol + Opus escalation) ───
  let llmActions = null;  // null = LLM skipped or failed
  let llmReasoning = '';
  let llmTelemetry = null;
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const llmResult = await refinePlanWithLLM({
        solverActions,
        solverReasoning,
        zonesWithAllocations,
        utilization,
        allZones,
        capacityIssues,
        underutilizedZones,
        mergeCandidates,
        neverMerge,
        stability,
        includeRetirements,
        totalBottles,
        misplacedBottles,
        misplacementPct,
        report,
        zoneRowMap,
        complexityScore
      });
      llmActions = llmResult.actions;
      llmReasoning = llmResult.reasoning;
      llmTelemetry = llmResult.llmTelemetry;
      telemetry.llmLatencyMs = llmTelemetry?.latencyMs ?? 0;
      telemetry.llmModel = llmTelemetry?.model ?? null;
      telemetry.llmProtocol = llmTelemetry?.protocol ?? null;
      telemetry.usedOpus = llmTelemetry?.usedOpus ?? false;
      telemetry.actionsBySource.llm = (llmTelemetry?.actionsAdded ?? 0);
    } catch (llmErr) {
      logger.warn('Reconfig', `LLM refinement failed: ${llmErr.message} — using solver output`);
    }
  }

  // ─── Layer 3: Heuristic gap-fill ────────────────────────────
  const heuristicStart = Date.now();
  const baseActions = llmActions ?? [...solverActions];
  const baseReasoning = llmActions ? llmReasoning : solverReasoning;
  const baseSource = llmActions ? 'solver+llm' : (solverActions.length > 0 ? 'solver' : 'heuristic');

  const patchedActions = heuristicGapFill(
    baseActions, capacityIssues, underutilizedZones,
    mergeCandidates, neverMerge, zonesWithAllocations, stability
  );
  telemetry.heuristicLatencyMs = Date.now() - heuristicStart;
  telemetry.actionsBySource.heuristic = Math.max(0, patchedActions.length - baseActions.length);

  // ─── Layer 4: Sequential plan simulator (validation gate) ────
  const simulatorStart = Date.now();
  const simResult = simulatePlan(patchedActions, zonesWithAllocations, utilization);
  telemetry.simulatorLatencyMs = Date.now() - simulatorStart;
  telemetry.simulatorResult = simResult.valid ? 'pass' : 'fail';

  let finalActions = patchedActions;
  if (!simResult.valid) {
    logger.warn('Reconfig', `Simulator found ${simResult.violations.length} violation(s) — auto-repairing`);
    const repaired = autoRepairPlan(patchedActions, zonesWithAllocations, utilization);
    finalActions = repaired.actions;
    telemetry.autoRepaired = repaired.removed;
    logger.info('Reconfig', `Auto-repair removed ${repaired.removed} invalid action(s)`);
  }

  telemetry.totalLatencyMs = Date.now() - telemetry.pipelineStartMs;

  const planResult = {
    source: finalActions.length > baseActions.length ? `${baseSource}+heuristic` : baseSource,
    reasoning: baseReasoning || 'No reconfiguration actions needed or possible within current constraints.',
    actions: finalActions
  };

  const initialSummary = computeSummary(report, planResult.actions);
  const planWithSummary = { ...planResult, summary: initialSummary };

  const reviewContext = {
    zones: zonesWithAllocations,
    physicalConstraints: {
      totalRows: TOTAL_CELLAR_ROWS,
      totalCapacity: TOTAL_CELLAR_CAPACITY
    },
    currentState: {
      totalBottles,
      misplaced: misplacedBottles,
      misplacementPct
    }
  };

  const planId = `plan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const reviewResult = await reviewReconfigurationPlan(planWithSummary, reviewContext, { planId });

  let finalPlan = { ...planWithSummary };
  const reviewTelemetry = reviewResult.telemetry || null;

  if (!reviewResult.skipped) {
    if (reviewResult.verdict === 'approve') {
      finalPlan = { ...planWithSummary };
    } else if (reviewResult.verdict === 'patch') {
      finalPlan = applyPatches(planWithSummary, reviewResult.patches);
      if (reviewTelemetry) {
        reviewTelemetry.output_plan_hash = hashPlan(finalPlan);
        reviewTelemetry.output_action_count = finalPlan.actions?.length || 0;
      }
    } else if (reviewResult.verdict === 'reject') {
      finalPlan = { ...planWithSummary, _reviewerRejected: true, _rejectionReason: reviewResult.reasoning };
    }
  }

  if (reviewTelemetry && !reviewTelemetry.output_plan_hash) {
    reviewTelemetry.output_plan_hash = hashPlan(finalPlan);
    reviewTelemetry.output_action_count = finalPlan.actions?.length || 0;
  }

  if (reviewTelemetry) {
    try {
      // Await persistence so telemetry is reliably available immediately after the request.
      await saveTelemetry(db, reviewTelemetry, { swallowErrors: false });
    } catch (err) {
      logger.error('Reconfig', 'Failed to save telemetry: ' + err.message);
    }
  }

  const finalSummary = computeSummary(report, finalPlan.actions);
  const stabilityScore = reviewTelemetry?.stability_score ?? calculateStabilityScore(finalPlan, { totalBottles });

  return {
    summary: finalSummary,
    reasoning: finalPlan.reasoning,
    actions: finalPlan.actions,
    _reviewMetadata: reviewTelemetry ? {
      verdict: reviewTelemetry.verdict,
      patchesApplied: finalPlan._patchesApplied || 0,
      stabilityScore,
      latencyMs: reviewTelemetry.latency_ms,
      reviewerModel: reviewTelemetry.reviewer_model,
      wasFallback: Boolean(reviewTelemetry.was_fallback)
    } : {
      stabilityScore
    },
    _pipelineTelemetry: {
      solverLatencyMs: telemetry.solverLatencyMs,
      llmLatencyMs: telemetry.llmLatencyMs,
      heuristicLatencyMs: telemetry.heuristicLatencyMs,
      simulatorLatencyMs: telemetry.simulatorLatencyMs,
      totalLatencyMs: telemetry.totalLatencyMs,
      complexityScore: telemetry.complexityScore,
      complexityFactors: telemetry.complexityFactors,
      llmModel: telemetry.llmModel,
      llmProtocol: telemetry.llmProtocol,
      usedOpus: telemetry.usedOpus,
      actionsBySource: telemetry.actionsBySource,
      simulatorResult: telemetry.simulatorResult,
      autoRepaired: telemetry.autoRepaired
    }
  };
}
