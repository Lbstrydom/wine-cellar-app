/**
 * @fileoverview Drag and drop functionality for bottle movement.
 * Supports both mouse (HTML5 drag-drop) and touch (mobile) interactions.
 * @module dragdrop
 */

import { moveBottle, swapBottles } from './api.js';
import { showToast } from './utils.js';
import { refreshData } from './app.js';

let draggedSlot = null;

// Touch drag state
let touchDragState = {
  active: false,
  sourceSlot: null,
  sourceElement: null,
  ghostElement: null,
  startX: 0,
  startY: 0,
  currentTarget: null
};

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

      // Desktop drag events
      slot.addEventListener('dragstart', handleDragStart);
      slot.addEventListener('dragend', handleDragEnd);

      // Touch events for mobile
      slot.addEventListener('touchstart', handleTouchStart, { passive: false });
      slot.addEventListener('touchmove', handleTouchMove, { passive: false });
      slot.addEventListener('touchend', handleTouchEnd);
      slot.addEventListener('touchcancel', handleTouchCancel);
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

// ============== Touch Event Handlers for Mobile ==============

/**
 * Handle touch start - begin drag on mobile.
 * @param {TouchEvent} e
 */
function handleTouchStart(e) {
  // Cancel any active swap mode
  if (swapMode.active) {
    cancelSwapMode();
  }

  // Only handle single touch
  if (e.touches.length !== 1) return;

  const touch = e.touches[0];
  const slot = e.currentTarget;

  // Start touch drag
  touchDragState = {
    active: true,
    sourceSlot: slot.dataset.location,
    sourceElement: slot,
    ghostElement: null,
    startX: touch.clientX,
    startY: touch.clientY,
    currentTarget: null
  };

  // Visual feedback - mark as dragging after a short delay to avoid accidental drags
  slot.classList.add('touch-dragging');

  // Create ghost element for visual feedback
  createTouchGhost(slot, touch.clientX, touch.clientY);

  // Highlight valid drop targets
  document.querySelectorAll('.slot').forEach(s => {
    if (s !== slot) {
      s.classList.add('drag-target');
    }
  });

  // Prevent default to avoid scrolling while dragging
  e.preventDefault();
}

/**
 * Create a ghost element that follows the touch.
 * @param {HTMLElement} slot - The slot being dragged
 * @param {number} x - Touch X coordinate
 * @param {number} y - Touch Y coordinate
 */
function createTouchGhost(slot, x, y) {
  const ghost = document.createElement('div');
  ghost.className = 'touch-drag-ghost';

  // Copy wine name from slot
  const wineName = slot.querySelector('.wine-name')?.textContent ||
    slot.dataset.wineName || 'Wine';
  ghost.textContent = wineName;

  // Position at touch point
  ghost.style.position = 'fixed';
  ghost.style.left = `${x - 40}px`;
  ghost.style.top = `${y - 20}px`;
  ghost.style.zIndex = '10000';
  ghost.style.pointerEvents = 'none';

  document.body.appendChild(ghost);
  touchDragState.ghostElement = ghost;
}

/**
 * Handle touch move - update ghost position and find target.
 * @param {TouchEvent} e
 */
function handleTouchMove(e) {
  if (!touchDragState.active) return;

  // Only handle single touch
  if (e.touches.length !== 1) return;

  const touch = e.touches[0];

  // Update ghost position
  if (touchDragState.ghostElement) {
    touchDragState.ghostElement.style.left = `${touch.clientX - 40}px`;
    touchDragState.ghostElement.style.top = `${touch.clientY - 20}px`;
  }

  // Find element under touch point
  // Temporarily hide ghost to find element beneath
  if (touchDragState.ghostElement) {
    touchDragState.ghostElement.style.display = 'none';
  }

  const elementBelow = document.elementFromPoint(touch.clientX, touch.clientY);

  if (touchDragState.ghostElement) {
    touchDragState.ghostElement.style.display = '';
  }

  // Find the slot element (could be the slot or a child element)
  const targetSlot = elementBelow?.closest('.slot');

  // Clear previous target highlight
  if (touchDragState.currentTarget && touchDragState.currentTarget !== targetSlot) {
    touchDragState.currentTarget.classList.remove('drag-over', 'drag-over-swap');
  }

  // Highlight new target
  if (targetSlot && targetSlot !== touchDragState.sourceElement) {
    touchDragState.currentTarget = targetSlot;
    const isEmpty = targetSlot.classList.contains('empty');

    if (isEmpty) {
      targetSlot.classList.add('drag-over');
      targetSlot.classList.remove('drag-over-swap');
    } else {
      targetSlot.classList.add('drag-over-swap');
      targetSlot.classList.remove('drag-over');
    }
  } else {
    touchDragState.currentTarget = null;
  }

  // Prevent scrolling
  e.preventDefault();
}

/**
 * Handle touch end - complete the drag.
 * @param {TouchEvent} e
 */
async function handleTouchEnd(e) {
  if (!touchDragState.active) return;

  const targetSlot = touchDragState.currentTarget;
  const fromLocation = touchDragState.sourceSlot;

  // Clean up visual elements
  cleanupTouchDrag();

  // If we have a valid target, perform the move/swap
  if (targetSlot && fromLocation) {
    const toLocation = targetSlot.dataset.location;
    const isEmpty = targetSlot.classList.contains('empty');

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
      enterSwapMode(fromLocation, toLocation, targetSlot);
    }
  }
}

/**
 * Handle touch cancel - abort the drag.
 */
function handleTouchCancel() {
  cleanupTouchDrag();
}

/**
 * Clean up touch drag state and visual elements.
 */
function cleanupTouchDrag() {
  // Remove ghost element
  if (touchDragState.ghostElement) {
    touchDragState.ghostElement.remove();
  }

  // Remove visual feedback
  if (touchDragState.sourceElement) {
    touchDragState.sourceElement.classList.remove('touch-dragging');
  }

  // Clear target highlight
  if (touchDragState.currentTarget) {
    touchDragState.currentTarget.classList.remove('drag-over', 'drag-over-swap');
  }

  // Clear all drag targets (unless in swap mode)
  if (!swapMode.active) {
    document.querySelectorAll('.slot').forEach(slot => {
      slot.classList.remove('drag-target', 'drag-over', 'drag-over-swap');
    });
  }

  // Reset state
  touchDragState = {
    active: false,
    sourceSlot: null,
    sourceElement: null,
    ghostElement: null,
    startX: 0,
    startY: 0,
    currentTarget: null
  };
}
