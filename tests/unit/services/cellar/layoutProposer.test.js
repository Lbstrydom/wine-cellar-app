/**
 * @fileoverview Unit tests for layoutProposer — ideal layout computation.
 * Pure function tests only (no global mocks that leak in --no-isolate mode).
 * Integration tests for proposeIdealLayout are in layoutProposerIntegration.test.js.
 * @module tests/unit/services/cellar/layoutProposer.test
 */

// Minimal db mock required because importing layoutProposer.js triggers the
// import chain: layoutProposer → cellarAllocation → db/index.js → DATABASE_URL.
// We only mock db itself (not cellarAllocation) to avoid --no-isolate leakage
// that would break cellarAllocation.test.js.
vi.mock('../../../../src/db/index.js', () => ({
  default: { prepare: vi.fn() }
}));

import { buildSlotOrder, packZoneSlots, optimizeForStability } from '../../../../src/services/cellar/layoutProposer.js';

describe('buildSlotOrder', () => {
  it('builds left-to-right slots for left fill direction', () => {
    const slots = buildSlotOrder(['R1'], 'left');
    expect(slots).toEqual([
      'R1C1', 'R1C2', 'R1C3', 'R1C4', 'R1C5', 'R1C6', 'R1C7'
    ]);
  });

  it('builds right-to-left slots for right fill direction', () => {
    const slots = buildSlotOrder(['R2'], 'right');
    expect(slots).toEqual([
      'R2C9', 'R2C8', 'R2C7', 'R2C6', 'R2C5', 'R2C4', 'R2C3', 'R2C2', 'R2C1'
    ]);
  });

  it('sorts rows numerically before building slots', () => {
    const slots = buildSlotOrder(['R3', 'R1'], 'left');
    // R1 first (7 slots), then R3 (9 slots)
    expect(slots[0]).toBe('R1C1');
    expect(slots[7]).toBe('R3C1');
  });

  it('uses dynamic row capacity from storageAreaRows', () => {
    const rows = [{ row_num: 1, col_count: 3 }];
    const slots = buildSlotOrder(['R1'], 'left', rows);
    expect(slots).toEqual(['R1C1', 'R1C2', 'R1C3']);
  });

  it('returns empty array for empty rows', () => {
    expect(buildSlotOrder([], 'left')).toEqual([]);
  });

  it('handles multi-row with mixed capacities', () => {
    const rows = [
      { row_num: 1, col_count: 5 },
      { row_num: 2, col_count: 3 }
    ];
    const slots = buildSlotOrder(['R1', 'R2'], 'left', rows);
    expect(slots).toEqual([
      'R1C1', 'R1C2', 'R1C3', 'R1C4', 'R1C5',
      'R2C1', 'R2C2', 'R2C3'
    ]);
  });
});

describe('packZoneSlots', () => {
  const instances = [
    { wineId: 1, wineName: 'Cab A', confidence: 'high' },
    { wineId: 1, wineName: 'Cab A', confidence: 'high' },
    { wineId: 2, wineName: 'Shiraz B', confidence: 'medium' }
  ];

  it('packs wines contiguously into available slots', () => {
    const slotOrder = ['R1C1', 'R1C2', 'R1C3', 'R1C4'];
    const { assignments, overflow } = packZoneSlots(instances, slotOrder, 'cabernet');

    expect(assignments.size).toBe(3);
    expect(overflow).toHaveLength(0);

    // Same wine_id bottles should be adjacent (packed by group)
    const slot1 = assignments.get('R1C1');
    const slot2 = assignments.get('R1C2');
    expect(slot1.wineId).toBe(slot2.wineId); // Same wine_id grouped together
  });

  it('overflows when not enough slots', () => {
    const slotOrder = ['R1C1', 'R1C2']; // Only 2 slots for 3 bottles
    const { assignments, overflow } = packZoneSlots(instances, slotOrder, 'cabernet');

    expect(assignments.size).toBe(2);
    expect(overflow).toHaveLength(1);
  });

  it('handles empty instances', () => {
    const { assignments, overflow } = packZoneSlots([], ['R1C1'], 'z');
    expect(assignments.size).toBe(0);
    expect(overflow).toHaveLength(0);
  });

  it('handles empty slot order', () => {
    const { assignments, overflow } = packZoneSlots(instances, [], 'z');
    expect(assignments.size).toBe(0);
    expect(overflow).toHaveLength(3);
  });

  it('sets zoneId on all assignments', () => {
    const slotOrder = ['R1C1', 'R1C2', 'R1C3'];
    const { assignments } = packZoneSlots(instances, slotOrder, 'shiraz');

    for (const [, info] of assignments) {
      expect(info.zoneId).toBe('shiraz');
    }
  });

  it('groups multi-bottle wines adjacently before single-bottle wines', () => {
    const mixed = [
      { wineId: 10, wineName: 'Single', confidence: 'high' },
      { wineId: 20, wineName: 'Triple', confidence: 'high' },
      { wineId: 20, wineName: 'Triple', confidence: 'high' },
      { wineId: 20, wineName: 'Triple', confidence: 'high' }
    ];
    const slotOrder = ['R1C1', 'R1C2', 'R1C3', 'R1C4'];
    const { assignments } = packZoneSlots(mixed, slotOrder, 'z');

    // Wine 20 (3 bottles) should be first, then wine 10 (1 bottle)
    expect(assignments.get('R1C1').wineId).toBe(20);
    expect(assignments.get('R1C2').wineId).toBe(20);
    expect(assignments.get('R1C3').wineId).toBe(20);
    expect(assignments.get('R1C4').wineId).toBe(10);
  });
});

describe('optimizeForStability', () => {
  it('swaps a bottle to its current position when it is in the correct zone', () => {
    const targetLayout = new Map([
      ['R1C1', { wineId: 1, wineName: 'W1', zoneId: 'z1' }],
      ['R1C2', { wineId: 2, wineName: 'W2', zoneId: 'z1' }]
    ]);
    const currentLayout = new Map([
      ['R1C1', { wineId: 2, wineName: 'W2' }],
      ['R1C2', { wineId: 1, wineName: 'W1' }]
    ]);
    const zoneSlotsMap = new Map([
      ['z1', new Set(['R1C1', 'R1C2'])]
    ]);

    optimizeForStability(targetLayout, currentLayout, zoneSlotsMap);

    expect(targetLayout.get('R1C1').wineId).toBe(2);
    expect(targetLayout.get('R1C2').wineId).toBe(1);
  });

  it('does not swap across different zones', () => {
    const targetLayout = new Map([
      ['R1C1', { wineId: 1, wineName: 'W1', zoneId: 'z1' }],
      ['R2C1', { wineId: 2, wineName: 'W2', zoneId: 'z2' }]
    ]);
    const currentLayout = new Map([
      ['R1C1', { wineId: 2, wineName: 'W2' }],
      ['R2C1', { wineId: 1, wineName: 'W1' }]
    ]);
    const zoneSlotsMap = new Map([
      ['z1', new Set(['R1C1'])],
      ['z2', new Set(['R2C1'])]
    ]);

    optimizeForStability(targetLayout, currentLayout, zoneSlotsMap);

    expect(targetLayout.get('R1C1').wineId).toBe(1);
    expect(targetLayout.get('R2C1').wineId).toBe(2);
  });

  it('does nothing when current layout is empty', () => {
    const targetLayout = new Map([
      ['R1C1', { wineId: 1, wineName: 'W1', zoneId: 'z1' }]
    ]);
    const currentLayout = new Map();
    const zoneSlotsMap = new Map([
      ['z1', new Set(['R1C1'])]
    ]);

    optimizeForStability(targetLayout, currentLayout, zoneSlotsMap);

    expect(targetLayout.get('R1C1').wineId).toBe(1); // Unchanged
  });

  it('handles empty target layout', () => {
    const targetLayout = new Map();
    const currentLayout = new Map([
      ['R1C1', { wineId: 1 }]
    ]);
    const zoneSlotsMap = new Map();

    // Should not throw
    optimizeForStability(targetLayout, currentLayout, zoneSlotsMap);
    expect(targetLayout.size).toBe(0);
  });
});
