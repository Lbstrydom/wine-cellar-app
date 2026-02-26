/**
 * @fileoverview Inline profile summary card for Recipe Library.
 * Shows dominant signals, top categories, and wine style demand bar.
 * Rendered at the top of the library when >= 5 recipes.
 * @module recipes/profileSummary
 */

import { getCookingProfile, refreshCookingProfile } from '../api/recipes.js';
import { escapeHtml } from '../utils.js';

/** Style display names */
const STYLE_LABELS = {
  white_crisp: 'Crisp White',
  white_medium: 'Medium White',
  white_oaked: 'Oaked White',
  white_aromatic: 'Aromatic White',
  rose_dry: 'Dry Ros\u00e9',
  red_light: 'Light Red',
  red_medium: 'Medium Red',
  red_full: 'Full Red',
  sparkling_dry: 'Sparkling',
  sparkling_rose: 'Sparkling Ros\u00e9',
  dessert: 'Dessert'
};

/** Colour classes for style bars */
const STYLE_COLOURS = {
  white_crisp: 'style-bar-white',
  white_medium: 'style-bar-white',
  white_oaked: 'style-bar-white',
  white_aromatic: 'style-bar-white',
  rose_dry: 'style-bar-rose',
  red_light: 'style-bar-red-light',
  red_medium: 'style-bar-red',
  red_full: 'style-bar-red-full',
  sparkling_dry: 'style-bar-sparkling',
  sparkling_rose: 'style-bar-sparkling',
  dessert: 'style-bar-dessert'
};

/**
 * Render the cooking profile summary card.
 * @param {HTMLElement} container - Parent element
 * @param {Object} [options] - Options
 * @param {Function} [options.onOverridesClick] - Callback to open category overrides
 */
export async function renderProfileSummary(container, options = {}) {
  if (!container) return;

  container.innerHTML = '<div class="profile-loading">Loading cooking profile...</div>';

  try {
    const result = await getCookingProfile();
    const profile = result.data;

    if (!profile || profile.recipeCount === 0) {
      container.innerHTML = '';
      return;
    }

    if (profile.recipeCount < 5) {
      container.innerHTML = `
        <div class="profile-summary profile-summary-minimal">
          <p class="profile-hint">Add at least 5 recipes to see your cooking profile and wine style recommendations.</p>
        </div>
      `;
      return;
    }

    const topSignals = (profile.dominantSignals || []).slice(0, 8);
    const topCategories = Object.entries(profile.categoryBreakdown || {})
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 5);

    // Build style demand bars (top 6 styles)
    const sortedStyles = Object.entries(profile.wineStyleDemand || {})
      .filter(([, pct]) => pct > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);

    const maxPct = sortedStyles.length > 0 ? sortedStyles[0][1] : 1;

    const signalsHtml = topSignals.map(s =>
      `<span class="profile-signal-tag" title="Weight: ${s.weight}">${escapeHtml(s.signal)}</span>`
    ).join('');

    const categoriesHtml = topCategories.map(([cat, data]) => {
      const count = data.count;
      const override = data.userOverride;
      const suffix = override !== null ? ' (adjusted)' : '';
      return `<span class="profile-category-tag">${escapeHtml(cat)} <small>(${count})${suffix}</small></span>`;
    }).join('');

    const styleBarHtml = sortedStyles.map(([styleId, pct]) => {
      const label = STYLE_LABELS[styleId] || styleId;
      const colourClass = STYLE_COLOURS[styleId] || 'style-bar-default';
      const barWidth = Math.max(5, Math.round((pct / maxPct) * 100));
      const pctDisplay = Math.round(pct * 100);
      return `
        <div class="style-demand-row">
          <span class="style-demand-label">${escapeHtml(label)}</span>
          <div class="style-demand-bar-track">
            <div class="style-demand-bar ${colourClass}" style="width: ${barWidth}%"></div>
          </div>
          <span class="style-demand-pct">${pctDisplay}%</span>
        </div>
      `;
    }).join('');

    const seasonLabel = profile.seasonalBias
      ? profile.seasonalBias.charAt(0).toUpperCase() + profile.seasonalBias.slice(1)
      : '';

    container.innerHTML = `
      <div class="profile-summary">
        <div class="profile-summary-header">
          <h3>Your Cooking Profile</h3>
          <div class="profile-summary-actions">
            ${seasonLabel ? `<span class="profile-season-badge">${escapeHtml(seasonLabel)}</span>` : ''}
            <button class="btn btn-small btn-secondary profile-refresh-btn" title="Refresh profile">Refresh</button>
          </div>
        </div>
        <p class="profile-recipe-count">Based on ${profile.recipeCount} recipe${profile.recipeCount !== 1 ? 's' : ''} (${profile.ratedRecipeCount} rated)</p>

        <div class="profile-columns">
          <div class="profile-col">
            <h4>Top Flavour Signals</h4>
            <div class="profile-signals">${signalsHtml}</div>
            <h4>Top Categories</h4>
            <div class="profile-categories">
              ${categoriesHtml}
              ${options.onOverridesClick ? '<button class="btn-link profile-adjust-btn">Adjust frequencies</button>' : ''}
            </div>
          </div>
          <div class="profile-col">
            <h4>Wine Style Demand</h4>
            <div class="style-demand-bars">${styleBarHtml}</div>
          </div>
        </div>
      </div>
    `;

    // Wire up refresh button
    container.querySelector('.profile-refresh-btn')?.addEventListener('click', async (btn) => {
      const refreshBtn = container.querySelector('.profile-refresh-btn');
      if (refreshBtn) {
        refreshBtn.disabled = true;
        refreshBtn.textContent = 'Refreshing...';
      }
      try {
        await refreshCookingProfile();
        await renderProfileSummary(container, options);
      } catch (err) {
        if (refreshBtn) {
          refreshBtn.disabled = false;
          refreshBtn.textContent = 'Refresh';
        }
      }
    });

    // Wire up adjust frequencies button
    if (options.onOverridesClick) {
      container.querySelector('.profile-adjust-btn')?.addEventListener('click', options.onOverridesClick);
    }

  } catch (err) {
    container.innerHTML = '';
  }
}
