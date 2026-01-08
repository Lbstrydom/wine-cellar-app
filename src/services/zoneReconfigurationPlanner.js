/**
 * @fileoverview Generates holistic zone reconfiguration plans.
 * Works within physical cellar constraints (fixed row count).
 * @module services/zoneReconfigurationPlanner
 */

import Anthropic from '@anthropic-ai/sdk';
import { getZoneById, CELLAR_ZONES } from '../config/cellarZones.js';
import { getNeverMergeZones } from './zonePins.js';
import { getModelForTask, getMaxTokens } from '../config/aiModels.js';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  timeout: 120000
});

// Physical cellar constraints
const TOTAL_CELLAR_ROWS = 19;
const SLOTS_PER_ROW = 9; // Most rows have 9 slots (row 1 has 7)

function clampStabilityBias(value) {
  if (value === 'low' || value === 'moderate' || value === 'high') return value;
  return 'moderate';
}

/**
 * Build a comprehensive picture of current zone utilization.
 */
function buildZoneUtilization(report) {
  const zoneAnalysis = Array.isArray(report?.zoneAnalysis) ? report.zoneAnalysis : [];
  const utilization = {};

  for (const za of zoneAnalysis) {
    const zoneId = za.zoneId;
    if (!zoneId) continue;

    utilization[zoneId] = {
      zoneId,
      zoneName: za.zoneName || zoneId,
      bottleCount: za.bottleCount || 0,
      rowCount: za.rowCount || 1,
      capacity: (za.rowCount || 1) * SLOTS_PER_ROW,
      utilizationPct: za.rowCount > 0 ? Math.round((za.bottleCount / ((za.rowCount || 1) * SLOTS_PER_ROW)) * 100) : 0,
      isOverflowing: za.isOverflowing || false,
      misplacedCount: za.misplaced?.length || 0,
      correctCount: za.correctlyPlaced?.length || 0
    };
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
 * Build list of all zones with their current allocation for AI context.
 */
function buildZoneList() {
  const zones = CELLAR_ZONES.zones || [];
  return zones.map(z => ({
    id: z.id,
    name: z.displayName || z.name || z.id,
    color: z.color,
    rows: z.rows || z.preferredRowRange || []
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
    stabilityBias = 'moderate'
  } = options;

  const stability = clampStabilityBias(stabilityBias);
  const neverMerge = await getNeverMergeZones();

  const capacityIssues = summarizeCapacityIssues(report);
  const totalBottles = report?.summary?.totalBottles ?? 0;
  const misplacedBottles = report?.summary?.misplacedBottles ?? 0;
  const misplacementPct = totalBottles > 0 ? Math.round((misplacedBottles / totalBottles) * 100) : 0;

  // Build utilization data for smarter planning
  const utilization = buildZoneUtilization(report);
  const allZones = Object.values(utilization);
  const overflowingZones = allZones.filter(z => z.isOverflowing);
  const underutilizedZones = findUnderutilizedZones(utilization, 40);
  const mergeCandidates = findMergeCandidates(overflowingZones, allZones);

  // Attempt Claude first if configured.
  if (process.env.ANTHROPIC_API_KEY) {
    const prompt = {
      physicalConstraints: {
        totalRows: TOTAL_CELLAR_ROWS,
        slotsPerRow: SLOTS_PER_ROW,
        totalCapacity: TOTAL_CELLAR_ROWS * SLOTS_PER_ROW,
        note: 'The cellar has exactly 19 rows. You CANNOT add new rows. You can only reallocate existing rows between zones or merge zones.'
      },
      currentState: {
        totalBottles,
        misplaced: misplacedBottles,
        misplacementPct
      },
      zones: buildZoneList(),
      zoneUtilization: allZones.map(z => ({
        zoneId: z.zoneId,
        zoneName: z.zoneName,
        bottleCount: z.bottleCount,
        rowCount: z.rowCount,
        capacity: z.capacity,
        utilizationPct: z.utilizationPct,
        isOverflowing: z.isOverflowing
      })),
      overflowingZones: capacityIssues.map(i => ({
        zoneId: i.overflowingZoneId,
        zoneName: i.overflowingZoneName,
        affectedCount: i.affectedCount,
        currentRows: i.currentZoneAllocation?.[i.overflowingZoneId] || []
      })),
      underutilizedZones: underutilizedZones.map(z => ({
        zoneId: z.zoneId,
        zoneName: z.zoneName,
        utilizationPct: z.utilizationPct,
        rowCount: z.rowCount,
        bottleCount: z.bottleCount,
        canDonateRows: z.rowCount - 1 // Can donate all but 1 row
      })),
      mergeCandidates: mergeCandidates.slice(0, 5).map(c => ({
        sourceZone: c.sourceZone,
        targetZone: c.targetZone,
        affinity: c.affinity,
        reason: c.reason
      })),
      constraints: {
        neverMergeZones: Array.from(neverMerge),
        includeRetirements,
        stabilityBias: stability,
        flexibleColorAllocation: true // Red/white row split can change for seasonality
      }
    };

    const system = `You are a sommelier reorganizing a wine cellar with FIXED physical constraints.
CRITICAL: The cellar has exactly ${TOTAL_CELLAR_ROWS} rows total. You CANNOT create new rows or expand beyond this limit.
You must work within these constraints by:
1. Reallocating rows from underutilized zones to overflowing zones
2. Merging similar zones to consolidate space
3. Retiring zones and moving bottles to related zones
4. Restructuring zones by criteria (geographic to style-based, or vice versa) for better space utilization

The red/white row allocation can FLEX based on seasonality:
- Summer: more rows for whites, rosés, sparkling
- Winter: more rows for reds, fortified wines
This is a key flexibility lever for accommodating changing collection composition.

You must respond with valid JSON only.`;

    const user = `Generate a holistic zone reconfiguration plan that works WITHIN the ${TOTAL_CELLAR_ROWS}-row physical limit.

STATE JSON:
${JSON.stringify(prompt, null, 2)}

Return JSON with schema:
{
  "reasoning": string,
  "actions": [
    {
      "type": "reallocate_row"|"merge_zones"|"retire_zone",
      "priority": 1|2|3|4|5,
      "reason": string,
      ...type-specific fields
    }
  ]
}

Action types:
1. "reallocate_row": Move a row from one zone to another
   - Required fields: fromZoneId, toZoneId, rowNumber, bottlesAffected
   - IMPORTANT: fromZoneId and toZoneId must be exact zone ID strings like "chenin_blanc", "sauvignon_blanc", "rioja_ribera" - NOT numbers!
   - rowNumber should be a number like 2, 3, 4 etc.
   - Use when a zone is underutilized and another needs space
2. "merge_zones": Combine two similar zones into one
   - Required fields: sourceZones (array of zone ID strings), targetZoneId (string), bottlesAffected
   - Use when zones have high affinity (same style, country, or grape variety)
3. "retire_zone": Close a zone and move all bottles to another
   - Required fields: zoneId (string), mergeIntoZoneId (string), bottlesAffected
   - Use when a zone is nearly empty or redundant

CRITICAL - Zone ID format:
- Zone IDs are lowercase strings with underscores, like: "chenin_blanc", "sauvignon_blanc", "aromatic_whites", "rioja_ribera", "appassimento"
- DO NOT use numbers as zone IDs! "2" is NOT a valid zone ID.
- Check the zones list above for valid zone IDs.

Strategic guidance:
- Consider restructuring zones by criteria (e.g., changing from geographic organization like "Italian Reds" to style-based like "Full-bodied Reds") if it better fits the collection
- Prioritize actions that reduce misplacements while minimizing bottle moves
- Balance immediate space needs with long-term cellar organization

Constraints:
- NEVER propose adding rows beyond the ${TOTAL_CELLAR_ROWS}-row limit
- Only use zone IDs that EXACTLY match the "id" field in the zones list (e.g., "chenin_blanc", NOT "Chenin Blanc" or "2")
- Never merge zones in neverMergeZones: ${JSON.stringify(Array.from(neverMerge))}
- Prefer fewer changes when stabilityBias is "${stability}"
- Consider underutilizedZones as row donors
- Consider mergeCandidates for zones with high affinity
`;

    const modelId = getModelForTask('zoneReconfigurationPlan');
    const maxTokens = Math.min(getMaxTokens(modelId), 2000);

    const response = await anthropic.messages.create({
      model: modelId,
      max_tokens: maxTokens,
      temperature: 0.2,
      system,
      messages: [{ role: 'user', content: user }]
    });

    const text = response?.content?.[0]?.text || '';
    const json = parseJsonObject(text);
    if (!json) throw new Error('Invalid AI response (not JSON)');
    const plan = validatePlanShape(json);

    // Filter out any unknown zones defensively.
    const originalCount = plan.actions.length;
    plan.actions = plan.actions.filter(a => {
      if (a.type === 'reallocate_row') {
        const fromValid = !!getZoneById(a.fromZoneId);
        const toValid = !!getZoneById(a.toZoneId);
        if (!fromValid || !toValid) {
          console.warn(`[ZoneReconfigPlanner] Filtering invalid reallocate_row: fromZoneId="${a.fromZoneId}" (valid=${fromValid}), toZoneId="${a.toZoneId}" (valid=${toValid})`);
        }
        return fromValid && toValid;
      }
      if (a.type === 'expand_zone') {
        // Legacy support - but shouldn't happen with new prompt
        const valid = !!getZoneById(a.zoneId);
        if (!valid) console.warn(`[ZoneReconfigPlanner] Filtering invalid expand_zone: zoneId="${a.zoneId}"`);
        return valid;
      }
      if (a.type === 'merge_zones') {
        if (!Array.isArray(a.sourceZones)) {
          console.warn(`[ZoneReconfigPlanner] Filtering merge_zones: sourceZones is not an array`);
          return false;
        }
        if (!getZoneById(a.targetZoneId)) {
          console.warn(`[ZoneReconfigPlanner] Filtering merge_zones: invalid targetZoneId="${a.targetZoneId}"`);
          return false;
        }
        const invalidSources = a.sourceZones.filter(z => !getZoneById(z));
        if (invalidSources.length > 0) {
          console.warn(`[ZoneReconfigPlanner] Filtering merge_zones: invalid sourceZones=${JSON.stringify(invalidSources)}`);
          return false;
        }
        return a.sourceZones.every(z => !neverMerge.has(z));
      }
      if (a.type === 'retire_zone') {
        if (!getZoneById(a.zoneId)) {
          console.warn(`[ZoneReconfigPlanner] Filtering retire_zone: invalid zoneId="${a.zoneId}"`);
          return false;
        }
        if (!getZoneById(a.mergeIntoZoneId)) {
          console.warn(`[ZoneReconfigPlanner] Filtering retire_zone: invalid mergeIntoZoneId="${a.mergeIntoZoneId}"`);
          return false;
        }
        return !neverMerge.has(a.zoneId);
      }
      console.warn(`[ZoneReconfigPlanner] Filtering unknown action type: ${a.type}`);
      return false;
    });

    if (plan.actions.length < originalCount) {
      console.warn(`[ZoneReconfigPlanner] Filtered ${originalCount - plan.actions.length} invalid actions from AI response`);
    }

    const summary = computeSummary(report, plan.actions);
    return {
      summary,
      reasoning: plan.reasoning,
      actions: plan.actions
    };
  }

  // Heuristic fallback - work within constraints
  const actions = [];
  const rowsReallocated = new Set();

  // Strategy 1: Reallocate rows from underutilized zones to overflowing zones
  for (const issue of capacityIssues) {
    const toZoneId = issue.overflowingZoneId;
    if (!getZoneById(toZoneId)) continue;

    // Find a donor zone that has spare capacity
    for (const donor of underutilizedZones) {
      if (donor.zoneId === toZoneId) continue;
      if (donor.rowCount <= 1) continue; // Must keep at least 1 row
      if (neverMerge.has(donor.zoneId)) continue;

      // Get the zone config to find actual row numbers
      const donorZone = getZoneById(donor.zoneId);
      const donorRows = donorZone?.rows || [];
      const availableRow = donorRows.find(r => !rowsReallocated.has(r));

      if (availableRow) {
        rowsReallocated.add(availableRow);
        actions.push({
          type: 'reallocate_row',
          priority: 2,
          fromZoneId: donor.zoneId,
          toZoneId,
          rowNumber: availableRow,
          reason: `${donor.zoneName} is ${donor.utilizationPct}% full; reallocate row ${availableRow} to ${issue.overflowingZoneName} which needs space for ${issue.affectedCount} bottle(s)`,
          bottlesAffected: issue.affectedCount
        });
        break; // One row per overflowing zone for now
      }
    }
  }

  // Strategy 2: If no underutilized zones, suggest merging similar zones
  if (actions.length === 0 && mergeCandidates.length > 0) {
    const best = mergeCandidates[0];
    if (!neverMerge.has(best.sourceZone) && !neverMerge.has(best.targetZone)) {
      actions.push({
        type: 'merge_zones',
        priority: 3,
        sourceZones: [best.sourceZone],
        targetZoneId: best.targetZone,
        reason: `Merge ${best.sourceZone} into ${best.targetZone}: ${best.reason}`,
        bottlesAffected: best.combinedBottles
      });
    }
  }

  // Keep it stable: if high stability bias, don't propose more than 2 actions.
  const maxActions = stability === 'high' ? 2 : stability === 'moderate' ? 4 : 6;
  const trimmedActions = actions.slice(0, maxActions);

  const summary = computeSummary(report, trimmedActions);

  return {
    summary,
    reasoning: trimmedActions.length > 0
      ? `Generated constraint-aware plan: reallocate rows within the ${TOTAL_CELLAR_ROWS}-row limit.`
      : 'No reconfiguration actions needed or possible within current constraints.',
    actions: trimmedActions
  };
}
