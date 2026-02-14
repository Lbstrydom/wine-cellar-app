/**
 * @fileoverview Unit tests for zone layout proposal robustness.
 * @module tests/unit/services/zone/zoneLayoutProposal.test
 */

vi.mock('../../../../src/db/index.js', () => ({
  default: {
    prepare: vi.fn()
  }
}));

import db from '../../../../src/db/index.js';
import { getSavedZoneLayout, proposeZoneLayout } from '../../../../src/services/zone/zoneLayoutProposal.js';

describe('zoneLayoutProposal type robustness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses assigned_rows when returned as an array value', async () => {
    db.prepare.mockReturnValue({
      all: vi.fn().mockResolvedValue([
        {
          zone_id: 'cabernet',
          assigned_rows: ['R8', 'R9'],
          wine_count: 3,
          updated_at: '2026-02-14T00:00:00.000Z'
        }
      ])
    });

    const layout = await getSavedZoneLayout('cellar-1');

    expect(layout).toHaveLength(1);
    expect(layout[0].assignedRows).toEqual(['R8', 'R9']);
  });

  it('falls back to empty assignedRows when assigned_rows is invalid JSON', async () => {
    db.prepare.mockReturnValue({
      all: vi.fn().mockResolvedValue([
        {
          zone_id: 'cabernet',
          assigned_rows: 'not-json',
          wine_count: 3,
          updated_at: '2026-02-14T00:00:00.000Z'
        }
      ])
    });

    const layout = await getSavedZoneLayout('cellar-1');

    expect(layout).toHaveLength(1);
    expect(layout[0].assignedRows).toEqual([]);
  });

  it('classifies wines when grapes are returned as arrays', async () => {
    db.prepare.mockReturnValue({
      all: vi.fn().mockResolvedValue([
        {
          id: 1,
          wine_name: 'Estate Reserve',
          vintage: 2022,
          colour: '',
          country: 'South Africa',
          grapes: ['cabernet sauvignon'],
          style: '',
          region: '',
          appellation: '',
          winemaking: [],
          sweetness: 'dry',
          zone_id: null,
          location_code: 'R8C1'
        }
      ])
    });

    const proposal = await proposeZoneLayout('cellar-1');
    const matchedZone = proposal.proposals.find(p =>
      p.zoneId === 'cabernet' || p.zoneId === 'sa_blends'
    );

    expect(matchedZone).toBeDefined();
    expect(matchedZone.bottleCount).toBe(1);
  });
});
