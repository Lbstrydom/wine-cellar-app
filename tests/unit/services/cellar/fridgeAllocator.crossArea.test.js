/**
 * @fileoverview Unit tests for multi-area coordination: slot reservation,
 * transfer detection, and conflicting-advice prevention.
 * @module tests/unit/services/cellar/fridgeAllocator.crossArea.test
 */

vi.mock('../../../../src/db/index.js', () => ({
  default: { prepare: vi.fn() }
}));

import {
  detectFridgeTransfers,
  getAvailableCandidates
} from '../../../../src/services/cellar/fridgeAllocator.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeWine({ id, colour = 'white', grapes = '', name = 'Wine', slot = 'R1C1', storageAreaId = null } = {}) {
  return {
    id,
    wine_name: name,
    colour,
    grapes,
    style: '',
    winemaking: '',
    slot_id: slot,
    location_code: slot,
    storage_area_id: storageAreaId
  };
}

function makeFridgeWine({ wineId, category, slot, drinkByYear = null } = {}) {
  return { wineId, wineName: `Wine ${wineId}`, category, slot };
}

function makeAreaResult({ areaId, storageType = 'wine_fridge', candidates = [], wines = [], parLevelGaps = {}, alternatives = {}, emptySlots = 0 } = {}) {
  return { areaId, fridgeType: storageType, candidates, wines, parLevelGaps, alternatives, emptySlots };
}

const WINE_FRIDGE = { id: 10, name: 'Wine Fridge', storage_type: 'wine_fridge' };
const KITCHEN_FRIDGE = { id: 20, name: 'Kitchen Fridge', storage_type: 'kitchen_fridge' };

// ---------------------------------------------------------------------------
// detectFridgeTransfers — basic transfer generation
// ---------------------------------------------------------------------------

describe('detectFridgeTransfers — basic transfer generation', () => {
  it('returns empty array when fewer than 2 fridge areas', () => {
    const area = makeAreaResult({ areaId: 10 });
    expect(detectFridgeTransfers([area], [WINE_FRIDGE])).toHaveLength(0);
  });

  it('generates a transfer for chillable red in kitchen fridge → wine fridge', () => {
    const pinot = makeFridgeWine({ wineId: 1, category: 'chillableRed', slot: 'K1' });
    const kitchenArea = makeAreaResult({
      areaId: 20,
      storageType: 'kitchen_fridge',
      wines: [pinot]
    });
    const wineArea = makeAreaResult({
      areaId: 10,
      storageType: 'wine_fridge',
      parLevelGaps: { chillableRed: { need: 1, priority: 6, description: 'Light Red' } }
    });

    const transfers = detectFridgeTransfers([kitchenArea, wineArea], [WINE_FRIDGE, KITCHEN_FRIDGE]);

    expect(transfers).toHaveLength(1);
    expect(transfers[0].wineId).toBe(1);
    expect(transfers[0].fromAreaId).toBe(20);
    expect(transfers[0].toAreaId).toBe(10);
    expect(transfers[0].category).toBe('chillableRed');
  });

  it('does NOT generate transfer for sparkling in wine fridge (not misplaced)', () => {
    const sparkling = makeFridgeWine({ wineId: 2, category: 'sparkling', slot: 'W1' });
    const wineArea = makeAreaResult({
      areaId: 10,
      storageType: 'wine_fridge',
      wines: [sparkling]
    });
    const kitchenArea = makeAreaResult({
      areaId: 20,
      storageType: 'kitchen_fridge',
      parLevelGaps: { sparkling: { need: 1, priority: 1, description: 'Sparkling' } }
    });

    const transfers = detectFridgeTransfers([wineArea, kitchenArea], [WINE_FRIDGE, KITCHEN_FRIDGE]);
    expect(transfers).toHaveLength(0);
  });

  it('does NOT generate transfer when destination has no gap for that category', () => {
    const pinot = makeFridgeWine({ wineId: 3, category: 'chillableRed', slot: 'K1' });
    const kitchenArea = makeAreaResult({
      areaId: 20,
      storageType: 'kitchen_fridge',
      wines: [pinot]
    });
    // Wine fridge has NO chillableRed gap
    const wineArea = makeAreaResult({
      areaId: 10,
      storageType: 'wine_fridge',
      parLevelGaps: {} // no gaps
    });

    const transfers = detectFridgeTransfers([kitchenArea, wineArea], [WINE_FRIDGE, KITCHEN_FRIDGE]);
    expect(transfers).toHaveLength(0);
  });

  it('transfer includes fromAreaName, toAreaName, fromSlot, reason', () => {
    const pinot = makeFridgeWine({ wineId: 4, category: 'chillableRed', slot: 'K2' });
    const kitchenArea = makeAreaResult({
      areaId: 20,
      storageType: 'kitchen_fridge',
      wines: [pinot]
    });
    const wineArea = makeAreaResult({
      areaId: 10,
      storageType: 'wine_fridge',
      parLevelGaps: { chillableRed: { need: 1, priority: 6, description: 'Light Red' } }
    });

    const [t] = detectFridgeTransfers([kitchenArea, wineArea], [WINE_FRIDGE, KITCHEN_FRIDGE]);
    expect(t.fromAreaName).toBe('Kitchen Fridge');
    expect(t.toAreaName).toBe('Wine Fridge');
    expect(t.fromSlot).toBe('K2');
    expect(typeof t.reason).toBe('string');
    expect(t.reason.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// detectFridgeTransfers — capacity consumption and conflicting advice prevention
// ---------------------------------------------------------------------------

describe('detectFridgeTransfers — no conflicting advice', () => {
  it('demotes competing candidate to alternatives when transfer fills the same gap', () => {
    const pinot = makeFridgeWine({ wineId: 1, category: 'chillableRed', slot: 'K1' });
    const candidate = { wineId: 99, wineName: 'Cellar Pinot', category: 'chillableRed', fromSlot: 'R5C3' };

    const kitchenArea = makeAreaResult({
      areaId: 20,
      storageType: 'kitchen_fridge',
      wines: [pinot]
    });
    const wineArea = makeAreaResult({
      areaId: 10,
      storageType: 'wine_fridge',
      candidates: [candidate],
      parLevelGaps: { chillableRed: { need: 1, priority: 6, description: 'Light Red' } }
    });

    detectFridgeTransfers([kitchenArea, wineArea], [WINE_FRIDGE, KITCHEN_FRIDGE]);

    // Candidate must be demoted — no longer in primary candidates
    expect(wineArea.candidates.find(c => c.wineId === 99)).toBeUndefined();
    // Candidate must appear in alternatives
    expect(wineArea.alternatives.chillableRed?.find(a => a.wineId === 99)).toBeDefined();
  });

  it('second misplaced wine for same category is NOT transferred when gap is already consumed', () => {
    const pinot1 = makeFridgeWine({ wineId: 1, category: 'chillableRed', slot: 'K1' });
    const pinot2 = makeFridgeWine({ wineId: 2, category: 'chillableRed', slot: 'K2' });

    const kitchenArea = makeAreaResult({
      areaId: 20,
      storageType: 'kitchen_fridge',
      wines: [pinot1, pinot2]
    });
    const wineArea = makeAreaResult({
      areaId: 10,
      storageType: 'wine_fridge',
      parLevelGaps: { chillableRed: { need: 1, priority: 6, description: 'Light Red' } }
    });

    const transfers = detectFridgeTransfers([kitchenArea, wineArea], [WINE_FRIDGE, KITCHEN_FRIDGE]);

    // Only one transfer accepted (need: 1)
    expect(transfers).toHaveLength(1);
  });

  it('gap.need = 2 allows up to 2 transfers', () => {
    const pinot1 = makeFridgeWine({ wineId: 1, category: 'chillableRed', slot: 'K1' });
    const pinot2 = makeFridgeWine({ wideId: 2, category: 'chillableRed', slot: 'K2' });

    const kitchenArea = makeAreaResult({
      areaId: 20,
      storageType: 'kitchen_fridge',
      wines: [pinot1, pinot2]
    });
    const wineArea = makeAreaResult({
      areaId: 10,
      storageType: 'wine_fridge',
      parLevelGaps: { chillableRed: { need: 2, priority: 6, description: 'Light Red' } }
    });

    const transfers = detectFridgeTransfers([kitchenArea, wineArea], [WINE_FRIDGE, KITCHEN_FRIDGE]);
    expect(transfers).toHaveLength(2);
  });

  it('candidate for different category is NOT demoted when transfer fills another category', () => {
    const pinot = makeFridgeWine({ wineId: 1, category: 'chillableRed', slot: 'K1' });
    const sparklingCandidate = { wineId: 50, wineName: 'Cava', category: 'sparkling', fromSlot: 'R1C1' };

    const kitchenArea = makeAreaResult({
      areaId: 20,
      storageType: 'kitchen_fridge',
      wines: [pinot]
    });
    const wineArea = makeAreaResult({
      areaId: 10,
      storageType: 'wine_fridge',
      candidates: [sparklingCandidate],
      parLevelGaps: {
        chillableRed: { need: 1, priority: 6, description: 'Light Red' },
        sparkling: { need: 1, priority: 1, description: 'Sparkling' }
      }
    });

    detectFridgeTransfers([kitchenArea, wineArea], [WINE_FRIDGE, KITCHEN_FRIDGE]);

    // Sparkling candidate must NOT be demoted (only chillableRed gap filled by transfer)
    expect(wineArea.candidates.find(c => c.wineId === 50)).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// getAvailableCandidates — slot-level reservation
// ---------------------------------------------------------------------------

describe('getAvailableCandidates — slot-level reservation', () => {
  it('excludes wines already in a fridge area', () => {
    const fridgeWine = makeWine({ id: 1, slot: 'F1', storageAreaId: 10 });
    const cellarWine = makeWine({ id: 2, slot: 'R1C1', storageAreaId: null });
    const allFridgeAreaIds = new Set([10]);

    const candidates = getAvailableCandidates([fridgeWine, cellarWine], allFridgeAreaIds, new Set());
    expect(candidates.map(w => w.id)).toEqual([2]);
  });

  it('excludes wines whose slot is in the reserved set', () => {
    const wine1 = makeWine({ id: 1, slot: 'R1C1', storageAreaId: null });
    const wine2 = makeWine({ id: 2, slot: 'R2C2', storageAreaId: null });
    const reserved = new Set(['R1C1']);

    const candidates = getAvailableCandidates([wine1, wine2], new Set(), reserved);
    expect(candidates.map(w => w.id)).toEqual([2]);
  });

  it('excludes wines without a slot_id', () => {
    const wine = makeWine({ id: 1, slot: null, storageAreaId: null });
    wine.slot_id = null;
    const candidates = getAvailableCandidates([wine], new Set(), new Set());
    expect(candidates).toHaveLength(0);
  });

  it('allows same wine (different bottles) in two areas via slot-level reservation', () => {
    // Two bottles of wine ID 5 in different slots — one reserved, one free
    const bottle1 = makeWine({ id: 5, slot: 'R1C1', storageAreaId: null });
    const bottle2 = makeWine({ id: 5, slot: 'R1C2', storageAreaId: null });
    const reserved = new Set(['R1C1']); // bottle1's slot reserved for area A

    const candidates = getAvailableCandidates([bottle1, bottle2], new Set(), reserved);
    // bottle2 is still available for area B
    expect(candidates).toHaveLength(1);
    expect(candidates[0].slot_id).toBe('R1C2');
  });
});
