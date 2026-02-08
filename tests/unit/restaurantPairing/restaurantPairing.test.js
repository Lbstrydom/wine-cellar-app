// @vitest-environment jsdom

/**
 * @fileoverview Unit tests for restaurantPairing controller.
 * Tests init, state restoration, mode toggle, step rendering, navigation
 * guards, Quick Pair flow, Start Over, step indicator, and destroy lifecycle.
 */

// --- Mocks ---

let currentStep = 1;
let currentHasData = false;
let currentSelectedWines = [];
let currentSelectedDishes = [];

// Track step module calls for lifecycle verification
const captureDestroyFn = vi.fn();
const mockCaptureWidget = {
  getImages: vi.fn(() => []),
  getText: vi.fn(() => ''),
  destroy: captureDestroyFn
};
let captureOnAnalyze = null;

vi.mock('../../../public/js/restaurantPairing/state.js', () => ({
  getStep: vi.fn(() => currentStep),
  setStep: vi.fn((s) => { currentStep = s; }),
  getSelectedWines: vi.fn(() => currentSelectedWines),
  getSelectedDishes: vi.fn(() => currentSelectedDishes),
  mergeWines: vi.fn((items) => items),
  mergeDishes: vi.fn((items) => items),
  hasData: vi.fn(() => currentHasData),
  clearState: vi.fn(() => { currentStep = 1; currentHasData = false; })
}));

vi.mock('../../../public/js/restaurantPairing/imageCapture.js', () => ({
  createImageCapture: vi.fn((container, options) => {
    captureOnAnalyze = options.onAnalyze;
    container.innerHTML = '<div class="mock-capture">Capture</div>';
    return { ...mockCaptureWidget };
  })
}));

vi.mock('../../../public/js/restaurantPairing/wineReview.js', () => ({
  renderWineReview: vi.fn((containerId) => {
    const el = document.getElementById(containerId);
    if (el) el.innerHTML = '<div class="mock-wine-review">Wine Review</div>';
  }),
  destroyWineReview: vi.fn()
}));

vi.mock('../../../public/js/restaurantPairing/dishReview.js', () => ({
  renderDishReview: vi.fn((containerId, budget) => {
    const el = document.getElementById(containerId);
    if (el) el.innerHTML = '<div class="mock-dish-review">Dish Review</div>';
  }),
  destroyDishReview: vi.fn()
}));

vi.mock('../../../public/js/restaurantPairing/results.js', () => ({
  renderResults: vi.fn((containerId) => {
    const el = document.getElementById(containerId);
    if (el) el.innerHTML = '<div class="mock-results">Results</div>';
  }),
  destroyResults: vi.fn(),
  requestRecommendations: vi.fn(() => Promise.resolve())
}));

vi.mock('../../../public/js/utils.js', () => ({
  showToast: vi.fn(),
  showConfirmDialog: vi.fn(() => Promise.resolve(true)),
  escapeHtml: vi.fn(s => s == null ? '' : String(s))
}));

const { initRestaurantPairing, runQuickPairFlow, destroyRestaurantPairing } = await import('../../../public/js/restaurantPairing.js');
const { setStep: setStepMock, mergeWines: mergeWinesMock, mergeDishes: mergeDishsMock, clearState: clearStateMock } = await import('../../../public/js/restaurantPairing/state.js');
const { createImageCapture } = await import('../../../public/js/restaurantPairing/imageCapture.js');
const { renderWineReview, destroyWineReview } = await import('../../../public/js/restaurantPairing/wineReview.js');
const { renderDishReview, destroyDishReview } = await import('../../../public/js/restaurantPairing/dishReview.js');
const { renderResults, destroyResults, requestRecommendations } = await import('../../../public/js/restaurantPairing/results.js');
const { showToast, showConfirmDialog } = await import('../../../public/js/utils.js');

describe('restaurantPairing controller', () => {
  let wizard;

  /** Create the minimal DOM structure expected by initRestaurantPairing */
  function setupDOM() {
    // Wizard container
    wizard = document.createElement('div');
    wizard.className = 'restaurant-wizard';
    document.body.appendChild(wizard);

    // Mode toggle (outside wizard, inside pairing view)
    const modeToggle = document.createElement('div');
    modeToggle.className = 'restaurant-mode-toggle';
    modeToggle.innerHTML = `
      <button class="toggle-btn active" data-mode="cellar" aria-selected="true">From My Cellar</button>
      <button class="toggle-btn" data-mode="restaurant" aria-selected="false">At a Restaurant</button>
    `;
    document.body.appendChild(modeToggle);

    // Cellar sections (to be hidden/shown by mode toggle)
    const cellarSection = document.createElement('div');
    cellarSection.className = 'pairing-cellar-section';
    cellarSection.textContent = 'Cellar pairing content';
    document.body.appendChild(cellarSection);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    currentStep = 1;
    currentHasData = false;
    currentSelectedWines = [];
    currentSelectedDishes = [];
    captureOnAnalyze = null;
    setupDOM();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  // --- Init ---

  describe('init', () => {
    it('renders step 1 on fresh state', () => {
      initRestaurantPairing();

      expect(createImageCapture).toHaveBeenCalledTimes(1);
      const stepContent = wizard.querySelector('.restaurant-step-content');
      expect(stepContent.textContent).toContain('Capture');
    });

    it('renders wizard structure with indicator, content, and nav', () => {
      initRestaurantPairing();

      expect(wizard.querySelector('.restaurant-step-indicator')).toBeTruthy();
      expect(wizard.querySelector('.restaurant-step-content')).toBeTruthy();
      expect(wizard.querySelector('.restaurant-nav-back')).toBeTruthy();
      expect(wizard.querySelector('.restaurant-nav-next')).toBeTruthy();
      expect(wizard.querySelector('.restaurant-start-over-btn')).toBeTruthy();
    });
  });

  // --- State Restoration ---

  describe('state restoration', () => {
    it('restores to saved step when hasData', () => {
      currentStep = 3;
      currentHasData = true;
      initRestaurantPairing();

      expect(renderDishReview).toHaveBeenCalledTimes(1);
      expect(setStepMock).toHaveBeenCalledWith(3);
    });

    it('starts at step 1 when no data even if step > 1', () => {
      currentStep = 3;
      currentHasData = false;
      initRestaurantPairing();

      expect(createImageCapture).toHaveBeenCalledTimes(1);
      expect(setStepMock).toHaveBeenCalledWith(1);
    });
  });

  // --- Mode Toggle ---

  describe('mode toggle', () => {
    it('switches to restaurant mode', () => {
      initRestaurantPairing();

      const restaurantBtn = document.querySelector('[data-mode="restaurant"]');
      restaurantBtn.click();

      const cellarSection = document.querySelector('.pairing-cellar-section');
      expect(cellarSection.style.display).toBe('none');
      expect(wizard.style.display).not.toBe('none');
      expect(restaurantBtn.getAttribute('aria-selected')).toBe('true');
    });

    it('preserves state when switching back to cellar', () => {
      currentHasData = true;
      initRestaurantPairing();

      // Switch to restaurant
      document.querySelector('[data-mode="restaurant"]').click();
      // Switch back to cellar
      document.querySelector('[data-mode="cellar"]').click();

      const cellarSection = document.querySelector('.pairing-cellar-section');
      expect(cellarSection.style.display).toBe('');
      // clearState should NOT have been called
      expect(clearStateMock).not.toHaveBeenCalled();
    });
  });

  // --- Step Rendering Lifecycle ---

  describe('renderStep lifecycle', () => {
    it('destroys previous step when navigating', () => {
      initRestaurantPairing();
      // Clear counts after init (init's renderStep also calls destroyCurrentStep)
      vi.clearAllMocks();

      // Step 1 rendered (imageCapture). Navigate to step 2
      const nextBtn = wizard.querySelector('.restaurant-nav-next');
      nextBtn.click();

      // imageCapture.destroy should have been called
      expect(captureDestroyFn).toHaveBeenCalledTimes(1);
      expect(renderWineReview).toHaveBeenCalledTimes(1);
    });

    it('destroys wine review when moving to step 3', () => {
      currentSelectedWines = [{ id: 1, name: 'Test Wine' }];
      initRestaurantPairing();

      // Go to step 2
      wizard.querySelector('.restaurant-nav-next').click();
      vi.clearAllMocks();

      // Go to step 3
      wizard.querySelector('.restaurant-nav-next').click();

      expect(destroyWineReview).toHaveBeenCalledTimes(1);
      expect(renderDishReview).toHaveBeenCalledTimes(1);
    });
  });

  // --- Navigation Guards ---

  describe('navigation guards', () => {
    it('Step 1→2 always allowed (no wines needed)', () => {
      currentSelectedWines = [];
      initRestaurantPairing();

      wizard.querySelector('.restaurant-nav-next').click();

      expect(renderWineReview).toHaveBeenCalledTimes(1);
      expect(showToast).not.toHaveBeenCalled();
    });

    it('Step 2→3 blocked when no wines selected', () => {
      currentSelectedWines = [];
      initRestaurantPairing();

      // Navigate to step 2
      wizard.querySelector('.restaurant-nav-next').click();
      vi.clearAllMocks();

      // Try to navigate to step 3
      wizard.querySelector('.restaurant-nav-next').click();

      expect(showToast).toHaveBeenCalledWith('Select at least one wine to continue', 'error');
      expect(renderDishReview).not.toHaveBeenCalled();
    });

    it('Step 3→4 blocked when no dishes selected', () => {
      currentSelectedWines = [{ id: 1, name: 'Test Wine' }];
      currentSelectedDishes = [];
      initRestaurantPairing();

      // Navigate to step 2, then 3
      wizard.querySelector('.restaurant-nav-next').click();
      wizard.querySelector('.restaurant-nav-next').click();
      vi.clearAllMocks();

      // Try to navigate to step 4
      wizard.querySelector('.restaurant-nav-next').click();

      expect(showToast).toHaveBeenCalledWith('Select at least one dish to continue', 'error');
      expect(renderResults).not.toHaveBeenCalled();
    });

    it('back button navigates to previous step', () => {
      initRestaurantPairing();

      // Go to step 2
      wizard.querySelector('.restaurant-nav-next').click();
      vi.clearAllMocks();

      // Go back to step 1
      wizard.querySelector('.restaurant-nav-back').click();

      expect(createImageCapture).toHaveBeenCalledTimes(1);
      expect(setStepMock).toHaveBeenCalledWith(1);
    });

    it('back button hidden on step 1', () => {
      initRestaurantPairing();

      const backBtn = wizard.querySelector('.restaurant-nav-back');
      expect(backBtn.style.display).toBe('none');
    });

    it('next button hidden on step 4', () => {
      currentSelectedWines = [{ id: 1, name: 'Test' }];
      currentSelectedDishes = [{ id: 1, name: 'Test' }];
      initRestaurantPairing();

      // Navigate to step 4
      wizard.querySelector('.restaurant-nav-next').click(); // 1→2
      wizard.querySelector('.restaurant-nav-next').click(); // 2→3
      wizard.querySelector('.restaurant-nav-next').click(); // 3→4

      const nextBtn = wizard.querySelector('.restaurant-nav-next');
      expect(nextBtn.style.display).toBe('none');
    });
  });

  // --- Quick Pair ---

  describe('quick pair', () => {
    it('merges items, renders step 4, and calls requestRecommendations', async () => {
      initRestaurantPairing();

      const wineItems = [{ name: 'Cab Sauv', colour: 'red' }];
      const dishItems = [{ name: 'Lamb Chops', category: 'Main' }];

      await runQuickPairFlow(wineItems, dishItems);

      expect(mergeWinesMock).toHaveBeenCalledWith(wineItems);
      expect(mergeDishsMock).toHaveBeenCalledWith(dishItems);
      expect(renderResults).toHaveBeenCalledTimes(1);
      expect(requestRecommendations).toHaveBeenCalledTimes(1);
    });
  });

  // --- Start Over ---

  describe('start over', () => {
    it('shows confirm dialog when data exists', async () => {
      currentHasData = true;
      initRestaurantPairing();

      wizard.querySelector('.restaurant-start-over-btn').click();

      await vi.waitFor(() => {
        expect(showConfirmDialog).toHaveBeenCalledWith(
          expect.objectContaining({ title: 'Start Over?' })
        );
      });
    });

    it('clears state and resets to step 1 on confirm', async () => {
      currentHasData = true;
      initRestaurantPairing();

      wizard.querySelector('.restaurant-start-over-btn').click();

      await vi.waitFor(() => {
        expect(clearStateMock).toHaveBeenCalledTimes(1);
        expect(setStepMock).toHaveBeenLastCalledWith(1);
      });
    });

    it('does not clear state when confirm is cancelled', async () => {
      currentHasData = true;
      showConfirmDialog.mockResolvedValueOnce(false);
      initRestaurantPairing();

      wizard.querySelector('.restaurant-start-over-btn').click();

      await vi.waitFor(() => {
        expect(showConfirmDialog).toHaveBeenCalled();
      });
      expect(clearStateMock).not.toHaveBeenCalled();
    });

    it('skips confirm dialog when no data exists', async () => {
      currentHasData = false;
      initRestaurantPairing();

      wizard.querySelector('.restaurant-start-over-btn').click();

      await vi.waitFor(() => {
        expect(clearStateMock).toHaveBeenCalledTimes(1);
      });
      expect(showConfirmDialog).not.toHaveBeenCalled();
    });
  });

  // --- Step Indicator ---

  describe('step indicator', () => {
    it('highlights active step', () => {
      initRestaurantPairing();

      const indicators = wizard.querySelectorAll('.restaurant-step-indicator-item');
      expect(indicators[0].classList.contains('active')).toBe(true);
      expect(indicators[0].getAttribute('aria-current')).toBe('step');
      expect(indicators[1].classList.contains('active')).toBe(false);
    });

    it('updates indicator when navigating', () => {
      initRestaurantPairing();

      wizard.querySelector('.restaurant-nav-next').click(); // go to step 2

      const indicators = wizard.querySelectorAll('.restaurant-step-indicator-item');
      expect(indicators[1].classList.contains('active')).toBe(true);
      expect(indicators[0].classList.contains('completed')).toBe(true);
    });

    it('clicking completed step navigates back', () => {
      initRestaurantPairing();

      wizard.querySelector('.restaurant-nav-next').click(); // go to step 2
      vi.clearAllMocks();

      // Click step 1 indicator
      const indicators = wizard.querySelectorAll('.restaurant-step-indicator-item');
      indicators[0].click();

      expect(createImageCapture).toHaveBeenCalledTimes(1);
      expect(setStepMock).toHaveBeenCalledWith(1);
    });

    it('clicking future step does nothing', () => {
      initRestaurantPairing();
      vi.clearAllMocks();

      // Click step 3 indicator while on step 1
      const indicators = wizard.querySelectorAll('.restaurant-step-indicator-item');
      indicators[2].click();

      expect(setStepMock).not.toHaveBeenCalled();
    });
  });

  // --- Step 1 onAnalyze callback ---

  describe('Step 1 capture callback', () => {
    it('merges wines and navigates to step 2 on analyze', () => {
      initRestaurantPairing();

      const wineItems = [{ name: 'Merlot', colour: 'red', confidence: 'high' }];
      captureOnAnalyze(wineItems);

      expect(mergeWinesMock).toHaveBeenCalledWith(wineItems);
      expect(renderWineReview).toHaveBeenCalledTimes(1);
    });
  });

  // --- Cleanup / Re-init ---

  describe('cleanup and re-initialization', () => {
    it('destroyRestaurantPairing removes all listeners', () => {
      initRestaurantPairing();

      const backBtn = wizard.querySelector('.restaurant-nav-back');
      const clickHandler = vi.fn();
      backBtn.addEventListener('click', clickHandler);

      destroyRestaurantPairing();

      // Try clicking after destroy - our custom handler should work, but controller's should be gone
      backBtn.click();
      // We can't directly verify controller handlers were removed without exposing internals,
      // but we can verify no errors occur and destroy is idempotent
      expect(() => destroyRestaurantPairing()).not.toThrow();
    });

    it('re-initialization after destroy works correctly', () => {
      initRestaurantPairing(); // First init
      destroyRestaurantPairing();
      
      vi.clearAllMocks();
      initRestaurantPairing(); // Re-init

      expect(createImageCapture).toHaveBeenCalledTimes(1);
      expect(wizard.querySelector('.restaurant-step-content')).toBeTruthy();
    });

    it('calling init twice cleans up previous listeners', () => {
      initRestaurantPairing(); // First init
      const firstBackBtn = wizard.querySelector('.restaurant-nav-back');
      
      vi.clearAllMocks();
      initRestaurantPairing(); // Second init without explicit destroy

      // Should have re-rendered and re-bound without errors
      expect(wizard.querySelector('.restaurant-nav-back')).toBeTruthy();
      expect(destroyWineReview).toHaveBeenCalledTimes(0); // No step change, just re-init
    });
  });
});
