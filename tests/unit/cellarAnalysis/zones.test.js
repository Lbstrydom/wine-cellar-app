/**
 * @fileoverview Unit tests for zone setup CTA wiring.
 * @module tests/unit/cellarAnalysis/zones
 */

vi.mock('../../../public/js/api.js', () => ({
  executeCellarMoves: vi.fn(),
  getZoneLayoutProposal: vi.fn(),
  confirmZoneLayout: vi.fn(),
  getConsolidationMoves: vi.fn()
}));

vi.mock('../../../public/js/utils.js', () => ({
  showToast: vi.fn(),
  escapeHtml: vi.fn((v) => String(v || ''))
}));

vi.mock('../../../public/js/app.js', () => ({
  refreshLayout: vi.fn()
}));

vi.mock('../../../public/js/cellarAnalysis/state.js', () => ({
  getCurrentProposal: vi.fn(),
  setCurrentProposal: vi.fn(),
  getCurrentZoneMoves: vi.fn(),
  setCurrentZoneMoves: vi.fn(),
  getCurrentZoneIndex: vi.fn(() => 0),
  setCurrentZoneIndex: vi.fn()
}));

vi.mock('../../../public/js/cellarAnalysis/analysis.js', () => ({
  loadAnalysis: vi.fn()
}));

vi.mock('../../../public/js/cellarAnalysis/zoneProposalView.js', () => ({
  renderZoneProposal: vi.fn(() => '<div>proposal</div>')
}));

import { getZoneLayoutProposal, confirmZoneLayout } from '../../../public/js/api.js';
import { showToast } from '../../../public/js/utils.js';
import { getCurrentProposal, setCurrentProposal } from '../../../public/js/cellarAnalysis/state.js';
import { startZoneSetup, handleConfirmLayout } from '../../../public/js/cellarAnalysis/zones.js';

function makeElement() {
  return {
    style: {
      display: '',
      setProperty(prop, value) {
        this[prop] = value;
      }
    },
    innerHTML: '',
    disabled: false
  };
}

describe('cellarAnalysis/zones CTA wiring', () => {
  let elements;

  beforeEach(() => {
    vi.clearAllMocks();

    elements = {
      'zone-setup-wizard': makeElement(),
      'zone-proposal-list': makeElement(),
      'wizard-step-1': makeElement(),
      'wizard-step-2': makeElement(),
      'confirm-layout-btn': makeElement()
    };

    // Use vi.stubGlobal instead of direct assignment to avoid corrupting
    // property descriptors for downstream test files in --no-isolate mode.
    vi.stubGlobal('document', {
      getElementById: vi.fn((id) => elements[id] || null)
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps Confirm Layout disabled when no zones qualify for dedicated rows', async () => {
    getZoneLayoutProposal.mockResolvedValue({
      proposals: [],
      underThresholdZones: [{ zoneId: 'portugal', bottleCount: 2 }]
    });

    await startZoneSetup();

    expect(setCurrentProposal).toHaveBeenCalled();
    expect(elements['confirm-layout-btn'].disabled).toBe(true);
  });

  it('enables Confirm Layout when allocatable proposals exist', async () => {
    getZoneLayoutProposal.mockResolvedValue({
      proposals: [{ zoneId: 'cabernet', assignedRows: ['R8'], bottleCount: 9 }],
      underThresholdZones: []
    });

    await startZoneSetup();

    expect(elements['confirm-layout-btn'].disabled).toBe(false);
  });

  it('does not call confirm endpoint when proposals list is empty', async () => {
    getCurrentProposal.mockReturnValue({ proposals: [] });

    await handleConfirmLayout();

    expect(confirmZoneLayout).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith('No dedicated rows to confirm yet');
  });

  it('renders empty zone cards so row ownership remains visible', async () => {
    const { renderZoneNarratives } = await import('../../../public/js/cellarAnalysis/zones.js');

    elements['analysis-zones'] = makeElement();
    elements['zone-cards-grid'] = makeElement();

    renderZoneNarratives([
      {
        zoneId: 'white_reserve',
        displayName: 'White Reserve',
        rows: ['R1'],
        currentComposition: { bottleCount: 0, topGrapes: [], topCountries: [] },
        health: { status: 'healthy', utilizationPercent: 0 },
        intent: null
      }
    ]);

    expect(elements['analysis-zones'].style.display).toBe('block');
    expect(elements['zone-cards-grid'].innerHTML).toContain('White Reserve');
    expect(elements['zone-cards-grid'].innerHTML).toContain('Rows: R1');
    expect(elements['zone-cards-grid'].innerHTML).toContain('0 bottles');
    expect(elements['zone-cards-grid'].innerHTML).toContain('Currently: empty');
  });
});

