/**
 * @fileoverview Cellar and fridge grid rendering.
 * @module grid
 */

import { shortenWineName, isAreasLayout } from './utils.js';
import { state } from './app.js';
import { setupDragAndDrop, cleanupDragAndDrop } from './dragdrop.js';
import { handleSlotClick } from './bottles.js';
import { getZoneMap } from './api.js';
import { addTrackedListener, cleanupNamespace } from './eventManager.js';
import { renderGrapeIndicator } from './grapeIndicator.js';

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
 * Handles both legacy format ({ fridge }) and new format ({ areas }).
 */
export function renderFridge() {
  const grid = document.getElementById('fridge-grid');
  if (!grid || !state.layout) return;

  grid.innerHTML = '';

  // Get fridge rows from layout (handles both formats)
  const fridgeRows = getFridgeRows(state.layout);
  if (!fridgeRows) return;

  fridgeRows.forEach((row) => {
    const rowEl = document.createElement('div');
    rowEl.className = 'fridge-row';

    const slots = row.slots || [];
    slots.forEach(slot => {
      rowEl.appendChild(createSlotElement(slot));
    });

    grid.appendChild(rowEl);
  });

  setupInteractions();
  if (typeof window.__moveGuideAnnotate === 'function') {
    window.__moveGuideAnnotate();
  }
}

/**
 * Get fridge rows from layout, handling both formats.
 * @param {Object} layout - Layout object
 * @returns {Array|null} Array of row objects with slots
 */
function getFridgeRows(layout) {
  if (!layout) return null;

  // New format: find wine_fridge area
  if (isAreasLayout(layout)) {
    const fridgeArea = layout.areas.find(a =>
      a.storage_type === 'wine_fridge' || a.name === 'Wine Fridge'
    );
    return fridgeArea?.rows || null;
  }

  // Legacy format
  return layout.fridge?.rows || null;
}

/**
 * Render the cellar grid.
 * Populates the cellar-grid element with slot elements and zone labels.
 * Handles both legacy format ({ cellar }) and new format ({ areas }).
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

  // Get cellar rows from layout (handles both formats)
  const cellarRows = getCellarRows(state.layout);
  if (!cellarRows || cellarRows.length === 0) return;

  // Column headers — spreadsheet-style (C1, C2, ...) so row/col position
  // replaces the per-cell location code as the primary location signifier.
  const maxCols = Math.max(...cellarRows.map(r => (r.slots || []).length));
  if (maxCols > 0) {
    const headerRow = document.createElement('div');
    headerRow.className = 'cellar-row col-headers';

    const spacer = document.createElement('div');
    spacer.className = 'row-label';
    headerRow.appendChild(spacer);

    for (let c = 1; c <= maxCols; c++) {
      const colHeader = document.createElement('div');
      colHeader.className = 'col-header';
      colHeader.textContent = `C${c}`;
      headerRow.appendChild(colHeader);
    }
    grid.appendChild(headerRow);
  }

  // Priority badge legend — explain N/S/H codes once, above the grid
  const hasPriority = cellarRows.some(r =>
    (r.slots || []).some(s => s.wine_id && s.reduce_priority)
  );
  if (hasPriority) {
    const legend = document.createElement('div');
    legend.className = 'grid-legend';
    legend.innerHTML =
      '<span class="legend-item"><span class="legend-badge p1">N</span>Now</span>' +
      '<span class="legend-item"><span class="legend-badge p2">S</span>Soon</span>' +
      '<span class="legend-item"><span class="legend-badge p3">H</span>Hold</span>';
    grid.appendChild(legend);
  }

  // Row height will be measured from rendered rows after grid is built
  let rowHeight = 55; // fallback

  // Build zone spans - group consecutive rows with same zone
  const zoneSpans = [];
  let currentSpan = null;

  cellarRows.forEach((row, index) => {
    // Handle both formats: row.row (legacy) or row.row_num (new)
    const rowNum = row.row ?? row.row_num;
    const rowId = `R${rowNum}`;
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
  cellarRows.forEach((row) => {
    const rowEl = document.createElement('div');
    rowEl.className = 'cellar-row';

    // Handle both formats: row.row (legacy) or row.row_num (new)
    const rowNum = row.row ?? row.row_num;
    const rowId = `R${rowNum}`;

    // Add row label inside the row (with inline zone name when available)
    const label = document.createElement('div');
    label.className = 'row-label';
    const zoneInfo = zoneMapCache[rowId];
    if (zoneInfo && hasZoneConfig) {
      label.appendChild(document.createTextNode(rowId));
      const zoneName = document.createElement('span');
      zoneName.className = 'zone-name';
      zoneName.textContent = zoneInfo.displayName;
      label.appendChild(zoneName);
    } else {
      label.textContent = rowId;
    }
    rowEl.appendChild(label);

    const slots = row.slots || [];
    slots.forEach(slot => {
      rowEl.appendChild(createSlotElement(slot));
    });

    grid.appendChild(rowEl);
  });

  // Measure actual row height from rendered rows
  const firstRow = grid.querySelector('.cellar-row:not(.col-headers):not(.grid-legend)');
  if (firstRow) {
    void firstRow.offsetWidth; // force reflow before measuring height
    rowHeight = firstRow.offsetHeight || 55;
  }

  // Render zone labels spanning multiple rows
  if (zoneLabelsEl) {
    // Compute top offset from column headers + legend
    const colHeaders = grid.querySelector('.col-headers');
    const legendEl = grid.querySelector('.grid-legend');
    const headerOffset = (colHeaders?.offsetHeight || 0) + (legendEl?.offsetHeight || 0);
    if (headerOffset > 0) {
      zoneLabelsEl.style.paddingTop = `${headerOffset + 4}px`;
    }

    zoneSpans.forEach(span => {
      const zoneLabel = document.createElement('div');
      zoneLabel.className = 'zone-label';
      const GRID_GAP = 3; // must match .cellar-grid { gap: 3px }
      const spanHeight = (rowHeight * span.rowCount) + (GRID_GAP * (span.rowCount - 1));
      zoneLabel.style.height = `${spanHeight}px`;

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
  if (typeof window.__moveGuideAnnotate === 'function') {
    window.__moveGuideAnnotate();
  }

  // Grape health indicator — render from cached stats (non-blocking)
  if (state.stats) {
    renderGrapeIndicator(state.stats);
  }
}

/**
 * Get cellar rows from layout, handling both formats.
 * @param {Object} layout - Layout object
 * @returns {Array|null} Array of row objects with slots
 */
function getCellarRows(layout) {
  if (!layout) return null;

  // New format: find cellar area
  if (isAreasLayout(layout)) {
    const cellarArea = layout.areas.find(a =>
      a.storage_type === 'cellar' || a.name === 'Main Cellar'
    );
    return cellarArea?.rows || null;
  }

  // Legacy format
  return layout.cellar?.rows || null;
}

/**
 * Render dynamic storage areas.
 * Expects state.layout.areas = [{ name, storage_type, temp_zone, rows: [{row_num,col_count}], slots? }]
 * If slots are not provided (lite mode), renders empty placeholders.
 * @returns {Promise<void>}
 */
export async function renderStorageAreas() {
  const container = document.getElementById('storage-areas-container');
  if (!container || !state.layout?.areas) return;

  // Fetch zone map for cellar row labels
  try {
    zoneMapCache = await getZoneMap();
  } catch (_err) {
    zoneMapCache = {};
  }
  const hasZoneConfig = Object.keys(zoneMapCache).length > 0;

  container.innerHTML = '';

  // Hide static zone-labels element (only used by legacy renderCellar path)
  // to avoid an empty 110px-wide sidebar from the HTML template.
  const staticZoneLabels = document.getElementById('zone-labels');
  if (staticZoneLabels) staticZoneLabels.style.display = 'none';

  for (const area of state.layout.areas) {
    const isCellar = area.storage_type === 'cellar' || area.name === 'Main Cellar';
    const zoneWrap = document.createElement('div');
    zoneWrap.className = 'zone';

    const header = document.createElement('div');
    header.className = 'zone-header';
    if (isCellar) header.dataset.cellarIndicator = '1';
    const title = document.createElement('span');
    title.className = 'zone-title';
    title.textContent = area.name;
    header.appendChild(title);
    zoneWrap.appendChild(header);

    // For cellar areas with zone config, wrap grid + zone-labels in a flex container
    const gridContainer = document.createElement('div');
    if (isCellar && hasZoneConfig) {
      gridContainer.className = 'cellar-container';
    }

    const zoneLabelsEl = (isCellar && hasZoneConfig)
      ? document.createElement('div')
      : null;
    if (zoneLabelsEl) {
      zoneLabelsEl.className = 'zone-labels';
      gridContainer.appendChild(zoneLabelsEl);
    }

    const grid = document.createElement('div');
    grid.className = 'cellar-grid';

    const areaRows = area.rows || [];

    // Column headers
    const maxCols = Math.max(0, ...areaRows.map(r =>
      Array.isArray(r.slots) ? r.slots.length : (r.col_count || 0)
    ));
    if (maxCols > 0) {
      const headerRow = document.createElement('div');
      headerRow.className = 'cellar-row col-headers';
      const spacer = document.createElement('div');
      spacer.className = 'row-label';
      headerRow.appendChild(spacer);
      for (let c = 1; c <= maxCols; c++) {
        const colHeader = document.createElement('div');
        colHeader.className = 'col-header';
        colHeader.textContent = `C${c}`;
        headerRow.appendChild(colHeader);
      }
      grid.appendChild(headerRow);
    }

    // Priority badge legend
    const hasPriority = areaRows.some(r =>
      (r.slots || []).some(s => s.wine_id && s.reduce_priority)
    );
    if (hasPriority) {
      const legend = document.createElement('div');
      legend.className = 'grid-legend';
      legend.innerHTML =
        '<span class="legend-item"><span class="legend-badge p1">N</span>Now</span>' +
        '<span class="legend-item"><span class="legend-badge p2">S</span>Soon</span>' +
        '<span class="legend-item"><span class="legend-badge p3">H</span>Hold</span>';
      grid.appendChild(legend);
    }

    // Build zone spans for cellar areas (group consecutive rows with same zone)
    const zoneSpans = [];
    if (isCellar && hasZoneConfig) {
      let currentSpan = null;
      areaRows.forEach((row, index) => {
        const rowId = `R${row.row_num}`;
        const zoneInfo = zoneMapCache[rowId];
        const zoneId = zoneInfo?.zoneId || 'not-configured';
        if (currentSpan && currentSpan.zoneId === zoneId) {
          currentSpan.rowCount++;
        } else {
          if (currentSpan) zoneSpans.push(currentSpan);
          currentSpan = { zoneId, zoneInfo, rowCount: 1, startIndex: index };
        }
      });
      if (currentSpan) zoneSpans.push(currentSpan);
    }

    // Build row-to-zone-index map for alternating zone banding
    const rowZoneBandMap = new Map();
    if (isCellar && hasZoneConfig) {
      zoneSpans.forEach((span, spanIndex) => {
        for (let i = 0; i < span.rowCount; i++) {
          rowZoneBandMap.set(span.startIndex + i, spanIndex);
        }
      });
    }

    // Render rows using col_count; use slots if provided
    for (const [rowIndex, row] of areaRows.entries()) {
      const rowEl = document.createElement('div');
      rowEl.className = 'cellar-row';

      // Zone banding — alternating tint between zone groups
      if (rowZoneBandMap.has(rowIndex)) {
        rowEl.classList.add(rowZoneBandMap.get(rowIndex) % 2 === 0 ? 'zone-band-even' : 'zone-band-odd');
      }

      // Row label with inline zone name for cellar areas
      const label = document.createElement('div');
      label.className = 'row-label';
      const rowId = `R${row.row_num}`;
      const zoneInfo = zoneMapCache[rowId];
      if (isCellar && zoneInfo && hasZoneConfig) {
        label.appendChild(document.createTextNode(rowId));
        const zoneName = document.createElement('span');
        zoneName.className = 'zone-name';
        zoneName.textContent = zoneInfo.displayName;
        label.appendChild(zoneName);
      } else {
        label.textContent = rowId;
      }
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

    // Add grid to container (with or without zone-labels flex wrapper)
    if (isCellar && hasZoneConfig) {
      gridContainer.appendChild(grid);
      zoneWrap.appendChild(gridContainer);
    } else {
      zoneWrap.appendChild(grid);
    }

    // Append to DOM first so we can measure row height
    container.appendChild(zoneWrap);

    // Render zone label sidebar for cellar areas
    if (zoneLabelsEl && zoneSpans.length > 0) {
      const GRID_GAP = 3; // must match .cellar-grid { gap: 3px }
      let rowHeight = 55; // fallback
      const firstRow = grid.querySelector('.cellar-row:not(.col-headers):not(.grid-legend)');
      if (firstRow) {
        // Force synchronous reflow — offsetWidth read flushes pending layout
        // so the subsequent offsetHeight returns the actual rendered height.
        void firstRow.offsetWidth;
        rowHeight = firstRow.offsetHeight || 55;
      }

      // Align with grid rows (offset past col-headers + legend)
      const colHeaders = grid.querySelector('.col-headers');
      const legendEl = grid.querySelector('.grid-legend');
      const headerOffset = (colHeaders?.offsetHeight || 0) + (legendEl?.offsetHeight || 0);
      if (headerOffset > 0) {
        zoneLabelsEl.style.paddingTop = `${headerOffset + 4}px`;
      }

      zoneSpans.forEach(span => {
        const zoneLabel = document.createElement('div');
        zoneLabel.className = 'zone-label';
        const spanHeight = (rowHeight * span.rowCount) + (GRID_GAP * (span.rowCount - 1));
        zoneLabel.style.height = `${spanHeight}px`;

        if (span.zoneInfo && hasZoneConfig) {
          zoneLabel.textContent = span.zoneInfo.displayName;
          zoneLabel.title = `${span.zoneInfo.displayName} (${span.zoneInfo.wineCount || 0} bottles)`;
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
  }

  setupInteractions();
  if (typeof window.__moveGuideAnnotate === 'function') {
    window.__moveGuideAnnotate();
  }

  // Grape health indicator — render from cached stats (non-blocking)
  if (state.stats) {
    renderGrapeIndicator(state.stats);
  }
}

/**
 * Clean up grid event listeners.
 * Must be called before re-rendering.
 */
function cleanupGrid() {
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
      const p = Math.min(slot.reduce_priority, 3);
      el.classList.add(`priority-${p}`);
      el.classList.add('has-urgency');  // Phase 3.5.5: Mark for color noise reduction
    }

    const drinkClass = getDrinkWindowClass(slot);
    if (drinkClass) {
      el.classList.add(drinkClass);
      if (!slot.reduce_priority) {
        el.classList.add('has-window');  // Phase 3.5.5: Mark drinking window (only if no urgency)
      }
    }

    // Add open bottle styling
    if (slot.is_open) {
      el.classList.add('is-open');
      el.dataset.openedAt = slot.opened_at;
    }

    // Full wine name tooltip — wine name + vintage + urgency label for hover
    const priorityLabels = { 1: 'Drink now', 2: 'Drink soon', 3: 'Hold — not urgent' };
    const urgencyLabel = slot.reduce_priority
      ? ` — ${priorityLabels[Math.min(slot.reduce_priority, 3)] || ''}`
      : '';
    el.title = `${slot.wine_name || ''}${slot.vintage ? ' ' + slot.vintage : ''}${urgencyLabel}`.trim();

    // Urgency icons — clock for "drink now", hourglass for "drink soon" (accessible: shape + colour)
    const urgencyIconHtml = slot.reduce_priority === 1
      ? '<span class="urgency-icon" aria-label="Drink now">🕐</span>'
      : slot.reduce_priority === 2
        ? '<span class="urgency-icon" aria-label="Drink soon">⏳</span>'
        : '';

    const shortName = shortenWineName(slot.wine_name);
    const openIcon = slot.is_open ? '<span class="open-indicator" title="Open bottle">🍷</span>' : '';

    el.innerHTML = `
      <div class="slot-name">${shortName}${urgencyIconHtml}</div>
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
function getZoomLevel() {
  return zoomState.level;
}
