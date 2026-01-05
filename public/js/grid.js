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
 * Populates the fridge-grid element with slot elements based on current layout.
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
 * Populates the cellar-grid element with slot elements and zone labels.
 * @returns {Promise<void>}
 */
export async function renderCellar() {
  const grid = document.getElementById('cellar-grid');
  const zoneLabelsEl = document.getElementById('zone-labels');
  if (!grid || !state.layout) return;

  // Fetch zone map for row labels
  try {
    zoneMapCache = await getZoneMap();
  } catch (_err) {
    zoneMapCache = {};
  }

  const hasZoneConfig = Object.keys(zoneMapCache).length > 0;

  grid.innerHTML = '';
  if (zoneLabelsEl) zoneLabelsEl.innerHTML = '';

  // Calculate row heights for zone labels alignment
  const rowHeight = 55; // slot height (52px) + gap (3px)

  // Build zone spans - group consecutive rows with same zone
  const zoneSpans = [];
  let currentSpan = null;

  state.layout.cellar.rows.forEach((row, index) => {
    const rowId = `R${row.row}`;
    const zoneInfo = zoneMapCache[rowId];
    const zoneId = zoneInfo?.zoneId || 'not-configured';

    if (currentSpan && currentSpan.zoneId === zoneId) {
      // Extend current span
      currentSpan.rowCount++;
    } else {
      // Start new span
      if (currentSpan) {
        zoneSpans.push(currentSpan);
      }
      currentSpan = {
        zoneId,
        zoneInfo,
        rowCount: 1,
        startIndex: index
      };
    }
  });
  if (currentSpan) {
    zoneSpans.push(currentSpan);
  }

  // Render grid rows
  state.layout.cellar.rows.forEach((row) => {
    const rowEl = document.createElement('div');
    rowEl.className = 'cellar-row';

    const rowId = `R${row.row}`;

    // Add row label inside the row
    const label = document.createElement('div');
    label.className = 'row-label';
    label.textContent = rowId;
    rowEl.appendChild(label);

    row.slots.forEach(slot => {
      rowEl.appendChild(createSlotElement(slot));
    });

    grid.appendChild(rowEl);
  });

  // Render zone labels spanning multiple rows
  if (zoneLabelsEl) {
    zoneSpans.forEach(span => {
      const zoneLabel = document.createElement('div');
      zoneLabel.className = 'zone-label';
      zoneLabel.style.height = `${rowHeight * span.rowCount}px`;

      if (span.zoneInfo && hasZoneConfig) {
        zoneLabel.textContent = span.zoneInfo.displayName;
        zoneLabel.title = `${span.zoneInfo.displayName} (${span.zoneInfo.wineCount || 0} bottles)`;
        // Add health status class if available
        if (span.zoneInfo.status) {
          zoneLabel.classList.add(span.zoneInfo.status);
        }
      } else {
        zoneLabel.textContent = 'Not configured';
        zoneLabel.classList.add('not-configured');
      }

      zoneLabelsEl.appendChild(zoneLabel);
    });
  }

  setupInteractions();
}

/**
 * Setup click handlers and drag-drop after rendering.
 * Attaches event listeners to all slot elements for interaction.
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
