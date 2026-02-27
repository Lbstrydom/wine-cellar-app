/**
 * @fileoverview Extension service worker - handles auth storage, badge management,
 * and message routing between popup/settings and content scripts.
 * @module extension/background/service_worker
 */

const BADGE_DURATION_MS = 4000;

// ── Auth ──────────────────────────────────────────────────────────────────────

/**
 * Retrieve stored auth from chrome.storage.sync.
 * Returns null if token is missing or expired (with 60 s early-expiry buffer).
 * @returns {Promise<{token: string, expiresAt: number, cellarId: string|null}|null>}
 */
async function getStoredAuth() {
  const { auth } = await chrome.storage.sync.get('auth');
  if (!auth?.token) return null;
  // Treat as expired 60 s early to avoid edge-case 401s
  if (Date.now() / 1000 > (auth.expiresAt || 0) - 60) return null;
  return auth;
}

/**
 * Store auth payload in chrome.storage.sync.
 * @param {{ token: string, expiresAt: number, userId: string|null }} payload
 */
async function storeAuth(payload) {
  // Preserve existing cellarId if already set
  const existing = await chrome.storage.sync.get('auth');
  await chrome.storage.sync.set({
    auth: {
      cellarId: existing?.auth?.cellarId || null,
      ...payload
    }
  });
}

/** Clear stored auth and cellar selection. */
async function clearAuth() {
  await chrome.storage.sync.remove('auth');
}

// ── Badge ─────────────────────────────────────────────────────────────────────

let badgeTimer = null;

/** Show a green "+1" badge on the toolbar icon for BADGE_DURATION_MS. */
function showAddedBadge() {
  chrome.action.setBadgeText({ text: '+1' });
  chrome.action.setBadgeBackgroundColor({ color: '#27ae60' });
  if (badgeTimer) clearTimeout(badgeTimer);
  badgeTimer = setTimeout(() => {
    chrome.action.setBadgeText({ text: '' });
    badgeTimer = null;
  }, BADGE_DURATION_MS);
}

// ── Message handler ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handle = async () => {
    switch (msg.type) {

      case 'AUTH_FROM_APP': {
        // Sent by content.js when it detects a Supabase session on the app domain
        await storeAuth(msg.payload);
        return { ok: true };
      }

      case 'GET_AUTH': {
        const auth = await getStoredAuth();
        return { auth };
      }

      case 'SET_CELLAR': {
        const { auth } = await chrome.storage.sync.get('auth');
        if (auth) {
          await chrome.storage.sync.set({ auth: { ...auth, cellarId: msg.cellarId } });
        }
        return { ok: true };
      }

      case 'SIGN_OUT': {
        await clearAuth();
        return { ok: true };
      }

      case 'ITEM_ADDED': {
        showAddedBadge();
        return { ok: true };
      }

      default:
        return { error: `Unknown message type: ${msg.type}` };
    }
  };

  handle()
    .then(sendResponse)
    .catch(err => sendResponse({ error: err.message }));

  return true; // Keep the message channel open for async response
});
