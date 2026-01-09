/**
 * @fileoverview GPT-5.2 reviewer for zone reconfiguration plans.
 * Verifies and patches Claude plans using structured outputs.
 * @module services/openaiReviewer
 */

import OpenAI from 'openai';
import { z } from 'zod';
import { zodTextFormat } from 'openai/helpers/zod';
import crypto from 'crypto';

// Check feature flag at runtime (not module load) to handle env var changes
function isFeatureEnabled() {
  return process.env.OPENAI_REVIEW_ZONE_RECONFIG === 'true';
}

function isForceModelEnabled() {
  return process.env.OPENAI_REVIEW_FORCE_MODEL === 'true';
}

// Simple circuit breaker to avoid repeated failures
const circuitBreaker = {
  failures: 0,
  lastFailure: null,
  isOpen: false,
  threshold: 3,
  resetTimeMs: 5 * 60 * 1000, // 5 minutes

  recordFailure() {
    this.failures += 1;
    this.lastFailure = Date.now();
    if (this.failures >= this.threshold) {
      this.isOpen = true;
      console.warn('[OpenAIReviewer] Circuit breaker OPEN after', this.failures, 'failures');
    }
  },

  recordSuccess() {
    this.failures = 0;
    this.isOpen = false;
  },

  canAttempt() {
    if (!this.isOpen) return true;
    if (Date.now() - (this.lastFailure || 0) > this.resetTimeMs) {
      this.isOpen = false;
      this.failures = 0;
      console.info('[OpenAIReviewer] Circuit breaker RESET');
      return true;
    }
    return false;
  }
};

const ViolationSchema = z.object({
  action_id: z.number().int().min(0).describe('Index of the action in the plan (0-based)'),
  rule: z.string().max(100).describe('Which rule was violated'),
  severity: z.enum(['critical', 'warning']).describe('Critical = must fix, Warning = recommended fix'),
  description: z.string().max(200).describe('Human-readable explanation')
});

const PatchSchema = z.object({
  action_id: z.number().int().min(0).describe('Index of the action to patch (0-based)'),
  field: z.string().max(50).describe('Field name to modify (e.g., "rowNumber", "toZoneId")'),
  old_value: z.union([z.string().max(100), z.number(), z.null()]).describe('Original value'),
  new_value: z.union([z.string().max(100), z.number()]).describe('Corrected value'),
  reason: z.string().max(200).describe('Why this patch is needed')
});

const ReviewResultSchema = z.object({
  verdict: z.enum(['approve', 'patch', 'reject']).describe('approve = plan is good, patch = fixable issues found, reject = fundamentally flawed'),
  violations: z.array(ViolationSchema).max(20).describe('List of rule violations found (max 20)'),
  patches: z.array(PatchSchema).max(20).describe('Targeted fixes for violations (max 20)'),
  reasoning: z.string().max(500).describe('Brief explanation of the review decision'),
  stability_score: z.number().min(0).max(1).describe('Estimate of plan stability: 1.0 = minimal disruption, 0.0 = maximum churn'),
  confidence: z.enum(['high', 'medium', 'low']).describe('Reviewer confidence in this assessment')
});

function stableStringify(plan) {
  const replacer = (key, value) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return Object.keys(value)
        .sort()
        .reduce((obj, k) => {
          obj[k] = value[k];
          return obj;
        }, {});
    }
    return value;
  };
  return JSON.stringify(plan, replacer);
}

/**
 * Hash a plan for telemetry linkability.
 * @param {Object} plan
 * @returns {string}
 */
export function hashPlan(plan) {
  return crypto.createHash('sha256').update(stableStringify(plan)).digest('hex').slice(0, 16);
}

function buildReviewPrompt(plan, context) {
  const { zones, physicalConstraints, currentState } = context;
  const zoneAllocations = (zones || []).map(z => ({
    id: z.id,
    name: z.name,
    actualRows: z.actualAssignedRows,
    rowCount: z.actualAssignedRows?.length || 0
  }));

  return `You are a wine cellar zone configuration reviewer. Your job is to VERIFY a proposed reconfiguration plan, not generate a new one.

## Physical Constraints
- Total rows: ${physicalConstraints.totalRows}
- Slots per row: ${physicalConstraints.slotsPerRow}
- Total capacity: ${physicalConstraints.totalCapacity}

## Current State
- Total bottles: ${currentState.totalBottles}
- Misplaced bottles: ${currentState.misplaced}
- Misplacement rate: ${currentState.misplacementPct}%

## Zone Allocations (ACTUAL current state)
${JSON.stringify(zoneAllocations, null, 2)}

## Rules to Verify
1. Row Ownership: A reallocate_row action can ONLY move a row that the fromZone actually owns (check actualRows)
2. Zone Existence: All zone IDs must be valid (exist in the zone list)
3. No Duplicate Rows: Same row cannot be reallocated multiple times in one plan
4. Capacity Sanity: Do not leave a zone with 0 rows if it has bottles
5. Zone ID Format: Zone IDs are strings like "chenin_blanc", NOT numbers

## Proposed Plan to Review
${JSON.stringify(plan, null, 2)}

## Your Task
1. Check each action against the rules
2. For violations, determine if they are fixable with a targeted patch
3. Provide a verdict:
   - "approve" if plan is valid
   - "patch" if issues are fixable (provide specific patches)
   - "reject" if fundamentally flawed
4. Calculate stability_score based on how much disruption this plan causes

Remember: You are a VERIFIER. Do not invent new actions or restructure the plan. Only validate and patch.`;
}

/**
 * Review a zone reconfiguration plan using GPT-5.2.
 * @param {Object} plan - The plan from Claude (actions, reasoning, summary)
 * @param {Object} context - Cellar context (zones, constraints, currentState)
 * @param {Object} options - Review options
 * @returns {Promise<Object>} Review result with verdict, violations, patches
 */
export async function reviewReconfigurationPlan(plan, context, options = {}) {
  const startTime = Date.now();
  const planId = options.planId || `plan_${Date.now()}`;
  const inputHash = hashPlan(plan);

  // Check feature flag at runtime
  if (!isFeatureEnabled()) {
    console.log('[OpenAIReviewer] Skipping - feature flag not enabled. Value:', process.env.OPENAI_REVIEW_ZONE_RECONFIG);
    return {
      skipped: true,
      reason: 'Feature flag OPENAI_REVIEW_ZONE_RECONFIG not enabled',
      originalPlan: plan
    };
  }

  if (!circuitBreaker.canAttempt()) {
    return {
      skipped: true,
      reason: 'Circuit breaker open due to recent failures',
      originalPlan: plan,
      telemetry: { was_fallback: true, fallback_reason: 'circuit_breaker_open' }
    };
  }

  if (!process.env.OPENAI_API_KEY) {
    return {
      skipped: true,
      reason: 'OPENAI_API_KEY not configured',
      originalPlan: plan
    };
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const reviewPrompt = buildReviewPrompt(plan, context);

  // Model fallback chain for Responses API: gpt-5.2 → gpt-5-mini → gpt-4.1 → gpt-4o
  // Zone reconfiguration is complex - use full gpt-5.2 with reasoning for quality
  const FALLBACK_MODELS = ['gpt-5.2', 'gpt-5-mini', 'gpt-4.1', 'gpt-4o'];
  const preferredModel = options.model || process.env.OPENAI_REVIEW_MODEL || 'gpt-5.2';
  const forceModel = options.forceModel ?? isForceModelEnabled();

  // Token limits: review results are small, cap aggressively for speed
  const envMaxOutputTokensRaw = process.env.OPENAI_REVIEW_MAX_OUTPUT_TOKENS;
  const envMaxOutputTokens = envMaxOutputTokensRaw ? Number(envMaxOutputTokensRaw) : null;
  const MIN_OUTPUT_TOKENS = 800;
  const MAX_OUTPUT_TOKENS = 2000;  // Hard cap - if model can't complete in 2k, something is wrong
  const defaultMaxOutputTokens = Number.isFinite(envMaxOutputTokens) && envMaxOutputTokens > 0
    ? Math.min(envMaxOutputTokens, MAX_OUTPUT_TOKENS)
    : 1500;  // Reduced default for speed

  // Reasoning effort: default to 'medium' for complex wine layouts
  // Zone reconfiguration benefits from reasoning to catch subtle issues
  // Valid values for gpt-5.2: 'none', 'low', 'medium', 'high'
  // Valid values for gpt-5-mini: 'minimal', 'low', 'medium', 'high'
  const defaultReasoningEffort = process.env.OPENAI_REVIEW_REASONING_EFFORT || 'medium';

  // Timeout: default 20s for gpt-5.2 with reasoning, max 60s
  // Zone reconfiguration review with reasoning takes ~10-15s typically
  const DEFAULT_TIMEOUT_MS = 20000;
  const MAX_TIMEOUT_MS = 60000;
  const envTimeoutMs = process.env.OPENAI_REVIEW_TIMEOUT_MS ? Number(process.env.OPENAI_REVIEW_TIMEOUT_MS) : null;
  const timeoutMs = Math.min(
    options.timeoutMs ?? envTimeoutMs ?? DEFAULT_TIMEOUT_MS,
    MAX_TIMEOUT_MS
  );

  const config = {
    model: preferredModel,
    max_output_tokens: Math.max(Math.min(options.maxOutputTokens ?? defaultMaxOutputTokens, MAX_OUTPUT_TOKENS), MIN_OUTPUT_TOKENS),
    reasoning_effort: options.reasoningEffort || defaultReasoningEffort,
    timeout_ms: timeoutMs
  };

  try {
    // Try models in fallback order if we get "model not found" errors
    let response = null;
    let usedModel = config.model;
    const modelsToTry = forceModel
      ? [preferredModel]
      : [preferredModel, ...FALLBACK_MODELS.filter(m => m !== preferredModel)];

    for (const modelId of modelsToTry) {
      try {
        const requestParams = {
          model: modelId,
          input: [
            { role: 'system', content: 'You are a precise wine cellar configuration reviewer. Be concise.' },
            { role: 'user', content: reviewPrompt }
          ],
          text: {
            format: zodTextFormat(ReviewResultSchema, 'review_result'),
            verbosity: 'low'  // Reduce output tokens for speed
          },
          max_output_tokens: config.max_output_tokens
        };

        // Add reasoning parameter for GPT-5.x models
        if (modelId.startsWith('gpt-5')) {
          requestParams.reasoning = { effort: config.reasoning_effort };
        }
        // No temperature - reviewer should be deterministic, schema provides control

        // Use responses.parse() with timeout to prevent blocking
        const apiCallPromise = openai.responses.parse(requestParams);
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`Reviewer timeout after ${timeoutMs}ms`)), timeoutMs)
        );

        response = await Promise.race([apiCallPromise, timeoutPromise]);
        usedModel = modelId;
        break; // Success, exit loop
      } catch (modelError) {
        // Check if it's a timeout error - don't fall back, just fail
        if (modelError?.message?.includes('timeout')) {
          throw modelError;
        }

        // Only fall back on "model not found" type errors
        const status = modelError?.status;
        const code = modelError?.error?.code || modelError?.code;
        const msg = String(modelError?.message || '').toLowerCase();
        const isModelNotFound = status === 404 || code === 'model_not_found' || msg.includes('model not found');

        if (!forceModel && isModelNotFound && modelsToTry.indexOf(modelId) < modelsToTry.length - 1) {
          console.warn(`[OpenAIReviewer] Model ${modelId} not available, trying fallback...`);
          continue;
        }
        throw modelError; // Re-throw if not a model error or no more fallbacks
      }
    }

    if (!response) {
      throw new Error('No available model could process the request');
    }

    // Check for incomplete response - treat as failure, don't retry with more tokens
    if (response.status === 'incomplete') {
      const reason = response.incomplete_details?.reason || 'unknown';
      console.warn(`[OpenAIReviewer] Incomplete response: ${reason}`);
      throw new Error(`Reviewer response incomplete: ${reason}`);
    }

    // Update config with actual model used for telemetry
    config.model = usedModel;

    // Use output_parsed from responses.parse() - already validated by SDK
    const result = response.output_parsed;
    if (!result) {
      console.error('[OpenAIReviewer] No parsed output. Response status:', response.status);
      throw new Error('No parsed output from model');
    }
    const latencyMs = Date.now() - startTime;

    circuitBreaker.recordSuccess();

    const telemetry = {
      plan_id: planId,
      input_plan_hash: inputHash,
      planner_model: 'claude-sonnet-4',
      input_action_count: plan.actions?.length || 0,
      input_summary: plan.summary || {},
      reviewer_model: config.model,
      reasoning_effort: config.reasoning_effort,
      temperature: null,  // No longer used - reviewer is deterministic
      max_output_tokens: config.max_output_tokens,
      verdict: result.verdict,
      violations_count: result.violations?.length || 0,
      patches_count: result.patches?.length || 0,
      output_plan_hash: null,
      output_action_count: null,
      violations: result.violations,
      patches: result.patches,
      reviewer_reasoning: result.reasoning,
      prompt_tokens: response.usage?.input_tokens,
      completion_tokens: response.usage?.output_tokens,
      total_tokens: response.usage?.total_tokens,
      reasoning_tokens: response.usage?.output_tokens_details?.reasoning_tokens,
      latency_ms: latencyMs,
      stability_score: result.stability_score,
      was_fallback: false
    };

    return {
      ...result,
      telemetry,
      originalPlan: plan
    };
  } catch (error) {
    const latencyMs = Date.now() - startTime;
    console.error('[OpenAIReviewer] Error:', error.message);

    circuitBreaker.recordFailure();

    return {
      skipped: true,
      reason: `Reviewer error: ${error.message}`,
      originalPlan: plan,
      telemetry: {
        plan_id: planId,
        input_plan_hash: inputHash,
        reviewer_model: config.model,
        latency_ms: latencyMs,
        was_fallback: true,
        fallback_reason: error.message
      }
    };
  }
}

/**
 * Apply patches to a plan, producing a new plan.
 * @param {Object} plan - Original plan
 * @param {Array} patches - Array of patch objects
 * @returns {Object} Patched plan with audit trail
 */
export function applyPatches(plan, patches) {
  if (!patches || patches.length === 0) {
    return { ...plan, _patchesApplied: 0 };
  }

  const patchedActions = JSON.parse(JSON.stringify(plan.actions || []));
  const appliedPatches = [];

  for (const patch of patches) {
    const { action_id: actionId, field, old_value: oldValue, new_value: newValue, reason } = patch;

    if (actionId < 0 || actionId >= patchedActions.length) {
      console.warn('[OpenAIReviewer] Invalid patch action_id:', actionId);
      continue;
    }

    const action = patchedActions[actionId];
    const currentValue = action[field];

    if (oldValue !== null && currentValue !== oldValue) {
      console.warn(`[OpenAIReviewer] Patch mismatch for action ${actionId}.${field}: expected ${oldValue}, found ${currentValue}`);
      continue;
    }

    action[field] = newValue;
    appliedPatches.push({ action_id: actionId, field, old_value: oldValue, new_value: newValue, reason });
  }

  return {
    ...plan,
    actions: patchedActions,
    _patchesApplied: appliedPatches.length,
    _patchAudit: appliedPatches
  };
}

/**
 * Calculate a stability score for a plan based on disruption metrics.
 * Higher score = less disruption.
 * @param {Object} plan
 * @param {Object} currentState
 * @returns {number}
 */
export function calculateStabilityScore(plan, currentState) {
  const actions = plan?.actions || [];
  if (actions.length === 0) return 1.0;

  const totalBottles = currentState?.totalBottles || 1;
  let bottlesAffected = 0;
  const zonesAffected = new Set();

  for (const action of actions) {
    bottlesAffected += action.bottlesAffected || 0;

    if (action.type === 'reallocate_row') {
      if (action.fromZoneId) zonesAffected.add(action.fromZoneId);
      if (action.toZoneId) zonesAffected.add(action.toZoneId);
    } else if (action.type === 'merge_zones') {
      (action.sourceZones || []).forEach(z => zonesAffected.add(z));
      if (action.targetZoneId) zonesAffected.add(action.targetZoneId);
    } else if (action.type === 'retire_zone') {
      if (action.zoneId) zonesAffected.add(action.zoneId);
      if (action.mergeIntoZoneId) zonesAffected.add(action.mergeIntoZoneId);
    }
  }

  const bottleRatio = bottlesAffected / totalBottles;
  const zoneRatio = zonesAffected.size / 10; // assume ~10 zones typical
  const disruption = (bottleRatio * 0.7) + (zoneRatio * 0.3);

  return Math.max(0, Math.min(1, 1 - disruption));
}

/**
 * Save telemetry record to database.
 * @param {Object} db - Database connection
 * @param {Object} telemetry - Telemetry payload
 * @returns {Promise<number|null>} Inserted record id or null
 */
export async function saveTelemetry(db, telemetry, options = {}) {
  if (!telemetry) return null;

  const swallowErrors = options.swallowErrors ?? true;

  try {
    const result = await db.prepare(`
      INSERT INTO ai_review_telemetry (
        plan_id, input_plan_hash, planner_model, input_action_count, input_summary,
        reviewer_model, reasoning_effort, temperature, max_output_tokens,
        verdict, violations_count, patches_count, output_plan_hash, output_action_count,
        violations, patches, reviewer_reasoning,
        prompt_tokens, completion_tokens, total_tokens, reasoning_tokens,
        latency_ms, stability_score, was_fallback, fallback_reason,
        review_started_at, review_completed_at
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        NOW() - (COALESCE(?, 0) * INTERVAL '1 millisecond'), NOW()
      ) RETURNING id
    `).get(
      telemetry.plan_id,
      telemetry.input_plan_hash,
      telemetry.planner_model,
      telemetry.input_action_count,
      JSON.stringify(telemetry.input_summary || {}),
      telemetry.reviewer_model,
      telemetry.reasoning_effort,
      telemetry.temperature,
      telemetry.max_output_tokens,
      telemetry.verdict || 'skipped',
      telemetry.violations_count || 0,
      telemetry.patches_count || 0,
      telemetry.output_plan_hash,
      telemetry.output_action_count ?? null,
      JSON.stringify(telemetry.violations || []),
      JSON.stringify(telemetry.patches || []),
      telemetry.reviewer_reasoning,
      telemetry.prompt_tokens ?? null,
      telemetry.completion_tokens ?? null,
      telemetry.total_tokens ?? null,
      telemetry.reasoning_tokens ?? null,
      telemetry.latency_ms ?? null,
      telemetry.stability_score ?? null,
      telemetry.was_fallback || false,
      telemetry.fallback_reason || null,
      telemetry.latency_ms ?? 0
    );

    return result?.id || null;
  } catch (error) {
    const extra = {
      code: error?.code,
      detail: error?.detail,
      hint: error?.hint
    };
    console.error('[OpenAIReviewer] Failed to save telemetry:', error.message, extra);
    if (swallowErrors) return null;
    throw error;
  }
}

export function getCircuitBreakerStatus() {
  return {
    isOpen: circuitBreaker.isOpen,
    failures: circuitBreaker.failures,
    threshold: circuitBreaker.threshold,
    lastFailure: circuitBreaker.lastFailure,
    resetTimeMs: circuitBreaker.resetTimeMs
  };
}

// ============================================================================
// Cellar Analysis Review
// ============================================================================

const CellarAdviceReviewSchema = z.object({
  verdict: z.enum(['approve', 'patch', 'reject']).describe('approve = advice is sound, patch = minor fixes needed, reject = fundamentally flawed'),
  issues: z.array(z.object({
    field: z.string().max(50).describe('Field with issue (e.g., "confirmedMoves[0]", "fridgePlan")'),
    issue: z.string().max(200).describe('What is wrong'),
    severity: z.enum(['critical', 'warning'])
  })).max(10).describe('Issues found in the advice'),
  patches: z.array(z.object({
    field: z.string().max(50),
    action: z.enum(['remove', 'modify', 'add']),
    reason: z.string().max(200)
  })).max(10).describe('Suggested fixes'),
  reasoning: z.string().max(500).describe('Brief explanation of review'),
  confidence: z.enum(['high', 'medium', 'low'])
});

/**
 * Check if cellar analysis review is enabled.
 * @returns {boolean}
 */
export function isCellarAnalysisReviewEnabled() {
  return process.env.OPENAI_REVIEW_CELLAR_ANALYSIS === 'true';
}

/**
 * Review cellar organisation advice from Claude.
 * @param {Object} advice - The advice from Claude (confirmedMoves, fridgePlan, etc.)
 * @param {Object} context - Original analysis context
 * @param {Object} options - Review options
 * @returns {Promise<Object>} Review result
 */
export async function reviewCellarAdvice(advice, context, options = {}) {
  if (!isCellarAnalysisReviewEnabled()) {
    return { skipped: true, reason: 'OPENAI_REVIEW_CELLAR_ANALYSIS not enabled', originalAdvice: advice };
  }

  if (!circuitBreaker.canAttempt()) {
    return { skipped: true, reason: 'Circuit breaker open', originalAdvice: advice };
  }

  if (!process.env.OPENAI_API_KEY) {
    return { skipped: true, reason: 'OPENAI_API_KEY not configured', originalAdvice: advice };
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const startTime = Date.now();

  const prompt = `You are reviewing cellar organisation advice from a sommelier AI.

## Context
- Total bottles: ${context.totalBottles || 'unknown'}
- Zones: ${(context.zones || []).map(z => z.id).join(', ') || 'unknown'}

## Advice to Review
${JSON.stringify(advice, null, 2)}

## Validation Rules
1. Move Validity: All moves must reference valid wine IDs and slots
2. Fridge Plan: Should not exceed fridge capacity, must have variety
3. Zone Health: Assessments should match actual zone data
4. Consistency: No contradictions between confirmed/rejected moves

Review the advice and flag any issues.`;

  const modelId = options.model || process.env.OPENAI_REVIEW_MODEL || 'gpt-5.2';
  const timeoutMs = options.timeoutMs ?? (Number(process.env.OPENAI_REVIEW_TIMEOUT_MS) || 120000);

  try {
    const requestParams = {
      model: modelId,
      input: [
        { role: 'system', content: 'You are a precise wine cellar advisor reviewer. Be concise.' },
        { role: 'user', content: prompt }
      ],
      text: {
        format: zodTextFormat(CellarAdviceReviewSchema, 'cellar_advice_review'),
        verbosity: 'low'
      },
      max_output_tokens: 1500
    };

    if (modelId.startsWith('gpt-5')) {
      requestParams.reasoning = { effort: 'medium' };
    }

    const apiCallPromise = openai.responses.parse(requestParams);
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Cellar review timeout after ${timeoutMs}ms`)), timeoutMs)
    );

    const response = await Promise.race([apiCallPromise, timeoutPromise]);
    const result = response.output_parsed;

    if (!result) {
      throw new Error('No parsed output from model');
    }

    circuitBreaker.recordSuccess();

    return {
      reviewed: true,
      verdict: result.verdict,
      issues: result.issues,
      patches: result.patches,
      reasoning: result.reasoning,
      confidence: result.confidence,
      latencyMs: Date.now() - startTime,
      originalAdvice: advice
    };
  } catch (error) {
    circuitBreaker.recordFailure();
    console.error('[OpenAIReviewer] Cellar advice review failed:', error.message);
    return {
      skipped: true,
      reason: error.message,
      originalAdvice: advice
    };
  }
}

// ============================================================================
// Zone Capacity Advice Review
// ============================================================================

const ZoneCapacityReviewSchema = z.object({
  verdict: z.enum(['approve', 'patch', 'reject']).describe('approve = advice is valid, patch = fixable, reject = wrong'),
  issues: z.array(z.object({
    action_index: z.number().int().min(0).describe('Index of problematic action'),
    rule: z.string().max(100),
    description: z.string().max(200)
  })).max(10),
  patches: z.array(z.object({
    action_index: z.number().int().min(0),
    field: z.string().max(50),
    old_value: z.union([z.string().max(100), z.number(), z.null()]),
    new_value: z.union([z.string().max(100), z.number()]),
    reason: z.string().max(200)
  })).max(10),
  reasoning: z.string().max(500),
  confidence: z.enum(['high', 'medium', 'low'])
});

/**
 * Check if zone capacity review is enabled.
 * @returns {boolean}
 */
export function isZoneCapacityReviewEnabled() {
  return process.env.OPENAI_REVIEW_ZONE_CAPACITY === 'true';
}

/**
 * Review zone capacity advice from Claude.
 * @param {Object} advice - The advice (recommendation, actions)
 * @param {Object} context - Zone context
 * @param {Object} options - Review options
 * @returns {Promise<Object>} Review result
 */
export async function reviewZoneCapacityAdvice(advice, context, options = {}) {
  if (!isZoneCapacityReviewEnabled()) {
    return { skipped: true, reason: 'OPENAI_REVIEW_ZONE_CAPACITY not enabled', originalAdvice: advice };
  }

  if (!circuitBreaker.canAttempt()) {
    return { skipped: true, reason: 'Circuit breaker open', originalAdvice: advice };
  }

  if (!process.env.OPENAI_API_KEY) {
    return { skipped: true, reason: 'OPENAI_API_KEY not configured', originalAdvice: advice };
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const startTime = Date.now();

  const prompt = `You are reviewing zone capacity advice from a sommelier AI.

## Context
- Overflowing zone: ${context.overflowingZoneId}
- Available rows: ${JSON.stringify(context.availableRows || [])}
- Adjacent zones: ${JSON.stringify(context.adjacentZones || [])}
- Current allocation: ${JSON.stringify(context.currentZoneAllocation || {})}

## Advice to Review
${JSON.stringify(advice, null, 2)}

## Validation Rules
1. Row Allocation: Only allocate rows that are actually available
2. Zone Merges: Source zone must exist and be compatible with target
3. Wine Moves: Must reference valid wine IDs
4. Consistency: Recommendation type must match the actions provided

Review and flag issues.`;

  const modelId = options.model || process.env.OPENAI_REVIEW_MODEL || 'gpt-5.2';
  const timeoutMs = options.timeoutMs ?? (Number(process.env.OPENAI_REVIEW_TIMEOUT_MS) || 120000);

  try {
    const requestParams = {
      model: modelId,
      input: [
        { role: 'system', content: 'You are a precise wine cellar zone reviewer. Be concise.' },
        { role: 'user', content: prompt }
      ],
      text: {
        format: zodTextFormat(ZoneCapacityReviewSchema, 'zone_capacity_review'),
        verbosity: 'low'
      },
      max_output_tokens: 1500
    };

    if (modelId.startsWith('gpt-5')) {
      requestParams.reasoning = { effort: 'medium' };
    }

    const apiCallPromise = openai.responses.parse(requestParams);
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Zone capacity review timeout after ${timeoutMs}ms`)), timeoutMs)
    );

    const response = await Promise.race([apiCallPromise, timeoutPromise]);
    const result = response.output_parsed;

    if (!result) {
      throw new Error('No parsed output from model');
    }

    circuitBreaker.recordSuccess();

    return {
      reviewed: true,
      verdict: result.verdict,
      issues: result.issues,
      patches: result.patches,
      reasoning: result.reasoning,
      confidence: result.confidence,
      latencyMs: Date.now() - startTime,
      originalAdvice: advice
    };
  } catch (error) {
    circuitBreaker.recordFailure();
    console.error('[OpenAIReviewer] Zone capacity review failed:', error.message);
    return {
      skipped: true,
      reason: error.message,
      originalAdvice: advice
    };
  }
}
