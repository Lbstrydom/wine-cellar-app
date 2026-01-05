/**
 * @fileoverview Drag and drop functionality for bottle movement.
 * Supports both mouse (HTML5 drag-drop) and touch (mobile) interactions.
 * @module dragdrop
 */

import { moveBottle, directSwapBottles } from './api.js';
import { showToast, showConfirmDialog } from './utils.js';
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

// Auto-scroll configuration
const AUTO_SCROLL_CONFIG = {
  edgeThreshold: 80,      // Pixels from viewport edge to trigger scroll
  scrollSpeed: 15,        // Pixels per frame
  scrollInterval: 16      // ~60fps
};

let autoScrollInterval = null;

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
      showToast(`Swapped ${fromLocation} ↔ ${toLocation}`);
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
 * Handle touch start - begin drag on mobile.
 * @param {TouchEvent} e
 */
function handleTouchStart(e) {
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

  // Auto-scroll when near viewport edges
  startAutoScroll(touch.clientY);

  // Prevent default scrolling (we handle it ourselves via auto-scroll)
  e.preventDefault();
}

/**
 * Handle touch end - complete the drag.
 * @param {TouchEvent} e
 */
async function handleTouchEnd(_e) {
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
