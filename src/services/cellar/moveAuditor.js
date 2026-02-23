/**
 * @fileoverview Claude Opus 4.6 move auditor for cellar analysis.
 * Validates and optimises algorithmic move suggestions before they
 * reach the Sonnet 4.6 advice layer, catching logical errors such as
 * circular move chains, missed swap opportunities, capacity violations,
 * and moves that would displace correctly-placed wines.
 *
 * Pattern: graceful degradation — errors return { skipped: true } so the
 * primary analysis flow continues unaudited.
 *
 * @module services/cellar/moveAuditor
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

const CB_SOURCE = 'claude-move-auditor';
const DEFAULT_TIMEOUT_MS = 45_000;
const MIN_TIMEOUT_MS = 5_000;
const MAX_TIMEOUT_MS = 120_000;
const ENV_FLAG = 'CLAUDE_AUDIT_CELLAR_MOVES';
const MAX_MOVES_IN_PROMPT = 120;
const MAX_MISPLACED_IN_PROMPT = 160;

// ───────────────────────────────────────────────────────────
// Feature flag
// ───────────────────────────────────────────────────────────

/**
 * Check whether the move auditor is enabled via environment variable.
 * Disabled by default to avoid extra latency and cost.
 * @returns {boolean}
 */
export function isMoveAuditEnabled() {
  return parseEnvBool(ENV_FLAG);
}

// ───────────────────────────────────────────────────────────
// Prompt builder
// ───────────────────────────────────────────────────────────

/**
 * Build the audit prompt for Opus 4.6.
 * @param {Array} suggestedMoves - Moves from generateMoveSuggestions()
 * @param {Array} misplacedWines - Misplaced wines list from the report
 * @param {Object} summary - Report summary (totalBottles, misplacedBottles, etc.)
 * @param {Array} zoneNarratives - Zone narratives from the report
 * @returns {string} Prompt text
 */
export function buildAuditPrompt(suggestedMoves, misplacedWines, summary, zoneNarratives) {
  const moveList = Array.isArray(suggestedMoves)
    ? suggestedMoves.slice(0, MAX_MOVES_IN_PROMPT)
    : [];
  const misplacedList = Array.isArray(misplacedWines)
    ? misplacedWines.slice(0, MAX_MISPLACED_IN_PROMPT)
    : [];

  const movesJSON = JSON.stringify(moveList.map(m => {
    if (m?.type === 'manual') {
      return {
        type: 'manual',
        wineId: m.wineId,
        wineName: m.wineName,
        currentSlot: m.currentSlot,
        suggestedZone: m.suggestedZone,
        suggestedZoneId: m.suggestedZoneId,
        reason: m.reason,
        confidence: m.confidence,
        priority: m.priority
      };
    }
    return {
      type: 'move',
      wineId: m?.wineId,
      wineName: m?.wineName,
      from: m?.from,
      to: m?.to,
      toZone: m?.toZone,
      toZoneId: m?.toZoneId,
      actualTargetZoneId: m?.actualTargetZoneId,
      reason: m?.reason,
      confidence: m?.confidence,
      isOverflow: Boolean(m?.isOverflow),
      priority: m?.priority,
      isDisplacementSwap: Boolean(m?.isDisplacementSwap)
    };
  }), null, 2);

  const misplacedJSON = JSON.stringify(misplacedList.map(m => ({
    wineId: m.wineId,
    name: m.name,
    currentSlot: m.currentSlot,
    currentZone: m.currentZone,
    suggestedZone: m.suggestedZone,
    confidence: m.confidence,
    reason: m.reason
  })), null, 2);

  const zonesBlock = (zoneNarratives || []).map(z =>
    `- ${z.displayName || z.zoneName || z.zoneId} [${z.zoneId}]: ${z.rows?.join(', ') || 'no rows'} (${z.health?.bottleCount ?? z.bottleCount ?? '?'} bottles, ${z.health?.status ?? 'unknown'})`
  ).join('\n');

  return `You are a wine cellar logistics auditor. An algorithm has generated a set of
move suggestions to reorganise wines in a cellar. Your job is to audit these moves
for quality and correctness.

## Cellar Summary
- Total bottles: ${summary?.totalBottles ?? '?'}
- Misplaced bottles: ${summary?.misplacedBottles ?? '?'}
- Zones in use: ${summary?.zonesUsed ?? '?'}

## Zone Layout
${zonesBlock || 'No zone narratives available.'}

## Misplaced Wines (Input to Algorithm)
${misplacedJSON}

## Suggested Moves (Algorithm Output)
${movesJSON}

## Prompt Notes
- Suggested moves included: ${moveList.length}/${Array.isArray(suggestedMoves) ? suggestedMoves.length : 0}
- Misplaced wines included: ${misplacedList.length}/${Array.isArray(misplacedWines) ? misplacedWines.length : 0}

## Audit Checks
Evaluate the move list for:
1. **Circular chains** — A→B, B→C, C→A where a simpler swap would suffice
2. **Missed swap opportunities** — Two wines that should swap directly but were given sequential moves requiring a temp slot
3. **Capacity violations** — Moves targeting a zone that is already at capacity
4. **Displacing correct wines** — A move that puts wine X in a slot occupied by wine Y, where Y was correctly placed
5. **Ordering issues** — Swaps where instruction order matters (both legs must execute atomically)
6. **Orphaned moves** — Moves whose "from" slot doesn't match any misplaced wine
7. **Duplicate targets** — Two moves targeting the same destination slot
8. **Unresolved misplacements** — Misplaced wines that received no move suggestion at all
9. **Zone/row mismatch** — A move's "to" slot (e.g. R5C3) is in a row not allocated to the declared toZone. Cross-reference the Zone Layout above: if toZone says "Stellenbosch Cabernet" but the target row belongs to a different zone, flag it
10. **Colour policy violation** — A move targets a row whose zone has an incompatible colour (e.g. a red wine moving to a white-only zone's row)

## Output Format
Return a JSON object (wrapped in \`\`\`json code fence) with exactly this structure:
{
  "verdict": "approve" | "optimize" | "flag",
  "issues": [
    {
      "type": "circular_chain" | "missed_swap" | "capacity_violation" | "displacing_correct" | "ordering_issue" | "orphaned_move" | "duplicate_target" | "unresolved" | "zone_row_mismatch" | "colour_policy_violation",
      "severity": "error" | "warning" | "info",
      "description": "Human-readable explanation",
      "affectedMoveIndices": [0, 1]
    }
  ],
  "optimizedMoves": null | [/* same shape as input moves, reordered/modified */],
  "reasoning": "Brief explanation of audit findings",
  "confidence": "high" | "medium" | "low"
}

Rules:
- "approve" = no issues found, moves are sound
- "optimize" = issues found and you provide an improved move list in optimizedMoves
- "flag" = serious issues found that need human review (don't provide optimizedMoves)
- If verdict is "approve", set optimizedMoves to null
- If verdict is "optimize", optimizedMoves must be a complete replacement list (not patches)
- Keep optimizedMoves in the EXACT same shape as the input moves array
- Do NOT reclassify wines or change which zone they should go to — only fix logistics
- Do NOT invent new moves for wines that weren't flagged as misplaced`;
}

// ───────────────────────────────────────────────────────────
// Validation
// ───────────────────────────────────────────────────────────

/**
 * Validate the audit response schema.
 * @param {Object} parsed - Parsed JSON from Opus response
 * @returns {Object} Validated result
 */
function validateAuditSchema(parsed) {
  // Domain-specific issue types for move auditing
  const VALID_ISSUE_TYPES = new Set([
    'circular_chain', 'missed_swap', 'capacity_violation',
    'displacing_correct', 'ordering_issue', 'orphaned_move',
    'duplicate_target', 'unresolved', 'zone_row_mismatch',
    'colour_policy_violation'
  ]);

  // Verdict is hard-rejected: a wrong verdict means the LLM misunderstood the task.
  // Confidence is soft-fixed to 'medium': a missing/invalid confidence is cosmetic,
  // not structural — safe to default rather than discard the entire audit.
  if (!VALID_VERDICTS.has(parsed.verdict)) {
    throw new Error(`Invalid verdict: ${parsed.verdict}`);
  }
  if (!VALID_CONFIDENCES.has(parsed.confidence)) {
    parsed.confidence = 'medium';
  }

  // Validate issues array
  const issues = Array.isArray(parsed.issues) ? parsed.issues : [];
  for (const issue of issues) {
    if (!VALID_ISSUE_TYPES.has(issue.type)) {
      // Fallback to 'ordering_issue' — the safest move-domain default
      // (ordering warnings are non-destructive and always relevant)
      issue.type = 'ordering_issue';
    }
    if (!VALID_SEVERITIES.has(issue.severity)) {
      issue.severity = 'warning';
    }
  }

  // Validate optimizedMoves
  if (parsed.verdict === 'optimize' && !Array.isArray(parsed.optimizedMoves)) {
    // Downgrade to flag if no optimized moves provided
    parsed.verdict = 'flag';
  }
  if (parsed.verdict !== 'optimize') {
    parsed.optimizedMoves = null;
  }

  return {
    verdict: parsed.verdict,
    issues,
    optimizedMoves: parsed.optimizedMoves,
    reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : '',
    confidence: parsed.confidence
  };
}

/**
 * Validate optimized moves preserve wine identity (no fabricated moves).
 * @param {Array} optimizedMoves - Moves from the auditor
 * @param {Array} originalMoves - Original algorithmic moves
 * @returns {boolean} True if valid
 */
function validateMoveIntegrity(optimizedMoves, originalMoves) {
  if (!Array.isArray(originalMoves) || originalMoves.length === 0) return false;
  if (!Array.isArray(optimizedMoves) || optimizedMoves.length !== originalMoves.length) return false;

  const originalByWineId = new Map();
  for (const original of originalMoves) {
    if (!original?.wineId || originalByWineId.has(original.wineId)) return false;
    originalByWineId.set(original.wineId, original);
  }

  const usedWineIds = new Set();
  const moveTargets = new Set();

  for (const optimized of optimizedMoves) {
    const original = originalByWineId.get(optimized?.wineId);
    if (!original) return false;
    if (usedWineIds.has(optimized.wineId)) return false;
    usedWineIds.add(optimized.wineId);

    const optimizedType = optimized?.type || original.type;
    if (optimizedType !== 'move' && optimizedType !== 'manual') return false;

    // Keep the shape stable for downstream UI/renderers.
    if (optimizedType === 'move') {
      const from = typeof optimized?.from === 'string' ? optimized.from.trim() : '';
      const to = typeof optimized?.to === 'string' ? optimized.to.trim() : '';
      if (!from || !to) return false;
      if (moveTargets.has(to)) return false;
      moveTargets.add(to);
      continue;
    }

    const currentSlot = typeof optimized?.currentSlot === 'string'
      ? optimized.currentSlot.trim()
      : (typeof original.currentSlot === 'string' ? original.currentSlot.trim() : '');
    const suggestedZone = typeof optimized?.suggestedZone === 'string'
      ? optimized.suggestedZone.trim()
      : (typeof original.suggestedZone === 'string' ? original.suggestedZone.trim() : '');

    if (!currentSlot || !suggestedZone) return false;
  }

  return usedWineIds.size === originalMoves.length;
}

function normalizeOptimizedMoves(optimizedMoves, originalMoves) {
  const originalByWineId = new Map(originalMoves.map(m => [m.wineId, m]));
  const normalized = optimizedMoves.map(optimized => {
    const original = originalByWineId.get(optimized?.wineId);
    if (!original) return null;

    const resolvedType = optimized?.type || original.type;
    if (resolvedType === 'manual') {
      return {
        type: 'manual',
        wineId: original.wineId,
        wineName: original.wineName,
        currentSlot: typeof optimized?.currentSlot === 'string' ? optimized.currentSlot : original.currentSlot,
        suggestedZone: typeof optimized?.suggestedZone === 'string' ? optimized.suggestedZone : original.suggestedZone,
        suggestedZoneId: optimized?.suggestedZoneId || original.suggestedZoneId,
        reason: typeof optimized?.reason === 'string' ? optimized.reason : original.reason,
        zoneFullReason: original.zoneFullReason,
        confidence: optimized?.confidence || original.confidence,
        priority: Number.isFinite(optimized?.priority) ? optimized.priority : original.priority
      };
    }

    return {
      type: 'move',
      wineId: original.wineId,
      wineName: original.wineName,
      from: typeof optimized?.from === 'string' ? optimized.from : original.from,
      to: typeof optimized?.to === 'string' ? optimized.to : original.to,
      toZone: optimized?.toZone || original.toZone,
      toZoneId: optimized?.toZoneId || original.toZoneId,
      actualTargetZoneId: optimized?.actualTargetZoneId || original.actualTargetZoneId,
      reason: typeof optimized?.reason === 'string' ? optimized.reason : original.reason,
      confidence: optimized?.confidence || original.confidence,
      isOverflow: typeof optimized?.isOverflow === 'boolean' ? optimized.isOverflow : Boolean(original.isOverflow),
      isDisplacementSwap: typeof optimized?.isDisplacementSwap === 'boolean'
        ? optimized.isDisplacementSwap
        : Boolean(original.isDisplacementSwap),
      priority: Number.isFinite(optimized?.priority) ? optimized.priority : original.priority
    };
  });

  if (normalized.some(m => !m)) return null;
  return normalized;
}

// parseTimeoutMs is now imported from shared/auditUtils.js

// ───────────────────────────────────────────────────────────
// Main audit function
// ───────────────────────────────────────────────────────────

/**
 * Audit move suggestions using Claude Opus 4.6.
 *
 * @param {Array} suggestedMoves - Moves from generateMoveSuggestions()
 * @param {Array} misplacedWines - Misplaced wines list from the report
 * @param {Object} reportSummary - Report summary object
 * @param {Array} [zoneNarratives] - Zone narratives from the report
 * @returns {Promise<Object>} Audit result: { audited, verdict, issues, optimizedMoves, reasoning, confidence, latencyMs } or { skipped, reason }
 */
export async function auditMoveSuggestions(suggestedMoves, misplacedWines, reportSummary, zoneNarratives) {
  const start = Date.now();

  // Feature flag check
  if (!isMoveAuditEnabled()) {
    return { skipped: true, reason: 'Move audit disabled (set CLAUDE_AUDIT_CELLAR_MOVES=true to enable)' };
  }

  // No moves to audit
  if (!Array.isArray(suggestedMoves) || suggestedMoves.length === 0) {
    return { skipped: true, reason: 'No moves to audit' };
  }

  // API client check
  if (!anthropic) {
    return { skipped: true, reason: 'Claude API key not configured' };
  }

  // Circuit breaker check
  if (isCircuitOpen(CB_SOURCE)) {
    return { skipped: true, reason: 'Circuit breaker open for move auditor' };
  }

  try {
    const modelId = getModelForTask('moveAudit');
    const thinkingCfg = getThinkingConfig('moveAudit');

    const prompt = buildAuditPrompt(suggestedMoves, misplacedWines, reportSummary, zoneNarratives);

    const timeoutMs = parseTimeoutMs(process.env.CLAUDE_AUDIT_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS);
    const { controller, cleanup } = createTimeoutAbort(timeoutMs);

    let response;
    try {
      response = await anthropic.messages.create({
        model: modelId,
        max_tokens: 16000,
        messages: [{ role: 'user', content: prompt }],
        ...(thinkingCfg || {})
      }, { signal: controller.signal });
    } catch (err) {
      if (err?.name === 'AbortError') {
        throw new Error(`Move audit timed out after ${timeoutMs}ms`);
      }
      throw err;
    } finally {
      cleanup();
    }

    const text = extractText(response);
    const parsed = extractJsonFromText(text);
    const validated = validateAuditSchema(parsed);

    // Extra integrity check for optimized moves
    if (validated.verdict === 'optimize' && validated.optimizedMoves) {
      if (!validateMoveIntegrity(validated.optimizedMoves, suggestedMoves)) {
        logger.warn('MoveAuditor', 'Optimized moves failed integrity check, downgrading to flag');
        validated.verdict = 'flag';
        validated.optimizedMoves = null;
        validated.issues.push({
          type: 'ordering_issue',
          severity: 'warning',
          description: 'Auditor-proposed moves failed integrity validation — using original moves',
          affectedMoveIndices: []
        });
      } else {
        validated.optimizedMoves = normalizeOptimizedMoves(validated.optimizedMoves, suggestedMoves);
        if (!validated.optimizedMoves) {
          logger.warn('MoveAuditor', 'Optimized moves failed normalization, downgrading to flag');
          validated.verdict = 'flag';
          validated.optimizedMoves = null;
        }
      }
    }

    recordSuccess(CB_SOURCE);
    const latencyMs = Date.now() - start;

    logger.info('MoveAuditor', `Audit complete: ${validated.verdict} (${validated.issues.length} issues, ${latencyMs}ms)`);

    return {
      audited: true,
      verdict: validated.verdict,
      issues: validated.issues,
      optimizedMoves: validated.optimizedMoves,
      reasoning: validated.reasoning,
      confidence: validated.confidence,
      latencyMs
    };

  } catch (err) {
    recordFailure(CB_SOURCE, err);
    const latencyMs = Date.now() - start;
    logger.warn('MoveAuditor', `Audit failed (${latencyMs}ms): ${err.message}`);

    return {
      skipped: true,
      reason: `Audit error: ${err.message}`,
      latencyMs
    };
  }
}
