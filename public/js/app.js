/**
 * @fileoverview Main application initialisation and state.
 * @module app
 */

import { fetchLayout, fetchStats, fetchReduceNow, fetchWines, fetchConsumptionHistory } from './api.js';
import { renderFridge, renderCellar } from './grid.js';
import { initModals, showWineModalFromList } from './modals.js';
import { initSommelier } from './sommelier.js';
import { initBottles } from './bottles.js';
import { initSettings, loadSettings } from './settings.js';
import { initCellarAnalysis, loadAnalysis } from './cellarAnalysis.js';
import { escapeHtml } from './utils.js';
import { initVirtualList, updateVirtualList, destroyVirtualList } from './virtualList.js';
import { initGlobalSearch } from './globalSearch.js';
import { initAccessibility } from './accessibility.js';
import { initRecommendations } from './recommendations.js';

/**
 * Application state.
 */
export const state = {
  layout: null,
  stats: null,
  currentView: 'grid',
  wineListData: [],
  reduceNowIds: new Set(),
  virtualListActive: false
};

/**
 * Threshold for using virtual list (items count).
 */
const VIRTUAL_LIST_THRESHOLD = 50;

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
 * Refresh just the layout (grids).
 */
export async function refreshLayout() {
  await loadLayout();
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
 * Render a single wine card HTML.
 * @param {Object} wine - Wine object
 * @returns {string} HTML string
 */
function renderWineCard(wine) {
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
}

/**
 * Handle click on wine card (for virtual list).
 * @param {Object} wine - Wine object
 */
function handleWineCardClick(wine) {
  showWineModalFromList(wine);
}

/**
 * Render wine list with current filters.
 * Uses virtual scrolling for large lists.
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
    // Clean up virtual list if active
    if (state.virtualListActive) {
      destroyVirtualList();
      state.virtualListActive = false;
      container.classList.remove('virtual-mode');
    }
    container.innerHTML = '<p class="empty-message">No wines match your filters</p>';
    return;
  }

  // Use virtual list for large datasets
  if (filtered.length >= VIRTUAL_LIST_THRESHOLD) {
    container.classList.add('virtual-mode');

    if (state.virtualListActive) {
      // Update existing virtual list
      updateVirtualList(filtered);
    } else {
      // Initialize virtual list
      initVirtualList({
        container,
        items: filtered,
        renderItem: renderWineCard,
        itemHeight: 90,
        bufferSize: 5,
        onItemClick: handleWineCardClick
      });
      state.virtualListActive = true;
    }
  } else {
    // Regular rendering for small lists
    if (state.virtualListActive) {
      destroyVirtualList();
      state.virtualListActive = false;
      container.classList.remove('virtual-mode');
    }

    container.innerHTML = filtered.map(renderWineCard).join('');

    // Add click handlers
    container.querySelectorAll('.wine-card').forEach(card => {
      card.addEventListener('click', () => {
        const wineId = Number.parseInt(card.dataset.wineId, 10);
        const wine = filtered.find(w => w.id === wineId);
        if (wine) handleWineCardClick(wine);
      });
    });
  }
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
  // Update view panels
  document.querySelectorAll('.view').forEach(v => {
    v.classList.remove('active');
    v.hidden = true;
  });

  // Update tab buttons with ARIA
  document.querySelectorAll('.tab').forEach(t => {
    t.classList.remove('active');
    t.setAttribute('aria-selected', 'false');
    t.setAttribute('tabindex', '-1');
  });

  // Activate selected view
  const activeView = document.getElementById(`view-${viewName}`);
  if (activeView) {
    activeView.classList.add('active');
    activeView.hidden = false;
  }

  // Activate selected tab
  const activeTab = document.querySelector(`[data-view="${viewName}"]`);
  if (activeTab) {
    activeTab.classList.add('active');
    activeTab.setAttribute('aria-selected', 'true');
    activeTab.setAttribute('tabindex', '0');
  }

  state.currentView = viewName;

  // Close mobile menu after selection
  document.getElementById('tabs-container')?.classList.remove('open');

  if (viewName === 'wines') loadWineList();
  if (viewName === 'history') loadHistory();
  if (viewName === 'settings') loadSettings();
  if (viewName === 'analysis') {
    // Load analysis when tab is opened
    loadAnalysis();
  }
}

/**
 * Initialize mobile menu toggle.
 */
function initMobileMenu() {
  const menuBtn = document.getElementById('mobile-menu-btn');
  const tabsContainer = document.getElementById('tabs-container');

  if (menuBtn && tabsContainer) {
    // Track if touch event fired to prevent double-toggle
    let touchFired = false;

    const toggleMenu = () => {
      const isOpen = tabsContainer.classList.toggle('open');
      menuBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    };

    // Touch event for mobile - fires first
    menuBtn.addEventListener('touchend', (e) => {
      e.preventDefault();
      touchFired = true;
      toggleMenu();
      // Reset flag after a short delay
      setTimeout(() => { touchFired = false; }, 300);
    }, { passive: false });

    // Click event for desktop - skip if touch already fired
    menuBtn.addEventListener('click', (e) => {
      if (touchFired) return;
      e.preventDefault();
      toggleMenu();
    });

    // Close menu when clicking/touching outside
    document.addEventListener('click', (e) => {
      if (!tabsContainer.classList.contains('open')) return;
      if (e.target.closest('.mobile-menu-btn')) return;
      if (e.target.closest('.tabs-container')) return;
      tabsContainer.classList.remove('open');
      menuBtn.setAttribute('aria-expanded', 'false');
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
  initCellarAnalysis();
  initGlobalSearch();
  initAccessibility();
  initRecommendations();
  await initBottles();

  // Load initial data
  await loadLayout();
  await loadStats();
}

/**
 * Register service worker for PWA functionality.
 */
async function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js', {
        scope: '/'
      });

      console.log('[App] Service Worker registered:', registration.scope);

      // Check for updates periodically
      setInterval(() => {
        registration.update();
      }, 60 * 60 * 1000); // Every hour

      // Handle updates
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        console.log('[App] Service Worker update found');

        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            // New version available - pass the registration so we can message waiting worker
            showUpdateNotification(registration);
          }
        });
      });

      // Also check if there's already a waiting worker on page load
      if (registration.waiting) {
        showUpdateNotification(registration);
      }

    } catch (error) {
      console.error('[App] Service Worker registration failed:', error);
    }
  }
}

/**
 * Show notification when new version is available.
 * @param {ServiceWorkerRegistration} registration - The SW registration
 */
function showUpdateNotification(registration) {
  // Don't show duplicate notifications
  if (document.querySelector('.update-notification')) return;

  const notification = document.createElement('div');
  notification.className = 'update-notification';
  notification.innerHTML = `
    <span>A new version is available!</span>
    <button id="update-app-btn" class="btn btn-small btn-primary">Update</button>
    <button id="dismiss-update-btn" class="btn btn-small btn-secondary">Later</button>
  `;
  document.body.appendChild(notification);

  document.getElementById('update-app-btn').addEventListener('click', () => {
    console.log('[App] Triggering service worker update...');
    // Tell the WAITING service worker to skip waiting and activate
    if (registration.waiting) {
      registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    }
    // Listen for the controller to change, then reload
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      console.log('[App] Controller changed, reloading...');
      window.location.reload();
    });
    // Fallback reload after short delay if controllerchange doesn't fire
    setTimeout(() => {
      window.location.reload();
    }, 1000);
  });

  document.getElementById('dismiss-update-btn').addEventListener('click', () => {
    notification.remove();
  });
}

/**
 * Handle PWA install prompt.
 */
let deferredPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
  // Prevent Chrome's default install prompt
  e.preventDefault();
  deferredPrompt = e;

  // Show install section in settings
  const installSection = document.getElementById('pwa-install-section');
  const installBtn = document.getElementById('install-app-btn');

  if (installSection) {
    installSection.style.display = 'block';
  }

  if (installBtn) {
    installBtn.addEventListener('click', async () => {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        console.log('[App] Install prompt outcome:', outcome);

        if (outcome === 'accepted') {
          deferredPrompt = null;
          if (installSection) {
            installSection.style.display = 'none';
          }
        }
      }
    });
  }
});

window.addEventListener('appinstalled', () => {
  console.log('[App] PWA was installed');
  deferredPrompt = null;

  // Hide install section
  const installSection = document.getElementById('pwa-install-section');
  if (installSection) {
    installSection.style.display = 'none';
  }

  // Update PWA status
  updatePwaStatus();
});

/**
 * Update PWA status display in settings.
 */
function updatePwaStatus() {
  const statusEl = document.getElementById('pwa-status');
  if (!statusEl) return;

  if (window.matchMedia('(display-mode: standalone)').matches) {
    statusEl.textContent = 'Installed App';
    statusEl.style.color = 'var(--sparkling)';
  } else if (navigator.standalone) {
    // iOS Safari standalone mode
    statusEl.textContent = 'Installed App (iOS)';
    statusEl.style.color = 'var(--sparkling)';
  } else {
    statusEl.textContent = 'Web App';
  }
}

// Check PWA status on load
window.addEventListener('load', updatePwaStatus);

// Start app when DOM ready
document.addEventListener('DOMContentLoaded', () => {
  init();
  registerServiceWorker();
});
