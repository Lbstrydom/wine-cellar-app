/**
 * @fileoverview Unit tests for cellar placement matching.
 * @module tests/unit/services/cellar/cellarPlacement.test
 */

vi.mock('../../../../src/db/index.js', () => ({
  default: {
    prepare: vi.fn()
  }
}));

import { findBestZone } from '../../../../src/services/cellar/cellarPlacement.js';

describe('cellarPlacement varietal disambiguation', () => {
  it('does not infer cabernet sauvignon as a white wine', () => {
    const result = findBestZone({
      wine_name: 'Estate Cabernet Sauvignon 2022',
      style: '',
      colour: null,
      grapes: null
    });

    expect(result.zoneId).toBe('cabernet');
    expect(result.zoneId).not.toBe('sauvignon_blanc');
  });

  it('continues to map sauvignon blanc to a white zone', () => {
    const result = findBestZone({
      wine_name: 'Marlborough Sauvignon Blanc 2024',
      style: '',
      colour: null,
      grapes: null
    });

    expect(result.zoneId).toBe('sauvignon_blanc');
  });
});
