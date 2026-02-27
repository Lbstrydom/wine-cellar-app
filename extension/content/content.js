/**
 * @fileoverview Content script - syncs Supabase auth from the app domain,
 * and extracts wine data from the current page on request.
 *
 * Loaded after shared/extractors.js (which defines window.WineExtractors).
 *
 * Auth storage: the app uses a custom Supabase storageKey ('wine-cellar-auth')
 * rather than the default 'sb-{ref}-auth-token'. The value is still a standard
 * Supabase session JSON: { access_token, expires_at, user: { id } }.
 * The active cellar is stored separately under 'active_cellar_id'.
 */

(function () {
  'use strict';

  const APP_HOSTNAME = 'cellar.creathyst.com';

  /** The custom Supabase storageKey used by this app (set in app.js). */
  const AUTH_STORAGE_KEY = 'wine-cellar-auth';
  const CELLAR_STORAGE_KEY = 'active_cellar_id';

  // ── Auth sync (app domain only) ──────────────────────────────────────────────

  if (window.location.hostname === APP_HOSTNAME) {
    syncAuthFromApp();
  }

  /**
   * Read the Supabase session from localStorage and send it to the service worker.
   * The app stores the session under the custom key 'wine-cellar-auth'.
   */
  function syncAuthFromApp() {
    const auth = readAppAuth();
    if (!auth) return;

    chrome.runtime.sendMessage({
      type: 'AUTH_FROM_APP',
      payload: auth
    }).catch(() => {
      // Extension context may be invalid during page load — ignore
    });
  }

  /**
   * Read auth payload from the app's localStorage keys.
   * Returns { token, expiresAt, userId, cellarId } or null if not found.
   */
  function readAppAuth() {
    try {
      const raw = localStorage.getItem(AUTH_STORAGE_KEY);
      if (!raw) return null;

      let session;
      try {
        session = JSON.parse(raw);
      } catch (_) {
        return null;
      }

      if (!session?.access_token) return null;

      return {
        token: session.access_token,
        expiresAt: session.expires_at || 0,
        userId: session.user?.id || null,
        cellarId: localStorage.getItem(CELLAR_STORAGE_KEY) || null
      };
    } catch (_) {
      // localStorage may be inaccessible (e.g., file:// pages)
      return null;
    }
  }

  // ── Message listener ─────────────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'EXTRACT_WINE') {
      try {
        const wine = window.WineExtractors
          ? window.WineExtractors.extractWineFromPage()
          : null;
        sendResponse({ wine });
      } catch (err) {
        sendResponse({ wine: null, error: err.message });
      }
      return false;
    }

    // SYNC_AUTH: popup pulls auth on demand from an open app tab.
    // More reliable than the push approach because MV3 service workers
    // are often terminated before the push message arrives.
    if (msg.type === 'SYNC_AUTH') {
      if (window.location.hostname !== APP_HOSTNAME) {
        sendResponse(null);
        return false;
      }
      sendResponse(readAppAuth());
      return false;
    }
  });

})();
