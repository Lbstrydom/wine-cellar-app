/**
 * @fileoverview Unit tests for move plan validation.
 * @module tests/unit/services/movePlanner.test
 */



// Mock database BEFORE importing the module that uses it
vi.mock('../../../../src/db/index.js', () => ({
  default: {
    prepare: vi.fn()
  }
}));

// Mock zone-related dependencies for Rule 6 zone/colour policy tests
vi.mock('../../../../src/services/cellar/cellarAllocation.js', () => ({
  getActiveZoneMap: vi.fn().mockResolvedValue({})
}));

vi.mock('../../../../src/config/cellarZones.js', () => ({
  getZoneById: vi.fn()
}));

// NOTE: Do NOT mock cellarLayoutSettings.js here. In --no-isolate mode, a global
// mock would replace the real module for ALL downstream suites (cellarLayoutSettings.test.js,
// cellarAllocation.test.js, zoneLayoutProposal.test.js), causing cascading failures.
// isWhiteFamily is a pure function that works correctly without mocking.

vi.mock('../../../../src/services/cellar/cellarPlacement.js', () => ({
  inferColor: vi.fn()
}));

import { validateMovePlan } from '../../../../src/services/cellar/movePlanner.js';
import db from '../../../../src/db/index.js';
import { getActiveZoneMap } from '../../../../src/services/cellar/cellarAllocation.js';
import { getZoneById } from '../../../../src/config/cellarZones.js';

describe('validateMovePlan', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Rule 1: Each wine can only be moved once', () => {
    it('should reject moves with duplicate wine IDs', async () => {
      // Setup: Mock empty slots table (no occupancy conflicts)
      db.prepare.mockReturnValue({
        all: vi.fn().mockResolvedValue([])
      });

      const moves = [
        { wineId: 1, wineName: 'Chianti', from: 'R1C1', to: 'R2C1' },
        { wineId: 1, wineName: 'Chianti', from: 'R1C2', to: 'R2C2' } // Duplicate wine ID
      ];

      const result = await validateMovePlan(moves, 'test-cellar-id');

      expect(result.valid).toBe(false);
      expect(result.summary.duplicateWines).toBe(1);
      // Note: May have multiple errors due to source mismatches (wine not at expected location)
      expect(result.errors.length).toBeGreaterThanOrEqual(1);
      const duplicateWineError = result.errors.find(e => e.type === 'duplicate_wine');
      expect(duplicateWineError).toBeDefined();
      expect(duplicateWineError.wineId).toBe(1);
    });

    it('should allow moves with unique wine IDs', async () => {
      db.prepare.mockReturnValue({
        all: vi.fn().mockResolvedValue([
          { location_code: 'R1C1', wine_id: 1 },
          { location_code: 'R1C2', wine_id: 2 }
        ])
      });

      const moves = [
        { wineId: 1, wineName: 'Chianti', from: 'R1C1', to: 'R2C1' },
        { wineId: 2, wineName: 'Barolo', from: 'R1C2', to: 'R2C2' }
      ];

      const result = await validateMovePlan(moves, 'test-cellar-id');

      expect(result.summary.duplicateWines).toBe(0);
    });
  });

  describe('Rule 2: Each target slot can only be used once', () => {
    it('should reject moves with duplicate target slots', async () => {
      db.prepare.mockReturnValue({
        all: vi.fn().mockResolvedValue([
          { location_code: 'R1C1', wine_id: 1 },
          { location_code: 'R1C2', wine_id: 2 }
        ])
      });

      const moves = [
        { wineId: 1, wineName: 'Chianti', from: 'R1C1', to: 'R2C1' },
        { wineId: 2, wineName: 'Barolo', from: 'R1C2', to: 'R2C1' } // Duplicate target
      ];

      const result = await validateMovePlan(moves, 'test-cellar-id');

      expect(result.valid).toBe(false);
      expect(result.summary.duplicateTargets).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].type).toBe('duplicate_target');
      expect(result.errors[0].targetSlot).toBe('R2C1');
    });

    it('should allow moves with unique target slots', async () => {
      db.prepare.mockReturnValue({
        all: vi.fn().mockResolvedValue([
          { location_code: 'R1C1', wine_id: 1 },
          { location_code: 'R1C2', wine_id: 2 }
        ])
      });

      const moves = [
        { wineId: 1, wineName: 'Chianti', from: 'R1C1', to: 'R2C1' },
        { wineId: 2, wineName: 'Barolo', from: 'R1C2', to: 'R2C2' }
      ];

      const result = await validateMovePlan(moves, 'test-cellar-id');

      expect(result.summary.duplicateTargets).toBe(0);
    });
  });

  describe('Rule 3: Target must be empty OR will be vacated', () => {
    it('should reject move to occupied slot', async () => {
      db.prepare.mockReturnValueOnce({
        all: vi.fn().mockResolvedValue([
          { location_code: 'R1C1', wine_id: 1 },
          { location_code: 'R2C1', wine_id: 3 } // Target is occupied
        ])
      }).mockReturnValueOnce({
        get: vi.fn().mockResolvedValue({ wine_name: 'Brunello' })
      });

      const moves = [
        { wineId: 1, wineName: 'Chianti', from: 'R1C1', to: 'R2C1' }
      ];

      const result = await validateMovePlan(moves, 'test-cellar-id');

      expect(result.valid).toBe(false);
      expect(result.summary.occupiedTargets).toBe(1);
      expect(result.errors[0].type).toBe('target_occupied');
      expect(result.errors[0].occupantWineId).toBe(3);
    });

    it('should allow move to empty slot', async () => {
      db.prepare.mockReturnValue({
        all: vi.fn().mockResolvedValue([
          { location_code: 'R1C1', wine_id: 1 }
          // R2C1 is empty (not in list)
        ])
      });

      const moves = [
        { wineId: 1, wineName: 'Chianti', from: 'R1C1', to: 'R2C1' }
      ];

      const result = await validateMovePlan(moves, 'test-cellar-id');

      expect(result.valid).toBe(true);
      expect(result.summary.occupiedTargets).toBe(0);
    });

    it('should allow move to slot that will be vacated by another move', async () => {
      db.prepare.mockReturnValue({
        all: vi.fn().mockResolvedValue([
          { location_code: 'R1C1', wine_id: 1 },
          { location_code: 'R1C2', wine_id: 2 }
        ])
      });

      const moves = [
        { wineId: 1, wineName: 'Chianti', from: 'R1C1', to: 'R2C1' }, // Vacates R1C1
        { wineId: 2, wineName: 'Barolo', from: 'R1C2', to: 'R1C1' }  // Targets vacated slot
      ];

      const result = await validateMovePlan(moves, 'test-cellar-id');

      expect(result.valid).toBe(true);
      expect(result.summary.occupiedTargets).toBe(0);
    });
  });

  describe('Rule 4: Source must contain expected wine', () => {
    it('should reject move when source is empty', async () => {
      db.prepare.mockReturnValue({
        all: vi.fn().mockResolvedValue([])
      });

      const moves = [
        { wineId: 1, wineName: 'Chianti', from: 'R1C1', to: 'R2C1' }
      ];

      const result = await validateMovePlan(moves, 'test-cellar-id');

      expect(result.valid).toBe(false);
      expect(result.summary.sourceMismatches).toBe(1);
      expect(result.errors[0].type).toBe('source_mismatch');
      expect(result.errors[0].expectedWineId).toBe(1);
      expect(result.errors[0].actualWineId).toBe(null);
    });

    it('should reject move when wrong wine at source', async () => {
      db.prepare.mockReturnValue({
        all: vi.fn().mockResolvedValue([
          { location_code: 'R1C1', wine_id: 99 } // Different wine than expected
        ])
      });

      const moves = [
        { wineId: 1, wineName: 'Chianti', from: 'R1C1', to: 'R2C1' }
      ];

      const result = await validateMovePlan(moves, 'test-cellar-id');

      expect(result.valid).toBe(false);
      expect(result.summary.sourceMismatches).toBe(1);
      expect(result.errors[0].type).toBe('source_mismatch');
      expect(result.errors[0].expectedWineId).toBe(1);
      expect(result.errors[0].actualWineId).toBe(99);
    });

    it('should allow move when correct wine at source', async () => {
      db.prepare.mockReturnValue({
        all: vi.fn().mockResolvedValue([
          { location_code: 'R1C1', wine_id: 1 }
        ])
      });

      const moves = [
        { wineId: 1, wineName: 'Chianti', from: 'R1C1', to: 'R2C1' }
      ];

      const result = await validateMovePlan(moves, 'test-cellar-id');

      expect(result.valid).toBe(true);
      expect(result.summary.sourceMismatches).toBe(0);
    });
  });

  describe('Rule 5: No-op moves are wasteful', () => {
    it('should flag no-op move (same source and target)', async () => {
      db.prepare.mockReturnValue({
        all: vi.fn().mockResolvedValue([
          { location_code: 'R1C1', wine_id: 1 }
        ])
      });

      const moves = [
        { wineId: 1, wineName: 'Chianti', from: 'R1C1', to: 'R1C1' } // No-op
      ];

      const result = await validateMovePlan(moves, 'test-cellar-id');

      expect(result.valid).toBe(false);
      expect(result.summary.noopMoves).toBe(1);
      expect(result.errors[0].type).toBe('noop_move');
    });
  });

  describe('Complex scenarios', () => {
    it('should handle multiple validation errors', async () => {
      db.prepare.mockReturnValueOnce({
        all: vi.fn().mockResolvedValue([
          { location_code: 'R1C1', wine_id: 1 },
          { location_code: 'R2C1', wine_id: 3 }
        ])
      }).mockReturnValue({
        get: vi.fn().mockResolvedValue({ wine_name: 'Brunello' })
      });

      const moves = [
        { wineId: 1, wineName: 'Chianti', from: 'R1C1', to: 'R2C1' }, // Target occupied
        { wineId: 1, wineName: 'Chianti', from: 'R1C2', to: 'R2C2' }, // Duplicate wine
        { wineId: 2, wineName: 'Barolo', from: 'R3C1', to: 'R2C2' }   // Duplicate target & source mismatch
      ];

      const result = await validateMovePlan(moves, 'test-cellar-id');

      expect(result.valid).toBe(false);
      expect(result.summary.errorCount).toBeGreaterThan(0);
      expect(result.errors.length).toBeGreaterThan(1);
    });

    it('should validate valid swap moves', async () => {
      db.prepare.mockReturnValue({
        all: vi.fn().mockResolvedValue([
          { location_code: 'R1C1', wine_id: 1 },
          { location_code: 'R1C2', wine_id: 2 }
        ])
      });

      const moves = [
        { wineId: 1, wineName: 'Chianti', from: 'R1C1', to: 'R2C1' },
        { wineId: 2, wineName: 'Barolo', from: 'R1C2', to: 'R1C1' } // Valid swap
      ];

      const result = await validateMovePlan(moves, 'test-cellar-id');

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should validate chain moves', async () => {
      db.prepare.mockReturnValue({
        all: vi.fn().mockResolvedValue([
          { location_code: 'R1C1', wine_id: 1 },
          { location_code: 'R1C2', wine_id: 2 },
          { location_code: 'R1C3', wine_id: 3 }
        ])
      });

      const moves = [
        { wineId: 1, wineName: 'Chianti', from: 'R1C1', to: 'R2C1' },    // Chain start
        { wineId: 2, wineName: 'Barolo', from: 'R1C2', to: 'R1C1' },     // Uses vacated slot
        { wineId: 3, wineName: 'Brunello', from: 'R1C3', to: 'R1C2' }    // Uses vacated slot
      ];

      const result = await validateMovePlan(moves, 'test-cellar-id');

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should provide comprehensive summary', async () => {
      db.prepare.mockReturnValue({
        all: vi.fn().mockResolvedValue([
          { location_code: 'R1C1', wine_id: 1 }
        ])
      });

      const moves = [
        { wineId: 1, wineName: 'Chianti', from: 'R1C1', to: 'R2C1' }
      ];

      const result = await validateMovePlan(moves, 'test-cellar-id');

      expect(result.summary).toHaveProperty('totalMoves', 1);
      expect(result.summary).toHaveProperty('errorCount');
      expect(result.summary).toHaveProperty('duplicateTargets');
      expect(result.summary).toHaveProperty('occupiedTargets');
      expect(result.summary).toHaveProperty('sourceMismatches');
      expect(result.summary).toHaveProperty('duplicateWines');
      expect(result.summary).toHaveProperty('noopMoves');
      expect(result.summary).toHaveProperty('zoneColourViolations');
    });
  });

  describe('Rule 6: Zone/colour policy checks', () => {
    /**
     * Helper: set up zone mocks for colour policy tests.
     * isWhiteFamily is NOT mocked — the real pure function is used, avoiding
     * mock leakage to downstream suites in --no-isolate mode.
     * @param {Object} zoneMap - Row-to-zone mapping for getActiveZoneMap
     * @param {Object} zones - zoneId → zone config for getZoneById
     */
    function setupZoneMocks(zoneMap, zones) {
      getActiveZoneMap.mockResolvedValue(zoneMap);
      getZoneById.mockImplementation(id => zones[id] || null);
    }

    it('should reject red wine moving to white-only zone row', async () => {
      // Zone map: R1 is white zone
      setupZoneMocks(
        { R1: { zoneId: 'sauvignon_blanc' } },
        { sauvignon_blanc: { id: 'sauvignon_blanc', displayName: 'Sauvignon Blanc', color: 'white' } }
      );

      // DB mock: slots (call 1) and wines (call 2)
      let callCount = 0;
      db.prepare.mockImplementation(() => ({
        all: vi.fn().mockImplementation(async () => {
          callCount++;
          if (callCount === 1) {
            // Slots query
            return [{ location_code: 'R5C1', wine_id: 1 }];
          }
          // Wines query (for colour lookup)
          return [{ id: 1, colour: 'red', color: null, wine_name: 'Cab Sauv', grapes: null, style: null }];
        })
      }));

      const moves = [
        { wineId: 1, wineName: 'Cab Sauv', from: 'R5C1', to: 'R1C3' }
      ];

      const result = await validateMovePlan(moves, 'test-cellar-id');

      expect(result.valid).toBe(false);
      expect(result.summary.zoneColourViolations).toBe(1);
      const violation = result.errors.find(e => e.type === 'zone_colour_violation');
      expect(violation).toBeDefined();
      expect(violation.wineColour).toBe('red');
      expect(violation.targetZoneId).toBe('sauvignon_blanc');
    });

    it('should reject white wine moving to red-only zone row', async () => {
      setupZoneMocks(
        { R10: { zoneId: 'cabernet_sauvignon' } },
        { cabernet_sauvignon: { id: 'cabernet_sauvignon', displayName: 'Cabernet Sauvignon', color: 'red' } }
      );

      let callCount = 0;
      db.prepare.mockImplementation(() => ({
        all: vi.fn().mockImplementation(async () => {
          callCount++;
          if (callCount === 1) return [{ location_code: 'R1C1', wine_id: 2 }];
          return [{ id: 2, colour: 'white', color: null, wine_name: 'Sauv Blanc', grapes: null, style: null }];
        })
      }));

      const moves = [
        { wineId: 2, wineName: 'Sauv Blanc', from: 'R1C1', to: 'R10C3' }
      ];

      const result = await validateMovePlan(moves, 'test-cellar-id');

      expect(result.valid).toBe(false);
      expect(result.summary.zoneColourViolations).toBe(1);
    });

    it('should allow white wine moving to white zone row', async () => {
      setupZoneMocks(
        { R1: { zoneId: 'sauvignon_blanc' } },
        { sauvignon_blanc: { id: 'sauvignon_blanc', displayName: 'Sauvignon Blanc', color: 'white' } }
      );

      let callCount = 0;
      db.prepare.mockImplementation(() => ({
        all: vi.fn().mockImplementation(async () => {
          callCount++;
          if (callCount === 1) return [{ location_code: 'R3C1', wine_id: 3 }];
          return [{ id: 3, colour: 'white', color: null, wine_name: 'Chenin', grapes: null, style: null }];
        })
      }));

      const moves = [
        { wineId: 3, wineName: 'Chenin', from: 'R3C1', to: 'R1C5' }
      ];

      const result = await validateMovePlan(moves, 'test-cellar-id');

      expect(result.summary.zoneColourViolations).toBe(0);
    });

    it('should skip zone checks when no zone allocations exist', async () => {
      getActiveZoneMap.mockResolvedValue({});

      db.prepare.mockReturnValue({
        all: vi.fn().mockResolvedValue([{ location_code: 'R1C1', wine_id: 1 }])
      });

      const moves = [
        { wineId: 1, wineName: 'Wine', from: 'R1C1', to: 'R2C1' }
      ];

      const result = await validateMovePlan(moves, 'test-cellar-id');

      expect(result.summary.zoneColourViolations).toBe(0);
    });

    it('should skip fridge target slots', async () => {
      setupZoneMocks(
        { R1: { zoneId: 'whites' } },
        { whites: { id: 'whites', displayName: 'White Wines', color: 'white' } }
      );

      db.prepare.mockReturnValue({
        all: vi.fn().mockResolvedValue([{ location_code: 'R1C1', wine_id: 1 }])
      });

      const moves = [
        { wineId: 1, wineName: 'Wine', from: 'R1C1', to: 'F3' } // Fridge slot
      ];

      const result = await validateMovePlan(moves, 'test-cellar-id');

      expect(result.summary.zoneColourViolations).toBe(0);
    });

    it('should skip fallback/buffer zones', async () => {
      setupZoneMocks(
        { R15: { zoneId: 'red_buffer' } },
        { red_buffer: { id: 'red_buffer', displayName: 'Red Buffer', color: 'red', isBufferZone: true } }
      );

      let callCount = 0;
      db.prepare.mockImplementation(() => ({
        all: vi.fn().mockImplementation(async () => {
          callCount++;
          if (callCount === 1) return [{ location_code: 'R1C1', wine_id: 1 }];
          return [{ id: 1, colour: 'white', color: null, wine_name: 'White Wine', grapes: null, style: null }];
        })
      }));

      const moves = [
        { wineId: 1, wineName: 'White Wine', from: 'R1C1', to: 'R15C1' }
      ];

      const result = await validateMovePlan(moves, 'test-cellar-id');

      // Buffer zones skip colour checks
      expect(result.summary.zoneColourViolations).toBe(0);
    });

    it('should skip wines with no determinable colour', async () => {
      setupZoneMocks(
        { R1: { zoneId: 'whites' } },
        { whites: { id: 'whites', displayName: 'White Wines', color: 'white' } }
      );

      let callCount = 0;
      db.prepare.mockImplementation(() => ({
        all: vi.fn().mockImplementation(async () => {
          callCount++;
          if (callCount === 1) return [{ location_code: 'R5C1', wine_id: 4 }];
          return [{ id: 4, colour: null, color: null, wine_name: 'Mystery Wine', grapes: null, style: null }];
        })
      }));

      const moves = [
        { wineId: 4, wineName: 'Mystery Wine', from: 'R5C1', to: 'R1C1' }
      ];

      const result = await validateMovePlan(moves, 'test-cellar-id');

      // No colour → no penalisation
      expect(result.summary.zoneColourViolations).toBe(0);
    });
  });

  describe('Edge cases', () => {
    it('should handle empty move array', async () => {
      const result = await validateMovePlan([], 'test-cellar-id');

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.summary.totalMoves).toBe(0);
    });

    it('should handle single move', async () => {
      db.prepare.mockReturnValue({
        all: vi.fn().mockResolvedValue([
          { location_code: 'R1C1', wine_id: 1 }
        ])
      });

      const moves = [
        { wineId: 1, wineName: 'Chianti', from: 'R1C1', to: 'R2C1' }
      ];

      const result = await validateMovePlan(moves, 'test-cellar-id');

      expect(result.valid).toBe(true);
      expect(result.summary.totalMoves).toBe(1);
    });

    it('should handle moves with missing wine names', async () => {
      db.prepare.mockReturnValue({
        all: vi.fn().mockResolvedValue([
          { location_code: 'R1C1', wine_id: 1 }
        ])
      });

      const moves = [
        { wineId: 1, from: 'R1C1', to: 'R2C1' } // No wineName
      ];

      const result = await validateMovePlan(moves, 'test-cellar-id');

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });
});
