/**
 * @fileoverview Inline profile summary card for Recipe Library.
 * Shows dominant signals, top categories, and wine style demand bar.
 * Rendered at the top of the library when >= 5 recipes.
 * @module recipes/profileSummary
 */

import { getCookingProfile, refreshCookingProfile } from '../api/recipes.js';
import { updateSetting } from '../api/settings.js';
import { escapeHtml } from '../utils.js';

/** Season options */
const SEASONS = [
  { value: 'summer', label: 'Summer' },
  { value: 'autumn', label: 'Autumn' },
  { value: 'winter', label: 'Winter' },
  { value: 'spring', label: 'Spring' }
];

/** Climate zone options with descriptions */
const CLIMATE_ZONES = [
  { value: 'hot',  label: 'Hot',  hint: 'Mediterranean, tropical' },
  { value: 'warm', label: 'Warm', hint: 'Temperate, standard' },
  { value: 'mild', label: 'Mild', hint: 'Maritime, cool oceanic' },
  { value: 'cold', label: 'Cold', hint: 'Continental, harsh winters' }
];

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

    const docFrequency = profile.signalDocFrequency || {};
    const signalsHtml = topSignals.map(s => {
      const df = docFrequency[s.signal];
      const freqHint = df ? ` · in ${Math.round(df / profile.recipeCount * 100)}% of recipes` : '';
      return `<span class="profile-signal-tag" title="Weight: ${s.weight}${freqHint}">${escapeHtml(s.signal)}</span>`;
    }).join('');

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

    const currentSeason = profile.seasonalBias || 'winter';
    const currentClimate = profile.climateZone || 'warm';

    const seasonOptionsHtml = SEASONS.map(s =>
      `<option value="${s.value}" ${s.value === currentSeason ? 'selected' : ''}>${escapeHtml(s.label)}</option>`
    ).join('');

    const climateOptionsHtml = CLIMATE_ZONES.map(z =>
      `<option value="${z.value}" title="${escapeHtml(z.hint)}" ${z.value === currentClimate ? 'selected' : ''}>${escapeHtml(z.label)} — ${escapeHtml(z.hint)}</option>`
    ).join('');

    container.innerHTML = `
      <div class="profile-summary">
        <div class="profile-summary-header">
          <h3>Your Cooking Profile</h3>
          <div class="profile-summary-actions">
            <label class="profile-select-group">
              <span class="profile-select-label">Season</span>
              <select class="profile-select profile-season-select">${seasonOptionsHtml}</select>
            </label>
            <label class="profile-select-group">
              <span class="profile-select-label">Climate</span>
              <select class="profile-select profile-climate-select">${climateOptionsHtml}</select>
            </label>
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
              ${options.onOverridesClick ? '<button class="btn btn-small btn-secondary profile-adjust-btn">Adjust frequencies</button>' : ''}
            </div>
          </div>
          <div class="profile-col">
            <h4>Wine Style Demand</h4>
            <div class="style-demand-bars">${styleBarHtml}</div>
          </div>
        </div>
      </div>
    `;

    // Wire up season/climate dropdowns — save + refresh on change
    const refreshProfile = async () => {
      const refreshBtn = container.querySelector('.profile-refresh-btn');
      if (refreshBtn) {
        refreshBtn.disabled = true;
        refreshBtn.textContent = 'Refreshing...';
      }
      try {
        await refreshCookingProfile();
        await renderProfileSummary(container, options);
      } catch {
        if (refreshBtn) {
          refreshBtn.disabled = false;
          refreshBtn.textContent = 'Refresh';
        }
      }
    };

    container.querySelector('.profile-season-select')?.addEventListener('change', async (e) => {
      await updateSetting('profile_season', e.target.value);
      await refreshProfile();
    });

    container.querySelector('.profile-climate-select')?.addEventListener('change', async (e) => {
      await updateSetting('climate_zone', e.target.value);
      await refreshProfile();
    });

    // Wire up refresh button
    container.querySelector('.profile-refresh-btn')?.addEventListener('click', refreshProfile);

    // Wire up adjust frequencies button
    if (options.onOverridesClick) {
      container.querySelector('.profile-adjust-btn')?.addEventListener('click', options.onOverridesClick);
    }

    // Auto-detect hemisphere on first load (save if not yet set)
    autoDetectHemisphere(profile.hemisphere);

  } catch (err) {
    container.innerHTML = '';
  }
}

/** Southern hemisphere timezone prefixes */
const SOUTHERN_TZ = [
  'Australia/', 'Antarctica/', 'Pacific/Auckland', 'Pacific/Fiji',
  'Africa/Johannesburg', 'Africa/Harare', 'Africa/Maputo',
  'America/Buenos_Aires', 'America/Sao_Paulo', 'America/Santiago',
  'America/Lima', 'America/Bogota'
];

let hemisphereDetected = false;

/**
 * Auto-detect hemisphere from browser timezone and save if not yet set.
 * Only runs once per session to avoid repeated API calls.
 * @param {string} currentHemisphere - Current profile hemisphere
 */
async function autoDetectHemisphere(currentHemisphere) {
  if (hemisphereDetected) return;
  hemisphereDetected = true;

  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    const isSouthern = SOUTHERN_TZ.some(prefix => tz.startsWith(prefix));
    const detected = isSouthern ? 'southern' : 'northern';

    // Only save if different from current (avoids unnecessary API call)
    if (detected !== currentHemisphere) {
      await updateSetting('hemisphere', detected);
    }
  } catch {
    // Timezone detection not available — keep server default
  }
}
