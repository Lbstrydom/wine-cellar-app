/**
 * @fileoverview Step 3: Dish capture & review for restaurant pairing wizard.
 * Owns entire Step 3 — Section A: dish image/text capture (via imageCapture),
 * Section B: dish review cards with selection and manual add.
 * @module restaurantPairing/dishReview
 */

import { createImageCapture } from './imageCapture.js';
import {
  getDishes, getSelections, setDishSelected,
  addDish, removeDish, mergeDishes
} from './state.js';
import { showToast, escapeHtml } from '../utils.js';

/** Dish category options — must match backend DISH_CATEGORIES */
const CATEGORIES = ['Starter', 'Main', 'Dessert', 'Side', 'Sharing'];

// --- Module state ---

/** @type {Array<{el: Element, event: string, handler: Function}>} */
let listeners = [];
/** @type {Array<{el: Element, event: string, handler: Function}>} Re-created on each card render */
const cardListeners = [];
/** @type {HTMLElement|null} */
let rootContainer = null;
/** @type {{getImages: Function, getText: Function, destroy: Function}|null} */
let captureWidget = null;

// --- Helpers ---

function addListener(el, event, handler) {
  el.addEventListener(event, handler);
  listeners.push({ el, event, handler });
}

function addCardListener(el, event, handler) {
  el.addEventListener(event, handler);
  cardListeners.push({ el, event, handler });
}

function cleanupCardListeners() {
  for (const { el, event, handler } of cardListeners) {
    el.removeEventListener(event, handler);
  }
  cardListeners.length = 0;
}

// --- Render ---

/**
 * Render Step 3 dish review into the given container.
 * @param {string} containerId - DOM element ID to render into
 * @param {{used: number}} parseBudget - Shared parse budget tracker
 */
export function renderDishReview(containerId, parseBudget) {
  rootContainer = document.getElementById(containerId);
  if (!rootContainer) return;

  rootContainer.innerHTML = `
    <div class="restaurant-dish-review" role="region" aria-label="Dish review">
      <div class="restaurant-dish-capture-section">
        <h3>Capture Dish Menu</h3>
        <div class="restaurant-dish-capture-container"></div>
      </div>
      <div class="restaurant-dish-review-section">
        <div class="restaurant-triage-banner" role="alert"></div>
        <div class="restaurant-dish-counter" aria-live="polite"></div>
        <div class="restaurant-dish-cards" role="list"></div>
        <div class="restaurant-add-dish-form">
          <h4>Add Dish Manually</h4>
          <div class="restaurant-form-row">
            <input type="text" class="restaurant-add-dish-name" placeholder="Dish name" required
                   aria-label="Dish name">
            <select class="restaurant-add-dish-category" aria-label="Category">
              <option value="">Category</option>
              ${CATEGORIES.map(c => `<option value="${c}">${c}</option>`).join('')}
            </select>
          </div>
          <div class="restaurant-form-row">
            <input type="text" class="restaurant-add-dish-desc" placeholder="Description (optional)"
                   aria-label="Dish description">
          </div>
          <button class="btn btn-secondary restaurant-add-dish-btn" type="button">Add Dish</button>
        </div>
      </div>
    </div>
  `;

  // --- Create image capture widget ---
  const captureContainer = rootContainer.querySelector('.restaurant-dish-capture-container');
  captureWidget = createImageCapture(captureContainer, {
    type: 'dish_menu',
    maxImages: 4,
    parseBudget: parseBudget || { used: 0 },
    onAnalyze: (items) => {
      mergeDishes(items);
      renderDishCards();
      updateDishCounter();
      updateTriageBanner();
    }
  });

  // --- Bind add dish form ---
  const addDishBtn = rootContainer.querySelector('.restaurant-add-dish-btn');
  addListener(addDishBtn, 'click', () => {
    const nameInput = rootContainer.querySelector('.restaurant-add-dish-name');
    const categorySelect = rootContainer.querySelector('.restaurant-add-dish-category');
    const descInput = rootContainer.querySelector('.restaurant-add-dish-desc');

    const name = nameInput.value.trim();
    if (!name) {
      showToast('Dish name is required', 'error');
      return;
    }

    addDish({
      name,
      category: categorySelect.value || null,
      description: descInput.value.trim() || null
    });

    // Reset form
    nameInput.value = '';
    categorySelect.value = '';
    descInput.value = '';

    renderDishCards();
    updateDishCounter();
    updateTriageBanner();
  });

  // Initial render
  renderDishCards();
  updateDishCounter();
  updateTriageBanner();
}

// --- Sub-renders ---

function renderDishCards() {
  const cardsContainer = rootContainer.querySelector('.restaurant-dish-cards');
  if (!cardsContainer) return;

  // Clean up previous card listeners before replacing DOM
  cleanupCardListeners();

  const dishes = getDishes();
  const selections = getSelections();

  cardsContainer.innerHTML = dishes.map(dish => {
    const selected = selections.dishes[dish.id] !== false;
    const isLow = dish.confidence === 'low';
    const confBadge = isLow
      ? '<span class="restaurant-conf-badge restaurant-conf-low">Low</span>'
      : dish.confidence === 'medium'
        ? '<span class="restaurant-conf-badge restaurant-conf-medium">Med</span>'
        : '';

    return `<div class="restaurant-dish-card${isLow ? ' restaurant-low-confidence' : ''}"
                 role="checkbox" aria-checked="${selected}" aria-label="Select ${escapeHtml(dish.name)}"
                 data-dish-id="${dish.id}" tabindex="0">
      <span class="restaurant-card-check">${selected ? '✓' : ''}</span>
      ${selected ? '<span class="sr-only">Selected</span>' : ''}
      <div class="restaurant-card-info">
        <strong>${escapeHtml(dish.name)}</strong>
        ${dish.category ? `<span class="restaurant-card-category">${escapeHtml(dish.category)}</span>` : ''}
        ${dish.description ? `<span class="restaurant-card-desc">${escapeHtml(dish.description)}</span>` : ''}
        ${confBadge}
      </div>
      <button class="restaurant-dish-remove" type="button" aria-label="Remove ${escapeHtml(dish.name)}"
              data-remove-dish="${dish.id}">&times;</button>
    </div>`;
  }).join('');

  // Bind card click + keyboard (toggle selection)
  cardsContainer.querySelectorAll('.restaurant-dish-card').forEach(card => {
    const dishId = Number(card.dataset.dishId);
    const toggle = () => {
      const current = getSelections().dishes[dishId] !== false;
      setDishSelected(dishId, !current);
      renderDishCards();
      updateDishCounter();
    };
    const clickHandler = (e) => {
      if (e.target.closest('.restaurant-dish-remove')) return;
      toggle();
    };
    const keyHandler = (e) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        toggle();
      }
    };
    addCardListener(card, 'click', clickHandler);
    addCardListener(card, 'keydown', keyHandler);
  });

  // Bind remove buttons
  cardsContainer.querySelectorAll('.restaurant-dish-remove').forEach(btn => {
    const dishId = Number(btn.dataset.removeDish);
    const handler = (e) => {
      e.stopPropagation();
      removeDish(dishId);
      renderDishCards();
      updateDishCounter();
      updateTriageBanner();
    };
    addCardListener(btn, 'click', handler);
  });
}

function updateDishCounter() {
  const counterEl = rootContainer.querySelector('.restaurant-dish-counter');
  if (!counterEl) return;

  const dishes = getDishes();
  const selections = getSelections();
  const selectedCount = dishes.filter(d => selections.dishes[d.id] !== false).length;
  const totalCount = dishes.length;

  counterEl.textContent = `${selectedCount} of ${totalCount} dishes selected`;
}

function updateTriageBanner() {
  const bannerEl = rootContainer.querySelector('.restaurant-triage-banner');
  if (!bannerEl) return;

  const dishes = getDishes();
  const lowCount = dishes.filter(d => d.confidence === 'low').length;

  if (lowCount > 0) {
    bannerEl.textContent = `Review ${lowCount} uncertain item${lowCount > 1 ? 's' : ''}`;
    bannerEl.style.display = '';
  } else {
    bannerEl.textContent = '';
    bannerEl.style.display = 'none';
  }
}

// --- Cleanup ---

/**
 * Destroy dish review, cleaning up capture widget and event listeners.
 */
export function destroyDishReview() {
  if (captureWidget) {
    captureWidget.destroy();
    captureWidget = null;
  }
  cleanupCardListeners();
  for (const { el, event, handler } of listeners) {
    el.removeEventListener(event, handler);
  }
  listeners = [];
  rootContainer = null;
}
