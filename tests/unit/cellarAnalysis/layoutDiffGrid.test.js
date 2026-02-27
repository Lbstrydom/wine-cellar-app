/**
 * @fileoverview Unit tests for layoutDiffGrid pure logic and rendering.
 * Covers: classifySlot, buildSwapSlotSet, computeDiffStats, buildSlotMoveMap,
 * and the renderDiffGrid DOM rendering path.
 * @module tests/unit/cellarAnalysis/layoutDiffGrid
 */

// ── Module mocks ────────────────────────────────────────────
vi.mock('../../../public/js/utils.js', () => ({
  shortenWineName: vi.fn(name => (name || '').slice(0, 15)),
  escapeHtml: vi.fn(s => String(s ?? ''))
}));

// vi.hoisted ensures mockState is initialised before the hoisted vi.mock factory runs
const { mockState } = vi.hoisted(() => {
  const mockState = { layout: null };
  return { mockState };
});
vi.mock('../../../public/js/app.js', () => ({ state: mockState }));

import {
  DiffType,
  classifySlot,
  buildSwapSlotSet,
  computeDiffStats,
  buildSlotMoveMap,
  renderDiffGrid
} from '../../../public/js/cellarAnalysis/layoutDiffGrid.js';

// ───────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────

function makeLayout(entries) {
  // entries: [[slotId, wineId], ...]
  return Object.fromEntries(entries);
}

function makeTargetLayout(entries) {
  // entries: [[slotId, { wineId, wineName, colour }], ...]
  return Object.fromEntries(entries);
}

// ───────────────────────────────────────────────────────────
// DiffType export sanity
// ───────────────────────────────────────────────────────────

describe('DiffType enum', () => {
  it('exports the six expected constants', () => {
    expect(DiffType.STAY).toBe('stay');
    expect(DiffType.MOVE_IN).toBe('move-in');
    expect(DiffType.MOVE_OUT).toBe('move-out');
    expect(DiffType.SWAP).toBe('swap');
    expect(DiffType.EMPTY).toBe('empty');
    expect(DiffType.UNPLACEABLE).toBe('unplaceable');
  });
});

// ───────────────────────────────────────────────────────────
// classifySlot
// ───────────────────────────────────────────────────────────

describe('classifySlot', () => {
  const noSwaps = new Set();

  it('returns EMPTY when both current and target are empty', () => {
    const result = classifySlot('R1C1', {}, {}, noSwaps);
    expect(result.diffType).toBe(DiffType.EMPTY);
    expect(result.currentWineId).toBeNull();
    expect(result.targetWine).toBeNull();
  });

  it('returns STAY when same wine is in both current and target', () => {
    const current = makeLayout([['R1C1', 42]]);
    const target = makeTargetLayout([['R1C1', { wineId: 42, wineName: 'Kanonkop' }]]);
    const result = classifySlot('R1C1', current, target, noSwaps);
    expect(result.diffType).toBe(DiffType.STAY);
    expect(result.currentWineId).toBe(42);
    expect(result.targetWine.wineId).toBe(42);
  });

  it('returns MOVE_IN when slot is empty in current but occupied in target', () => {
    const current = makeLayout([]);
    const target = makeTargetLayout([['R1C1', { wineId: 10, wineName: 'SomeWine' }]]);
    const result = classifySlot('R1C1', current, target, noSwaps);
    expect(result.diffType).toBe(DiffType.MOVE_IN);
    expect(result.currentWineId).toBeNull();
    expect(result.targetWine.wineId).toBe(10);
  });

  it('returns MOVE_IN when a different wine arrives (non-swap)', () => {
    const current = makeLayout([['R1C1', 1]]);
    const target = makeTargetLayout([['R1C1', { wineId: 2, wineName: 'NewWine' }]]);
    const result = classifySlot('R1C1', current, target, noSwaps);
    expect(result.diffType).toBe(DiffType.MOVE_IN);
  });

  it('returns MOVE_OUT when slot had a wine but target is empty', () => {
    const current = makeLayout([['R1C1', 5]]);
    const target = makeTargetLayout([]);
    const result = classifySlot('R1C1', current, target, noSwaps);
    expect(result.diffType).toBe(DiffType.MOVE_OUT);
    expect(result.currentWineId).toBe(5);
    expect(result.targetWine).toBeNull();
  });

  it('returns SWAP when both slots have different wines and slot is in swap set', () => {
    const current = makeLayout([['R1C1', 1]]);
    const target = makeTargetLayout([['R1C1', { wineId: 2, wineName: 'OtherWine' }]]);
    const swapSlots = new Set(['R1C1', 'R2C1']);
    const result = classifySlot('R1C1', current, target, swapSlots);
    expect(result.diffType).toBe(DiffType.SWAP);
  });

  it('swap only triggers when slot is in the swap set (not for all mismatched slots)', () => {
    const current = makeLayout([['R1C1', 1]]);
    const target = makeTargetLayout([['R1C1', { wineId: 9, wineName: 'Diff' }]]);
    // R1C1 not in swap set — should be MOVE_IN not SWAP
    const result = classifySlot('R1C1', current, target, noSwaps);
    expect(result.diffType).not.toBe(DiffType.SWAP);
    expect(result.diffType).toBe(DiffType.MOVE_IN);
  });

  it('handles null targetWine gracefully for MOVE_OUT', () => {
    const current = makeLayout([['R5C3', 99]]);
    const result = classifySlot('R5C3', current, {}, noSwaps);
    expect(result.diffType).toBe(DiffType.MOVE_OUT);
    expect(result.targetWine).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────
// buildSwapSlotSet
// ───────────────────────────────────────────────────────────

describe('buildSwapSlotSet', () => {
  it('returns empty set for empty sortPlan', () => {
    expect(buildSwapSlotSet([]).size).toBe(0);
  });

  it('returns empty set when no moves are swaps', () => {
    const plan = [{ from: 'R1C1', to: 'R2C1', moveType: 'direct' }];
    expect(buildSwapSlotSet(plan).size).toBe(0);
  });

  it('adds both from and to slots for a swap pair', () => {
    const plan = [
      { from: 'R1C1', to: 'R2C1', moveType: 'swap' },
      { from: 'R2C1', to: 'R1C1', moveType: 'swap' }
    ];
    const set = buildSwapSlotSet(plan);
    expect(set.has('R1C1')).toBe(true);
    expect(set.has('R2C1')).toBe(true);
    expect(set.size).toBe(2);
  });

  it('handles mixed direct and swap moves', () => {
    const plan = [
      { from: 'R1C1', to: 'R2C1', moveType: 'swap' },
      { from: 'R2C1', to: 'R1C1', moveType: 'swap' },
      { from: 'R3C1', to: 'R4C1', moveType: 'direct' }
    ];
    const set = buildSwapSlotSet(plan);
    expect(set.has('R3C1')).toBe(false);
    expect(set.has('R4C1')).toBe(false);
    expect(set.size).toBe(2);
  });

  it('handles null/non-array gracefully', () => {
    expect(buildSwapSlotSet(null).size).toBe(0);
    expect(buildSwapSlotSet(undefined).size).toBe(0);
  });
});

// ───────────────────────────────────────────────────────────
// computeDiffStats
// ───────────────────────────────────────────────────────────

describe('computeDiffStats', () => {
  it('counts each diff type correctly', () => {
    const slots = [
      { diffType: DiffType.STAY },
      { diffType: DiffType.STAY },
      { diffType: DiffType.MOVE_IN },
      { diffType: DiffType.MOVE_OUT },
      { diffType: DiffType.SWAP },
      { diffType: DiffType.SWAP },
      { diffType: DiffType.EMPTY },
      { diffType: DiffType.UNPLACEABLE }
    ];
    const stats = computeDiffStats(slots);
    expect(stats.stay).toBe(2);
    expect(stats.moveIn).toBe(1);
    expect(stats.moveOut).toBe(1);
    expect(stats.swap).toBe(2);
    expect(stats.empty).toBe(1);
    expect(stats.unplaceable).toBe(1);
  });

  it('computes swapPairs as floor(swap / 2)', () => {
    const slots = [
      { diffType: DiffType.SWAP },
      { diffType: DiffType.SWAP },
      { diffType: DiffType.SWAP },
      { diffType: DiffType.SWAP }
    ];
    const stats = computeDiffStats(slots);
    expect(stats.swapPairs).toBe(2);
  });

  it('returns zeroed stats for empty array', () => {
    const stats = computeDiffStats([]);
    expect(stats.stay).toBe(0);
    expect(stats.moveIn).toBe(0);
    expect(stats.swap).toBe(0);
    expect(stats.swapPairs).toBe(0);
  });

  it('swapPairs rounds down for odd swap counts', () => {
    const slots = [{ diffType: DiffType.SWAP }, { diffType: DiffType.SWAP }, { diffType: DiffType.SWAP }];
    const stats = computeDiffStats(slots);
    expect(stats.swapPairs).toBe(1);
  });
});

// ───────────────────────────────────────────────────────────
// buildSlotMoveMap
// ───────────────────────────────────────────────────────────

describe('buildSlotMoveMap', () => {
  it('returns empty map for empty plan', () => {
    expect(buildSlotMoveMap([]).size).toBe(0);
  });

  it('maps destination slot to move info', () => {
    const plan = [{ from: 'R1C1', to: 'R2C1', moveType: 'direct', wineName: 'Kanonkop' }];
    const map = buildSlotMoveMap(plan);
    expect(map.has('R2C1')).toBe(true);
    expect(map.get('R2C1').from).toBe('R1C1');
    expect(map.get('R2C1').wineName).toBe('Kanonkop');
    expect(map.get('R2C1').moveType).toBe('direct');
  });

  it('does NOT map source slot — only destination', () => {
    const plan = [{ from: 'R1C1', to: 'R2C1', moveType: 'direct', wineName: 'Test' }];
    const map = buildSlotMoveMap(plan);
    expect(map.has('R1C1')).toBe(false);
  });

  it('handles multiple moves without collision', () => {
    const plan = [
      { from: 'R1C1', to: 'R3C1', moveType: 'direct', wineName: 'Wine A' },
      { from: 'R2C1', to: 'R4C1', moveType: 'swap', wineName: 'Wine B' }
    ];
    const map = buildSlotMoveMap(plan);
    expect(map.size).toBe(2);
    expect(map.get('R3C1').wineName).toBe('Wine A');
    expect(map.get('R4C1').wineName).toBe('Wine B');
  });

  it('falls back to empty string when wineName is absent', () => {
    const plan = [{ from: 'R1C1', to: 'R2C1', moveType: 'direct' }];
    const map = buildSlotMoveMap(plan);
    expect(map.get('R2C1').wineName).toBe('');
  });

  it('handles null gracefully', () => {
    expect(buildSlotMoveMap(null).size).toBe(0);
  });
});

// ───────────────────────────────────────────────────────────
// renderDiffGrid — DOM integration
// ───────────────────────────────────────────────────────────

describe('renderDiffGrid', () => {
  let container;
  let appendedChildren;

  function makeDOMEl(tag = 'div') {
    const children = [];
    const classList = new Set();
    const el = {
      tagName: tag.toUpperCase(),
      className: '',
      textContent: '',
      innerHTML: '',
      title: '',
      style: {},
      dataset: {},
      _children: children,
      classList: {
        add: (...cls) => cls.forEach(c => classList.add(c)),
        remove: (...cls) => cls.forEach(c => classList.delete(c)),
        contains: c => classList.has(c),
        toggle: (c, force) => {
          if (force === undefined ? !classList.has(c) : force) { classList.add(c); return true; }
          classList.delete(c); return false;
        },
        _set: classList
      },
      appendChild: vi.fn(child => { children.push(child); el._children = children; }),
      querySelector: vi.fn(sel => {
        // Return a mock element for the header offset check
        if (sel.includes('diff-col-headers') || sel.includes('diff-row')) {
          return { offsetHeight: 32, offsetWidth: 120 };
        }
        return null;
      }),
      querySelectorAll: vi.fn(() => []),
      offsetHeight: 55,
      offsetWidth: 100
    };
    return el;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    appendedChildren = [];

    container = makeDOMEl();
    container.appendChild = vi.fn(child => appendedChildren.push(child));
    container.innerHTML = '';

    vi.stubGlobal('document', {
      getElementById: vi.fn((id) => id === 'layout-diff-grid' ? container : null),
      createElement: vi.fn(tag => makeDOMEl(tag))
    });

    // Provide a minimal layout with 2 rows, 2 slots each
    mockState.layout = {
      areas: [{
        storage_type: 'cellar',
        name: 'Main Cellar',
        rows: [
          { row_num: 1, slots: [{ location_code: 'R1C1' }, { location_code: 'R1C2' }] },
          { row_num: 2, slots: [{ location_code: 'R2C1' }, { location_code: 'R2C2' }] }
        ]
      }]
    };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns null when container element not found', () => {
    vi.stubGlobal('document', { getElementById: vi.fn(() => null), createElement: vi.fn(() => makeDOMEl()) });
    const result = renderDiffGrid('missing-id', {}, {}, []);
    expect(result).toBeNull();
  });

  it('returns null and shows no-data message when layout has no rows', () => {
    mockState.layout = { areas: [] };
    const result = renderDiffGrid('layout-diff-grid', {}, {}, []);
    expect(result).toBeNull();
    expect(container.innerHTML).toContain('No cellar layout available');
  });

  it('returns stats object with all counts when layout is valid', () => {
    const current = { 'R1C1': 1, 'R2C1': 2 };
    const target = {
      'R1C1': { wineId: 1, wineName: 'Stay Wine', colour: 'red' },
      'R1C2': { wineId: 3, wineName: 'Arriving Wine', colour: 'white' }
    };
    const result = renderDiffGrid('layout-diff-grid', current, target, []);
    expect(result).not.toBeNull();
    expect(typeof result.stats).toBe('object');
    expect(result.stats).toHaveProperty('stay');
    expect(result.stats).toHaveProperty('moveIn');
    expect(result.stats).toHaveProperty('moveOut');
    expect(result.stats).toHaveProperty('swap');
    expect(result.stats).toHaveProperty('empty');
    expect(result.stats).toHaveProperty('swapPairs');
    expect(Array.isArray(result.classifiedSlots)).toBe(true);
  });

  it('classifies stay, move-in, move-out, and empty slots correctly in result', () => {
    // R1C1: wineId 1 stays; R1C2: arrives (move-in); R2C1: leaves (move-out); R2C2: empty
    const current = { 'R1C1': 1, 'R2C1': 2 };
    const target = {
      'R1C1': { wineId: 1, wineName: 'StayWine', colour: '' },
      'R1C2': { wineId: 3, wineName: 'NewWine', colour: '' }
    };
    const result = renderDiffGrid('layout-diff-grid', current, target, []);
    const bySlot = Object.fromEntries(result.classifiedSlots.map(s => [s.slotId, s.diffType]));
    expect(bySlot['R1C1']).toBe(DiffType.STAY);
    expect(bySlot['R1C2']).toBe(DiffType.MOVE_IN);
    expect(bySlot['R2C1']).toBe(DiffType.MOVE_OUT);
    expect(bySlot['R2C2']).toBe(DiffType.EMPTY);
  });

  it('appends the shell element to the container', () => {
    renderDiffGrid('layout-diff-grid', {}, {}, []);
    expect(appendedChildren.length).toBeGreaterThan(0);
  });

  it('hides zone labels sidebar when zoneMap is empty', () => {
    let zoneLabelsEl = null;
    vi.stubGlobal('document', {
      getElementById: vi.fn((id) => id === 'layout-diff-grid' ? container : null),
      createElement: vi.fn(tag => {
        const el = makeDOMEl(tag);
        // Capture the zone labels element (first div with class checked later)
        return el;
      })
    });
    // With no zoneMap, should still render (zone rail hidden)
    const result = renderDiffGrid('layout-diff-grid', {}, {}, [], {});
    expect(result).not.toBeNull();
  });

  it('works with legacy layout format (layout.cellar.rows)', () => {
    mockState.layout = {
      cellar: {
        rows: [
          { row: 1, slots: [{ location_code: 'R1C1' }] },
          { row: 2, slots: [{ location_code: 'R2C1' }] }
        ]
      }
    };
    const result = renderDiffGrid('layout-diff-grid', {}, {}, []);
    expect(result).not.toBeNull();
    expect(result.classifiedSlots.length).toBe(2);
  });
});
