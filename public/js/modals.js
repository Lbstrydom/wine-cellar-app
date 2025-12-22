/**
 * @fileoverview Modal management.
 * @module modals
 */

import { drinkBottle, getWineRatings, updatePersonalRating } from './api.js';
import { showToast } from './utils.js';
import { refreshData } from './app.js';
import { renderRatingsPanel, initRatingsPanel } from './ratings.js';
import { showSlotPickerModal, showEditBottleModal } from './bottles.js';

let currentSlot = null;

/**
 * Show wine detail modal.
 * @param {Object} slot - Slot data
 */
export async function showWineModal(slot) {
  currentSlot = slot;

  document.getElementById('modal-wine-name').textContent = slot.wine_name;
  document.getElementById('modal-wine-style').textContent =
    `${slot.style} • ${slot.vintage || 'NV'} • ${slot.colour}`;
  document.getElementById('modal-location').textContent = slot.location_code;
  document.getElementById('modal-rating').textContent = slot.rating ? `${slot.rating}/5` : '-';
  document.getElementById('modal-price').textContent = slot.price ? `${slot.price.toFixed(2)}` : '-';

  const reduceField = document.getElementById('modal-reduce-field');
  if (slot.reduce_priority) {
    reduceField.style.display = 'block';
    document.getElementById('modal-reduce-reason').textContent =
      `Priority ${slot.reduce_priority}: ${slot.reduce_reason || 'No reason specified'}`;
  } else {
    reduceField.style.display = 'none';
  }

  // Display tasting notes if available
  const tastingNotesField = document.getElementById('modal-tasting-notes-field');
  if (slot.tasting_notes) {
    tastingNotesField.style.display = 'block';
    document.getElementById('modal-tasting-notes').textContent = slot.tasting_notes;
  } else {
    tastingNotesField.style.display = 'none';
  }

  // Load and display ratings
  const ratingsContainer = document.getElementById('modal-ratings-container');
  if (ratingsContainer && slot.wine_id) {
    ratingsContainer.innerHTML = '<div class="ratings-loading">Loading ratings...</div>';
    try {
      const ratingsData = await getWineRatings(slot.wine_id);
      ratingsContainer.innerHTML = `<div class="ratings-panel-container">${renderRatingsPanel(ratingsData)}</div>`;
      initRatingsPanel(slot.wine_id);
    } catch (_err) {
      ratingsContainer.innerHTML = '<div class="ratings-error">Could not load ratings</div>';
    }
  }

  // Load personal rating
  await loadPersonalRating(slot.wine_id);

  document.getElementById('modal-overlay').classList.add('active');
}

/**
 * Load personal rating into modal.
 * @param {number} wineId - Wine ID
 */
async function loadPersonalRating(wineId) {
  if (!wineId) return;

  try {
    const res = await fetch(`/api/wines/${wineId}/personal-rating`);
    const data = await res.json();
    document.getElementById('modal-personal-rating').value = data.personal_rating || '';
    document.getElementById('modal-personal-notes').value = data.personal_notes || '';
  } catch (_err) {
    // Ignore errors loading personal rating
  }
}

/**
 * Save personal rating.
 */
async function savePersonalRating() {
  if (!currentSlot?.wine_id) return;

  const rating = document.getElementById('modal-personal-rating').value || null;
  const notes = document.getElementById('modal-personal-notes').value || null;

  try {
    await updatePersonalRating(currentSlot.wine_id, rating, notes);
    showToast('Rating saved');
  } catch (_err) {
    showToast('Error saving rating');
  }
}

/**
 * Handle "Add Another" button - opens slot picker to add same wine.
 */
function handleAddAnother() {
  if (!currentSlot || !currentSlot.wine_id) return;

  const wineId = currentSlot.wine_id;
  const wineName = currentSlot.wine_name;

  closeWineModal();
  showSlotPickerModal(wineId, wineName);
}

/**
 * Handle edit wine button.
 */
function handleEditWine() {
  if (!currentSlot || !currentSlot.wine_id) return;

  const location = currentSlot.location_code;
  const wineId = currentSlot.wine_id;

  closeWineModal();
  showEditBottleModal(location, wineId);
}

/**
 * Close wine detail modal.
 */
export function closeWineModal() {
  document.getElementById('modal-overlay').classList.remove('active');
  currentSlot = null;
}

/**
 * Handle drink button click.
 */
export async function handleDrinkBottle() {
  if (!currentSlot) return;

  const location = currentSlot.location_code;

  try {
    const data = await drinkBottle(location);
    closeWineModal();
    showToast(`Enjoyed! ${data.remaining_bottles} bottles remaining`);
    await refreshData();
  } catch (err) {
    showToast('Error: ' + err.message);
  }
}

/**
 * Initialise modal event listeners.
 */
export function initModals() {
  document.getElementById('btn-drink').addEventListener('click', handleDrinkBottle);
  document.getElementById('btn-close').addEventListener('click', closeWineModal);
  document.getElementById('btn-add-another')?.addEventListener('click', handleAddAnother);
  document.getElementById('btn-edit-wine')?.addEventListener('click', handleEditWine);
  document.getElementById('save-personal-rating')?.addEventListener('click', savePersonalRating);
  document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'modal-overlay') closeWineModal();
  });
}
