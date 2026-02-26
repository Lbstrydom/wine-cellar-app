/**
 * @fileoverview Manual recipe entry/edit form.
 * @module recipes/recipeForm
 */

import { createRecipe, updateRecipe } from '../api/recipes.js';
import { showToast, escapeHtml } from '../utils.js';

/**
 * Show the recipe form modal for creating or editing a recipe.
 * @param {Object|null} recipe - Existing recipe to edit, or null for new
 * @param {Function} onSaved - Callback after successful save
 */
export function showRecipeForm(recipe, onSaved) {
  const isEdit = recipe !== null;
  const categories = recipe?.categories
    ? (Array.isArray(recipe.categories)
        ? recipe.categories.join(', ')
        : safeParseCategories(recipe.categories).join(', '))
    : '';

  // Create overlay
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay active';
  overlay.id = 'recipe-form-overlay';

  overlay.innerHTML = `
    <div class="modal recipe-form-modal">
      <div class="modal-header">
        <h2>${isEdit ? 'Edit Recipe' : 'Add Recipe'}</h2>
        <button class="modal-close" id="recipe-form-close">&times;</button>
      </div>
      <form id="recipe-form-inner" class="recipe-form">
        <div class="form-row">
          <div class="form-field">
            <label for="rf-name">Recipe Name *</label>
            <input type="text" id="rf-name" required value="${escapeHtml(recipe?.name || '')}" />
          </div>
        </div>
        <div class="form-row">
          <div class="form-field">
            <label for="rf-categories">Categories (comma-separated)</label>
            <input type="text" id="rf-categories" placeholder="e.g., Chicken, Asian, Quick" value="${escapeHtml(categories)}" />
          </div>
          <div class="form-field">
            <label for="rf-rating">Rating</label>
            <select id="rf-rating">
              <option value="0" ${(!recipe?.rating) ? 'selected' : ''}>Unrated</option>
              <option value="5" ${recipe?.rating === 5 ? 'selected' : ''}>${'\u2605'.repeat(5)}</option>
              <option value="4" ${recipe?.rating === 4 ? 'selected' : ''}>${'\u2605'.repeat(4)}${'\u2606'}</option>
              <option value="3" ${recipe?.rating === 3 ? 'selected' : ''}>${'\u2605'.repeat(3)}${'\u2606'.repeat(2)}</option>
              <option value="2" ${recipe?.rating === 2 ? 'selected' : ''}>${'\u2605'.repeat(2)}${'\u2606'.repeat(3)}</option>
              <option value="1" ${recipe?.rating === 1 ? 'selected' : ''}>${'\u2605'}${'\u2606'.repeat(4)}</option>
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-field">
            <label for="rf-ingredients">Ingredients (one per line)</label>
            <textarea id="rf-ingredients" rows="6" placeholder="1 cup flour&#10;2 eggs&#10;...">${escapeHtml(recipe?.ingredients || '')}</textarea>
          </div>
        </div>
        <div class="form-row">
          <div class="form-field">
            <label for="rf-directions">Directions (one step per line)</label>
            <textarea id="rf-directions" rows="6" placeholder="Preheat oven to 180\u00B0C&#10;Mix dry ingredients...">${escapeHtml(recipe?.directions || '')}</textarea>
          </div>
        </div>
        <div class="form-row">
          <div class="form-field">
            <label for="rf-prep-time">Prep Time</label>
            <input type="text" id="rf-prep-time" placeholder="15 min" value="${escapeHtml(recipe?.prep_time || '')}" />
          </div>
          <div class="form-field">
            <label for="rf-cook-time">Cook Time</label>
            <input type="text" id="rf-cook-time" placeholder="30 min" value="${escapeHtml(recipe?.cook_time || '')}" />
          </div>
          <div class="form-field">
            <label for="rf-servings">Servings</label>
            <input type="text" id="rf-servings" placeholder="4" value="${escapeHtml(recipe?.servings || '')}" />
          </div>
        </div>
        <div class="form-row">
          <div class="form-field">
            <label for="rf-notes">Notes</label>
            <textarea id="rf-notes" rows="3">${escapeHtml(recipe?.notes || '')}</textarea>
          </div>
        </div>
        <div class="modal-actions">
          <button type="submit" class="btn btn-primary">${isEdit ? 'Save Changes' : 'Add Recipe'}</button>
          <button type="button" class="btn btn-secondary" id="recipe-form-cancel">Cancel</button>
        </div>
      </form>
    </div>
  `;

  document.body.appendChild(overlay);

  // Close handlers
  const close = () => overlay.remove();
  overlay.querySelector('#recipe-form-close')?.addEventListener('click', close);
  overlay.querySelector('#recipe-form-cancel')?.addEventListener('click', close);

  // Submit handler
  overlay.querySelector('#recipe-form-inner')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const data = {
      name: document.getElementById('rf-name').value.trim(),
      categories: document.getElementById('rf-categories').value
        .split(',').map(c => c.trim()).filter(Boolean),
      rating: Number(document.getElementById('rf-rating').value) || 0,
      ingredients: document.getElementById('rf-ingredients').value.trim() || null,
      directions: document.getElementById('rf-directions').value.trim() || null,
      prep_time: document.getElementById('rf-prep-time').value.trim() || null,
      cook_time: document.getElementById('rf-cook-time').value.trim() || null,
      servings: document.getElementById('rf-servings').value.trim() || null,
      notes: document.getElementById('rf-notes').value.trim() || null
    };

    if (!data.name) {
      showToast('Recipe name is required');
      return;
    }

    try {
      if (isEdit) {
        await updateRecipe(recipe.id, data);
        showToast('Recipe updated');
      } else {
        await createRecipe(data);
        showToast('Recipe added');
      }
      close();
      if (onSaved) onSaved();
    } catch (err) {
      showToast('Error: ' + err.message);
    }
  });
}

/**
 * Safely parse categories.
 * @param {string} cats
 * @returns {string[]}
 */
function safeParseCategories(cats) {
  try { return JSON.parse(cats); } catch { return []; }
}
