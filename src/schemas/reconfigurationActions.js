/**
 * @fileoverview Zod schemas for zone reconfiguration actions.
 * Shared discriminated union used across solver, LLM, reviewer, apply endpoint, and UI.
 * @module schemas/reconfigurationActions
 */

import { z } from 'zod';

/**
 * Action source tracking — which layer produced this action.
 */
const actionSourceSchema = z.enum(['solver', 'llm', 'heuristic', 'solver+llm', 'solver+llm+heuristic']).optional();

/**
 * Reallocate a row from one zone to another.
 */
export const ReallocateRowAction = z.object({
  type: z.literal('reallocate_row'),
  priority: z.number().int().min(1).max(5),
  fromZoneId: z.string().min(1),
  toZoneId: z.string().min(1),
  rowNumber: z.number().int().min(1).max(19),
  reason: z.string(),
  bottlesAffected: z.number().int().min(0),
  source: actionSourceSchema,
  _colorViolationWarning: z.boolean().optional()
});

/**
 * Merge one or more source zones into a target zone.
 */
export const MergeZonesAction = z.object({
  type: z.literal('merge_zones'),
  priority: z.number().int().min(1).max(5),
  sourceZones: z.array(z.string().min(1)).min(1).max(10),
  targetZoneId: z.string().min(1),
  reason: z.string(),
  bottlesAffected: z.number().int().min(0),
  source: actionSourceSchema
});

/**
 * Retire a zone by merging its bottles into another zone.
 */
export const RetireZoneAction = z.object({
  type: z.literal('retire_zone'),
  priority: z.number().int().min(1).max(5),
  zoneId: z.string().min(1),
  mergeIntoZoneId: z.string().min(1),
  reason: z.string(),
  bottlesAffected: z.number().int().min(0),
  source: actionSourceSchema
});

/**
 * Expand a zone by allocating additional rows to it.
 */
export const ExpandZoneAction = z.object({
  type: z.literal('expand_zone'),
  priority: z.number().int().min(1).max(5),
  zoneId: z.string().min(1),
  currentRows: z.array(z.string()).optional(),
  proposedRows: z.array(z.string()).optional(),
  reason: z.string(),
  bottlesAffected: z.number().int().min(0),
  source: actionSourceSchema
});

/**
 * Discriminated union of all plan action types.
 * This is the single source of truth for action shape validation.
 */
export const PlanActionSchema = z.discriminatedUnion('type', [
  ReallocateRowAction,
  MergeZonesAction,
  RetireZoneAction,
  ExpandZoneAction
]);

/**
 * Schema for a complete reconfiguration plan.
 */
export const ReconfigurationPlanSchema = z.object({
  reasoning: z.string(),
  actions: z.array(PlanActionSchema).max(20),
  source: z.string().optional(),
  summary: z.object({
    zonesChanged: z.number().int().min(0),
    bottlesAffected: z.number().int().min(0),
    misplacedBefore: z.number().int().min(0),
    misplacedAfter: z.number().int().min(0)
  }).optional()
});

/**
 * Schema for the LLM delta protocol response.
 * The LLM returns patches against the solver draft instead of a full rewrite.
 */
export const LLMDeltaResponseSchema = z.object({
  accept_action_indices: z.array(z.number().int().min(0)).default([]),
  remove_action_indices: z.array(z.number().int().min(0)).default([]),
  patches: z.array(z.object({
    action_index: z.number().int().min(0),
    field: z.string().min(1),
    value: z.unknown()
  })).default([]),
  new_actions: z.array(PlanActionSchema).max(5).default([]),
  reasoning: z.string()
});

/**
 * Validate a single action against the schema.
 * @param {Object} action - Raw action object
 * @returns {{ success: boolean, data?: Object, error?: import('zod').ZodError }}
 */
export function validateAction(action) {
  return PlanActionSchema.safeParse(action);
}

/**
 * Validate an array of actions.
 * Returns validated actions and any validation errors.
 * @param {Array} actions - Raw action objects
 * @returns {{ valid: Array, invalid: Array<{index: number, error: string}> }}
 */
export function validateActions(actions) {
  const valid = [];
  const invalid = [];

  for (let i = 0; i < actions.length; i++) {
    const result = PlanActionSchema.safeParse(actions[i]);
    if (result.success) {
      valid.push(result.data);
    } else {
      invalid.push({
        index: i,
        error: result.error.issues.map(iss => `${iss.path.join('.')}: ${iss.message}`).join('; ')
      });
    }
  }

  return { valid, invalid };
}

/**
 * Apply a delta response to a solver draft.
 * Returns the merged action list after accepting, removing, patching, and adding actions.
 * @param {Array} solverActions - Original solver actions
 * @param {Object} delta - Validated LLMDeltaResponseSchema object
 * @returns {{ actions: Array, patchesApplied: number }}
 */
export function applyDelta(solverActions, delta) {
  const removeSet = new Set(delta.remove_action_indices || []);
  let patchesApplied = 0;

  // Start with solver actions, filtering out removed ones
  const merged = solverActions
    .filter((_, i) => !removeSet.has(i))
    .map((action, _originalIdx) => ({ ...action }));

  // Apply patches to accepted actions (by original index)
  // Build a map from original index to merged position
  const originalToMerged = new Map();
  let mergedIdx = 0;
  for (let i = 0; i < solverActions.length; i++) {
    if (!removeSet.has(i)) {
      originalToMerged.set(i, mergedIdx);
      mergedIdx++;
    }
  }

  for (const patch of (delta.patches || [])) {
    const targetIdx = originalToMerged.get(patch.action_index);
    if (targetIdx !== undefined && merged[targetIdx]) {
      merged[targetIdx][patch.field] = patch.value;
      patchesApplied++;
    }
  }

  // Append new actions from LLM
  const newActions = (delta.new_actions || []).map(a => ({
    ...a,
    source: 'llm'
  }));

  // Tag solver actions with source
  for (const action of merged) {
    if (!action.source) action.source = 'solver';
  }

  return {
    actions: [...merged, ...newActions],
    patchesApplied
  };
}
