/**
 * @fileoverview Bottle add/edit modal functionality.
 * @module bottles
 */

import {
  fetchWine,
  fetchWineStyles,
  searchWines,
  createWine,
  updateWine,
  addBottles,
  removeBottle
} from './api.js';
import { showToast } from './utils.js';
import { refreshData, state } from './app.js';
import { showWineModal } from './modals.js';
import { isDragging } from './dragdrop.js';

let bottleModalMode = 'add'; // 'add' or 'edit'
let editingLocation = null;
let editingWineId = null;
let wineStyles = [];
let searchTimeout = null;

/**
 * Initialise bottle management.
 */
export async function initBottles() {
  // Load wine styles for datalist
  try {
    wineStyles = await fetchWineStyles();
    const datalist = document.getElementById('style-list');
    if (datalist) {
      datalist.innerHTML = wineStyles.map(s => `<option value="${s}">`).join('');
    }
  } catch (err) {
    console.error('Failed to load wine styles:', err);
  }

  // Form mode toggle
  document.querySelectorAll('.toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => setBottleFormMode(btn.dataset.mode));
  });

  // Wine search input
  const searchInput = document.getElementById('wine-search');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => handleWineSearch(e.target.value), 300);
    });
  }

  // Form submit
  const form = document.getElementById('bottle-form');
  if (form) {
    form.addEventListener('submit', handleBottleFormSubmit);
  }

  // Cancel button
  document.getElementById('bottle-cancel-btn')?.addEventListener('click', closeBottleModal);

  // Delete button
  document.getElementById('bottle-delete-btn')?.addEventListener('click', handleDeleteBottle);

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

/**
 * Find slot data from current layout.
 * @param {string} location - Location code
 * @returns {Object|null}
 */
function findSlotData(location) {
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
  bottleModalMode = 'add';
  editingLocation = location;
  editingWineId = null;

  document.getElementById('bottle-modal-title').textContent = 'Add New Bottle';
  document.getElementById('bottle-modal-subtitle').textContent = `Adding to slot: ${location}`;
  document.getElementById('bottle-save-btn').textContent = 'Add Bottle';
  document.getElementById('bottle-delete-btn').style.display = 'none';
  document.getElementById('quantity-section').style.display = 'block';

  // Reset form
  document.getElementById('bottle-form').reset();
  document.getElementById('selected-wine-id').value = '';
  document.getElementById('wine-search-results').classList.remove('active');

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
  bottleModalMode = 'edit';
  editingLocation = location;
  editingWineId = wineId;

  document.getElementById('bottle-modal-title').textContent = 'Edit Bottle';
  document.getElementById('bottle-modal-subtitle').textContent = `Location: ${location}`;
  document.getElementById('bottle-save-btn').textContent = 'Save Changes';
  document.getElementById('bottle-delete-btn').style.display = 'block';
  document.getElementById('quantity-section').style.display = 'none';

  // Load wine details
  try {
    const wine = await fetchWine(wineId);
    document.getElementById('wine-name').value = wine.wine_name || '';
    document.getElementById('wine-vintage').value = wine.vintage || '';
    document.getElementById('wine-colour').value = wine.colour || 'white';
    document.getElementById('wine-style').value = wine.style || '';
    document.getElementById('wine-rating').value = wine.vivino_rating || '';
    document.getElementById('wine-price').value = wine.price_eur || '';
    document.getElementById('selected-wine-id').value = wineId;
  } catch (err) {
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
  editingLocation = null;
  editingWineId = null;
}

/**
 * Set bottle form mode (existing wine search vs new wine entry).
 * @param {string} mode - 'existing' or 'new'
 */
function setBottleFormMode(mode) {
  const existingBtn = document.querySelector('.toggle-btn[data-mode="existing"]');
  const newBtn = document.querySelector('.toggle-btn[data-mode="new"]');
  const existingSection = document.getElementById('existing-wine-section');
  const newSection = document.getElementById('new-wine-section');

  if (mode === 'existing') {
    existingBtn?.classList.add('active');
    newBtn?.classList.remove('active');
    if (existingSection) existingSection.style.display = 'block';
    if (newSection) newSection.style.display = 'none';
  } else {
    existingBtn?.classList.remove('active');
    newBtn?.classList.add('active');
    if (existingSection) existingSection.style.display = 'none';
    if (newSection) newSection.style.display = 'block';
  }
}

/**
 * Handle wine search input.
 * @param {string} query - Search query
 */
async function handleWineSearch(query) {
  const resultsContainer = document.getElementById('wine-search-results');

  if (query.length < 2) {
    resultsContainer.classList.remove('active');
    return;
  }

  try {
    const wines = await searchWines(query);

    if (wines.length === 0) {
      resultsContainer.innerHTML = '<div class="search-result-item">No wines found. Try "New Wine" tab.</div>';
    } else {
      resultsContainer.innerHTML = wines.map(wine => `
        <div class="search-result-item" data-wine-id="${wine.id}">
          <div class="search-result-name">${wine.wine_name} ${wine.vintage || 'NV'}</div>
          <div class="search-result-meta">${wine.style || ''} - ${wine.colour}</div>
        </div>
      `).join('');

      // Add click handlers
      resultsContainer.querySelectorAll('.search-result-item[data-wine-id]').forEach(item => {
        item.addEventListener('click', () => selectSearchResult(item));
      });
    }

    resultsContainer.classList.add('active');
  } catch (err) {
    console.error('Search failed:', err);
  }
}

/**
 * Handle search result selection.
 * @param {HTMLElement} item - Selected item
 */
function selectSearchResult(item) {
  const wineId = item.dataset.wineId;

  document.getElementById('selected-wine-id').value = wineId;
  document.getElementById('wine-search').value = item.querySelector('.search-result-name').textContent;
  document.getElementById('wine-search-results').classList.remove('active');

  // Highlight selected
  document.querySelectorAll('.search-result-item').forEach(i => i.classList.remove('selected'));
  item.classList.add('selected');
}

/**
 * Handle bottle form submission.
 * @param {Event} e - Submit event
 */
async function handleBottleFormSubmit(e) {
  e.preventDefault();

  const mode = document.querySelector('.toggle-btn.active')?.dataset.mode || 'new';
  const quantity = parseInt(document.getElementById('bottle-quantity')?.value) || 1;

  try {
    let wineId;

    if (bottleModalMode === 'edit' || mode === 'new') {
      // Create or update wine
      const wineData = {
        wine_name: document.getElementById('wine-name').value.trim(),
        vintage: document.getElementById('wine-vintage').value || null,
        colour: document.getElementById('wine-colour').value,
        style: document.getElementById('wine-style').value.trim() || null,
        vivino_rating: document.getElementById('wine-rating').value || null,
        price_eur: document.getElementById('wine-price').value || null
      };

      if (!wineData.wine_name) {
        showToast('Wine name is required');
        return;
      }

      if (bottleModalMode === 'edit' && editingWineId) {
        // Update existing wine
        await updateWine(editingWineId, wineData);
        showToast('Wine updated');
        wineId = editingWineId;
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
    if (bottleModalMode === 'add') {
      const result = await addBottles(wineId, editingLocation, quantity);
      showToast(result.message);
    }

    closeBottleModal();
    await refreshData();

  } catch (err) {
    showToast('Error: ' + err.message);
  }
}

/**
 * Handle delete bottle button.
 */
async function handleDeleteBottle() {
  if (!editingLocation) return;

  if (!confirm(`Remove bottle from ${editingLocation}? This won't log it as consumed.`)) {
    return;
  }

  try {
    const result = await removeBottle(editingLocation);
    showToast(result.message);
    closeBottleModal();
    await refreshData();
  } catch (err) {
    showToast('Error: ' + err.message);
  }
}
