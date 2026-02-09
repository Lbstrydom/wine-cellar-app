/**
 * @fileoverview Restaurant pairing wizard controller.
 * Orchestrates 4-step wizard: capture → wine review → dish review → results.
 * Kept deliberately thin — delegates step rendering to step modules.
 * @module restaurantPairing
 */

import {
  getStep, setStep,
  getSelectedWines, getSelectedDishes,
  mergeWines,
  hasData, clearState,
  setQuickPairMode
} from './restaurantPairing/state.js';
import { createImageCapture } from './restaurantPairing/imageCapture.js';
import { renderQuickPair } from './restaurantPairing/quickPair.js';
import { renderWineReview, destroyWineReview } from './restaurantPairing/wineReview.js';
import { renderDishReview, destroyDishReview } from './restaurantPairing/dishReview.js';
import { renderResults, destroyResults, requestRecommendations } from './restaurantPairing/results.js';
import { showToast, showConfirmDialog } from './utils.js';

/** Step labels for the indicator */
const STEP_LABELS = ['Capture', 'Wines', 'Dishes', 'Pairings'];

// --- Module state ---

/** @type {Function|null} Destroy function for current step */
let currentStepDestroy = null;
/** Shared parse budget tracker across Step 1 and Step 3 capture widgets */
const parseBudget = { used: 0 };
/** @type {Array<{el: Element, event: string, handler: Function}>} */
let listeners = [];
/** @type {HTMLElement|null} */
let wizardContainer = null;

// --- Helpers ---

function addListener(el, event, handler) {
  el.addEventListener(event, handler);
  listeners.push({ el, event, handler });
}

/**
 * Destroy current step's resources.
 */
function destroyCurrentStep() {
  if (currentStepDestroy) {
    currentStepDestroy();
    currentStepDestroy = null;
  }
}

// --- Step Rendering ---

/**
 * Render a specific wizard step.
 * @param {number} step - Step number (1-4)
 */
function renderStep(step) {
  destroyCurrentStep();
  setStep(step);

  const STEP_TITLES = ['Capture Wine List', 'Review & Select Wines', 'Add Your Dishes', 'Your Pairings'];
  const stepContainer = wizardContainer.querySelector('.restaurant-step-content');
  if (!stepContainer) return;

  // Create wrapper with persistent title + body mount
  stepContainer.innerHTML = `
    <div class="restaurant-step-wrapper">
      <h3 class="restaurant-step-title">${STEP_TITLES[step - 1]}</h3>
      <div class="restaurant-step-body" id="restaurant-step-container"></div>
    </div>
  `;

  // Toggle subtitle (visible on Step 1 only)
  const subtitle = wizardContainer.querySelector('.restaurant-wizard-subtitle');
  if (subtitle) subtitle.style.display = step === 1 ? '' : 'none';

  const stepBody = stepContainer.querySelector('#restaurant-step-container');

  switch (step) {
    case 1: {
      // Quick Pair banner (only on Step 1)
      const bannerHtml = `
        <div class="restaurant-quick-pair-banner">
          <button class="btn btn-link restaurant-quick-pair-trigger" type="button">
            ⚡ Quick Pair — snap &amp; type → instant pairings
          </button>
        </div>`;
      stepBody.insertAdjacentHTML('afterbegin', bannerHtml);

      // Wire Quick Pair trigger (tracked via addListener for cleanup)
      const qpTrigger = stepBody.querySelector('.restaurant-quick-pair-trigger');
      addListener(qpTrigger, 'click', () => {
        // Replace step body with quick pair form (preserves title wrapper)
        destroyCurrentStep();
        stepBody.innerHTML = '';
        const qp = renderQuickPair(stepBody, {
          parseBudget,
          onComplete: async () => {
            await runQuickPairFlow();
          },
          onCancel: () => {
            renderStep(1); // Return to full Step 1
          }
        });
        currentStepDestroy = () => qp.destroy();
      });

      // Sub-container for capture widget (so banner is preserved)
      const captureContainer = document.createElement('div');
      stepBody.appendChild(captureContainer);
      const captureWidget = createImageCapture(captureContainer, {
        type: 'wine_list',
        maxImages: 4,
        parseBudget,
        onAnalyze: (items) => {
          mergeWines(items);
          renderStep(2);
        }
      });
      currentStepDestroy = () => captureWidget.destroy();
      break;
    }
    case 2:
      renderWineReview('restaurant-step-container');
      currentStepDestroy = destroyWineReview;
      break;
    case 3:
      renderDishReview('restaurant-step-container', parseBudget);
      currentStepDestroy = destroyDishReview;
      break;
    case 4:
      renderResults('restaurant-step-container');
      currentStepDestroy = destroyResults;
      break;
  }

  updateStepIndicator(step);
  updateNavButtons(step);
}

// --- Step Indicator ---

/**
 * Update step indicator to highlight active step.
 * @param {number} activeStep
 */
function updateStepIndicator(activeStep) {
  const indicators = wizardContainer.querySelectorAll('.restaurant-step-indicator-item');
  indicators.forEach((el, i) => {
    const stepNum = i + 1;
    el.classList.toggle('active', stepNum === activeStep);
    el.classList.toggle('completed', stepNum < activeStep);
    if (stepNum === activeStep) {
      el.setAttribute('aria-current', 'step');
    } else {
      el.removeAttribute('aria-current');
    }
  });
}

// --- Navigation ---

/** Contextual nav button labels per step */
const NEXT_LABELS = ['Review Wines \u2192', 'Add Dishes \u2192', 'Get Pairings \u2192'];
const BACK_LABELS = ['\u2190 Wine List', '\u2190 Review Wines', '\u2190 Review Dishes'];

/**
 * Update nav button visibility, text, and validation state.
 * @param {number} step
 */
function updateNavButtons(step) {
  const backBtn = wizardContainer.querySelector('.restaurant-nav-back');
  const nextBtn = wizardContainer.querySelector('.restaurant-nav-next');
  const helperEl = wizardContainer.querySelector('.restaurant-nav-helper');

  // Visibility + contextual labels (R6)
  if (backBtn) {
    backBtn.style.display = step === 1 ? 'none' : '';
    if (step > 1) backBtn.textContent = BACK_LABELS[step - 2];
  }
  if (nextBtn) {
    nextBtn.style.display = step === 4 ? 'none' : '';
    if (step < 4) nextBtn.textContent = NEXT_LABELS[step - 1];
  }

  // Preventive validation (R7)
  if (nextBtn && helperEl) {
    if (step === 2) {
      const wineCount = getSelectedWines().length;
      nextBtn.disabled = wineCount === 0;
      helperEl.textContent = wineCount === 0 ? 'Select at least one wine to continue' : '';
    } else if (step === 3) {
      const dishCount = getSelectedDishes().length;
      nextBtn.disabled = dishCount === 0;
      helperEl.textContent = dishCount === 0 ? 'Select at least one dish to continue' : '';
    } else {
      nextBtn.disabled = false;
      helperEl.textContent = '';
    }
  }
}

/**
 * Navigate to next step with validation.
 */
function handleNext() {
  const currentStep = getStep();

  // Validation gates
  if (currentStep === 2 && getSelectedWines().length === 0) {
    showToast('Select at least one wine to continue', 'error');
    return;
  }
  if (currentStep === 3 && getSelectedDishes().length === 0) {
    showToast('Select at least one dish to continue', 'error');
    return;
  }

  if (currentStep < 4) {
    renderStep(currentStep + 1);
  }
}

/**
 * Navigate to previous step.
 */
function handleBack() {
  const currentStep = getStep();
  if (currentStep > 1) {
    renderStep(currentStep - 1);
  }
}

// --- Start Over ---

/**
 * Handle Start Over with confirm dialog if data exists.
 */
async function handleStartOver() {
  if (hasData()) {
    const confirmed = await showConfirmDialog({
      title: 'Start Over?',
      message: 'This will clear all captured wines, dishes, and pairings. Continue?',
      confirmText: 'Start Over',
      cancelText: 'Cancel'
    });
    if (!confirmed) return;
  }

  clearState();
  parseBudget.used = 0;
  renderStep(1);
}

// --- Quick Pair ---

/**
 * Run Quick Pair flow: data already merged into state by quickPair.js.
 * Sets quickPairMode flag, renders Step 4, and requests recommendations.
 */
export async function runQuickPairFlow() {
  try {
    setQuickPairMode(true);
    renderStep(4);
    await requestRecommendations();
  } catch (err) {
    console.error('Quick Pair error:', err);
    showToast('Failed to get pairing recommendations', 'error');
    throw err;
  }
}

// --- Mode Toggle ---

/**
 * Toggle between cellar and restaurant modes.
 * @param {'cellar'|'restaurant'} mode
 */
function setMode(mode) {
  const cellarSections = document.querySelectorAll('.pairing-cellar-section');
  const wizard = wizardContainer;

  if (mode === 'restaurant') {
    cellarSections.forEach(el => {
      el.classList.add('mode-hidden');
      el.setAttribute('aria-hidden', 'true');
    });
    if (wizard) {
      wizard.classList.remove('mode-hidden');
      wizard.setAttribute('aria-hidden', 'false');
    }
  } else {
    cellarSections.forEach(el => {
      el.classList.remove('mode-hidden');
      el.setAttribute('aria-hidden', 'false');
    });
    if (wizard) {
      wizard.classList.add('mode-hidden');
      wizard.setAttribute('aria-hidden', 'true');
    }
  }

  // Update toggle buttons
  const toggleBtns = document.querySelectorAll('.restaurant-mode-toggle .toggle-btn');
  toggleBtns.forEach(btn => {
    const btnMode = btn.dataset.mode;
    btn.setAttribute('aria-selected', String(btnMode === mode));
    btn.classList.toggle('active', btnMode === mode);
  });
}

// --- Cleanup ---

/**
 * Clean up restaurant pairing wizard resources.
 * Removes all event listeners and destroys current step.
 */
export function destroyRestaurantPairing() {
  // Destroy current step module
  destroyCurrentStep();

  // Remove all controller-level listeners
  listeners.forEach(({ el, event, handler }) => {
    el.removeEventListener(event, handler);
  });
  listeners = [];

  // Nullify container reference
  wizardContainer = null;
}

// --- Init ---

/**
 * Initialize restaurant pairing wizard.
 * Called from app.js on load.
 */
export function initRestaurantPairing() {
  // Clean up any previous initialization
  destroyRestaurantPairing();

  wizardContainer = document.querySelector('.restaurant-wizard');
  if (!wizardContainer) return;

  // Build wizard UI
  wizardContainer.innerHTML = `
    <div class="restaurant-wizard-header">
      <nav class="restaurant-step-indicator" role="navigation" aria-label="Wizard progress">
        ${STEP_LABELS.map((label, i) => {
          const num = i + 1;
          return `<button class="restaurant-step-indicator-item" type="button"
                          data-step="${num}" aria-label="Step ${num}: ${label}">
                    ${num}
                    <span class="restaurant-step-label">${label}</span>
                  </button>`;
        }).join('')}
      </nav>
      <button class="btn btn-outline restaurant-start-over-btn" type="button">Start Over</button>
    </div>
    <p class="restaurant-wizard-subtitle text-muted">
      Snap your wine list \u2192 pick dishes \u2192 get AI pairings
    </p>
    <div class="restaurant-step-content"></div>
    <div class="restaurant-nav-bar">
      <button class="btn btn-secondary restaurant-nav-back" type="button"
              aria-label="Go to previous step">Back</button>
      <div class="restaurant-nav-next-group">
        <button class="btn btn-primary restaurant-nav-next" type="button"
                aria-label="Go to next step" aria-describedby="restaurant-nav-helper">Next</button>
        <span class="restaurant-nav-helper text-muted" id="restaurant-nav-helper" aria-live="polite"></span>
      </div>
    </div>
  `;

  // --- Bind navigation ---
  const backBtn = wizardContainer.querySelector('.restaurant-nav-back');
  const nextBtn = wizardContainer.querySelector('.restaurant-nav-next');
  const startOverBtn = wizardContainer.querySelector('.restaurant-start-over-btn');

  addListener(backBtn, 'click', handleBack);
  addListener(nextBtn, 'click', handleNext);
  addListener(startOverBtn, 'click', () => {
    handleStartOver().catch(err => {
      console.error('Start Over error:', err);
      showToast('Error resetting wizard', 'error');
    });
  });

  // --- Bind step indicator clicks ---
  wizardContainer.querySelectorAll('.restaurant-step-indicator-item').forEach(btn => {
    addListener(btn, 'click', () => {
      const targetStep = Number(btn.dataset.step);
      const current = getStep();
      // Only allow clicking completed steps (earlier than current)
      if (targetStep < current) {
        renderStep(targetStep);
      }
    });
  });

  // --- Bind refine event (dispatched from results.js, avoids circular import) ---
  addListener(wizardContainer, 'restaurant:refine', () => {
    renderStep(2);
  });

  // --- Bind selection-changed event (dispatched from wineReview / dishReview) ---
  addListener(wizardContainer, 'restaurant:selection-changed', () => {
    updateNavButtons(getStep());
  });

  // --- Bind mode toggle ---
  document.querySelectorAll('.restaurant-mode-toggle .toggle-btn').forEach(btn => {
    addListener(btn, 'click', () => {
      setMode(btn.dataset.mode);
    });
  });

  // --- State restoration ---
  const savedStep = getStep();
  if (savedStep > 1 && hasData()) {
    renderStep(savedStep);
  } else {
    renderStep(1);
  }
}
