/**
 * @fileoverview Unit tests for area-aware move execution payloads in moves.js.
 * Covers the user-triggered execute paths that should enrich move objects with
 * from/to storage area IDs before calling executeCellarMoves().
 * @module tests/unit/cellarAnalysis/moves
 */

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockExecuteCellarMoves,
  mockShowToast,
  mockEscapeHtml,
  mockGetAreaIdForLocation,
  mockFormatSlotLabel,
  mockRefreshLayout,
  mockGetCurrentAnalysis,
  mockGetAIMoveJudgments,
  mockOpenMoveGuide,
  mockDetectSwapPairs,
  mockLoadAnalysis
} = vi.hoisted(() => ({
  mockExecuteCellarMoves: vi.fn(),
  mockShowToast: vi.fn(),
  mockEscapeHtml: vi.fn((value) => String(value ?? '')),
  mockGetAreaIdForLocation: vi.fn(),
  mockFormatSlotLabel: vi.fn((locationCode) => String(locationCode ?? '')),
  mockRefreshLayout: vi.fn().mockResolvedValue(),
  mockGetCurrentAnalysis: vi.fn(),
  mockGetAIMoveJudgments: vi.fn().mockReturnValue(null),
  mockOpenMoveGuide: vi.fn(),
  mockDetectSwapPairs: vi.fn().mockReturnValue(new Map()),
  mockLoadAnalysis: vi.fn().mockResolvedValue()
}));

vi.mock('../../../public/js/api.js', () => ({
  executeCellarMoves: mockExecuteCellarMoves
}));

vi.mock('../../../public/js/utils.js', () => ({
  showToast: mockShowToast,
  escapeHtml: mockEscapeHtml,
  getAreaIdForLocation: mockGetAreaIdForLocation,
  formatSlotLabel: mockFormatSlotLabel
}));

vi.mock('../../../public/js/app.js', () => ({
  refreshLayout: mockRefreshLayout,
  state: { layout: { areas: [{ id: 'layout-area' }] } }
}));

vi.mock('../../../public/js/cellarAnalysis/state.js', () => ({
  getCurrentAnalysis: mockGetCurrentAnalysis,
  getAIMoveJudgments: mockGetAIMoveJudgments
}));

vi.mock('../../../public/js/cellarAnalysis/moveGuide.js', () => ({
  openMoveGuide: mockOpenMoveGuide,
  detectSwapPairs: mockDetectSwapPairs
}));

vi.mock('../../../public/js/cellarAnalysis/analysis.js', () => ({
  loadAnalysis: mockLoadAnalysis
}));

import {
  handleExecuteAllMoves,
  renderCompactionMoves,
  renderGroupingMoves,
  renderGroupingSteps,
  renderMoves
} from '../../../public/js/cellarAnalysis/moves.js';
import { executeCellarMoves } from '../../../public/js/api.js';
import { getAreaIdForLocation } from '../../../public/js/utils.js';

function makeClassList() {
  const classes = new Set();
  return {
    add: (...items) => items.forEach((item) => classes.add(item)),
    remove: (...items) => items.forEach((item) => classes.delete(item)),
    contains: (item) => classes.has(item),
    toggle: vi.fn((item, force) => {
      if (typeof force === 'boolean') {
        if (force) classes.add(item);
        else classes.delete(item);
        return force;
      }
      if (classes.has(item)) {
        classes.delete(item);
        return false;
      }
      classes.add(item);
      return true;
    })
  };
}

function makeElement(overrides = {}) {
  const listeners = {};
  return {
    innerHTML: '',
    textContent: '',
    style: { display: '' },
    dataset: {},
    disabled: false,
    className: '',
    classList: makeClassList(),
    querySelector: vi.fn(() => null),
    querySelectorAll: vi.fn(() => []),
    addEventListener: vi.fn((event, callback) => {
      listeners[event] = callback;
    }),
    appendChild: vi.fn(),
    remove: vi.fn(),
    closest: vi.fn(() => null),
    scrollIntoView: vi.fn(),
    _listeners: listeners,
    ...overrides
  };
}

function makeButton(dataset = {}, overrides = {}) {
  return makeElement({ dataset, ...overrides });
}

async function triggerClick(button, extra = {}) {
  return button._listeners.click?.({
    stopPropagation() {},
    target: { closest: () => null },
    ...extra
  });
}

function stubDocument(elements, { createElement } = {}) {
  vi.stubGlobal('document', {
    getElementById: vi.fn((id) => elements[id] || null),
    createElement: vi.fn(createElement || (() => makeElement())),
    querySelector: vi.fn(() => null),
    querySelectorAll: vi.fn(() => []),
    body: {
      appendChild: vi.fn()
    }
  });
}

describe('cellarAnalysis/moves area threading', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDetectSwapPairs.mockReturnValue(new Map());
    mockGetAIMoveJudgments.mockReturnValue(null);
    mockGetAreaIdForLocation.mockImplementation((_layout, locationCode) => (
      `area-for-${locationCode}`
    ));
    mockExecuteCellarMoves.mockResolvedValue({ success: true, moved: 1 });
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('threads area IDs for a single move button in renderMoves()', async () => {
    const analysis = {
      suggestedMoves: [
        { type: 'move', wineId: 11, wineName: 'Pinot Noir', from: 'R1C1', to: 'R2C1' }
      ]
    };
    mockGetCurrentAnalysis.mockReturnValue(analysis);

    const moveBtn = makeButton({ moveIndex: '0' });
    const listEl = makeElement();
    listEl.querySelectorAll = vi.fn((selector) => {
      if (selector === '.move-execute-btn') return [moveBtn];
      return [];
    });
    const actionsEl = makeElement({ querySelector: vi.fn(() => null) });

    stubDocument({
      'moves-list': listEl,
      'moves-actions': actionsEl
    });

    renderMoves(analysis.suggestedMoves, false, false);
    await triggerClick(moveBtn);

    expect(getAreaIdForLocation).toHaveBeenCalledWith(expect.any(Object), 'R1C1');
    expect(getAreaIdForLocation).toHaveBeenCalledWith(expect.any(Object), 'R2C1');
    expect(executeCellarMoves).toHaveBeenCalledWith([
      expect.objectContaining({
        wineId: 11,
        from: 'R1C1',
        to: 'R2C1',
        from_storage_area_id: 'area-for-R1C1',
        to_storage_area_id: 'area-for-R2C1'
      })
    ]);
  });

  it('threads area IDs for swap execution in renderMoves()', async () => {
    const moves = [
      { type: 'move', wineId: 11, wineName: 'Pinot Noir', from: 'R1C1', to: 'R2C1' },
      { type: 'move', wineId: 22, wineName: 'Syrah', from: 'R2C1', to: 'R1C1' }
    ];
    mockGetCurrentAnalysis.mockReturnValue({ suggestedMoves: moves });
    mockDetectSwapPairs.mockReturnValue(new Map([[0, 1], [1, 0]]));

    const swapBtn = makeButton({ moveIndex: '0' });
    const listEl = makeElement();
    listEl.querySelectorAll = vi.fn((selector) => {
      if (selector === '.move-swap-btn') return [swapBtn];
      return [];
    });
    const actionsEl = makeElement({ querySelector: vi.fn(() => null) });

    stubDocument({
      'moves-list': listEl,
      'moves-actions': actionsEl
    });

    renderMoves(moves, false, true);
    await triggerClick(swapBtn);

    expect(executeCellarMoves).toHaveBeenCalledWith([
      expect.objectContaining({
        wineId: 11,
        from: 'R1C1',
        to: 'R2C1',
        from_storage_area_id: 'area-for-R1C1',
        to_storage_area_id: 'area-for-R2C1'
      }),
      expect.objectContaining({
        wineId: 22,
        from: 'R2C1',
        to: 'R1C1',
        from_storage_area_id: 'area-for-R2C1',
        to_storage_area_id: 'area-for-R1C1'
      })
    ]);
  });

  it('threads area IDs for handleExecuteAllMoves()', async () => {
    mockGetCurrentAnalysis.mockReturnValue({
      suggestedMoves: [
        { type: 'move', wineId: 11, wineName: 'Pinot Noir', from: 'R1C1', to: 'R2C1' },
        { type: 'manual', wineId: 99, wineName: 'Manual', from: 'R9C1', to: 'Z1' }
      ]
    });

    const confirmBtn = makeElement();
    confirmBtn.addEventListener = vi.fn((event, callback) => {
      if (event === 'click') callback();
    });
    const modal = makeElement({
      querySelector: vi.fn((selector) => {
        if (selector === '.confirm-btn') return confirmBtn;
        if (selector === '.cancel-btn') return makeElement();
        if (selector === '.close-btn') return makeElement();
        return null;
      })
    });

    stubDocument({}, { createElement: () => modal });

    await handleExecuteAllMoves();

    expect(executeCellarMoves).toHaveBeenCalledWith([
      expect.objectContaining({
        wineId: 11,
        wineName: 'Pinot Noir',
        from: 'R1C1',
        to: 'R2C1',
        from_storage_area_id: 'area-for-R1C1',
        to_storage_area_id: 'area-for-R2C1'
      })
    ]);
  });

  it('threads area IDs for compaction moves', async () => {
    const executeBtn = makeButton({ compactionIndex: '0' });
    const container = makeElement();
    const listEl = makeElement();
    listEl.querySelectorAll = vi.fn((selector) => {
      if (selector === '.compaction-execute-btn') return [executeBtn];
      return [];
    });

    stubDocument({
      'analysis-compaction': container,
      'compaction-list': listEl
    });

    renderCompactionMoves([
      { wineId: 55, wineName: 'Barolo', from: 'R3C1', to: 'R3C2' }
    ]);

    await triggerClick(executeBtn);

    expect(executeCellarMoves).toHaveBeenCalledWith([
      expect.objectContaining({
        wineId: 55,
        from: 'R3C1',
        to: 'R3C2',
        from_storage_area_id: 'area-for-R3C1',
        to_storage_area_id: 'area-for-R3C2'
      })
    ]);
  });

  it('threads area IDs for grouping swaps', async () => {
    const executeBtn = makeButton({ groupingIndex: '0' });
    const container = makeElement();
    const listEl = makeElement();
    listEl.querySelectorAll = vi.fn((selector) => {
      if (selector === '.grouping-execute-btn') return [executeBtn];
      return [];
    });

    stubDocument({
      'analysis-grouping': container,
      'grouping-list': listEl
    });

    renderGroupingMoves([
      { wineId: 77, wineName: 'Rioja', from: 'R4C1', to: 'R4C2' },
      { wineId: 88, wineName: 'Tempranillo', from: 'R4C2', to: 'R4C1', isDisplacement: true }
    ]);

    await triggerClick(executeBtn);

    expect(executeCellarMoves).toHaveBeenCalledWith([
      expect.objectContaining({
        wineId: 77,
        from: 'R4C1',
        to: 'R4C2',
        from_storage_area_id: 'area-for-R4C1',
        to_storage_area_id: 'area-for-R4C2'
      }),
      expect.objectContaining({
        wineId: 88,
        from: 'R4C2',
        to: 'R4C1',
        from_storage_area_id: 'area-for-R4C2',
        to_storage_area_id: 'area-for-R4C1'
      })
    ]);
  });

  it('threads area IDs for structured grouping step execution', async () => {
    const stepBtn = makeButton({}, { textContent: 'Move' });
    const stepCard = makeElement({
      dataset: { rowId: 'R3', stepNum: '1' },
      querySelector: vi.fn((selector) => {
        if (selector === '.grouping-step-execute-btn') return stepBtn;
        return null;
      })
    });
    const section = makeElement({
      querySelector: vi.fn(() => stepCard),
      querySelectorAll: vi.fn(() => [stepCard])
    });
    stepBtn.closest = vi.fn(() => stepCard);

    const listEl = makeElement({
      querySelector: vi.fn(() => stepCard),
      querySelectorAll: vi.fn((selector) => {
        if (selector === '.grouping-row-section') return [section];
        if (selector === '.grouping-step-execute-btn') return [stepBtn];
        if (selector === '.grouping-step-card') return [stepCard];
        return [];
      })
    });

    stubDocument({
      'analysis-grouping': makeElement(),
      'grouping-list': listEl,
      'grouping-progress-fill': makeElement({ style: {} }),
      'grouping-progress-label': makeElement(),
      'grouping-execute-all-btn': makeElement()
    });

    renderGroupingSteps([
      {
        rowId: 'R3',
        steps: [{
          stepNumber: 1,
          stepType: 'move',
          moves: [{ wineId: 91, wineName: 'Chardonnay', from: 1, to: 2 }]
        }]
      }
    ], []);

    await triggerClick(stepBtn);

    expect(executeCellarMoves).toHaveBeenCalledWith([
      expect.objectContaining({
        wineId: 91,
        wineName: 'Chardonnay',
        from: 'R3C1',
        to: 'R3C2',
        from_storage_area_id: 'area-for-R3C1',
        to_storage_area_id: 'area-for-R3C2'
      })
    ]);
  });

  it('threads area IDs for cross-row grouping execution', async () => {
    const crossRowBtn = makeButton({ crossRowIndex: '0' }, { textContent: 'Move' });
    const listEl = makeElement({
      querySelectorAll: vi.fn((selector) => {
        if (selector === '.cross-row-execute-btn') return [crossRowBtn];
        if (selector === '.cross-row-dismiss-btn') return [];
        return [];
      })
    });

    stubDocument({
      'analysis-grouping': makeElement(),
      'grouping-list': listEl
    });

    renderGroupingSteps([], [
      { wineId: 101, wineName: 'Cabernet Franc', from: 'R5C1', to: 'R6C1' }
    ]);

    await triggerClick(crossRowBtn);

    expect(executeCellarMoves).toHaveBeenCalledWith([
      expect.objectContaining({
        wineId: 101,
        from: 'R5C1',
        to: 'R6C1',
        from_storage_area_id: 'area-for-R5C1',
        to_storage_area_id: 'area-for-R6C1'
      })
    ]);
  });
});
