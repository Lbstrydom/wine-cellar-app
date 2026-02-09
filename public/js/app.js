/**
 * @fileoverview Main application initialisation and state.
 * @module app
 */

import {
  fetchLayout,
  fetchStats,
  fetchReduceNow,
  fetchWines,
  fetchConsumptionHistory,
  getProfile,
  getCellars,
  setActiveCellar,
  setAccessToken,
  setActiveCellarId,
  setInviteCode,
  clearAuthState,
  setAuthErrorHandler
} from './api.js';
import { renderFridge, renderCellar, renderStorageAreas, initZoomControls } from './grid.js';
import { initModals, showWineModalFromList } from './modals.js';
import { initSommelier } from './sommelier.js';
import { initBottles } from './bottles.js';
import { initSettings, loadSettings, loadTextSize } from './settings.js';
import { initCellarAnalysis, loadAnalysis } from './cellarAnalysis.js';
import { escapeHtml, showToast } from './utils.js';
import { initVirtualList, updateVirtualList, destroyVirtualList } from './virtualList.js';
import { initGlobalSearch } from './globalSearch.js';
import { initAccessibility } from './accessibility.js';
import { initRestaurantPairing } from './restaurantPairing.js';
import { initRecommendations } from './recommendations.js';
import { initErrorBoundary } from './errorBoundary.js';
import { addTrackedListener, cleanupNamespace } from './eventManager.js';

/** @type {boolean} Enable verbose logging via localStorage.setItem('debug', 'true') */
const DEBUG = (() => { try { return localStorage.getItem('debug') === 'true'; } catch { return false; } })();

/**
 * Namespace for wine list event listeners.
 */
const WINE_LIST_NAMESPACE = 'wineList';

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
const AUTH_SCREEN_ID = 'auth-screen';
const AUTH_FORM_ID = 'auth-form';
const AUTH_MODE_SIGNIN = 'signin';
const AUTH_MODE_SIGNUP = 'signup';

let supabaseClientPromise = null;
let appStarted = false;

/**
 * Get or create Supabase client.
 * @returns {Promise<Object>}
 */
async function getSupabaseClient() {
  if (supabaseClientPromise) return supabaseClientPromise;

  supabaseClientPromise = (async () => {
    if (!window.supabase) {
      throw new Error('Supabase client not loaded');
    }

    const res = await fetch('/api/public-config');
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const message = data.error || 'Supabase not configured';
      throw new Error(message);
    }

    // Log config for debugging (project ref from URL)
    if (DEBUG) {
      const projectRef = data.supabase_url?.match(/https:\/\/([^.]+)/)?.[1] || 'unknown';
      console.log('[Auth] Supabase config:', {
        projectRef,
        anonKeyPrefix: data.supabase_anon_key?.substring(0, 20) + '...'
      });
    }

    // Configure Supabase client with session persistence for "Remember Me" functionality
    // Session persists across browser sessions; refresh tokens auto-renew access tokens
    // Session length (refresh token expiry) is configured in Supabase Dashboard → Auth → Settings
    return window.supabase.createClient(data.supabase_url, data.supabase_anon_key, {
      auth: {
        persistSession: true,        // Keep session in localStorage (default: true)
        autoRefreshToken: true,      // Auto-refresh access token before expiry (default: true)
        detectSessionInUrl: true,    // Detect OAuth callback in URL (default: true)
        storageKey: 'wine-cellar-auth',  // Custom storage key for this app
        flowType: 'implicit'         // Match Supabase's OAuth response (hash-based tokens)
      },
      global: {
        // Explicitly set apikey header to ensure it's always sent
        // Required for /auth/v1/user endpoint to work
        headers: { apikey: data.supabase_anon_key }
      }
    });
  })();

  return supabaseClientPromise;
}

/**
 * Show or hide the auth screen overlay.
 * @param {boolean} show
 */
function toggleAuthScreen(show) {
  const authScreen = document.getElementById(AUTH_SCREEN_ID);
  if (!authScreen) return;
  authScreen.setAttribute('aria-hidden', show ? 'false' : 'true');
  authScreen.classList.toggle('auth-screen--active', show);

  if (show) {
    const menu = document.getElementById('user-menu');
    if (menu) menu.classList.add('user-menu--hidden');
    const switcher = document.getElementById('cellar-switcher');
    if (switcher) switcher.innerHTML = '';
  }
}

/**
 * Update auth screen error message.
 * @param {string} message
 */
function setAuthError(message) {
  const errorEl = document.getElementById('auth-error');
  if (!errorEl) return;
  errorEl.textContent = message || '';
  errorEl.style.display = message ? 'block' : 'none';
}

/**
 * Update auth screen status message.
 * @param {string} message
 */
function setAuthStatus(message) {
  const statusEl = document.getElementById('auth-status');
  if (!statusEl) return;
  statusEl.textContent = message || '';
  statusEl.style.display = message ? 'block' : 'none';
}

/**
 * Toggle auth mode (sign in / sign up).
 * @param {string} mode
 */
function setAuthMode(mode) {
  const authForm = document.getElementById(AUTH_FORM_ID);
  if (!authForm) return;
  authForm.dataset.mode = mode;

  const tabs = document.querySelectorAll('[data-auth-tab]');
  tabs.forEach(tab => {
    tab.classList.toggle('active', tab.dataset.authTab === mode);
  });

  const signupFields = authForm.querySelectorAll('[data-auth-signup]');
  signupFields.forEach(field => {
    field.style.display = mode === AUTH_MODE_SIGNUP ? 'block' : 'none';
  });

  setAuthError('');
  setAuthStatus('');
}

/**
 * Update user menu display.
 * @param {Object} profile
 */
function updateUserMenu(profile) {
  const menu = document.getElementById('user-menu');
  const nameEl = document.getElementById('user-name');
  const emailEl = document.getElementById('user-email');

  if (!menu || !nameEl) return;

  const displayName = profile?.display_name || profile?.email || 'Signed In';
  nameEl.textContent = displayName;

  if (emailEl) {
    emailEl.textContent = profile?.email || '';
  }

  menu.classList.remove('user-menu--hidden');
}

/**
 * Render cellar switcher options.
 * @param {Array} cellars
 * @param {string} activeCellarId
 */
function renderCellarSwitcher(cellars, activeCellarId) {
  const container = document.getElementById('cellar-switcher');
  if (!container) return;

  if (!Array.isArray(cellars) || cellars.length <= 1) {
    container.innerHTML = '';
    return;
  }

  const options = cellars.map(cellar => {
    const selected = cellar.id === activeCellarId ? 'selected' : '';
    return `<option value="${escapeHtml(cellar.id)}" ${selected}>${escapeHtml(cellar.name)}</option>`;
  }).join('');

  container.innerHTML = `
    <label class="cellar-switcher-label" for="cellar-select">Cellar</label>
    <select id="cellar-select" class="cellar-switcher-select">
      ${options}
    </select>
  `;

  const select = container.querySelector('#cellar-select');
  select.addEventListener('change', async (event) => {
    const nextCellarId = event.target.value;
    if (!nextCellarId) return;

    try {
      await setActiveCellar(nextCellarId);
      setActiveCellarId(nextCellarId);
      window.location.reload();
    } catch (err) {
      showToast(`Error: ${err.message}`);
    }
  });
}

/**
 * Load user context after sign-in.
 * @returns {Promise<boolean>}
 */
async function loadUserContext() {
  try {
    const profileResult = await getProfile();
    const profile = profileResult.data || profileResult;

    const cellarsResult = await getCellars();
    const cellars = cellarsResult.data || [];

    // If user has cellars but no active cellar, set the first one
    if (!profile?.active_cellar_id && cellars.length > 0) {
      if (DEBUG) console.log('[Auth] No active cellar, setting first cellar:', cellars[0].id);
      await setActiveCellar(cellars[0].id);
      // Reload profile to get updated active_cellar_id
      const updatedProfile = await getProfile();
      const finalProfile = updatedProfile.data || updatedProfile;
      setActiveCellarId(finalProfile.active_cellar_id);
      updateUserMenu(finalProfile);
    } else if (profile?.active_cellar_id) {
      setActiveCellarId(profile.active_cellar_id);
      updateUserMenu(profile);
    } else {
      // No cellars at all - should not happen with OAuth flow but handle gracefully
      updateUserMenu(profile);
      setAuthError('No cellar found. Please contact support.');
      return false;
    }

    setInviteCode(null);
    renderCellarSwitcher(cellars, profile?.active_cellar_id || null);
    return true;
  } catch (err) {
    setAuthError(err.message);
    return false;
  }
}

/**
 * Start the main app after authentication.
 */
async function startAuthenticatedApp() {
  if (appStarted) return;
  appStarted = true;

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
  initRestaurantPairing();
  initSettings();
  initCellarAnalysis();
  initGlobalSearch();
  initAccessibility();
  initRecommendations();
  await initBottles();

  // Load initial data
  await loadLayout();
  await loadStats();

  // Initialize zoom controls after grid is rendered
  initZoomControls();
}

/**
 * Initialize auth UI and Supabase session handling.
 */
async function initAuth() {
  const authForm = document.getElementById(AUTH_FORM_ID);
  const signOutBtn = document.getElementById('sign-out-btn');
  const googleBtn = document.getElementById('auth-google');
  const appleBtn = document.getElementById('auth-apple');

  setAuthErrorHandler(() => {
    setAuthError('Session expired. Please sign in again.');
    clearAuthState();
    toggleAuthScreen(true);
    getSupabaseClient()
      .then(client => client.auth.signOut())
      .catch(() => {});
  });

  if (!authForm) return;

  authForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    setAuthError('');
    setAuthStatus('');

    const mode = authForm.dataset.mode || AUTH_MODE_SIGNIN;
    const email = authForm.querySelector('#auth-email')?.value?.trim() || '';
    const password = authForm.querySelector('#auth-password')?.value || '';
    const displayName = authForm.querySelector('#auth-name')?.value?.trim() || '';
    const inviteCode = authForm.querySelector('#auth-invite')?.value?.trim() || '';

    if (!email || !password) {
      setAuthError('Email and password are required.');
      return;
    }

    try {
      const supabase = await getSupabaseClient();

      if (mode === AUTH_MODE_SIGNUP) {
        if (!inviteCode) {
          setAuthError('Invite code is required for signup.');
          return;
        }
        setInviteCode(inviteCode);

        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              full_name: displayName || email.split('@')[0]
            }
          }
        });

        if (error) throw error;

        setAuthStatus('Check your email to confirm your account, then sign in.');
        setAuthMode(AUTH_MODE_SIGNIN);
        return;
      }

      setInviteCode(null);
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    } catch (err) {
      setAuthError(err.message || 'Authentication failed.');
    }
  });

  document.querySelectorAll('[data-auth-tab]').forEach(tab => {
    tab.addEventListener('click', () => setAuthMode(tab.dataset.authTab));
  });

  if (googleBtn) {
    googleBtn.addEventListener('click', async () => {
      try {
        const supabase = await getSupabaseClient();
        const mode = authForm.dataset.mode || AUTH_MODE_SIGNIN;
        const inviteCode = authForm.querySelector('#auth-invite')?.value?.trim() || '';

        if (mode === AUTH_MODE_SIGNUP && !inviteCode) {
          setAuthError('Invite code is required for signup.');
          return;
        }

        if (inviteCode) {
          setInviteCode(inviteCode);
        } else {
          setInviteCode(null);
        }

        await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: { redirectTo: window.location.origin }
        });
      } catch (err) {
        setAuthError(err.message || 'Google sign-in failed.');
      }
    });
  }

  if (appleBtn) {
    appleBtn.addEventListener('click', async () => {
      try {
        const supabase = await getSupabaseClient();
        const mode = authForm.dataset.mode || AUTH_MODE_SIGNIN;
        const inviteCode = authForm.querySelector('#auth-invite')?.value?.trim() || '';

        if (mode === AUTH_MODE_SIGNUP && !inviteCode) {
          setAuthError('Invite code is required for signup.');
          return;
        }

        if (inviteCode) {
          setInviteCode(inviteCode);
        } else {
          setInviteCode(null);
        }

        await supabase.auth.signInWithOAuth({
          provider: 'apple',
          options: { redirectTo: window.location.origin }
        });
      } catch (err) {
        setAuthError(err.message || 'Apple sign-in failed.');
      }
    });
  }

  if (signOutBtn) {
    signOutBtn.addEventListener('click', async () => {
      try {
        const supabase = await getSupabaseClient();
        await supabase.auth.signOut();
      } finally {
        clearAuthState();
        window.location.reload();
      }
    });
  }

  try {
    const supabase = await getSupabaseClient();

    // Diagnostic: Log OAuth callback type for debugging
    const hasHashToken = window.location.hash && window.location.hash.includes('access_token');
    const hasCodeParam = window.location.search && window.location.search.includes('code=');

    if (DEBUG) {
      if (hasHashToken) {
        console.log('[Auth] OAuth callback detected: IMPLICIT flow (hash tokens)');
        try {
          const hashParams = new URLSearchParams(window.location.hash.substring(1));
          const token = hashParams.get('access_token');
          if (token) {
            const payload = JSON.parse(atob(token.split('.')[1]));
            console.log('[Auth] Token issuer:', payload.iss);
            console.log('[Auth] Token audience:', payload.aud);
            console.log('[Auth] Token expires:', new Date(payload.exp * 1000).toISOString());
          }
        } catch (_e) {
          console.log('[Auth] Could not decode token for diagnostics');
        }
      } else if (hasCodeParam) {
        console.log('[Auth] OAuth callback detected: PKCE flow (code param)');
      }
    }

    // Note: Do NOT manually clean the URL hash here!
    // Supabase's detectSessionInUrl:true handles this automatically.
    // Cleaning it before Supabase processes it breaks the OAuth flow.

    const { data, error } = await supabase.auth.getSession();
    if (DEBUG) console.log('[Auth] getSession result:', { hasSession: !!data?.session, error: error?.message });

    if (error) throw error;

    if (data?.session?.access_token) {
      setAccessToken(data.session.access_token);
      const ok = await loadUserContext();
      if (ok) {
        toggleAuthScreen(false);
        await startAuthenticatedApp();
      } else {
        toggleAuthScreen(true);
      }
    } else {
      toggleAuthScreen(true);
    }

    supabase.auth.onAuthStateChange(async (event, session) => {
      if (DEBUG) console.log('[Auth] State change:', event);

      if (event === 'TOKEN_REFRESHED') {
        // Silent token refresh - just update stored token, no UI changes needed
        setAccessToken(session?.access_token || null);
        if (DEBUG) console.log('[Auth] Token refreshed silently');
        return;
      }

      // Handle both INITIAL_SESSION (OAuth callbacks) and SIGNED_IN (social login)
      if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN') {
        setAccessToken(session?.access_token || null);
        const ok = await loadUserContext();
        if (ok) {
          toggleAuthScreen(false);
          await startAuthenticatedApp();
        } else {
          toggleAuthScreen(true);
        }
      }

      if (event === 'SIGNED_OUT') {
        clearAuthState();
        toggleAuthScreen(true);
      }
    });
  } catch (err) {
    toggleAuthScreen(true);
    setAuthError(err.message || 'Unable to initialize authentication.');
  }
}

/**
 * Load cellar layout.
 */
export async function loadLayout() {
  state.layout = await fetchLayout();

  const hasAreas = Array.isArray(state.layout?.areas) && state.layout.areas.length > 0;
  const areasContainer = document.getElementById('storage-areas-container');
  const fridgeSection = document.querySelector('.fridge-section');
  const cellarZone = document.querySelector('#cellar-container')?.closest('.zone');

  if (hasAreas) {
    // Show dynamic areas and hide legacy sections
    if (areasContainer) areasContainer.style.display = '';
    if (fridgeSection) fridgeSection.style.display = 'none';
    if (cellarZone) cellarZone.style.display = 'none';

    renderStorageAreas();
  } else {
    // Show legacy fridge/cellar
    if (areasContainer) areasContainer.style.display = 'none';
    if (fridgeSection) fridgeSection.style.display = '';
    if (cellarZone) cellarZone.style.display = '';

    renderFridge();
    renderCellar();
  }
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

    // Clean up existing wine card listeners
    cleanupNamespace(WINE_LIST_NAMESPACE);

    container.innerHTML = filtered.map(renderWineCard).join('');

    // Add click handlers with tracking
    container.querySelectorAll('.wine-card').forEach(card => {
      const handler = () => {
        const wineId = Number.parseInt(card.dataset.wineId, 10);
        const wine = filtered.find(w => w.id === wineId);
        if (wine) handleWineCardClick(wine);
      };
      addTrackedListener(WINE_LIST_NAMESPACE, card, 'click', handler);
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
    const toggleMenu = () => {
      const isOpen = tabsContainer.classList.toggle('open');
      menuBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    };

    menuBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleMenu();
    });

    // Close menu when clicking outside
    document.addEventListener('click', (e) => {
      if (!tabsContainer.classList.contains('open')) return;
      if (e.target.closest('.mobile-menu-btn')) return;
      if (e.target.closest('.tabs-container')) return;
      tabsContainer.classList.remove('open');
      menuBtn.setAttribute('aria-expanded', 'false');
    });

    // Close menu when a tab is selected
    tabsContainer.addEventListener('click', (e) => {
      if (e.target.classList.contains('tab')) {
        tabsContainer.classList.remove('open');
        menuBtn.setAttribute('aria-expanded', 'false');
      }
    });
  }
}

/**
 * Initialise application.
 */
async function init() {
  // Load text size preference early to prevent flash of wrong size
  loadTextSize();

  // Default auth mode
  setAuthMode(AUTH_MODE_SIGNIN);

  // Initialize auth first (loads app after sign-in)
  await initAuth();
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

      if (DEBUG) console.log('[App] Service Worker registered:', registration.scope);

      // Check for updates periodically
      setInterval(() => {
        registration.update();
      }, 60 * 60 * 1000); // Every hour

      // Handle updates
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        if (DEBUG) console.log('[App] Service Worker update found');

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
    if (DEBUG) console.log('[App] Triggering service worker update...');
    // Tell the WAITING service worker to skip waiting and activate
    if (registration.waiting) {
      registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    }
    // Listen for the controller to change, then reload
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (DEBUG) console.log('[App] Controller changed, reloading...');
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

/**
 * Update install section status message.
 */
function updateInstallStatus() {
  const installBtn = document.getElementById('install-app-btn');
  const statusMessage = document.getElementById('install-status-message');

  if (!installBtn || !statusMessage) return;

  // Check if running in standalone mode (already installed)
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || 
                       window.navigator.standalone === true;

  if (isStandalone) {
    installBtn.style.display = 'none';
    statusMessage.textContent = '✅ App is installed and running in standalone mode.';
    statusMessage.className = 'text-success';
    return;
  }

  if (deferredPrompt) {
    // Browser supports install and app is installable
    installBtn.style.display = 'block';
    statusMessage.textContent = 'Click the button above to install.';
    statusMessage.className = 'text-muted';
  } else {
    // No install prompt available - show manual instructions
    installBtn.style.display = 'none';
    
    // Detect browser/platform
    const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
    
    if (isIOS || isSafari) {
      statusMessage.innerHTML = '📱 <strong>iOS/Safari:</strong> Tap the Share button <span style="font-size: 1.2em;">⎙</span>, then select "Add to Home Screen".';
    } else {
      statusMessage.innerHTML = '📱 <strong>Manual Install:</strong> Tap your browser\'s menu (⋮) and select "Install app" or "Add to Home screen".';
    }
    statusMessage.className = 'text-muted';
  }
}

window.addEventListener('beforeinstallprompt', (e) => {
  // Prevent Chrome's default install prompt
  e.preventDefault();
  deferredPrompt = e;

  const installBtn = document.getElementById('install-app-btn');

  if (installBtn) {
    // Remove any existing listeners by cloning
    const newBtn = installBtn.cloneNode(true);
    installBtn.parentNode.replaceChild(newBtn, installBtn);
    
    newBtn.addEventListener('click', async () => {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (DEBUG) console.log('[App] Install prompt outcome:', outcome);

        if (outcome === 'accepted') {
          deferredPrompt = null;
          updateInstallStatus();
        }
      }
    });
  }

  updateInstallStatus();
});

window.addEventListener('appinstalled', () => {
  if (DEBUG) console.log('[App] PWA was installed');
  deferredPrompt = null;
  updateInstallStatus();

  // Update PWA status
  updatePwaStatus();
});

// Initial status check on page load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', updateInstallStatus);
} else {
  updateInstallStatus();
}

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

// Guard against double initialization at module level
let appInitialized = false;

function startApp() {
  if (appInitialized) return;
  appInitialized = true;

  // Initialize error boundary first
  initErrorBoundary();

  // Then initialize app
  init();
  registerServiceWorker();
}

// Start app when DOM ready (or immediately if already loaded)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startApp);
} else {
  // DOM already loaded (e.g., script loaded late or module re-executed)
  startApp();
}
