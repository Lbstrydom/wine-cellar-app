/**
 * @fileoverview Popup controller — manages three view states and orchestrates
 * auth check, wine extraction from the active tab, and add-to-plan flow.
 * @module extension/popup/popup
 */

import { getGaps, inferStyle, addToPlan } from '../shared/api.js';

// ── State ─────────────────────────────────────────────────────────────────────

/** @type {{ token: string, cellarId: string|null }|null} */
let currentAuth = null;

/** @type {object|null} Wine extracted from the active tab's content script */
let detectedWine = null;

// ── DOM refs ──────────────────────────────────────────────────────────────────

const STATES = {
  loading:         document.getElementById('state-loading'),
  unauthenticated: document.getElementById('state-unauthenticated'),
  product:         document.getElementById('state-product'),
  gaps:            document.getElementById('state-gaps')
};

// ── Lifecycle ─────────────────────────────────────────────────────────────────

async function init() {
  showState('loading');

  // 1. Get auth from service worker
  const { auth } = await chrome.runtime.sendMessage({ type: 'GET_AUTH' });
  if (!auth?.token) {
    showState('unauthenticated');
    return;
  }
  currentAuth = auth;

  // 2. Ask content script to extract wine from the active tab
  const tab = await getActiveTab();
  if (tab?.id) {
    try {
      const resp = await chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_WINE' });
      detectedWine = resp?.wine || null;
    } catch (_) {
      // Content script not injected (internal page, PDF, etc.) — ignore
      detectedWine = null;
    }
  }

  // 3. Fetch gap summary (used in both product + gaps views)
  let gapsData = null;
  try {
    const gapsResp = await getGaps(currentAuth);
    gapsData = gapsResp?.data || null;
  } catch (err) {
    if (err.message === 'AUTH_EXPIRED') {
      await chrome.runtime.sendMessage({ type: 'SIGN_OUT' });
      showState('unauthenticated');
      return;
    }
    // Non-auth error: continue without gaps (graceful degradation)
  }

  if (detectedWine) {
    renderProductView(detectedWine, gapsData);
  } else {
    renderGapsView(gapsData);
  }
}

// ── View renderers ────────────────────────────────────────────────────────────

/**
 * @param {object} wine
 * @param {object|null} gapsData
 */
function renderProductView(wine, gapsData) {
  document.getElementById('product-name').textContent = wine.wine_name;

  const parts = [
    wine.producer,
    wine.vintage,
    wine.price != null ? formatCurrency(wine.price, wine.currency) : null
  ].filter(Boolean);
  document.getElementById('product-meta').textContent = parts.join(' · ');

  const gaps = gapsData?.gaps?.slice(0, 3) || [];
  document.getElementById('gaps-mini').innerHTML = gaps.length
    ? gaps.map(renderGapMini).join('')
    : '<p class="no-gaps-mini">Cellar is well covered!</p>';

  showState('product');
}

/** @param {object|null} gapsData */
function renderGapsView(gapsData) {
  const gaps = gapsData?.gaps || [];
  if (gaps.length === 0) {
    document.getElementById('gaps-list').classList.add('hidden');
    document.getElementById('no-gaps').classList.remove('hidden');
  } else {
    document.getElementById('gaps-list').innerHTML = gaps.map(renderGapCard).join('');
    document.getElementById('gaps-list').classList.remove('hidden');
    document.getElementById('no-gaps').classList.add('hidden');
  }
  showState('gaps');
}

/** @param {object} gap @returns {string} */
function renderGapMini(gap) {
  const deficit = gap.projectedDeficit ?? gap.deficit ?? 0;
  return `<div class="gap-mini">
    <span class="gap-mini-label">${esc(gap.label)}</span>
    <span class="gap-mini-deficit">${deficit} needed</span>
  </div>`;
}

/** @param {object} gap @returns {string} */
function renderGapCard(gap) {
  const deficit = gap.projectedDeficit ?? gap.deficit ?? 0;
  const pct = Math.min(Math.round((gap.coveragePct || 0) * 100), 100);
  return `<div class="gap-card">
    <div class="gap-card-header">
      <span class="gap-label">${esc(gap.label)}</span>
      <span class="gap-deficit">${deficit} bottle${deficit !== 1 ? 's' : ''} needed</span>
    </div>
    <div class="gap-bar-track">
      <div class="gap-bar-fill" style="width:${pct}%"></div>
    </div>
  </div>`;
}

// ── Add-to-plan flow ──────────────────────────────────────────────────────────

async function handleAddToPlan() {
  if (!detectedWine || !currentAuth) return;

  const btn = document.getElementById('add-to-plan-btn');
  const feedback = document.getElementById('add-feedback');

  btn.disabled = true;
  btn.textContent = 'Adding…';
  feedback.className = 'feedback hidden';

  try {
    // Infer style (best-effort — failure is non-fatal)
    let styleId = null;
    try {
      const styleResp = await inferStyle({
        wine_name: detectedWine.wine_name,
        producer: detectedWine.producer || undefined
      }, currentAuth);
      styleId = styleResp?.data?.styleId || null;
    } catch (_) {
      // Style inference is optional; proceed without it
    }

    await addToPlan({
      wine_name: detectedWine.wine_name,
      producer:  detectedWine.producer || null,
      vintage:   detectedWine.vintage  || null,
      price:     detectedWine.price    || null,
      currency:  detectedWine.currency || 'ZAR',
      vendor_url: detectedWine.vendor_url,
      style_id:  styleId
    }, currentAuth);

    // Notify service worker → shows green badge
    chrome.runtime.sendMessage({ type: 'ITEM_ADDED' }).catch(() => {});

    btn.textContent = '✓ Added to Plan';
    btn.classList.add('btn-success');
    feedback.textContent = `"${detectedWine.wine_name}" added to your buying plan.`;
    feedback.className = 'feedback feedback-success';

  } catch (err) {
    btn.disabled = false;
    btn.textContent = '+ Add to Plan';
    feedback.textContent = `Error: ${err.message}`;
    feedback.className = 'feedback feedback-error';
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Show one state, hide all others. @param {string} name */
function showState(name) {
  for (const [key, el] of Object.entries(STATES)) {
    el.classList.toggle('hidden', key !== name);
  }
}

/** Get the current active tab. @returns {Promise<chrome.tabs.Tab|null>} */
async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

/**
 * Format a price with currency symbol.
 * @param {number} price
 * @param {string|null} currency
 * @returns {string}
 */
function formatCurrency(price, currency) {
  const sym = { ZAR: 'R', EUR: '€', GBP: '£', USD: '$' }[currency] || (currency || '');
  return `${sym}${price.toFixed(2)}`;
}

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

document.getElementById('add-to-plan-btn').addEventListener('click', handleAddToPlan);

document.getElementById('open-app-btn').addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://cellar.creathyst.com' });
  window.close();
});

document.getElementById('settings-btn').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

// ── Boot ──────────────────────────────────────────────────────────────────────

init().catch(err => {
  console.error('[Wine Cellar] Popup init error:', err);
  showState('unauthenticated');
});
