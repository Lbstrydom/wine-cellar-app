/**
 * @fileoverview Layout diff grid rendering for the unified cellar layout system.
 * Renders a visual comparison of current vs. proposed bottle placement,
 * with colour-coded states (stay, move-in, move-out, swap, empty, unplaceable).
 *
 * Rendering only — no controls or drag-drop (SRP).
 * @module cellarAnalysis/layoutDiffGrid
 */

import { shortenWineName, escapeHtml } from '../utils.js';
import { fetchLayout } from '../api.js';
import { state } from '../app.js';

/**
 * Move type constants used for visual encoding.
 * @enum {string}
 */
export const DiffType = {
  STAY:        'stay',
  MOVE_IN:     'move-in',
  MOVE_OUT:    'move-out',
  SWAP:        'swap',
  EMPTY:       'empty',
  UNPLACEABLE: 'unplaceable'
};

/**
 * CSS class mapping for diff types.
 * @type {Object<string, string>}
 */
const DIFF_CSS = {
  [DiffType.STAY]:        'diff-stay',
  [DiffType.MOVE_IN]:     'diff-move-in',
  [DiffType.MOVE_OUT]:    'diff-move-out',
  [DiffType.SWAP]:        'diff-swap',
  [DiffType.EMPTY]:       'diff-empty',
  [DiffType.UNPLACEABLE]: 'diff-unplaceable'
};

/**
 * Icon mapping for diff types (accessible labels).
 * @type {Object<string, string>}
 */
const DIFF_ICON = {
  [DiffType.STAY]:        '\u2713',  // ✓
  [DiffType.MOVE_IN]:     '\u2192',  // →
  [DiffType.MOVE_OUT]:    '\u2190',  // ←
  [DiffType.SWAP]:        '\u21C4',  // ↔
  [DiffType.EMPTY]:       '\u2014',  // —
  [DiffType.UNPLACEABLE]: '\u26A0'   // ⚠
};

/**
 * Classify a slot's diff state.
 * @param {string} slotId - Slot identifier (e.g. 'R3C5')
 * @param {Object} currentLayout - Map of slotId → wineId
 * @param {Object} targetLayout - Map of slotId → { wineId, wineName, zoneId, colour }
 * @param {Set<string>} swapSlots - Set of slotIds involved in swaps
 * @returns {{ diffType: string, currentWineId: number|null, targetWine: Object|null }}
 */
export function classifySlot(slotId, currentLayout, targetLayout, swapSlots) {
  const currentWineId = currentLayout[slotId] ?? null;
  const targetWine = targetLayout[slotId] ?? null;
  const targetWineId = targetWine?.wineId ?? null;

  // Both empty → empty
  if (!currentWineId && !targetWineId) {
    return { diffType: DiffType.EMPTY, currentWineId, targetWine };
  }

  // Same wine stays
  if (currentWineId && targetWineId && currentWineId === targetWineId) {
    return { diffType: DiffType.STAY, currentWineId, targetWine };
  }

  // Swap: both current and target are different wines, and this slot is in swap set
  if (currentWineId && targetWineId && swapSlots.has(slotId)) {
    return { diffType: DiffType.SWAP, currentWineId, targetWine };
  }

  // Move in: slot was empty (or different wine), now has a wine in target
  if (targetWineId && (!currentWineId || currentWineId !== targetWineId)) {
    return { diffType: DiffType.MOVE_IN, currentWineId, targetWine };
  }

  // Move out: slot had a wine, target is empty
  if (currentWineId && !targetWineId) {
    return { diffType: DiffType.MOVE_OUT, currentWineId, targetWine };
  }

  return { diffType: DiffType.EMPTY, currentWineId, targetWine };
}

/**
 * Build a set of swap slot IDs from the sort plan.
 * @param {Array} sortPlan - Array of move objects
 * @returns {Set<string>}
 */
export function buildSwapSlotSet(sortPlan) {
  const swapSlots = new Set();
  if (!Array.isArray(sortPlan)) return swapSlots;

  for (const move of sortPlan) {
    if (move.moveType === 'swap') {
      swapSlots.add(move.from);
      swapSlots.add(move.to);
    }
  }
  return swapSlots;
}

/**
 * Build a wine name lookup from current layout data.
 * Uses the main app's layout state (slot → wine_name mapping).
 * @returns {Object<number, { wineName: string, colour: string }>}
 */
function buildCurrentWineNames() {
  const lookup = {};
  const layout = state.layout;
  if (!layout) return lookup;

  const areas = layout.areas || [];
  for (const area of areas) {
    if (area.storage_type === 'wine_fridge') continue;
    for (const row of (area.rows || [])) {
      for (const slot of (row.slots || [])) {
        if (slot.wine_id) {
          lookup[slot.wine_id] = {
            wineName: slot.wine_name || `Wine #${slot.wine_id}`,
            colour: slot.colour || ''
          };
        }
      }
    }
  }

  // Legacy format fallback
  if (layout.cellar?.rows) {
    for (const row of layout.cellar.rows) {
      for (const slot of (row.slots || [])) {
        if (slot.wine_id && !lookup[slot.wine_id]) {
          lookup[slot.wine_id] = {
            wineName: slot.wine_name || `Wine #${slot.wine_id}`,
            colour: slot.colour || ''
          };
        }
      }
    }
  }

  return lookup;
}

/**
 * Get cellar rows from layout for grid structure.
 * @param {Object} layout - App layout object
 * @returns {Array|null} Array of row objects
 */
function getCellarRowsFromLayout(layout) {
  if (!layout) return null;
  if (layout.areas) {
    const cellarArea = layout.areas.find(a =>
      a.storage_type === 'cellar' || a.name === 'Main Cellar'
    );
    return cellarArea?.rows || null;
  }
  return layout.cellar?.rows || null;
}

/**
 * Compute diff stats from classified slots.
 * @param {Array<{ diffType: string }>} classifiedSlots
 * @returns {{ stay: number, moveIn: number, moveOut: number, swap: number, empty: number, unplaceable: number }}
 */
export function computeDiffStats(classifiedSlots) {
  const stats = { stay: 0, moveIn: 0, moveOut: 0, swap: 0, empty: 0, unplaceable: 0 };
  for (const { diffType } of classifiedSlots) {
    switch (diffType) {
      case DiffType.STAY: stats.stay++; break;
      case DiffType.MOVE_IN: stats.moveIn++; break;
      case DiffType.MOVE_OUT: stats.moveOut++; break;
      case DiffType.SWAP: stats.swap++; break;
      case DiffType.UNPLACEABLE: stats.unplaceable++; break;
      default: stats.empty++; break;
    }
  }
  // Swaps are counted per-slot but represent pairs, so divide by 2 for display
  stats.swapPairs = Math.floor(stats.swap / 2);
  return stats;
}

/**
 * Build a lookup from sortPlan: slotId → { from, to, moveType, wineName }.
 * This lets us annotate each grid slot with its source/destination.
 * @param {Array} sortPlan - Array of { wineId, wineName, from, to, moveType }
 * @returns {Map<string, {from: string, to: string, moveType: string, wineName: string}>}
 */
export function buildSlotMoveMap(sortPlan) {
  const map = new Map();
  if (!Array.isArray(sortPlan)) return map;

  for (const move of sortPlan) {
    // Move destination (slot receiving a bottle)
    map.set(move.to, {
      from: move.from,
      to: move.to,
      moveType: move.moveType || 'direct',
      wineName: move.wineName || ''
    });
  }
  return map;
}

/**
 * Create a single diff slot DOM element.
 * @param {string} slotId
 * @param {string} diffType
 * @param {number|null} currentWineId
 * @param {Object|null} targetWine - { wineId, wineName, zoneId, colour }
 * @param {Object} wineNames - Lookup of wineId → { wineName, colour }
 * @param {Map} [slotMoveMap] - Optional move lookup from buildSlotMoveMap
 * @returns {HTMLElement}
 */
function createDiffSlotElement(slotId, diffType, currentWineId, targetWine, wineNames, slotMoveMap) {
  const el = document.createElement('div');
  el.className = `diff-slot ${DIFF_CSS[diffType] || 'diff-empty'}`;
  el.dataset.location = slotId;
  el.dataset.diffType = diffType;

  if (targetWine?.wineId) {
    el.dataset.wineId = targetWine.wineId;
  } else if (currentWineId) {
    el.dataset.wineId = currentWineId;
  }

  // Determine wine info for display
  const displayWine = getDisplayWine(diffType, currentWineId, targetWine, wineNames);

  // Build move annotation ("from R3C1" / "↔ R5C2")
  const moveAnnotation = buildMoveAnnotation(slotId, diffType, slotMoveMap);

  if (displayWine) {
    // Add colour class for visual consistency with main grid
    const colour = displayWine.colour || '';
    if (colour) el.classList.add(colour.toLowerCase());

    const shortName = shortenWineName(displayWine.wineName);
    const icon = DIFF_ICON[diffType] || '';

    el.innerHTML = `
      <div class="diff-slot-icon" aria-label="${diffType}">${icon}</div>
      <div class="diff-slot-name">${escapeHtml(shortName)}</div>
      ${moveAnnotation ? `<div class="diff-slot-annotation">${escapeHtml(moveAnnotation)}</div>` : ''}
      <div class="diff-slot-loc">${escapeHtml(slotId)}</div>
    `;

    // Tooltip with full details
    el.title = buildSlotTooltip(diffType, currentWineId, targetWine, wineNames);
  } else {
    el.innerHTML = `
      <div class="diff-slot-loc">${escapeHtml(slotId)}</div>
    `;
  }

  return el;
}

/**
 * Build a short annotation string for a diff slot showing where the bottle moves from/to.
 * @param {string} slotId - Current slot ID
 * @param {string} diffType - Diff classification
 * @param {Map} [slotMoveMap] - Move lookup
 * @returns {string|null}
 */
function buildMoveAnnotation(slotId, diffType, slotMoveMap) {
  if (!slotMoveMap || slotMoveMap.size === 0) return null;

  const moveInfo = slotMoveMap.get(slotId);

  if (diffType === DiffType.MOVE_IN && moveInfo) {
    return `\u2190 ${moveInfo.from}`;  // ← R3C1 (arrives from)
  }
  if (diffType === DiffType.SWAP && moveInfo) {
    return `\u21C4 ${moveInfo.from}`;  // ⇄ R5C2 (swaps with)
  }
  return null;
}

/**
 * Get the wine to display in a diff slot.
 * For 'stay' and 'move-in': show target wine.
 * For 'move-out': show current wine (leaving).
 * For 'swap': show target wine (arriving).
 * @param {string} diffType
 * @param {number|null} currentWineId
 * @param {Object|null} targetWine
 * @param {Object} wineNames
 * @returns {{ wineName: string, colour: string }|null}
 */
function getDisplayWine(diffType, currentWineId, targetWine, wineNames) {
  if (diffType === DiffType.EMPTY) return null;

  if (diffType === DiffType.MOVE_OUT) {
    if (currentWineId && wineNames[currentWineId]) {
      return wineNames[currentWineId];
    }
    return currentWineId ? { wineName: `Wine #${currentWineId}`, colour: '' } : null;
  }

  // For stay, move-in, swap, unplaceable: show target wine
  if (targetWine?.wineName) {
    return { wineName: targetWine.wineName, colour: targetWine.colour || '' };
  }
  if (targetWine?.wineId && wineNames[targetWine.wineId]) {
    return wineNames[targetWine.wineId];
  }
  if (currentWineId && wineNames[currentWineId]) {
    return wineNames[currentWineId];
  }
  return null;
}

/**
 * Build tooltip text for a diff slot.
 * @param {string} diffType
 * @param {number|null} currentWineId
 * @param {Object|null} targetWine
 * @param {Object} wineNames
 * @returns {string}
 */
function buildSlotTooltip(diffType, currentWineId, targetWine, wineNames) {
  const currentName = currentWineId ? (wineNames[currentWineId]?.wineName || `Wine #${currentWineId}`) : 'Empty';
  const targetName = targetWine?.wineName || (targetWine?.wineId ? `Wine #${targetWine.wineId}` : 'Empty');

  switch (diffType) {
    case DiffType.STAY:
      return `${targetName} — stays in place`;
    case DiffType.MOVE_IN:
      return `${targetName} — moves here`;
    case DiffType.MOVE_OUT:
      return `${currentName} — moves away`;
    case DiffType.SWAP:
      return `${currentName} ↔ ${targetName} — swap`;
    case DiffType.UNPLACEABLE:
      return `${currentName} — no valid target`;
    default:
      return 'Empty slot';
  }
}

/**
 * Render the full diff grid.
 * @param {string} containerId - DOM container ID
 * @param {Object} currentLayout - Map of slotId → wineId (from API)
 * @param {Object} targetLayout - Map of slotId → { wineId, wineName, zoneId, colour } (from API)
 * @param {Array} sortPlan - Array of move objects from computeSortPlan
 * @returns {{ stats: Object, classifiedSlots: Array }|null}
 */
export function renderDiffGrid(containerId, currentLayout, targetLayout, sortPlan) {
  const container = document.getElementById(containerId);
  if (!container) return null;

  container.innerHTML = '';

  // Get grid structure from app's current layout
  const cellarRows = getCellarRowsFromLayout(state.layout);
  if (!cellarRows || cellarRows.length === 0) {
    container.innerHTML = '<div class="diff-no-data">No cellar layout available.</div>';
    return null;
  }

  const swapSlots = buildSwapSlotSet(sortPlan);
  const slotMoveMap = buildSlotMoveMap(sortPlan);
  const wineNames = buildCurrentWineNames();
  const classifiedSlots = [];

  // Column headers
  const maxCols = Math.max(...cellarRows.map(r => (r.slots || []).length));
  if (maxCols > 0) {
    const headerRow = document.createElement('div');
    headerRow.className = 'diff-row diff-col-headers';

    const spacer = document.createElement('div');
    spacer.className = 'diff-row-label';
    headerRow.appendChild(spacer);

    for (let c = 1; c <= maxCols; c++) {
      const colHeader = document.createElement('div');
      colHeader.className = 'diff-col-header';
      colHeader.textContent = `C${c}`;
      headerRow.appendChild(colHeader);
    }
    container.appendChild(headerRow);
  }

  // Render grid rows
  for (const row of cellarRows) {
    const rowNum = row.row ?? row.row_num;
    const rowEl = document.createElement('div');
    rowEl.className = 'diff-row';
    rowEl.dataset.row = rowNum;

    // Row label
    const label = document.createElement('div');
    label.className = 'diff-row-label';
    label.textContent = `R${rowNum}`;
    rowEl.appendChild(label);

    const slots = row.slots || [];
    for (const slot of slots) {
      const slotId = slot.location_code;
      const { diffType, currentWineId, targetWine } = classifySlot(
        slotId, currentLayout, targetLayout, swapSlots
      );

      classifiedSlots.push({ slotId, diffType, currentWineId, targetWine });
      const slotEl = createDiffSlotElement(slotId, diffType, currentWineId, targetWine, wineNames, slotMoveMap);
      rowEl.appendChild(slotEl);
    }

    container.appendChild(rowEl);
  }

  const stats = computeDiffStats(classifiedSlots);
  return { stats, classifiedSlots };
}

/**
 * Update a single diff slot in-place (for drag-drop changes).
 * @param {string} slotId
 * @param {string} diffType
 * @param {number|null} currentWineId
 * @param {Object|null} targetWine
 * @param {Object} wineNames
 */
export function updateDiffSlot(slotId, diffType, currentWineId, targetWine, wineNames) {
  const el = document.querySelector(`.diff-slot[data-location="${slotId}"]`);
  if (!el) return;

  // Replace with fresh element content
  const fresh = createDiffSlotElement(slotId, diffType, currentWineId, targetWine, wineNames);

  // Transfer attributes and content
  el.className = fresh.className;
  el.innerHTML = fresh.innerHTML;
  el.title = fresh.title;

  // Update data attributes
  for (const key of Object.keys(fresh.dataset)) {
    el.dataset[key] = fresh.dataset[key];
  }
}
