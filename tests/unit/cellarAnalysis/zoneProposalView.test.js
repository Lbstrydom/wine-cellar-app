import { renderZoneProposal } from '../../../public/js/cellarAnalysis/zoneProposalView.js';

describe('renderZoneProposal', () => {
  it('shows under-threshold zones when no zones qualify for dedicated rows', () => {
    const html = renderZoneProposal({
      totalBottles: 3,
      totalRows: 0,
      proposals: [],
      underThresholdZones: [
        {
          zoneId: 'portugal',
          displayName: 'Portugal',
          bottleCount: 3,
          reason: 'Only 3 bottle(s) - needs 5 to justify a dedicated row'
        }
      ]
    });

    expect(html).toContain('Below Dedicated-Row Threshold');
    expect(html).toContain('Portugal');
    expect(html).toContain('No row allocation changes are required right now.');
  });

  it('renders both allocated proposals and under-threshold zones', () => {
    const html = renderZoneProposal({
      totalBottles: 12,
      totalRows: 1,
      proposals: [
        {
          zoneId: 'cabernet',
          displayName: 'Cabernet Sauvignon',
          bottleCount: 9,
          assignedRows: ['R8'],
          totalCapacity: 9,
          utilizationPercent: 100,
          wines: [{ name: 'Estate Cab', vintage: 2020 }]
        }
      ],
      underThresholdZones: [
        {
          zoneId: 'portugal',
          displayName: 'Portugal',
          bottleCount: 3,
          reason: 'Only 3 bottle(s) - needs 5 to justify a dedicated row'
        }
      ],
      unassignedRows: ['R9']
    });

    expect(html).toContain('Cabernet Sauvignon');
    expect(html).toContain('R8');
    expect(html).toContain('Below Dedicated-Row Threshold');
    expect(html).toContain('Portugal');
    expect(html).toContain('Unassigned rows: R9');
  });

  it('shows empty-cellar message when there are no proposals and no under-threshold zones', () => {
    const html = renderZoneProposal({
      totalBottles: 0,
      totalRows: 0,
      proposals: [],
      underThresholdZones: []
    });

    expect(html).toContain('your cellar appears to be empty');
  });
});
