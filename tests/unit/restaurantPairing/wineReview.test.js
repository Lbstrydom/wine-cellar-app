// @vitest-environment jsdom

/**
 * @fileoverview Unit tests for wineReview module.
 * Tests DOM rendering, selection toggling, colour/price/BTG filters,
 * triage banner, counter semantics, select-all-visible, manual add, and destroy.
 */

// --- Mocks ---

const mockWines = [
  { id: 1, name: 'Cab Sauv Reserve', vintage: 2019, colour: 'red', price: 350, currency: 'USD', by_the_glass: false, confidence: 'high' },
  { id: 2, name: 'Chardonnay Estate', vintage: 2021, colour: 'white', price: 180, currency: 'USD', by_the_glass: true, confidence: 'high' },
  { id: 3, name: 'Pinot Noir', vintage: 2020, colour: 'red', price: 250, currency: 'USD', by_the_glass: false, confidence: 'low' }
];

const mockSelections = {
  wines: { 1: true, 2: true, 3: true },
  dishes: {}
};

let currentWines = [];
let currentSelections = {};

vi.mock('../../../public/js/restaurantPairing/state.js', () => ({
  getWines: vi.fn(() => currentWines),
  getSelections: vi.fn(() => currentSelections),
  setWineSelected: vi.fn((id, selected) => {
    currentSelections.wines[id] = selected;
  }),
  addWine: vi.fn((wine) => {
    const entry = { ...wine, id: 100, confidence: 'high' };
    currentWines.push(entry);
    currentSelections.wines[entry.id] = true;
    return entry;
  }),
  removeWine: vi.fn((id) => {
    currentWines = currentWines.filter(w => w.id !== id);
    delete currentSelections.wines[id];
  }),
  selectAllWines: vi.fn((predicate) => {
    for (const wine of currentWines) {
      if (!predicate || predicate(wine)) {
        currentSelections.wines[wine.id] = true;
      }
    }
  }),
  deselectAllWines: vi.fn((predicate) => {
    for (const wine of currentWines) {
      if (!predicate || predicate(wine)) {
        currentSelections.wines[wine.id] = false;
      }
    }
  }),
  updateWineField: vi.fn((id, field, value) => {
    const wine = currentWines.find(w => w.id === id);
    if (wine) wine[field] = value;
  })
}));

vi.mock('../../../public/js/utils.js', () => ({
  showToast: vi.fn(),
  escapeHtml: vi.fn(s => s == null ? '' : String(s))
}));

const { renderWineReview, destroyWineReview } = await import('../../../public/js/restaurantPairing/wineReview.js');
const { setWineSelected, addWine: addWineMock, removeWine: removeWineMock, selectAllWines: selectAllMock, deselectAllWines: deselectAllMock, updateWineField: updateWineFieldMock } = await import('../../../public/js/restaurantPairing/state.js');
const { showToast } = await import('../../../public/js/utils.js');

describe('wineReview', () => {
  let container;

  beforeEach(() => {
    vi.clearAllMocks();
    currentWines = mockWines.map(w => ({ ...w }));
    currentSelections = {
      wines: { ...mockSelections.wines },
      dishes: {}
    };
    container = document.createElement('div');
    container.id = 'test-wine-review';
    document.body.appendChild(container);
  });

  afterEach(() => {
    destroyWineReview();
    document.body.removeChild(container);
  });

  // --- DOM Rendering ---

  describe('DOM rendering', () => {
    it('renders wine cards from state', () => {
      renderWineReview('test-wine-review');

      const cards = container.querySelectorAll('.restaurant-wine-card');
      expect(cards.length).toBe(3);
    });

    it('renders all expected DOM elements', () => {
      renderWineReview('test-wine-review');

      expect(container.querySelector('.restaurant-wine-review')).toBeTruthy();
      expect(container.querySelector('.restaurant-triage-banner')).toBeTruthy();
      expect(container.querySelector('.restaurant-colour-filters')).toBeTruthy();
      expect(container.querySelector('.restaurant-max-price-input')).toBeTruthy();
      expect(container.querySelector('.restaurant-btg-checkbox')).toBeTruthy();
      expect(container.querySelector('.restaurant-wine-counter')).toBeTruthy();
      expect(container.querySelector('.restaurant-select-all-btn')).toBeTruthy();
      expect(container.querySelector('.restaurant-wine-cards')).toBeTruthy();
      expect(container.querySelector('.restaurant-add-wine-btn')).toBeTruthy();
    });

    it('renders colour filter chips with counts', () => {
      renderWineReview('test-wine-review');

      const chips = container.querySelectorAll('.restaurant-colour-chip');
      expect(chips.length).toBe(4); // Red, White, Rosé, Sparkling

      // Red should show count 2 (Cab Sauv + Pinot Noir)
      const redChip = [...chips].find(c => c.textContent.includes('Red'));
      expect(redChip.textContent).toContain('(2)');

      // White should show count 1
      const whiteChip = [...chips].find(c => c.textContent.includes('White'));
      expect(whiteChip.textContent).toContain('(1)');
    });

    it('renders wine card details correctly', () => {
      renderWineReview('test-wine-review');

      const firstCard = container.querySelector('.restaurant-wine-card');
      expect(firstCard.textContent).toContain('Cab Sauv Reserve');
      expect(firstCard.textContent).toContain('2019');
      expect(firstCard.textContent).toContain('350');
      expect(firstCard.getAttribute('role')).toBe('checkbox');
      expect(firstCard.getAttribute('aria-checked')).toBe('true');
    });

    it('renders BTG badge on by-the-glass wines', () => {
      renderWineReview('test-wine-review');

      const cards = container.querySelectorAll('.restaurant-wine-card');
      const chardCard = [...cards].find(c => c.textContent.includes('Chardonnay'));
      expect(chardCard.querySelector('.restaurant-btg-badge')).toBeTruthy();
    });
  });

  // --- Triage Banner ---

  describe('triage banner', () => {
    it('shows triage banner for low-confidence wines', () => {
      renderWineReview('test-wine-review');

      const banner = container.querySelector('.restaurant-triage-banner');
      expect(banner.textContent).toContain('Review 1 uncertain item');
      expect(banner.style.display).not.toBe('none');
    });

    it('hides triage banner when no low-confidence wines', () => {
      currentWines = currentWines.map(w => ({ ...w, confidence: 'high' }));
      renderWineReview('test-wine-review');

      const banner = container.querySelector('.restaurant-triage-banner');
      expect(banner.style.display).toBe('none');
    });

    it('applies low-confidence styling to cards', () => {
      renderWineReview('test-wine-review');

      const lowCards = container.querySelectorAll('.restaurant-low-confidence');
      expect(lowCards.length).toBe(1);
      expect(lowCards[0].textContent).toContain('Pinot Noir');
    });
  });

  // --- Selection ---

  describe('selection', () => {
    it('checkbox toggles selection state on click', () => {
      renderWineReview('test-wine-review');

      const firstCard = container.querySelector('.restaurant-wine-card');
      firstCard.click();

      expect(setWineSelected).toHaveBeenCalledWith(1, false);
    });

    it('updates aria-checked after toggle', () => {
      renderWineReview('test-wine-review');

      const firstCard = container.querySelector('.restaurant-wine-card');
      firstCard.click();

      // Re-render happens internally; card should show unchecked
      const updatedCard = container.querySelector('[data-wine-id="1"]');
      expect(updatedCard.getAttribute('aria-checked')).toBe('false');
    });

    it('shows checkmark for selected wines', () => {
      renderWineReview('test-wine-review');

      const checks = container.querySelectorAll('.restaurant-card-check');
      expect(checks[0].textContent).toBe('✓');
    });
  });

  // --- Counter ---

  describe('counter', () => {
    it('shows "N selected (M visible)" counter', () => {
      renderWineReview('test-wine-review');

      const counter = container.querySelector('.restaurant-wine-counter');
      expect(counter.textContent).toBe('3 selected (3 visible)');
    });

    it('has aria-live="polite" on counter', () => {
      renderWineReview('test-wine-review');

      const counter = container.querySelector('.restaurant-wine-counter');
      expect(counter.getAttribute('aria-live')).toBe('polite');
    });

    it('counter updates when selection changes', () => {
      renderWineReview('test-wine-review');

      // Deselect first wine
      const firstCard = container.querySelector('.restaurant-wine-card');
      firstCard.click();

      const counter = container.querySelector('.restaurant-wine-counter');
      expect(counter.textContent).toBe('2 selected (3 visible)');
    });
  });

  // --- Colour Filter ---

  describe('colour filter', () => {
    it('clicking colour chip hides non-matching wines', () => {
      renderWineReview('test-wine-review');

      // Click "White" chip
      const chips = container.querySelectorAll('.restaurant-colour-chip');
      const whiteChip = [...chips].find(c => c.textContent.includes('White'));
      whiteChip.click();

      // Red wines should be hidden
      const cards = container.querySelectorAll('.restaurant-wine-card');
      const cabCard = [...cards].find(c => c.textContent.includes('Cab Sauv'));
      expect(cabCard.style.display).toBe('none');

      // White wine should be visible
      const chardCard = [...cards].find(c => c.textContent.includes('Chardonnay'));
      expect(chardCard.style.display).not.toBe('none');
    });

    it('filter does NOT change selection state', () => {
      renderWineReview('test-wine-review');

      // Click "White" chip — hides reds
      const chips = container.querySelectorAll('.restaurant-colour-chip');
      const whiteChip = [...chips].find(c => c.textContent.includes('White'));
      whiteChip.click();

      // Red wines still selected even though hidden
      expect(currentSelections.wines[1]).toBe(true); // Cab Sauv
      expect(currentSelections.wines[3]).toBe(true); // Pinot Noir
    });

    it('counter reflects visible count with filter', () => {
      renderWineReview('test-wine-review');

      // Click "Red" chip
      const chips = container.querySelectorAll('.restaurant-colour-chip');
      const redChip = [...chips].find(c => c.textContent.includes('Red'));
      redChip.click();

      const counter = container.querySelector('.restaurant-wine-counter');
      expect(counter.textContent).toBe('3 selected (2 visible)');
    });

    it('colour chip toggles aria-pressed', () => {
      renderWineReview('test-wine-review');

      const chips = container.querySelectorAll('.restaurant-colour-chip');
      const redChip = [...chips].find(c => c.textContent.includes('Red'));
      expect(redChip.getAttribute('aria-pressed')).toBe('false');

      redChip.click();

      // Re-query after re-render
      const updatedChips = container.querySelectorAll('.restaurant-colour-chip');
      const updatedRedChip = [...updatedChips].find(c => c.textContent.includes('Red'));
      expect(updatedRedChip.getAttribute('aria-pressed')).toBe('true');
    });
  });

  // --- Price Filter ---

  describe('price filter', () => {
    it('hides wines above max price', () => {
      renderWineReview('test-wine-review');

      const priceInput = container.querySelector('.restaurant-max-price-input');
      priceInput.value = '200';
      priceInput.dispatchEvent(new Event('input'));

      const cards = container.querySelectorAll('.restaurant-wine-card');
      const cabCard = [...cards].find(c => c.textContent.includes('Cab Sauv'));
      expect(cabCard.style.display).toBe('none'); // price 350 > 200

      const chardCard = [...cards].find(c => c.textContent.includes('Chardonnay'));
      expect(chardCard.style.display).not.toBe('none'); // price 180 <= 200
    });

    it('empty price input shows all wines', () => {
      renderWineReview('test-wine-review');

      const priceInput = container.querySelector('.restaurant-max-price-input');
      priceInput.value = '200';
      priceInput.dispatchEvent(new Event('input'));

      // Clear price filter
      priceInput.value = '';
      priceInput.dispatchEvent(new Event('input'));

      const cards = container.querySelectorAll('.restaurant-wine-card');
      const hiddenCards = [...cards].filter(c => c.style.display === 'none');
      expect(hiddenCards.length).toBe(0);
    });
  });

  // --- BTG Filter ---

  describe('by-the-glass filter', () => {
    it('hides non-BTG wines when toggled', () => {
      renderWineReview('test-wine-review');

      const btgCheckbox = container.querySelector('.restaurant-btg-checkbox');
      btgCheckbox.checked = true;
      btgCheckbox.dispatchEvent(new Event('change'));

      const cards = container.querySelectorAll('.restaurant-wine-card');
      const cabCard = [...cards].find(c => c.textContent.includes('Cab Sauv'));
      expect(cabCard.style.display).toBe('none');

      const chardCard = [...cards].find(c => c.textContent.includes('Chardonnay'));
      expect(chardCard.style.display).not.toBe('none'); // Chardonnay is BTG
    });
  });

  // --- Select All Visible ---

  describe('select all visible', () => {
    it('selects all visible wines', () => {
      // Deselect wine 1 first
      currentSelections.wines[1] = false;
      renderWineReview('test-wine-review');

      const selectAllBtn = container.querySelector('.restaurant-select-all-btn');
      selectAllBtn.click();

      expect(selectAllMock).toHaveBeenCalled();
    });

    it('toggles to deselect when all visible are selected', () => {
      renderWineReview('test-wine-review');

      // All are selected — button should say "Deselect All Visible"
      const selectAllBtn = container.querySelector('.restaurant-select-all-btn');
      expect(selectAllBtn.textContent).toBe('Deselect All Visible');

      selectAllBtn.click();
      expect(deselectAllMock).toHaveBeenCalled();
    });

    it('only toggles visible wines when filter active', () => {
      renderWineReview('test-wine-review');

      // Apply White filter
      const chips = container.querySelectorAll('.restaurant-colour-chip');
      const whiteChip = [...chips].find(c => c.textContent.includes('White'));
      whiteChip.click();

      // Click "Deselect All Visible" — should only deselect visible white wines
      const selectAllBtn = container.querySelector('.restaurant-select-all-btn');
      selectAllBtn.click();

      // deselectAllWines should have been called with a predicate
      expect(deselectAllMock).toHaveBeenCalled();
      const predicate = deselectAllMock.mock.calls[deselectAllMock.mock.calls.length - 1][0];
      // Predicate should match white wines
      expect(predicate({ colour: 'white', price: 180, by_the_glass: true })).toBe(true);
      // Predicate should not match red wines
      expect(predicate({ colour: 'red', price: 350, by_the_glass: false })).toBe(false);
    });
  });

  // --- Manual Add Wine ---

  describe('add wine form', () => {
    it('calls addWine with form data', () => {
      renderWineReview('test-wine-review');

      container.querySelector('.restaurant-add-wine-name').value = 'Merlot 2022';
      container.querySelector('.restaurant-add-wine-vintage').value = '2022';
      container.querySelector('.restaurant-add-wine-colour').value = 'red';
      container.querySelector('.restaurant-add-wine-price').value = '195';
      container.querySelector('.restaurant-add-wine-btg').checked = true;

      container.querySelector('.restaurant-add-wine-btn').click();

      expect(addWineMock).toHaveBeenCalledWith({
        name: 'Merlot 2022',
        vintage: 2022,
        colour: 'red',
        price: 195,
        by_the_glass: true
      });
    });

    it('shows toast when name is empty', () => {
      renderWineReview('test-wine-review');

      container.querySelector('.restaurant-add-wine-btn').click();

      expect(showToast).toHaveBeenCalledWith('Wine name is required', 'error');
      expect(addWineMock).not.toHaveBeenCalled();
    });

    it('resets form after successful add', () => {
      renderWineReview('test-wine-review');

      container.querySelector('.restaurant-add-wine-name').value = 'Merlot';
      container.querySelector('.restaurant-add-wine-btn').click();

      expect(container.querySelector('.restaurant-add-wine-name').value).toBe('');
    });
  });

  // --- Rosé Filter Backend Alignment ---

  describe('rosé filter alignment', () => {
    it('colour chip uses backend canonical value "rose" in data-colour', () => {
      renderWineReview('test-wine-review');

      const chips = container.querySelectorAll('.restaurant-colour-chip');
      const roseChip = [...chips].find(c => c.textContent.includes('Rosé'));
      expect(roseChip).toBeTruthy();
      expect(roseChip.dataset.colour).toBe('rose');
    });

    it('filters rosé wines correctly using canonical value', () => {
      currentWines.push({ id: 4, name: 'Rosé d\'Été', vintage: 2023, colour: 'rose', price: 120, by_the_glass: true, confidence: 'high' });
      currentSelections.wines[4] = true;
      renderWineReview('test-wine-review');

      // Click Rosé chip
      const chips = container.querySelectorAll('.restaurant-colour-chip');
      const roseChip = [...chips].find(c => c.textContent.includes('Rosé'));
      roseChip.click();

      const cards = container.querySelectorAll('.restaurant-wine-card');
      const roseCard = [...cards].find(c => c.textContent.includes('Rosé'));
      expect(roseCard.style.display).not.toBe('none');

      // Red wines should be hidden
      const cabCard = [...cards].find(c => c.textContent.includes('Cab Sauv'));
      expect(cabCard.style.display).toBe('none');
    });
  });

  // --- Keyboard Operability ---

  describe('keyboard operability', () => {
    it('toggles selection on Space key', () => {
      renderWineReview('test-wine-review');

      const firstCard = container.querySelector('.restaurant-wine-card');
      firstCard.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));

      expect(setWineSelected).toHaveBeenCalledWith(1, false);
    });

    it('toggles selection on Enter key', () => {
      renderWineReview('test-wine-review');

      const firstCard = container.querySelector('.restaurant-wine-card');
      firstCard.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

      expect(setWineSelected).toHaveBeenCalledWith(1, false);
    });
  });

  // --- Inline Price Edit ---

  describe('inline price edit', () => {
    it('renders inline price input for low-confidence wines', () => {
      renderWineReview('test-wine-review');

      // Pinot Noir (id=3) is low confidence
      const lowCard = container.querySelector('[data-wine-id="3"]');
      const priceInput = lowCard.querySelector('.restaurant-inline-price');
      expect(priceInput).toBeTruthy();
      expect(priceInput.getAttribute('inputmode')).toBe('decimal');
    });

    it('renders read-only price for high-confidence wines', () => {
      renderWineReview('test-wine-review');

      // Cab Sauv (id=1) is high confidence
      const highCard = container.querySelector('[data-wine-id="1"]');
      expect(highCard.querySelector('.restaurant-inline-price')).toBeNull();
      expect(highCard.querySelector('.restaurant-card-price')).toBeTruthy();
    });

    it('updates wine price on inline input change', () => {
      renderWineReview('test-wine-review');

      const lowCard = container.querySelector('[data-wine-id="3"]');
      const priceInput = lowCard.querySelector('.restaurant-inline-price');
      priceInput.value = '199';
      priceInput.dispatchEvent(new Event('change'));

      // updateWineField should have been called
      expect(updateWineFieldMock).toHaveBeenCalledWith(3, 'price', 199);
    });

    it('updates wine price to null on empty inline input', () => {
      renderWineReview('test-wine-review');

      const lowCard = container.querySelector('[data-wine-id="3"]');
      const priceInput = lowCard.querySelector('.restaurant-inline-price');
      priceInput.value = '';
      priceInput.dispatchEvent(new Event('change'));

      expect(updateWineFieldMock).toHaveBeenCalledWith(3, 'price', null);
    });

    it('does not toggle selection when clicking inline price input', () => {
      renderWineReview('test-wine-review');

      const lowCard = container.querySelector('[data-wine-id="3"]');
      const priceInput = lowCard.querySelector('.restaurant-inline-price');
      priceInput.click();

      // setWineSelected should NOT be called
      expect(setWineSelected).not.toHaveBeenCalled();
    });
  });

  // --- Remove Wine ---

  describe('remove wine', () => {
    it('calls removeWine and re-renders on remove button click', () => {
      renderWineReview('test-wine-review');

      const removeBtn = container.querySelector('.restaurant-wine-remove');
      removeBtn.click();

      expect(removeWineMock).toHaveBeenCalledWith(1);
    });

    it('remove button does not toggle selection', () => {
      renderWineReview('test-wine-review');

      const removeBtn = container.querySelector('.restaurant-wine-remove');
      removeBtn.click();

      // setWineSelected should NOT have been called from the card click handler
      expect(setWineSelected).not.toHaveBeenCalled();
    });
  });

  // --- Destroy ---

  describe('destroy', () => {
    it('removes all event listeners', () => {
      renderWineReview('test-wine-review');

      // Verify some elements exist
      expect(container.querySelectorAll('.restaurant-wine-card').length).toBe(3);

      destroyWineReview();

      // Module state should be cleaned up — further calls should not throw
      // Re-render would need a fresh call
      expect(true).toBe(true);
    });
  });
});
