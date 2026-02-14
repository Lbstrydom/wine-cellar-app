/**
 * @fileoverview Proactive AI advice for zone capacity issues.
 * @module services/zone/zoneCapacityAdvisor
 */

import anthropic from '../ai/claudeClient.js';
import { getModelForTask, getThinkingConfig } from '../../config/aiModels.js';
import { extractText } from '../ai/claudeResponseUtils.js';
import { getZoneById, CELLAR_ZONES } from '../../config/cellarZones.js';
import { reviewZoneCapacityAdvice, isZoneCapacityReviewEnabled } from '../ai/openaiReviewer.js';
import logger from '../../utils/logger.js';

/**
 * Compute complexity score for zone capacity scenario.
 * Simple overflows (few wines, clear adjacency, available rows) use Sonnet.
 * Complex overflows (many wines, multiple adjacent zones, no free rows) escalate to Opus.
 * @param {Object} params
 * @param {number} params.wineCount - Number of wines needing placement
 * @param {number} params.adjacentZoneCount - Number of adjacent zones
 * @param {number} params.availableRowCount - Number of unallocated rows
 * @param {number} params.totalAllocatedZones - Number of zones with allocations
 * @param {boolean} params.hasOverflowZone - Whether zone has a configured overflow target
 * @returns {{ score: number, factors: Object, useOpus: boolean }}
 */
export function computeCapacityComplexity({
  wineCount = 0,
  adjacentZoneCount = 0,
  availableRowCount = 0,
  totalAllocatedZones = 0,
  hasOverflowZone = false
}) {
  let score = 0;
  const factors = {};

  // Many wines needing placement → more complex recommendation
  if (wineCount > 5) {
    score += 0.25;
    factors.manyWines = wineCount;
  }

  // Multiple adjacent zones to consider → more trade-offs
  if (adjacentZoneCount > 3) {
    score += 0.25;
    factors.manyAdjacentZones = adjacentZoneCount;
  }

  // No free rows → must merge or reorganize (harder decision)
  if (availableRowCount === 0) {
    score += 0.3;
    factors.noFreeRows = true;
  }

  // Many active zones → crowded cellar, cascading effects
  if (totalAllocatedZones > 8) {
    score += 0.2;
    factors.crowdedCellar = totalAllocatedZones;
  }

  score = Math.min(score, 1.0);
  const useOpus = score >= 0.5;

  return { score, factors, useOpus };
}

/**
 * Get zone capacity advice from Claude.
 * Uses complexity-based model routing: Sonnet for simple overflows, Opus for complex ones.
 * @param {Object} input
 * @param {string} input.overflowingZoneId
 * @param {Array<{wineId:number, wineName:string, currentSlot:string}>} input.winesNeedingPlacement
 * @param {Object<string, string[]>} input.currentZoneAllocation
 * @param {string[]} input.availableRows
 * @param {string[]} input.adjacentZones
 * @returns {Promise<{success: boolean, advice?: Object, error?: string}>}
 */
export async function getZoneCapacityAdvice(input) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { success: false, error: 'Claude API not configured (ANTHROPIC_API_KEY missing)' };
  }

  const overflowingZoneId = input?.overflowingZoneId;
  if (!overflowingZoneId) {
    return { success: false, error: 'overflowingZoneId is required' };
  }

  const zone = getZoneById(overflowingZoneId);
  const winesNeedingPlacement = Array.isArray(input?.winesNeedingPlacement) ? input.winesNeedingPlacement : [];
  const currentZoneAllocation = input?.currentZoneAllocation && typeof input.currentZoneAllocation === 'object'
    ? input.currentZoneAllocation
    : {};
  const availableRows = Array.isArray(input?.availableRows) ? input.availableRows : [];
  const adjacentZones = Array.isArray(input?.adjacentZones) ? input.adjacentZones : [];

  const systemPrompt = `You are a sommelier managing a wine cellar.
You must respond with JSON only (no markdown, no commentary), matching this schema:
{
  "recommendation": "expand" | "merge" | "reorganize",
  "reasoning": "string",
  "actions": [
    { "type": "allocate_row", "row": "R12", "toZone": "appassimento" }
    | { "type": "merge_zones", "sourceZone": "appassimento", "targetZone": "piedmont" }
    | { "type": "move_wine", "wineId": 123, "fromZone": "appassimento", "toZone": "red_buffer", "reason": "string" }
  ]
}`;

  const userPayload = {
    zone: {
      id: overflowingZoneId,
      name: zone?.displayName || overflowingZoneId,
      colour: zone?.color || null,
      overflowZoneId: zone?.overflowZoneId || null
    },
    winesNeedingPlacement,
    currentZoneAllocation,
    availableRows,
    adjacentZones
  };

  const userPrompt = `The zone "${userPayload.zone.name}" is at capacity.

Context (JSON):\n${JSON.stringify(userPayload, null, 2)}\n
Consider:
- Wine style compatibility (e.g., winemaking method, grape, region)
- Physical adjacency (adjacent rows/zones preferred)
- Keep recommendations minimal and practical

Return only valid JSON.`;

  // Compute complexity to determine model routing
  const complexity = computeCapacityComplexity({
    wineCount: winesNeedingPlacement.length,
    adjacentZoneCount: adjacentZones.length,
    availableRowCount: availableRows.length,
    totalAllocatedZones: Object.keys(currentZoneAllocation).length,
    hasOverflowZone: !!zone?.overflowZoneId
  });

  const taskKey = complexity.useOpus ? 'zoneCapacityEscalation' : 'zoneCapacityAdvice';
  const modelId = getModelForTask(taskKey);
  const maxTokens = complexity.useOpus ? 16000 : 8192;

  logger.info('ZoneCapacityAdvisor', `Complexity=${complexity.score.toFixed(2)}, model=${modelId}, factors=${JSON.stringify(complexity.factors)}`);

  try {
    const message = await anthropic.messages.create({
      model: modelId,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      ...(getThinkingConfig(taskKey) || {})
    });

    const responseText = extractText(message);
    const parsed = parseJsonObject(responseText);
    const validated = validateAdvice(parsed, availableRows);

    if (!validated.success) {
      return { success: false, error: validated.error };
    }

    const telemetry = {
      complexityScore: complexity.score,
      complexityFactors: complexity.factors,
      model: modelId,
      escalated: complexity.useOpus
    };

    // GPT-5.2 review if enabled
    if (isZoneCapacityReviewEnabled()) {
      const reviewContext = {
        overflowingZoneId,
        availableRows,
        adjacentZones,
        currentZoneAllocation
      };
      const reviewResult = await reviewZoneCapacityAdvice(validated.advice, reviewContext);
      if (reviewResult.reviewed) {
        logger.info('ZoneCapacityAdvisor', `GPT-5.2 review: ${reviewResult.verdict} (${reviewResult.latencyMs}ms)`);
        return {
          success: true,
          advice: validated.advice,
          review: {
            verdict: reviewResult.verdict,
            issues: reviewResult.issues,
            reasoning: reviewResult.reasoning,
            confidence: reviewResult.confidence,
            latencyMs: reviewResult.latencyMs
          },
          _telemetry: telemetry
        };
      }
    }

    return { success: true, advice: validated.advice, _telemetry: telemetry };
  } catch (err) {
    return { success: false, error: err.message || 'Claude request failed' };
  }
}

function parseJsonObject(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return null;

  // Try direct parse first
  try {
    return JSON.parse(trimmed);
  } catch {
    // Try to extract a JSON object substring
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function validateAdvice(advice, availableRows = []) {
  if (!advice || typeof advice !== 'object') {
    return { success: false, error: 'Invalid AI response (not JSON object)' };
  }

  const recommendation = advice.recommendation;
  if (!['expand', 'merge', 'reorganize'].includes(recommendation)) {
    return { success: false, error: 'Invalid AI response (recommendation must be expand|merge|reorganize)' };
  }

  if (typeof advice.reasoning !== 'string' || advice.reasoning.trim().length === 0) {
    return { success: false, error: 'Invalid AI response (reasoning required)' };
  }

  const availableSet = new Set(availableRows);
  const actions = Array.isArray(advice.actions) ? advice.actions : [];
  const normalizedActions = [];
  const warnings = [];

  for (const action of actions) {
    if (!action || typeof action !== 'object') continue;

    if (action.type === 'allocate_row') {
      const row = normalizeRowId(action.row);
      const toZone = normalizeZoneId(action.toZone);
      if (!row || !toZone) continue;

      // Validate row is actually available
      if (availableSet.size === 0) {
        warnings.push(`Cannot allocate ${row} to ${toZone} — all 19 rows are already assigned. Consider merging zones to free rows.`);
        continue; // Drop this action
      }
      if (!availableSet.has(row)) {
        warnings.push(`Row ${row} is already allocated. Skipping.`);
        continue; // Drop this action
      }

      normalizedActions.push({ type: 'allocate_row', row, toZone });
      continue;
    }

    if (action.type === 'merge_zones') {
      const sourceZone = normalizeZoneId(action.sourceZone);
      const targetZone = normalizeZoneId(action.targetZone);
      if (!sourceZone || !targetZone) continue;
      normalizedActions.push({ type: 'merge_zones', sourceZone, targetZone });
      continue;
    }

    if (action.type === 'move_wine') {
      if (typeof action.wineId !== 'number') continue;
      const fromZone = normalizeZoneId(action.fromZone);
      const toZone = normalizeZoneId(action.toZone);
      if (!fromZone || !toZone) continue;
      normalizedActions.push({
        type: 'move_wine',
        wineId: action.wineId,
        fromZone,
        toZone,
        reason: typeof action.reason === 'string' ? action.reason : ''
      });
      continue;
    }
  }

  return {
    success: true,
    advice: {
      recommendation,
      reasoning: advice.reasoning,
      actions: normalizedActions,
      ...(warnings.length > 0 ? { warnings } : {})
    }
  };
}

/**
 * Normalize row id to canonical R{n} format.
 * @param {unknown} value
 * @returns {string|null}
 */
function normalizeRowId(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toUpperCase();
  return /^R\d+$/.test(trimmed) ? trimmed : null;
}

/**
 * Normalize an AI-provided zone identifier to a known zone id.
 * Accepts exact ids, slug-like variants, and display names.
 * @param {unknown} value
 * @returns {string|null}
 */
function normalizeZoneId(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (getZoneById(trimmed)) return trimmed;

  const slug = trimmed.toLowerCase().replace(/[\s-]+/g, '_');
  if (getZoneById(slug)) return slug;

  const byDisplayName = CELLAR_ZONES.zones.find(z => z.displayName.toLowerCase() === trimmed.toLowerCase());
  if (byDisplayName) return byDisplayName.id;

  return null;
}
