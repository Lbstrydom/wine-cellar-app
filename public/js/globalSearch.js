/**
 * @fileoverview Global unified search bar with Cmd/Ctrl+K shortcut.
 * Searches wines, producers, countries, and styles in one place.
 * @module globalSearch
 */

import { escapeHtml } from './utils.js';
import { fetch } from './api.js';

/**
 * Global search state.
 */
const searchState = {
  isOpen: false,
  selectedIndex: 0,
  results: { wines: [], producers: [], countries: [], styles: [] },
  flatResults: []
};

/**
 * Quick actions shown when no search query.
 */
const QUICK_ACTIONS = [
  { type: 'action', id: 'add-wine', label: 'Add new wine', icon: '🍷', action: 'showAddWine' },
  { type: 'action', id: 'sommelier', label: 'Ask sommelier', icon: '🤖', action: 'showSommelier' },
  { type: 'action', id: 'reduce-now', label: 'View drink soon wines', icon: '⏰', action: 'showReduceNow' }
];

let overlay = null;
let searchInput = null;
let resultsContainer = null;
let debounceTimer = null;

/**
 * Initialize global search.
 */
export function initGlobalSearch() {
  createOverlay();
  bindKeyboardShortcuts();
  bindTriggerButton();
}

/**
 * Create the search overlay DOM structure.
 */
function createOverlay() {
  // Prevent duplicate overlays
  const existing = document.getElementById('global-search-overlay');
  if (existing) {
    overlay = existing;
    searchInput = document.getElementById('global-search-input');
    resultsContainer = document.getElementById('global-search-results');
    return;
  }

  overlay = document.createElement('div');
  overlay.id = 'global-search-overlay';
  overlay.className = 'global-search-overlay';
  overlay.innerHTML = `
    <div class="global-search-modal">
      <div class="global-search-input-wrapper">
        <span class="search-icon">🔍</span>
        <input type="text"
               id="global-search-input"
               class="global-search-input"
               placeholder="Search wines, producers, regions..."
               autocomplete="off"
               spellcheck="false" />
        <kbd class="search-shortcut">ESC</kbd>
      </div>
      <div id="global-search-results" class="global-search-results"></div>
    </div>
  `;

  document.body.appendChild(overlay);

  searchInput = document.getElementById('global-search-input');
  resultsContainer = document.getElementById('global-search-results');

  // Bind events
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeSearch();
  });

  searchInput.addEventListener('input', handleSearchInput);
  searchInput.addEventListener('keydown', handleSearchKeydown);
}

/**
 * Bind Cmd/Ctrl+K keyboard shortcut.
 */
function bindKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    // Cmd/Ctrl + K to open search
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      if (searchState.isOpen) {
        closeSearch();
      } else {
        openSearch();
      }
    }

    // Escape to close
    if (e.key === 'Escape' && searchState.isOpen) {
      e.preventDefault();
      closeSearch();
    }
  });
}

/**
 * Bind click on header search trigger (if exists).
 */
function bindTriggerButton() {
  const trigger = document.getElementById('global-search-trigger');
  if (trigger) {
    trigger.addEventListener('click', openSearch);
  }
}

/**
 * Open the search overlay.
 */
export function openSearch() {
  searchState.isOpen = true;
  searchState.selectedIndex = 0;
  overlay.classList.add('active');
  searchInput.value = '';
  searchInput.focus();
  showQuickActions();
}

/**
 * Close the search overlay.
 */
export function closeSearch() {
  searchState.isOpen = false;
  overlay.classList.remove('active');
  searchInput.value = '';
  resultsContainer.innerHTML = '';
}

/**
 * Handle search input with debounce.
 * @param {Event} e - Input event
 */
function handleSearchInput(e) {
  const query = e.target.value.trim();

  clearTimeout(debounceTimer);

  if (query.length < 2) {
    showQuickActions();
    return;
  }

  debounceTimer = setTimeout(() => performSearch(query), 150);
}

/**
 * Handle keyboard navigation in search results.
 * @param {KeyboardEvent} e - Keydown event
 */
function handleSearchKeydown(e) {
  const { flatResults, selectedIndex } = searchState;

  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault();
      searchState.selectedIndex = Math.min(selectedIndex + 1, flatResults.length - 1);
      updateSelection();
      break;

    case 'ArrowUp':
      e.preventDefault();
      searchState.selectedIndex = Math.max(selectedIndex - 1, 0);
      updateSelection();
      break;

    case 'Enter':
      e.preventDefault();
      if (flatResults[selectedIndex]) {
        selectResult(flatResults[selectedIndex]);
      }
      break;
  }
}

/**
 * Show quick actions when no search query.
 */
function showQuickActions() {
  searchState.flatResults = QUICK_ACTIONS;
  searchState.selectedIndex = 0;

  resultsContainer.innerHTML = `
    <div class="search-section">
      <div class="search-section-title">Quick Actions</div>
      ${QUICK_ACTIONS.map((action, idx) => `
        <div class="search-result-item ${idx === 0 ? 'selected' : ''}"
             data-type="action"
             data-action="${action.action}"
             data-index="${idx}">
          <span class="result-icon">${action.icon}</span>
          <span class="result-label">${escapeHtml(action.label)}</span>
        </div>
      `).join('')}
    </div>
  `;

  bindResultClicks();
}

/**
 * Perform search API call.
 * @param {string} query - Search query
 */
async function performSearch(query) {
  try {
    const response = await fetch(`/api/wines/global-search?q=${encodeURIComponent(query)}&limit=5`);
    if (!response.ok) throw new Error('Search failed');

    const results = await response.json();
    searchState.results = results;
    renderResults(results, query);
  } catch (err) {
    console.error('Global search error:', err);
    resultsContainer.innerHTML = '<div class="search-error">Search failed</div>';
  }
}

/**
 * Render search results grouped by category.
 * @param {Object} results - Search results { wines, producers, countries, styles }
 * @param {string} query - Original query for highlighting
 */
function renderResults(results, query) {
  const { wines, producers, countries, styles } = results;

  // Flatten results for keyboard navigation
  searchState.flatResults = [
    ...wines.map(w => ({ ...w, type: 'wine' })),
    ...producers.map(p => ({ ...p, type: 'producer' })),
    ...countries.map(c => ({ ...c, type: 'country' })),
    ...styles.map(s => ({ ...s, type: 'style' }))
  ];
  searchState.selectedIndex = 0;

  if (searchState.flatResults.length === 0) {
    resultsContainer.innerHTML = `
      <div class="search-empty">
        <p>No results for "${escapeHtml(query)}"</p>
        <p class="search-hint">Try a different search term</p>
      </div>
    `;
    return;
  }

  let html = '';
  let globalIndex = 0;

  // Wines section
  if (wines.length > 0) {
    html += `
      <div class="search-section">
        <div class="search-section-title">Wines</div>
        ${wines.map(wine => {
          const idx = globalIndex++;
          const stars = wine.purchase_stars ? '★'.repeat(Math.round(wine.purchase_stars)) : '';
          return `
            <div class="search-result-item ${idx === 0 ? 'selected' : ''}"
                 data-type="wine"
                 data-id="${wine.id}"
                 data-index="${idx}">
              <div class="result-main">
                <span class="result-colour ${escapeHtml(wine.colour || '')}"></span>
                <span class="result-name">${highlightMatch(wine.wine_name, query)}</span>
                <span class="result-vintage">${escapeHtml(wine.vintage) || 'NV'}</span>
              </div>
              <div class="result-meta">
                ${stars ? `<span class="result-stars">${stars}</span>` : ''}
                <span class="result-count">${wine.bottle_count || 0} bottles</span>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  // Producers section
  if (producers.length > 0) {
    html += `
      <div class="search-section">
        <div class="search-section-title">Producers</div>
        ${producers.map(producer => {
          const idx = globalIndex++;
          return `
            <div class="search-result-item ${idx === 0 ? 'selected' : ''}"
                 data-type="producer"
                 data-producer="${escapeHtml(producer.producer)}"
                 data-index="${idx}">
              <span class="result-icon">🏠</span>
              <span class="result-name">${highlightMatch(producer.producer, query)}</span>
              <span class="result-count">${producer.wine_count} wines</span>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  // Countries section
  if (countries.length > 0) {
    html += `
      <div class="search-section">
        <div class="search-section-title">Countries</div>
        ${countries.map(country => {
          const idx = globalIndex++;
          return `
            <div class="search-result-item ${idx === 0 ? 'selected' : ''}"
                 data-type="country"
                 data-country="${escapeHtml(country.country)}"
                 data-index="${idx}">
              <span class="result-icon">🌍</span>
              <span class="result-name">${highlightMatch(country.country, query)}</span>
              <span class="result-count">${country.wine_count} wines</span>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  // Styles section
  if (styles.length > 0) {
    html += `
      <div class="search-section">
        <div class="search-section-title">Styles</div>
        ${styles.map(style => {
          const idx = globalIndex++;
          return `
            <div class="search-result-item ${idx === 0 ? 'selected' : ''}"
                 data-type="style"
                 data-style="${escapeHtml(style.style)}"
                 data-index="${idx}">
              <span class="result-icon">🍇</span>
              <span class="result-name">${highlightMatch(style.style, query)}</span>
              <span class="result-count">${style.wine_count} wines</span>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  resultsContainer.innerHTML = html;
  bindResultClicks();
}

/**
 * Highlight matching text in result.
 * @param {string} text - Text to highlight
 * @param {string} query - Search query
 * @returns {string} HTML with highlights
 */
function highlightMatch(text, query) {
  if (!text || !query) return escapeHtml(text || '');

  const escaped = escapeHtml(text);
  const regex = new RegExp(`(${escapeRegExp(query)})`, 'gi');
  return escaped.replace(regex, '<mark>$1</mark>');
}

/**
 * Escape special regex characters.
 * @param {string} str - String to escape
 * @returns {string} Escaped string
 */
function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Update visual selection based on selectedIndex.
 */
function updateSelection() {
  const items = resultsContainer.querySelectorAll('.search-result-item');
  items.forEach((item, idx) => {
    item.classList.toggle('selected', idx === searchState.selectedIndex);
  });

  // Scroll selected item into view
  const selected = items[searchState.selectedIndex];
  if (selected) {
    selected.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

/**
 * Bind click handlers to result items.
 */
function bindResultClicks() {
  resultsContainer.querySelectorAll('.search-result-item').forEach(item => {
    item.addEventListener('click', () => {
      const index = parseInt(item.dataset.index, 10);
      searchState.selectedIndex = index;
      selectResult(searchState.flatResults[index]);
    });

    item.addEventListener('mouseenter', () => {
      const index = parseInt(item.dataset.index, 10);
      searchState.selectedIndex = index;
      updateSelection();
    });
  });
}

/**
 * Handle result selection.
 * @param {Object} result - Selected result item
 */
function selectResult(result) {
  closeSearch();

  switch (result.type) {
    case 'wine':
      navigateToWine(result.id);
      break;
    case 'producer':
      filterByProducer(result.producer);
      break;
    case 'country':
      filterByCountry(result.country);
      break;
    case 'style':
      filterByStyle(result.style);
      break;
    case 'action':
      executeAction(result.action);
      break;
  }
}

/**
 * Navigate to wine list and show specific wine.
 * @param {number} wineId - Wine ID
 */
function navigateToWine(wineId) {
  // Switch to wines view
  const winesTab = document.querySelector('[data-view="wines"]');
  if (winesTab) winesTab.click();

  // After a brief delay, scroll to and highlight the wine
  setTimeout(() => {
    const wineCard = document.querySelector(`.wine-card[data-wine-id="${wineId}"]`);
    if (wineCard) {
      wineCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
      wineCard.classList.add('highlight-pulse');
      setTimeout(() => wineCard.classList.remove('highlight-pulse'), 2000);
      wineCard.click();
    }
  }, 100);
}

/**
 * Filter wine list by producer.
 * @param {string} producer - Producer name
 */
function filterByProducer(producer) {
  const winesTab = document.querySelector('[data-view="wines"]');
  if (winesTab) winesTab.click();

  setTimeout(() => {
    const searchInput = document.getElementById('filter-search');
    if (searchInput) {
      searchInput.value = producer;
      searchInput.dispatchEvent(new Event('input'));
    }
  }, 100);
}

/**
 * Filter wine list by country.
 * @param {string} country - Country name
 */
function filterByCountry(country) {
  const winesTab = document.querySelector('[data-view="wines"]');
  if (winesTab) winesTab.click();

  setTimeout(() => {
    const searchInput = document.getElementById('filter-search');
    if (searchInput) {
      searchInput.value = country;
      searchInput.dispatchEvent(new Event('input'));
    }
  }, 100);
}

/**
 * Filter wine list by style.
 * @param {string} style - Wine style
 */
function filterByStyle(style) {
  const winesTab = document.querySelector('[data-view="wines"]');
  if (winesTab) winesTab.click();

  setTimeout(() => {
    const searchInput = document.getElementById('filter-search');
    if (searchInput) {
      searchInput.value = style;
      searchInput.dispatchEvent(new Event('input'));
    }
  }, 100);
}

/**
 * Execute a quick action.
 * @param {string} action - Action identifier
 */
function executeAction(action) {
  switch (action) {
    case 'showAddWine':
      // Open add bottle modal with smart placement
      import('./bottles.js').then(({ showAddBottleModal }) => {
        showAddBottleModal('smart');
      });
      break;

    case 'showSommelier': {
      const pairingTab = document.querySelector('[data-view="pairing"]');
      if (pairingTab) pairingTab.click();
      setTimeout(() => {
        document.getElementById('dish-input')?.focus();
      }, 100);
      break;
    }

    case 'showReduceNow': {
      const winesTab = document.querySelector('[data-view="wines"]');
      if (winesTab) winesTab.click();
      setTimeout(() => {
        const filterCheckbox = document.getElementById('filter-reduce-now');
        if (filterCheckbox && !filterCheckbox.checked) {
          filterCheckbox.click();
        }
      }, 100);
      break;
    }
  }
}

export default {
  initGlobalSearch,
  openSearch,
  closeSearch
};
