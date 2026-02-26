/**
 * @fileoverview Single recipe detail view with pairing results.
 * @module recipes/recipeDetail
 */

import { getRecipe, getRecipePairing } from '../api/recipes.js';
import { escapeHtml } from '../utils.js';

/**
 * Render a single recipe detail view.
 * @param {HTMLElement} container - Container element
 * @param {number} recipeId - Recipe ID
 * @param {Function} onBack - Callback to go back to library
 */
export async function renderRecipeDetail(container, recipeId, onBack) {
  container.innerHTML = '<div class="loading-spinner">Loading recipe...</div>';

  try {
    const result = await getRecipe(recipeId);
    const recipe = result.data;

    if (!recipe) {
      container.innerHTML = '<p class="no-data">Recipe not found</p>';
      return;
    }

    const categories = safeParseCategories(recipe.categories);
    const catHtml = categories.map(c => `<span class="recipe-tag">${escapeHtml(c)}</span>`).join(' ');

    const ratingHtml = recipe.rating > 0
      ? `<span class="recipe-rating-large">${'\u2605'.repeat(recipe.rating)}${'\u2606'.repeat(5 - recipe.rating)}</span>`
      : '<span class="recipe-rating-large unrated">Not rated</span>';

    container.innerHTML = `
      <div class="recipe-detail">
        <div class="recipe-detail-header">
          <button class="btn btn-small btn-secondary recipe-back-btn">Back</button>
          <h2>${escapeHtml(recipe.name)}</h2>
          ${ratingHtml}
        </div>

        <div class="recipe-detail-meta">
          ${recipe.prep_time ? `<span>Prep: ${escapeHtml(recipe.prep_time)}</span>` : ''}
          ${recipe.cook_time ? `<span>Cook: ${escapeHtml(recipe.cook_time)}</span>` : ''}
          ${recipe.total_time ? `<span>Total: ${escapeHtml(recipe.total_time)}</span>` : ''}
          ${recipe.servings ? `<span>Serves: ${escapeHtml(recipe.servings)}</span>` : ''}
        </div>

        ${catHtml ? `<div class="recipe-detail-tags">${catHtml}</div>` : ''}

        ${recipe.ingredients ? `
          <div class="recipe-section">
            <h3>Ingredients</h3>
            <div class="recipe-ingredients">${formatIngredients(recipe.ingredients)}</div>
          </div>
        ` : ''}

        ${recipe.directions ? `
          <div class="recipe-section">
            <h3>Directions</h3>
            <div class="recipe-directions">${formatDirections(recipe.directions)}</div>
          </div>
        ` : ''}

        ${recipe.notes ? `
          <div class="recipe-section">
            <h3>Notes</h3>
            <p>${escapeHtml(recipe.notes)}</p>
          </div>
        ` : ''}

        ${recipe.source_url ? `
          <div class="recipe-section">
            <a href="${escapeHtml(recipe.source_url)}" target="_blank" rel="noopener">Original recipe</a>
          </div>
        ` : ''}

        <div class="recipe-section recipe-pairing-section">
          <h3>Wine Pairing</h3>
          <p class="recipe-pairing-hint">Find the best wine from your cellar for this recipe.</p>
          <button class="btn btn-primary recipe-pair-btn">Find Wine Pairing</button>
          <div class="recipe-pairing-results" id="recipe-pairing-results"></div>
        </div>

        <div class="recipe-section">
          <p class="recipe-meta-small">Source: ${escapeHtml(recipe.source_provider || 'manual')}
          ${recipe.source ? ` | ${escapeHtml(recipe.source)}` : ''}</p>
        </div>
      </div>
    `;

    container.querySelector('.recipe-back-btn')?.addEventListener('click', onBack);

    // Wire up pairing button
    container.querySelector('.recipe-pair-btn')?.addEventListener('click', () => {
      loadPairingResults(container.querySelector('#recipe-pairing-results'), recipe.id);
    });

  } catch (err) {
    container.innerHTML = `<p class="no-data">Error: ${escapeHtml(err.message)}</p>`;
  }
}

/**
 * Load and render pairing results for a recipe.
 * @param {HTMLElement} container - Results container
 * @param {number} recipeId - Recipe ID
 */
async function loadPairingResults(container, recipeId) {
  if (!container) return;

  container.innerHTML = '<div class="loading-spinner">Finding pairings...</div>';

  try {
    const result = await getRecipePairing(recipeId);

    if (!result.shortlist || result.shortlist.length === 0) {
      container.innerHTML = '<p class="no-data">No pairing suggestions found. Add more wines to your cellar.</p>';
      return;
    }

    const signalsHtml = (result.signals || []).length > 0
      ? `<div class="pairing-signals">Detected: ${result.signals.map(s => `<span class="recipe-tag">${escapeHtml(s)}</span>`).join(' ')}</div>`
      : '';

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

    container.innerHTML = signalsHtml + '<div class="pairing-wine-list">' + winesHtml + '</div>';

  } catch (err) {
    container.innerHTML = `<p class="no-data">Error: ${escapeHtml(err.message)}</p>`;
  }
}

/**
 * Format ingredients as a list.
 * @param {string} ingredients - Newline-delimited ingredients
 * @returns {string} HTML
 */
function formatIngredients(ingredients) {
  const lines = ingredients.split('\n').filter(l => l.trim());
  return '<ul class="ingredient-list">' +
    lines.map(l => `<li>${escapeHtml(l.trim())}</li>`).join('') +
    '</ul>';
}

/**
 * Format directions as numbered steps.
 * @param {string} directions - Newline-delimited directions
 * @returns {string} HTML
 */
function formatDirections(directions) {
  const lines = directions.split('\n').filter(l => l.trim());
  return '<ol class="direction-list">' +
    lines.map(l => `<li>${escapeHtml(l.trim())}</li>`).join('') +
    '</ol>';
}

/**
 * Safely parse categories.
 * @param {string|string[]} cats - Categories
 * @returns {string[]}
 */
function safeParseCategories(cats) {
  if (Array.isArray(cats)) return cats;
  if (typeof cats === 'string') {
    try { return JSON.parse(cats); } catch { return []; }
  }
  return [];
}
