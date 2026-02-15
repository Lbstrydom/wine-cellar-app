/**
 * @fileoverview Unit tests for cellarSuggestions swap detection.
 * @module tests/unit/services/cellar/cellarSuggestions
 */

vi.mock('../../../../src/db/index.js', () => ({
  default: { prepare: vi.fn() }
}));

import { describe, it, expect } from 'vitest';
import { detectNaturalSwapPairs } from '../../../../src/services/cellar/cellarSuggestions.js';

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
