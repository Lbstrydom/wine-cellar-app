/**
 * @fileoverview Settings page controller — manages connection status display
 * and cellar selection for the extension.
 * @module extension/settings/settings
 */

import { getCellars } from '../shared/api.js';

// ── State ─────────────────────────────────────────────────────────────────────

/** @type {{ token: string, cellarId: string|null, userId: string|null }|null} */
let currentAuth = null;

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  const { auth } = await chrome.runtime.sendMessage({ type: 'GET_AUTH' });
  currentAuth = auth;
  renderAuthState(auth);
  if (auth?.token) {
    await loadCellars(auth);
  }
}

// ── Auth state render ─────────────────────────────────────────────────────────

/**
 * Update the connection card to reflect current auth state.
 * @param {{ token: string, userId: string|null }|null} auth
 */
function renderAuthState(auth) {
  const statusEl      = document.getElementById('connection-status');
  const subEl         = document.getElementById('connection-sub');
  const connectBtn    = document.getElementById('connect-btn');
  const disconnectBtn = document.getElementById('disconnect-btn');

  if (auth?.token) {
    statusEl.textContent = '● Connected';
    statusEl.className   = 'badge-connected';
    if (auth.userId) {
      subEl.textContent = `User ID: ${auth.userId.slice(0, 8)}…`;
      subEl.classList.remove('hidden');
    }
    connectBtn.classList.add('hidden');
    disconnectBtn.classList.remove('hidden');
  } else {
    statusEl.textContent = '● Not connected';
    statusEl.className   = 'badge-disconnected';
    subEl.classList.add('hidden');
    connectBtn.classList.remove('hidden');
    disconnectBtn.classList.add('hidden');
  }
}

// ── Cellar loading ────────────────────────────────────────────────────────────

/**
 * Fetch user cellars and populate the select. Auto-hides the card for
 * single-cellar users and auto-selects when only one cellar exists.
 * @param {{ token: string, cellarId: string|null }} auth
 */
async function loadCellars(auth) {
  const select   = document.getElementById('cellar-select');
  const statusEl = document.getElementById('cellar-status');
  const card     = document.getElementById('cellar-card');

  try {
    const resp = await getCellars(auth);
    const cellars = resp?.data || [];

    if (cellars.length === 0) {
      select.innerHTML = '<option value="">No cellars found</option>';
      return;
    }

    select.innerHTML = cellars
      .map(c => `<option value="${esc(c.id)}">${esc(c.name)} (${esc(c.role)})</option>`)
      .join('');

    // Pre-select stored cellar
    if (auth.cellarId) {
      select.value = auth.cellarId;
    }

    // Single cellar: auto-select silently and hide the card
    if (cellars.length === 1) {
      if (!auth.cellarId) {
        await chrome.runtime.sendMessage({ type: 'SET_CELLAR', cellarId: cellars[0].id });
        currentAuth = { ...currentAuth, cellarId: cellars[0].id };
      }
      card.classList.add('hidden');
    }

  } catch (err) {
    statusEl.textContent = `Error loading cellars: ${err.message}`;
    statusEl.className   = 'status-msg error';
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * HTML-escape a string.
 * @param {unknown} str
 * @returns {string}
 */
function esc(str) {
  return String(str ?? '').replace(
    /[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

// ── Event wiring ──────────────────────────────────────────────────────────────

document.getElementById('connect-btn').addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://cellar.creathyst.com' });
});

document.getElementById('disconnect-btn').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'SIGN_OUT' });
  currentAuth = null;
  renderAuthState(null);
  document.getElementById('cellar-select').innerHTML = '<option value="">—</option>';
  document.getElementById('cellar-card').classList.remove('hidden');
});

document.getElementById('cellar-select').addEventListener('change', async (e) => {
  const cellarId = e.target.value;
  if (!cellarId) return;

  const statusEl = document.getElementById('cellar-status');
  try {
    await chrome.runtime.sendMessage({ type: 'SET_CELLAR', cellarId });
    currentAuth = { ...currentAuth, cellarId };
    statusEl.textContent = 'Cellar updated ✓';
    statusEl.className   = 'status-msg success';
    setTimeout(() => { statusEl.textContent = ''; }, 2500);
  } catch (err) {
    statusEl.textContent = `Error: ${err.message}`;
    statusEl.className   = 'status-msg error';
  }
});

// ── Boot ──────────────────────────────────────────────────────────────────────

init().catch(err => {
  console.error('[Wine Cellar Settings] init error:', err);
});
