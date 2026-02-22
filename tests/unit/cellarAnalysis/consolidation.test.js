/**
 * @fileoverview Unit tests for consolidation cards rendering and wiring (Phase B4).
 * @module tests/unit/cellarAnalysis/consolidation
 */

vi.mock('../../../public/js/utils.js', () => ({
  escapeHtml: vi.fn(v => String(v ?? ''))
}));

import { renderConsolidationCards } from '../../../public/js/cellarAnalysis/consolidation.js';

describe('renderConsolidationCards', () => {
  let containerEl;
  let movesEl;
  let buttonEl;

  beforeEach(() => {
    vi.clearAllMocks();

    buttonEl = {
      _clickHandler: null,
      addEventListener: vi.fn((event, handler) => {
        if (event === 'click') buttonEl._clickHandler = handler;
      })
    };

    containerEl = {
      innerHTML: '',
      style: { display: '' },
      querySelectorAll: vi.fn(() => [buttonEl])
    };

    movesEl = {
      scrollIntoView: vi.fn()
    };

    // Use vi.stubGlobal instead of direct assignment to avoid corrupting
    // property descriptors for downstream test files (e.g. aiAdviceGuard.test.js)
    // that also use vi.stubGlobal('document', ...).
    vi.stubGlobal('document', {
      getElementById: vi.fn((id) => {
        if (id === 'zone-consolidation') return containerEl;
        if (id === 'analysis-moves') return movesEl;
        return null;
      })
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('hides the section when there are no consolidation opportunities', () => {
    renderConsolidationCards({ bottleScan: { consolidationOpportunities: [] } });

    expect(containerEl.innerHTML).toBe('');
    expect(containerEl.style.display).toBe('none');
    expect(containerEl.querySelectorAll).not.toHaveBeenCalled();
  });

  it('renders cards and wires View Moves button to scroll to suggested moves', () => {
    renderConsolidationCards({
      bottleScan: {
        consolidationOpportunities: [
          {
            zoneId: 'shiraz',
            displayName: 'Shiraz',
            scattered: [
              {
                wineId: 10,
                wineName: 'Barossa Shiraz',
                currentSlot: 'R8C1',
                physicalRowZone: 'Red Buffer'
              }
            ]
          }
        ]
      }
    });

    expect(containerEl.style.display).toBe('block');
    expect(containerEl.innerHTML).toContain('Zone Consolidation');
    expect(containerEl.innerHTML).toContain('Shiraz');
    expect(containerEl.innerHTML).toContain('View Moves');
    expect(buttonEl.addEventListener).toHaveBeenCalled();

    buttonEl._clickHandler?.();
    expect(movesEl.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
  });
});
