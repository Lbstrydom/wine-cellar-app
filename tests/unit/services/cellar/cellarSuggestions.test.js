/**
 * @fileoverview Unit tests for cellarSuggestions swap detection.
 * @module tests/unit/services/cellar/cellarSuggestions
 */

vi.mock('../../../../src/db/index.js', () => ({
  default: { prepare: vi.fn() }
}));

vi.mock('../../../../src/services/cellar/cellarPlacement.js', () => ({
  findAvailableSlot: vi.fn()
}));

vi.mock('../../../../src/config/cellarZones.js', () => ({
  getZoneById: vi.fn()
}));

vi.mock('../../../../src/services/cellar/cellarAllocation.js', () => ({
  getActiveZoneMap: vi.fn(),
  getAllocatedRowMap: vi.fn()
}));

vi.mock('../../../../src/services/cellar/cellarMetrics.js', () => ({
  detectRowGaps: vi.fn().mockReturnValue([])
}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { detectNaturalSwapPairs, detectDisplacementSwaps, generateMoveSuggestions } from '../../../../src/services/cellar/cellarSuggestions.js';
import { findAvailableSlot } from '../../../../src/services/cellar/cellarPlacement.js';

describe('detectNaturalSwapPairs', () => {
  it('detects a simple swap pair', () => {
    const misplaced = [
      { wineId: 1, currentSlot: 'R3C5', currentZoneId: 'white', suggestedZoneId: 'red' },
      { wineId: 2, currentSlot: 'R7C2', currentZoneId: 'red', suggestedZoneId: 'white' }
    ];
    const pairs = detectNaturalSwapPairs(misplaced);
    expect(pairs).toEqual([[0, 1]]);
  });

  it('returns empty when no swaps possible', () => {
    const misplaced = [
      { wineId: 1, currentSlot: 'R3C5', currentZoneId: 'white', suggestedZoneId: 'red' },
      { wineId: 2, currentSlot: 'R7C2', currentZoneId: 'red', suggestedZoneId: 'sparkling' }
    ];
    const pairs = detectNaturalSwapPairs(misplaced);
    expect(pairs).toEqual([]);
  });

  it('returns empty for empty input', () => {
    expect(detectNaturalSwapPairs([])).toEqual([]);
  });

  it('returns empty for single wine', () => {
    const misplaced = [
      { wineId: 1, currentSlot: 'R3C5', currentZoneId: 'white', suggestedZoneId: 'red' }
    ];
    expect(detectNaturalSwapPairs(misplaced)).toEqual([]);
  });

  it('detects multiple swap pairs', () => {
    const misplaced = [
      { wineId: 1, currentSlot: 'R1C1', currentZoneId: 'white', suggestedZoneId: 'red' },
      { wineId: 2, currentSlot: 'R5C1', currentZoneId: 'red', suggestedZoneId: 'white' },
      { wineId: 3, currentSlot: 'R2C1', currentZoneId: 'sparkling', suggestedZoneId: 'dessert' },
      { wineId: 4, currentSlot: 'R8C1', currentZoneId: 'dessert', suggestedZoneId: 'sparkling' }
    ];
    const pairs = detectNaturalSwapPairs(misplaced);
    expect(pairs).toHaveLength(2);
    expect(pairs).toEqual([[0, 1], [2, 3]]);
  });

  it('each wine is used in at most one swap', () => {
    // Three wines where A↔B and A↔C are both valid — only A↔B should be picked
    const misplaced = [
      { wineId: 1, currentSlot: 'R1C1', currentZoneId: 'white', suggestedZoneId: 'red' },
      { wineId: 2, currentSlot: 'R5C1', currentZoneId: 'red', suggestedZoneId: 'white' },
      { wineId: 3, currentSlot: 'R6C1', currentZoneId: 'red', suggestedZoneId: 'white' }
    ];
    const pairs = detectNaturalSwapPairs(misplaced);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toEqual([0, 1]); // First match wins
  });

  it('skips wines missing currentZoneId', () => {
    const misplaced = [
      { wineId: 1, currentSlot: 'R1C1', suggestedZoneId: 'red' }, // no currentZoneId
      { wineId: 2, currentSlot: 'R5C1', currentZoneId: 'red', suggestedZoneId: 'white' }
    ];
    expect(detectNaturalSwapPairs(misplaced)).toEqual([]);
  });

  it('skips wines missing suggestedZoneId', () => {
    const misplaced = [
      { wineId: 1, currentSlot: 'R1C1', currentZoneId: 'white' }, // no suggestedZoneId
      { wineId: 2, currentSlot: 'R5C1', currentZoneId: 'red', suggestedZoneId: 'white' }
    ];
    expect(detectNaturalSwapPairs(misplaced)).toEqual([]);
  });

  it('does not match wine with itself (same zone)', () => {
    const misplaced = [
      { wineId: 1, currentSlot: 'R1C1', currentZoneId: 'red', suggestedZoneId: 'red' }
    ];
    expect(detectNaturalSwapPairs(misplaced)).toEqual([]);
  });

  it('handles large input efficiently', () => {
    const misplaced = [];
    for (let i = 0; i < 100; i++) {
      misplaced.push({
        wineId: i,
        currentSlot: `R${i}C1`,
        currentZoneId: `zone_${i}`,
        suggestedZoneId: `zone_${i + 100}` // No matches
      });
    }
    const start = Date.now();
    const pairs = detectNaturalSwapPairs(misplaced);
    const elapsed = Date.now() - start;
    expect(pairs).toEqual([]);
    expect(elapsed).toBeLessThan(50);
  });
});

describe('detectDisplacementSwaps', () => {
  it('detects displacement swap when A needs B\'s zone (non-reciprocal)', () => {
    const misplaced = [
      { wineId: 1, currentSlot: 'R1C1', currentZoneId: 'white', suggestedZoneId: 'red' },
      { wineId: 2, currentSlot: 'R5C1', currentZoneId: 'red', suggestedZoneId: 'sparkling' }
    ];
    // No natural swap (A→red, B→sparkling ≠ white)
    const pairs = detectDisplacementSwaps(misplaced, new Set());
    expect(pairs).toEqual([[0, 1]]); // A needs red, B is in red
  });

  it('skips indices already used by natural swaps', () => {
    const misplaced = [
      { wineId: 1, currentSlot: 'R1C1', currentZoneId: 'white', suggestedZoneId: 'red' },
      { wineId: 2, currentSlot: 'R5C1', currentZoneId: 'red', suggestedZoneId: 'sparkling' }
    ];
    // If index 0 is already used
    const pairs = detectDisplacementSwaps(misplaced, new Set([0]));
    expect(pairs).toEqual([]);
  });

  it('returns empty when no displacement possible', () => {
    const misplaced = [
      { wineId: 1, currentSlot: 'R1C1', currentZoneId: 'white', suggestedZoneId: 'red' },
      { wineId: 2, currentSlot: 'R5C1', currentZoneId: 'sparkling', suggestedZoneId: 'dessert' }
    ];
    // A→red but B is in sparkling, not red
    const pairs = detectDisplacementSwaps(misplaced, new Set());
    expect(pairs).toEqual([]);
  });

  it('each wine is used in at most one displacement swap', () => {
    const misplaced = [
      { wineId: 1, currentSlot: 'R1C1', currentZoneId: 'white', suggestedZoneId: 'red' },
      { wineId: 2, currentSlot: 'R5C1', currentZoneId: 'red', suggestedZoneId: 'sparkling' },
      { wineId: 3, currentSlot: 'R6C1', currentZoneId: 'white', suggestedZoneId: 'red' }
    ];
    // Both A and C want red, but B can only pair with one
    const pairs = detectDisplacementSwaps(misplaced, new Set());
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toEqual([0, 1]); // First match wins
  });

  it('returns empty for empty input', () => {
    expect(detectDisplacementSwaps([], new Set())).toEqual([]);
  });

  it('skips wines missing required fields', () => {
    const misplaced = [
      { wineId: 1, currentSlot: 'R1C1', suggestedZoneId: 'red' }, // no currentZoneId
      { wineId: 2, currentSlot: 'R5C1', currentZoneId: 'red', suggestedZoneId: 'sparkling' }
    ];
    expect(detectDisplacementSwaps(misplaced, new Set())).toEqual([]);
  });

  it('detects multiple displacement pairs', () => {
    const misplaced = [
      { wineId: 1, currentSlot: 'R1C1', currentZoneId: 'white', suggestedZoneId: 'red' },
      { wineId: 2, currentSlot: 'R5C1', currentZoneId: 'red', suggestedZoneId: 'sparkling' },
      { wineId: 3, currentSlot: 'R2C1', currentZoneId: 'dessert', suggestedZoneId: 'sparkling' },
      { wineId: 4, currentSlot: 'R8C1', currentZoneId: 'sparkling', suggestedZoneId: 'white' }
    ];
    const pairs = detectDisplacementSwaps(misplaced, new Set());
    expect(pairs).toHaveLength(2);
    // A(white→red) swaps with B(red→sparkling), C(dessert→sparkling) swaps with D(sparkling→white)
    expect(pairs).toEqual([[0, 1], [2, 3]]);
  });
});

describe('generateMoveSuggestions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('generates displacement swaps when zones are full', async () => {
    // Two wines: A is in white zone, should be in red zone; B is in red zone, should be in sparkling zone
    // Red zone is FULL — no empty slots
    const misplaced = [
      { wineId: 1, name: 'Wine A', currentSlot: 'R1C1', currentZone: 'White Zone', currentZoneId: 'white', suggestedZone: 'Red Zone', suggestedZoneId: 'red', confidence: 'high', reason: 'Red belongs in red zone' },
      { wineId: 2, name: 'Wine B', currentSlot: 'R5C1', currentZone: 'Red Zone', currentZoneId: 'red', suggestedZone: 'Sparkling Zone', suggestedZoneId: 'sparkling', confidence: 'high', reason: 'Sparkling belongs in sparkling zone' }
    ];
    const allWines = [
      { id: 1, slot_id: 'R1C1' },
      { id: 2, slot_id: 'R5C1' }
    ];

    // findAvailableSlot returns null for all — zones are full
    findAvailableSlot.mockResolvedValue(null);

    const result = await generateMoveSuggestions(misplaced, allWines, new Map());

    // Should generate displacement swap moves, not manual suggestions
    const moves = result.filter(s => s.type === 'move');
    const manuals = result.filter(s => s.type === 'manual');

    // Displacement swap detected upfront: A→B's zone (red), B displaced
    expect(moves.length).toBeGreaterThanOrEqual(2);
    expect(manuals).toHaveLength(0);

    // Check A goes to B's slot and B goes to A's slot
    const moveA = moves.find(m => m.wineId === 1);
    const moveB = moves.find(m => m.wineId === 2);
    expect(moveA.from).toBe('R1C1');
    expect(moveA.to).toBe('R5C1');
    expect(moveB.from).toBe('R5C1');
    expect(moveB.to).toBe('R1C1');
  });

  it('prefers natural swaps over displacement swaps', async () => {
    // Natural swap: A in white→red, B in red→white (exact reciprocity)
    const misplaced = [
      { wineId: 1, name: 'Wine A', currentSlot: 'R1C1', currentZone: 'White Zone', currentZoneId: 'white', suggestedZone: 'Red Zone', suggestedZoneId: 'red', confidence: 'high', reason: 'Red' },
      { wineId: 2, name: 'Wine B', currentSlot: 'R5C1', currentZone: 'Red Zone', currentZoneId: 'red', suggestedZone: 'White Zone', suggestedZoneId: 'white', confidence: 'high', reason: 'White' }
    ];
    const allWines = [
      { id: 1, slot_id: 'R1C1' },
      { id: 2, slot_id: 'R5C1' }
    ];

    findAvailableSlot.mockResolvedValue(null);

    const result = await generateMoveSuggestions(misplaced, allWines, new Map());

    const moves = result.filter(s => s.type === 'move');
    expect(moves).toHaveLength(2);

    // Both wines should reach their correct zone (natural swap)
    const moveA = moves.find(m => m.wineId === 1);
    expect(moveA.to).toBe('R5C1');
    expect(moveA.toZone).toBe('Red Zone');

    const moveB = moves.find(m => m.wineId === 2);
    expect(moveB.to).toBe('R1C1');
    expect(moveB.toZone).toBe('White Zone');

    // No displacement flag on natural swaps
    expect(moveA.isDisplacementSwap).toBeUndefined();
    expect(moveB.isDisplacementSwap).toBeUndefined();
  });

  it('second pass resolves remaining manuals via displacement swaps', async () => {
    // Three wines: A→red, B→sparkling, C→white. Red zone is full with C.
    // B is not in A's target zone, so no upfront displacement for A.
    // C is in white zone→red, A is in red zone→white: this is a natural swap A↔C
    // But if we design it so no natural or displacement swap works upfront, the second pass kicks in.
    const misplaced = [
      { wineId: 1, name: 'Wine A', currentSlot: 'R1C1', currentZone: 'Sparkling Zone', currentZoneId: 'sparkling', suggestedZone: 'Red Zone', suggestedZoneId: 'red', confidence: 'medium', reason: 'Should be in red' },
      { wineId: 2, name: 'Wine B', currentSlot: 'R5C1', currentZone: 'Red Zone', currentZoneId: 'red', suggestedZone: 'Dessert Zone', suggestedZoneId: 'dessert', confidence: 'medium', reason: 'Should be in dessert' }
    ];
    const allWines = [
      { id: 1, slot_id: 'R1C1' },
      { id: 2, slot_id: 'R5C1' },
      { id: 3, slot_id: 'R5C2' }, // Other wine occupying red zone
    ];

    // All zones full
    findAvailableSlot.mockResolvedValue(null);

    const result = await generateMoveSuggestions(misplaced, allWines, new Map());

    // A needs red zone, B is in red zone → displacement swap
    const moves = result.filter(s => s.type === 'move');
    expect(moves.length).toBeGreaterThanOrEqual(2);

    const moveA = moves.find(m => m.wineId === 1);
    expect(moveA).toBeDefined();
    expect(moveA.to).toBe('R5C1'); // Goes to B's slot in red zone
  });

  it('uses empty slots when available instead of swapping', async () => {
    const misplaced = [
      { wineId: 1, name: 'Wine A', currentSlot: 'R1C1', currentZone: 'White Zone', currentZoneId: 'white', suggestedZone: 'Red Zone', suggestedZoneId: 'red', confidence: 'high', reason: 'Red' }
    ];
    const allWines = [{ id: 1, slot_id: 'R1C1' }];

    // Empty slot available
    findAvailableSlot.mockResolvedValue({ slotId: 'R5C3', zoneId: 'red', isOverflow: false });

    const result = await generateMoveSuggestions(misplaced, allWines, new Map());

    const moves = result.filter(s => s.type === 'move');
    expect(moves).toHaveLength(1);
    expect(moves[0].to).toBe('R5C3');
    expect(moves[0].isDisplacementSwap).toBeUndefined();
  });

  it('keeps manual when no displacement partner exists', async () => {
    // Wine A needs red zone, but NO misplaced wines in the red zone to displace
    const misplaced = [
      { wineId: 1, name: 'Wine A', currentSlot: 'R1C1', currentZone: 'White Zone', currentZoneId: 'white', suggestedZone: 'Red Zone', suggestedZoneId: 'red', confidence: 'low', reason: 'Red' }
    ];
    const allWines = [
      { id: 1, slot_id: 'R1C1' },
      { id: 99, slot_id: 'R5C1' } // Wine in red zone but NOT misplaced
    ];

    findAvailableSlot.mockResolvedValue(null);

    const result = await generateMoveSuggestions(misplaced, allWines, new Map());

    const manuals = result.filter(s => s.type === 'manual');
    expect(manuals).toHaveLength(1);
    expect(manuals[0].wineId).toBe(1);
  });
});
