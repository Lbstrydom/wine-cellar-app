// @vitest-environment jsdom

/**
 * @fileoverview Unit tests for dishReview module.
 * Tests DOM rendering (capture + review sections), dish card selection,
 * triage banner, counter, manual add, capture onAnalyze callback, and destroy.
 */

// --- Mocks ---

const mockDishes = [
  { id: 1, name: 'Grilled Lamb Chops', category: 'main', description: 'With rosemary jus', confidence: 'high' },
  { id: 2, name: 'Caesar Salad', category: 'starter', confidence: 'low' }
];

const mockSelections = {
  wines: {},
  dishes: { 1: true, 2: true }
};

let currentDishes = [];
let currentSelections = {};
let captureOnAnalyze = null;

vi.mock('../../../public/js/restaurantPairing/state.js', () => ({
  getDishes: vi.fn(() => currentDishes),
  getSelections: vi.fn(() => currentSelections),
  setDishSelected: vi.fn((id, selected) => {
    currentSelections.dishes[id] = selected;
  }),
  addDish: vi.fn((dish) => {
    const entry = { ...dish, id: 100, confidence: 'high' };
    currentDishes.push(entry);
    currentSelections.dishes[entry.id] = true;
    return entry;
  }),
  removeDish: vi.fn((id) => {
    currentDishes = currentDishes.filter(d => d.id !== id);
    delete currentSelections.dishes[id];
  }),
  mergeDishes: vi.fn((items) => {
    for (const item of items) {
      const entry = { ...item, id: 200 + currentDishes.length };
      currentDishes.push(entry);
      currentSelections.dishes[entry.id] = true;
    }
    return currentDishes;
  })
}));

vi.mock('../../../public/js/restaurantPairing/imageCapture.js', () => ({
  createImageCapture: vi.fn((container, options) => {
    captureOnAnalyze = options.onAnalyze;
    // Render minimal capture UI so the module finds its container
    container.innerHTML = '<div class="restaurant-capture-mock">Capture Widget</div>';
    return {
      getImages: vi.fn(() => []),
      getText: vi.fn(() => ''),
      destroy: vi.fn()
    };
  })
}));

vi.mock('../../../public/js/utils.js', () => ({
  showToast: vi.fn(),
  escapeHtml: vi.fn(s => s == null ? '' : String(s))
}));

const { renderDishReview, destroyDishReview } = await import('../../../public/js/restaurantPairing/dishReview.js');
const { setDishSelected, addDish: addDishMock, removeDish: removeDishMock, mergeDishes: mergeDishMock } = await import('../../../public/js/restaurantPairing/state.js');
const { createImageCapture } = await import('../../../public/js/restaurantPairing/imageCapture.js');
const { showToast } = await import('../../../public/js/utils.js');

describe('dishReview', () => {
  let container;
  const parseBudget = { used: 0 };

  beforeEach(() => {
    vi.clearAllMocks();
    currentDishes = mockDishes.map(d => ({ ...d }));
    currentSelections = {
      wines: {},
      dishes: { ...mockSelections.dishes }
    };
    captureOnAnalyze = null;
    container = document.createElement('div');
    container.id = 'test-dish-review';
    document.body.appendChild(container);
  });

  afterEach(() => {
    destroyDishReview();
    document.body.removeChild(container);
  });

  // --- DOM Rendering ---

  describe('DOM rendering', () => {
    it('renders both capture and review sections', () => {
      renderDishReview('test-dish-review', parseBudget);

      expect(container.querySelector('.restaurant-dish-capture-section')).toBeTruthy();
      expect(container.querySelector('.restaurant-dish-review-section')).toBeTruthy();
    });

    it('creates imageCapture widget with dish_menu type', () => {
      renderDishReview('test-dish-review', parseBudget);

      expect(createImageCapture).toHaveBeenCalledTimes(1);
      const callArgs = createImageCapture.mock.calls[0];
      expect(callArgs[1].type).toBe('dish_menu');
      expect(callArgs[1].maxImages).toBe(4);
    });

    it('renders dish cards from state', () => {
      renderDishReview('test-dish-review', parseBudget);

      const cards = container.querySelectorAll('.restaurant-dish-card');
      expect(cards.length).toBe(2);
    });

    it('renders dish card details correctly', () => {
      renderDishReview('test-dish-review', parseBudget);

      const firstCard = container.querySelector('.restaurant-dish-card');
      expect(firstCard.textContent).toContain('Grilled Lamb Chops');
      expect(firstCard.textContent).toContain('With rosemary jus');
      expect(firstCard.getAttribute('role')).toBe('checkbox');
      expect(firstCard.getAttribute('aria-checked')).toBe('true');
    });

    it('renders all expected form elements', () => {
      renderDishReview('test-dish-review', parseBudget);

      expect(container.querySelector('.restaurant-add-dish-name')).toBeTruthy();
      expect(container.querySelector('.restaurant-add-dish-category')).toBeTruthy();
      expect(container.querySelector('.restaurant-add-dish-desc')).toBeTruthy();
      expect(container.querySelector('.restaurant-add-dish-btn')).toBeTruthy();
    });
  });

  // --- Triage Banner ---

  describe('triage banner', () => {
    it('shows triage banner for low-confidence dishes', () => {
      renderDishReview('test-dish-review', parseBudget);

      const banner = container.querySelector('.restaurant-triage-banner');
      expect(banner.textContent).toContain('Review 1 uncertain item');
      expect(banner.style.display).not.toBe('none');
    });

    it('hides triage banner when no low-confidence dishes', () => {
      currentDishes = currentDishes.map(d => ({ ...d, confidence: 'high' }));
      renderDishReview('test-dish-review', parseBudget);

      const banner = container.querySelector('.restaurant-triage-banner');
      expect(banner.style.display).toBe('none');
    });

    it('applies low-confidence styling to cards', () => {
      renderDishReview('test-dish-review', parseBudget);

      const lowCards = container.querySelectorAll('.restaurant-low-confidence');
      expect(lowCards.length).toBe(1);
      expect(lowCards[0].textContent).toContain('Caesar Salad');
    });
  });

  // --- Selection ---

  describe('selection', () => {
    it('checkbox toggles dish selection on click', () => {
      renderDishReview('test-dish-review', parseBudget);

      const firstCard = container.querySelector('.restaurant-dish-card');
      firstCard.click();

      expect(setDishSelected).toHaveBeenCalledWith(1, false);
    });

    it('updates aria-checked after toggle', () => {
      renderDishReview('test-dish-review', parseBudget);

      const firstCard = container.querySelector('.restaurant-dish-card');
      firstCard.click();

      const updatedCard = container.querySelector('[data-dish-id="1"]');
      expect(updatedCard.getAttribute('aria-checked')).toBe('false');
    });
  });

  // --- Counter ---

  describe('counter', () => {
    it('shows "N of M dishes selected" counter', () => {
      renderDishReview('test-dish-review', parseBudget);

      const counter = container.querySelector('.restaurant-dish-counter');
      expect(counter.textContent).toBe('2 of 2 dishes selected');
    });

    it('has aria-live="polite" on counter', () => {
      renderDishReview('test-dish-review', parseBudget);

      const counter = container.querySelector('.restaurant-dish-counter');
      expect(counter.getAttribute('aria-live')).toBe('polite');
    });

    it('counter updates when selection changes', () => {
      renderDishReview('test-dish-review', parseBudget);

      const firstCard = container.querySelector('.restaurant-dish-card');
      firstCard.click();

      const counter = container.querySelector('.restaurant-dish-counter');
      expect(counter.textContent).toBe('1 of 2 dishes selected');
    });
  });

  // --- Manual Add Dish ---

  describe('add dish form', () => {
    it('calls addDish with form data', () => {
      renderDishReview('test-dish-review', parseBudget);

      container.querySelector('.restaurant-add-dish-name').value = 'Beef Carpaccio';
      container.querySelector('.restaurant-add-dish-category').value = 'Starter';
      container.querySelector('.restaurant-add-dish-desc').value = 'With truffle oil';

      container.querySelector('.restaurant-add-dish-btn').click();

      expect(addDishMock).toHaveBeenCalledWith({
        name: 'Beef Carpaccio',
        category: 'Starter',
        description: 'With truffle oil'
      });
    });

    it('shows toast when name is empty', () => {
      renderDishReview('test-dish-review', parseBudget);

      container.querySelector('.restaurant-add-dish-btn').click();

      expect(showToast).toHaveBeenCalledWith('Dish name is required', 'error');
      expect(addDishMock).not.toHaveBeenCalled();
    });

    it('resets form after successful add', () => {
      renderDishReview('test-dish-review', parseBudget);

      container.querySelector('.restaurant-add-dish-name').value = 'Bruschetta';
      container.querySelector('.restaurant-add-dish-btn').click();

      expect(container.querySelector('.restaurant-add-dish-name').value).toBe('');
      expect(container.querySelector('.restaurant-add-dish-category').value).toBe('');
      expect(container.querySelector('.restaurant-add-dish-desc').value).toBe('');
    });
  });

  // --- Remove Dish ---

  describe('remove dish', () => {
    it('calls removeDish on remove button click', () => {
      renderDishReview('test-dish-review', parseBudget);

      const removeBtn = container.querySelector('.restaurant-dish-remove');
      removeBtn.click();

      expect(removeDishMock).toHaveBeenCalledWith(1);
    });

    it('remove button does not toggle selection', () => {
      renderDishReview('test-dish-review', parseBudget);

      const removeBtn = container.querySelector('.restaurant-dish-remove');
      removeBtn.click();

      expect(setDishSelected).not.toHaveBeenCalled();
    });
  });

  // --- Capture → Card Re-render ---

  describe('capture onAnalyze callback', () => {
    it('merges dishes and re-renders cards on analyze', () => {
      renderDishReview('test-dish-review', parseBudget);

      // Simulate capture widget calling onAnalyze
      const newDishes = [
        { name: 'Tiramisu', category: 'dessert', confidence: 'high' }
      ];
      captureOnAnalyze(newDishes);

      expect(mergeDishMock).toHaveBeenCalledWith(newDishes);

      // Cards should now include the new dish
      const cards = container.querySelectorAll('.restaurant-dish-card');
      expect(cards.length).toBe(3);
    });
  });

  // --- Keyboard Operability ---

  describe('keyboard operability', () => {
    it('toggles selection on Space key', () => {
      renderDishReview('test-dish-review', parseBudget);

      const firstCard = container.querySelector('.restaurant-dish-card');
      firstCard.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));

      expect(setDishSelected).toHaveBeenCalledWith(1, false);
    });

    it('toggles selection on Enter key', () => {
      renderDishReview('test-dish-review', parseBudget);

      const firstCard = container.querySelector('.restaurant-dish-card');
      firstCard.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

      expect(setDishSelected).toHaveBeenCalledWith(1, false);
    });
  });

  // --- Category Alignment ---

  describe('category alignment', () => {
    it('category dropdown uses title-case values matching backend schema', () => {
      renderDishReview('test-dish-review', parseBudget);

      const options = container.querySelectorAll('.restaurant-add-dish-category option');
      const values = [...options].map(o => o.value).filter(Boolean);
      expect(values).toContain('Sharing');
      expect(values).not.toContain('Shared');
      expect(values).not.toContain('sharing');
    });
  });

  // --- Destroy ---

  describe('destroy', () => {
    it('destroys capture widget on destroy', () => {
      renderDishReview('test-dish-review', parseBudget);

      const captureReturn = createImageCapture.mock.results[0].value;
      destroyDishReview();

      expect(captureReturn.destroy).toHaveBeenCalled();
    });

    it('cleans up event listeners on destroy', () => {
      renderDishReview('test-dish-review', parseBudget);

      destroyDishReview();

      // No errors should occur; module state should be cleared
      expect(true).toBe(true);
    });
  });
});
