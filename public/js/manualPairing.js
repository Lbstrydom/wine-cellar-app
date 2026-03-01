/**
 * @fileoverview Manual wine-dish pairing UI.
 * Handles wine picker modal, manual pairing creation, and shared feedback modal opener.
 * Avoids circular dependency: both pairing.js and modals.js import from here.
 * @module manualPairing
 */

import { createManualPairing } from './api/pairing.js';
import { fetchWines } from './api/wines.js';
import { showToast, escapeHtml } from './utils.js';

/** @type {Function|null} Promise resolver for wine picker */
let resolveWinePick = null;

/** @type {Object[]|null} Cached wine list for picker */
let wineListCache = null;

// ============================================================
// Shared feedback modal opener (extracted to avoid circular dep)
// ============================================================

/**
 * Open the pairing feedback modal for a given session.
 * Operates on existing #pairing-feedback-modal DOM element
 * whose form handler is wired in sommelier.js initSommelier().
 * @param {number} sessionId - Pairing session ID
 * @param {number} wineId - Wine ID (for context)
 */
export function openPairingFeedbackModal(sessionId, wineId) {
  const modal = document.getElementById('pairing-feedback-modal');
  if (!modal) return;
  modal.style.display = 'flex';
  modal.dataset.sessionId = String(sessionId);
  modal.dataset.wineId = String(wineId);
}

// ============================================================
// Wine Picker Modal
// ============================================================

/**
 * Open wine picker modal and return the chosen wine (or null on cancel).
 * Uses a cached wine list to avoid repeated API calls within a session.
 * @returns {Promise<Object|null>} Selected wine object or null
 */
export async function pickWine() {
  const modal = document.getElementById('wine-picker-modal');
  if (!modal) return null;

  // Show modal
  modal.style.display = 'flex';
  const searchInput = document.getElementById('wine-picker-search');
  if (searchInput) {
    searchInput.value = '';
    searchInput.focus();
  }

  // Load wines if not cached
  if (!wineListCache) {
    try {
      const result = await fetchWines();
      wineListCache = Array.isArray(result) ? result : (result.data || []);
    } catch {
      showToast('Failed to load wines');
      modal.style.display = 'none';
      return null;
    }
  }

  renderWinePickerList(wineListCache, '');

  // Return a promise that resolves when user picks or cancels
  return new Promise((resolve) => {
    resolveWinePick = resolve;
  });
}

/**
 * Render filtered wine list in the picker.
 * @param {Object[]} wines - All wines
 * @param {string} filter - Search filter text
 */
function renderWinePickerList(wines, filter) {
  const list = document.getElementById('wine-picker-list');
  if (!list) return;

  const lowerFilter = filter.toLowerCase();
  const filtered = lowerFilter
    ? wines.filter(w =>
      (w.wine_name || '').toLowerCase().includes(lowerFilter) ||
        (w.vintage ? String(w.vintage) : '').includes(lowerFilter) ||
        (w.colour || '').toLowerCase().includes(lowerFilter) ||
        (w.style || '').toLowerCase().includes(lowerFilter)
    )
    : wines;

  if (filtered.length === 0) {
    list.innerHTML = '<p class="text-muted p-1">No wines match your search.</p>';
    return;
  }

  // Show up to 50 wines (performance)
  const shown = filtered.slice(0, 50);
  list.innerHTML = shown.map(w => `
    <div class="wine-picker-item" data-wine-id="${w.id}">
      <div class="wine-picker-name">${escapeHtml(w.wine_name)} ${w.vintage || 'NV'}</div>
      <div class="wine-picker-detail">${w.colour || ''} ${w.style ? '· ' + w.style : ''} ${w.bottle_count ? '(' + w.bottle_count + ')' : ''}</div>
    </div>
  `).join('');

  // Wire click handlers
  list.querySelectorAll('.wine-picker-item').forEach(el => {
    el.addEventListener('click', () => {
      const wineId = parseInt(el.dataset.wineId, 10);
      const wine = wines.find(w => w.id === wineId);
      closeWinePicker(wine || null);
    });
  });
}

/**
 * Close wine picker and resolve the promise.
 * @param {Object|null} selectedWine - Selected wine or null
 */
function closeWinePicker(selectedWine) {
  const modal = document.getElementById('wine-picker-modal');
  if (modal) modal.style.display = 'none';

  if (resolveWinePick) {
    resolveWinePick(selectedWine);
    resolveWinePick = null;
  }
}

// ============================================================
// Manual Pairing Flows
// ============================================================

/**
 * Handle "Start Pairing" from wine detail modal (wine → dish direction).
 * Called after user enters a dish description.
 * @param {number} wineId - Wine ID (captured before modal close)
 * @param {string} wineName - Wine name for toast message
 */
export async function handleManualPairFromWine(wineId, wineName) {
  const dishInput = document.getElementById('manual-pair-dish');
  const dish = dishInput?.value.trim();
  if (!dish) {
    showToast('Please describe a dish');
    return;
  }

  try {
    await createManualPairing(wineId, dish);
    // Hide the inline panel
    const panel = document.getElementById('manual-pair-panel');
    if (panel) panel.style.display = 'none';
    if (dishInput) dishInput.value = '';
    showToast(`Pairing "${wineName}" with "${dish}" — rate it after tasting!`);
  } catch (err) {
    showToast('Error: ' + (err instanceof Error ? err.message : 'Unknown error'));
  }
}

/**
 * Handle manual pair from recipe context (dish → wine direction).
 * Opens wine picker, then creates session.
 * @param {string} recipeName - Recipe/dish name
 * @param {number} recipeId - Recipe ID
 */
export async function manualPairFromRecipe(recipeName, recipeId) {
  const wine = await pickWine();
  if (!wine) return;

  try {
    await createManualPairing(wine.id, recipeName, recipeId);
    showToast(`Paired ${wine.wine_name} with ${recipeName} — rate after tasting!`);
  } catch (err) {
    showToast('Error: ' + (err instanceof Error ? err.message : 'Unknown error'));
  }
}

// ============================================================
// Initialisation
// ============================================================

/**
 * Initialise manual pairing event listeners.
 * Wires wine picker cancel button and search filter.
 */
export function initManualPairing() {
  // Wine picker cancel
  document.getElementById('wine-picker-cancel')?.addEventListener('click', () => {
    closeWinePicker(null);
  });

  // Wine picker search filter
  document.getElementById('wine-picker-search')?.addEventListener('input', (e) => {
    if (wineListCache) {
      renderWinePickerList(wineListCache, e.target.value);
    }
  });

  // Close wine picker on overlay click
  const modal = document.getElementById('wine-picker-modal');
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeWinePicker(null);
    });
  }
}
