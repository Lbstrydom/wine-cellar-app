/**
 * @fileoverview Drag and drop functionality for bottle movement.
 * @module dragdrop
 */

import { moveBottle, swapBottles } from './api.js';
import { showToast } from './utils.js';
import { refreshData } from './app.js';

let draggedSlot = null;

// Swap mode state
let swapMode = {
  active: false,
  sourceSlot: null,      // Where the dragged bottle came from
  targetSlot: null,      // The occupied slot it was dropped on
  displacedWineName: null // Name of wine being displaced
};

/**
 * Setup drag and drop on all slots.
 */
export function setupDragAndDrop() {
  document.querySelectorAll('.slot').forEach(slot => {
    const hasWine = slot.dataset.wineId;

    if (hasWine) {
      // Filled slots are draggable
      slot.setAttribute('draggable', 'true');
      slot.classList.add('draggable');

      slot.addEventListener('dragstart', handleDragStart);
      slot.addEventListener('dragend', handleDragEnd);
    }

    // All slots can be drop targets
    slot.addEventListener('dragover', handleDragOver);
    slot.addEventListener('dragleave', handleDragLeave);
    slot.addEventListener('drop', handleDrop);

    // Click handler for swap mode
    slot.addEventListener('click', handleSlotClick);
  });
}

/**
 * Handle drag start.
 * @param {DragEvent} e
 */
function handleDragStart(e) {
  // Cancel any active swap mode
  if (swapMode.active) {
    cancelSwapMode();
  }

  draggedSlot = this;
  this.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', this.dataset.location);

  // Highlight valid drop targets (both empty and occupied slots)
  document.querySelectorAll('.slot').forEach(slot => {
    if (slot !== this) {
      slot.classList.add('drag-target');
    }
  });
}

/**
 * Handle drag end.
 */
function handleDragEnd() {
  this.classList.remove('dragging');
  draggedSlot = null;

  // Remove drag indicators (but not swap mode indicators)
  if (!swapMode.active) {
    document.querySelectorAll('.slot').forEach(slot => {
      slot.classList.remove('drag-target', 'drag-over', 'drag-over-swap');
    });
  }
}

/**
 * Handle drag over.
 * @param {DragEvent} e
 */
function handleDragOver(e) {
  e.preventDefault();

  if (!draggedSlot || this === draggedSlot) return;

  const isEmpty = this.classList.contains('empty');

  e.dataTransfer.dropEffect = 'move';

  if (isEmpty) {
    this.classList.add('drag-over');
    this.classList.remove('drag-over-swap');
  } else {
    // Occupied slot - will trigger swap mode
    this.classList.add('drag-over-swap');
    this.classList.remove('drag-over');
  }
}

/**
 * Handle drag leave.
 */
function handleDragLeave() {
  this.classList.remove('drag-over', 'drag-over-swap');
}

/**
 * Handle drop.
 * @param {DragEvent} e
 */
async function handleDrop(e) {
  e.preventDefault();
  this.classList.remove('drag-over', 'drag-over-swap');

  if (!draggedSlot || this === draggedSlot) return;

  const fromLocation = draggedSlot.dataset.location;
  const toLocation = this.dataset.location;
  const isEmpty = this.classList.contains('empty');

  // Clear drag indicators
  document.querySelectorAll('.slot').forEach(slot => {
    slot.classList.remove('drag-target', 'drag-over', 'drag-over-swap');
  });

  if (isEmpty) {
    // Simple move to empty slot
    try {
      await moveBottle(fromLocation, toLocation);
      showToast(`Moved to ${toLocation}`);
      await refreshData();
    } catch (err) {
      showToast('Error: ' + err.message);
    }
  } else {
    // Target is occupied - enter swap mode
    enterSwapMode(fromLocation, toLocation, this);
  }
}

/**
 * Enter swap mode - user needs to select where to put the displaced bottle.
 * @param {string} sourceSlot - Where the dragged bottle came from
 * @param {string} targetSlot - The occupied slot it was dropped on
 * @param {HTMLElement} targetElement - The target slot element
 */
function enterSwapMode(sourceSlot, targetSlot, targetElement) {
  const displacedWineName = targetElement.querySelector('.wine-name')?.textContent ||
    targetElement.dataset.wineName || 'bottle';

  swapMode = {
    active: true,
    sourceSlot,
    targetSlot,
    displacedWineName
  };

  // Visual feedback
  document.body.classList.add('swap-mode-active');

  // Highlight empty slots as valid destinations
  document.querySelectorAll('.slot.empty').forEach(slot => {
    slot.classList.add('swap-destination');
  });

  // Highlight the target slot being swapped
  targetElement.classList.add('swap-target');

  // Show instruction toast
  showToast(`Click an empty slot to place "${displacedWineName}"`, 'info');

  // Add escape key listener
  document.addEventListener('keydown', handleSwapModeKeydown);
}

/**
 * Cancel swap mode.
 */
function cancelSwapMode() {
  swapMode = {
    active: false,
    sourceSlot: null,
    targetSlot: null,
    displacedWineName: null
  };

  document.body.classList.remove('swap-mode-active');

  document.querySelectorAll('.slot').forEach(slot => {
    slot.classList.remove('swap-destination', 'swap-target', 'drag-target');
  });

  document.removeEventListener('keydown', handleSwapModeKeydown);
}

/**
 * Handle keydown during swap mode.
 * @param {KeyboardEvent} e
 */
function handleSwapModeKeydown(e) {
  if (e.key === 'Escape') {
    cancelSwapMode();
    showToast('Swap cancelled');
  }
}

/**
 * Handle slot click (for swap mode destination selection).
 * @param {MouseEvent} e
 */
async function handleSlotClick(e) {
  if (!swapMode.active) return;

  const slot = e.currentTarget;
  const isEmpty = slot.classList.contains('empty');
  const location = slot.dataset.location;

  if (!isEmpty) {
    showToast('Select an empty slot for the displaced bottle');
    return;
  }

  // Perform the swap
  try {
    await swapBottles(swapMode.sourceSlot, swapMode.targetSlot, location);
    showToast(`Swapped! "${swapMode.displacedWineName}" moved to ${location}`);
    cancelSwapMode();
    await refreshData();
  } catch (err) {
    showToast('Error: ' + err.message);
    cancelSwapMode();
  }
}

/**
 * Check if drag is in progress.
 * @returns {boolean}
 */
export function isDragging() {
  return draggedSlot !== null;
}

/**
 * Check if swap mode is active.
 * @returns {boolean}
 */
export function isSwapModeActive() {
  return swapMode.active;
}
