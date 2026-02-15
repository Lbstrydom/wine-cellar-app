/**
 * @fileoverview Bottle form submission handling.
 * @module bottles/form
 */

import { createWine, updateWine, addBottles, removeBottle, getSuggestedPlacement, getWineSearchStatus, checkWineDuplicate } from '../api.js';
import { showToast } from '../utils.js';
import { refreshData } from '../app.js';
import { bottleState } from './state.js';
import { closeBottleModal } from './modal.js';
import { showSlotPickerModal } from './slotPicker.js';
import { showWineConfirmation } from './wineConfirmation.js';
import { showWineDisambiguation } from './disambiguationModal.js';

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

  // Country dropdown "Other" handler
  const countrySelect = document.getElementById('wine-country');
  const countryOther = document.getElementById('wine-country-other');
  if (countrySelect && countryOther) {
    countrySelect.addEventListener('change', () => {
      countryOther.style.display = countrySelect.value === 'Other' ? 'block' : 'none';
      if (countrySelect.value !== 'Other') {
        countryOther.value = '';
      }
    });
  }
}

/**
 * Get the selected country value, handling "Other" option.
 * @returns {string|null} Country value
 */
function getCountryValue() {
  const countrySelect = document.getElementById('wine-country');
  const countryOther = document.getElementById('wine-country-other');

  if (!countrySelect) return null;

  if (countrySelect.value === 'Other' && countryOther) {
    return countryOther.value.trim() || null;
  }

  return countrySelect.value || null;
}

/**
 * Collect wine data from form.
 * @returns {Object} Wine form data
 */
function collectWineFormData() {
  return {
    wine_name: document.getElementById('wine-name').value.trim(),
    vintage: document.getElementById('wine-vintage').value || null,
    colour: document.getElementById('wine-colour').value,
    style: document.getElementById('wine-style').value.trim() || null,
    vivino_rating: document.getElementById('wine-rating').value || null,
    price_eur: document.getElementById('wine-price').value || null,
    country: getCountryValue(),
    drink_from: document.getElementById('wine-drink-from')?.value || null,
    drink_peak: document.getElementById('wine-drink-peak')?.value || null,
    drink_until: document.getElementById('wine-drink-until')?.value || null
  };
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
      const wineData = collectWineFormData();

      if (!wineData.wine_name) {
        showToast('Wine name is required');
        return;
      }

      if (bottleState.mode === 'edit' && bottleState.editingWineId) {
        // Update existing wine - no confirmation needed
        await updateWine(bottleState.editingWineId, wineData);
        showToast('Wine updated');
        wineId = bottleState.editingWineId;
      } else {
        const disambiguation = await getDisambiguationData(wineData);

        if (disambiguation && (disambiguation.duplicates?.length || disambiguation.matches?.length)) {
          showWineDisambiguation(
            wineData,
            disambiguation,
            {
              onUseExisting: async (existingWineId, selectedQty) => {
                if (bottleState.mode === 'add') {
                  await addBottlesToSlots(existingWineId, selectedQty);
                }
                closeBottleModal();
                await refreshData();
                showToast('Added bottles to existing wine');
              },
              onSelectMatch: async (match, selectedQty) => {
                await saveWineWithExternalMatch(wineData, match, selectedQty);
              },
              onSkip: async (selectedQty) => {
                await saveWineWithoutConfirmation(wineData, selectedQty);
              }
            }
          );
          return;
        }

        // Fallback to legacy confirmation if search is enabled and disambiguation not available
        const shouldConfirm = await shouldShowConfirmation();
        if (shouldConfirm) {
          showWineConfirmation(
            wineData,
            async (confirmedWine) => {
              await saveWineWithConfirmation(wineData, confirmedWine, quantity);
            },
            async () => {
              await saveWineWithoutConfirmation(wineData, quantity);
            }
          );
          return;
        }

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
      await addBottlesToSlots(wineId, quantity);
    }

    closeBottleModal();
    await refreshData();

  } catch (err) {
    showToast('Error: ' + err.message);
  }
}

/**
 * Check if wine confirmation should be shown.
 * Returns true if Bright Data is configured.
 * @returns {Promise<boolean>}
 */
async function shouldShowConfirmation() {
  try {
    // Check if BRIGHTDATA_API_KEY is configured by checking feature availability
    const status = await getWineSearchStatus();
    return status.available === true;
  } catch {
    return false;
  }
}

/**
 * Fetch duplicate and external match data.
 * @param {Object} formData - Wine form data
 * @returns {Promise<Object|null>}
 */
async function getDisambiguationData(formData) {
  try {
    const response = await checkWineDuplicate(formData);
    return response?.data || null;
  } catch {
    return null;
  }
}

/**
 * Save wine with confirmed Vivino data.
 * @param {Object} formData - Original form data
 * @param {Object} confirmedWine - Confirmed wine from Vivino (includes quantity)
 * @param {number} [fallbackQuantity] - Fallback quantity if not in confirmedWine
 */
async function saveWineWithConfirmation(formData, confirmedWine, fallbackQuantity = 1) {
  try {
    // Use quantity from confirmation modal, fall back to passed quantity
    const quantity = confirmedWine.quantity || fallbackQuantity;

    // Merge confirmed Vivino data with form data
    const wineData = {
      ...formData,
      // Use confirmed name if different and seems more complete
      wine_name: confirmedWine.name || formData.wine_name,
      // Use confirmed vintage if available
      vintage: confirmedWine.vintage || formData.vintage,
      // Use confirmed country if we didn't have one
      country: formData.country || confirmedWine.country,
      // Use confirmed grape variety as style if we didn't have one
      style: formData.style || confirmedWine.grapeVariety,
      // Use confirmed rating
      vivino_rating: confirmedWine.rating || formData.vivino_rating,
      // Add Vivino reference (ensure vivinoId is string - API may return number)
      vivino_id: confirmedWine.vivinoId ? String(confirmedWine.vivinoId) : null,
      vivino_url: confirmedWine.vivinoUrl,
      vivino_confirmed: true
    };

    const result = await createWine(wineData);
    const wineId = result.id;

    // Add bottles if we have a location (slot or 'smart')
    if (bottleState.editingLocation && quantity > 0) {
      await addBottlesToSlots(wineId, quantity);
    }

    closeBottleModal();
    await refreshData();
    showToast(`Added ${quantity}x ${wineData.wine_name} (verified)`);

  } catch (err) {
    showToast('Error: ' + err.message);
  }
}

/**
 * Save wine with external match data.
 * @param {Object} formData - Original form data
 * @param {Object} match - Selected external match
 * @param {number} [fallbackQuantity] - Fallback quantity
 */
async function saveWineWithExternalMatch(formData, match, fallbackQuantity = 1) {
  try {
    const quantity = fallbackQuantity;
    if (!match?.external_id) {
      await saveWineWithoutConfirmation(formData, quantity);
      return;
    }
    const wineData = {
      ...formData,
      wine_name: match.name || formData.wine_name,
      vintage: match.vintage || formData.vintage,
      country: formData.country || match.country,
      style: formData.style || match.grape_variety || match.grapeVariety,
      external_match: {
        source: match.source || 'vivino',
        external_id: match.external_id,
        external_url: match.external_url,
        match_confidence: match.confidence?.score,
        rating: match.rating || null,
        rating_scale: '5',
        review_count: match.rating_count || null,
        extraction_method: 'structured',
        evidence: match.evidence || null
      }
    };

    const result = await createWine(wineData);
    const wineId = result.id;

    if (bottleState.editingLocation && quantity > 0) {
      await addBottlesToSlots(wineId, quantity);
    }

    closeBottleModal();
    await refreshData();
    showToast(`Added ${quantity}x ${wineData.wine_name} (matched)`);
  } catch (err) {
    showToast('Error: ' + err.message);
  }
}

/**
 * Save wine without Vivino confirmation.
 * @param {Object} formData - Form data
 * @param {number} quantity - Number of bottles (can come from confirmation modal)
 */
async function saveWineWithoutConfirmation(formData, quantity = 1) {
  try {
    const result = await createWine(formData);
    const wineId = result.id;

    // Add bottles if we have a location (slot or 'smart')
    if (bottleState.editingLocation && quantity > 0) {
      await addBottlesToSlots(wineId, quantity);
    }

    closeBottleModal();
    await refreshData();
    showToast(`Added ${quantity}x ${formData.wine_name}`);

  } catch (err) {
    showToast('Error: ' + err.message);
  }
}

/**
 * Add bottles to slots based on placement method.
 * @param {number} wineId - Wine ID
 * @param {number} quantity - Number of bottles
 */
async function addBottlesToSlots(wineId, quantity) {
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
 * Submit a parsed wine directly (skips form population step).
 * Exported for use by textParsing.js and imageParsing.js
 * @param {Object} wineData - Wine data from parsing
 * @param {number} quantity - Number of bottles to add
 */
export async function submitParsedWine(wineData, quantity) {
  if (!wineData.wine_name) {
    showToast('Wine name is required');
    return;
  }

  try {
    const disambiguation = await getDisambiguationData(wineData);
    if (disambiguation && (disambiguation.duplicates?.length || disambiguation.matches?.length)) {
      showWineDisambiguation(
        wineData,
        disambiguation,
        {
          onUseExisting: async (existingWineId, selectedQty) => {
            if (bottleState.mode === 'add') {
              await addBottlesToSlots(existingWineId, selectedQty);
            }
            closeBottleModal();
            await refreshData();
            showToast('Added bottles to existing wine');
          },
          onSelectMatch: async (match, selectedQty) => {
            await saveWineWithExternalMatch(wineData, match, selectedQty);
          },
          onSkip: async (selectedQty) => {
            await saveWineWithoutConfirmation(wineData, selectedQty);
          }
        }
      );
      return;
    }

    const shouldConfirm = await shouldShowConfirmation();
    if (shouldConfirm) {
      showWineConfirmation(
        wineData,
        async (confirmedWine) => {
          await saveWineWithConfirmation(wineData, confirmedWine, quantity);
        },
        async () => {
          await saveWineWithoutConfirmation(wineData, quantity);
        }
      );
      return;
    }

    await saveWineWithoutConfirmation(wineData, quantity);
  } catch (err) {
    showToast('Error: ' + err.message);
  }
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
    if (result.compaction_suggestions?.length > 0) {
      const count = result.compaction_suggestions.length;
      showToast(`${count} gap${count > 1 ? 's' : ''} detected — check Analysis for compaction suggestions`, 4000);
    }
    closeBottleModal();
    await refreshData();
  } catch (err) {
    showToast('Error: ' + err.message);
  }
}
