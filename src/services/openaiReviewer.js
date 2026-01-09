/**
 * @fileoverview GPT-5.2 reviewer for zone reconfiguration plans.
 * Verifies and patches Claude plans using structured outputs.
 * @module services/openaiReviewer
 */

import OpenAI from 'openai';
import { z } from 'zod';
import { zodResponseFormat } from 'openai/helpers/zod';
import crypto from 'crypto';

// Check feature flag at runtime (not module load) to handle env var changes
function isFeatureEnabled() {
  return process.env.OPENAI_REVIEW_ZONE_RECONFIG === 'true';
}

// Log feature flag status on module load for debugging
console.log('[OpenAIReviewer] Feature flag OPENAI_REVIEW_ZONE_RECONFIG:', process.env.OPENAI_REVIEW_ZONE_RECONFIG);

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
  action_id: z.number().describe('Index of the action in the plan (0-based)'),
  rule: z.string().describe('Which rule was violated'),
  severity: z.enum(['critical', 'warning']).describe('Critical = must fix, Warning = recommended fix'),
  description: z.string().describe('Human-readable explanation')
});

const PatchSchema = z.object({
  action_id: z.number().describe('Index of the action to patch (0-based)'),
  field: z.string().describe('Field name to modify (e.g., "rowNumber", "toZoneId")'),
  old_value: z.union([z.string(), z.number(), z.null()]).describe('Original value'),
  new_value: z.union([z.string(), z.number()]).describe('Corrected value'),
  reason: z.string().describe('Why this patch is needed')
});

const ReviewResultSchema = z.object({
  verdict: z.enum(['approve', 'patch', 'reject']).describe('approve = plan is good, patch = fixable issues found, reject = fundamentally flawed'),
  violations: z.array(ViolationSchema).describe('List of rule violations found'),
  patches: z.array(PatchSchema).describe('Targeted fixes for violations (only if verdict=patch)'),
  reasoning: z.string().describe('Brief explanation of the review decision'),
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

  // Model fallback chain for Responses API: gpt-5.2 → gpt-4.1 → gpt-4o
  const FALLBACK_MODELS = ['gpt-5.2', 'gpt-4.1', 'gpt-4o'];
  const preferredModel = options.model || process.env.OPENAI_REVIEW_MODEL || 'gpt-5.2';

  const config = {
    model: preferredModel,
    temperature: options.temperature ?? 0.1,
    max_output_tokens: options.maxOutputTokens || 2000,
    reasoning_effort: options.reasoningEffort || 'medium'
  };

  try {
    // Build JSON schema from Zod for structured output
    const schemaFormat = zodResponseFormat(ReviewResultSchema, 'review_result');

    // Try models in fallback order if we get "model not found" errors
    let response = null;
    let usedModel = config.model;
    const modelsToTry = config.model === preferredModel
      ? [preferredModel, ...FALLBACK_MODELS.filter(m => m !== preferredModel)]
      : [config.model];

    for (const modelId of modelsToTry) {
      try {
        // gpt-5.2 supports reasoning parameter via Responses API
        const requestParams = {
          model: modelId,
          input: [
            { role: 'system', content: 'You are a precise wine cellar configuration reviewer.' },
            { role: 'user', content: reviewPrompt }
          ],
          text: {
            format: {
              type: 'json_schema',
              name: schemaFormat.json_schema.name,
              strict: schemaFormat.json_schema.strict,
              schema: schemaFormat.json_schema.schema
            }
          },
          temperature: config.temperature,
          max_output_tokens: config.max_output_tokens
        };

        // Add reasoning parameter for models that support it (gpt-5.2)
        if (modelId.startsWith('gpt-5')) {
          requestParams.reasoning = { effort: config.reasoning_effort };
        }

        response = await openai.responses.create(requestParams);
        usedModel = modelId;
        break; // Success, exit loop
      } catch (modelError) {
        // Only fall back on "model not found" type errors
        const isModelNotFound = modelError.status === 404 ||
          (modelError.message && modelError.message.toLowerCase().includes('model'));

        if (isModelNotFound && modelsToTry.indexOf(modelId) < modelsToTry.length - 1) {
          console.warn(`[OpenAIReviewer] Model ${modelId} not available, trying fallback...`);
          continue;
        }
        throw modelError; // Re-throw if not a model error or no more fallbacks
      }
    }

    if (!response) {
      throw new Error('No available model could process the request');
    }

    // Update config with actual model used for telemetry
    config.model = usedModel;

    // Parse and validate output with Zod
    const outputText = response.output_text;
    const result = ReviewResultSchema.parse(JSON.parse(outputText));
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
      temperature: config.temperature,
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
