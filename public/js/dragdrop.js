/**
 * @fileoverview Drag and drop functionality for bottle movement.
 * Supports both mouse (HTML5 drag-drop) and touch (mobile) interactions.
 * @module dragdrop
 */

import { moveBottle, directSwapBottles } from './api.js';
import { showToast, showConfirmDialog } from './utils.js';
import { refreshData } from './app.js';
import { addTrackedListener, cleanupNamespace } from './eventManager.js';

const NAMESPACE = 'dragdrop';

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

// Long-press configuration for mobile drag
const LONG_PRESS_CONFIG = {
  duration: 500,          // ms to hold before drag starts
  moveThreshold: 10       // px movement cancels long-press (scroll intent)
};

let longPressTimer = null;
let longPressStartPos = null;

// Auto-scroll configuration
const AUTO_SCROLL_CONFIG = {
  edgeThreshold: 80,      // Pixels from viewport edge to trigger scroll
  scrollSpeed: 15,        // Pixels per frame
  scrollInterval: 16      // ~60fps
};

let autoScrollInterval = null;

/**
 * Clean up all drag-drop event listeners.
 * Must be called before re-rendering grids.
 */
export function cleanupDragAndDrop() {
  cleanupNamespace(NAMESPACE);
}

/**
 * Setup drag and drop on all slots.
 */
export function setupDragAndDrop() {
  // Clean up existing listeners before adding new ones
  cleanupDragAndDrop();

  document.querySelectorAll('.slot').forEach(slot => {
    const hasWine = slot.dataset.wineId;

    if (hasWine) {
      // Filled slots are draggable
      slot.setAttribute('draggable', 'true');
      slot.classList.add('draggable');

      // Desktop drag events
      addTrackedListener(NAMESPACE, slot, 'dragstart', handleDragStart);
      addTrackedListener(NAMESPACE, slot, 'dragend', handleDragEnd);

      // Touch events for mobile
      addTrackedListener(NAMESPACE, slot, 'touchstart', handleTouchStart, { passive: false });
      addTrackedListener(NAMESPACE, slot, 'touchmove', handleTouchMove, { passive: false });
      addTrackedListener(NAMESPACE, slot, 'touchend', handleTouchEnd);
      addTrackedListener(NAMESPACE, slot, 'touchcancel', handleTouchCancel);
    }

    // All slots can be drop targets
    addTrackedListener(NAMESPACE, slot, 'dragover', handleDragOver);
    addTrackedListener(NAMESPACE, slot, 'dragleave', handleDragLeave);
    addTrackedListener(NAMESPACE, slot, 'drop', handleDrop);
  });
}

/**
 * Start auto-scrolling when dragging near viewport edges.
 * @param {number} clientY - Mouse Y position
 */
function startAutoScroll(clientY) {
  stopAutoScroll();

  const viewportHeight = window.innerHeight;
  let scrollDirection = 0;

  if (clientY < AUTO_SCROLL_CONFIG.edgeThreshold) {
    scrollDirection = -1; // Scroll up
  } else if (clientY > viewportHeight - AUTO_SCROLL_CONFIG.edgeThreshold) {
    scrollDirection = 1; // Scroll down
  }

  if (scrollDirection !== 0) {
    autoScrollInterval = setInterval(() => {
      window.scrollBy(0, scrollDirection * AUTO_SCROLL_CONFIG.scrollSpeed);
    }, AUTO_SCROLL_CONFIG.scrollInterval);
  }
}

/**
 * Stop auto-scrolling.
 */
function stopAutoScroll() {
  if (autoScrollInterval) {
    clearInterval(autoScrollInterval);
    autoScrollInterval = null;
  }
}

/**
 * Handle drag start.
 * @param {DragEvent} e
 */
function handleDragStart(e) {
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

  // Add document-level drag listener for auto-scroll
  document.addEventListener('dragover', handleDocumentDragOver);
}

/**
 * Handle drag end.
 */
function handleDragEnd() {
  this.classList.remove('dragging');
  draggedSlot = null;

  // Stop auto-scrolling
  stopAutoScroll();
  document.removeEventListener('dragover', handleDocumentDragOver);

  // Remove drag indicators
  document.querySelectorAll('.slot').forEach(slot => {
    slot.classList.remove('drag-target', 'drag-over', 'drag-over-swap');
  });
}

/**
 * Handle document-level dragover for auto-scroll.
 * @param {DragEvent} e
 */
function handleDocumentDragOver(e) {
  startAutoScroll(e.clientY);
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
  const targetElement = this;

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
    // Target is occupied - show swap confirmation dialog
    const sourceWineName = draggedSlot.querySelector('.wine-name')?.textContent ||
      draggedSlot.dataset.wineName || 'Wine A';
    const targetWineName = targetElement.querySelector('.wine-name')?.textContent ||
      targetElement.dataset.wineName || 'Wine B';

    showSwapConfirmDialog(fromLocation, toLocation, sourceWineName, targetWineName);
  }
}

/**
 * Show confirmation dialog for swapping two wines.
 * @param {string} fromLocation - Source slot location
 * @param {string} toLocation - Target slot location
 * @param {string} sourceWineName - Name of wine being dragged
 * @param {string} targetWineName - Name of wine in target slot
 */
async function showSwapConfirmDialog(fromLocation, toLocation, sourceWineName, targetWineName) {
  const result = await showConfirmDialog({
    title: 'Swap Wines?',
    message: `Swap positions of these wines?\n\n` +
      `"${sourceWineName}" (${fromLocation})\n↔\n"${targetWineName}" (${toLocation})`,
    confirmText: 'Swap',
    cancelText: 'Cancel'
  });

  if (result) {
    try {
      await directSwapBottles(fromLocation, toLocation);
      showToast(`Swapped: ${sourceWineName} (${fromLocation}) ↔ ${targetWineName} (${toLocation})`);
      await refreshData();
    } catch (err) {
      showToast('Error: ' + err.message);
    }
  }
}

/**
 * Check if drag is in progress.
 * @returns {boolean}
 */
export function isDragging() {
  return draggedSlot !== null;
}

// ============== Touch Event Handlers for Mobile ==============

/**
 * Cancel any pending long-press timer.
 */
function cancelLongPress() {
  if (longPressTimer) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
  longPressStartPos = null;

  // Remove pending visual feedback
  document.querySelectorAll('.slot.drag-pending').forEach(s => {
    s.classList.remove('drag-pending');
  });
}

/**
 * Initiate drag after long-press completes.
 * @param {HTMLElement} slot - The slot to drag
 * @param {number} x - Touch X coordinate
 * @param {number} y - Touch Y coordinate
 */
function initiateTouchDrag(slot, x, y) {
  // Haptic feedback if available
  if (navigator.vibrate) {
    navigator.vibrate(50);
  }

  // Start touch drag
  touchDragState = {
    active: true,
    sourceSlot: slot.dataset.location,
    sourceElement: slot,
    ghostElement: null,
    startX: x,
    startY: y,
    currentTarget: null
  };

  // Visual feedback
  slot.classList.remove('drag-pending');
  slot.classList.add('touch-dragging');

  // Create ghost element for visual feedback
  createTouchGhost(slot, x, y);

  // Highlight valid drop targets
  document.querySelectorAll('.slot').forEach(s => {
    if (s !== slot) {
      s.classList.add('drag-target');
    }
  });
}

/**
 * Handle touch start - begin long-press timer for drag.
 * Normal scroll is allowed; drag only starts after holding 500ms.
 * @param {TouchEvent} e
 */
function handleTouchStart(e) {
  // Only handle single touch
  if (e.touches.length !== 1) return;

  const touch = e.touches[0];
  const slot = e.currentTarget;

  // Cancel any existing long-press
  cancelLongPress();

  // Store start position for movement detection
  longPressStartPos = { x: touch.clientX, y: touch.clientY };

  // Add visual hint that drag will start (subtle pulse)
  slot.classList.add('drag-pending');

  // Start long-press timer
  longPressTimer = setTimeout(() => {
    longPressTimer = null;
    initiateTouchDrag(slot, touch.clientX, touch.clientY);
  }, LONG_PRESS_CONFIG.duration);

  // DON'T prevent default here - allow native scroll to work
  // e.preventDefault(); -- REMOVED to allow scrolling
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
 * Handle touch move - check for scroll vs drag intent.
 * @param {TouchEvent} e
 */
function handleTouchMove(e) {
  // Only handle single touch
  if (e.touches.length !== 1) return;

  const touch = e.touches[0];

  // If long-press timer is still running, check for scroll intent
  if (longPressTimer && longPressStartPos) {
    const dx = Math.abs(touch.clientX - longPressStartPos.x);
    const dy = Math.abs(touch.clientY - longPressStartPos.y);

    // User moved finger - they want to scroll, not drag
    if (dx > LONG_PRESS_CONFIG.moveThreshold || dy > LONG_PRESS_CONFIG.moveThreshold) {
      cancelLongPress();
      // Let native scroll continue - don't prevent default
      return;
    }
  }

  // If drag is not active yet, allow normal behavior
  if (!touchDragState.active) return;

  // === DRAG IS ACTIVE - handle drag movement ===

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

  // Auto-scroll when near viewport edges
  startAutoScroll(touch.clientY);

  // Only prevent default when drag is active (stops page scroll during drag)
  e.preventDefault();
}

/**
 * Handle touch end - complete the drag or cancel long-press.
 * @param {TouchEvent} e
 */
async function handleTouchEnd(_e) {
  // Cancel any pending long-press
  cancelLongPress();

  // If drag wasn't active, nothing to do
  if (!touchDragState.active) return;

  const targetSlot = touchDragState.currentTarget;
  const fromLocation = touchDragState.sourceSlot;
  const sourceElement = touchDragState.sourceElement;

  // Stop auto-scrolling
  stopAutoScroll();

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
      // Target is occupied - show swap confirmation dialog
      const sourceWineName = sourceElement?.querySelector('.wine-name')?.textContent ||
        sourceElement?.dataset?.wineName || 'Wine A';
      const targetWineName = targetSlot.querySelector('.wine-name')?.textContent ||
        targetSlot.dataset.wineName || 'Wine B';

      showSwapConfirmDialog(fromLocation, toLocation, sourceWineName, targetWineName);
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

  // Clear all drag targets
  document.querySelectorAll('.slot').forEach(slot => {
    slot.classList.remove('drag-target', 'drag-over', 'drag-over-swap');
  });

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
