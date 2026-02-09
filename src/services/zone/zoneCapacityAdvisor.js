/**
 * @fileoverview Proactive AI advice for zone capacity issues.
 * @module services/zone/zoneCapacityAdvisor
 */

import Anthropic from '@anthropic-ai/sdk';
import { getModelForTask, getMaxTokens } from '../../config/aiModels.js';
import { getZoneById } from '../../config/cellarZones.js';
import { reviewZoneCapacityAdvice, isZoneCapacityReviewEnabled } from '../ai/openaiReviewer.js';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  timeout: 120000
});

/**
 * Get zone capacity advice from Claude.
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

  const modelId = getModelForTask('zoneCapacityAdvice');
  const maxTokens = Math.min(getMaxTokens(modelId), 1200);

  try {
    const message = await anthropic.messages.create({
      model: modelId,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const responseText = message.content?.[0]?.text || '';
    const parsed = parseJsonObject(responseText);
    const validated = validateAdvice(parsed);

    if (!validated.success) {
      return { success: false, error: validated.error };
    }

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
        console.info(`[ZoneCapacityAdvisor] GPT-5.2 review: ${reviewResult.verdict} (${reviewResult.latencyMs}ms)`);
        return {
          success: true,
          advice: validated.advice,
          review: {
            verdict: reviewResult.verdict,
            issues: reviewResult.issues,
            reasoning: reviewResult.reasoning,
            confidence: reviewResult.confidence,
            latencyMs: reviewResult.latencyMs
          }
        };
      }
    }

    return { success: true, advice: validated.advice };
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

function validateAdvice(advice) {
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

  const actions = Array.isArray(advice.actions) ? advice.actions : [];
  const normalizedActions = [];

  for (const action of actions) {
    if (!action || typeof action !== 'object') continue;

    if (action.type === 'allocate_row') {
      if (typeof action.row !== 'string' || !/^R\d+$/.test(action.row)) continue;
      if (typeof action.toZone !== 'string' || action.toZone.trim() === '') continue;
      normalizedActions.push({ type: 'allocate_row', row: action.row, toZone: action.toZone });
      continue;
    }

    if (action.type === 'merge_zones') {
      if (typeof action.sourceZone !== 'string' || action.sourceZone.trim() === '') continue;
      if (typeof action.targetZone !== 'string' || action.targetZone.trim() === '') continue;
      normalizedActions.push({ type: 'merge_zones', sourceZone: action.sourceZone, targetZone: action.targetZone });
      continue;
    }

    if (action.type === 'move_wine') {
      if (typeof action.wineId !== 'number') continue;
      if (typeof action.fromZone !== 'string' || action.fromZone.trim() === '') continue;
      if (typeof action.toZone !== 'string' || action.toZone.trim() === '') continue;
      normalizedActions.push({
        type: 'move_wine',
        wineId: action.wineId,
        fromZone: action.fromZone,
        toZone: action.toZone,
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
      actions: normalizedActions
    }
  };
}
