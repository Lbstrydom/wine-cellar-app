/**
 * @fileoverview Bottle form submission handling.
 * @module bottles/form
 */

import { createWine, updateWine, addBottles, removeBottle, getSuggestedPlacement, checkWineDuplicate } from '../api.js';
import { showToast } from '../utils.js';
import { refreshData } from '../app.js';
import { bottleState } from './state.js';
import { closeBottleModal } from './modal.js';
import { showSlotPickerModal } from './slotPicker.js';
import { showWineDisambiguation } from './disambiguationModal.js';
import { populateCountryDropdown, populateRegionDropdown } from './dropdownHelpers.js';
import { loadWineRegions } from '../config/wineRegions.js';

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

  // Load region data then populate country dropdown
  loadWineRegions().then(() => populateCountryDropdown());

  // Country change → cascade to region + handle "Other"
  const countrySelect = document.getElementById('wine-country');
  if (countrySelect) {
    countrySelect.addEventListener('change', () => {
      const country = countrySelect.value;

      // "Other" text input toggle
      const countryOther = document.getElementById('wine-country-other');
      if (countryOther) {
        countryOther.style.display = country === 'Other' ? 'block' : 'none';
        if (country !== 'Other') countryOther.value = '';
      }

      // Cascade: populate region dropdown
      populateRegionDropdown(country);
    });
  }

  // Region "Other" handler
  const regionSelect = document.getElementById('wine-region');
  const regionOther = document.getElementById('wine-region-other');
  if (regionSelect && regionOther) {
    regionSelect.addEventListener('change', () => {
      regionOther.style.display = regionSelect.value === 'Other' ? 'block' : 'none';
      if (regionSelect.value !== 'Other') regionOther.value = '';
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
 * Get the selected region value, handling "Other" option.
 * @returns {string|null} Region value
 */
function getRegionValue() {
  const regionSelect = document.getElementById('wine-region');
  const regionOther = document.getElementById('wine-region-other');

  if (!regionSelect) return null;

  if (regionSelect.value === 'Other' && regionOther) {
    return regionOther.value.trim() || null;
  }

  return regionSelect.value || null;
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
    grapes: document.getElementById('wine-grapes')?.value?.trim() || null,
    vivino_rating: document.getElementById('wine-rating').value || null,
    price_eur: document.getElementById('wine-price').value || null,
    country: getCountryValue(),
    producer: document.getElementById('wine-producer')?.value?.trim() || null,
    region: getRegionValue(),
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
        const updateResult = await updateWine(bottleState.editingWineId, wineData);
        showToast('Wine updated');
        // Notify if zone placement should change based on updated metadata
        if (updateResult?.zoneSuggestion?.changed) {
          const zs = updateResult.zoneSuggestion;
          showToast(`Zone suggestion changed to "${zs.displayName}" — run Analysis to see move suggestions`, 5000);
        }
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
      grapes: match.grape_variety || match.grapeVariety || null,
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
