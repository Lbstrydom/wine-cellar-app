/**
 * @fileoverview Cellar and fridge grid rendering.
 * @module grid
 */

import { shortenWineName } from './utils.js';
import { state } from './app.js';
import { setupDragAndDrop, cleanupDragAndDrop } from './dragdrop.js';
import { handleSlotClick } from './bottles.js';
import { getZoneMap } from './api.js';
import { addTrackedListener, cleanupNamespace } from './eventManager.js';

const NAMESPACE = 'grid';

// Cache for zone map
let zoneMapCache = null;

// Zoom state
const zoomState = {
  level: 1,
  minZoom: 0.5,
  maxZoom: 2,
  isPinching: false,
  startDistance: 0,
  startZoom: 1,
  panX: 0,
  panY: 0,
  isPanning: false,
  lastPanX: 0,
  lastPanY: 0
};

// Load saved zoom preference
const savedZoom = localStorage.getItem('cellar-zoom-level');
if (savedZoom) {
  zoomState.level = parseFloat(savedZoom) || 1;
}

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
 * Render dynamic storage areas (experimental).
 * Expects state.layout.areas = [{ name, storage_type, temp_zone, rows: [{row_num,col_count}], slots? }]
 * If slots are not provided (lite mode), renders empty placeholders.
 */
export function renderStorageAreas() {
  const container = document.getElementById('storage-areas-container');
  if (!container || !state.layout?.areas) return;

  container.innerHTML = '';

  for (const area of state.layout.areas) {
    const zoneWrap = document.createElement('div');
    zoneWrap.className = 'zone';

    const header = document.createElement('div');
    header.className = 'zone-header';
    const title = document.createElement('span');
    title.className = 'zone-title';
    title.textContent = area.name;
    header.appendChild(title);
    zoneWrap.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'cellar-grid';

    // Render rows using col_count; use slots if provided
    for (const row of area.rows || []) {
      const rowEl = document.createElement('div');
      rowEl.className = 'cellar-row';

      // Optional row label
      const label = document.createElement('div');
      label.className = 'row-label';
      label.textContent = `R${row.row_num}`;
      rowEl.appendChild(label);

      if (Array.isArray(row.slots)) {
        row.slots.forEach(slot => {
          rowEl.appendChild(createSlotElement(slot));
        });
      } else {
        for (let c = 1; c <= (row.col_count || 0); c++) {
          const placeholder = document.createElement('div');
          placeholder.className = 'slot empty';
          placeholder.dataset.row = row.row_num;
          placeholder.dataset.col = c;
          rowEl.appendChild(placeholder);
        }
      }

      grid.appendChild(rowEl);
    }

    zoneWrap.appendChild(grid);
    container.appendChild(zoneWrap);
  }

  setupInteractions();
}

/**
 * Clean up grid event listeners.
 * Must be called before re-rendering.
 */
export function cleanupGrid() {
  cleanupNamespace(NAMESPACE);
  cleanupDragAndDrop();
}

/**
 * Setup click handlers and drag-drop after rendering.
 * Attaches event listeners to all slot elements for interaction.
 */
function setupInteractions() {
  // Clean up existing grid click handlers
  cleanupNamespace(NAMESPACE);

  // Setup drag and drop (handles its own cleanup)
  setupDragAndDrop();

  // Setup click handlers with tracking
  document.querySelectorAll('.slot').forEach(slot => {
    const handler = () => handleSlotClick(slot);
    addTrackedListener(NAMESPACE, slot, 'click', handler);
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

    // Add open bottle styling
    if (slot.is_open) {
      el.classList.add('is-open');
      el.dataset.openedAt = slot.opened_at;
    }

    const shortName = shortenWineName(slot.wine_name);
    const openIcon = slot.is_open ? '<span class="open-indicator" title="Open bottle">🍷</span>' : '';

    el.innerHTML = `
      <div class="slot-name">${shortName}</div>
      <div class="slot-vintage">${slot.vintage || 'NV'}${openIcon}</div>
      <div class="slot-loc">${slot.location_code}</div>
    `;
  } else {
    el.classList.add('empty');
    el.innerHTML = `<div class="slot-loc">${slot.location_code}</div>`;
  }

  return el;
}

// ============================================================
// Zoom & Pan Functions
// ============================================================

/**
 * Initialize zoom controls for the cellar grid.
 * Sets up pinch-to-zoom, pan gestures, and zoom buttons.
 */
export function initZoomControls() {
  const container = document.getElementById('cellar-container');
  const grid = document.getElementById('cellar-grid');
  const zoomInBtn = document.getElementById('zoom-in-btn');
  const zoomOutBtn = document.getElementById('zoom-out-btn');
  const zoomResetBtn = document.getElementById('zoom-reset-btn');

  if (!container || !grid) return;

  // Apply initial zoom from localStorage
  applyZoom();

  // Setup pinch-to-zoom for touch devices
  container.addEventListener('touchstart', handleZoomTouchStart, { passive: false });
  container.addEventListener('touchmove', handleZoomTouchMove, { passive: false });
  container.addEventListener('touchend', handleZoomTouchEnd, { passive: true });

  // Setup zoom buttons
  if (zoomInBtn) {
    zoomInBtn.addEventListener('click', () => adjustZoom(0.25));
  }
  if (zoomOutBtn) {
    zoomOutBtn.addEventListener('click', () => adjustZoom(-0.25));
  }
  if (zoomResetBtn) {
    zoomResetBtn.addEventListener('click', resetZoom);
  }

  // Mouse wheel zoom (desktop)
  container.addEventListener('wheel', handleWheelZoom, { passive: false });
}

/**
 * Handle touch start for pinch-to-zoom.
 * @param {TouchEvent} e
 */
function handleZoomTouchStart(e) {
  if (e.touches.length === 2) {
    // Pinch gesture started
    e.preventDefault();
    zoomState.isPinching = true;
    zoomState.startDistance = getTouchDistance(e.touches);
    zoomState.startZoom = zoomState.level;
  } else if (e.touches.length === 1 && zoomState.level > 1) {
    // Single touch when zoomed - could be pan
    zoomState.lastPanX = e.touches[0].clientX;
    zoomState.lastPanY = e.touches[0].clientY;
  }
}

/**
 * Handle touch move for pinch-to-zoom and pan.
 * @param {TouchEvent} e
 */
function handleZoomTouchMove(e) {
  if (e.touches.length === 2 && zoomState.isPinching) {
    // Pinch gesture
    e.preventDefault();
    const currentDistance = getTouchDistance(e.touches);
    const scale = currentDistance / zoomState.startDistance;
    const newZoom = Math.min(zoomState.maxZoom, Math.max(zoomState.minZoom, zoomState.startZoom * scale));

    zoomState.level = newZoom;
    applyZoom();
  } else if (e.touches.length === 1 && zoomState.level > 1 && !zoomState.isPinching) {
    // Pan when zoomed in
    const dx = e.touches[0].clientX - zoomState.lastPanX;
    const dy = e.touches[0].clientY - zoomState.lastPanY;

    // Only start panning if movement is significant
    if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
      zoomState.isPanning = true;
      zoomState.panX += dx;
      zoomState.panY += dy;
      zoomState.lastPanX = e.touches[0].clientX;
      zoomState.lastPanY = e.touches[0].clientY;
      applyZoom();

      // Prevent scroll when panning
      e.preventDefault();
    }
  }
}

/**
 * Handle touch end for pinch-to-zoom.
 */
function handleZoomTouchEnd() {
  zoomState.isPinching = false;

  // Small delay before clearing pan state to allow scroll to happen
  setTimeout(() => {
    zoomState.isPanning = false;
  }, 100);

  // Save zoom level
  localStorage.setItem('cellar-zoom-level', zoomState.level.toString());
}

/**
 * Handle mouse wheel zoom.
 * @param {WheelEvent} e
 */
function handleWheelZoom(e) {
  // Only zoom if Ctrl is held (standard convention)
  if (!e.ctrlKey) return;

  e.preventDefault();
  const delta = e.deltaY > 0 ? -0.1 : 0.1;
  adjustZoom(delta);
}

/**
 * Calculate distance between two touch points.
 * @param {TouchList} touches
 * @returns {number}
 */
function getTouchDistance(touches) {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Adjust zoom level by delta.
 * @param {number} delta - Amount to change zoom
 */
function adjustZoom(delta) {
  zoomState.level = Math.min(zoomState.maxZoom, Math.max(zoomState.minZoom, zoomState.level + delta));
  applyZoom();
  localStorage.setItem('cellar-zoom-level', zoomState.level.toString());
}

/**
 * Reset zoom to default.
 */
function resetZoom() {
  zoomState.level = 1;
  zoomState.panX = 0;
  zoomState.panY = 0;
  applyZoom();
  localStorage.setItem('cellar-zoom-level', '1');
}

/**
 * Apply current zoom and pan to the grid.
 */
function applyZoom() {
  const grid = document.getElementById('cellar-grid');
  const zoomDisplay = document.getElementById('zoom-level');

  if (grid) {
    grid.style.transform = `scale(${zoomState.level}) translate(${zoomState.panX / zoomState.level}px, ${zoomState.panY / zoomState.level}px)`;
    grid.style.transformOrigin = 'top left';
  }

  if (zoomDisplay) {
    zoomDisplay.textContent = `${Math.round(zoomState.level * 100)}%`;
  }

  // Update container overflow based on zoom
  const container = document.getElementById('cellar-container');
  if (container) {
    if (zoomState.level > 1) {
      container.classList.add('zoomed');
    } else {
      container.classList.remove('zoomed');
      // Reset pan when at 1x
      zoomState.panX = 0;
      zoomState.panY = 0;
    }
  }
}

/**
 * Get current zoom level.
 * @returns {number}
 */
export function getZoomLevel() {
  return zoomState.level;
}
