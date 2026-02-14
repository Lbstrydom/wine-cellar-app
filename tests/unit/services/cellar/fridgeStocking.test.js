/**
 * @fileoverview Unit tests for fridge stocking candidate selection.
 * @module tests/unit/services/cellar/fridgeStocking.test
 */

vi.mock('../../../../src/db/index.js', () => ({
  default: {
    prepare: vi.fn()
  }
}));

import db from '../../../../src/db/index.js';
import { analyseFridge } from '../../../../src/services/cellar/fridgeStocking.js';

function makeWine({
  id,
  name,
  slot,
  colour = 'white',
  grapes = '',
  style = '',
  winemaking = '',
  vintage = 2022
}) {
  return {
    id,
    wine_name: name,
    vintage,
    colour,
    grapes,
    style,
    winemaking,
    slot_id: slot,
    location_code: slot
  };
}

function buildBaselineFridgeMissingTextureWhite() {
  return [
    makeWine({ id: 1, name: 'Cava Brut', slot: 'F1', colour: 'sparkling' }),
    makeWine({ id: 2, name: 'Crisp Sauv Blanc A', slot: 'F2', grapes: 'sauvignon blanc' }),
    makeWine({ id: 3, name: 'Crisp Sauv Blanc B', slot: 'F3', grapes: 'sauvignon blanc' }),
    makeWine({ id: 4, name: 'Riesling Kabinett', slot: 'F4', grapes: 'riesling' }),
    makeWine({ id: 5, name: 'Dry Rose', slot: 'F5', colour: 'rose' }),
    makeWine({ id: 6, name: 'Pinot Noir', slot: 'F6', colour: 'red', grapes: 'pinot noir' })
  ];
}

describe('analyseFridge gap vs flex prioritization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.prepare.mockReturnValue({
      all: vi.fn().mockResolvedValue([])
    });
  });

  it('does not suggest flex candidates when a required gap has no matching wines', async () => {
    const fridgeWines = buildBaselineFridgeMissingTextureWhite();
    const cellarWines = [
      makeWine({
        id: 101,
        name: 'De Grendel Koetshuis Sauvignon Blanc',
        slot: 'R4C4',
        grapes: 'sauvignon blanc'
      })
    ];

    const analysis = await analyseFridge(fridgeWines, cellarWines, 'cellar-1');

    expect(analysis.unfilledGaps.textureWhite).toBeDefined();
    expect(analysis.candidates).toHaveLength(0);
    expect(analysis.candidates.every(c => !c.isFlex)).toBe(true);
  });

  it('uses a category-fitting non-reduce-now wine before unrelated drink-soon wines', async () => {
    const fridgeWines = buildBaselineFridgeMissingTextureWhite();
    const cellarWines = [
      makeWine({
        id: 201,
        name: 'Estate Chardonnay',
        slot: 'R8C1',
        grapes: 'chardonnay'
      }),
      makeWine({
        id: 202,
        name: 'Urgent Sauvignon Blanc',
        slot: 'R4C4',
        grapes: 'sauvignon blanc'
      })
    ];

    db.prepare.mockReturnValueOnce({
      all: vi.fn().mockResolvedValue([{ wine_id: 202 }])
    });

    const analysis = await analyseFridge(fridgeWines, cellarWines, 'cellar-1');

    expect(analysis.candidates.length).toBeGreaterThan(0);
    expect(analysis.candidates[0].wineId).toBe(201);
    expect(analysis.candidates[0].category).toBe('textureWhite');
    expect(analysis.unfilledGaps.textureWhite).toBeUndefined();
  });

  it('treats partially-filled required categories as unfilled and blocks flex suggestions', async () => {
    const fridgeWines = [
      makeWine({ id: 11, name: 'Cava Brut', slot: 'F1', colour: 'sparkling' }),
      makeWine({ id: 12, name: 'Riesling Kabinett', slot: 'F2', grapes: 'riesling' }),
      makeWine({ id: 13, name: 'Buttery Chardonnay', slot: 'F3', grapes: 'chardonnay' }),
      makeWine({ id: 14, name: 'Dry Rose', slot: 'F4', colour: 'rose' }),
      makeWine({ id: 15, name: 'Pinot Noir', slot: 'F5', colour: 'red', grapes: 'pinot noir' })
    ];

    // Crisp White has min=2; only one suitable cellar wine exists.
    const cellarWines = [
      makeWine({
        id: 301,
        name: 'Single Crisp Candidate',
        slot: 'R2C1',
        grapes: 'sauvignon blanc'
      }),
      makeWine({
        id: 302,
        name: 'Urgent Flex Decoy',
        slot: 'R2C2',
        colour: 'red',
        grapes: 'syrah'
      })
    ];

    db.prepare.mockReturnValueOnce({
      all: vi.fn().mockResolvedValue([{ wine_id: 302 }])
    });

    const analysis = await analyseFridge(fridgeWines, cellarWines, 'cellar-1');

    expect(analysis.unfilledGaps.crispWhite).toBeDefined();
    expect(analysis.unfilledGaps.crispWhite.remaining).toBe(1);
    expect(analysis.candidates).toHaveLength(1);
    expect(analysis.candidates[0].wineId).toBe(301);
    expect(analysis.candidates[0].category).toBe('crispWhite');
    expect(analysis.candidates.every(c => !c.isFlex)).toBe(true);
  });
});

