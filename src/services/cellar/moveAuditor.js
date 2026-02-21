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
import logger from '../../utils/logger.js';

const CB_SOURCE = 'claude-move-auditor';
const DEFAULT_TIMEOUT_MS = 45_000;
const ENV_FLAG = 'CLAUDE_AUDIT_CELLAR_MOVES';

// ───────────────────────────────────────────────────────────
// Feature flag
// ───────────────────────────────────────────────────────────

/**
 * Check whether the move auditor is enabled via environment variable.
 * Disabled by default to avoid extra latency and cost.
 * @returns {boolean}
 */
export function isMoveAuditEnabled() {
  const val = process.env[ENV_FLAG];
  return val === 'true' || val === '1';
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
  const movesJSON = JSON.stringify(suggestedMoves.map(m => ({
    type: m.type,
    wineId: m.wineId,
    wineName: m.wineName,
    from: m.from,
    to: m.to,
    toZone: m.toZone,
    reason: m.reason,
    confidence: m.confidence,
    isOverflow: m.isOverflow,
    priority: m.priority,
    isDisplacementSwap: m.isDisplacementSwap || false
  })), null, 2);

  const misplacedJSON = JSON.stringify(misplacedWines.map(m => ({
    wineId: m.wineId,
    name: m.name,
    currentSlot: m.currentSlot,
    currentZone: m.currentZone,
    suggestedZone: m.suggestedZone,
    confidence: m.confidence,
    reason: m.reason
  })), null, 2);

  const zonesBlock = (zoneNarratives || []).map(z =>
    `- ${z.zoneName || z.zoneId}: ${z.rows?.join(', ') || 'no rows'} (${z.bottleCount ?? '?'} bottles)`
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

## Output Format
Return a JSON object (wrapped in \`\`\`json code fence) with exactly this structure:
{
  "verdict": "approve" | "optimize" | "flag",
  "issues": [
    {
      "type": "circular_chain" | "missed_swap" | "capacity_violation" | "displacing_correct" | "ordering_issue" | "orphaned_move" | "duplicate_target" | "unresolved",
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
  const VALID_VERDICTS = new Set(['approve', 'optimize', 'flag']);
  const VALID_ISSUE_TYPES = new Set([
    'circular_chain', 'missed_swap', 'capacity_violation',
    'displacing_correct', 'ordering_issue', 'orphaned_move',
    'duplicate_target', 'unresolved'
  ]);
  const VALID_SEVERITIES = new Set(['error', 'warning', 'info']);
  const VALID_CONFIDENCES = new Set(['high', 'medium', 'low']);

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
      issue.type = 'ordering_issue'; // safe fallback
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
  if (!Array.isArray(optimizedMoves) || optimizedMoves.length === 0) return false;

  const originalWineIds = new Set(originalMoves.map(m => m.wineId));
  const optimizedWineIds = new Set(optimizedMoves.map(m => m.wineId));

  // Every optimized wine must come from the original set
  for (const id of optimizedWineIds) {
    if (!originalWineIds.has(id)) return false;
  }

  // Every move must have required fields
  for (const m of optimizedMoves) {
    if (!m.from || !m.to || !m.wineId) return false;
  }

  // No duplicate targets
  const targets = optimizedMoves.map(m => m.to);
  if (new Set(targets).size !== targets.length) return false;

  return true;
}

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

    const timeoutMs = parseInt(process.env.CLAUDE_AUDIT_TIMEOUT_MS, 10) || DEFAULT_TIMEOUT_MS;

    const apiCall = anthropic.messages.create({
      model: modelId,
      max_tokens: 16000,
      messages: [{ role: 'user', content: prompt }],
      ...(thinkingCfg || {})
    });

    const response = await Promise.race([
      apiCall,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Move audit timed out')), timeoutMs)
      )
    ]);

    const text = extractText(response);
    const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) || text.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      throw new Error('No JSON found in audit response');
    }

    const jsonStr = jsonMatch[1] || jsonMatch[0];
    const parsed = JSON.parse(jsonStr);
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
