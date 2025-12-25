/**
 * @fileoverview Cellar and fridge grid rendering.
 * @module grid
 */

import { shortenWineName } from './utils.js';
import { state } from './app.js';
import { setupDragAndDrop } from './dragdrop.js';
import { handleSlotClick } from './bottles.js';
import { getZoneMap } from './api.js';

// Cache for zone map
let zoneMapCache = null;

/**
 * Render the fridge grid.
 */
export function renderFridge() {
  const grid = document.getElementById('fridge-grid');
  if (!grid || !state.layout) return;

  grid.innerHTML = '';

  state.layout.fridge.rows.forEach((row) => {
    const rowEl = document.createElement('div');
    rowEl.className = 'fridge-row';

    row.slots.forEach(slot => {
      rowEl.appendChild(createSlotElement(slot));
    });

    grid.appendChild(rowEl);
  });

  setupInteractions();
}

/**
 * Render the cellar grid.
 */
export async function renderCellar() {
  const grid = document.getElementById('cellar-grid');
  if (!grid || !state.layout) return;

  // Fetch zone map for row labels
  try {
    zoneMapCache = await getZoneMap();
  } catch (_err) {
    zoneMapCache = {};
  }

  grid.innerHTML = '';

  state.layout.cellar.rows.forEach((row) => {
    const rowEl = document.createElement('div');
    rowEl.className = 'cellar-row';

    const rowId = `R${row.row}`;
    const zoneInfo = zoneMapCache[rowId];

    const label = document.createElement('div');
    label.className = 'row-label';
    if (zoneInfo) {
      label.classList.add('zone-active');
      label.dataset.zoneId = zoneInfo.zoneId;
      label.innerHTML = `
        <span class="zone-name">${zoneInfo.displayName}</span>
        <span class="row-id">${rowId}</span>
      `;
      label.title = `${zoneInfo.displayName} (${zoneInfo.wineCount} bottles)`;
    } else {
      label.textContent = rowId;
    }
    rowEl.appendChild(label);

    row.slots.forEach(slot => {
      rowEl.appendChild(createSlotElement(slot));
    });

    grid.appendChild(rowEl);
  });

  setupInteractions();
}

/**
 * Setup click handlers and drag-drop after rendering.
 */
function setupInteractions() {
  // Setup drag and drop
  setupDragAndDrop();

  // Setup click handlers
  document.querySelectorAll('.slot').forEach(slot => {
    slot.addEventListener('click', () => handleSlotClick(slot));
  });
}

/**
 * Get drink window CSS class based on current year.
 * @param {Object} slot - Slot data with drink_from, drink_peak, drink_until
 * @returns {string|null} CSS class name or null
 */
function getDrinkWindowClass(slot) {
  if (!slot.drink_until && !slot.drink_peak && !slot.drink_from) {
    return null;
  }

  const currentYear = new Date().getFullYear();

  if (slot.drink_until && currentYear > slot.drink_until) return 'past-peak';
  if (slot.drink_peak && currentYear >= slot.drink_peak) return 'at-peak';
  if (slot.drink_from && currentYear >= slot.drink_from) return 'ready';
  if (slot.drink_from && currentYear < slot.drink_from) return 'too-young';

  return null;
}

/**
 * Create a slot DOM element.
 * @param {Object} slot - Slot data
 * @returns {HTMLElement}
 */
export function createSlotElement(slot) {
  const el = document.createElement('div');
  el.className = 'slot';
  el.dataset.location = slot.location_code;
  el.dataset.slotId = slot.slot_id;

  if (slot.wine_id) {
    el.classList.add(slot.colour || 'white');
    el.dataset.wineId = slot.wine_id;

    if (slot.reduce_priority) {
      el.classList.add(`priority-${Math.min(slot.reduce_priority, 3)}`);
    }

    const drinkClass = getDrinkWindowClass(slot);
    if (drinkClass) {
      el.classList.add(drinkClass);
    }

    const shortName = shortenWineName(slot.wine_name);

    el.innerHTML = `
      <div class="slot-name">${shortName}</div>
      <div class="slot-vintage">${slot.vintage || 'NV'}</div>
      <div class="slot-loc">${slot.location_code}</div>
    `;
  } else {
    el.classList.add('empty');
    el.innerHTML = `<div class="slot-loc">${slot.location_code}</div>`;
  }

  return el;
}
