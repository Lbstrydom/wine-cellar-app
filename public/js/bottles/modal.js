/**
 * @fileoverview Bottle modal management (show/hide/close).
 * @module bottles/modal
 */

import { fetchWine } from '../api.js';
import { showToast, WINE_COUNTRIES } from '../utils.js';
import { state } from '../app.js';
import { bottleState, resetBottleState } from './state.js';
import { clearUploadedImage } from './imageParsing.js';

/**
 * Find slot data from current layout.
 * @param {string} location - Location code
 * @returns {Object|null}
 */
export function findSlotData(location) {
  if (!state.layout) return null;
  const allSlots = [
    ...state.layout.fridge.rows.flatMap(r => r.slots),
    ...state.layout.cellar.rows.flatMap(r => r.slots)
  ];
  return allSlots.find(s => s.location_code === location);
}

/**
 * Show modal for adding new bottle.
 * @param {string} location - Target slot location
 */
export function showAddBottleModal(location) {
  bottleState.mode = 'add';
  bottleState.editingLocation = location;
  bottleState.editingWineId = null;

  document.getElementById('bottle-modal-title').textContent = 'Add New Bottle';
  document.getElementById('bottle-modal-subtitle').textContent = `Adding to slot: ${location}`;
  document.getElementById('bottle-save-btn').textContent = 'Add Bottle';
  document.getElementById('bottle-delete-btn').style.display = 'none';
  document.getElementById('quantity-section').style.display = 'block';

  // Reset form
  document.getElementById('bottle-form').reset();
  document.getElementById('selected-wine-id').value = '';
  document.getElementById('wine-search-results').classList.remove('active');

  // Reset image upload
  clearUploadedImage();

  // Clear parse results
  const parseResults = document.getElementById('parse-results');
  if (parseResults) parseResults.innerHTML = '';

  // Default to existing wine mode
  setBottleFormMode('existing');

  document.getElementById('bottle-modal-overlay').classList.add('active');
}

/**
 * Show modal for editing existing bottle.
 * @param {string} location - Slot location
 * @param {number} wineId - Wine ID
 */
export async function showEditBottleModal(location, wineId) {
  bottleState.mode = 'edit';
  bottleState.editingLocation = location;
  bottleState.editingWineId = wineId;

  document.getElementById('bottle-modal-title').textContent = 'Edit Wine';
  document.getElementById('bottle-modal-subtitle').textContent = `Location: ${location}`;
  document.getElementById('bottle-save-btn').textContent = 'Save Changes';
  document.getElementById('bottle-delete-btn').style.display = 'block';
  document.getElementById('quantity-section').style.display = 'none';

  // Hide toggle buttons - go straight to form
  const formToggle = document.querySelector('.form-toggle');
  if (formToggle) formToggle.style.display = 'none';

  // Load wine details
  try {
    const wine = await fetchWine(wineId);
    document.getElementById('wine-name').value = wine.wine_name || '';
    document.getElementById('wine-vintage').value = wine.vintage || '';
    document.getElementById('wine-colour').value = wine.colour || 'white';
    document.getElementById('wine-style').value = wine.style || '';
    document.getElementById('wine-rating').value = wine.vivino_rating || '';
    document.getElementById('wine-price').value = wine.price_eur || '';

    // Handle country dropdown with "Other" option
    const countrySelect = document.getElementById('wine-country');
    const countryOther = document.getElementById('wine-country-other');
    if (wine.country && WINE_COUNTRIES.includes(wine.country)) {
      countrySelect.value = wine.country;
      if (countryOther) countryOther.style.display = 'none';
    } else if (wine.country) {
      countrySelect.value = 'Other';
      if (countryOther) {
        countryOther.value = wine.country;
        countryOther.style.display = 'block';
      }
    } else {
      countrySelect.value = '';
      if (countryOther) countryOther.style.display = 'none';
    }

    document.getElementById('wine-drink-from').value = wine.drink_from || '';
    document.getElementById('wine-drink-peak').value = wine.drink_peak || '';
    document.getElementById('wine-drink-until').value = wine.drink_until || '';
    document.getElementById('selected-wine-id').value = wineId;
  } catch (_err) {
    showToast('Failed to load wine details');
    return;
  }

  // Switch to edit mode (shows form fields)
  setBottleFormMode('new');

  document.getElementById('bottle-modal-overlay').classList.add('active');
}

/**
 * Close bottle modal.
 */
export function closeBottleModal() {
  document.getElementById('bottle-modal-overlay').classList.remove('active');
  resetBottleState();

  // Reset form toggle visibility
  const formToggle = document.querySelector('.form-toggle');
  if (formToggle) formToggle.style.display = 'flex';

  // Reset bottom buttons visibility (may have been hidden by parse results)
  const modalActions = document.querySelector('#bottle-modal .modal-actions');
  if (modalActions) modalActions.style.display = 'flex';
}

/**
 * Set bottle form mode (existing wine search, new wine entry, or parse text).
 * @param {string} mode - 'existing', 'new', or 'parse'
 */
export function setBottleFormMode(mode) {
  // Update toggle buttons
  document.querySelectorAll('.toggle-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });

  // Show/hide sections
  const existingSection = document.getElementById('existing-wine-section');
  const newSection = document.getElementById('new-wine-section');
  const parseSection = document.getElementById('parse-wine-section');

  if (existingSection) existingSection.style.display = mode === 'existing' ? 'block' : 'none';
  if (newSection) newSection.style.display = mode === 'new' ? 'block' : 'none';
  if (parseSection) parseSection.style.display = mode === 'parse' ? 'block' : 'none';

  // Restore bottom buttons when switching to non-parse modes
  // (parse mode hides them when showing results)
  if (mode !== 'parse') {
    const quantitySection = document.getElementById('quantity-section');
    const modalActions = document.querySelector('#bottle-modal .modal-actions');
    if (quantitySection) quantitySection.style.display = 'block';
    if (modalActions) modalActions.style.display = 'flex';
  }
}
