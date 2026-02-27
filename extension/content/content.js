/**
 * @fileoverview Content script - syncs Supabase auth from the app domain,
 * and extracts wine data from the current page on request.
 *
 * Loaded after shared/extractors.js (which defines window.WineExtractors).
 */

(function () {
  'use strict';

  const APP_HOSTNAME = 'cellar.creathyst.com';

  // ── Auth sync (app domain only) ──────────────────────────────────────────────

  if (window.location.hostname === APP_HOSTNAME) {
    syncAuthFromApp();
  }

  /**
   * Read the Supabase session from localStorage and send it to the service worker.
   * Supabase v2 stores the session under the key `sb-{project-ref}-auth-token`.
   */
  function syncAuthFromApp() {
    try {
      const keys = Object.keys(localStorage).filter(k => k.endsWith('-auth-token'));
      for (const key of keys) {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        let session;
        try {
          session = JSON.parse(raw);
        } catch (_) {
          continue;
        }
        if (!session?.access_token) continue;

        chrome.runtime.sendMessage({
          type: 'AUTH_FROM_APP',
          payload: {
            token: session.access_token,
            expiresAt: session.expires_at || 0,
            userId: session.user?.id || null
          }
        }).catch(() => {
          // Extension context may be invalid during page load — ignore
        });
        break; // First valid session is enough
      }
    } catch (_) {
      // localStorage may be inaccessible (e.g., file:// pages) — ignore
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
      return false; // Synchronous response — no need to hold channel open
    }
  });

})();
