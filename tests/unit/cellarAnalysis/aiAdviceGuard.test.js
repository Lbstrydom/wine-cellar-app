import { vi, describe, it, expect, beforeEach } from 'vitest';

// Stub minimal DOM used by handleGetAIAdvice
const mockBtn = { disabled: false, dataset: {}, textContent: '' };
const mockAdviceEl = { style: { display: '' }, innerHTML: '', scrollIntoView: vi.fn() };
const mockStatusEl = { textContent: '' };

// Initial stub — needed before import so module-level code that references
// document at import-time doesn't throw. Re-established in beforeEach to
// survive vi.unstubAllGlobals() calls from other suites in --no-isolate mode.
vi.stubGlobal('document', {
  getElementById: vi.fn((id) => {
    if (id === 'get-ai-advice-btn') return mockBtn;
    if (id === 'analysis-ai-advice') return mockAdviceEl;
    if (id === 'ai-advice-status') return mockStatusEl;
    return null;
  }),
});

// Mock dependencies before import
vi.mock('../../../public/js/api.js', () => ({
  analyseCellarAI: vi.fn(),
}));

vi.mock('../../../public/js/cellarAnalysis/state.js', () => ({
  getCurrentAnalysis: vi.fn(() => ({ needsZoneSetup: false })),
  setAIMoveJudgments: vi.fn(),
  switchWorkspace: vi.fn(),
  notifyWorkspaceTab: vi.fn(),
}));

vi.mock('../../../public/js/utils.js', () => ({
  escapeHtml: (s) => String(s ?? ''),
  showToast: vi.fn(),
  maybeShowAnalysisHint: vi.fn(),
}));

vi.mock('../../../public/js/cellarAnalysis/labels.js', () => ({
  CTA_AI_RECOMMENDATIONS: 'AI Cellar Review',
  CTA_RECONFIGURE_ZONES: 'Adjust Zone Layout',
}));

vi.mock('../../../public/js/cellarAnalysis/aiAdviceActions.js', () => ({
  wireAdviceActions: vi.fn(),
}));

vi.mock('../../../public/js/cellarAnalysis/moves.js', () => ({
  renderMoves: vi.fn(),
}));

vi.mock('../../../public/js/cellarAnalysis/fridge.js', () => ({
  renderAIFridgeAnnotations: vi.fn(),
}));

import { handleGetAIAdvice, _resetAiInFlight } from '../../../public/js/cellarAnalysis/aiAdvice.js';
import { analyseCellarAI } from '../../../public/js/api.js';

const mockAIResult = {
  aiAdvice: {
    summary: 'Test',
    confirmedMoves: [],
    modifiedMoves: [],
    rejectedMoves: [],
    fridgePlan: { toAdd: [], toRemove: [], coverageAfter: {} },
  },
};

/** Re-establish document stub — survives vi.unstubAllGlobals() from other suites. */
function stubDocument() {
  vi.stubGlobal('document', {
    getElementById: vi.fn((id) => {
      if (id === 'get-ai-advice-btn') return mockBtn;
      if (id === 'analysis-ai-advice') return mockAdviceEl;
      if (id === 'ai-advice-status') return mockStatusEl;
      return null;
    }),
  });
}

describe('handleGetAIAdvice in-flight guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetAiInFlight(); // Ensure clean state from prior suites in --no-isolate mode
    stubDocument(); // Re-establish after potential vi.unstubAllGlobals() from other suites
    mockBtn.disabled = false;
    mockBtn.textContent = 'AI Cellar Review';
    mockBtn.dataset.originalText = undefined;
    mockAdviceEl.style.display = '';
    mockAdviceEl.innerHTML = '';
    mockStatusEl.textContent = '';
    analyseCellarAI.mockResolvedValue(mockAIResult);
  });

  it('calls analyseCellarAI on first invocation', async () => {
    await handleGetAIAdvice();
    expect(analyseCellarAI).toHaveBeenCalledTimes(1);
  });

  it('prevents duplicate concurrent runs', async () => {
    const p1 = handleGetAIAdvice();
    const p2 = handleGetAIAdvice();
    await Promise.all([p1, p2]);

    expect(analyseCellarAI).toHaveBeenCalledTimes(1);
  });

  it('allows a second run after the first completes', async () => {
    await handleGetAIAdvice();
    await handleGetAIAdvice();
    expect(analyseCellarAI).toHaveBeenCalledTimes(2);
  });

  it('resets in-flight flag even on error', async () => {
    analyseCellarAI.mockRejectedValueOnce(new Error('API down'));
    await handleGetAIAdvice();

    analyseCellarAI.mockResolvedValue(mockAIResult);
    await handleGetAIAdvice();
    expect(analyseCellarAI).toHaveBeenCalledTimes(2);
  });
});

describe('handleGetAIAdvice autoTriggered option', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetAiInFlight(); // Ensure clean state from prior suites in --no-isolate mode
    stubDocument(); // Re-establish after potential vi.unstubAllGlobals() from other suites
    mockBtn.disabled = false;
    mockBtn.textContent = 'AI Cellar Review';
    mockBtn.dataset.originalText = undefined;
    mockAdviceEl.style.display = '';
    mockAdviceEl.innerHTML = '';
    mockAdviceEl.scrollIntoView.mockClear();
    mockStatusEl.textContent = '';
    analyseCellarAI.mockResolvedValue(mockAIResult);
  });

  it('scrolls to advice when not auto-triggered (default)', async () => {
    await handleGetAIAdvice();
    expect(mockAdviceEl.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
  });

  it('suppresses scroll when auto-triggered', async () => {
    await handleGetAIAdvice({ autoTriggered: true });
    expect(mockAdviceEl.scrollIntoView).not.toHaveBeenCalled();
  });
});
