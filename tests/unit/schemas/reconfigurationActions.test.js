/**
 * @fileoverview Tests for the Zod reconfiguration action schemas.
 * @module tests/unit/schemas/reconfigurationActions.test
 */

import {
  PlanActionSchema,
  ReconfigurationPlanSchema,
  LLMDeltaResponseSchema,
  validateAction,
  validateActions,
  applyDelta
} from '../../../src/schemas/reconfigurationActions.js';

describe('reconfigurationActions schemas', () => {
  describe('PlanActionSchema', () => {
    describe('reallocate_row', () => {
      it('accepts a valid reallocate_row action', () => {
        const action = {
          type: 'reallocate_row',
          priority: 2,
          fromZoneId: 'curiosities',
          toZoneId: 'cabernet',
          rowNumber: 14,
          reason: 'Donate underutilized row to overflowing zone',
          bottlesAffected: 3
        };
        const result = PlanActionSchema.safeParse(action);
        expect(result.success).toBe(true);
      });

      it('accepts optional source field', () => {
        const action = {
          type: 'reallocate_row',
          priority: 1,
          fromZoneId: 'a',
          toZoneId: 'b',
          rowNumber: 5,
          reason: 'test',
          bottlesAffected: 0,
          source: 'solver'
        };
        expect(PlanActionSchema.safeParse(action).success).toBe(true);
      });

      it('rejects rowNumber outside 1-19', () => {
        const action = {
          type: 'reallocate_row',
          priority: 1,
          fromZoneId: 'a',
          toZoneId: 'b',
          rowNumber: 20,
          reason: 'test',
          bottlesAffected: 0
        };
        expect(PlanActionSchema.safeParse(action).success).toBe(false);
      });

      it('rejects priority outside 1-5', () => {
        const action = {
          type: 'reallocate_row',
          priority: 0,
          fromZoneId: 'a',
          toZoneId: 'b',
          rowNumber: 5,
          reason: 'test',
          bottlesAffected: 0
        };
        expect(PlanActionSchema.safeParse(action).success).toBe(false);
      });

      it('rejects empty fromZoneId', () => {
        const action = {
          type: 'reallocate_row',
          priority: 1,
          fromZoneId: '',
          toZoneId: 'b',
          rowNumber: 5,
          reason: 'test',
          bottlesAffected: 0
        };
        expect(PlanActionSchema.safeParse(action).success).toBe(false);
      });

      it('rejects negative bottlesAffected', () => {
        const action = {
          type: 'reallocate_row',
          priority: 1,
          fromZoneId: 'a',
          toZoneId: 'b',
          rowNumber: 5,
          reason: 'test',
          bottlesAffected: -1
        };
        expect(PlanActionSchema.safeParse(action).success).toBe(false);
      });
    });

    describe('merge_zones', () => {
      it('accepts a valid merge_zones action', () => {
        const action = {
          type: 'merge_zones',
          priority: 3,
          sourceZones: ['curiosities'],
          targetZoneId: 'cabernet',
          reason: 'Consolidate small zones',
          bottlesAffected: 5
        };
        expect(PlanActionSchema.safeParse(action).success).toBe(true);
      });

      it('rejects empty sourceZones array', () => {
        const action = {
          type: 'merge_zones',
          priority: 3,
          sourceZones: [],
          targetZoneId: 'cabernet',
          reason: 'test',
          bottlesAffected: 0
        };
        expect(PlanActionSchema.safeParse(action).success).toBe(false);
      });
    });

    describe('retire_zone', () => {
      it('accepts a valid retire_zone action', () => {
        const action = {
          type: 'retire_zone',
          priority: 4,
          zoneId: 'curiosities',
          mergeIntoZoneId: 'red_buffer',
          reason: 'Empty zone',
          bottlesAffected: 0
        };
        expect(PlanActionSchema.safeParse(action).success).toBe(true);
      });
    });

    describe('expand_zone', () => {
      it('accepts a valid expand_zone action', () => {
        const action = {
          type: 'expand_zone',
          priority: 2,
          zoneId: 'cabernet',
          currentRows: ['R8', 'R9'],
          proposedRows: ['R8', 'R9', 'R10'],
          reason: 'Growing zone',
          bottlesAffected: 15
        };
        expect(PlanActionSchema.safeParse(action).success).toBe(true);
      });
    });

    it('rejects unknown action type', () => {
      const action = {
        type: 'unknown_type',
        priority: 1,
        reason: 'test',
        bottlesAffected: 0
      };
      expect(PlanActionSchema.safeParse(action).success).toBe(false);
    });
  });

  describe('validateAction', () => {
    it('returns success for valid action', () => {
      const result = validateAction({
        type: 'reallocate_row',
        priority: 2,
        fromZoneId: 'a',
        toZoneId: 'b',
        rowNumber: 5,
        reason: 'test',
        bottlesAffected: 0
      });
      expect(result.success).toBe(true);
    });

    it('returns error for invalid action', () => {
      const result = validateAction({ type: 'invalid' });
      expect(result.success).toBe(false);
    });
  });

  describe('validateActions', () => {
    it('separates valid and invalid actions', () => {
      const actions = [
        { type: 'reallocate_row', priority: 1, fromZoneId: 'a', toZoneId: 'b', rowNumber: 1, reason: 'ok', bottlesAffected: 0 },
        { type: 'invalid_type' },
        { type: 'retire_zone', priority: 3, zoneId: 'x', mergeIntoZoneId: 'y', reason: 'ok', bottlesAffected: 1 }
      ];
      const result = validateActions(actions);
      expect(result.valid).toHaveLength(2);
      expect(result.invalid).toHaveLength(1);
      expect(result.invalid[0].index).toBe(1);
    });

    it('returns all valid for correct actions', () => {
      const actions = [
        { type: 'reallocate_row', priority: 1, fromZoneId: 'a', toZoneId: 'b', rowNumber: 1, reason: 'ok', bottlesAffected: 0 }
      ];
      const result = validateActions(actions);
      expect(result.valid).toHaveLength(1);
      expect(result.invalid).toHaveLength(0);
    });
  });

  describe('LLMDeltaResponseSchema', () => {
    it('accepts a valid delta response', () => {
      const delta = {
        accept_action_indices: [0, 1],
        remove_action_indices: [2],
        patches: [{ action_index: 0, field: 'priority', value: 1 }],
        new_actions: [],
        reasoning: 'Looks good, just adjusted priority.'
      };
      expect(LLMDeltaResponseSchema.safeParse(delta).success).toBe(true);
    });

    it('accepts minimal delta (just reasoning)', () => {
      const delta = { reasoning: 'All actions are fine.' };
      const result = LLMDeltaResponseSchema.safeParse(delta);
      expect(result.success).toBe(true);
      expect(result.data.accept_action_indices).toEqual([]);
      expect(result.data.patches).toEqual([]);
    });

    it('rejects delta without reasoning', () => {
      const delta = { accept_action_indices: [0] };
      expect(LLMDeltaResponseSchema.safeParse(delta).success).toBe(false);
    });

    it('limits new_actions to 5', () => {
      const delta = {
        reasoning: 'test',
        new_actions: Array.from({ length: 6 }, () => ({
          type: 'reallocate_row', priority: 1, fromZoneId: 'a', toZoneId: 'b',
          rowNumber: 1, reason: 'test', bottlesAffected: 0
        }))
      };
      expect(LLMDeltaResponseSchema.safeParse(delta).success).toBe(false);
    });
  });

  describe('applyDelta', () => {
    const solverActions = [
      { type: 'reallocate_row', priority: 2, fromZoneId: 'a', toZoneId: 'b', rowNumber: 5, reason: 'r1', bottlesAffected: 3 },
      { type: 'reallocate_row', priority: 3, fromZoneId: 'c', toZoneId: 'd', rowNumber: 8, reason: 'r2', bottlesAffected: 5 },
      { type: 'retire_zone', priority: 4, zoneId: 'x', mergeIntoZoneId: 'y', reason: 'r3', bottlesAffected: 1 }
    ];

    it('removes specified actions', () => {
      const delta = {
        remove_action_indices: [2],
        patches: [],
        new_actions: [],
        reasoning: 'Removed retirement.'
      };
      const result = applyDelta(solverActions, delta);
      expect(result.actions).toHaveLength(2);
      expect(result.actions.every(a => a.type === 'reallocate_row')).toBe(true);
    });

    it('applies field patches', () => {
      const delta = {
        remove_action_indices: [],
        patches: [{ action_index: 0, field: 'priority', value: 1 }],
        new_actions: [],
        reasoning: 'Bumped priority.'
      };
      const result = applyDelta(solverActions, delta);
      expect(result.actions[0].priority).toBe(1);
      expect(result.patchesApplied).toBe(1);
    });

    it('appends new actions with source=llm', () => {
      const delta = {
        remove_action_indices: [],
        patches: [],
        new_actions: [{
          type: 'merge_zones',
          priority: 3,
          sourceZones: ['z1'],
          targetZoneId: 'z2',
          reason: 'new merge',
          bottlesAffected: 4
        }],
        reasoning: 'Added a merge.'
      };
      const result = applyDelta(solverActions, delta);
      expect(result.actions).toHaveLength(4);
      expect(result.actions[3].source).toBe('llm');
    });

    it('tags solver actions with source=solver', () => {
      const delta = {
        remove_action_indices: [],
        patches: [],
        new_actions: [],
        reasoning: 'All good.'
      };
      const result = applyDelta(solverActions, delta);
      for (const action of result.actions) {
        expect(action.source).toBe('solver');
      }
    });

    it('handles combined remove + patch + add', () => {
      const delta = {
        remove_action_indices: [1],
        patches: [{ action_index: 0, field: 'reason', value: 'Updated reason' }],
        new_actions: [{
          type: 'reallocate_row',
          priority: 1,
          fromZoneId: 'x',
          toZoneId: 'y',
          rowNumber: 10,
          reason: 'LLM action',
          bottlesAffected: 2
        }],
        reasoning: 'Combined changes.'
      };
      const result = applyDelta(solverActions, delta);
      // 3 original - 1 removed + 1 new = 3
      expect(result.actions).toHaveLength(3);
      expect(result.actions[0].reason).toBe('Updated reason');
      expect(result.actions[2].source).toBe('llm');
      expect(result.patchesApplied).toBe(1);
    });
  });

  describe('ReconfigurationPlanSchema', () => {
    it('accepts a valid complete plan', () => {
      const plan = {
        reasoning: 'A well-balanced plan.',
        actions: [
          { type: 'reallocate_row', priority: 1, fromZoneId: 'a', toZoneId: 'b', rowNumber: 5, reason: 'test', bottlesAffected: 0 }
        ],
        summary: {
          zonesChanged: 1,
          bottlesAffected: 0,
          misplacedBefore: 5,
          misplacedAfter: 3
        }
      };
      expect(ReconfigurationPlanSchema.safeParse(plan).success).toBe(true);
    });

    it('limits actions to 20', () => {
      const plan = {
        reasoning: 'Too many actions.',
        actions: Array.from({ length: 21 }, () => ({
          type: 'reallocate_row', priority: 1, fromZoneId: 'a', toZoneId: 'b',
          rowNumber: 1, reason: 'test', bottlesAffected: 0
        }))
      };
      expect(ReconfigurationPlanSchema.safeParse(plan).success).toBe(false);
    });
  });
});
