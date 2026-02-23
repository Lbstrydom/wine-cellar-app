/**
 * @fileoverview Unit tests for fridge swap logic.
 * @module tests/unit/cellarAnalysis/fridgeSwap.test
 */

// Mock browser APIs and module dependencies before imports
vi.mock('../../../public/js/api.js', () => ({
  executeCellarMoves: vi.fn(),
  getFridgeOrganization: vi.fn()
}));
vi.mock('../../../public/js/utils.js', () => ({
  showToast: vi.fn(),
  escapeHtml: vi.fn(s => s)
}));
vi.mock('../../../public/js/app.js', () => ({
  refreshLayout: vi.fn()
}));
vi.mock('../../../public/js/cellarAnalysis/state.js', () => ({
  getCurrentAnalysis: vi.fn()
}));
vi.mock('../../../public/js/cellarAnalysis/analysis.js', () => ({
  loadAnalysis: vi.fn()
}));

// Stub document for DOM-dependent code
vi.stubGlobal('document', {
  getElementById: vi.fn(() => null),
  querySelector: vi.fn(() => null)
});

import {
  identifySwapTarget,
  computeUrgency,
  buildSwapOutReason,
  findEmptyFridgeSlot
} from '../../../public/js/cellarAnalysis/fridge.js';

// Clean up module-scope vi.stubGlobal('document') to prevent leaking
// into downstream test files in --no-isolate mode.
afterAll(() => {
  vi.unstubAllGlobals();
});

describe('computeUrgency', () => {
  it('should return 2 for null drinkByYear', () => {
    expect(computeUrgency(null)).toBe(2);
  });

  it('should return 2 for undefined drinkByYear', () => {
    expect(computeUrgency(undefined)).toBe(2);
  });

  it('should return 10 for past-due wines (yearsLeft <= 0)', () => {
    const currentYear = new Date().getFullYear();
    expect(computeUrgency(currentYear)).toBe(10);
    expect(computeUrgency(currentYear - 1)).toBe(10);
  });

  it('should return 7 for wines within 2 years', () => {
    const currentYear = new Date().getFullYear();
    expect(computeUrgency(currentYear + 1)).toBe(7);
    expect(computeUrgency(currentYear + 2)).toBe(7);
  });

  it('should return 4 for wines within 5 years', () => {
    const currentYear = new Date().getFullYear();
    expect(computeUrgency(currentYear + 3)).toBe(4);
    expect(computeUrgency(currentYear + 5)).toBe(4);
  });

  it('should return 1 for wines beyond 5 years', () => {
    const currentYear = new Date().getFullYear();
    expect(computeUrgency(currentYear + 6)).toBe(1);
    expect(computeUrgency(currentYear + 20)).toBe(1);
  });
});

describe('identifySwapTarget', () => {
  it('should return null when no fridge wines', () => {
    const result = identifySwapTarget(
      { wines: [], parLevelGaps: {} },
      { wineId: 1 }
    );
    expect(result).toBeNull();
  });

  it('should exclude the candidate itself from swap targets', () => {
    const fridgeStatus = {
      wines: [{ wineId: 1, slot: 'F1', category: 'crispWhite', drinkByYear: 2030 }],
      parLevelGaps: {}
    };
    const result = identifySwapTarget(fridgeStatus, { wineId: 1 });
    expect(result).toBeNull();
  });

  it('should prefer swapping out wines that do not fill a gap category', () => {
    const currentYear = new Date().getFullYear();
    const fridgeStatus = {
      wines: [
        { wineId: 10, slot: 'F1', category: 'crispWhite', drinkByYear: currentYear + 1 },
        { wineId: 11, slot: 'F2', category: 'sparkling', drinkByYear: currentYear + 1 }
      ],
      parLevelGaps: { crispWhite: { need: 1 } } // crispWhite has a gap — should keep it
    };
    const result = identifySwapTarget(fridgeStatus, { wineId: 99 });
    expect(result.wineId).toBe(11); // sparkling has no gap, so swap it out
  });

  it('should prefer lowest urgency when gap status is equal', () => {
    const currentYear = new Date().getFullYear();
    const fridgeStatus = {
      wines: [
        { wineId: 10, slot: 'F1', category: 'sparkling', drinkByYear: currentYear + 1 },  // urgency 7
        { wineId: 11, slot: 'F2', category: 'rose', drinkByYear: currentYear + 10 }        // urgency 1
      ],
      parLevelGaps: {} // no gaps — both equally non-gap-filling
    };
    const result = identifySwapTarget(fridgeStatus, { wineId: 99 });
    expect(result.wineId).toBe(11); // lowest urgency = best swap-out candidate
  });

  it('should handle wines with no drinkByYear', () => {
    const fridgeStatus = {
      wines: [
        { wineId: 10, slot: 'F1', category: 'sparkling', drinkByYear: null },
        { wineId: 11, slot: 'F2', category: 'rose', drinkByYear: null }
      ],
      parLevelGaps: {}
    };
    const result = identifySwapTarget(fridgeStatus, { wineId: 99 });
    expect(result).toBeDefined();
    expect(result.wineId).toBe(10); // same urgency (2), stable sort picks first
  });
});

describe('buildSwapOutReason', () => {
  it('should handle no drinkByYear', () => {
    const reason = buildSwapOutReason({ drinkByYear: null });
    expect(reason).toContain('stores well');
  });

  it('should handle far-future drinkByYear', () => {
    const currentYear = new Date().getFullYear();
    const reason = buildSwapOutReason({ drinkByYear: currentYear + 10 });
    expect(reason).toContain('plenty of time');
  });

  it('should handle medium-term drinkByYear', () => {
    const currentYear = new Date().getFullYear();
    const reason = buildSwapOutReason({ drinkByYear: currentYear + 4 });
    expect(reason).toContain('can wait');
  });

  it('should handle approaching drinkByYear', () => {
    const currentYear = new Date().getFullYear();
    const reason = buildSwapOutReason({ drinkByYear: currentYear + 1 });
    expect(reason).toContain('approaching');
  });
});

describe('findEmptyFridgeSlot', () => {
  it('should return F1 when fridge is empty', () => {
    expect(findEmptyFridgeSlot({ wines: [] })).toBe('F1');
  });

  it('should return first available slot', () => {
    const fridgeStatus = {
      wines: [
        { slot: 'F1' },
        { slot: 'F2' },
        { slot: 'F3' }
      ]
    };
    expect(findEmptyFridgeSlot(fridgeStatus)).toBe('F4');
  });

  it('should return null when fridge is full', () => {
    const fridgeStatus = {
      wines: ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9'].map(s => ({ slot: s }))
    };
    expect(findEmptyFridgeSlot(fridgeStatus)).toBeNull();
  });

  it('should handle missing wines array', () => {
    expect(findEmptyFridgeSlot({})).toBe('F1');
  });

  it('should find gaps in the middle', () => {
    const fridgeStatus = {
      wines: [
        { slot: 'F1' },
        { slot: 'F3' },
        { slot: 'F5' }
      ]
    };
    expect(findEmptyFridgeSlot(fridgeStatus)).toBe('F2');
  });
});
