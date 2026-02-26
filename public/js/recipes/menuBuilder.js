/**
 * @fileoverview Multi-recipe pairing wizard.
 * Select recipes -> review combined signals -> get group pairing.
 * @module recipes/menuBuilder
 */

import { getMenuPairing } from '../api/recipes.js';
import { menuState, clearMenu, loadMenuState, persistMenuState } from './menuState.js';
import { escapeHtml } from '../utils.js';

/**
 * Render the menu builder panel.
 * Shows selected recipes and pairing results.
 * @param {HTMLElement} container - Parent element
 * @param {Function} onClose - Callback to close/hide the builder
 */
export function renderMenuBuilder(container, onClose) {
  if (!container) return;

  loadMenuState();

  const selectedHtml = menuState.selectedRecipes.length > 0
    ? menuState.selectedRecipes.map(r => `
        <div class="menu-recipe-chip" data-id="${r.id}">
          <span>${escapeHtml(r.name)}</span>
          <button class="menu-chip-remove" data-id="${r.id}" title="Remove">&times;</button>
        </div>
      `).join('')
    : '<p class="menu-empty">Select recipes from the library to build a menu for pairing.</p>';

  container.innerHTML = `
    <div class="menu-builder-panel">
      <div class="menu-builder-header">
        <h3>Menu Builder</h3>
        <div class="menu-builder-actions">
          <button class="btn btn-small btn-secondary menu-clear-btn" ${menuState.selectedIds.length === 0 ? 'disabled' : ''}>Clear All</button>
          <button class="btn btn-small btn-secondary menu-close-btn">Close</button>
        </div>
      </div>
      <p class="menu-hint">Select recipes to pair as a meal. The engine combines signals from all dishes to find the best wines.</p>
      <div class="menu-selected-recipes">${selectedHtml}</div>
      <div class="menu-pair-section">
        <button class="btn btn-primary menu-pair-btn" ${menuState.selectedIds.length === 0 ? 'disabled' : ''}>
          Find Wines for ${menuState.selectedIds.length} Dish${menuState.selectedIds.length !== 1 ? 'es' : ''}
        </button>
        <div class="menu-colour-filter">
          <label>Filter:
            <select class="menu-colour-select">
              <option value="">Any colour</option>
              <option value="red">Red</option>
              <option value="white">White</option>
              <option value="rose">Ros\u00e9</option>
              <option value="sparkling">Sparkling</option>
            </select>
          </label>
        </div>
      </div>
      <div class="menu-pairing-results" id="menu-pairing-results"></div>
    </div>
  `;

  // Wire up remove chips
  container.querySelectorAll('.menu-chip-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = Number(btn.dataset.id);
      const idx = menuState.selectedIds.indexOf(id);
      if (idx >= 0) {
        menuState.selectedIds.splice(idx, 1);
        menuState.selectedRecipes.splice(idx, 1);
        persistMenuState();
      }
      renderMenuBuilder(container, onClose);
    });
  });

  // Wire up clear
  container.querySelector('.menu-clear-btn')?.addEventListener('click', () => {
    clearMenu();
    renderMenuBuilder(container, onClose);
  });

  // Wire up close
  container.querySelector('.menu-close-btn')?.addEventListener('click', () => {
    if (onClose) onClose();
  });

  // Wire up pair button
  container.querySelector('.menu-pair-btn')?.addEventListener('click', async () => {
    const colour = container.querySelector('.menu-colour-select')?.value || undefined;
    await loadMenuPairingResults(
      container.querySelector('#menu-pairing-results'),
      menuState.selectedIds,
      colour
    );
  });
}

/**
 * Load and render menu pairing results.
 * @param {HTMLElement} container - Results container
 * @param {number[]} recipeIds - Recipe IDs
 * @param {string} [colour] - Optional colour filter
 */
async function loadMenuPairingResults(container, recipeIds, colour) {
  if (!container) return;

  container.innerHTML = '<div class="loading-spinner">Finding best wines for your menu...</div>';

  try {
    const result = await getMenuPairing(recipeIds, colour ? { colour } : {});

    if (!result.shortlist || result.shortlist.length === 0) {
      container.innerHTML = '<p class="no-data">No wines match this menu. Try a different combination or add more wines to your cellar.</p>';
      return;
    }

    // Show combined signals
    const signalsHtml = (result.combinedSignals || []).length > 0
      ? `<div class="pairing-signals menu-signals">
           <strong>Combined signals:</strong>
           ${result.combinedSignals.map(s => `<span class="recipe-tag">${escapeHtml(s)}</span>`).join(' ')}
         </div>`
      : '';

    // Show per-recipe signals
    const recipeSignalsHtml = (result.recipes || []).map(r =>
      `<div class="menu-recipe-signals">
        <span class="menu-recipe-name">${escapeHtml(r.name)}:</span>
        ${r.signals.map(s => `<span class="recipe-tag recipe-tag-small">${escapeHtml(s)}</span>`).join(' ')}
      </div>`
    ).join('');

    // Show wine results
    const winesHtml = result.shortlist.map(w => `
      <div class="pairing-wine-card">
        <div class="pairing-wine-name">${escapeHtml(w.wine_name)} ${w.vintage ? escapeHtml(String(w.vintage)) : ''}</div>
        <div class="pairing-wine-meta">
          ${w.colour ? `<span class="recipe-tag">${escapeHtml(w.colour)}</span>` : ''}
          ${w.style ? `<span class="recipe-tag">${escapeHtml(w.style)}</span>` : ''}
          ${w.pairingScore ? `<span class="pairing-score">Score: ${w.pairingScore}</span>` : ''}
        </div>
        ${w.matchReasons?.length ? `<p class="pairing-reasons">${w.matchReasons.map(r => escapeHtml(r)).join(', ')}</p>` : ''}
        <p class="pairing-wine-location">${w.bottle_count} bottle${w.bottle_count !== 1 ? 's' : ''}${w.in_fridge ? ' (in fridge)' : ''}</p>
      </div>
    `).join('');

    container.innerHTML = `
      ${signalsHtml}
      <div class="menu-recipe-signal-breakdown">${recipeSignalsHtml}</div>
      <div class="pairing-wine-list">${winesHtml}</div>
    `;

  } catch (err) {
    container.innerHTML = `<p class="no-data">Error: ${escapeHtml(err.message)}</p>`;
  }
}
