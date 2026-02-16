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
import { getCellarLayoutSettings } from '../shared/cellarLayoutSettings.js';
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

// Physical cellar constraints
const TOTAL_CELLAR_ROWS = 19;
const SLOTS_PER_ROW = 9; // Most rows have 9 slots (row 1 has 7)

function clampStabilityBias(value) {
  if (value === 'low' || value === 'moderate' || value === 'high') return value;
  return 'moderate';
}

/**
 * Check if a reconfiguration action involves a specific zone.
 * Used to filter plan actions when scoped to a single zone (focusZoneId).
 * @param {Object} action - A reconfiguration action
 * @param {string} zoneId - The zone to check involvement for
 * @returns {boolean}
 */
function actionInvolvesZone(action, zoneId) {
  if (!action || !zoneId) return false;
  const type = action.type;

  if (type === 'reallocate_row') {
    return action.fromZoneId === zoneId || action.toZoneId === zoneId;
  }
  if (type === 'expand_zone') {
    return action.zoneId === zoneId;
  }
  if (type === 'merge_zones') {
    if (action.targetZoneId === zoneId) return true;
    if (Array.isArray(action.sourceZones) && action.sourceZones.includes(zoneId)) return true;
    return false;
  }
  if (type === 'retire_zone') {
    return action.zoneId === zoneId || action.targetZoneId === zoneId;
  }
  return false;
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
    entry.capacity += za.capacity ?? SLOTS_PER_ROW;
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
// Layer 2: LLM refinement (receives solver draft for improvement)
// ═══════════════════════════════════════════════════════════════

/**
 * Call LLM to refine/augment the solver's draft plan.
 * The LLM receives the draft and can accept, modify, reorder, or add actions.
 * Much faster than generating from scratch because the LLM validates rather than creates.
 *
 * @param {Object} ctx - All context needed for the LLM call
 * @returns {{ actions: Array, reasoning: string }}
 */
async function refinePlanWithLLM(ctx) {
  const {
    solverActions, solverReasoning,
    zonesWithAllocations, utilization, allZones,
    capacityIssues, underutilizedZones, mergeCandidates,
    neverMerge, stability, includeRetirements,
    totalBottles, misplacedBottles, misplacementPct,
    report, zoneRowMap,
    colourOrder = 'whites-top'
  } = ctx;

  const statePayload = {
    physicalConstraints: {
      totalRows: TOTAL_CELLAR_ROWS,
      slotsPerRow: SLOTS_PER_ROW,
      totalCapacity: TOTAL_CELLAR_ROWS * SLOTS_PER_ROW
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

  const system = `You are a sommelier REVIEWING and REFINING an algorithmically generated cellar reconfiguration plan.
The cellar has exactly ${TOTAL_CELLAR_ROWS} rows. You CANNOT add new rows.

A solver has already produced a draft plan. Your job is to:
1. ACCEPT good actions as-is
2. MODIFY actions if they can be improved (better donor, better priority, better reasoning)
3. ADD new actions the solver missed (strategic merges, zone restructuring)
4. REMOVE actions that are counterproductive
5. Write a concise reasoning narrative explaining the strategic vision

COLOR BOUNDARY RULE: ${colourOrder === 'reds-top' ? 'Red wines in lower rows, white wines in higher rows' : 'White wines in lower rows, red wines in higher rows'}. Never adjacent.
CONSOLIDATION RULE: Same wine type should be physically near each other.

You MUST respond with valid JSON only. Be concise.`;

  // Include the solver's draft in the prompt so the LLM can build on it
  const draftSection = solverActions.length > 0
    ? `\n\nDRAFT PLAN (from algorithmic solver — review, refine, or accept):
${JSON.stringify({ reasoning: solverReasoning, actions: solverActions }, null, 2)}

The draft plan was generated algorithmically. It addresses capacity deficits and color boundary swaps where possible, but may miss:
- Strategic zone restructuring (e.g., reorganizing by style instead of geography)
- Nuanced merge candidates that improve the collection's thematic organization
- Better prioritization of actions
- Color boundary violations the solver couldn't resolve with simple swaps

Check colorAdjacencyIssues in the state data — if any violations remain unaddressed by the draft, add actions to fix them.
You may accept all draft actions, modify some, add new ones, or remove counterproductive ones.`
    : '\n\nNo draft plan available — generate a plan from scratch.';

  const user = `Review and refine the reconfiguration plan within the ${TOTAL_CELLAR_ROWS}-row limit.

STATE JSON:
${JSON.stringify(statePayload, null, 2)}
${draftSection}

Return JSON: { "reasoning": string, "actions": [{ "type": "reallocate_row"|"merge_zones"|"retire_zone", "priority": 1-5, "reason": string, ...fields }] }

Action field requirements:
- reallocate_row: fromZoneId (string), toZoneId (string), rowNumber (number from fromZone's actualAssignedRows), bottlesAffected
- merge_zones: sourceZones (string[]), targetZoneId (string), bottlesAffected
- retire_zone: zoneId (string), mergeIntoZoneId (string), bottlesAffected
Zone IDs are lowercase with underscores (e.g. "chenin_blanc", NOT numbers).
Stability bias: "${stability}". neverMerge: ${JSON.stringify(Array.from(neverMerge))}`;

  const modelId = getModelForTask('zoneReconfigurationPlan');
  const llmStart = Date.now();

  const response = await anthropic.messages.create({
    model: modelId,
    max_tokens: 8000,
    system,
    messages: [{ role: 'user', content: user }],
    ...(getThinkingConfig('zoneReconfigurationPlan') || {})
  });

  const llmMs = Date.now() - llmStart;
  logger.info('Reconfig', `LLM refinement completed in ${llmMs}ms`);

  const text = extractText(response);
  const json = parseJsonObject(text);
  if (!json) throw new Error('Invalid AI response (not JSON)');
  const plan = validatePlanShape(json);

  // Validate/filter LLM actions the same way as before
  plan.actions = filterLLMActions(plan.actions, zoneRowMap, neverMerge);

  return { actions: plan.actions, reasoning: plan.reasoning };
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
    cellarId,
    focusZoneId = null
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
  // ITERATIVE 3-LAYER PIPELINE
  //
  // Each layer builds on the previous layer's output:
  //   Layer 1 — Solver:    Fast deterministic baseline  (<10ms)
  //   Layer 2 — LLM:       Refines solver draft with strategic insight (~5-15s)
  //   Layer 3 — Heuristic: Fills gaps that neither layer caught  (<1ms)
  //
  // The layers are additive: the LLM receives the solver's draft and
  // can accept, modify, or add actions. The heuristic patches any
  // remaining deficit issues that the first two layers missed.
  // ═══════════════════════════════════════════════════════════════

  // Shared row map for validation across all layers
  const zoneRowMap = new Map();
  for (const z of zonesWithAllocations) {
    zoneRowMap.set(z.id, [...(z.actualAssignedRows || [])]);
  }

  // ─── Layer 1: Deterministic solver ───────────────────────────
  let solverActions = [];
  let solverReasoning = '';
  // Declare outside try block so Layer 2 (LLM) can also use it
  let layoutSettings = { colourOrder: 'whites-top' };
  try {
    const solverStart = Date.now();
    layoutSettings = await getCellarLayoutSettings(cellarId);
    const solverResult = solveRowAllocation({
      zones: zonesWithAllocations,
      utilization,
      overflowingZones,
      underutilizedZones,
      mergeCandidates,
      neverMerge,
      stabilityBias: stability,
      scatteredWines: report.scatteredWines || [],
      colorAdjacencyIssues: report.colorAdjacencyIssues || [],
      colourOrder: layoutSettings.colourOrder
    });
    const solverMs = Date.now() - solverStart;
    logger.info('Reconfig', `Solver completed in ${solverMs}ms with ${solverResult.actions.length} action(s)`);
    solverActions = solverResult.actions;
    solverReasoning = solverResult.reasoning;
  } catch (solverErr) {
    logger.error('Reconfig', `Solver failed: ${solverErr.message}`);
  }

  // ─── Layer 2: LLM refinement (builds on solver draft) ───────
  let llmActions = null;  // null = LLM skipped or failed
  let llmReasoning = '';
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
        colourOrder: layoutSettings.colourOrder
      });
      llmActions = llmResult.actions;
      llmReasoning = llmResult.reasoning;
    } catch (llmErr) {
      logger.warn('Reconfig', `LLM refinement failed: ${llmErr.message} — using solver output`);
    }
  }

  // ─── Layer 3: Heuristic gap-fill ────────────────────────────
  // Start from the best plan so far (LLM if available, else solver)
  const baseActions = llmActions ?? [...solverActions];
  const baseReasoning = llmActions ? llmReasoning : solverReasoning;
  const baseSource = llmActions ? 'solver+llm' : (solverActions.length > 0 ? 'solver' : 'heuristic');

  const patchedActions = heuristicGapFill(
    baseActions, capacityIssues, underutilizedZones,
    mergeCandidates, neverMerge, zonesWithAllocations, stability
  );

  const planResult = {
    source: patchedActions.length > baseActions.length ? `${baseSource}+heuristic` : baseSource,
    reasoning: baseReasoning || 'No reconfiguration actions needed — the cellar layout is well-balanced within current constraints.',
    actions: patchedActions
  };

  const initialSummary = computeSummary(report, planResult.actions);
  const planWithSummary = { ...planResult, summary: initialSummary };

  const reviewContext = {
    zones: zonesWithAllocations,
    physicalConstraints: {
      totalRows: TOTAL_CELLAR_ROWS,
      slotsPerRow: SLOTS_PER_ROW,
      totalCapacity: TOTAL_CELLAR_ROWS * SLOTS_PER_ROW
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

  // If scoped to a single zone, filter actions to only those involving that zone
  if (focusZoneId) {
    finalPlan.actions = (finalPlan.actions || []).filter(a => actionInvolvesZone(a, focusZoneId));
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
    }
  };
}
