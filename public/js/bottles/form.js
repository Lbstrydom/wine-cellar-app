/**
 * @fileoverview Bottle form submission handling.
 * @module bottles/form
 */

import { createWine, updateWine, addBottles, removeBottle, getSuggestedPlacement } from '../api.js';
import { showToast } from '../utils.js';
import { refreshData } from '../app.js';
import { bottleState } from './state.js';
import { closeBottleModal } from './modal.js';
import { showSlotPickerModal } from './slotPicker.js';

/**
 * Initialize form event handlers.
 */
export function initForm() {
  const form = document.getElementById('bottle-form');
  if (form) {
    form.addEventListener('submit', handleBottleFormSubmit);
  }

  // Delete button
  document.getElementById('bottle-delete-btn')?.addEventListener('click', handleDeleteBottle);
}

/**
 * Handle bottle form submission.
 * @param {Event} e - Submit event
 */
async function handleBottleFormSubmit(e) {
  e.preventDefault();

  const mode = document.querySelector('.toggle-btn.active')?.dataset.mode || 'new';
  const quantity = Number.parseInt(document.getElementById('bottle-quantity')?.value, 10) || 1;

  try {
    let wineId;

    if (bottleState.mode === 'edit' || mode === 'new') {
      // Create or update wine
      const wineData = {
        wine_name: document.getElementById('wine-name').value.trim(),
        vintage: document.getElementById('wine-vintage').value || null,
        colour: document.getElementById('wine-colour').value,
        style: document.getElementById('wine-style').value.trim() || null,
        vivino_rating: document.getElementById('wine-rating').value || null,
        price_eur: document.getElementById('wine-price').value || null,
        country: document.getElementById('wine-country')?.value.trim() || null,
        drink_from: document.getElementById('wine-drink-from')?.value || null,
        drink_peak: document.getElementById('wine-drink-peak')?.value || null,
        drink_until: document.getElementById('wine-drink-until')?.value || null
      };

      if (!wineData.wine_name) {
        showToast('Wine name is required');
        return;
      }

      if (bottleState.mode === 'edit' && bottleState.editingWineId) {
        // Update existing wine
        await updateWine(bottleState.editingWineId, wineData);
        showToast('Wine updated');
        wineId = bottleState.editingWineId;
      } else {
        // Create new wine
        const result = await createWine(wineData);
        wineId = result.id;
      }
    } else {
      // Using existing wine
      wineId = document.getElementById('selected-wine-id').value;
      if (!wineId) {
        showToast('Please select a wine');
        return;
      }
    }

    // Add bottle(s) to slot(s) - only for add mode
    if (bottleState.mode === 'add') {
      // Check if user selected smart placement vs specific slot
      const useSmartPlacement = bottleState.editingLocation === 'smart';

      if (useSmartPlacement) {
        // Get AI-suggested placement
        try {
          const suggestion = await getSuggestedPlacement(wineId);
          if (suggestion.suggestedSlot) {
            const result = await addBottles(wineId, suggestion.suggestedSlot, quantity);
            showToast(`${result.message} (${suggestion.zoneName})`);
          } else {
            showToast('No empty slots in suggested zone. Please select manually.');
            showSlotPickerModalForWine(wineId, document.getElementById('wine-name').value || 'Wine');
            return;
          }
        } catch (err) {
          showToast(`Placement error: ${err.message}. Select slot manually.`);
          showSlotPickerModalForWine(wineId, document.getElementById('wine-name').value || 'Wine');
          return;
        }
      } else {
        const result = await addBottles(wineId, bottleState.editingLocation, quantity);
        showToast(result.message);
      }
    }

    closeBottleModal();
    await refreshData();

  } catch (err) {
    showToast('Error: ' + err.message);
  }
}

/**
 * Show slot picker for a specific wine (used as fallback).
 * @param {number} wineId - Wine ID
 * @param {string} wineName - Wine name for display
 */
function showSlotPickerModalForWine(wineId, wineName) {
  closeBottleModal();
  showSlotPickerModal(wineId, wineName);
}

/**
 * Handle delete bottle button.
 */
async function handleDeleteBottle() {
  if (!bottleState.editingLocation) return;

  if (!confirm(`Remove bottle from ${bottleState.editingLocation}? This won't log it as consumed.`)) {
    return;
  }

  try {
    const result = await removeBottle(bottleState.editingLocation);
    showToast(result.message);
    closeBottleModal();
    await refreshData();
  } catch (err) {
    showToast('Error: ' + err.message);
  }
}
