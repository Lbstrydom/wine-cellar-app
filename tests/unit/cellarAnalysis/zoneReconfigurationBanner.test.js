/**
 * @fileoverview Unit tests for post-reconfiguration banner behavior.
 * Verifies success-banner simplification, workspace CTA wiring, and
 * alert suppression after reconfiguration.
 * @module tests/unit/cellarAnalysis/zoneReconfigurationBanner
 */

vi.mock('../../../public/js/utils.js', () => ({
  escapeHtml: vi.fn((v) => String(v ?? '')),
  showToast: vi.fn()
}));

vi.mock('../../../public/js/cellarAnalysis/zoneReconfigurationModal.js', () => ({
  openReconfigurationModal: vi.fn()
}));

vi.mock('../../../public/js/cellarAnalysis/state.js', () => ({
  switchWorkspace: vi.fn()
}));

import { switchWorkspace } from '../../../public/js/cellarAnalysis/state.js';
import { renderZoneReconfigurationBanner } from '../../../public/js/cellarAnalysis/zoneReconfigurationBanner.js';

describe('zoneReconfigurationBanner post-reconfig UX', () => {
  let elements;

  beforeEach(() => {
    vi.clearAllMocks();

    const makeElement = (id) => ({
      id,
      style: { display: '' },
      dataset: {},
      innerHTML: '',
      listeners: new Map(),
      addEventListener(type, handler) {
        this.listeners.set(type, handler);
      },
      querySelector(selector) {
        if (selector === '[data-action="view-updated-zones"]') {
          return elements.viewZonesBtn;
        }
        if (selector === '[data-action="review-placement-moves"]') {
          return elements.reviewMovesBtn;
        }
        return null;
      },
      scrollIntoView: vi.fn()
    });

    elements = {
      analysisAlerts: makeElement('analysis-alerts'),
      workspaceZones: makeElement('workspace-zones'),
      layoutDiffContainer: makeElement('layout-diff-container'),
      layoutProposalCta: makeElement('layout-proposal-cta'),
      analysisMoves: makeElement('analysis-moves'),
      viewZonesBtn: makeElement('view-zones-btn'),
      reviewMovesBtn: makeElement('review-moves-btn')
    };

    elements.layoutDiffContainer.style.display = 'none';
    elements.layoutProposalCta.style.display = 'block';

    vi.stubGlobal('document', {
      getElementById: vi.fn((id) => {
        if (id === 'analysis-alerts') return elements.analysisAlerts;
        if (id === 'workspace-zones') return elements.workspaceZones;
        if (id === 'layout-diff-container') return elements.layoutDiffContainer;
        if (id === 'layout-proposal-cta') return elements.layoutProposalCta;
        if (id === 'analysis-moves') return elements.analysisMoves;
        return null;
      })
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders simplified success banner and suppresses all appended alerts', () => {
    const analysis = {
      __justReconfigured: true,
      __reconfigResult: { zonesChanged: 3, actionsAutoSkipped: 1 },
      summary: { misplacedBottles: 12 },
      alerts: [
        { type: 'row_gaps', message: 'row gaps detected' },
        { type: 'zone_capacity_issue', message: 'overflow' }
      ]
    };

    const result = renderZoneReconfigurationBanner(analysis);

    expect(result.rendered).toBe(true);
    expect(result.remainingAlerts).toEqual([]);
    expect(elements.analysisAlerts.innerHTML).toContain('Zone Reconfiguration Complete');
    expect(elements.analysisAlerts.innerHTML).toContain('12 bottle(s)');
    expect(elements.analysisAlerts.innerHTML).toContain('View Updated Zones');
    expect(elements.analysisAlerts.innerHTML).toContain('Review Placement Moves');
    expect(elements.analysisAlerts.innerHTML).not.toContain('Updated Zone Layout');
    expect(elements.analysisAlerts.innerHTML).not.toContain('Suggested Moves section below');
  });

  it('wires success banner CTA buttons to the right workspace targets', () => {
    const analysis = {
      __justReconfigured: true,
      __reconfigResult: { zonesChanged: 2 },
      summary: { misplacedBottles: 4 },
      alerts: []
    };

    renderZoneReconfigurationBanner(analysis);

    const zonesClick = elements.viewZonesBtn.listeners.get('click');
    const placementClick = elements.reviewMovesBtn.listeners.get('click');

    expect(typeof zonesClick).toBe('function');
    expect(typeof placementClick).toBe('function');

    zonesClick();
    expect(switchWorkspace).toHaveBeenCalledWith('zones');
    expect(elements.workspaceZones.scrollIntoView).toHaveBeenCalled();

    placementClick();
    expect(switchWorkspace).toHaveBeenCalledWith('placement');
    expect(elements.layoutProposalCta.scrollIntoView).toHaveBeenCalled();
  });
});
