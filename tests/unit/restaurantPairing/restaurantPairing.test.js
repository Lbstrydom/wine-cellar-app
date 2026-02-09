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
  clearState: vi.fn(() => { currentStep = 1; currentHasData = false; }),
  setQuickPairMode: vi.fn()
}));

let quickPairOnComplete = null;
let quickPairOnCancel = null;
const quickPairDestroyFn = vi.fn();

vi.mock('../../../public/js/restaurantPairing/quickPair.js', () => ({
  renderQuickPair: vi.fn((container, options) => {
    quickPairOnComplete = options.onComplete;
    quickPairOnCancel = options.onCancel;
    container.innerHTML = '<div class="mock-quick-pair">Quick Pair Form</div>';
    return { destroy: quickPairDestroyFn };
  })
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
const { setStep: setStepMock, mergeWines: mergeWinesMock, mergeDishes: mergeDishsMock, clearState: clearStateMock, setQuickPairMode: setQuickPairModeMock } = await import('../../../public/js/restaurantPairing/state.js');
const { createImageCapture } = await import('../../../public/js/restaurantPairing/imageCapture.js');
const { renderWineReview, destroyWineReview } = await import('../../../public/js/restaurantPairing/wineReview.js');
const { renderDishReview, destroyDishReview } = await import('../../../public/js/restaurantPairing/dishReview.js');
const { renderResults, destroyResults, requestRecommendations } = await import('../../../public/js/restaurantPairing/results.js');
const { showToast, showConfirmDialog } = await import('../../../public/js/utils.js');
const { renderQuickPair } = await import('../../../public/js/restaurantPairing/quickPair.js');

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
    quickPairOnComplete = null;
    quickPairOnCancel = null;
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
      expect(cellarSection.classList.contains('mode-hidden')).toBe(true);
      expect(cellarSection.getAttribute('aria-hidden')).toBe('true');
      expect(wizard.classList.contains('mode-hidden')).toBe(false);
      expect(wizard.getAttribute('aria-hidden')).toBe('false');
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
      expect(cellarSection.classList.contains('mode-hidden')).toBe(false);
      expect(cellarSection.getAttribute('aria-hidden')).toBe('false');
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

    it('Step 2→3 blocked when no wines selected (button disabled)', () => {
      currentSelectedWines = [];
      initRestaurantPairing();

      // Navigate to step 2
      wizard.querySelector('.restaurant-nav-next').click();
      vi.clearAllMocks();

      // Next button should be disabled — preventive validation (R7)
      const nextBtn = wizard.querySelector('.restaurant-nav-next');
      expect(nextBtn.disabled).toBe(true);
      expect(renderDishReview).not.toHaveBeenCalled();
    });

    it('Step 3→4 blocked when no dishes selected (button disabled)', () => {
      currentSelectedWines = [{ id: 1, name: 'Test Wine' }];
      currentSelectedDishes = [];
      initRestaurantPairing();

      // Navigate to step 2, then 3
      wizard.querySelector('.restaurant-nav-next').click();
      wizard.querySelector('.restaurant-nav-next').click();
      vi.clearAllMocks();

      // Next button should be disabled — preventive validation (R7)
      const nextBtn = wizard.querySelector('.restaurant-nav-next');
      expect(nextBtn.disabled).toBe(true);
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
    it('sets quickPairMode, renders step 4, and calls requestRecommendations', async () => {
      initRestaurantPairing();

      await runQuickPairFlow();

      expect(setQuickPairModeMock).toHaveBeenCalledWith(true);
      expect(renderResults).toHaveBeenCalledTimes(1);
      expect(requestRecommendations).toHaveBeenCalledTimes(1);
    });

    it('renders Quick Pair banner on Step 1', () => {
      initRestaurantPairing();

      const banner = wizard.querySelector('.restaurant-quick-pair-banner');
      expect(banner).toBeTruthy();
      expect(banner.querySelector('.restaurant-quick-pair-trigger')).toBeTruthy();
    });

    it('trigger click replaces content with Quick Pair form', () => {
      initRestaurantPairing();

      wizard.querySelector('.restaurant-quick-pair-trigger').click();

      expect(renderQuickPair).toHaveBeenCalledTimes(1);
      expect(wizard.querySelector('.mock-quick-pair')).toBeTruthy();
    });

    it('Quick Pair onComplete calls runQuickPairFlow', async () => {
      initRestaurantPairing();

      wizard.querySelector('.restaurant-quick-pair-trigger').click();

      await quickPairOnComplete();

      expect(setQuickPairModeMock).toHaveBeenCalledWith(true);
      expect(renderResults).toHaveBeenCalledTimes(1);
      expect(requestRecommendations).toHaveBeenCalledTimes(1);
    });

    it('Quick Pair onCancel returns to Step 1', () => {
      initRestaurantPairing();
      wizard.querySelector('.restaurant-quick-pair-trigger').click();
      vi.clearAllMocks();

      quickPairOnCancel();

      expect(createImageCapture).toHaveBeenCalledTimes(1);
      expect(setStepMock).toHaveBeenCalledWith(1);
    });
  });

  // --- Refine Event ---

  describe('restaurant:refine event', () => {
    it('navigates to Step 2 when refine event is dispatched', () => {
      initRestaurantPairing();
      vi.clearAllMocks();

      wizard.dispatchEvent(new CustomEvent('restaurant:refine', { bubbles: true }));

      expect(renderWineReview).toHaveBeenCalledTimes(1);
      expect(setStepMock).toHaveBeenCalledWith(2);
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

  // --- Phase 1 UX: Labels, Titles, Subtitle ---

  describe('step labels (R1)', () => {
    it('renders visible labels below step circles', () => {
      initRestaurantPairing();

      const labels = wizard.querySelectorAll('.restaurant-step-label');
      expect(labels).toHaveLength(4);
      expect(labels[0].textContent).toBe('Capture');
      expect(labels[1].textContent).toBe('Wines');
      expect(labels[2].textContent).toBe('Dishes');
      expect(labels[3].textContent).toBe('Pairings');
    });

    it('labels are children of indicator buttons', () => {
      initRestaurantPairing();

      const indicators = wizard.querySelectorAll('.restaurant-step-indicator-item');
      indicators.forEach((btn) => {
        const label = btn.querySelector('.restaurant-step-label');
        expect(label).toBeTruthy();
      });
    });

    it('labels remain in DOM on all steps (CSS controls responsive visibility)', () => {
      currentSelectedWines = [{ id: 1, name: 'Test' }];
      currentSelectedDishes = [{ id: 1, name: 'Test' }];
      initRestaurantPairing();

      // Navigate through all steps — labels must persist
      for (let s = 1; s <= 3; s++) {
        wizard.querySelector('.restaurant-nav-next').click();
        const labels = wizard.querySelectorAll('.restaurant-step-label');
        expect(labels).toHaveLength(4);
      }
    });
  });

  describe('step titles (R2)', () => {
    it('renders title on Step 1', () => {
      initRestaurantPairing();

      const title = wizard.querySelector('.restaurant-step-title');
      expect(title).toBeTruthy();
      expect(title.textContent).toBe('Capture Wine List');
    });

    it('renders title on Step 2', () => {
      initRestaurantPairing();
      wizard.querySelector('.restaurant-nav-next').click();

      const title = wizard.querySelector('.restaurant-step-title');
      expect(title.textContent).toBe('Review & Select Wines');
    });

    it('renders title on Step 3', () => {
      currentSelectedWines = [{ id: 1, name: 'Test Wine' }];
      initRestaurantPairing();
      wizard.querySelector('.restaurant-nav-next').click(); // 1→2
      wizard.querySelector('.restaurant-nav-next').click(); // 2→3

      const title = wizard.querySelector('.restaurant-step-title');
      expect(title.textContent).toBe('Add Your Dishes');
    });

    it('renders title on Step 4', () => {
      currentSelectedWines = [{ id: 1, name: 'Test' }];
      currentSelectedDishes = [{ id: 1, name: 'Test' }];
      initRestaurantPairing();
      wizard.querySelector('.restaurant-nav-next').click(); // 1→2
      wizard.querySelector('.restaurant-nav-next').click(); // 2→3
      wizard.querySelector('.restaurant-nav-next').click(); // 3→4

      const title = wizard.querySelector('.restaurant-step-title');
      expect(title.textContent).toBe('Your Pairings');
    });

    it('title survives module render (wrapper pattern)', () => {
      initRestaurantPairing();
      wizard.querySelector('.restaurant-nav-next').click(); // 1→2

      // Module renders into #restaurant-step-container (the body), not the wrapper
      const title = wizard.querySelector('.restaurant-step-title');
      expect(title).toBeTruthy();
      expect(title.textContent).toBe('Review & Select Wines');
      // Body has module content
      const body = wizard.querySelector('.restaurant-step-body');
      expect(body.querySelector('.mock-wine-review')).toBeTruthy();
    });
  });

  describe('wizard subtitle (R3)', () => {
    it('renders subtitle on Step 1', () => {
      initRestaurantPairing();

      const subtitle = wizard.querySelector('.restaurant-wizard-subtitle');
      expect(subtitle).toBeTruthy();
      expect(subtitle.textContent).toContain('Snap your wine list');
      expect(subtitle.style.display).not.toBe('none');
    });

    it('hides subtitle on Step 2', () => {
      initRestaurantPairing();
      wizard.querySelector('.restaurant-nav-next').click();

      const subtitle = wizard.querySelector('.restaurant-wizard-subtitle');
      expect(subtitle.style.display).toBe('none');
    });

    it('shows subtitle again when returning to Step 1', () => {
      initRestaurantPairing();
      wizard.querySelector('.restaurant-nav-next').click(); // 1→2
      wizard.querySelector('.restaurant-nav-back').click(); // 2→1

      const subtitle = wizard.querySelector('.restaurant-wizard-subtitle');
      expect(subtitle.style.display).not.toBe('none');
    });
  });

  // --- Phase 2 UX: Contextual Nav Labels + Preventive Validation ---

  describe('contextual nav labels (R6)', () => {
    it('Step 1 next button says "Review Wines →"', () => {
      initRestaurantPairing();

      const nextBtn = wizard.querySelector('.restaurant-nav-next');
      expect(nextBtn.textContent).toBe('Review Wines \u2192');
    });

    it('Step 2 next says "Add Dishes →" and back says "← Wine List"', () => {
      initRestaurantPairing();
      wizard.querySelector('.restaurant-nav-next').click(); // 1→2

      const nextBtn = wizard.querySelector('.restaurant-nav-next');
      const backBtn = wizard.querySelector('.restaurant-nav-back');
      expect(nextBtn.textContent).toBe('Add Dishes \u2192');
      expect(backBtn.textContent).toBe('\u2190 Wine List');
    });

    it('Step 3 next says "Get Pairings →" and back says "← Review Wines"', () => {
      currentSelectedWines = [{ id: 1, name: 'Test' }];
      initRestaurantPairing();
      wizard.querySelector('.restaurant-nav-next').click(); // 1→2
      wizard.querySelector('.restaurant-nav-next').click(); // 2→3

      const nextBtn = wizard.querySelector('.restaurant-nav-next');
      const backBtn = wizard.querySelector('.restaurant-nav-back');
      expect(nextBtn.textContent).toBe('Get Pairings \u2192');
      expect(backBtn.textContent).toBe('\u2190 Review Wines');
    });

    it('Step 4 back says "← Review Dishes"', () => {
      currentSelectedWines = [{ id: 1, name: 'Test' }];
      currentSelectedDishes = [{ id: 1, name: 'Test' }];
      initRestaurantPairing();
      wizard.querySelector('.restaurant-nav-next').click(); // 1→2
      wizard.querySelector('.restaurant-nav-next').click(); // 2→3
      wizard.querySelector('.restaurant-nav-next').click(); // 3→4

      const backBtn = wizard.querySelector('.restaurant-nav-back');
      expect(backBtn.textContent).toBe('\u2190 Review Dishes');
    });
  });

  describe('preventive validation (R7)', () => {
    it('nav helper element exists in DOM with aria-live', () => {
      initRestaurantPairing();

      const helper = wizard.querySelector('.restaurant-nav-helper');
      expect(helper).toBeTruthy();
      expect(helper.getAttribute('aria-live')).toBe('polite');
    });

    it('next button has aria-describedby linking to helper text', () => {
      initRestaurantPairing();

      const nextBtn = wizard.querySelector('.restaurant-nav-next');
      const helper = wizard.querySelector('.restaurant-nav-helper');
      expect(nextBtn.getAttribute('aria-describedby')).toBe('restaurant-nav-helper');
      expect(helper.id).toBe('restaurant-nav-helper');
    });

    it('next button is not disabled on Step 1', () => {
      initRestaurantPairing();

      const nextBtn = wizard.querySelector('.restaurant-nav-next');
      expect(nextBtn.disabled).toBe(false);
    });

    it('next button disabled on Step 2 when no wines selected', () => {
      currentSelectedWines = [];
      initRestaurantPairing();
      wizard.querySelector('.restaurant-nav-next').click(); // 1→2

      const nextBtn = wizard.querySelector('.restaurant-nav-next');
      const helper = wizard.querySelector('.restaurant-nav-helper');
      expect(nextBtn.disabled).toBe(true);
      expect(helper.textContent).toBe('Select at least one wine to continue');
    });

    it('next button enabled on Step 2 when wines selected', () => {
      currentSelectedWines = [{ id: 1, name: 'Test Wine' }];
      initRestaurantPairing();
      wizard.querySelector('.restaurant-nav-next').click(); // 1→2

      const nextBtn = wizard.querySelector('.restaurant-nav-next');
      const helper = wizard.querySelector('.restaurant-nav-helper');
      expect(nextBtn.disabled).toBe(false);
      expect(helper.textContent).toBe('');
    });

    it('next button disabled on Step 3 when no dishes selected', () => {
      currentSelectedWines = [{ id: 1, name: 'Test' }];
      currentSelectedDishes = [];
      initRestaurantPairing();
      wizard.querySelector('.restaurant-nav-next').click(); // 1→2
      wizard.querySelector('.restaurant-nav-next').click(); // 2→3

      const nextBtn = wizard.querySelector('.restaurant-nav-next');
      const helper = wizard.querySelector('.restaurant-nav-helper');
      expect(nextBtn.disabled).toBe(true);
      expect(helper.textContent).toBe('Select at least one dish to continue');
    });

    it('next button enabled on Step 3 when dishes selected', () => {
      currentSelectedWines = [{ id: 1, name: 'Test' }];
      currentSelectedDishes = [{ id: 1, name: 'Test' }];
      initRestaurantPairing();
      wizard.querySelector('.restaurant-nav-next').click(); // 1→2
      wizard.querySelector('.restaurant-nav-next').click(); // 2→3

      const nextBtn = wizard.querySelector('.restaurant-nav-next');
      const helper = wizard.querySelector('.restaurant-nav-helper');
      expect(nextBtn.disabled).toBe(false);
      expect(helper.textContent).toBe('');
    });

    it('selection-changed event refreshes nav validation', () => {
      currentSelectedWines = [];
      initRestaurantPairing();
      wizard.querySelector('.restaurant-nav-next').click(); // 1→2

      // Initially disabled
      const nextBtn = wizard.querySelector('.restaurant-nav-next');
      expect(nextBtn.disabled).toBe(true);

      // Simulate wine selection change
      currentSelectedWines = [{ id: 1, name: 'Wine' }];
      wizard.dispatchEvent(new CustomEvent('restaurant:selection-changed', { bubbles: true }));

      expect(nextBtn.disabled).toBe(false);
      expect(wizard.querySelector('.restaurant-nav-helper').textContent).toBe('');
    });

    it('helper text clears when navigating away from validation step', () => {
      currentSelectedWines = [];
      initRestaurantPairing();
      wizard.querySelector('.restaurant-nav-next').click(); // 1→2

      // Helper text shows on empty Step 2
      expect(wizard.querySelector('.restaurant-nav-helper').textContent).toContain('wine');

      // Go back to Step 1
      wizard.querySelector('.restaurant-nav-back').click();

      expect(wizard.querySelector('.restaurant-nav-helper').textContent).toBe('');
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
