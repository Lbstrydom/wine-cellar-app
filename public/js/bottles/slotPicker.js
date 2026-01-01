/**
 * @fileoverview Slot picker mode for adding bottles to specific slots.
 * @module bottles/slotPicker
 */

import { addBottles, getSuggestedPlacement } from '../api.js';
import { showToast } from '../utils.js';
import { refreshData } from '../app.js';
import { bottleState, resetSlotPickerState } from './state.js';

/**
 * Show modal to pick empty slot for adding a wine.
 * @param {number} wineId - Wine to add
 * @param {string} wineName - Wine name for display
 * @param {boolean} offerSmartPlace - Whether to offer smart placement option
 * @param {number} quantity - Number of bottles to place (default 1)
 * @param {string} method - Placement method: 'auto' or 'manual' (default 'manual')
 */
export async function showSlotPickerModal(wineId, wineName, offerSmartPlace = true, quantity = 1, method = 'manual') {
  bottleState.pendingAddWineId = wineId;
  bottleState.pendingQuantity = quantity;
  bottleState.placedCount = 0;
  bottleState.placementMethod = method;

  // Update modal content
  const titleText = quantity > 1 ? `Add ${quantity}x: ${wineName}` : `Add: ${wineName}`;
  document.getElementById('slot-picker-title').textContent = titleText;

  // Show/hide progress indicator
  const progressEl = document.getElementById('slot-picker-progress');
  if (progressEl) {
    if (quantity > 1) {
      progressEl.style.display = 'block';
      document.getElementById('slot-picker-placed').textContent = '0';
      document.getElementById('slot-picker-total').textContent = quantity.toString();
    } else {
      progressEl.style.display = 'none';
    }
  }

  // Determine instruction text based on placement method
  let suggestionText;
  if (method === 'auto' && quantity > 1) {
    suggestionText = 'Click a starting slot - bottles will fill left-to-right';
  } else if (quantity > 1) {
    suggestionText = `Click ${quantity} empty slots to place bottles`;
  } else {
    suggestionText = 'Click an empty slot to add the bottle';
  }

  // Try to get placement suggestion if smart place offered
  if (offerSmartPlace) {
    try {
      const suggestion = await getSuggestedPlacement(wineId);
      if (suggestion.zoneName && suggestion.suggestedSlot) {
        if (method === 'auto' && quantity > 1) {
          suggestionText = `Suggested: ${suggestion.zoneName} - Click a starting slot`;
        } else if (quantity > 1) {
          suggestionText = `Suggested zone: ${suggestion.zoneName} - Click ${quantity} empty slots`;
        } else {
          suggestionText = `Suggested: ${suggestion.zoneName} (${suggestion.suggestedSlot})`;
        }
        // Highlight the suggested slot
        const suggestedSlotEl = document.querySelector(`.slot[data-location="${suggestion.suggestedSlot}"]`);
        if (suggestedSlotEl) {
          suggestedSlotEl.classList.add('suggested-slot');
        }
      }
    } catch (_err) {
      // Ignore errors, just use default text
    }
  }
  document.getElementById('slot-picker-instruction').textContent = suggestionText;

  // Enable slot picker mode
  document.body.classList.add('slot-picker-mode');

  // Show overlay
  document.getElementById('slot-picker-overlay').classList.add('active');

  // Highlight empty slots
  document.querySelectorAll('.slot.empty').forEach(slot => {
    slot.classList.add('picker-target');
  });

  // Add cancel handler
  document.getElementById('cancel-slot-picker')?.addEventListener('click', closeSlotPickerModal);
}

/**
 * Handle slot click in picker mode.
 * @param {HTMLElement} slotEl - Clicked slot
 */
export async function handleSlotPickerClick(slotEl) {
  if (!document.body.classList.contains('slot-picker-mode')) return;

  const location = slotEl.dataset.location;

  if (!slotEl.classList.contains('empty')) {
    showToast('Please select an empty slot');
    return;
  }

  // Auto-fill mode: place all bottles starting from clicked slot
  if (bottleState.placementMethod === 'auto' && bottleState.pendingQuantity > 1 && bottleState.placedCount === 0) {
    await handleAutoFillPlacement(location);
    return;
  }

  // Manual mode: place one bottle at a time
  try {
    await addBottles(bottleState.pendingAddWineId, location, 1);
    bottleState.placedCount++;

    // Mark the slot as placed (no longer a target)
    slotEl.classList.remove('picker-target', 'empty');
    slotEl.classList.add('picker-placed');

    // Update progress display
    const placedEl = document.getElementById('slot-picker-placed');
    if (placedEl) {
      placedEl.textContent = bottleState.placedCount.toString();
    }

    // Check if we've placed all bottles
    if (bottleState.placedCount >= bottleState.pendingQuantity) {
      const message = bottleState.pendingQuantity > 1
        ? `Added ${bottleState.pendingQuantity} bottles`
        : `Added to ${location}`;
      showToast(message);
      closeSlotPickerModal();
      await refreshData();
    } else {
      const remaining = bottleState.pendingQuantity - bottleState.placedCount;
      showToast(`Added to ${location} - ${remaining} more to place`);
      // Update instruction text
      document.getElementById('slot-picker-instruction').textContent =
        `Click ${remaining} more empty slot${remaining > 1 ? 's' : ''}`;
    }
  } catch (err) {
    showToast('Error: ' + err.message);
  }
}

/**
 * Handle auto-fill placement starting from clicked slot.
 * Fills left-to-right, then continues on next rows if needed.
 * @param {string} startLocation - Starting slot location code
 */
async function handleAutoFillPlacement(startLocation) {
  // Get all empty slots in order (left-to-right, top-to-bottom)
  const allSlots = Array.from(document.querySelectorAll('.slot.empty.picker-target'));

  // Parse location codes to sort them properly
  const sortedSlots = allSlots.map(slot => {
    const loc = slot.dataset.location;
    const match = loc.match(/^([RF])(\d+)(?:C(\d+))?$/);
    if (!match) return { slot, loc, zone: 'Z', row: 999, col: 999 };

    const zone = match[1]; // R or F
    const row = parseInt(match[2], 10);
    const col = match[3] ? parseInt(match[3], 10) : 0;

    return { slot, loc, zone, row, col };
  }).sort((a, b) => {
    // Sort: Fridge first, then by row, then by column
    if (a.zone !== b.zone) return a.zone === 'F' ? -1 : 1;
    if (a.row !== b.row) return a.row - b.row;
    return a.col - b.col;
  });

  // Find the starting position
  const startIndex = sortedSlots.findIndex(s => s.loc === startLocation);
  if (startIndex === -1) {
    showToast('Could not find starting slot');
    return;
  }

  // Get slots from starting position onwards
  let slotsToFill = sortedSlots.slice(startIndex);

  // If not enough slots after start, wrap around to beginning
  if (slotsToFill.length < bottleState.pendingQuantity) {
    const remaining = bottleState.pendingQuantity - slotsToFill.length;
    const additionalSlots = sortedSlots.slice(0, Math.min(remaining, startIndex));
    slotsToFill = [...slotsToFill, ...additionalSlots];
  }

  // Limit to requested quantity
  slotsToFill = slotsToFill.slice(0, bottleState.pendingQuantity);

  if (slotsToFill.length < bottleState.pendingQuantity) {
    showToast(`Only ${slotsToFill.length} empty slots available`);
  }

  // Place bottles in each slot
  let successCount = 0;
  for (const { slot, loc } of slotsToFill) {
    try {
      await addBottles(bottleState.pendingAddWineId, loc, 1);
      successCount++;

      // Mark the slot as placed
      slot.classList.remove('picker-target', 'empty');
      slot.classList.add('picker-placed');

      // Update progress display
      const placedEl = document.getElementById('slot-picker-placed');
      if (placedEl) {
        placedEl.textContent = successCount.toString();
      }
    } catch (err) {
      showToast(`Error placing at ${loc}: ${err.message}`);
      break;
    }
  }

  bottleState.placedCount = successCount;

  if (successCount > 0) {
    showToast(`Added ${successCount} bottle${successCount > 1 ? 's' : ''}`);
    closeSlotPickerModal();
    await refreshData();
  }
}

/**
 * Close slot picker modal.
 */
export function closeSlotPickerModal() {
  document.body.classList.remove('slot-picker-mode');
  document.getElementById('slot-picker-overlay').classList.remove('active');
  document.querySelectorAll('.slot.picker-target').forEach(slot => {
    slot.classList.remove('picker-target');
  });
  document.querySelectorAll('.slot.suggested-slot').forEach(slot => {
    slot.classList.remove('suggested-slot');
  });
  document.querySelectorAll('.slot.picker-placed').forEach(slot => {
    slot.classList.remove('picker-placed');
  });
  resetSlotPickerState();
}
