/**
 * @fileoverview Unit tests for dynamic fridge par-level allocation.
 * @module tests/unit/services/cellar/fridgeAllocator.test
 */

vi.mock('../../../../src/db/index.js', () => ({
  default: { prepare: vi.fn() }
}));

import {
  computeParLevels,
  countInventoryByCategory,
  getEligibleCategories,
  sortFridgeAreasByPriority
} from '../../../../src/services/cellar/fridgeAllocator.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeWine({ colour = 'white', grapes = '', name = 'Test Wine', style = '' } = {}) {
  return { colour, grapes, wine_name: name, style, winemaking: '' };
}

function totalSlots(parLevels) {
  return Object.values(parLevels).reduce((sum, v) => sum + v.min, 0);
}

// ---------------------------------------------------------------------------
// getEligibleCategories
// ---------------------------------------------------------------------------

describe('getEligibleCategories', () => {
  it('wine_fridge includes chillableRed and textureWhite', () => {
    const cats = getEligibleCategories('wine_fridge');
    expect(cats).toContain('chillableRed');
    expect(cats).toContain('textureWhite');
  });

  it('kitchen_fridge excludes chillableRed and textureWhite', () => {
    const cats = getEligibleCategories('kitchen_fridge');
    expect(cats).not.toContain('chillableRed');
    expect(cats).not.toContain('textureWhite');
  });

  it('kitchen_fridge includes sparkling, crispWhite, aromaticWhite, rose', () => {
    const cats = getEligibleCategories('kitchen_fridge');
    expect(cats).toContain('sparkling');
    expect(cats).toContain('crispWhite');
    expect(cats).toContain('aromaticWhite');
    expect(cats).toContain('rose');
  });

  it('does not include flex (handled separately)', () => {
    expect(getEligibleCategories('wine_fridge')).not.toContain('flex');
    expect(getEligibleCategories('kitchen_fridge')).not.toContain('flex');
  });
});

// ---------------------------------------------------------------------------
// countInventoryByCategory
// ---------------------------------------------------------------------------

describe('countInventoryByCategory', () => {
  it('counts sparkling wines', () => {
    const wines = [
      makeWine({ colour: 'sparkling' }),
      makeWine({ name: 'Graham Beck MCC', colour: 'white' })
    ];
    const counts = countInventoryByCategory(wines);
    expect(counts.sparkling).toBe(2);
  });

  it('counts chillable red (pinot noir)', () => {
    const wines = [makeWine({ colour: 'red', grapes: 'pinot noir' })];
    const counts = countInventoryByCategory(wines);
    expect(counts.chillableRed).toBe(1);
  });

  it('returns 0 for categories with no matching wines', () => {
    const wines = [makeWine({ colour: 'white', grapes: 'sauvignon blanc' })];
    const counts = countInventoryByCategory(wines);
    expect(counts.chillableRed).toBe(0);
    expect(counts.sparkling).toBe(0);
  });

  it('does not count flex in inventory totals', () => {
    const wines = [makeWine({ colour: 'white', grapes: 'sauvignon blanc' })];
    const counts = countInventoryByCategory(wines);
    expect(counts.flex).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// computeParLevels — basic allocation
// ---------------------------------------------------------------------------

describe('computeParLevels — basic allocation', () => {
  it('total slots (including flex) equals capacity', () => {
    const inventory = { sparkling: 3, crispWhite: 6, aromaticWhite: 2, textureWhite: 2, rose: 2, chillableRed: 2, dessertFortified: 0 };
    const parLevels = computeParLevels(inventory, 'wine_fridge', 9);
    expect(totalSlots(parLevels)).toBe(9);
  });

  it('flex gets at least 1 slot on any capacity', () => {
    const inventory = { sparkling: 4, crispWhite: 4, aromaticWhite: 0, textureWhite: 0, rose: 0, chillableRed: 0, dessertFortified: 0 };
    const parLevels = computeParLevels(inventory, 'wine_fridge', 5);
    expect(parLevels.flex.min).toBeGreaterThanOrEqual(1);
  });

  it('flex is 10% of capacity (rounded down), min 1', () => {
    const inventory = { sparkling: 5, crispWhite: 5, aromaticWhite: 2, textureWhite: 2, rose: 2, chillableRed: 2, dessertFortified: 0 };
    const parLevels = computeParLevels(inventory, 'wine_fridge', 24);
    // 10% of 24 = 2.4 → floor = 2
    expect(parLevels.flex.min).toBe(2);
  });

  it('category with zero stock gets 0 slots', () => {
    const inventory = { sparkling: 0, crispWhite: 4, aromaticWhite: 0, textureWhite: 0, rose: 0, chillableRed: 0, dessertFortified: 0 };
    const parLevels = computeParLevels(inventory, 'wine_fridge', 9);
    expect(parLevels.sparkling.min).toBe(0);
  });

  it('category with stock gets at least 1 slot (min-1 guarantee)', () => {
    const inventory = { sparkling: 1, crispWhite: 100, aromaticWhite: 0, textureWhite: 0, rose: 0, chillableRed: 0, dessertFortified: 0 };
    const parLevels = computeParLevels(inventory, 'wine_fridge', 9);
    expect(parLevels.sparkling.min).toBeGreaterThanOrEqual(1);
  });

  it('kitchen_fridge does not include chillableRed or textureWhite', () => {
    const inventory = { sparkling: 2, crispWhite: 4, aromaticWhite: 2, textureWhite: 2, rose: 2, chillableRed: 4, dessertFortified: 0 };
    const parLevels = computeParLevels(inventory, 'kitchen_fridge', 6);
    expect(parLevels.chillableRed).toBeUndefined();
    expect(parLevels.textureWhite).toBeUndefined();
  });

  it('kitchen_fridge total slots equals capacity', () => {
    const inventory = { sparkling: 2, crispWhite: 4, aromaticWhite: 2, textureWhite: 0, rose: 2, chillableRed: 0, dessertFortified: 0 };
    const parLevels = computeParLevels(inventory, 'kitchen_fridge', 6);
    expect(totalSlots(parLevels)).toBe(6);
  });

  it('proportional: category with more stock gets more slots', () => {
    const inventory = { sparkling: 0, crispWhite: 10, aromaticWhite: 2, textureWhite: 0, rose: 0, chillableRed: 0, dessertFortified: 0 };
    const parLevels = computeParLevels(inventory, 'wine_fridge', 9);
    expect(parLevels.crispWhite.min).toBeGreaterThan(parLevels.aromaticWhite.min);
  });

  it('all eligible categories have priority and description fields', () => {
    const inventory = { sparkling: 2, crispWhite: 4, aromaticWhite: 2, textureWhite: 2, rose: 2, chillableRed: 2, dessertFortified: 0 };
    const parLevels = computeParLevels(inventory, 'wine_fridge', 9);
    for (const [, level] of Object.entries(parLevels)) {
      expect(typeof level.priority).toBe('number');
      expect(typeof level.description).toBe('string');
      expect(typeof level.min).toBe('number');
    }
  });
});

// ---------------------------------------------------------------------------
// computeParLevels — global stock cap (priorAllocations)
// ---------------------------------------------------------------------------

describe('computeParLevels — global stock cap via priorAllocations', () => {
  it('prior allocation reduces available stock for subsequent areas', () => {
    // 3 crisp whites total; first area already targeted 2
    const inventory = { sparkling: 0, crispWhite: 3, aromaticWhite: 0, textureWhite: 0, rose: 0, chillableRed: 0, dessertFortified: 0 };
    const prior = { crispWhite: 2 };
    const parLevels = computeParLevels(inventory, 'wine_fridge', 9, prior);
    // Only 1 crispWhite remaining after prior allocation
    expect(parLevels.crispWhite.min).toBeLessThanOrEqual(1);
  });

  it('category with zero remaining stock (fully prior-allocated) gets 0 slots', () => {
    const inventory = { sparkling: 2, crispWhite: 2, aromaticWhite: 0, textureWhite: 0, rose: 0, chillableRed: 0, dessertFortified: 0 };
    const prior = { crispWhite: 2 }; // all crisp white already allocated
    const parLevels = computeParLevels(inventory, 'wine_fridge', 9, prior);
    expect(parLevels.crispWhite.min).toBe(0);
  });

  it('total slots still equals capacity even with prior allocations reducing some cats', () => {
    const inventory = { sparkling: 4, crispWhite: 4, aromaticWhite: 2, textureWhite: 2, rose: 2, chillableRed: 2, dessertFortified: 0 };
    const prior = { crispWhite: 3, chillableRed: 2 };
    const parLevels = computeParLevels(inventory, 'wine_fridge', 9, prior);
    expect(totalSlots(parLevels)).toBe(9);
  });
});

// ---------------------------------------------------------------------------
// sortFridgeAreasByPriority
// ---------------------------------------------------------------------------

describe('sortFridgeAreasByPriority', () => {
  it('wine_fridge comes before kitchen_fridge', () => {
    const areas = [
      { id: 1, storage_type: 'kitchen_fridge', capacity: 6 },
      { id: 2, storage_type: 'wine_fridge', capacity: 9 }
    ];
    const sorted = sortFridgeAreasByPriority(areas);
    expect(sorted[0].storage_type).toBe('wine_fridge');
    expect(sorted[1].storage_type).toBe('kitchen_fridge');
  });

  it('does not mutate the original array', () => {
    const areas = [
      { id: 1, storage_type: 'kitchen_fridge', capacity: 6 },
      { id: 2, storage_type: 'wine_fridge', capacity: 9 }
    ];
    sortFridgeAreasByPriority(areas);
    expect(areas[0].storage_type).toBe('kitchen_fridge'); // unchanged
  });

  it('within same type, larger capacity comes first', () => {
    const areas = [
      { id: 1, storage_type: 'wine_fridge', capacity: 9 },
      { id: 2, storage_type: 'wine_fridge', capacity: 24 }
    ];
    const sorted = sortFridgeAreasByPriority(areas);
    expect(sorted[0].capacity).toBe(24);
    expect(sorted[1].capacity).toBe(9);
  });

  it('within same type and capacity, lower ID comes first', () => {
    const areas = [
      { id: 5, storage_type: 'wine_fridge', capacity: 9 },
      { id: 2, storage_type: 'wine_fridge', capacity: 9 }
    ];
    const sorted = sortFridgeAreasByPriority(areas);
    expect(sorted[0].id).toBe(2);
  });

  it('single area is returned unchanged', () => {
    const areas = [{ id: 1, storage_type: 'wine_fridge', capacity: 9 }];
    expect(sortFridgeAreasByPriority(areas)).toHaveLength(1);
  });
});
