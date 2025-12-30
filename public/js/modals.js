/**
 * @fileoverview Modal management.
 * @module modals
 */

import { drinkBottle, getWineRatings, updatePersonalRating, getDrinkingWindows, saveDrinkingWindow, deleteDrinkingWindow } from './api.js';
import { showToast, escapeHtml } from './utils.js';
import { refreshData } from './app.js';
import { renderRatingsPanel, initRatingsPanel } from './ratings.js';
import { showSlotPickerModal, showEditBottleModal } from './bottles.js';

let currentSlot = null;
let pendingQuantityWine = null; // { wineId, wineName }

/**
 * Show wine detail modal from a wine list item.
 * Converts wine list data to slot-like format for the modal.
 * @param {Object} wine - Wine list data with id, wine_name, style, vintage, colour, locations, etc.
 */
export async function showWineModalFromList(wine) {
  // Convert wine list data to slot-like object
  const slot = {
    wine_id: wine.id,
    wine_name: wine.wine_name,
    style: wine.style,
    vintage: wine.vintage,
    colour: wine.colour,
    location_code: wine.locations || '-', // Show all locations or dash if no bottles
    rating: wine.vivino_rating,
    price: wine.price_eur,
    reduce_priority: wine.reduce_priority,
    reduce_reason: wine.reduce_reason,
    tasting_notes: wine.tasting_notes,
    // Extra info for wine list context
    bottle_count: wine.bottle_count
  };

  await showWineModal(slot);
}

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
      ratingsContainer.innerHTML = `
        <div class="ratings-error">
          <p>Could not load ratings</p>
          <button type="button" class="btn btn-secondary btn-small" id="retry-ratings-btn">Retry</button>
        </div>
      `;
      // Add retry handler
      document.getElementById('retry-ratings-btn')?.addEventListener('click', async () => {
        ratingsContainer.innerHTML = '<div class="ratings-loading">Loading ratings...</div>';
        try {
          const ratingsData = await getWineRatings(slot.wine_id);
          ratingsContainer.innerHTML = `<div class="ratings-panel-container">${renderRatingsPanel(ratingsData)}</div>`;
          initRatingsPanel(slot.wine_id);
        } catch (retryErr) {
          ratingsContainer.innerHTML = `
            <div class="ratings-error">
              <p>Could not load ratings: ${retryErr.message || 'Unknown error'}</p>
              <button type="button" class="btn btn-secondary btn-small" id="retry-ratings-btn">Retry</button>
            </div>
          `;
        }
      });
    }
  }

  // Load personal rating
  await loadPersonalRating(slot.wine_id);

  // Load drinking windows
  await loadDrinkingWindows(slot.wine_id);

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
 * Handle "Add Another" button - opens quantity dialog first.
 */
function handleAddAnother() {
  if (!currentSlot || !currentSlot.wine_id) return;

  const wineId = currentSlot.wine_id;
  const wineName = currentSlot.wine_name;

  closeWineModal();
  showAddQuantityModal(wineId, wineName);
}

/**
 * Show the quantity selection modal for adding multiple bottles.
 * @param {number} wineId - Wine ID to add
 * @param {string} wineName - Wine name for display
 */
export function showAddQuantityModal(wineId, wineName) {
  pendingQuantityWine = { wineId, wineName };

  document.getElementById('add-quantity-wine-name').textContent = wineName;
  document.getElementById('add-quantity-input').value = 1;

  // Hide placement options initially (show when quantity > 1)
  document.getElementById('placement-options').style.display = 'none';

  // Reset to auto-fill option
  const autoRadio = document.querySelector('input[name="placement-method"][value="auto"]');
  if (autoRadio) autoRadio.checked = true;

  document.getElementById('add-quantity-modal-overlay').classList.add('active');

  // Focus the input for quick entry
  setTimeout(() => {
    document.getElementById('add-quantity-input').focus();
    document.getElementById('add-quantity-input').select();
  }, 100);
}

/**
 * Handle quantity input change - show/hide placement options.
 */
function handleQuantityChange() {
  const quantity = parseInt(document.getElementById('add-quantity-input').value, 10) || 1;
  const placementOptions = document.getElementById('placement-options');
  if (placementOptions) {
    placementOptions.style.display = quantity > 1 ? 'block' : 'none';
  }
}

/**
 * Close the quantity selection modal.
 */
function closeAddQuantityModal() {
  document.getElementById('add-quantity-modal-overlay').classList.remove('active');
  pendingQuantityWine = null;
}

/**
 * Handle confirm button on quantity modal.
 */
function handleQuantityConfirm() {
  if (!pendingQuantityWine) return;

  const quantity = parseInt(document.getElementById('add-quantity-input').value, 10) || 1;
  const { wineId, wineName } = pendingQuantityWine;

  // Get placement method (only relevant for quantity > 1)
  const placementMethod = quantity > 1
    ? document.querySelector('input[name="placement-method"]:checked')?.value || 'auto'
    : 'manual'; // Single bottle always goes to manual slot selection

  closeAddQuantityModal();
  showSlotPickerModal(wineId, wineName, true, quantity, placementMethod);
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
 * Load drinking windows for a wine.
 * @param {number} wineId - Wine ID
 */
async function loadDrinkingWindows(wineId) {
  if (!wineId) return;

  const container = document.getElementById('drinking-window-display');
  if (!container) return;

  try {
    const windows = await getDrinkingWindows(wineId);

    if (windows.length === 0) {
      container.innerHTML = '<p class="no-data">No drinking window data. Fetch ratings or enter manually.</p>';
      return;
    }

    const currentYear = new Date().getFullYear();

    const html = windows.map(w => {
      const status = getWindowStatus(w, currentYear);
      return `
        <div class="window-entry ${status.statusClass}">
          <span class="window-range">
            ${w.drink_from_year || '?'} – ${w.drink_by_year || '?'}
            ${w.peak_year ? `(peak ${w.peak_year})` : ''}
          </span>
          <span class="window-source">via ${escapeHtml(w.source)}</span>
          <span class="window-status">${escapeHtml(status.text)}</span>
          ${w.source === 'manual' ? `<button class="window-delete-btn" data-source="manual" title="Remove">×</button>` : ''}
        </div>
      `;
    }).join('');

    container.innerHTML = html;

    // Add delete event listeners
    container.querySelectorAll('.window-delete-btn').forEach(btn => {
      btn.addEventListener('click', () => handleDeleteWindow(wineId, btn.dataset.source));
    });

  } catch (_err) {
    container.innerHTML = '<p class="no-data">Could not load drinking window data</p>';
  }
}

/**
 * Get window status text and class based on current year.
 * @param {Object} window - Drinking window object
 * @param {number} currentYear - Current year
 * @returns {{statusClass: string, text: string}}
 */
function getWindowStatus(window, currentYear) {
  const { drink_from_year, drink_by_year, peak_year } = window;

  if (drink_by_year && drink_by_year < currentYear) {
    return { statusClass: 'status-critical', text: 'Past window' };
  }
  if (drink_by_year && drink_by_year === currentYear) {
    return { statusClass: 'status-urgent', text: 'Final year' };
  }
  if (drink_by_year && drink_by_year <= currentYear + 1) {
    return { statusClass: 'status-soon', text: `${drink_by_year - currentYear} year left` };
  }
  if (peak_year && peak_year === currentYear) {
    return { statusClass: 'status-peak', text: 'At peak' };
  }
  if (drink_from_year && drink_from_year > currentYear) {
    return { statusClass: 'status-hold', text: `Hold until ${drink_from_year}` };
  }
  if (drink_by_year) {
    return { statusClass: 'status-ok', text: `${drink_by_year - currentYear} years left` };
  }
  return { statusClass: 'status-unknown', text: 'Open window' };
}

/**
 * Handle saving manual drinking window.
 */
async function handleSaveManualWindow() {
  if (!currentSlot?.wine_id) return;

  const drinkFrom = document.getElementById('manual-drink-from').value;
  const drinkBy = document.getElementById('manual-drink-by').value;

  if (!drinkFrom && !drinkBy) {
    showToast('Enter at least one year');
    return;
  }

  try {
    await saveDrinkingWindow(currentSlot.wine_id, {
      source: 'manual',
      drink_from_year: drinkFrom ? parseInt(drinkFrom, 10) : null,
      drink_by_year: drinkBy ? parseInt(drinkBy, 10) : null,
      confidence: 'high'
    });

    showToast('Drinking window saved');

    // Clear inputs
    document.getElementById('manual-drink-from').value = '';
    document.getElementById('manual-drink-by').value = '';

    // Reload windows
    await loadDrinkingWindows(currentSlot.wine_id);
  } catch (_err) {
    showToast('Error saving drinking window');
  }
}

/**
 * Handle deleting a drinking window.
 * @param {number} wineId - Wine ID
 * @param {string} source - Source to delete
 */
async function handleDeleteWindow(wineId, source) {
  try {
    await deleteDrinkingWindow(wineId, source);
    showToast('Window removed');
    await loadDrinkingWindows(wineId);
  } catch (_err) {
    showToast('Error removing window');
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
  document.getElementById('save-manual-window')?.addEventListener('click', handleSaveManualWindow);
  document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'modal-overlay') closeWineModal();
  });

  // Add quantity modal handlers
  document.getElementById('add-quantity-confirm')?.addEventListener('click', handleQuantityConfirm);
  document.getElementById('add-quantity-cancel')?.addEventListener('click', closeAddQuantityModal);
  document.getElementById('add-quantity-modal-overlay')?.addEventListener('click', (e) => {
    if (e.target.id === 'add-quantity-modal-overlay') closeAddQuantityModal();
  });
  // Show/hide placement options when quantity changes
  document.getElementById('add-quantity-input')?.addEventListener('input', handleQuantityChange);
  // Allow Enter key to confirm quantity
  document.getElementById('add-quantity-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleQuantityConfirm();
    }
  });
}
