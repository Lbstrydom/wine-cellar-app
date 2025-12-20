/**
 * @fileoverview Drag and drop functionality for bottle movement.
 * @module dragdrop
 */

import { moveBottle } from './api.js';
import { showToast } from './utils.js';
import { refreshData } from './app.js';

let draggedSlot = null;

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
  });
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

  // Highlight valid drop targets
  document.querySelectorAll('.slot.empty').forEach(slot => {
    slot.classList.add('drag-target');
  });
}

/**
 * Handle drag end.
 * @param {DragEvent} e
 */
function handleDragEnd(e) {
  this.classList.remove('dragging');
  draggedSlot = null;

  // Remove all drag indicators
  document.querySelectorAll('.slot').forEach(slot => {
    slot.classList.remove('drag-target', 'drag-over', 'drag-over-invalid');
  });
}

/**
 * Handle drag over.
 * @param {DragEvent} e
 */
function handleDragOver(e) {
  e.preventDefault();

  if (!draggedSlot || this === draggedSlot) return;

  const isEmpty = this.classList.contains('empty');

  if (isEmpty) {
    e.dataTransfer.dropEffect = 'move';
    this.classList.add('drag-over');
    this.classList.remove('drag-over-invalid');
  } else {
    e.dataTransfer.dropEffect = 'none';
    this.classList.add('drag-over-invalid');
    this.classList.remove('drag-over');
  }
}

/**
 * Handle drag leave.
 * @param {DragEvent} e
 */
function handleDragLeave(e) {
  this.classList.remove('drag-over', 'drag-over-invalid');
}

/**
 * Handle drop.
 * @param {DragEvent} e
 */
async function handleDrop(e) {
  e.preventDefault();
  this.classList.remove('drag-over', 'drag-over-invalid');

  if (!draggedSlot || this === draggedSlot) return;

  const fromLocation = draggedSlot.dataset.location;
  const toLocation = this.dataset.location;

  // Only allow drop on empty slots
  if (!this.classList.contains('empty')) {
    showToast('Cannot drop on occupied slot');
    return;
  }

  try {
    await moveBottle(fromLocation, toLocation);
    showToast(`Moved to ${toLocation}`);
    await refreshData();
  } catch (err) {
    showToast('Error: ' + err.message);
  }
}

/**
 * Check if drag is in progress.
 * @returns {boolean}
 */
export function isDragging() {
  return draggedSlot !== null;
}
