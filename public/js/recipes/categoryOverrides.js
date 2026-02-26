/**
 * @fileoverview Expandable category frequency override panel.
 * Auto-computed frequencies with slider overrides.
 * Only shown on user request from profile summary.
 * @module recipes/categoryOverrides
 */

import { getRecipeCategories, saveCategoryOverrides } from '../api/recipes.js';
import { showToast, escapeHtml } from '../utils.js';

/** Frequency labels for display */
const FREQ_LABELS = ['Never', 'Rarely', 'Sometimes', 'Often', 'Very Often', 'Always'];

/**
 * Render the category overrides panel.
 * @param {HTMLElement} container - Parent element
 * @param {Object} currentOverrides - Current override map from profile
 * @param {Function} onSaved - Callback when overrides are saved
 */
export async function renderCategoryOverrides(container, currentOverrides = {}, onSaved) {
  if (!container) return;

  container.innerHTML = '<div class="loading-spinner">Loading categories...</div>';

  try {
    const result = await getRecipeCategories();
    const categories = result.data || [];

    if (categories.length === 0) {
      container.innerHTML = '<p class="no-data">No categories found. Import some recipes first.</p>';
      return;
    }

    // Show top 20 categories by count
    const topCategories = categories.slice(0, 20);

    const rowsHtml = topCategories.map(cat => {
      const hasOverride = currentOverrides[cat.category] !== undefined;
      const value = hasOverride ? currentOverrides[cat.category] : frequencyFromCount(cat.count, categories);
      const label = FREQ_LABELS[Math.min(value, FREQ_LABELS.length - 1)] || FREQ_LABELS[0];

      return `
        <div class="override-row" data-category="${escapeHtml(cat.category)}">
          <span class="override-category">${escapeHtml(cat.category)} <small>(${cat.count})</small></span>
          <input type="range" class="override-slider" min="0" max="5" step="1"
                 value="${value}" data-category="${escapeHtml(cat.category)}" />
          <span class="override-label">${escapeHtml(label)}</span>
          ${hasOverride ? '<button class="btn-link override-reset" title="Reset to auto">Reset</button>' : ''}
        </div>
      `;
    }).join('');

    container.innerHTML = `
      <div class="category-overrides-panel">
        <div class="overrides-header">
          <h4>Adjust Category Frequencies</h4>
          <p class="overrides-hint">Sliders adjust how much each category influences your wine recommendations. Reset to use auto-computed values.</p>
        </div>
        <div class="overrides-rows">${rowsHtml}</div>
        <div class="overrides-actions">
          <button class="btn btn-primary overrides-save-btn">Save Overrides</button>
          <button class="btn btn-secondary overrides-cancel-btn">Cancel</button>
        </div>
      </div>
    `;

    // Wire up sliders
    container.querySelectorAll('.override-slider').forEach(slider => {
      slider.addEventListener('input', () => {
        const row = slider.closest('.override-row');
        const label = row?.querySelector('.override-label');
        if (label) {
          label.textContent = FREQ_LABELS[Number(slider.value)] || '';
        }
      });
    });

    // Wire up reset buttons
    container.querySelectorAll('.override-reset').forEach(btn => {
      btn.addEventListener('click', () => {
        const row = btn.closest('.override-row');
        const category = row?.dataset.category;
        const slider = row?.querySelector('.override-slider');
        if (category && slider) {
          const catData = categories.find(c => c.category === category);
          const autoValue = catData ? frequencyFromCount(catData.count, categories) : 3;
          slider.value = autoValue;
          const label = row.querySelector('.override-label');
          if (label) label.textContent = FREQ_LABELS[autoValue] || '';
          btn.remove();
        }
      });
    });

    // Wire up save
    container.querySelector('.overrides-save-btn')?.addEventListener('click', async () => {
      const overrides = {};
      container.querySelectorAll('.override-slider').forEach(slider => {
        const cat = slider.dataset.category;
        const val = Number(slider.value);
        const catData = categories.find(c => c.category === cat);
        const autoValue = catData ? frequencyFromCount(catData.count, categories) : 3;
        // Only save if different from auto-computed
        if (val !== autoValue) {
          overrides[cat] = val;
        }
      });

      try {
        await saveCategoryOverrides(overrides);
        showToast('Category overrides saved');
        if (onSaved) onSaved();
      } catch (err) {
        showToast('Error saving overrides: ' + err.message);
      }
    });

    // Wire up cancel
    container.querySelector('.overrides-cancel-btn')?.addEventListener('click', () => {
      container.innerHTML = '';
      container.style.display = 'none';
    });

  } catch (err) {
    container.innerHTML = `<p class="no-data">Error: ${escapeHtml(err.message)}</p>`;
  }
}

/**
 * Convert a recipe count to a 0-5 frequency scale.
 * Uses quartile-based mapping relative to category distribution.
 * @param {number} count - Recipe count for this category
 * @param {Array} allCategories - All categories with counts
 * @returns {number} 0-5 frequency
 */
function frequencyFromCount(count, allCategories) {
  if (count === 0) return 0;
  const counts = allCategories.map(c => c.count).sort((a, b) => a - b);
  const max = counts[counts.length - 1] || 1;
  const pct = count / max;
  if (pct >= 0.8) return 5;
  if (pct >= 0.6) return 4;
  if (pct >= 0.4) return 3;
  if (pct >= 0.2) return 2;
  return 1;
}
