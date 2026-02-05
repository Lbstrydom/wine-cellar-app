/**
 * @fileoverview Wine search functionality for bottle modal.
 * @module bottles/wineSearch
 */

import { searchWines } from '../api.js';
import { escapeHtml } from '../utils.js';
import { bottleState } from './state.js';

/**
 * Initialize wine search input handler.
 */
export function initWineSearch() {
  const searchInput = document.getElementById('wine-search');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      clearTimeout(bottleState.searchTimeout);
      bottleState.searchTimeout = setTimeout(() => handleWineSearch(e.target.value), 300);
    });
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
    const result = await searchWines(query);
    const wines = Array.isArray(result) ? result : (result?.data || []);

    if (wines.length === 0) {
      resultsContainer.innerHTML = '<div class="search-result-item">No wines found. Try "New Wine" tab.</div>';
    } else {
      resultsContainer.innerHTML = wines.map(wine => `
        <div class="search-result-item" data-wine-id="${escapeHtml(wine.id)}">
          <div class="search-result-name">${escapeHtml(wine.wine_name)} ${escapeHtml(wine.vintage) || 'NV'}</div>
          <div class="search-result-meta">${escapeHtml(wine.style) || ''} - ${escapeHtml(wine.colour)}</div>
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
