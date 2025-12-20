/**
 * @fileoverview Main application initialisation and state.
 * @module app
 */

import { fetchLayout, fetchStats, fetchReduceNow, fetchWines } from './api.js';
import { renderFridge, renderCellar } from './grid.js';
import { initModals } from './modals.js';
import { initSommelier } from './sommelier.js';
import { initBottles } from './bottles.js';

/**
 * Application state.
 */
export const state = {
  layout: null,
  stats: null,
  currentView: 'grid'
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
 * Load reduce-now list.
 */
export async function loadReduceNow() {
  const list = await fetchReduceNow();
  renderReduceList(list);
}

/**
 * Load all wines.
 */
export async function loadWines() {
  const wines = await fetchWines();
  renderWineList(wines);
}

/**
 * Refresh all data.
 */
export async function refreshData() {
  await loadLayout();
  await loadStats();
}

/**
 * Render reduce-now list.
 * @param {Array} list - Reduce-now wines
 */
function renderReduceList(list) {
  const container = document.getElementById('reduce-list');

  if (list.length === 0) {
    container.innerHTML = '<p style="color: var(--text-muted);">No wines in reduce-now list</p>';
    return;
  }

  container.innerHTML = list.map(item => `
    <div class="reduce-item p${item.priority}">
      <div class="reduce-priority">${item.priority}</div>
      <div class="reduce-info">
        <div class="reduce-name">${item.wine_name} ${item.vintage || 'NV'}</div>
        <div class="reduce-meta">${item.style} • ${item.bottle_count} bottle${item.bottle_count > 1 ? 's' : ''}</div>
        <div class="reduce-meta">${item.reduce_reason || ''}</div>
        <div class="reduce-locations">${item.locations || ''}</div>
      </div>
    </div>
  `).join('');
}

/**
 * Render wine list.
 * @param {Array} wines - All wines
 */
function renderWineList(wines) {
  const container = document.getElementById('wine-list');
  const withBottles = wines.filter(w => w.bottle_count > 0);

  container.innerHTML = withBottles.map(wine => `
    <div class="wine-card ${wine.colour}">
      <div class="wine-count">${wine.bottle_count}</div>
      <div class="wine-details">
        <div class="wine-name">${wine.wine_name}</div>
        <div class="wine-meta">${wine.style} • ${wine.vintage || 'NV'}</div>
        <div class="wine-meta" style="color: var(--accent);">${wine.locations || ''}</div>
      </div>
    </div>
  `).join('');
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

  if (viewName === 'reduce') loadReduceNow();
  if (viewName === 'wines') loadWines();
}

/**
 * Initialise application.
 */
async function init() {
  // Setup navigation
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => switchView(tab.dataset.view));
  });

  // Initialise modules
  initModals();
  initSommelier();
  await initBottles();

  // Load initial data
  await loadLayout();
  await loadStats();
}

// Start app when DOM ready
document.addEventListener('DOMContentLoaded', init);
