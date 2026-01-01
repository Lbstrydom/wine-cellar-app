/**
 * @fileoverview Bottle management module - main entry point.
 * Handles bottle add/edit modal, wine parsing, and slot selection.
 *
 * This module was refactored from 1200+ lines into focused sub-modules:
 * - bottles/state.js - Shared module state
 * - bottles/modal.js - Modal show/hide/close
 * - bottles/form.js - Form handling and submission
 * - bottles/wineSearch.js - Wine search functionality
 * - bottles/textParsing.js - Text parsing UI
 * - bottles/imageParsing.js - Image upload and parsing
 * - bottles/slotPicker.js - Slot picker mode
 *
 * @module bottles
 */

import { fetchWineStyles } from './api.js';
import { escapeHtml } from './utils.js';
import { showWineModal } from './modals.js';
import { isDragging } from './dragdrop.js';

// Import sub-modules
import { bottleState } from './bottles/state.js';
import {
  findSlotData,
  showAddBottleModal,
  showEditBottleModal,
  closeBottleModal,
  setBottleFormMode
} from './bottles/modal.js';
import { initForm } from './bottles/form.js';
import { initWineSearch } from './bottles/wineSearch.js';
import { initTextParsing } from './bottles/textParsing.js';
import { initImageParsing } from './bottles/imageParsing.js';
import {
  showSlotPickerModal,
  handleSlotPickerClick,
  closeSlotPickerModal
} from './bottles/slotPicker.js';

/**
 * Initialise bottle management.
 */
export async function initBottles() {
  // Load wine styles for datalist
  try {
    bottleState.wineStyles = await fetchWineStyles();
    const datalist = document.getElementById('style-list');
    if (datalist) {
      datalist.innerHTML = bottleState.wineStyles.map(s => `<option value="${escapeHtml(s)}">`).join('');
    }
  } catch (err) {
    console.error('Failed to load wine styles:', err);
  }

  // Form mode toggle
  document.querySelectorAll('.toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => setBottleFormMode(btn.dataset.mode));
  });

  // Initialize sub-modules
  initWineSearch();
  initForm();
  initTextParsing();
  initImageParsing();

  // Cancel button
  document.getElementById('bottle-cancel-btn')?.addEventListener('click', closeBottleModal);

  // Close modal on overlay click
  document.getElementById('bottle-modal-overlay')?.addEventListener('click', (e) => {
    if (e.target.id === 'bottle-modal-overlay') closeBottleModal();
  });
}

/**
 * Handle slot click - show appropriate modal.
 * @param {HTMLElement} slotEl - Slot element
 */
export function handleSlotClick(slotEl) {
  // Check if in slot picker mode first
  if (document.body.classList.contains('slot-picker-mode')) {
    handleSlotPickerClick(slotEl);
    return;
  }

  // Don't trigger if dragging
  if (isDragging()) return;

  const location = slotEl.dataset.location;
  const wineId = slotEl.dataset.wineId;

  if (wineId) {
    // Filled slot - find slot data and show detail/edit modal
    const slotData = findSlotData(location);
    if (slotData) {
      showWineModal(slotData);
    }
  } else {
    // Empty slot - show add bottle modal
    showAddBottleModal(location);
  }
}

// Re-export public API
export {
  showAddBottleModal,
  showEditBottleModal,
  closeBottleModal,
  showSlotPickerModal,
  closeSlotPickerModal
};
