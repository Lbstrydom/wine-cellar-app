// @vitest-environment jsdom
/**
 * @fileoverview Unit tests for the wine research modal (search before buying).
 * Tests modal lifecycle, DOM rendering, accessibility, error handling,
 * and stale response guards.
 * @module tests/unit/recipes/wineResearch
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// ── Mocks (must precede imports) ──────────────────────────────────────────────

const mockEnrichWine = vi.fn();

vi.mock('../../../public/js/api/index.js', () => ({
  enrichWine: (...args) => mockEnrichWine(...args)
}));

vi.mock('../../../public/js/utils.js', () => ({
  escapeHtml: (str) => {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  },
  showToast: vi.fn()
}));

vi.mock('../../../public/js/wineProfile.js', () => ({
  renderWineProfile: vi.fn((container, narrative) => {
    if (container && narrative) {
      const el = document.createElement('div');
      el.className = 'wine-profile-section';
      el.textContent = narrative;
      container.appendChild(el);
    }
  })
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { openWineResearchModal } from '../../../public/js/recipes/wineResearch.js';
import { renderWineProfile } from '../../../public/js/wineProfile.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Minimal cart item for testing */
const CART_ITEM = {
  id: 42,
  wine_name: 'Kanonkop Pinotage',
  vintage: 2019,
  producer: 'Kanonkop',
  colour: 'red',
  grapes: 'Pinotage',
  region: 'Stellenbosch',
  country: 'South Africa',
  status: 'planned',
  quantity: 2,
  style_id: 'red_full'
};

/** Sample enrichment response matching acquisitionWorkflow.js:134-170 */
const ENRICH_RESPONSE = {
  ratings: {
    ratings: [
      {
        source: 'james_suckling',
        source_short: 'Suckling',
        source_lens: 'critics',
        score_type: 'points',
        raw_score: '95',
        raw_score_numeric: 95,
        confidence: 'high',
        vintage_match: 'exact',
        source_url: 'https://example.com'
      },
      {
        source: 'platters',
        source_short: "Platter's",
        source_lens: 'critics',
        score_type: 'stars',
        raw_score: '4.5★',
        raw_score_numeric: 4.5,
        confidence: 'high',
        vintage_match: 'exact'
      },
      {
        source: 'michelangelo',
        source_short: 'Michelangelo',
        source_lens: 'competition',
        score_type: 'medal',
        raw_score: 'Gold',
        award_name: 'Gold',
        confidence: 'medium',
        vintage_match: 'inferred',
        competition_year: 2023
      }
    ],
    drinking_window: { drink_from: 2022, drink_by: 2030, peak: 2026, recommendation: 'Approaching peak' },
    food_pairings: ['grilled lamb', 'braai', 'aged cheddar'],
    style_summary: 'Bold, full-bodied South African Pinotage with smoky complexity',
    grape_varieties: ['Pinotage'],
    _narrative: 'This is a remarkable wine from Stellenbosch.',
    _metadata: { method: 'claude-web-search', sources_count: 5, duration_ms: 23400 },
    _sources: [{ url: 'https://example.com', title: 'Source' }]
  },
  drinkingWindows: [{ source: 'james_suckling', drink_from_year: 2022, drink_by_year: 2030 }],
  error: null
};

function getOverlay() {
  return document.querySelector('.wine-research-overlay');
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('wineResearch modal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    // Clean up any remaining overlays
    const overlay = getOverlay();
    if (overlay) overlay.remove();
  });

  describe('modal lifecycle', () => {
    it('builds modal with correct wine name and vintage in title', async () => {
      mockEnrichWine.mockResolvedValue(ENRICH_RESPONSE);
      await openWineResearchModal(CART_ITEM);

      const overlay = getOverlay();
      expect(overlay).toBeTruthy();
      const title = overlay.querySelector('h2');
      expect(title.textContent).toContain('Kanonkop Pinotage');
      expect(title.textContent).toContain('2019');
    });

    it('shows producer in subtitle', async () => {
      mockEnrichWine.mockResolvedValue(ENRICH_RESPONSE);
      await openWineResearchModal(CART_ITEM);

      const subtitle = getOverlay().querySelector('.wine-research-subtitle');
      expect(subtitle.textContent).toContain('Kanonkop');
      expect(subtitle.textContent).toContain('Research before buying');
    });

    it('close button removes overlay from DOM', async () => {
      mockEnrichWine.mockResolvedValue(ENRICH_RESPONSE);
      await openWineResearchModal(CART_ITEM);

      expect(getOverlay()).toBeTruthy();
      getOverlay().querySelector('.wine-research-close').click();
      expect(getOverlay()).toBeNull();
    });

    it('bottom close button removes overlay', async () => {
      mockEnrichWine.mockResolvedValue(ENRICH_RESPONSE);
      await openWineResearchModal(CART_ITEM);

      getOverlay().querySelector('.wine-research-close-btn').click();
      expect(getOverlay()).toBeNull();
    });

    it('backdrop click closes modal', async () => {
      mockEnrichWine.mockResolvedValue(ENRICH_RESPONSE);
      await openWineResearchModal(CART_ITEM);

      const overlay = getOverlay();
      // Click on the overlay itself, not the inner modal
      overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(getOverlay()).toBeNull();
    });

    it('click inside modal does not close', async () => {
      mockEnrichWine.mockResolvedValue(ENRICH_RESPONSE);
      await openWineResearchModal(CART_ITEM);

      const modal = getOverlay().querySelector('.wine-research-modal');
      modal.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(getOverlay()).toBeTruthy();
    });

    it('Escape key closes modal', async () => {
      mockEnrichWine.mockResolvedValue(ENRICH_RESPONSE);
      await openWineResearchModal(CART_ITEM);

      expect(getOverlay()).toBeTruthy();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      expect(getOverlay()).toBeNull();
    });

    it('double-open guard: only one overlay at a time', async () => {
      mockEnrichWine.mockResolvedValue(ENRICH_RESPONSE);
      await openWineResearchModal(CART_ITEM);
      await openWineResearchModal({ ...CART_ITEM, wine_name: 'Second Wine' });

      const overlays = document.querySelectorAll('.wine-research-overlay');
      expect(overlays.length).toBe(1);
      expect(overlays[0].querySelector('h2').textContent).toContain('Second Wine');
    });
  });

  describe('focus management', () => {
    it('restores focus to trigger element on close', async () => {
      const triggerBtn = document.createElement('button');
      triggerBtn.textContent = 'Trigger';
      document.body.appendChild(triggerBtn);
      triggerBtn.focus();

      mockEnrichWine.mockResolvedValue(ENRICH_RESPONSE);
      await openWineResearchModal(CART_ITEM);

      getOverlay().querySelector('.wine-research-close').click();
      expect(document.activeElement).toBe(triggerBtn);
    });
  });

  describe('payload construction', () => {
    it('includes wine_name and all truthy optional fields', async () => {
      mockEnrichWine.mockResolvedValue(ENRICH_RESPONSE);
      await openWineResearchModal(CART_ITEM);

      expect(mockEnrichWine).toHaveBeenCalledWith({
        wine_name: 'Kanonkop Pinotage',
        vintage: 2019,
        producer: 'Kanonkop',
        colour: 'red',
        grapes: 'Pinotage',
        region: 'Stellenbosch',
        country: 'South Africa'
      });
    });

    it('omits falsy optional fields from payload', async () => {
      mockEnrichWine.mockResolvedValue(ENRICH_RESPONSE);
      await openWineResearchModal({ ...CART_ITEM, vintage: null, producer: '', region: undefined });

      const payload = mockEnrichWine.mock.calls[0][0];
      expect(payload.wine_name).toBe('Kanonkop Pinotage');
      expect(payload).not.toHaveProperty('vintage');
      expect(payload).not.toHaveProperty('producer');
      expect(payload).not.toHaveProperty('region');
    });
  });

  describe('results rendering', () => {
    it('renders individual rating items with correct score types', async () => {
      mockEnrichWine.mockResolvedValue(ENRICH_RESPONSE);
      await openWineResearchModal(CART_ITEM);

      const items = getOverlay().querySelectorAll('.rating-item');
      expect(items.length).toBe(3);

      // Points score (Suckling 95)
      expect(items[0].querySelector('.rating-score').textContent).toContain('95');
      expect(items[0].querySelector('.rating-source').textContent).toContain('Suckling');

      // Stars score (Platter's 4.5★)
      expect(items[1].querySelector('.rating-score').textContent).toContain('4.5★');

      // Medal (Michelangelo Gold) with award badge
      expect(items[2].querySelector('.rating-score').textContent).toContain('Gold');
      expect(items[2].querySelector('.award-badge')).toBeTruthy();
    });

    it('shows lens icons for different source types', async () => {
      mockEnrichWine.mockResolvedValue(ENRICH_RESPONSE);
      await openWineResearchModal(CART_ITEM);

      const items = getOverlay().querySelectorAll('.rating-item');
      expect(items[0].querySelector('.rating-source').textContent).toContain('📝'); // critics
      expect(items[2].querySelector('.rating-source').textContent).toContain('🏆'); // competition
    });

    it('shows vintage-match warning for non-exact matches', async () => {
      mockEnrichWine.mockResolvedValue(ENRICH_RESPONSE);
      await openWineResearchModal(CART_ITEM);

      const items = getOverlay().querySelectorAll('.rating-item');
      // Third item has vintage_match: 'inferred'
      expect(items[2].querySelector('.vintage-warning')).toBeTruthy();
      expect(items[2].querySelector('.vintage-warning').textContent).toContain('inferred');
      // First item has exact match — no warning
      expect(items[0].querySelector('.vintage-warning')).toBeNull();
    });

    it('renders drinking window with years', async () => {
      mockEnrichWine.mockResolvedValue(ENRICH_RESPONSE);
      await openWineResearchModal(CART_ITEM);

      const window = getOverlay().querySelector('.wine-research-window-years');
      expect(window).toBeTruthy();
      expect(window.textContent).toContain('2022');
      expect(window.textContent).toContain('2030');
    });

    it('renders food pairing chips', async () => {
      mockEnrichWine.mockResolvedValue(ENRICH_RESPONSE);
      await openWineResearchModal(CART_ITEM);

      const chips = getOverlay().querySelectorAll('.wine-research-pairing-chip');
      expect(chips.length).toBe(3);
      const labels = Array.from(chips).map(c => c.textContent);
      expect(labels).toContain('grilled lamb');
      expect(labels).toContain('braai');
    });

    it('renders narrative via renderWineProfile DOM API', async () => {
      mockEnrichWine.mockResolvedValue(ENRICH_RESPONSE);
      await openWineResearchModal(CART_ITEM);

      expect(renderWineProfile).toHaveBeenCalled();
      const [container, narrative] = renderWineProfile.mock.calls[0];
      expect(container).toBeInstanceOf(HTMLElement);
      expect(narrative).toBe('This is a remarkable wine from Stellenbosch.');
    });

    it('renders sources footer with count and duration', async () => {
      mockEnrichWine.mockResolvedValue(ENRICH_RESPONSE);
      await openWineResearchModal(CART_ITEM);

      const footer = getOverlay().querySelector('.wine-research-sources-footer');
      expect(footer.textContent).toContain('5 sources');
      expect(footer.textContent).toContain('23.4s');
    });
  });

  describe('error handling', () => {
    it('renders error state when enrichWine throws', async () => {
      mockEnrichWine.mockRejectedValue(new Error('Network failure'));
      await openWineResearchModal(CART_ITEM);

      const error = getOverlay().querySelector('.wine-research-error');
      expect(error).toBeTruthy();
      expect(error.textContent).toContain('Network failure');
    });

    it('renders error state when data.error is set with HTTP 200', async () => {
      mockEnrichWine.mockResolvedValue({ ratings: null, drinkingWindows: null, error: 'Claude API timeout' });
      await openWineResearchModal(CART_ITEM);

      const error = getOverlay().querySelector('.wine-research-error');
      expect(error).toBeTruthy();
      expect(error.textContent).toContain('Claude API timeout');
    });

    it('shows no-ratings message when ratings array is empty', async () => {
      mockEnrichWine.mockResolvedValue({
        ratings: { ratings: [], _narrative: null, _metadata: {} },
        drinkingWindows: null,
        error: null
      });
      await openWineResearchModal(CART_ITEM);

      const error = getOverlay().querySelector('.wine-research-error');
      expect(error).toBeTruthy();
      expect(error.textContent).toContain('No ratings found');
    });
  });

  describe('stale response guard', () => {
    it('ignores response if modal was closed during fetch', async () => {
      // Make enrichWine return a promise that we control
      let resolve;
      mockEnrichWine.mockReturnValue(new Promise(r => { resolve = r; }));

      const promise = openWineResearchModal(CART_ITEM);

      // Close modal before response arrives
      getOverlay().querySelector('.wine-research-close').click();
      expect(getOverlay()).toBeNull();

      // Now resolve the fetch
      resolve(ENRICH_RESPONSE);
      await promise;

      // No overlay should be created or modified
      expect(getOverlay()).toBeNull();
    });
  });

  describe('accessibility', () => {
    it('modal has role="dialog" and aria-modal', async () => {
      mockEnrichWine.mockResolvedValue(ENRICH_RESPONSE);
      await openWineResearchModal(CART_ITEM);

      const overlay = getOverlay();
      expect(overlay.getAttribute('role')).toBe('dialog');
      expect(overlay.getAttribute('aria-modal')).toBe('true');
    });

    it('close button has aria-label', async () => {
      mockEnrichWine.mockResolvedValue(ENRICH_RESPONSE);
      await openWineResearchModal(CART_ITEM);

      const closeBtn = getOverlay().querySelector('.wine-research-close');
      expect(closeBtn.getAttribute('aria-label')).toBe('Close');
    });
  });
});
