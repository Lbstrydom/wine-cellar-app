/**
 * @fileoverview LLM signal auditor for cooking profile validation.
 * Reviews the dominant food signals extracted from a recipe collection
 * and flags any that seem misleading for wine buying guidance.
 *
 * Follows the shared auditor pattern (env flag, timeout, graceful degradation).
 * @module services/recipe/signalAuditor
 */

import anthropic from '../ai/claudeClient.js';
import { getModelForTask } from '../../config/aiModels.js';
import { extractText } from '../ai/claudeResponseUtils.js';
import { parseEnvBool, parseTimeoutMs, extractJsonFromText, VALID_VERDICTS, VALID_CONFIDENCES } from '../shared/auditUtils.js';
import { createTimeoutAbort } from '../shared/fetchUtils.js';
import { isCircuitOpen, recordSuccess, recordFailure } from '../shared/circuitBreaker.js';
import logger from '../../utils/logger.js';

const ENV_FLAG = 'CLAUDE_AUDIT_COOKING_PROFILE';
const DEFAULT_TIMEOUT_MS = 15_000;
const MIN_TIMEOUT_MS = 5_000;
const MAX_TIMEOUT_MS = 60_000;
const CB_SOURCE = 'signalAuditor';

/**
 * Check if signal audit is enabled via environment variable.
 * @returns {boolean}
 */
export function isSignalAuditEnabled() {
  return parseEnvBool(ENV_FLAG);
}

/**
 * Audit the dominant food signals from a cooking profile.
 * Returns a verdict on whether the signal list is reliable for wine buying guidance.
 *
 * @param {Object[]} dominantSignals - Array of { signal, weight } sorted by weight desc
 * @param {number} recipeCount - Total recipes in the collection
 * @param {Object} [signalDocFrequency] - Optional: signal -> doc frequency map
 * @returns {Promise<Object>} Audit result: { audited, verdict, issues, ... } or { skipped, reason }
 */
export async function auditSignals(dominantSignals, recipeCount, signalDocFrequency = {}) {
  const start = Date.now();

  if (!isSignalAuditEnabled()) {
    return { skipped: true, reason: 'Signal audit disabled (set CLAUDE_AUDIT_COOKING_PROFILE=true)' };
  }

  if (!Array.isArray(dominantSignals) || dominantSignals.length === 0) {
    return { skipped: true, reason: 'No signals to audit' };
  }

  if (!anthropic) {
    return { skipped: true, reason: 'Claude API key not configured' };
  }

  if (isCircuitOpen(CB_SOURCE)) {
    return { skipped: true, reason: 'Circuit breaker open for signal auditor' };
  }

  try {
    const prompt = buildPrompt(dominantSignals, recipeCount, signalDocFrequency);
    const modelId = getModelForTask('signalAudit');

    const timeoutMs = parseTimeoutMs(
      process.env.CLAUDE_AUDIT_SIGNAL_TIMEOUT_MS,
      DEFAULT_TIMEOUT_MS,
      MIN_TIMEOUT_MS,
      MAX_TIMEOUT_MS
    );
    const { controller, cleanup } = createTimeoutAbort(timeoutMs);

    let response;
    try {
      response = await anthropic.messages.create({
        model: modelId,
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }]
      }, { signal: controller.signal });
    } finally {
      cleanup();
    }

    const text = extractText(response);
    const parsed = extractJsonFromText(text);
    const validated = validateAuditSchema(parsed);

    recordSuccess(CB_SOURCE);
    const latencyMs = Date.now() - start;

    logger.info('SignalAuditor', `Audit completed (${latencyMs}ms): ${validated.verdict}, ${validated.issues.length} issues`);

    return {
      audited: true,
      verdict: validated.verdict,
      issues: validated.issues,
      reasoning: validated.reasoning,
      confidence: validated.confidence,
      suggestedDemotion: validated.suggestedDemotion || [],
      latencyMs
    };

  } catch (err) {
    recordFailure(CB_SOURCE, err);
    const latencyMs = Date.now() - start;
    logger.warn('SignalAuditor', `Audit failed (${latencyMs}ms): ${err.message}`);

    return {
      skipped: true,
      reason: `Audit error: ${err.message}`,
      latencyMs
    };
  }
}

/**
 * Build the LLM prompt for signal validation.
 * @param {Object[]} signals - Dominant signals
 * @param {number} recipeCount - Recipe count
 * @param {Object} docFrequency - Signal -> doc frequency
 * @returns {string} Prompt
 */
function buildPrompt(signals, recipeCount, docFrequency) {
  const signalList = signals.slice(0, 15).map(s => {
    const df = docFrequency[s.signal];
    const pct = df ? ` (appears in ${Math.round(df / recipeCount * 100)}% of recipes)` : '';
    return `  ${s.signal}: weight ${s.weight}${pct}`;
  }).join('\n');

  return `You are a sommelier and food-wine pairing expert. Review these dominant food signals extracted from a recipe collection of ${recipeCount} recipes.

These signals drive wine buying recommendations. Each signal maps to wine style affinities (e.g., "fish" → white_crisp, "beef" → red_full). The TOP signals have the most influence on what wines the user is told to buy.

DOMINANT SIGNALS (ranked by weight):
${signalList}

TASK:
1. Are these signals genuinely useful for wine pairing guidance?
2. Are any signals misleadingly dominant? (e.g., a ubiquitous seasoning drowning out distinctive cooking patterns)
3. Are any important signals suspiciously absent given the overall profile?

OUTPUT FORMAT (JSON only):
{
  "verdict": "approve" | "flag",
  "confidence": "high" | "medium" | "low",
  "reasoning": "Brief explanation (2-3 sentences)",
  "issues": [
    {
      "signal": "signal_name",
      "severity": "warning" | "info",
      "description": "Why this signal is problematic"
    }
  ],
  "suggestedDemotion": ["signal_name"]
}

Rules:
- verdict "approve": signals look reasonable for wine buying guidance
- verdict "flag": one or more signals are misleading or suspicious
- suggestedDemotion: signals that should carry less weight (ubiquitous ingredients, not wine-relevant)
- Keep issues focused on wine pairing relevance, not general food analysis`;
}

/**
 * Validate and normalise the audit response schema.
 * @param {Object} parsed - Parsed JSON from LLM
 * @returns {Object} Validated result
 */
function validateAuditSchema(parsed) {
  if (!VALID_VERDICTS.has(parsed.verdict) || parsed.verdict === 'optimize') {
    // Signal audit only supports approve/flag
    if (parsed.verdict === 'optimize') parsed.verdict = 'flag';
    else throw new Error(`Invalid verdict: ${parsed.verdict}`);
  }

  if (!VALID_CONFIDENCES.has(parsed.confidence)) {
    parsed.confidence = 'medium';
  }

  if (!Array.isArray(parsed.issues)) {
    parsed.issues = [];
  }

  for (const issue of parsed.issues) {
    if (!['error', 'warning', 'info'].includes(issue.severity)) {
      issue.severity = 'info';
    }
  }

  if (!Array.isArray(parsed.suggestedDemotion)) {
    parsed.suggestedDemotion = [];
  }

  if (typeof parsed.reasoning !== 'string') {
    parsed.reasoning = '';
  }

  return parsed;
}
