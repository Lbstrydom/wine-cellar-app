/**
 * @fileoverview Unit tests for the layoutDiffOrchestrator module.
 * Covers: renderLayoutProposalCTA (CTA rendering states) and
 * closeDiffView (DOM teardown, focus-mode restore, state cleanup).
 * @module tests/unit/cellarAnalysis/layoutDiffOrchestrator
 */

// ── Module mocks ────────────────────────────────────────────
vi.mock('../../../public/js/utils.js', () => ({
  showToast: vi.fn(),
  shortenWineName: vi.fn(n => String(n ?? '').slice(0, 15)),
  escapeHtml: vi.fn(s => String(s ?? ''))
}));

vi.mock('../../../public/js/app.js', () => ({
  refreshLayout: vi.fn().mockResolvedValue()
}));

vi.mock('../../../public/js/api.js', () => ({
  executeCellarMoves: vi.fn(),
  validateMoves: vi.fn(),
  getProposedBottleLayout: vi.fn(),
  getZoneMap: vi.fn().mockResolvedValue({})
}));

vi.mock('../../../public/js/cellarAnalysis/state.js', () => ({
  getCurrentAnalysis: vi.fn(),
  getLayoutProposal: vi.fn(),
  setLayoutProposal: vi.fn(),
  getLayoutFlowState: vi.fn(),
  setLayoutFlowState: vi.fn(),
  getCurrentLayoutSnapshot: vi.fn(),
  setCurrentLayoutSnapshot: vi.fn()
}));

vi.mock('../../../public/js/cellarAnalysis/layoutDiffGrid.js', () => ({
  renderDiffGrid: vi.fn(() => ({ stats: { stay: 0, moveIn: 0, moveOut: 0, swap: 0, swapPairs: 0, empty: 0, unplaceable: 0 }, classifiedSlots: [] })),
  classifySlot: vi.fn(),
  buildSwapSlotSet: vi.fn(() => new Set()),
  computeDiffStats: vi.fn(() => ({}))
}));

vi.mock('../../../public/js/cellarAnalysis/layoutDiffControls.js', () => ({
  renderViewToggle: vi.fn(),
  renderDiffSummary: vi.fn(),
  renderApprovalCTA: vi.fn(),
  applyViewMode: vi.fn(),
  updateApplyButtonCount: vi.fn(),
  toggleResetButton: vi.fn(),
  ViewMode: { PROPOSED: 'proposed', CURRENT: 'current', CHANGES: 'changes' }
}));

vi.mock('../../../public/js/cellarAnalysis/layoutDiffDragDrop.js', () => ({
  enableProposedLayoutEditing: vi.fn(),
  disableProposedLayoutEditing: vi.fn(),
  getUndoStack: vi.fn(() => []),
  popUndo: vi.fn(),
  clearUndoStack: vi.fn(),
  hasOverrides: vi.fn(() => false)
}));

vi.mock('../../../public/js/cellarAnalysis/analysis.js', () => ({
  refreshAnalysis: vi.fn().mockResolvedValue()
}));

import { renderLayoutProposalCTA, closeDiffView } from '../../../public/js/cellarAnalysis/layoutDiffOrchestrator.js';
import { setLayoutFlowState } from '../../../public/js/cellarAnalysis/state.js';
import { disableProposedLayoutEditing } from '../../../public/js/cellarAnalysis/layoutDiffDragDrop.js';

// ───────────────────────────────────────────────────────────
// DOM helpers
// ───────────────────────────────────────────────────────────

function makeEl(overrides = {}) {
  return {
    innerHTML: '',
    style: { display: '' },
    querySelector: vi.fn(() => null),
    querySelectorAll: vi.fn(() => []),
    addEventListener: vi.fn(),
    scrollIntoView: vi.fn(),
    ...overrides
  };
}

// ───────────────────────────────────────────────────────────
// renderLayoutProposalCTA
// ───────────────────────────────────────────────────────────

describe('renderLayoutProposalCTA', () => {
  let ctaEl;

  beforeEach(() => {
    vi.clearAllMocks();
    ctaEl = makeEl();

    vi.stubGlobal('document', {
      getElementById: vi.fn(id => id === 'layout-proposal-cta' ? ctaEl : null),
      createElement: vi.fn(() => makeEl()),
      querySelector: vi.fn(() => null)
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does nothing when CTA element not in DOM', () => {
    vi.stubGlobal('document', { getElementById: vi.fn(() => null) });
    // Should not throw
    expect(() => renderLayoutProposalCTA({})).not.toThrow();
  });

  it('hides CTA and clears content when analysis has no proposal', () => {
    renderLayoutProposalCTA({ layoutProposal: null });
    expect(ctaEl.style.display).toBe('none');
    expect(ctaEl.innerHTML).toBe('');
  });

  it('hides CTA when passed null analysis', () => {
    renderLayoutProposalCTA(null);
    expect(ctaEl.style.display).toBe('none');
  });

  it('hides CTA when passed undefined analysis', () => {
    renderLayoutProposalCTA(undefined);
    expect(ctaEl.style.display).toBe('none');
  });

  it('shows "optimally organised" message when moveCount is 0', () => {
    renderLayoutProposalCTA({
      layoutProposal: { sortPlan: [], stats: { stayInPlace: 42 } }
    });
    expect(ctaEl.style.display).toBe('block');
    expect(ctaEl.innerHTML).toContain('optimally organised');
    expect(ctaEl.innerHTML).toContain('42');
  });

  it('shows "optimally organised" when sortPlan is missing', () => {
    renderLayoutProposalCTA({
      layoutProposal: { stats: { stayInPlace: 10 } }
    });
    expect(ctaEl.style.display).toBe('block');
    expect(ctaEl.innerHTML).toContain('optimally organised');
  });

  it('shows actionable CTA with move count when sortPlan has entries', () => {
    const plan = [
      { from: 'R1C1', to: 'R2C1' },
      { from: 'R3C1', to: 'R4C1' }
    ];
    renderLayoutProposalCTA({
      layoutProposal: { sortPlan: plan, stats: { stayInPlace: 8 } }
    });
    expect(ctaEl.style.display).toBe('block');
    expect(ctaEl.innerHTML).toContain('2 moves');
    expect(ctaEl.innerHTML).toContain('layout-proposal-cta--actionable');
  });

  it('uses singular "move" for exactly 1 move', () => {
    renderLayoutProposalCTA({
      layoutProposal: { sortPlan: [{ from: 'R1C1', to: 'R2C1' }], stats: { stayInPlace: 5 } }
    });
    expect(ctaEl.innerHTML).toContain('1 move to optimal');
    expect(ctaEl.innerHTML).not.toContain('1 moves');
  });

  it('wires the "View Proposed Layout" button when moves exist', () => {
    const mockBtn = makeEl();
    ctaEl.querySelector = vi.fn(sel =>
      sel === '.layout-proposal-view-btn' ? mockBtn : null
    );
    renderLayoutProposalCTA({
      layoutProposal: { sortPlan: [{ from: 'R1C1', to: 'R2C1' }], stats: { stayInPlace: 5 } }
    });
    // Button event should have been registered
    expect(mockBtn.addEventListener).toHaveBeenCalledWith('click', expect.any(Function));
  });

  it('reports stayCount from stats.stayInPlace using ?? (not ||)', () => {
    // stayInPlace = 0 is valid; || would yield wrong default
    renderLayoutProposalCTA({
      layoutProposal: { sortPlan: [], stats: { stayInPlace: 0 } }
    });
    expect(ctaEl.innerHTML).toContain('All 0 bottles');
  });
});

// ───────────────────────────────────────────────────────────
// closeDiffView
// ───────────────────────────────────────────────────────────

describe('closeDiffView', () => {
  let elements;

  beforeEach(() => {
    vi.clearAllMocks();

    elements = {
      'layout-diff-container': makeEl({ innerHTML: '<p>old content</p>' }),
      'layout-proposal-cta': makeEl({ style: { display: 'none' } }),
      'analysis-moves': makeEl({ style: { display: 'none' } }),
      'analysis-compaction': makeEl({ style: { display: 'none' } }),
      'analysis-summary': makeEl({ style: { display: 'none' } }),
      'analysis-alerts': makeEl({ style: { display: 'none' } }),
      'analysis-zones': makeEl({ style: { display: 'none' } })
    };

    vi.stubGlobal('document', {
      getElementById: vi.fn(id => elements[id] || null)
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('hides the diff container and clears its content', () => {
    closeDiffView();
    expect(elements['layout-diff-container'].style.display).toBe('none');
    expect(elements['layout-diff-container'].innerHTML).toBe('');
  });

  it('restores CTA banner visibility', () => {
    elements['layout-proposal-cta'].style.display = 'none';
    closeDiffView();
    expect(elements['layout-proposal-cta'].style.display).toBe('');
  });

  it('restores analysis-moves section visibility', () => {
    elements['analysis-moves'].style.display = 'none';
    closeDiffView();
    expect(elements['analysis-moves'].style.display).toBe('');
  });

  it('restores focus-mode hidden sections (summary, alerts, zones)', () => {
    for (const id of ['analysis-summary', 'analysis-alerts', 'analysis-zones']) {
      elements[id].style.display = 'none';
    }
    closeDiffView();
    expect(elements['analysis-summary'].style.display).toBe('');
    expect(elements['analysis-alerts'].style.display).toBe('');
    expect(elements['analysis-zones'].style.display).toBe('');
  });

  it('calls disableProposedLayoutEditing', () => {
    closeDiffView();
    expect(disableProposedLayoutEditing).toHaveBeenCalled();
  });

  it('resets flow state to idle', () => {
    closeDiffView();
    expect(setLayoutFlowState).toHaveBeenCalledWith('idle');
  });

  it('does not throw when diff container element is absent', () => {
    delete elements['layout-diff-container'];
    expect(() => closeDiffView()).not.toThrow();
  });

  it('does not throw when CTA element is absent', () => {
    delete elements['layout-proposal-cta'];
    expect(() => closeDiffView()).not.toThrow();
  });

  it('can be called multiple times without error', () => {
    expect(() => {
      closeDiffView();
      closeDiffView();
    }).not.toThrow();
    expect(disableProposedLayoutEditing).toHaveBeenCalledTimes(2);
  });
});
