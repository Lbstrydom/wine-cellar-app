/**
 * @fileoverview Step 2: Wine review & filter for restaurant pairing wizard.
 * Renders selectable wine cards with colour/price/glass filters, triage
 * banner, counter, and manual add form.
 * @module restaurantPairing/wineReview
 */

import {
  getWines, getSelections, setWineSelected,
  addWine, removeWine, selectAllWines, deselectAllWines,
  updateWineField
} from './state.js';
import { showToast, escapeHtml } from '../utils.js';

/** Wine colour options — values match backend canonical (lowercase, no diacritics) */
const COLOURS = [
  { value: 'red', label: 'Red' },
  { value: 'white', label: 'White' },
  { value: 'rose', label: 'Rosé' },
  { value: 'sparkling', label: 'Sparkling' }
];

// --- Module state ---

/** @type {Array<{el: Element, event: string, handler: Function}>} */
let listeners = [];
/** @type {Array<{el: Element, event: string, handler: Function}>} Re-created on each card render */
const cardListeners = [];
/** @type {Array<{el: Element, event: string, handler: Function}>} Re-created on each chip render */
const chipListeners = [];
/** @type {HTMLElement|null} */
let rootContainer = null;

// Filter state (local — not persisted)
/** @type {Set<string>} Active colour filters (empty = show all) */
let activeColours = new Set();
/** @type {number|null} Max price filter */
let maxPrice = null;
/** @type {boolean} By-the-glass filter */
let btgOnly = false;

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

function addChipListener(el, event, handler) {
  el.addEventListener(event, handler);
  chipListeners.push({ el, event, handler });
}

/** Notify parent wizard that wine selection changed (R7 — preventive validation). */
function dispatchSelectionChanged() {
  if (rootContainer) {
    rootContainer.dispatchEvent(new CustomEvent('restaurant:selection-changed', { bubbles: true }));
  }
}

function cleanupChipListeners() {
  for (const { el, event, handler } of chipListeners) {
    el.removeEventListener(event, handler);
  }
  chipListeners.length = 0;
}

/**
 * Test whether a wine passes current filters.
 * @param {Object} wine
 * @returns {boolean}
 */
function passesFilter(wine) {
  if (activeColours.size > 0) {
    const colour = (wine.colour || '').toLowerCase();
    if (!activeColours.has(colour)) return false;
  }
  if (maxPrice != null && wine.price != null && wine.price > maxPrice) {
    return false;
  }
  if (btgOnly && !wine.by_the_glass) {
    return false;
  }
  return true;
}

/**
 * Get a predicate matching only currently visible wines.
 * @returns {Function}
 */
function visiblePredicate() {
  return (wine) => passesFilter(wine);
}

/**
 * Count wines by colour.
 * @returns {Map<string, number>}
 */
function colourCounts() {
  const counts = new Map();
  for (const c of COLOURS) counts.set(c.value, 0);
  for (const wine of getWines()) {
    const colour = (wine.colour || '').toLowerCase();
    if (counts.has(colour)) {
      counts.set(colour, counts.get(colour) + 1);
    }
  }
  return counts;
}

// --- Render ---

/**
 * Render Step 2 wine review into the given container.
 * @param {string} containerId - DOM element ID to render into
 */
export function renderWineReview(containerId) {
  rootContainer = document.getElementById(containerId);
  if (!rootContainer) return;

  // Reset filter state on fresh render
  activeColours = new Set();
  maxPrice = null;
  btgOnly = false;

  rootContainer.innerHTML = `
    <div class="restaurant-wine-review" role="region" aria-label="Wine review">
      <div class="restaurant-triage-banner" role="alert"></div>
      <div class="restaurant-wine-filters">
        <div class="restaurant-colour-filters" role="group" aria-label="Filter by colour"></div>
        <div class="restaurant-price-filter">
          <label for="restaurant-max-price">Max price</label>
          <input type="number" id="restaurant-max-price" class="restaurant-max-price-input"
                 min="0" step="1" placeholder="Any" aria-label="Maximum price filter">
        </div>
        <label class="restaurant-btg-toggle">
          <input type="checkbox" class="restaurant-btg-checkbox"> By the glass only
        </label>
      </div>
      <div class="restaurant-wine-counter" aria-live="polite"></div>
      <div class="restaurant-select-actions">
        <button class="btn btn-secondary restaurant-select-all-btn" type="button">Select All Visible</button>
      </div>
      <div class="restaurant-wine-cards" role="list"></div>
      <div class="restaurant-add-wine-form">
        <h4>Add Wine Manually</h4>
        <div class="restaurant-form-row">
          <input type="text" class="restaurant-add-wine-name" placeholder="Wine name" required
                 aria-label="Wine name">
          <input type="number" class="restaurant-add-wine-vintage" placeholder="Vintage" min="1900" max="2100"
                 aria-label="Vintage">
        </div>
        <div class="restaurant-form-row">
          <select class="restaurant-add-wine-colour" aria-label="Colour">
            <option value="">Colour</option>
            ${COLOURS.map(c => `<option value="${c.value}">${c.label}</option>`).join('')}
          </select>
          <input type="number" class="restaurant-add-wine-price" placeholder="Price" min="0" step="0.01"
                 inputmode="decimal" aria-label="Price">
          <label class="restaurant-add-wine-btg-label">
            <input type="checkbox" class="restaurant-add-wine-btg"> BTG
          </label>
        </div>
        <button class="btn btn-secondary restaurant-add-wine-btn" type="button">Add Wine</button>
      </div>
    </div>
  `;

  // --- DOM refs ---
  const colourFiltersEl = rootContainer.querySelector('.restaurant-colour-filters');
  const priceInput = rootContainer.querySelector('.restaurant-max-price-input');
  const btgCheckbox = rootContainer.querySelector('.restaurant-btg-checkbox');
  const selectAllBtn = rootContainer.querySelector('.restaurant-select-all-btn');
  const addWineBtn = rootContainer.querySelector('.restaurant-add-wine-btn');

  // --- Colour filter chips ---
  renderColourChips(colourFiltersEl);

  // --- Bind filter events ---
  addListener(priceInput, 'input', () => {
    const val = priceInput.value.trim();
    maxPrice = val === '' ? null : Number(val);
    applyFiltersAndUpdate();
  });

  addListener(btgCheckbox, 'change', () => {
    btgOnly = btgCheckbox.checked;
    applyFiltersAndUpdate();
  });

  addListener(selectAllBtn, 'click', () => {
    const wines = getWines();
    const selections = getSelections();
    const visibleWines = wines.filter(passesFilter);
    const allVisibleSelected = visibleWines.length > 0 &&
      visibleWines.every(w => selections.wines[w.id] !== false);

    if (allVisibleSelected) {
      deselectAllWines(visiblePredicate());
    } else {
      selectAllWines(visiblePredicate());
    }
    renderCards();
    updateCounter();
    updateSelectAllLabel();
    dispatchSelectionChanged();
  });

  // --- Add wine form ---
  addListener(addWineBtn, 'click', () => {
    const nameInput = rootContainer.querySelector('.restaurant-add-wine-name');
    const vintageInput = rootContainer.querySelector('.restaurant-add-wine-vintage');
    const colourSelect = rootContainer.querySelector('.restaurant-add-wine-colour');
    const priceIn = rootContainer.querySelector('.restaurant-add-wine-price');
    const btgIn = rootContainer.querySelector('.restaurant-add-wine-btg');

    const name = nameInput.value.trim();
    if (!name) {
      showToast('Wine name is required', 'error');
      return;
    }

    addWine({
      name,
      vintage: vintageInput.value ? Number(vintageInput.value) : null,
      colour: colourSelect.value || null,
      price: priceIn.value ? Number(priceIn.value) : null,
      by_the_glass: btgIn.checked
    });

    // Reset form
    nameInput.value = '';
    vintageInput.value = '';
    colourSelect.value = '';
    priceIn.value = '';
    btgIn.checked = false;

    renderColourChips(colourFiltersEl);
    renderCards();
    updateCounter();
    updateTriageBanner();
    dispatchSelectionChanged();
  });

  // Initial render
  renderCards();
  updateCounter();
  updateTriageBanner();
  updateSelectAllLabel();
}

// --- Sub-renders ---

function renderColourChips(container) {
  cleanupChipListeners();

  const counts = colourCounts();
  container.innerHTML = COLOURS.map(({ value, label }) => {
    const count = counts.get(value) || 0;
    const active = activeColours.has(value);
    return `<button class="filter-chip restaurant-colour-chip${active ? ' active' : ''}"
                    type="button" data-colour="${value}"
                    aria-pressed="${active}">${label} (${count})</button>`;
  }).join('');

  // Bind chip clicks
  container.querySelectorAll('.restaurant-colour-chip').forEach(chip => {
    const handler = () => {
      const colour = chip.dataset.colour;
      if (activeColours.has(colour)) {
        activeColours.delete(colour);
      } else {
        activeColours.add(colour);
      }
      renderColourChips(container);
      applyFiltersAndUpdate();
    };
    addChipListener(chip, 'click', handler);
  });
}

function renderCards() {
  const cardsContainer = rootContainer.querySelector('.restaurant-wine-cards');
  if (!cardsContainer) return;

  // Clean up previous card/chip listeners before replacing DOM
  cleanupCardListeners();

  const wines = getWines();
  const selections = getSelections();

  cardsContainer.innerHTML = wines.map(wine => {
    const selected = selections.wines[wine.id] !== false;
    const visible = passesFilter(wine);
    const isLow = wine.confidence === 'low';
    const displayStyle = visible ? '' : 'display:none;';
    const btgBadge = wine.by_the_glass ? '<span class="restaurant-btg-badge">BTG</span>' : '';
    const confBadge = isLow
      ? '<span class="restaurant-conf-badge restaurant-conf-low">Low</span>'
      : wine.confidence === 'medium'
        ? '<span class="restaurant-conf-badge restaurant-conf-medium">Med</span>'
        : '';

    // Low-confidence: inline editable price field; otherwise read-only text
    const priceHtml = isLow
      ? `<input type="number" class="restaurant-inline-price" inputmode="decimal"
               data-price-wine="${wine.id}" value="${wine.price ?? ''}"
               min="0" step="0.01" aria-label="Edit price for ${escapeHtml(wine.name)}">`
      : wine.price != null
        ? `<span class="restaurant-card-price">$${escapeHtml(String(wine.price))}</span>`
        : '';

    return `<div class="restaurant-wine-card${isLow ? ' restaurant-low-confidence' : ''}"
                 role="checkbox" aria-checked="${selected}" aria-label="Select ${escapeHtml(wine.name)}"
                 data-wine-id="${wine.id}" style="${displayStyle}" tabindex="0">
      <span class="restaurant-card-check">${selected ? '✓' : ''}</span>
      ${selected ? '<span class="sr-only">Selected</span>' : ''}
      <div class="restaurant-card-info">
        <strong>${escapeHtml(wine.name)}</strong>
        ${wine.vintage ? `<span class="restaurant-card-vintage">${escapeHtml(String(wine.vintage))}</span>` : ''}
        ${wine.colour ? `<span class="restaurant-card-colour">${escapeHtml(wine.colour)}</span>` : ''}
        ${priceHtml}
        ${btgBadge}${confBadge}
      </div>
      <button class="restaurant-wine-remove" type="button" aria-label="Remove ${escapeHtml(wine.name)}"
              data-remove-wine="${wine.id}">&times;</button>
    </div>`;
  }).join('');

  // Bind card click + keyboard (toggle selection)
  cardsContainer.querySelectorAll('.restaurant-wine-card').forEach(card => {
    const wineId = Number(card.dataset.wineId);
    const toggle = () => {
      const current = getSelections().wines[wineId] !== false;
      setWineSelected(wineId, !current);
      renderCards();
      updateCounter();
      updateSelectAllLabel();
      dispatchSelectionChanged();
    };
    const clickHandler = (e) => {
      if (e.target.closest('.restaurant-wine-remove')) return;
      if (e.target.closest('.restaurant-inline-price')) return;
      toggle();
    };
    const keyHandler = (e) => {
      if (e.key === ' ' || e.key === 'Enter') {
        if (e.target.closest('.restaurant-inline-price')) return;
        e.preventDefault();
        toggle();
      }
    };
    addCardListener(card, 'click', clickHandler);
    addCardListener(card, 'keydown', keyHandler);
  });

  // Bind inline price edits (low-confidence items)
  cardsContainer.querySelectorAll('.restaurant-inline-price').forEach(input => {
    const wineId = Number(input.dataset.priceWine);
    const handler = () => {
      const newPrice = input.value ? Number(input.value) : null;
      updateWineField(wineId, 'price', newPrice);
    };
    addCardListener(input, 'change', handler);
  });


  // Bind remove buttons
  cardsContainer.querySelectorAll('.restaurant-wine-remove').forEach(btn => {
    const wineId = Number(btn.dataset.removeWine);
    const handler = (e) => {
      e.stopPropagation();
      removeWine(wineId);
      const colourFiltersEl = rootContainer.querySelector('.restaurant-colour-filters');
      renderColourChips(colourFiltersEl);
      renderCards();
      updateCounter();
      updateTriageBanner();
      updateSelectAllLabel();
      dispatchSelectionChanged();
    };
    addCardListener(btn, 'click', handler);
  });
}

function updateCounter() {
  const counterEl = rootContainer.querySelector('.restaurant-wine-counter');
  if (!counterEl) return;

  const wines = getWines();
  const selections = getSelections();
  const selectedCount = wines.filter(w => selections.wines[w.id] !== false).length;
  const visibleCount = wines.filter(passesFilter).length;

  counterEl.textContent = `${selectedCount} selected (${visibleCount} visible)`;
}

function updateTriageBanner() {
  const bannerEl = rootContainer.querySelector('.restaurant-triage-banner');
  if (!bannerEl) return;

  const wines = getWines();
  const lowCount = wines.filter(w => w.confidence === 'low').length;

  if (lowCount > 0) {
    bannerEl.textContent = `Review ${lowCount} uncertain item${lowCount > 1 ? 's' : ''}`;
    bannerEl.style.display = '';
  } else {
    bannerEl.textContent = '';
    bannerEl.style.display = 'none';
  }
}

function updateSelectAllLabel() {
  const btn = rootContainer.querySelector('.restaurant-select-all-btn');
  if (!btn) return;

  const wines = getWines();
  const selections = getSelections();
  const visibleWines = wines.filter(passesFilter);
  const allVisibleSelected = visibleWines.length > 0 &&
    visibleWines.every(w => selections.wines[w.id] !== false);

  btn.textContent = allVisibleSelected ? 'Deselect All Visible' : 'Select All Visible';
}

function applyFiltersAndUpdate() {
  renderCards();
  updateCounter();
  updateSelectAllLabel();
}

// --- Cleanup ---

/**
 * Destroy wine review, removing all event listeners.
 */
export function destroyWineReview() {
  cleanupCardListeners();
  cleanupChipListeners();
  for (const { el, event, handler } of listeners) {
    el.removeEventListener(event, handler);
  }
  listeners = [];
  rootContainer = null;
}
