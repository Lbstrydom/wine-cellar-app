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
    // 5 wines to meet MIN_BOTTLES_FOR_ROW threshold for row allocation
    const wines = Array.from({ length: 5 }, (_, i) => ({
      id: i + 1,
      wine_name: `Estate Reserve ${i + 1}`,
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
      location_code: `R8C${i + 1}`
    }));

    db.prepare.mockReturnValue({
      all: vi.fn().mockResolvedValue(wines)
    });

    const proposal = await proposeZoneLayout('cellar-1');
    const matchedZone = proposal.proposals.find(p =>
      p.zoneId === 'cabernet' || p.zoneId === 'sa_blends'
    );

    expect(matchedZone).toBeDefined();
    expect(matchedZone.bottleCount).toBe(5);
  });

  it('puts under-threshold zones in underThresholdZones instead of proposals', async () => {
    db.prepare.mockReturnValue({
      all: vi.fn().mockResolvedValue([
        {
          id: 1,
          wine_name: 'Lone Cabernet',
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

    // 1 bottle < MIN_BOTTLES_FOR_ROW (5) → should NOT appear in proposals
    const inProposals = proposal.proposals.find(p =>
      p.zoneId === 'cabernet' || p.zoneId === 'sa_blends'
    );
    expect(inProposals).toBeUndefined();

    // Should appear in underThresholdZones with reason text
    expect(proposal.underThresholdZones).toBeDefined();
    expect(proposal.underThresholdZones.length).toBeGreaterThanOrEqual(1);
    const underZone = proposal.underThresholdZones.find(z =>
      z.zoneId === 'cabernet' || z.zoneId === 'sa_blends'
    );
    expect(underZone).toBeDefined();
    expect(underZone.bottleCount).toBe(1);
    expect(underZone.reason).toContain('needs');
  });

  it('allocates rows to zones at exactly the threshold', async () => {
    const wines = Array.from({ length: 5 }, (_, i) => ({
      id: i + 1,
      wine_name: `Shiraz ${i + 1}`,
      vintage: 2023,
      colour: 'red',
      country: 'South Africa',
      grapes: ['shiraz'],
      style: '',
      region: '',
      appellation: '',
      winemaking: [],
      sweetness: 'dry',
      zone_id: null,
      location_code: `R10C${i + 1}`
    }));

    db.prepare.mockReturnValue({
      all: vi.fn().mockResolvedValue(wines)
    });

    const proposal = await proposeZoneLayout('cellar-1');

    // 5 bottles = MIN_BOTTLES_FOR_ROW → should appear in proposals
    const shirazProposal = proposal.proposals.find(p => p.zoneId === 'shiraz');
    expect(shirazProposal).toBeDefined();
    expect(shirazProposal.bottleCount).toBe(5);
    expect(shirazProposal.assignedRows.length).toBeGreaterThanOrEqual(1);

    // Should NOT appear in underThresholdZones
    const underShiraz = (proposal.underThresholdZones || []).find(z => z.zoneId === 'shiraz');
    expect(underShiraz).toBeUndefined();
  });
});
