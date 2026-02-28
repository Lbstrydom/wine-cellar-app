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
  setAuthErrorHandler,
  updateWine,
  batchFetchRatings,
  getRatingsJobStatus
} from './api.js';
import { renderFridge, renderCellar, renderStorageAreas, initZoomControls } from './grid.js';
import { initModals, showWineModalFromList, closeWineModal } from './modals.js';
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
import { registerServiceWorker } from './pwa.js';

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
 * Wine list view mode preference ('table' or 'cards').
 * Stored in localStorage so preference persists across sessions.
 */
let wineViewMode = (() => {
  try { return localStorage.getItem('wineViewMode') || 'table'; } catch { return 'table'; }
})();

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
 * Parent tab → child views mapping for 5-tab navigation.
 */
const PARENT_TAB_MAP = {
  cellar:     ['grid', 'analysis'],
  pairing:    ['pairing'],
  kitchen:    ['recipes'],
  collection: ['wines', 'history', 'drinksoon'],
  settings:   ['settings']
};

/**
 * Child view → parent tab lookup (derived from PARENT_TAB_MAP).
 */
const VIEW_TO_PARENT = {};
for (const [parent, views] of Object.entries(PARENT_TAB_MAP)) {
  for (const v of views) VIEW_TO_PARENT[v] = parent;
}

/**
 * Parent-level URL alias → first child view (for ?view=collection deep-links).
 */
const PARENT_URL_MAP = {
  cellar: 'grid',
  pairing: 'pairing',
  kitchen: 'recipes',
  collection: 'wines',
  settings: 'settings'
};

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

  try {
    // Setup navigation — parent tabs + sub-tabs
    document.querySelectorAll('.tab[data-parent]').forEach(btn => {
      btn.addEventListener('click', () => {
        const firstView = PARENT_TAB_MAP[btn.dataset.parent]?.[0];
        if (firstView) switchView(firstView);
      });
    });
    document.querySelectorAll('.sub-tab[data-view]').forEach(btn => {
      btn.addEventListener('click', () => switchView(btn.dataset.view));
    });

    // Initialize mobile menu
    initMobileMenu();

    // Initialize wine list filters
    initWineListFilters();

    // Initialize header stat buttons (navigate on click)
    initStatButtons();

    // Wire modal X close button (CSP-compliant: JS listener, not inline handler)
    document.getElementById('btn-modal-close-x')?.addEventListener('click', closeWineModal);

    // Wire fridge/cellar quick-nav scroll buttons (hidden when storage areas active)
    document.getElementById('nav-to-fridge')?.addEventListener('click', () =>
      document.getElementById('fridge-section')?.scrollIntoView({ behavior: 'smooth' }));
    document.getElementById('nav-to-cellar')?.addEventListener('click', () =>
      document.getElementById('cellar-section')?.scrollIntoView({ behavior: 'smooth' }));

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

    // Load initial data with error handling to prevent PWA freeze
    await loadInitialData();

    // Initialize zoom controls after grid is rendered
    initZoomControls();

    // Deep-link support: honour ?view=X so external links can open a specific view/tab.
    // Supports both direct view names (e.g. ?view=recipes) and parent names (e.g. ?view=collection).
    const VALID_VIEWS = ['grid', 'analysis', 'pairing', 'recipes', 'wines', 'history', 'drinksoon', 'settings'];
    const urlView = new URLSearchParams(window.location.search).get('view');
    if (urlView) {
      if (VALID_VIEWS.includes(urlView)) {
        switchView(urlView);
      } else if (PARENT_URL_MAP[urlView]) {
        switchView(PARENT_URL_MAP[urlView]);
      }
    }

    // Listen for grape health changes — refresh data if wines were reclassified
    document.addEventListener('grape-health:changed', (e) => {
      const reclassified = e.detail?.reclassified || 0;
      if (reclassified > 0) {
        refreshData();
      } else {
        loadStats();
      }
    });
  } catch (err) {
    console.error('[App] startAuthenticatedApp failed:', err);
    showToast(`Initialization error: ${err.message}`);
  }
}

/**
 * Load layout + stats with loading indicator, error handling, and retry.
 * Prevents the app from freezing on slow/failed connections.
 */
async function loadInitialData() {
  showGridLoading(true);
  try {
    await loadLayout();
    await loadStats();
  } catch (err) {
    console.error('[App] Failed to load cellar data:', err);
    showGridError(err.message);
  } finally {
    showGridLoading(false);
  }

}

/**
 * Show or hide loading indicator in the grid view.
 * @param {boolean} show
 */
function showGridLoading(show) {
  let loader = document.getElementById('grid-loading-indicator');
  if (show) {
    if (!loader) {
      loader = document.createElement('div');
      loader.id = 'grid-loading-indicator';
      loader.className = 'grid-loading-indicator';
      loader.textContent = 'Loading your cellar\u2026';
      const gridView = document.getElementById('view-grid');
      if (gridView) gridView.prepend(loader);
    }
  } else if (loader) {
    loader.remove();
  }
}

/**
 * Show error with retry button in the grid view.
 * @param {string} message
 */
function showGridError(message) {
  const gridView = document.getElementById('view-grid');
  if (!gridView) return;

  // Remove any previous error
  document.getElementById('grid-error-indicator')?.remove();

  const errorEl = document.createElement('div');
  errorEl.id = 'grid-error-indicator';
  errorEl.className = 'grid-error-indicator';

  const msg = document.createElement('p');
  msg.textContent = `Failed to load cellar: ${message}`;
  errorEl.appendChild(msg);

  const retryBtn = document.createElement('button');
  retryBtn.className = 'btn btn-primary';
  retryBtn.textContent = 'Retry';
  retryBtn.addEventListener('click', async () => {
    errorEl.remove();
    await loadInitialData();
    initZoomControls();
  });
  errorEl.appendChild(retryBtn);

  gridView.prepend(errorEl);
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
      try {
        if (DEBUG) console.log('[Auth] State change:', event);

        if (event === 'TOKEN_REFRESHED') {
          // Silent token refresh - just update stored token, no UI changes needed
          setAccessToken(session?.access_token || null);
          if (DEBUG) console.log('[Auth] Token refreshed silently');
          return;
        }

        // Handle both INITIAL_SESSION (OAuth callbacks) and SIGNED_IN (social login)
        if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN') {
          // Skip if no session (e.g., INITIAL_SESSION fires with null on cold load)
          if (!session?.access_token) {
            if (DEBUG) console.log('[Auth] No session in', event, '- skipping');
            return;
          }
          setAccessToken(session.access_token);
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
      } catch (err) {
        console.error('[Auth] onAuthStateChange error:', err);
        toggleAuthScreen(true);
        setAuthError(err.message || 'Authentication failed. Please try again.');
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
async function loadLayout() {
  state.layout = await fetchLayout();

  const hasAreas = Array.isArray(state.layout?.areas) && state.layout.areas.length > 0;
  const areasContainer = document.getElementById('storage-areas-container');
  const fridgeSection = document.querySelector('.fridge-section');
  const cellarZone = document.querySelector('#cellar-container')?.closest('.zone');

  // Show/hide section nav based on layout mode
  const gridSectionNav = document.getElementById('grid-section-nav');
  if (gridSectionNav) gridSectionNav.style.display = hasAreas ? 'none' : '';

  if (hasAreas) {
    // Show dynamic areas and hide legacy sections
    if (areasContainer) areasContainer.style.display = '';
    if (fridgeSection) fridgeSection.style.display = 'none';
    if (cellarZone) cellarZone.style.display = 'none';

    await renderStorageAreas();
  } else {
    // Show legacy fridge/cellar
    if (areasContainer) areasContainer.style.display = 'none';
    if (fridgeSection) fridgeSection.style.display = '';
    if (cellarZone) cellarZone.style.display = '';

    renderFridge();
    await renderCellar();
  }
}

/**
 * Load statistics.
 */
async function loadStats() {
  const stats = await fetchStats();
  state.stats = stats;
  document.getElementById('stat-total').textContent = stats.total_bottles;
  document.getElementById('stat-reduce').textContent = stats.reduce_now_count;
  document.getElementById('stat-empty').textContent = stats.empty_slots;

  // Update grape health indicator (non-blocking)
  import('./grapeIndicator.js')
    .then(m => m.renderGrapeIndicator(stats))
    .catch(() => { /* grape indicator is non-critical */ });
}

/**
 * Load wine list with reduce-now data.
 */
async function loadWineList() {
  const [winesResponse, reduceNow] = await Promise.all([
    fetchWines(),
    fetchReduceNow()
  ]);

  // Backend returns { data: [...], pagination: {...} }
  const wines = Array.isArray(winesResponse) ? winesResponse : (winesResponse.data || []);

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
async function loadHistory() {
  const data = await fetchConsumptionHistory();
  renderHistoryList(data.items);
}

/** Lazy-load guard for drink soon view. */
let drinkSoonLoaded = false;

/**
 * Load the Drink Soon view with wines approaching or past their optimal window.
 */
async function loadDrinkSoonView() {
  if (drinkSoonLoaded) return;
  drinkSoonLoaded = true;
  const container = document.getElementById('drink-soon-list');
  const summaryEl = document.getElementById('drink-soon-summary');
  if (!container) return;
  container.innerHTML = '<p class="text-muted">Loading…</p>';
  if (summaryEl) summaryEl.innerHTML = '';
  try {
    const wines = await fetchReduceNow();
    if (!wines || wines.length === 0) {
      container.innerHTML = '<p class="text-muted">No wines flagged as drink soon.</p>';
      return;
    }

    // Summary bar
    const overdueCount = wines.filter(w => w.priority === 1 || w.priority === '1').length;
    const soonCount = wines.length - overdueCount;
    if (summaryEl) {
      summaryEl.innerHTML = `
        <div class="drink-soon-summary-bar">
          <span class="drink-soon-stat">${wines.length} wine${wines.length !== 1 ? 's' : ''} to drink</span>
          ${overdueCount ? `<span class="drink-soon-stat urgency-now">${overdueCount} overdue</span>` : ''}
          ${soonCount ? `<span class="drink-soon-stat urgency-soon">${soonCount} approaching</span>` : ''}
        </div>`;
    }

    // Wine cards with Find Pairing button
    container.innerHTML = wines.map(w => {
      const urgencyClass = (w.priority === 1 || w.priority === '1') ? 'now' : 'soon';
      const urgencyLabel = urgencyClass === 'now' ? '⚠ Overdue' : '⏳ Drink Soon';
      return `
        <div class="drink-soon-card urgency-${urgencyClass}">
          <span class="colour-dot colour-${escapeHtml(w.colour || 'white')}"></span>
          <div class="drink-soon-card-info">
            <div class="drink-soon-card-name">${escapeHtml(w.wine_name || 'Unknown')}</div>
            ${w.vintage ? `<div class="drink-soon-card-vintage">${escapeHtml(String(w.vintage))}${w.reduce_reason ? ` — ${escapeHtml(w.reduce_reason)}` : ''}</div>` : ''}
          </div>
          <button class="btn btn-small btn-secondary drink-soon-pair-btn"
                  data-wine="${escapeHtml(w.wine_name || '')}" title="Find food pairing">🍷 Pair</button>
          <span class="drink-soon-tag ${urgencyClass}">${urgencyLabel}</span>
        </div>`;
    }).join('');

    // Wire pairing buttons
    container.querySelectorAll('.drink-soon-pair-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const wineName = btn.dataset.wine;
        switchView('pairing');
        setTimeout(() => {
          const dishInput = document.getElementById('dish-input');
          if (dishInput) {
            dishInput.value = `Pair with ${wineName}`;
            document.getElementById('ask-sommelier')?.click();
          }
        }, 150);
      });
    });

    // Settings link for rule adjustment
    container.insertAdjacentHTML('afterend',
      `<p class="drink-soon-settings-link">
        Adjust drink-soon rules in <button type="button" class="link-btn" id="drink-soon-go-settings">Settings</button>
      </p>`);
    document.getElementById('drink-soon-go-settings')?.addEventListener('click', () => {
      switchView('settings');
      setTimeout(() => {
        const section = document.querySelector('[data-section-id="drink-soon-rules"]');
        if (section) {
          const body = section.closest('.settings-section')?.querySelector('.settings-section-body');
          if (body?.classList.contains('collapsed')) section.click();
          section.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 150);
    });
  } catch (err) {
    console.error('[App] Failed to load drink soon view:', err);
    container.innerHTML = '<p class="text-muted">Failed to load drink soon wines.</p>';
  }
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

  let filtered = state.wineListData.filter(w => Number(w.bottle_count) > 0);

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
        return Number(b.bottle_count) - Number(a.bottle_count);
      case 'producer':
        return (a.producer || '').localeCompare(b.producer || '');
      case 'colour':
        return (a.colour || '').localeCompare(b.colour || '');
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
 * Render wine list as a sortable, inline-editable table.
 * Uses plain <table> (no virtual scrolling) so inline edit inputs are stable.
 * @param {Array} wines - Filtered wine list
 * @param {HTMLElement} container - Target container
 */
function renderWineTable(wines, container) {
  const COLOUR_OPTIONS = ['red', 'white', 'rose', 'orange', 'sparkling', 'dessert', 'fortified'];

  if (wines.length === 0) {
    container.innerHTML = '<p class="empty-message">No wines match your filters</p>';
    return;
  }

  const thead = `
    <thead>
      <tr>
        <th class="col-check"><input type="checkbox" id="wine-table-select-all" title="Select all"></th>
        <th class="col-colour"></th>
        <th class="col-name sortable" data-sort="name">Wine Name</th>
        <th class="col-producer sortable" data-sort="producer">Producer</th>
        <th class="col-vintage sortable" data-sort="vintage-asc">Vintage</th>
        <th class="col-colour-name sortable" data-sort="colour">Colour</th>
        <th class="col-style">Style</th>
        <th class="col-grapes">Grapes</th>
        <th class="col-region">Region</th>
        <th class="col-country sortable" data-sort="country">Country</th>
        <th class="col-qty sortable" data-sort="count">Qty</th>
        <th class="col-rating sortable" data-sort="rating">Rating</th>
        <th class="col-drink-window">Window</th>
        <th class="col-location">Location</th>
        <th class="col-actions">Actions</th>
      </tr>
    </thead>`;

  const rows = wines.map(wine => {
    const isReduceNow = state.reduceNowIds.has(wine.id);
    const colourClass = escapeHtml(wine.colour || '');
    const colourOptions = COLOUR_OPTIONS.map(c =>
      `<option value="${c}"${wine.colour === c ? ' selected' : ''}>${c.charAt(0).toUpperCase() + c.slice(1)}</option>`
    ).join('');

    return `
      <tr class="wine-table-row ${colourClass}${isReduceNow ? ' drink-soon-row' : ''}" data-wine-id="${wine.id}">
        <td class="col-check"><input type="checkbox" class="wine-row-check" data-wine-id="${wine.id}"></td>
        <td class="col-colour"><span class="colour-dot ${colourClass}" title="${colourClass}"></span></td>
        <td class="col-name editable" data-field="wine_name" data-wine-id="${wine.id}">${escapeHtml(wine.wine_name || '')}</td>
        <td class="col-producer editable" data-field="producer" data-wine-id="${wine.id}">${escapeHtml(wine.producer || '')}</td>
        <td class="col-vintage editable" data-field="vintage" data-type="integer" data-wine-id="${wine.id}">${wine.vintage || ''}</td>
        <td class="col-colour-name editable-select" data-field="colour" data-wine-id="${wine.id}">
          <select class="inline-select" data-field="colour" data-wine-id="${wine.id}">${colourOptions}</select>
        </td>
        <td class="col-style editable" data-field="style" data-wine-id="${wine.id}">${escapeHtml(wine.style || '')}</td>
        <td class="col-grapes editable" data-field="grapes" data-wine-id="${wine.id}">${escapeHtml(wine.grapes || '')}</td>
        <td class="col-region editable" data-field="region" data-wine-id="${wine.id}">${escapeHtml(wine.region || '')}</td>
        <td class="col-country editable" data-field="country" data-wine-id="${wine.id}">${escapeHtml(wine.country || '')}</td>
        <td class="col-qty">${Number(wine.bottle_count)}</td>
        <td class="col-rating">${wine.vivino_rating ? `★ ${wine.vivino_rating}` : '-'}</td>
        <td class="col-drink-window">${wine.drink_from || wine.drink_until ? `${wine.drink_from || '?'}–${wine.drink_until || '?'}` : '-'}</td>
        <td class="col-location">${escapeHtml(wine.locations || '-')}</td>
        <td class="col-actions">
          <button class="btn btn-small btn-secondary wine-table-view-btn" data-wine-id="${wine.id}" type="button" title="View details">View</button>
        </td>
      </tr>`;
  }).join('');

  container.innerHTML = `
    <div class="wine-table-toolbar" id="wine-table-toolbar" hidden>
      <span class="wine-table-selected-count" id="wine-table-selected-count">0 selected</span>
      <button class="btn btn-small btn-primary" id="wine-table-batch-ratings" type="button">Search Ratings</button>
      <button class="btn btn-small btn-secondary" id="wine-table-deselect-all" type="button">Deselect all</button>
    </div>
    <table class="wine-table"><tbody>${rows}</tbody></table>`;
  // Prepend thead inside the table
  const table = container.querySelector('.wine-table');
  table.insertAdjacentHTML('afterbegin', thead);

  // Multi-select: update toolbar visibility + count
  function updateSelectionUI() {
    const checked = container.querySelectorAll('.wine-row-check:checked');
    const toolbar = container.querySelector('#wine-table-toolbar');
    const countEl = container.querySelector('#wine-table-selected-count');
    const batchBtn = container.querySelector('#wine-table-batch-ratings');
    if (toolbar) toolbar.hidden = checked.length === 0;
    if (countEl) countEl.textContent = `${checked.length} selected`;
    if (batchBtn) batchBtn.textContent = `Search Ratings (${checked.length})`;
  }

  // Select-all checkbox
  const selectAll = container.querySelector('#wine-table-select-all');
  if (selectAll) {
    selectAll.addEventListener('change', () => {
      container.querySelectorAll('.wine-row-check').forEach(cb => { cb.checked = selectAll.checked; });
      updateSelectionUI();
    });
  }

  // Row checkboxes
  container.querySelectorAll('.wine-row-check').forEach(cb => {
    cb.addEventListener('change', () => {
      const allChecks = container.querySelectorAll('.wine-row-check');
      const checkedCount = container.querySelectorAll('.wine-row-check:checked').length;
      if (selectAll) selectAll.indeterminate = checkedCount > 0 && checkedCount < allChecks.length;
      if (selectAll) selectAll.checked = checkedCount === allChecks.length;
      updateSelectionUI();
    });
  });

  // Deselect-all button
  const deselectBtn = container.querySelector('#wine-table-deselect-all');
  if (deselectBtn) {
    deselectBtn.addEventListener('click', () => {
      container.querySelectorAll('.wine-row-check').forEach(cb => { cb.checked = false; });
      if (selectAll) { selectAll.checked = false; selectAll.indeterminate = false; }
      updateSelectionUI();
    });
  }

  // Bulk Search Ratings with polling progress
  const batchRatingsBtn = container.querySelector('#wine-table-batch-ratings');
  if (batchRatingsBtn) {
    batchRatingsBtn.addEventListener('click', async () => {
      const wineIds = [...container.querySelectorAll('.wine-row-check:checked')]
        .map(cb => Number(cb.dataset.wineId));
      if (wineIds.length === 0) return;
      batchRatingsBtn.disabled = true;
      batchRatingsBtn.textContent = 'Queuing…';
      try {
        const result = await batchFetchRatings(wineIds);
        showToast(`Queued ratings search for ${wineIds.length} wine${wineIds.length === 1 ? '' : 's'}`);
        // Poll job status until complete
        pollRatingsJob(result.jobId, batchRatingsBtn, wineIds.length);
      } catch (err) {
        showToast(`Error: ${err.message}`);
        batchRatingsBtn.disabled = false;
        updateSelectionUI();
      }
    });
  }

  // Wire inline-edit: click on editable cell → replace with input
  container.querySelectorAll('.editable').forEach(cell => {
    cell.addEventListener('click', () => startInlineEdit(cell));
  });

  // Wire colour select inline edits
  container.querySelectorAll('.inline-select').forEach(sel => {
    sel.addEventListener('change', async () => {
      const wineId = Number(sel.dataset.wineId);
      const field = sel.dataset.field;
      const value = sel.value;
      try {
        await updateWine(wineId, { [field]: value });
        // Update local state
        const wine = state.wineListData.find(w => w.id === wineId);
        if (wine) wine[field] = value;
        // Update row colour class
        const row = sel.closest('.wine-table-row');
        if (row) {
          COLOUR_OPTIONS.forEach(c => row.classList.remove(c));
          if (value) row.classList.add(value);
          row.querySelector('.colour-dot')?.setAttribute('class', `colour-dot ${value}`);
          row.querySelector('.colour-dot')?.setAttribute('title', value);
        }
        showToast('Saved');
      } catch (err) {
        showToast(`Error: ${err.message}`);
      }
    });
  });

  // Wire sort headers with visual arrow indicators
  container.querySelectorAll('.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const sortEl = document.getElementById('filter-sort');
      if (sortEl) {
        sortEl.value = th.dataset.sort;
        sortEl.dispatchEvent(new Event('change'));
      }
      // Update sort-asc/sort-desc CSS classes for arrow indicators
      container.querySelectorAll('.sortable').forEach(h => {
        h.classList.remove('sort-asc', 'sort-desc');
      });
      const sortKey = th.dataset.sort;
      const isDesc = sortKey === 'rating' || sortKey === 'count';
      th.classList.add(isDesc ? 'sort-desc' : 'sort-asc');
    });
  });

  // Wire view buttons
  container.querySelectorAll('.wine-table-view-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const wineId = Number(btn.dataset.wineId);
      const wine = wines.find(w => w.id === wineId);
      if (wine) showWineModalFromList(wine);
    });
  });
}

/**
 * Start inline cell editing for a table cell.
 * @param {HTMLElement} cell - The <td> element to make editable
 */
function startInlineEdit(cell) {
  if (cell.querySelector('input')) return; // Already editing

  const originalValue = cell.textContent.trim();
  const field = cell.dataset.field;
  const wineId = Number(cell.dataset.wineId);
  const dataType = cell.dataset.type || 'text';

  const input = document.createElement('input');
  input.type = dataType === 'integer' ? 'number' : 'text';
  input.value = originalValue;
  input.className = 'inline-edit-input';
  if (dataType === 'integer') {
    input.min = '1900';
    input.max = '2100';
    input.step = '1';
  }

  cell.textContent = '';
  cell.appendChild(input);
  input.focus();
  input.select();

  const saveEdit = async () => {
    const rawValue = input.value.trim();
    let value;
    if (dataType === 'integer') {
      value = rawValue === '' ? null : parseInt(rawValue, 10);
      if (value !== null && isNaN(value)) value = null;
    } else if (dataType === 'float') {
      value = rawValue === '' ? null : parseFloat(rawValue);
      if (value !== null && isNaN(value)) value = null;
    } else {
      value = rawValue === '' ? null : rawValue;
    }

    cell.textContent = rawValue || '';

    if (String(rawValue) !== String(originalValue)) {
      try {
        await updateWine(wineId, { [field]: value });
        // Update local state
        const wine = state.wineListData.find(w => w.id === wineId);
        if (wine) wine[field] = value;
        showToast('Saved');
      } catch (err) {
        cell.textContent = originalValue;
        showToast(`Error: ${err.message}`);
      }
    }
  };

  input.addEventListener('blur', saveEdit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { cell.textContent = originalValue; }
  });
}

/**
 * Poll a batch ratings job until complete, updating button text with progress.
 * @param {number} jobId - Job ID to poll
 * @param {HTMLElement} btn - The batch ratings button element
 * @param {number} totalCount - Number of wines queued
 */
function pollRatingsJob(jobId, btn, totalCount) {
  const POLL_INTERVAL = 3000;
  let pollTimer = null;

  async function tick() {
    try {
      const status = await getRatingsJobStatus(jobId);
      const completed = status.completed ?? 0;
      const total = status.total ?? totalCount;
      const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

      if (status.status === 'completed' || status.status === 'done') {
        btn.textContent = 'Search Ratings';
        btn.disabled = false;
        showToast(`Ratings search complete — ${completed}/${total} wines processed`);
        // Reload wine list to show new ratings
        loadWineList();
        return;
      }
      if (status.status === 'failed' || status.status === 'error') {
        btn.textContent = 'Search Ratings';
        btn.disabled = false;
        showToast(`Ratings search failed: ${status.error || 'unknown error'}`);
        return;
      }
      // Still in progress
      btn.textContent = `Searching… ${pct}% (${completed}/${total})`;
      pollTimer = setTimeout(tick, POLL_INTERVAL);
    } catch (err) {
      // Network error — stop polling gracefully
      btn.textContent = 'Search Ratings';
      btn.disabled = false;
      showToast(`Lost contact with ratings job: ${err.message}`);
    }
  }

  // Start first poll after a short delay
  pollTimer = setTimeout(tick, POLL_INTERVAL);
}

/**
 * Render wine list with current filters.
 * In table mode: plain <table> (no virtual scroll, supports inline edit).
 * In card mode: virtual scrolling for large lists.
 */
function renderWineList() {
  const container = document.getElementById('wine-list');
  const statsContainer = document.getElementById('wine-list-stats');
  const filtered = getFilteredWines();

  // Update stats
  const totalBottles = filtered.reduce((sum, w) => sum + Number(w.bottle_count), 0);
  const reduceCount = filtered.filter(w => state.reduceNowIds.has(w.id)).length;
  statsContainer.innerHTML = `
    <span>${filtered.length} wines</span>
    <span>${totalBottles} bottles</span>
    ${reduceCount > 0 ? `<span class="reduce-badge">${reduceCount} drink soon</span>` : ''}
  `;

  // Table mode: render plain table (no virtual scrolling — preserves inline edit state)
  if (wineViewMode === 'table') {
    if (state.virtualListActive) {
      destroyVirtualList();
      state.virtualListActive = false;
      container.classList.remove('virtual-mode');
    }
    cleanupNamespace(WINE_LIST_NAMESPACE);
    container.classList.add('table-mode');
    renderWineTable(filtered, container);
    return;
  }

  container.classList.remove('table-mode');

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
 * Initialize wine list filters and view toggle.
 */
function initWineListFilters() {
  const filterReduceNow = document.getElementById('filter-reduce-now');
  const filterColour = document.getElementById('filter-colour');
  const filterSort = document.getElementById('filter-sort');
  const filterSearch = document.getElementById('filter-search');
  const toggleTable = document.getElementById('view-toggle-table');
  const toggleCards = document.getElementById('view-toggle-cards');

  if (filterReduceNow) filterReduceNow.addEventListener('change', renderWineList);
  if (filterColour) filterColour.addEventListener('change', renderWineList);
  if (filterSort) filterSort.addEventListener('change', renderWineList);
  if (filterSearch) {
    filterSearch.addEventListener('input', debounce(renderWineList, 200));
  }

  // View toggle: table / cards
  const setViewMode = (mode) => {
    wineViewMode = mode;
    try { localStorage.setItem('wineViewMode', mode); } catch { /* ok */ }
    toggleTable?.classList.toggle('active', mode === 'table');
    toggleCards?.classList.toggle('active', mode === 'cards');
    renderWineList();
  };

  // Set initial toggle button state
  toggleTable?.classList.toggle('active', wineViewMode === 'table');
  toggleCards?.classList.toggle('active', wineViewMode === 'cards');

  if (toggleTable) toggleTable.addEventListener('click', () => setViewMode('table'));
  if (toggleCards) toggleCards.addEventListener('click', () => setViewMode('cards'));
}

/**
 * Initialize header stat button click navigation.
 */
function initStatButtons() {
  document.getElementById('stat-btn-total')?.addEventListener('click', () => {
    switchView('wines');
  });

  document.getElementById('stat-btn-reduce')?.addEventListener('click', () => {
    switchView('drinksoon');
  });

  document.getElementById('stat-btn-empty')?.addEventListener('click', () => {
    switchView('grid');
  });
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

  // Group same-wine + same-date entries: "Vouvray Reserve 2018 × 4"
  const grouped = [];
  for (const item of items) {
    const dateStr = new Date(item.consumed_at).toLocaleDateString('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric'
    });
    const key = `${item.wine_name}|${item.vintage || ''}|${dateStr}`;
    const last = grouped.length > 0 ? grouped[grouped.length - 1] : null;
    if (last && last._groupKey === key) {
      last._count++;
      // Keep the first item's details but collect any unique notes/pairings
      if (item.consumption_notes && !last._extraNotes.includes(item.consumption_notes)) {
        last._extraNotes.push(item.consumption_notes);
      }
    } else {
      grouped.push({
        ...item,
        _groupKey: key,
        _dateStr: dateStr,
        _count: 1,
        _extraNotes: item.consumption_notes ? [item.consumption_notes] : []
      });
    }
  }

  container.innerHTML = grouped.map(item => {
    const stars = item.consumption_rating
      ? '\u2605'.repeat(Math.floor(item.consumption_rating)) + '\u2606'.repeat(5 - Math.floor(item.consumption_rating))
      : '';
    const countBadge = item._count > 1 ? ` <span class="history-count">× ${item._count}</span>` : '';

    return `
      <div class="history-item ${escapeHtml(item.colour || '')}">
        <div class="history-date">${escapeHtml(item._dateStr)}</div>
        <div class="history-details">
          <div class="history-wine">${escapeHtml(item.wine_name)} ${escapeHtml(item.vintage) || 'NV'}${countBadge}</div>
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
 * Activate the specified parent tab and show its sub-tab row.
 * @param {string} parentName - Parent tab identifier
 */
function activateParentTab(parentName) {
  document.querySelectorAll('.tab[data-parent]').forEach(t => {
    const active = t.dataset.parent === parentName;
    t.classList.toggle('active', active);
    t.setAttribute('aria-selected', String(active));
  });
  document.querySelectorAll('.sub-tabs-row').forEach(row => {
    row.hidden = row.dataset.parent !== parentName;
  });
}

/**
 * Switch view.
 * @param {string} viewName - View to switch to
 */
export function switchView(viewName) {
  // Update view panels
  document.querySelectorAll('.view').forEach(v => {
    v.classList.remove('active');
    v.hidden = true;
  });

  // Activate parent tab and its sub-tab row
  activateParentTab(VIEW_TO_PARENT[viewName] || viewName);

  // Activate selected view
  const activeView = document.getElementById(`view-${viewName}`);
  if (activeView) {
    activeView.classList.add('active');
    activeView.hidden = false;
  }

  // Update sub-tab active state
  document.querySelectorAll('.sub-tab').forEach(t => {
    const active = t.dataset.view === viewName;
    t.classList.toggle('active', active);
    t.setAttribute('aria-selected', String(active));
  });

  state.currentView = viewName;

  // Close mobile menu after selection
  document.getElementById('tabs-container')?.classList.remove('open');
  document.getElementById('mobile-menu-btn')?.setAttribute('aria-expanded', 'false');

  if (viewName === 'wines') loadWineList();
  if (viewName === 'history') loadHistory();
  if (viewName === 'settings') loadSettings();
  if (viewName === 'drinksoon') loadDrinkSoonView();
  if (viewName === 'analysis') {
    loadAnalysis();
  }
  if (viewName === 'recipes') {
    // Lazy-load recipes module
    import('./recipes.js').then(m => m.loadRecipes()).catch(err => {
      console.error('[App] Failed to load recipes module:', err);
    });
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

    // Close menu when a parent tab or sub-tab is selected
    tabsContainer.addEventListener('click', (e) => {
      if (e.target.classList.contains('tab') || e.target.classList.contains('sub-tab')) {
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
