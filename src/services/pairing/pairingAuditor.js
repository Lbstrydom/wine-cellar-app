/**
 * @fileoverview Claude Opus pairing auditor for restaurant pairing recommendations.
 * Validates and optionally optimizes AI-generated pairings before returning them.
 * @module services/pairing/pairingAuditor
 */

import anthropic from '../ai/claudeClient.js';
import { getModelForTask, getThinkingConfig } from '../../config/aiModels.js';
import { extractText } from '../ai/claudeResponseUtils.js';
import { isCircuitOpen, recordSuccess, recordFailure } from '../shared/circuitBreaker.js';
import { createTimeoutAbort } from '../shared/fetchUtils.js';
import {
  parseEnvBool, parseTimeoutMs, extractJsonFromText,
  VALID_VERDICTS, VALID_CONFIDENCES, VALID_SEVERITIES
} from '../shared/auditUtils.js';
import logger from '../../utils/logger.js';

const CB_SOURCE = 'claude-pairing-auditor';
const ENV_FLAG = 'CLAUDE_AUDIT_RESTAURANT_PAIRINGS';
const DEFAULT_TIMEOUT_MS = 30_000;
const MIN_TIMEOUT_MS = 5_000;
const MAX_TIMEOUT_MS = 90_000;
const MAX_WINES_IN_PROMPT = 60;
const MAX_DISHES_IN_PROMPT = 25;
const MAX_PAIRINGS_IN_PROMPT = 25;

export function isPairingAuditEnabled() {
  return parseEnvBool(ENV_FLAG);
}

// parseTimeoutMs is now imported from shared/auditUtils.js

function buildPairingAuditPrompt(recommendation, context) {
  const wines = Array.isArray(context?.wines) ? context.wines.slice(0, MAX_WINES_IN_PROMPT) : [];
  const dishes = Array.isArray(context?.dishes) ? context.dishes.slice(0, MAX_DISHES_IN_PROMPT) : [];
  const pairings = Array.isArray(recommendation?.pairings)
    ? recommendation.pairings.slice(0, MAX_PAIRINGS_IN_PROMPT)
    : [];

  return `You are a wine-pairing quality auditor.

You are reviewing AI-generated restaurant pairing recommendations and must detect logic or data-quality errors.

## Input Data
- Wines (${wines.length}): ${JSON.stringify(wines, null, 2)}
- Dishes (${dishes.length}): ${JSON.stringify(dishes, null, 2)}
- Constraints: ${JSON.stringify(context?.constraints || {}, null, 2)}
- Recommendation: ${JSON.stringify({
    table_summary: recommendation?.table_summary || '',
    pairings,
    table_wine: recommendation?.table_wine || null
  }, null, 2)}

## Audit Checks
1. Each pairing uses a valid wine_id from the provided wine list
2. Each pairing references a dish from the provided dish list
3. One pairing per dish (no duplicate dish coverage)
4. Constraint alignment (budget, colour preference, by-the-glass preference)
5. table_wine consistency with available wines
6. No malformed pairing fields (missing rank/dish_name/wine_id/why)

## Output Format
Return ONLY JSON (optionally inside a \`\`\`json fence) with this exact shape:
{
  "verdict": "approve" | "optimize" | "flag",
  "issues": [
    {
      "type": "invalid_wine" | "invalid_dish" | "duplicate_dish" | "constraint_violation" | "table_wine_issue" | "shape_issue",
      "severity": "error" | "warning" | "info",
      "description": "string",
      "affectedPairingIndices": [0]
    }
  ],
  "optimizedRecommendation": null | {
    "table_summary": "string",
    "pairings": [
      {
        "rank": 1,
        "dish_name": "string",
        "wine_id": 1,
        "wine_name": "string",
        "wine_colour": "string",
        "wine_price": 0,
        "currency": "string|null",
        "by_the_glass": false,
        "why": "string",
        "serving_tip": "string",
        "confidence": "high|medium|low"
      }
    ],
    "table_wine": null | {
      "wine_name": "string",
      "wine_price": 0,
      "currency": "string|null",
      "why": "string"
    }
  },
  "reasoning": "string",
  "confidence": "high" | "medium" | "low"
}

Rules:
- approve: no meaningful issues found, optimizedRecommendation must be null
- optimize: provide a full replacement recommendation in optimizedRecommendation
- flag: serious issues; do not provide optimizedRecommendation
- Do NOT invent dishes or wines outside provided lists
- Keep exactly one pairing per dish in the optimized output`;
}

function validateAuditSchema(parsed) {
  // Domain-specific issue types for pairing auditing
  const VALID_ISSUE_TYPES = new Set([
    'invalid_wine',
    'invalid_dish',
    'duplicate_dish',
    'constraint_violation',
    'table_wine_issue',
    'shape_issue'
  ]);

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid pairing audit response');
  }
  // Verdict is hard-rejected: a wrong verdict means the LLM misunderstood the task.
  // Confidence is soft-fixed to 'medium': cosmetic, not structural.
  if (!VALID_VERDICTS.has(parsed.verdict)) {
    throw new Error(`Invalid pairing audit verdict: ${parsed.verdict}`);
  }

  const issues = Array.isArray(parsed.issues) ? parsed.issues.map(issue => ({
    // Fallback to 'shape_issue' — the safest pairing-domain default
    // (shape issues are non-destructive and always applicable to pairings)
    type: VALID_ISSUE_TYPES.has(issue?.type) ? issue.type : 'shape_issue',
    severity: VALID_SEVERITIES.has(issue?.severity) ? issue.severity : 'warning',
    description: typeof issue?.description === 'string' ? issue.description : 'Unspecified issue',
    affectedPairingIndices: Array.isArray(issue?.affectedPairingIndices)
      ? issue.affectedPairingIndices.filter(i => Number.isInteger(i) && i >= 0)
      : []
  })) : [];

  let optimizedRecommendation = parsed.optimizedRecommendation;
  if (parsed.verdict === 'approve') optimizedRecommendation = null;
  if (parsed.verdict === 'flag') optimizedRecommendation = null;

  return {
    verdict: parsed.verdict,
    issues,
    optimizedRecommendation,
    reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : '',
    confidence: VALID_CONFIDENCES.has(parsed.confidence) ? parsed.confidence : 'medium'
  };
}

function normalizeOptimizedRecommendation(optimized, original, context) {
  if (!optimized || typeof optimized !== 'object') return null;
  const originalPairings = Array.isArray(original?.pairings) ? original.pairings : [];
  const optimizedPairings = Array.isArray(optimized?.pairings) ? optimized.pairings : null;
  if (!optimizedPairings || optimizedPairings.length !== originalPairings.length || optimizedPairings.length === 0) {
    return null;
  }

  const wines = Array.isArray(context?.wines) ? context.wines : [];
  const dishes = Array.isArray(context?.dishes) ? context.dishes : [];
  const wineById = new Map(wines.map(w => [w.id, w]));
  const dishByName = new Map(dishes.map(d => [String(d.name || '').trim().toLowerCase(), d]));
  const seenDishNames = new Set();

  const constraints = context?.constraints || {};
  const hasGlassOptions = wines.some(w => w.by_the_glass);

  const normalizedPairings = optimizedPairings.map((pairing, index) => {
    const wineId = Number(pairing?.wine_id);
    const wine = wineById.get(wineId);
    if (!wine) return null;

    const dishKey = String(pairing?.dish_name || '').trim().toLowerCase();
    const dish = dishByName.get(dishKey);
    if (!dish || seenDishNames.has(dishKey)) return null;
    seenDishNames.add(dishKey);

    if (constraints.budget_max != null && wine.price != null && wine.price > constraints.budget_max) {
      return null;
    }
    if (Array.isArray(constraints.colour_preferences) &&
        constraints.colour_preferences.length > 0 &&
        wine.colour &&
        !constraints.colour_preferences.includes(wine.colour)) {
      return null;
    }
    // "prefer" by-the-glass is a soft preference, not a hard constraint.
    // Only reject if ALL wines on the list are available by-the-glass,
    // meaning there was a strictly-better option the LLM ignored.
    if (constraints.prefer_by_glass === true && hasGlassOptions && !wine.by_the_glass) {
      const allWinesAvailableByGlass = wines.every(w => w.by_the_glass);
      if (allWinesAvailableByGlass) return null;
    }

    const originalPairing = originalPairings[index] || {};
    return {
      rank: index + 1,
      dish_name: dish.name,
      wine_id: wine.id,
      wine_name: wine.name,
      wine_colour: wine.colour || originalPairing.wine_colour || 'red',
      wine_price: wine.price ?? null,
      currency: wine.currency ?? null,
      by_the_glass: Boolean(wine.by_the_glass),
      why: typeof pairing?.why === 'string' && pairing.why.trim().length > 0
        ? pairing.why
        : (originalPairing.why || 'Recommended pairing'),
      serving_tip: typeof pairing?.serving_tip === 'string' ? pairing.serving_tip : (originalPairing.serving_tip || ''),
      confidence: ['high', 'medium', 'low'].includes(pairing?.confidence)
        ? pairing.confidence
        : (originalPairing.confidence || 'medium')
    };
  });

  if (normalizedPairings.some(p => !p)) return null;

  let tableWine = null;
  if (optimized.table_wine != null) {
    const tableWineName = String(optimized.table_wine?.wine_name || '').trim().toLowerCase();
    // Use case-insensitive substring matching to tolerate LLM paraphrasing
    // (e.g., "Chenin Blanc 2023" vs "chenin blanc"). Exact match first, then includes.
    const matchedWine = wines.find(w => {
      const wName = String(w.name || '').trim().toLowerCase();
      return wName === tableWineName;
    }) || wines.find(w => {
      const wName = String(w.name || '').trim().toLowerCase();
      return wName.includes(tableWineName) || tableWineName.includes(wName);
    });
    if (!matchedWine) return null;
    if (hasGlassOptions && wines.every(w => w.by_the_glass)) return null;
    tableWine = {
      wine_name: matchedWine.name,
      wine_price: matchedWine.price ?? null,
      currency: matchedWine.currency ?? null,
      why: typeof optimized.table_wine?.why === 'string' && optimized.table_wine.why.trim().length > 0
        ? optimized.table_wine.why
        : 'Recommended table wine'
    };
  }

  return {
    table_summary: typeof optimized.table_summary === 'string'
      ? optimized.table_summary
      : (original.table_summary || ''),
    pairings: normalizedPairings,
    table_wine: tableWine
  };
}

export async function auditPairingRecommendations(recommendation, context) {
  const start = Date.now();

  if (!isPairingAuditEnabled()) {
    return { skipped: true, reason: 'Pairing audit disabled (set CLAUDE_AUDIT_RESTAURANT_PAIRINGS=true to enable)' };
  }

  if (!recommendation || !Array.isArray(recommendation.pairings) || recommendation.pairings.length === 0) {
    return { skipped: true, reason: 'No pairings to audit' };
  }

  if (!anthropic) {
    return { skipped: true, reason: 'Claude API key not configured' };
  }

  if (isCircuitOpen(CB_SOURCE)) {
    return { skipped: true, reason: 'Circuit breaker open for pairing auditor' };
  }

  const timeoutMs = parseTimeoutMs(process.env.CLAUDE_AUDIT_RESTAURANT_PAIRINGS_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS);
  const { controller, cleanup } = createTimeoutAbort(timeoutMs);

  try {
    const modelId = getModelForTask('pairingAudit');
    const prompt = buildPairingAuditPrompt(recommendation, context);
    const thinkingCfg = getThinkingConfig('pairingAudit');

    let response;
    try {
      response = await anthropic.messages.create({
        model: modelId,
        max_tokens: 12000,
        messages: [{ role: 'user', content: prompt }],
        ...(thinkingCfg || {})
      }, { signal: controller.signal });
    } catch (err) {
      if (err?.name === 'AbortError') {
        throw new Error(`Pairing audit timed out after ${timeoutMs}ms`);
      }
      throw err;
    }

    const text = extractText(response);
    const parsed = extractJsonFromText(text);
    const validated = validateAuditSchema(parsed);

    if (validated.verdict === 'optimize' && validated.optimizedRecommendation) {
      const normalized = normalizeOptimizedRecommendation(validated.optimizedRecommendation, recommendation, context);
      if (!normalized) {
        validated.verdict = 'flag';
        validated.optimizedRecommendation = null;
        validated.issues.push({
          type: 'shape_issue',
          severity: 'warning',
          description: 'Optimized pairing output failed integrity validation; using original recommendation',
          affectedPairingIndices: []
        });
      } else {
        validated.optimizedRecommendation = normalized;
      }
    }

    recordSuccess(CB_SOURCE);
    const latencyMs = Date.now() - start;
    logger.info('PairingAuditor', `Audit complete: ${validated.verdict} (${validated.issues.length} issues, ${latencyMs}ms)`);

    return {
      audited: true,
      verdict: validated.verdict,
      issues: validated.issues,
      optimizedRecommendation: validated.optimizedRecommendation,
      reasoning: validated.reasoning,
      confidence: validated.confidence,
      latencyMs
    };
  } catch (err) {
    recordFailure(CB_SOURCE, err);
    const latencyMs = Date.now() - start;
    logger.warn('PairingAuditor', `Audit failed (${latencyMs}ms): ${err.message}`);
    return {
      skipped: true,
      reason: `Pairing audit error: ${err.message}`,
      latencyMs
    };
  } finally {
    cleanup();
  }
}

