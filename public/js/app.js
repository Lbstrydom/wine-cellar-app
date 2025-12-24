/**
 * @fileoverview Main application initialisation and state.
 * @module app
 */

import { fetchLayout, fetchStats, fetchReduceNow, fetchWines, fetchConsumptionHistory } from './api.js';
import { renderFridge, renderCellar } from './grid.js';
import { initModals } from './modals.js';
import { initSommelier } from './sommelier.js';
import { initBottles } from './bottles.js';
import { initSettings, loadSettings } from './settings.js';
import { escapeHtml } from './utils.js';

/**
 * Application state.
 */
export const state = {
  layout: null,
  stats: null,
  currentView: 'grid',
  wineListData: [],
  reduceNowIds: new Set()
};

/**
 * Load cellar layout.
 */
export async function loadLayout() {
  state.layout = await fetchLayout();
  renderFridge();
  renderCellar();
}

/**
 * Load statistics.
 */
export async function loadStats() {
  const stats = await fetchStats();
  state.stats = stats;
  document.getElementById('stat-total').textContent = stats.total_bottles;
  document.getElementById('stat-reduce').textContent = stats.reduce_now_count;
  document.getElementById('stat-empty').textContent = stats.empty_slots;
}

/**
 * Load wine list with reduce-now data.
 */
export async function loadWineList() {
  const [wines, reduceNow] = await Promise.all([
    fetchWines(),
    fetchReduceNow()
  ]);

  // Store reduce-now IDs for filtering
  state.reduceNowIds = new Set(reduceNow.map(r => r.wine_id));

  // Merge reduce-now data into wines
  const reduceMap = new Map(reduceNow.map(r => [r.wine_id, r]));
  state.wineListData = wines.map(w => ({
    ...w,
    reduce_priority: reduceMap.get(w.id)?.priority || null,
    reduce_reason: reduceMap.get(w.id)?.reduce_reason || null
  }));

  renderWineList();
}

/**
 * Load consumption history.
 */
export async function loadHistory() {
  const data = await fetchConsumptionHistory();
  renderHistoryList(data.items);
}

/**
 * Refresh all data.
 */
export async function refreshData() {
  await loadLayout();
  await loadStats();
}

/**
 * Get filtered and sorted wine list.
 * @returns {Array} Filtered wines
 */
function getFilteredWines() {
  const showReduceOnly = document.getElementById('filter-reduce-now')?.checked || false;
  const colourFilter = document.getElementById('filter-colour')?.value || '';
  const sortBy = document.getElementById('filter-sort')?.value || 'name';
  const searchTerm = document.getElementById('filter-search')?.value?.toLowerCase() || '';

  let filtered = state.wineListData.filter(w => w.bottle_count > 0);

  // Apply reduce-now filter
  if (showReduceOnly) {
    filtered = filtered.filter(w => state.reduceNowIds.has(w.id));
  }

  // Apply colour filter
  if (colourFilter) {
    filtered = filtered.filter(w => w.colour === colourFilter);
  }

  // Apply search filter
  if (searchTerm) {
    filtered = filtered.filter(w =>
      w.wine_name?.toLowerCase().includes(searchTerm) ||
      w.style?.toLowerCase().includes(searchTerm) ||
      String(w.vintage).includes(searchTerm)
    );
  }

  // Sort
  filtered.sort((a, b) => {
    switch (sortBy) {
      case 'vintage-asc':
        return (a.vintage || 9999) - (b.vintage || 9999);
      case 'vintage-desc':
        return (b.vintage || 0) - (a.vintage || 0);
      case 'rating':
        return (b.vivino_rating || 0) - (a.vivino_rating || 0);
      case 'price':
        return (a.price_eur || 0) - (b.price_eur || 0);
      case 'count':
        return b.bottle_count - a.bottle_count;
      case 'name':
      default:
        return (a.wine_name || '').localeCompare(b.wine_name || '');
    }
  });

  return filtered;
}

/**
 * Render wine list with current filters.
 */
function renderWineList() {
  const container = document.getElementById('wine-list');
  const statsContainer = document.getElementById('wine-list-stats');
  const filtered = getFilteredWines();

  // Update stats
  const totalBottles = filtered.reduce((sum, w) => sum + w.bottle_count, 0);
  const reduceCount = filtered.filter(w => state.reduceNowIds.has(w.id)).length;
  statsContainer.innerHTML = `
    <span>${filtered.length} wines</span>
    <span>${totalBottles} bottles</span>
    ${reduceCount > 0 ? `<span class="reduce-badge">${reduceCount} drink soon</span>` : ''}
  `;

  if (filtered.length === 0) {
    container.innerHTML = '<p class="empty-message">No wines match your filters</p>';
    return;
  }

  container.innerHTML = filtered.map(wine => {
    const isReduceNow = state.reduceNowIds.has(wine.id);
    const priorityClass = wine.reduce_priority ? `priority-${wine.reduce_priority}` : '';

    return `
      <div class="wine-card ${escapeHtml(wine.colour)} ${priorityClass}" data-wine-id="${wine.id}">
        <div class="wine-count">${wine.bottle_count}</div>
        <div class="wine-details">
          <div class="wine-name">${escapeHtml(wine.wine_name)}</div>
          <div class="wine-meta">${escapeHtml(wine.style || '')} • ${escapeHtml(String(wine.vintage)) || 'NV'}</div>
          ${wine.vivino_rating ? `<div class="wine-rating">★ ${wine.vivino_rating}</div>` : ''}
          ${isReduceNow ? `<div class="wine-reduce-reason">${escapeHtml(wine.reduce_reason || 'Drink soon')}</div>` : ''}
          <div class="wine-locations">${escapeHtml(wine.locations || '')}</div>
        </div>
        ${isReduceNow ? `<div class="wine-priority-badge p${wine.reduce_priority}">${wine.reduce_priority || '!'}</div>` : ''}
      </div>
    `;
  }).join('');
}

/**
 * Initialize wine list filters.
 */
function initWineListFilters() {
  const filterReduceNow = document.getElementById('filter-reduce-now');
  const filterColour = document.getElementById('filter-colour');
  const filterSort = document.getElementById('filter-sort');
  const filterSearch = document.getElementById('filter-search');

  if (filterReduceNow) filterReduceNow.addEventListener('change', renderWineList);
  if (filterColour) filterColour.addEventListener('change', renderWineList);
  if (filterSort) filterSort.addEventListener('change', renderWineList);
  if (filterSearch) {
    filterSearch.addEventListener('input', debounce(renderWineList, 200));
  }
}

/**
 * Simple debounce function.
 * @param {Function} fn - Function to debounce
 * @param {number} delay - Delay in ms
 * @returns {Function} Debounced function
 */
function debounce(fn, delay) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn.apply(this, args), delay);
  };
}

/**
 * Render history list.
 * @param {Array} items - Consumption log items
 */
function renderHistoryList(items) {
  const container = document.getElementById('history-list');
  if (!container) return;

  if (items.length === 0) {
    container.innerHTML = '<p style="color: var(--text-muted);">No wines consumed yet</p>';
    return;
  }

  container.innerHTML = items.map(item => {
    const date = new Date(item.consumed_at).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });

    const stars = item.consumption_rating
      ? '\u2605'.repeat(Math.floor(item.consumption_rating)) + '\u2606'.repeat(5 - Math.floor(item.consumption_rating))
      : '';

    return `
      <div class="history-item ${escapeHtml(item.colour || '')}">
        <div class="history-date">${escapeHtml(date)}</div>
        <div class="history-details">
          <div class="history-wine">${escapeHtml(item.wine_name)} ${escapeHtml(item.vintage) || 'NV'}</div>
          <div class="history-meta">${escapeHtml(item.style || '')} • ${escapeHtml(item.country || '')}</div>
          ${item.occasion ? `<div class="history-occasion">${escapeHtml(item.occasion)}</div>` : ''}
          ${item.pairing_dish ? `<div class="history-pairing">${escapeHtml(item.pairing_dish)}</div>` : ''}
          ${item.consumption_notes ? `<div class="history-notes">${escapeHtml(item.consumption_notes)}</div>` : ''}
        </div>
        <div class="history-rating">
          ${stars ? `<span class="history-stars">${stars}</span>` : ''}
          ${item.purchase_stars ? `<span class="history-external">Pro: ${item.purchase_stars}</span>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

/**
 * Switch view.
 * @param {string} viewName - View to switch to
 */
function switchView(viewName) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));

  document.getElementById(`view-${viewName}`).classList.add('active');
  document.querySelector(`[data-view="${viewName}"]`).classList.add('active');

  state.currentView = viewName;

  // Close mobile menu after selection
  document.getElementById('tabs-container')?.classList.remove('open');

  if (viewName === 'wines') loadWineList();
  if (viewName === 'history') loadHistory();
  if (viewName === 'settings') loadSettings();
}

/**
 * Initialize mobile menu toggle.
 */
function initMobileMenu() {
  const menuBtn = document.getElementById('mobile-menu-btn');
  const tabsContainer = document.getElementById('tabs-container');

  if (menuBtn && tabsContainer) {
    menuBtn.addEventListener('click', () => {
      tabsContainer.classList.toggle('open');
    });

    // Close menu when clicking outside
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.tabs')) {
        tabsContainer.classList.remove('open');
      }
    });
  }
}

/**
 * Initialise application.
 */
async function init() {
  // Setup navigation
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => switchView(tab.dataset.view));
  });

  // Initialize mobile menu
  initMobileMenu();

  // Initialize wine list filters
  initWineListFilters();

  // Initialise modules
  initModals();
  initSommelier();
  initSettings();
  await initBottles();

  // Load initial data
  await loadLayout();
  await loadStats();
}

// Start app when DOM ready
document.addEventListener('DOMContentLoaded', init);
