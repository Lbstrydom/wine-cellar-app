/**
 * @fileoverview Sommelier (Claude pairing) UI.
 * @module sommelier
 */

import { askSommelier, getPairingSuggestions } from './api.js';
import { showToast } from './utils.js';
import { showWineModalFromList } from './modals.js';

const selectedSignals = new Set();

/**
 * Handle Ask Sommelier button click.
 */
export async function handleAskSommelier() {
  const dishInput = document.getElementById('dish-input');
  const dish = dishInput.value.trim();

  if (!dish) {
    showToast('Please describe a dish');
    return;
  }

  const source = document.querySelector('input[name="source"]:checked').value;
  const colour = document.querySelector('input[name="colour"]:checked').value;

  const btn = document.getElementById('ask-sommelier');
  const resultsContainer = document.getElementById('sommelier-results');

  btn.disabled = true;
  btn.innerHTML = '<span class="loading-spinner"></span> Thinking...';
  resultsContainer.innerHTML = '<div class="sommelier-response"><p style="color: var(--text-muted);">The sommelier is considering your dish...</p></div>';

  try {
    const data = await askSommelier(dish, source, colour);
    renderSommelierResponse(data);
  } catch (err) {
    resultsContainer.innerHTML = `
      <div class="sommelier-response">
        <p style="color: var(--priority-1);">Error: ${err.message}</p>
      </div>
    `;
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Ask Sommelier';
  }
}

/**
 * Render sommelier response.
 * @param {Object} data - Sommelier response data
 */
function renderSommelierResponse(data) {
  const container = document.getElementById('sommelier-results');

  let html = '<div class="sommelier-response">';

  if (data.dish_analysis) {
    html += `<div class="dish-analysis">${data.dish_analysis}</div>`;
  }

  if (data.colour_suggestion) {
    html += `<div class="colour-suggestion">${data.colour_suggestion}</div>`;
  }

  if (!data.recommendations || data.recommendations.length === 0) {
    html += `<div class="no-match"><p>No suitable wines found.</p></div>`;
  } else {
    data.recommendations.forEach(rec => {
      const priorityClass = rec.is_priority ? 'priority' : '';
      const clickableClass = rec.wine_id ? 'clickable' : '';

      html += `
        <div class="recommendation ${priorityClass} ${clickableClass}" data-wine-id="${rec.wine_id || ''}" data-wine-name="${rec.wine_name}" data-vintage="${rec.vintage || ''}" data-style="${rec.style || ''}" data-colour="${rec.colour || ''}" data-locations="${rec.location}" data-bottle-count="${rec.bottle_count}">
          <div class="recommendation-header">
            <h4>#${rec.rank} ${rec.wine_name} ${rec.vintage || 'NV'}</h4>
            ${rec.is_priority ? '<span class="priority-badge">Drink Soon</span>' : ''}
          </div>
          <div class="location">${rec.location} (${rec.bottle_count} bottle${rec.bottle_count !== 1 ? 's' : ''})</div>
          <p class="why">${rec.why}</p>
          ${rec.food_tip ? `<div class="food-tip">${rec.food_tip}</div>` : ''}
        </div>
      `;
    });
  }

  html += '</div>';
  container.innerHTML = html;

  // Add click handlers to recommendations
  container.querySelectorAll('.recommendation.clickable').forEach(el => {
    el.addEventListener('click', () => {
      const wineId = Number.parseInt(el.dataset.wineId, 10);
      if (wineId) {
        showWineModalFromList({
          id: wineId,
          wine_name: el.dataset.wineName,
          vintage: el.dataset.vintage || null,
          style: el.dataset.style || null,
          colour: el.dataset.colour || null,
          locations: el.dataset.locations,
          bottle_count: Number.parseInt(el.dataset.bottleCount, 10) || 0
        });
      }
    });
  });
}

/**
 * Toggle signal selection.
 * @param {HTMLElement} btn - Signal button
 */
export function toggleSignal(btn) {
  const signal = btn.dataset.signal;

  if (selectedSignals.has(signal)) {
    selectedSignals.delete(signal);
    btn.classList.remove('active');
  } else {
    selectedSignals.add(signal);
    btn.classList.add('active');
  }
}

/**
 * Handle manual pairing request.
 */
export async function handleGetPairing() {
  if (selectedSignals.size === 0) {
    showToast('Select at least one characteristic');
    return;
  }

  const data = await getPairingSuggestions(Array.from(selectedSignals));
  renderManualPairingResults(data);
}

/**
 * Render manual pairing results.
 * @param {Object} data - Pairing results
 */
function renderManualPairingResults(data) {
  const container = document.getElementById('pairing-results');

  if (!data.suggestions || data.suggestions.length === 0) {
    container.innerHTML = '<p style="color: var(--text-muted);">No matching wines found.</p>';
    return;
  }

  container.innerHTML = data.suggestions.map((wine, idx) => `
    <div class="pairing-suggestion clickable" data-wine-id="${wine.id}">
      <div class="pairing-score">#${idx + 1}</div>
      <div style="flex: 1;">
        <div style="font-weight: 500;">${wine.wine_name} ${wine.vintage || 'NV'}</div>
        <div style="font-size: 0.85rem; color: var(--text-muted);">
          ${wine.style} • ${wine.bottle_count} bottle${wine.bottle_count > 1 ? 's' : ''}
        </div>
        <div style="font-size: 0.8rem; color: var(--accent);">${wine.locations}</div>
      </div>
    </div>
  `).join('');

  // Add click handlers to suggestions
  container.querySelectorAll('.pairing-suggestion.clickable').forEach(el => {
    el.addEventListener('click', () => {
      const wineId = Number.parseInt(el.dataset.wineId, 10);
      const wine = data.suggestions.find(w => w.id === wineId);
      if (wine) {
        showWineModalFromList(wine);
      }
    });
  });
}

/**
 * Clear signal selections.
 */
export function clearSignals() {
  selectedSignals.clear();
  document.querySelectorAll('.signal-btn').forEach(btn => btn.classList.remove('active'));
  document.getElementById('pairing-results').innerHTML = '<p style="color: var(--text-muted);">Select dish characteristics above</p>';
}

/**
 * Initialise sommelier event listeners.
 */
export function initSommelier() {
  document.getElementById('ask-sommelier')?.addEventListener('click', handleAskSommelier);
  document.getElementById('dish-input')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleAskSommelier();
  });

  document.querySelectorAll('.signal-btn').forEach(btn => {
    btn.addEventListener('click', () => toggleSignal(btn));
  });

  document.getElementById('get-pairing')?.addEventListener('click', handleGetPairing);
  document.getElementById('clear-signals')?.addEventListener('click', clearSignals);
}
