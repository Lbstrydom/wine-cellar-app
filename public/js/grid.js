/**
 * @fileoverview Cellar and fridge grid rendering.
 * @module grid
 */

import { shortenWineName } from './utils.js';
import { state } from './app.js';
import { setupDragAndDrop } from './dragdrop.js';
import { handleSlotClick } from './bottles.js';

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
export function renderCellar() {
  const grid = document.getElementById('cellar-grid');
  if (!grid || !state.layout) return;

  grid.innerHTML = '';

  state.layout.cellar.rows.forEach((row) => {
    const rowEl = document.createElement('div');
    rowEl.className = 'cellar-row';

    const label = document.createElement('div');
    label.className = 'row-label';
    label.textContent = `R${row.row}`;
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
