/**
 * @fileoverview Unit tests for drinking strategy heuristics.
 * @module tests/unit/services/wine/drinkingStrategy.test
 */

import { getFridgeCandidates } from '../../../../src/services/wine/drinkingStrategy.js';

describe('drinkingStrategy young style matching', () => {
  it('does not treat cabernet sauvignon as sauvignon blanc', () => {
    const wines = [{
      id: 1,
      wine_name: 'Estate Cabernet Sauvignon',
      style: '',
      colour: 'white',
      vintage: 2022,
      location_code: 'R8C1'
    }];

    const candidates = getFridgeCandidates(wines, 2026);

    expect(candidates).toHaveLength(0);
  });

  it('still treats sauvignon blanc as a drink-young style', () => {
    const wines = [{
      id: 2,
      wine_name: 'Single Vineyard Sauvignon Blanc',
      style: '',
      colour: 'white',
      vintage: 2022,
      location_code: 'R3C2'
    }];

    const candidates = getFridgeCandidates(wines, 2026);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].wineId).toBe(2);
  });
});
