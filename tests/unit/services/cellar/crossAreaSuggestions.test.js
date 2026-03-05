/**
 * @fileoverview Unit tests for generateCrossAreaSuggestions (Phase 3.2).
 * Pure function — no DB mocks needed.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../../src/db/index.js', () => ({ default: { prepare: vi.fn() } }));
vi.mock('../../../../src/services/cellar/cellarLayout.js', () => ({
  getStorageAreasByType: vi.fn().mockResolvedValue({})
}));

import { generateCrossAreaSuggestions } from '../../../../src/services/cellar/fridgeStocking.js';

const CURRENT_YEAR = new Date().getFullYear();

function makeCellarWine(id, name, drinkByYear, slot = `R1C${id}`) {
  return {
    id,
    wine_name: name,
    vintage: drinkByYear ? drinkByYear - 5 : null,
    slot_id: slot,
    location_code: null,
    drink_by_year: drinkByYear || null,
    drink_until: null
  };
}

function makeFridgeWine(id, name, drinkByYear, slot = `F${id}`) {
  return {
    id,
    wine_name: name,
    vintage: drinkByYear ? drinkByYear - 5 : null,
    slot_id: slot,
    location_code: null,
    drink_by_year: drinkByYear || null,
    drink_until: null
  };
}

function makeFridgeStatus({ emptySlots = 2, hasGaps = false } = {}) {
  return { emptySlots, hasGaps, occupied: 5, capacity: 9 };
}

describe('generateCrossAreaSuggestions', () => {
  it('returns empty array when no wines near window and fridge has no gaps', () => {
    const wines = [
      makeCellarWine(1, 'Long-ager', CURRENT_YEAR + 10),
      makeCellarWine(2, 'Another', CURRENT_YEAR + 7)
    ];
    const result = generateCrossAreaSuggestions(wines, makeFridgeStatus());
    expect(result).toHaveLength(0);
  });

  it('suggests cellar→fridge for wine at drinking window (yearsLeft = 0)', () => {
    const wines = [makeCellarWine(1, 'Pinot', CURRENT_YEAR)];
    const result = generateCrossAreaSuggestions(wines, makeFridgeStatus({ emptySlots: 2 }));
    expect(result).toHaveLength(1);
    expect(result[0].direction).toBe('cellar_to_fridge');
    expect(result[0].wineId).toBe(1);
    expect(result[0].reason).toMatch(/past optimal/i);
  });

  it('suggests cellar→fridge for wine 1 year past window', () => {
    const wines = [makeCellarWine(1, 'Rioja', CURRENT_YEAR - 1)];
    const result = generateCrossAreaSuggestions(wines, makeFridgeStatus({ emptySlots: 2 }));
    expect(result).toHaveLength(1);
    expect(result[0].direction).toBe('cellar_to_fridge');
  });

  it('does NOT suggest cellar→fridge when fridge is full', () => {
    const wines = [makeCellarWine(1, 'Pinot', CURRENT_YEAR)];
    const result = generateCrossAreaSuggestions(wines, makeFridgeStatus({ emptySlots: 0 }));
    expect(result).toHaveLength(0);
  });

  it('does NOT suggest cellar→fridge for wines more than 2 years past window', () => {
    const wines = [makeCellarWine(1, 'Oxidised', CURRENT_YEAR - 3)];
    const result = generateCrossAreaSuggestions(wines, makeFridgeStatus({ emptySlots: 2 }));
    expect(result).toHaveLength(0);
  });

  it('does NOT suggest cellar→fridge for future wines (yearsLeft > 0)', () => {
    const wines = [makeCellarWine(1, 'Young', CURRENT_YEAR + 5)];
    const result = generateCrossAreaSuggestions(wines, makeFridgeStatus({ emptySlots: 2 }));
    expect(result).toHaveLength(0);
  });

  it('suggests fridge→cellar for long-term wine when fridge is full with gaps', () => {
    const wines = [makeFridgeWine(1, 'Long-term', CURRENT_YEAR + 10)];
    const result = generateCrossAreaSuggestions(
      wines,
      makeFridgeStatus({ emptySlots: 0, hasGaps: true })
    );
    expect(result).toHaveLength(1);
    expect(result[0].direction).toBe('fridge_to_cellar');
    expect(result[0].wineId).toBe(1);
  });

  it('does NOT suggest fridge→cellar when fridge has empty slots', () => {
    const wines = [makeFridgeWine(1, 'Long-term', CURRENT_YEAR + 10)];
    const result = generateCrossAreaSuggestions(
      wines,
      makeFridgeStatus({ emptySlots: 1, hasGaps: true })
    );
    // fridge_to_cellar requires emptySlots <= 0
    const fridgeToCellar = result.filter(s => s.direction === 'fridge_to_cellar');
    expect(fridgeToCellar).toHaveLength(0);
  });

  it('does NOT suggest fridge→cellar for wines ≤ 3 years away', () => {
    const wines = [makeFridgeWine(1, 'Nearly ready', CURRENT_YEAR + 3)];
    const result = generateCrossAreaSuggestions(
      wines,
      makeFridgeStatus({ emptySlots: 0, hasGaps: true })
    );
    expect(result.filter(s => s.direction === 'fridge_to_cellar')).toHaveLength(0);
  });

  it('never suggests moves to full storage areas (property)', () => {
    const wines = [
      makeCellarWine(1, 'A', CURRENT_YEAR),
      makeCellarWine(2, 'B', CURRENT_YEAR - 1),
      makeFridgeWine(3, 'C', CURRENT_YEAR + 10)
    ];
    // Fridge full, no gaps → no cellar_to_fridge moves
    const result = generateCrossAreaSuggestions(wines, makeFridgeStatus({ emptySlots: 0, hasGaps: false }));
    const toFridge = result.filter(s => s.direction === 'cellar_to_fridge');
    expect(toFridge).toHaveLength(0);
  });

  it('results are sorted by priority ascending', () => {
    const wines = [
      makeCellarWine(1, 'Pinot', CURRENT_YEAR),
      makeFridgeWine(2, 'Long-term', CURRENT_YEAR + 10)
    ];
    const result = generateCrossAreaSuggestions(
      wines,
      makeFridgeStatus({ emptySlots: 2, hasGaps: true })
    );
    for (let i = 1; i < result.length; i++) {
      expect(result[i].priority).toBeGreaterThanOrEqual(result[i - 1].priority);
    }
  });

  it('ignores wines with no drinkByYear', () => {
    const wines = [makeCellarWine(1, 'Unknown', null)];
    const result = generateCrossAreaSuggestions(wines, makeFridgeStatus({ emptySlots: 2 }));
    expect(result).toHaveLength(0);
  });
});
