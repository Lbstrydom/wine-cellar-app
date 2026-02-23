/**
 * @fileoverview Drag-and-drop editing for the proposed layout diff grid.
 * Allows users to manually adjust bottle placement before committing.
 *
 * Separated from grid and controls (SRP).
 * @module cellarAnalysis/layoutDiffDragDrop
 */

/**
 * @typedef {Object} DragDropState
 * @property {boolean} enabled - Whether drag-drop is active
 * @property {HTMLElement|null} draggedSlot - Currently dragged slot element
 * @property {string|null} draggedLocation - Location code of dragged slot
 * @property {Array<{from: string, to: string, previousOccupant: number|null}>} undoStack
 */

/** @type {DragDropState} */
const ddState = {
  enabled: false,
  draggedSlot: null,
  draggedLocation: null,
  undoStack: []
};

/** Long-press duration for mobile (matching existing dragdrop.js pattern) */
const LONG_PRESS_MS = 500;

/** Touch state for long-press detection */
let touchTimer = null;
let touchStartX = 0;
let touchStartY = 0;

/**
 * Callback invoked when a slot swap occurs.
 * @callback OnSlotChanged
 * @param {string} fromSlotId - Source slot ID
 * @param {string} toSlotId - Target slot ID
 */

/** @type {OnSlotChanged|null} */
let _onSlotChanged = null;

/** @type {HTMLElement|null} */
let _gridContainer = null;

/**
 * Enable drag-drop editing on the proposed layout diff grid.
 * @param {{ onSlotChanged: OnSlotChanged, gridContainerEl: HTMLElement }} options
 */
export function enableProposedLayoutEditing({ onSlotChanged, gridContainerEl }) {
  if (!gridContainerEl) return;

  _onSlotChanged = onSlotChanged;
  _gridContainer = gridContainerEl;
  ddState.enabled = true;
  ddState.undoStack = [];

  // Add editing affordances
  gridContainerEl.classList.add('diff-editing');

  // Wire mouse drag events
  gridContainerEl.addEventListener('mousedown', handleMouseDown);
  gridContainerEl.addEventListener('dragstart', handleDragStart);
  gridContainerEl.addEventListener('dragover', handleDragOver);
  gridContainerEl.addEventListener('drop', handleDrop);
  gridContainerEl.addEventListener('dragend', handleDragEnd);

  // Wire touch events for mobile (long-press to drag)
  gridContainerEl.addEventListener('touchstart', handleTouchStart, { passive: false });
  gridContainerEl.addEventListener('touchmove', handleTouchMove, { passive: false });
  gridContainerEl.addEventListener('touchend', handleTouchEnd);
}

/**
 * Disable drag-drop editing (during execution or when closing diff view).
 */
export function disableProposedLayoutEditing() {
  if (_gridContainer) {
    _gridContainer.classList.remove('diff-editing');
    _gridContainer.removeEventListener('mousedown', handleMouseDown);
    _gridContainer.removeEventListener('dragstart', handleDragStart);
    _gridContainer.removeEventListener('dragover', handleDragOver);
    _gridContainer.removeEventListener('drop', handleDrop);
    _gridContainer.removeEventListener('dragend', handleDragEnd);
    _gridContainer.removeEventListener('touchstart', handleTouchStart);
    _gridContainer.removeEventListener('touchmove', handleTouchMove);
    _gridContainer.removeEventListener('touchend', handleTouchEnd);
  }

  ddState.enabled = false;
  ddState.draggedSlot = null;
  ddState.draggedLocation = null;
  _onSlotChanged = null;
  _gridContainer = null;
  clearTouchTimer();
}

/**
 * Get the undo stack (for UI — "Undo Last" / "Reset to Suggested").
 * @returns {Array}
 */
export function getUndoStack() {
  return ddState.undoStack;
}

/**
 * Pop the last entry from the undo stack.
 * @returns {{ from: string, to: string, previousOccupant: number|null }|undefined}
 */
export function popUndo() {
  return ddState.undoStack.pop();
}

/**
 * Clear the undo stack (on "Reset to Suggested").
 */
export function clearUndoStack() {
  ddState.undoStack = [];
}

/**
 * Check if there are user overrides.
 * @returns {boolean}
 */
export function hasOverrides() {
  return ddState.undoStack.length > 0;
}

// ───────────────────────────────────────────────────
// Mouse / desktop drag handlers
// ───────────────────────────────────────────────────

function handleMouseDown(e) {
  const slot = e.target.closest('.diff-slot');
  if (!slot || slot.classList.contains('diff-empty')) return;

  // Only occupied slots are draggable
  slot.draggable = true;
}

function handleDragStart(e) {
  const slot = e.target.closest('.diff-slot');
  if (!slot) return;

  ddState.draggedSlot = slot;
  ddState.draggedLocation = slot.dataset.location;
  slot.classList.add('diff-dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', slot.dataset.location);
}

function handleDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';

  const slot = e.target.closest('.diff-slot');
  if (!slot || slot === ddState.draggedSlot) return;

  // Highlight valid drop target
  clearDropHighlights();
  slot.classList.add('diff-drop-target');
}

function handleDrop(e) {
  e.preventDefault();
  clearDropHighlights();

  const targetSlot = e.target.closest('.diff-slot');
  if (!targetSlot || !ddState.draggedLocation) return;

  const fromSlotId = ddState.draggedLocation;
  const toSlotId = targetSlot.dataset.location;

  if (fromSlotId === toSlotId) return;

  // Record undo entry
  const previousOccupant = targetSlot.dataset.wineId
    ? parseInt(targetSlot.dataset.wineId, 10)
    : null;
  ddState.undoStack.push({ from: fromSlotId, to: toSlotId, previousOccupant });

  // Notify parent to recompute layout
  if (_onSlotChanged) {
    _onSlotChanged(fromSlotId, toSlotId);
  }
}

function handleDragEnd() {
  if (ddState.draggedSlot) {
    ddState.draggedSlot.classList.remove('diff-dragging');
    ddState.draggedSlot.draggable = false;
  }
  ddState.draggedSlot = null;
  ddState.draggedLocation = null;
  clearDropHighlights();
}

// ───────────────────────────────────────────────────
// Touch / mobile drag handlers (long-press)
// ───────────────────────────────────────────────────

function handleTouchStart(e) {
  const slot = e.target.closest('.diff-slot');
  if (!slot || slot.classList.contains('diff-empty')) return;

  touchStartX = e.touches[0].clientX;
  touchStartY = e.touches[0].clientY;

  touchTimer = setTimeout(() => {
    // Long press activated
    ddState.draggedSlot = slot;
    ddState.draggedLocation = slot.dataset.location;
    slot.classList.add('diff-dragging');

    // Haptic feedback if available
    if (navigator.vibrate) navigator.vibrate(50);
  }, LONG_PRESS_MS);
}

function handleTouchMove(e) {
  // If moved beyond threshold before long-press, cancel
  if (touchTimer) {
    const dx = e.touches[0].clientX - touchStartX;
    const dy = e.touches[0].clientY - touchStartY;
    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
      clearTouchTimer();
    }
  }

  if (!ddState.draggedSlot) return;
  e.preventDefault();

  // Highlight slot under touch point
  clearDropHighlights();
  const target = document.elementFromPoint(e.touches[0].clientX, e.touches[0].clientY);
  const targetSlot = target?.closest('.diff-slot');
  if (targetSlot && targetSlot !== ddState.draggedSlot) {
    targetSlot.classList.add('diff-drop-target');
  }
}

function handleTouchEnd(e) {
  clearTouchTimer();

  if (!ddState.draggedSlot) return;

  // Find slot under final touch point
  const touch = e.changedTouches[0];
  const target = document.elementFromPoint(touch.clientX, touch.clientY);
  const targetSlot = target?.closest('.diff-slot');

  if (targetSlot && targetSlot !== ddState.draggedSlot) {
    const fromSlotId = ddState.draggedLocation;
    const toSlotId = targetSlot.dataset.location;

    if (fromSlotId !== toSlotId) {
      const previousOccupant = targetSlot.dataset.wineId
        ? parseInt(targetSlot.dataset.wineId, 10)
        : null;
      ddState.undoStack.push({ from: fromSlotId, to: toSlotId, previousOccupant });

      if (_onSlotChanged) {
        _onSlotChanged(fromSlotId, toSlotId);
      }
    }
  }

  // Cleanup
  if (ddState.draggedSlot) {
    ddState.draggedSlot.classList.remove('diff-dragging');
  }
  ddState.draggedSlot = null;
  ddState.draggedLocation = null;
  clearDropHighlights();
}

function clearTouchTimer() {
  if (touchTimer) {
    clearTimeout(touchTimer);
    touchTimer = null;
  }
}

function clearDropHighlights() {
  if (_gridContainer) {
    _gridContainer.querySelectorAll('.diff-drop-target').forEach(el => {
      el.classList.remove('diff-drop-target');
    });
  }
}
