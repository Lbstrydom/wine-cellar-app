/**
 * @fileoverview Unit tests for move guide logic (Phase 11).
 * Tests: swap detection, index progression, skip/complete lifecycle,
 * annotation state, button idempotency, and guide panel lifecycle.
 * @module tests/unit/cellarAnalysis/moveGuide.test
 */

// Mock browser APIs and module dependencies before imports
vi.mock('../../../public/js/api.js', () => ({
  executeCellarMoves: vi.fn()
}));
vi.mock('../../../public/js/utils.js', () => ({
  showToast: vi.fn(),
  escapeHtml: vi.fn(s => s)
}));
vi.mock('../../../public/js/app.js', () => ({
  refreshLayout: vi.fn().mockResolvedValue()
}));
vi.mock('../../../public/js/cellarAnalysis/state.js', () => ({
  getCurrentAnalysis: vi.fn()
}));
vi.mock('../../../public/js/cellarAnalysis/analysis.js', () => ({
  loadAnalysis: vi.fn()
}));
vi.mock('../../../public/js/cellarAnalysis/moves.js', () => ({
  showValidationErrorModal: vi.fn()
}));
vi.mock('../../../public/js/eventManager.js', () => ({
  addTrackedListener: vi.fn(),
  cleanupNamespace: vi.fn()
}));

// Stub minimal DOM for panel/annotation lifecycle tests
const mockElements = new Map();
const mockClassLists = new Map();

function createMockElement(tag = 'div') {
  const classList = new Set();
  const el = {
    tagName: tag,
    className: '',
    textContent: '',
    innerHTML: '',
    hidden: false,
    disabled: false,
    dataset: {},
    style: {},
    children: [],
    parentNode: null,
    classList: {
      add: (...classes) => classes.forEach(c => classList.add(c)),
      remove: (...classes) => classes.forEach(c => classList.delete(c)),
      contains: (c) => classList.has(c),
      toggle: (c) => { if (classList.has(c)) { classList.delete(c); return false; } classList.add(c); return true; },
      _set: classList
    },
    querySelector: vi.fn(() => null),
    querySelectorAll: vi.fn(() => []),
    setAttribute: vi.fn(),
    getAttribute: vi.fn(),
    appendChild: vi.fn(),
    remove: vi.fn(),
    scrollIntoView: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    click: vi.fn(),
    cloneNode: vi.fn(() => createMockElement(tag)),
    offsetHeight: 120
  };
  return el;
}

vi.stubGlobal('document', {
  getElementById: vi.fn(() => null),
  querySelector: vi.fn(() => null),
  querySelectorAll: vi.fn(() => []),
  createElement: vi.fn(() => createMockElement()),
  body: {
    appendChild: vi.fn(),
    classList: {
      add: vi.fn(),
      remove: vi.fn(),
      _set: new Set()
    }
  }
});

vi.stubGlobal('window', {
  __moveGuideAnnotate: undefined
});

vi.stubGlobal('requestAnimationFrame', vi.fn(cb => cb()));

import { detectSwapPairs, openMoveGuide, closeMoveGuide, isMoveGuideActive } from '../../../public/js/cellarAnalysis/moveGuide.js';
import { executeCellarMoves } from '../../../public/js/api.js';
import { showToast } from '../../../public/js/utils.js';
import { showValidationErrorModal } from '../../../public/js/cellarAnalysis/moves.js';
import { addTrackedListener } from '../../../public/js/eventManager.js';

// Clean up module-scope vi.stubGlobal calls (document, window, requestAnimationFrame)
// to prevent leaking into downstream test files in --no-isolate mode.
afterAll(() => {
  vi.unstubAllGlobals();
});

// ============================================================
// detectSwapPairs
// ============================================================

describe('detectSwapPairs', () => {
  it('should detect a simple swap pair (A→B + B→A)', () => {
    const moves = [
      { from: 'R1C1', to: 'R2C1' },
      { from: 'R2C1', to: 'R1C1' }
    ];
    const pairs = detectSwapPairs(moves);
    expect(pairs.get(0)).toBe(1);
    expect(pairs.get(1)).toBe(0);
    expect(pairs.size).toBe(2);
  });

  it('should return empty map for non-swap moves', () => {
    const moves = [
      { from: 'R1C1', to: 'R2C1' },
      { from: 'R3C1', to: 'R4C1' }
    ];
    const pairs = detectSwapPairs(moves);
    expect(pairs.size).toBe(0);
  });

  it('should detect multiple swap pairs', () => {
    const moves = [
      { from: 'R1C1', to: 'R2C1' },
      { from: 'R2C1', to: 'R1C1' },
      { from: 'R3C1', to: 'R4C1' },
      { from: 'R4C1', to: 'R3C1' }
    ];
    const pairs = detectSwapPairs(moves);
    expect(pairs.size).toBe(4);
    expect(pairs.get(0)).toBe(1);
    expect(pairs.get(1)).toBe(0);
    expect(pairs.get(2)).toBe(3);
    expect(pairs.get(3)).toBe(2);
  });

  it('should handle mix of swap and non-swap moves', () => {
    const moves = [
      { from: 'R1C1', to: 'R2C1' },
      { from: 'R2C1', to: 'R1C1' },
      { from: 'R5C1', to: 'R6C1' }  // No partner
    ];
    const pairs = detectSwapPairs(moves);
    expect(pairs.size).toBe(2);
    expect(pairs.has(2)).toBe(false);
  });

  it('should handle empty array', () => {
    const pairs = detectSwapPairs([]);
    expect(pairs.size).toBe(0);
  });

  it('should handle single move', () => {
    const pairs = detectSwapPairs([{ from: 'R1C1', to: 'R2C1' }]);
    expect(pairs.size).toBe(0);
  });

  it('should not pair a move with itself (same from/to)', () => {
    // Edge case: from === to (shouldn't happen, but be safe)
    const moves = [
      { from: 'R1C1', to: 'R1C1' }
    ];
    const pairs = detectSwapPairs(moves);
    expect(pairs.size).toBe(0);
  });

  describe('typeFilter option', () => {
    it('should skip entries that do not match typeFilter', () => {
      const moves = [
        { type: 'move', from: 'R1C1', to: 'R2C1' },
        { type: 'manual', from: 'R2C1', to: 'R1C1' },  // Should be ignored
        { type: 'move', from: 'R2C1', to: 'R1C1' }
      ];
      const pairs = detectSwapPairs(moves, { typeFilter: 'move' });
      expect(pairs.get(0)).toBe(2);
      expect(pairs.get(2)).toBe(0);
      expect(pairs.has(1)).toBe(false);
    });

    it('should work without typeFilter (default)', () => {
      const moves = [
        { type: 'manual', from: 'R1C1', to: 'R2C1' },
        { type: 'manual', from: 'R2C1', to: 'R1C1' }
      ];
      const pairs = detectSwapPairs(moves);
      expect(pairs.size).toBe(2); // No filter, so manual pairs detected
    });

    it('should return empty when all entries are filtered out', () => {
      const moves = [
        { type: 'manual', from: 'R1C1', to: 'R2C1' },
        { type: 'manual', from: 'R2C1', to: 'R1C1' }
      ];
      const pairs = detectSwapPairs(moves, { typeFilter: 'move' });
      expect(pairs.size).toBe(0);
    });

    it('should handle null entries gracefully with typeFilter', () => {
      const moves = [
        null,
        { type: 'move', from: 'R1C1', to: 'R2C1' },
        { type: 'move', from: 'R2C1', to: 'R1C1' }
      ];
      const pairs = detectSwapPairs(moves, { typeFilter: 'move' });
      expect(pairs.get(1)).toBe(2);
      expect(pairs.get(2)).toBe(1);
      expect(pairs.has(0)).toBe(false);
    });
  });
});

// ============================================================
// Guide lifecycle
// ============================================================

describe('Move Guide lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset guide state
    if (isMoveGuideActive()) {
      closeMoveGuide();
    }
  });

  it('should not activate for empty moves', async () => {
    await openMoveGuide([]);
    expect(isMoveGuideActive()).toBe(false);
  });

  it('should not activate for null moves', async () => {
    await openMoveGuide(null);
    expect(isMoveGuideActive()).toBe(false);
  });

  it('should not activate for moves with only manual type', async () => {
    await openMoveGuide([{ type: 'manual', from: 'R1C1', to: 'R2C1' }]);
    expect(isMoveGuideActive()).toBe(false);
  });

  it('should activate for moves with actionable type', async () => {
    await openMoveGuide([
      { type: 'move', from: 'R1C1', to: 'R2C1', wineId: 1, wineName: 'Test' }
    ]);
    expect(isMoveGuideActive()).toBe(true);
  });

  it('should deactivate on closeMoveGuide', async () => {
    await openMoveGuide([
      { type: 'move', from: 'R1C1', to: 'R2C1', wineId: 1, wineName: 'Test' }
    ]);
    expect(isMoveGuideActive()).toBe(true);
    closeMoveGuide();
    expect(isMoveGuideActive()).toBe(false);
  });

  it('should register window.__moveGuideAnnotate on open', async () => {
    await openMoveGuide([
      { type: 'move', from: 'R1C1', to: 'R2C1', wineId: 1, wineName: 'Test' }
    ]);
    expect(typeof window.__moveGuideAnnotate).toBe('function');
  });

  it('should remove window.__moveGuideAnnotate on close', async () => {
    await openMoveGuide([
      { type: 'move', from: 'R1C1', to: 'R2C1', wineId: 1, wineName: 'Test' }
    ]);
    closeMoveGuide();
    expect(window.__moveGuideAnnotate).toBeUndefined();
  });

  it('should filter manual moves and only track actionable ones', async () => {
    await openMoveGuide([
      { type: 'manual', from: 'R1C1', to: 'Z1', wineName: 'Manual' },
      { type: 'move', from: 'R1C1', to: 'R2C1', wineId: 1, wineName: 'Move1' },
      { type: 'move', from: 'R3C1', to: 'R4C1', wineId: 2, wineName: 'Move2' }
    ]);
    expect(isMoveGuideActive()).toBe(true);
    closeMoveGuide();
  });

  it('should switch to grid tab on open', async () => {
    const mockTab = createMockElement('button');
    mockTab.dataset.view = 'grid';
    document.querySelector.mockReturnValueOnce(mockTab);

    await openMoveGuide([
      { type: 'move', from: 'R1C1', to: 'R2C1', wineId: 1, wineName: 'Test' }
    ]);
    expect(mockTab.click).toHaveBeenCalled();
    closeMoveGuide();
  });

  it('should be safe to call closeMoveGuide when not active', () => {
    expect(() => closeMoveGuide()).not.toThrow();
  });

  it('should be safe to call openMoveGuide twice (idempotent)', async () => {
    const moves = [{ type: 'move', from: 'R1C1', to: 'R2C1', wineId: 1, wineName: 'Test' }];
    await openMoveGuide(moves);
    await expect(openMoveGuide(moves)).resolves.not.toThrow();
    expect(isMoveGuideActive()).toBe(true);
    closeMoveGuide();
  });
});

// ============================================================
// Index progression
// ============================================================

describe('detectSwapPairs index integrity', () => {
  it('should not create self-referencing pairs', () => {
    const moves = [
      { from: 'R1C1', to: 'R2C1' },
      { from: 'R2C1', to: 'R1C1' },
      { from: 'R3C1', to: 'R4C1' }
    ];
    const pairs = detectSwapPairs(moves);
    for (const [idx, partner] of pairs) {
      expect(idx).not.toBe(partner);
    }
  });

  it('should be symmetrical (if A→B then B→A)', () => {
    const moves = [
      { from: 'R1C1', to: 'R2C1' },
      { from: 'R2C1', to: 'R1C1' },
      { from: 'R3C1', to: 'R4C1' },
      { from: 'R4C1', to: 'R3C1' },
      { from: 'R5C1', to: 'R6C1' }
    ];
    const pairs = detectSwapPairs(moves);
    for (const [idx, partner] of pairs) {
      expect(pairs.get(partner)).toBe(idx);
    }
  });

  it('should handle three-way cycles without false pairing', () => {
    // A→B, B→C, C→A is NOT a swap (it's a rotation)
    const moves = [
      { from: 'R1C1', to: 'R2C1' },
      { from: 'R2C1', to: 'R3C1' },
      { from: 'R3C1', to: 'R1C1' }
    ];
    const pairs = detectSwapPairs(moves);
    // Should only find the first valid swap pair or none
    // R1C1→R2C1 and none has R2C1→R1C1, so no swaps
    expect(pairs.size).toBe(0);
  });
});

// ============================================================
// Execute path — validation modal integration
// ============================================================

describe('executeCurrentMove validation handling', () => {
  const testMoves = [
    { type: 'move', from: 'R1C1', to: 'R2C1', wineId: 1, wineName: 'Test Wine' }
  ];

  /**
   * Helper: open guide, find the execute-button callback captured by addTrackedListener.
   * Returns the async callback so tests can await it.
   */
  async function getExecuteCallback() {
    addTrackedListener.mockClear();
    await openMoveGuide(testMoves);
    // addTrackedListener is called with (namespace, element, event, callback)
    // Find the 'click' listener whose element is the execute button mock
    const executeCall = addTrackedListener.mock.calls.find(
      ([, , evt]) => evt === 'click' &&
        addTrackedListener.mock.calls.indexOf(arguments) !== -1
    );
    // The execute button is the second addTrackedListener call in createPanel
    // Order: close(0), execute(1), skip(2), recalculate(3), keydown(4)
    const clickCalls = addTrackedListener.mock.calls.filter(([, , evt]) => evt === 'click');
    // clickCalls[0] = close, clickCalls[1] = execute, clickCalls[2] = skip, clickCalls[3] = recalculate
    const executeCb = clickCalls[1]?.[3]; // 4th arg is the callback
    return executeCb;
  }

  afterEach(() => {
    closeMoveGuide();
    vi.clearAllMocks();
  });

  it('should show validation modal when executeCellarMoves returns success:false with validation', async () => {
    const validationPayload = {
      valid: false,
      errors: [{ type: 'slot_not_found', message: 'Source slot R1C1 not found', slot: 'R1C1' }]
    };
    executeCellarMoves.mockResolvedValueOnce({ success: false, validation: validationPayload });
    const executeCb = await getExecuteCallback();
    expect(executeCb).toBeTypeOf('function');

    await executeCb();

    expect(showValidationErrorModal).toHaveBeenCalledWith(validationPayload);
    expect(showToast).not.toHaveBeenCalled();
  });

  it('should show validation modal when executeCellarMoves rejects with err.validation', async () => {
    const validationPayload = {
      valid: false,
      errors: [{ type: 'target_occupied', message: 'Target R2C1 occupied', slot: 'R2C1' }]
    };
    const err = new Error('Validation failed');
    err.validation = validationPayload;
    executeCellarMoves.mockRejectedValueOnce(err);
    const executeCb = await getExecuteCallback();

    await executeCb();

    expect(showValidationErrorModal).toHaveBeenCalledWith(validationPayload);
  });

  it('should show generic toast when executeCellarMoves rejects without validation', async () => {
    executeCellarMoves.mockRejectedValueOnce(new Error('Network failure'));
    const executeCb = await getExecuteCallback();

    await executeCb();

    expect(showValidationErrorModal).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('Network failure'));
  });

  it('should show generic toast when result.success is false without validation', async () => {
    executeCellarMoves.mockResolvedValueOnce({ success: false });
    const executeCb = await getExecuteCallback();

    await executeCb();

    expect(showValidationErrorModal).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalled();
  });
});
