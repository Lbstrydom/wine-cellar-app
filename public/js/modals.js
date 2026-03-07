/**
 * @fileoverview Modal management.
 * @module modals
 */

import { drinkBottle, getWineRatings, getPersonalRating, updatePersonalRating, openBottle, sealBottle } from './api.js';
import { showToast, formatSlotLabel } from './utils.js';
import { refreshData, state } from './app.js';
import { renderRatingsPanel, initRatingsPanel } from './ratings.js';
import { showSlotPickerModal, showEditBottleModal } from './bottles.js';
import { renderTastingServiceCard } from './tastingService.js';
import { handleManualPairFromWine } from './manualPairing.js';
import { renderWineProfile } from './wineProfile.js';

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
  document.getElementById('modal-location').textContent =
    formatSlotLabel(slot.location_code, slot.storage_area_id, state.layout?.areas);
  document.getElementById('modal-rating').textContent = slot.rating ? `${slot.rating}/5` : '-';
  document.getElementById('modal-price').textContent = slot.price ? `${slot.price.toFixed(2)}` : '-';

  // Update open bottle button state
  updateOpenBottleButton(slot.is_open);

  const reduceField = document.getElementById('modal-reduce-field');
  if (slot.reduce_priority) {
    reduceField.style.display = 'block';
    document.getElementById('modal-reduce-reason').textContent =
      `Priority ${slot.reduce_priority}: ${slot.reduce_reason || 'No reason specified'}`;
  } else {
    reduceField.style.display = 'none';
  }

  // Build wine object for tasting card
  const wineData = slot.wine_id ? {
    id: slot.wine_id,
    wine_id: slot.wine_id,
    wine_name: slot.wine_name,
    style: slot.style,
    colour: slot.colour,
    vintage: slot.vintage
  } : null;

  // Show loading skeleton in tasting card (data comes from ratings response)
  const tastingServiceContainer = document.getElementById('tasting-service-container');
  if (tastingServiceContainer && wineData) {
    renderTastingServiceCard(wineData, tastingServiceContainer);
  }

  // Load and display ratings, tasting card, and prose narrative from single API call
  const ratingsContainer = document.getElementById('modal-ratings-container');
  if (ratingsContainer && slot.wine_id) {
    // Reset profile section while loading
    const profileContainer = document.getElementById('wine-profile-container');
    if (profileContainer) {
      profileContainer.innerHTML = '';
      profileContainer.style.display = 'none';
    }
    ratingsContainer.innerHTML = '<div class="ratings-loading"><div class="skeleton skeleton-text" style="width:80%"></div><div class="skeleton skeleton-text" style="width:60%"></div><div class="skeleton skeleton-text" style="width:70%"></div></div>';
    try {
      const ratingsData = await getWineRatings(slot.wine_id);
      renderWineProfile(document.getElementById('wine-profile-container'), ratingsData.narrative);
      ratingsContainer.innerHTML = `<div class="ratings-panel-container">${renderRatingsPanel(ratingsData)}</div>`;
      initRatingsPanel(slot.wine_id);
      // Render tasting card with pre-fetched data (no extra API calls)
      if (tastingServiceContainer && wineData && ratingsData.tasting_service) {
        renderTastingServiceCard(wineData, tastingServiceContainer, ratingsData.tasting_service);
      }
    } catch (_err) {
      ratingsContainer.innerHTML = `
        <div class="ratings-error">
          <p>Could not load ratings</p>
          <button type="button" class="btn btn-secondary btn-small" id="retry-ratings-btn">Retry</button>
        </div>
      `;
      // Add retry handler
      document.getElementById('retry-ratings-btn')?.addEventListener('click', async () => {
        ratingsContainer.innerHTML = '<div class="ratings-loading"><div class="skeleton skeleton-text" style="width:80%"></div><div class="skeleton skeleton-text" style="width:60%"></div><div class="skeleton skeleton-text" style="width:70%"></div></div>';
        try {
          const ratingsData = await getWineRatings(slot.wine_id);
          renderWineProfile(document.getElementById('wine-profile-container'), ratingsData.narrative);
          ratingsContainer.innerHTML = `<div class="ratings-panel-container">${renderRatingsPanel(ratingsData)}</div>`;
          initRatingsPanel(slot.wine_id);
          if (tastingServiceContainer && wineData && ratingsData.tasting_service) {
            renderTastingServiceCard(wineData, tastingServiceContainer, ratingsData.tasting_service);
          }
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

  document.getElementById('modal-overlay').classList.add('active');
}

/**
 * Load personal rating into modal.
 * @param {number} wineId - Wine ID
 */
async function loadPersonalRating(wineId) {
  if (!wineId) return;

  try {
    const data = await getPersonalRating(wineId);
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
  // Capture wine data before closeWineModal() nulls currentSlot
  const wineName = currentSlot.wine_name || 'Wine';
  const storageAreaId = currentSlot.storage_area_id || null;

  try {
    const data = await drinkBottle(location, { storage_area_id: storageAreaId });
    closeWineModal();
    const drinkLabel = formatSlotLabel(location, storageAreaId, state.layout?.areas);
    showToast(`Enjoyed ${wineName} from ${drinkLabel}! ${data.remaining_bottles} bottles remaining`);
    // Subtle hint — not a blocking modal
    showToast('You can rate this wine later — we\'ll remind you next time', 5000);
    if (data.compaction_suggestions?.length > 0) {
      const count = data.compaction_suggestions.length;
      showToast(`${count} gap${count > 1 ? 's' : ''} detected — check Analysis for compaction suggestions`, 4000);
    }
    await refreshData();
  } catch (err) {
    showToast('Error: ' + err.message);
  }
}

/**
 * Update open bottle button text based on state.
 * @param {boolean} isOpen - Whether bottle is open
 */
function updateOpenBottleButton(isOpen) {
  const btn = document.getElementById('btn-open-bottle');
  if (!btn) return;

  if (isOpen) {
    btn.textContent = 'Mark Sealed';
    btn.classList.add('is-open');
    btn.setAttribute('aria-pressed', 'true');
  } else {
    btn.textContent = 'Mark Open';
    btn.classList.remove('is-open');
    btn.setAttribute('aria-pressed', 'false');
  }
}

/**
 * Handle open/seal bottle button click.
 */
async function handleToggleOpenBottle() {
  if (!currentSlot) return;

  const location = currentSlot.location_code;
  const isCurrentlyOpen = currentSlot.is_open;
  const storageAreaId = currentSlot.storage_area_id || null;

  try {
    const toggleLabel = formatSlotLabel(location, storageAreaId, state.layout?.areas);
    if (isCurrentlyOpen) {
      await sealBottle(location, storageAreaId);
      currentSlot.is_open = false;
      showToast(`Bottle at ${toggleLabel} marked as sealed`);
    } else {
      await openBottle(location, storageAreaId);
      currentSlot.is_open = true;
      showToast(`Bottle at ${toggleLabel} marked as open`);
    }
    updateOpenBottleButton(currentSlot.is_open);
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
  document.getElementById('btn-open-bottle')?.addEventListener('click', handleToggleOpenBottle);
  document.getElementById('save-personal-rating')?.addEventListener('click', savePersonalRating);
  document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'modal-overlay') closeWineModal();
  });

  // Manual pairing: wine → dish direction
  document.getElementById('btn-pair-wine')?.addEventListener('click', () => {
    const panel = document.getElementById('manual-pair-panel');
    if (!panel) return;
    const isHidden = panel.style.display === 'none';
    panel.style.display = isHidden ? 'block' : 'none';
    panel.setAttribute('aria-hidden', isHidden ? 'false' : 'true');
    if (isHidden) document.getElementById('manual-pair-dish')?.focus();
  });
  document.getElementById('manual-pair-confirm')?.addEventListener('click', () => {
    if (!currentSlot?.wine_id) return;
    handleManualPairFromWine(currentSlot.wine_id, currentSlot.wine_name || 'this wine');
  });
  document.getElementById('manual-pair-cancel')?.addEventListener('click', () => {
    const panel = document.getElementById('manual-pair-panel');
    if (panel) {
      panel.style.display = 'none';
      panel.setAttribute('aria-hidden', 'true');
    }
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
