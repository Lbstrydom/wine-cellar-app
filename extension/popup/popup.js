/**
 * @fileoverview Popup controller — manages view states and orchestrates
 * auth check, wine extraction from the active tab, and add-to-plan flow.
 * Supports both single product pages and multi-wine cart/order pages.
 * @module extension/popup/popup
 */

import { getGaps, inferStyle, addToPlan } from '../shared/api.js';

// ── State ─────────────────────────────────────────────────────────────────────

/** @type {{ token: string, cellarId: string|null }|null} */
let currentAuth = null;

/** @type {object|null} Wine extracted from the active tab's content script */
let detectedWine = null;

/** @type {Array<object>|null} Multiple wines from cart/order pages */
let detectedWines = null;

// ── DOM refs ──────────────────────────────────────────────────────────────────

const STATES = {
  loading:         document.getElementById('state-loading'),
  unauthenticated: document.getElementById('state-unauthenticated'),
  product:         document.getElementById('state-product'),
  cart:            document.getElementById('state-cart'),
  gaps:            document.getElementById('state-gaps')
};

// ── Wine extraction ───────────────────────────────────────────────────────────

/**
 * Extract wine data from the given tab.
 *
 * Phase A — message the already-injected content script (fast path).
 * Phase B — if content script isn't loaded, inject extractors.js
 *           programmatically via chrome.scripting.executeScript.
 *
 * @param {number} tabId
 * @returns {Promise<object|null>}
 */
async function extractWineFromTab(tabId) {
  // Phase A: try the pre-injected content script
  try {
    const resp = await chrome.tabs.sendMessage(tabId, { type: 'EXTRACT_WINE' });
    if (resp?.wine) return resp.wine;
  } catch (_) {
    // Content script not loaded — fall through to Phase B
  }

  // Phase B: programmatic injection via scripting API
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['shared/extractors.js']
    });
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => (typeof window.WineExtractors !== 'undefined'
        ? window.WineExtractors.extractWineFromPage()
        : null)
    });
    return result || null;
  } catch (_) {
    return null;
  }
}

/**
 * Extract multiple wines from a cart/order page.
 * Uses the same two-phase approach as single extraction.
 * @param {number} tabId
 * @returns {Promise<Array<object>|null>}
 */
async function extractMultipleWinesFromTab(tabId) {
  // Phase A: try the pre-injected content script
  try {
    const resp = await chrome.tabs.sendMessage(tabId, { type: 'EXTRACT_WINES_MULTI' });
    if (resp?.wines?.length) return resp.wines;
  } catch (_) {}

  // Phase B: programmatic injection
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['shared/extractors.js']
    });
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => (typeof window.WineExtractors !== 'undefined'
        ? window.WineExtractors.extractMultipleWines()
        : null)
    });
    return result?.length ? result : null;
  } catch (_) {
    return null;
  }
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

async function init() {
  showState('loading');

  // 1. Get auth from service worker storage
  let { auth } = await chrome.runtime.sendMessage({ type: 'GET_AUTH' });

  // 2. If nothing stored, actively pull auth from any open Wine Cellar app tab
  if (!auth?.token) {
    auth = await pullAuthFromAppTab();
    if (auth?.token) {
      await chrome.runtime.sendMessage({ type: 'AUTH_FROM_APP', payload: auth });
    }
  }

  if (!auth?.token) {
    showState('unauthenticated');
    return;
  }
  currentAuth = auth;

  // 3. Extract wine(s) from the active tab
  const tab = await getActiveTab();
  if (tab?.id) {
    // Try multi-wine extraction first (cart/order pages)
    detectedWines = await extractMultipleWinesFromTab(tab.id);
    // If no multi-wine result, try single product extraction
    if (!detectedWines) {
      detectedWine = await extractWineFromTab(tab.id);
    }
  }

  // 4. Fetch gap summary
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
  }

  if (detectedWines?.length) {
    renderCartView(detectedWines);
  } else if (detectedWine) {
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

  document.getElementById('confirm-wine-name').value = wine.wine_name || '';
  document.getElementById('confirm-producer').value = wine.producer || '';
  document.getElementById('confirm-vintage').value = wine.vintage != null ? String(wine.vintage) : '';
  document.getElementById('confirm-region').value = wine.region || '';
  document.getElementById('confirm-country').value = wine.country || '';

  const vintageInput = document.getElementById('confirm-vintage');
  const vintageHint = document.getElementById('confirm-vintage-hint');
  const toggleVintageHint = () => {
    vintageHint.classList.toggle('hidden', !!vintageInput.value.trim());
  };
  toggleVintageHint();
  vintageInput.oninput = toggleVintageHint;

  const gaps = gapsData?.gaps?.slice(0, 3) || [];
  document.getElementById('gaps-mini').innerHTML = gaps.length
    ? gaps.map(renderGapMini).join('')
    : '<p class="no-gaps-mini">Cellar is well covered!</p>';

  showState('product');
}

/**
 * Render the cart/order multi-wine import view.
 * @param {Array<object>} wines
 */
function renderCartView(wines) {
  const totalBottles = wines.reduce((sum, w) => sum + (w.quantity || 1), 0);
  document.getElementById('cart-summary').innerHTML =
    `<span class="cart-count">${wines.length} wine${wines.length !== 1 ? 's' : ''}</span>` +
    `<span class="cart-bottles">${totalBottles} bottle${totalBottles !== 1 ? 's' : ''} total</span>`;

  const listEl = document.getElementById('cart-list');
  listEl.innerHTML = wines.map((wine, i) => {
    const qty = wine.quantity || 1;
    const priceStr = wine.price != null ? formatCurrency(wine.price, wine.currency) : '';
    const vintageStr = wine.vintage ? ` (${wine.vintage})` : '';
    return `<div class="cart-item" data-index="${i}">
      <label class="cart-item-check">
        <input type="checkbox" checked data-wine-index="${i}" />
      </label>
      <div class="cart-item-info">
        <div class="cart-item-name">${esc(wine.wine_name)}${vintageStr}</div>
        <div class="cart-item-meta">
          ${qty > 1 ? `x${qty}` : ''}${priceStr ? ` · ${priceStr}/btl` : ''}
        </div>
      </div>
    </div>`;
  }).join('');

  showState('cart');
}

/** @param {object|null} gapsData */
function renderGapsView(gapsData) {
  const styles = gapsData?.styles || [];
  const gapCount = styles.filter(s => !s.isCovered).length;
  const coveredCount = styles.filter(s => s.isCovered).length;
  const total = styles.length;

  const summaryEl = document.getElementById('coverage-summary');
  if (total > 0) {
    const allGood = gapCount === 0;
    summaryEl.innerHTML = `
      <div class="coverage-summary-title">Style coverage</div>
      <span class="coverage-fraction">${coveredCount}/${total}</span>
      <span class="${allGood ? 'coverage-all-good' : 'coverage-word'}">
        ${allGood ? '-- all styles covered' : `style${coveredCount !== 1 ? 's' : ''} covered`}
      </span>`;
  } else {
    summaryEl.innerHTML = `<div class="coverage-summary-title">Style coverage</div>`;
  }

  const listEl = document.getElementById('styles-list');
  if (styles.length === 0) {
    listEl.innerHTML = `<p class="no-styles-msg">No buying guide targets set.<br>
      Open the app to configure your style preferences.</p>`;
  } else {
    listEl.innerHTML = styles.map(renderStyleRow).join('');
  }

  showState('gaps');
}

/**
 * @param {{ label: string, have: number, target: number, deficit: number, isCovered: boolean }} style
 * @returns {string}
 */
function renderStyleRow(style) {
  const covered = style.isCovered;
  const bottlesText = covered
    ? `${style.have}/${style.target}`
    : `need ${style.deficit}`;
  return `<div class="style-row${covered ? '' : ' is-gap'}">
    <span class="style-status ${covered ? 'covered' : 'gap'}">${covered ? '✓' : '✕'}</span>
    <span class="style-label">${esc(style.label)}</span>
    <span class="style-bottles${covered ? '' : ' need'}">${bottlesText}</span>
  </div>`;
}

/** @param {object} gap @returns {string} */
function renderGapMini(gap) {
  const deficit = gap.projectedDeficit ?? gap.deficit ?? 0;
  return `<div class="gap-mini">
    <span class="gap-mini-label">${esc(gap.label)}</span>
    <span class="gap-mini-deficit">need ${deficit}</span>
  </div>`;
}

// ── Add-to-plan flow (single wine) ──────────────────────────────────────────

async function handleAddToPlan() {
  if (!detectedWine || !currentAuth) return;

  const btn = document.getElementById('add-to-plan-btn');
  const feedback = document.getElementById('add-feedback');

  btn.disabled = true;
  btn.textContent = 'Adding…';
  feedback.className = 'feedback hidden';

  try {
    const confirmedWine = getConfirmedWine();

    if (!confirmedWine.wine_name) {
      throw new Error('Wine name is required');
    }

    const hasVintage = confirmedWine.vintage != null;
    if (!hasVintage) {
      const proceed = window.confirm(
        'Vintage is missing. Search quality can be lower without a vintage. Continue anyway?'
      );
      if (!proceed) {
        btn.disabled = false;
        btn.textContent = '+ Add to Plan';
        return;
      }
    }

    let styleId = null;
    try {
      const styleResp = await inferStyle({
        wine_name: confirmedWine.wine_name,
        producer: confirmedWine.producer || undefined,
        region: confirmedWine.region || undefined,
        country: confirmedWine.country || undefined
      }, currentAuth);
      styleId = styleResp?.data?.styleId || null;
    } catch (_) {}

    await addToPlan({
      wine_name: confirmedWine.wine_name,
      producer:  confirmedWine.producer || null,
      vintage:   confirmedWine.vintage,
      region:    confirmedWine.region || null,
      country:   confirmedWine.country || null,
      price:     detectedWine.price || null,
      currency:  detectedWine.currency || 'ZAR',
      vendor_url: detectedWine.vendor_url,
      style_id:  styleId
    }, currentAuth);

    chrome.runtime.sendMessage({ type: 'ITEM_ADDED' }).catch(() => {});

    btn.textContent = '✓ Added to Plan';
    btn.classList.add('btn-success');
    feedback.textContent = `"${confirmedWine.wine_name}" added to your buying plan.`;
    feedback.className = 'feedback feedback-success';

  } catch (err) {
    btn.disabled = false;
    btn.textContent = '+ Add to Plan';
    feedback.textContent = `Error: ${err.message}`;
    feedback.className = 'feedback feedback-error';
  }
}

// ── Add-to-plan flow (batch cart import) ────────────────────────────────────

async function handleImportAll() {
  if (!detectedWines?.length || !currentAuth) return;

  const btn = document.getElementById('import-all-btn');
  const feedback = document.getElementById('cart-feedback');

  // Get selected wines from checkboxes
  const checkboxes = document.querySelectorAll('#cart-list input[type="checkbox"]');
  const selectedIndices = [];
  checkboxes.forEach(cb => {
    if (cb.checked) selectedIndices.push(parseInt(cb.dataset.wineIndex, 10));
  });

  if (selectedIndices.length === 0) {
    feedback.textContent = 'No wines selected.';
    feedback.className = 'feedback feedback-error';
    return;
  }

  const selectedWines = selectedIndices.map(i => detectedWines[i]).filter(Boolean);

  btn.disabled = true;
  btn.textContent = `Importing ${selectedWines.length}…`;
  feedback.className = 'feedback hidden';

  let added = 0;
  let failed = 0;

  for (const wine of selectedWines) {
    try {
      let styleId = null;
      try {
        const styleResp = await inferStyle({
          wine_name: wine.wine_name,
          producer: wine.producer || undefined
        }, currentAuth);
        styleId = styleResp?.data?.styleId || null;
      } catch (_) {}

      await addToPlan({
        wine_name: wine.wine_name,
        producer:  wine.producer || null,
        vintage:   wine.vintage || null,
        price:     wine.price || null,
        currency:  wine.currency || 'EUR',
        vendor_url: wine.vendor_url,
        style_id:  styleId
      }, currentAuth);

      added++;
      btn.textContent = `Importing… ${added}/${selectedWines.length}`;
    } catch (err) {
      failed++;
      if (err.message === 'AUTH_EXPIRED') {
        await chrome.runtime.sendMessage({ type: 'SIGN_OUT' });
        showState('unauthenticated');
        return;
      }
    }
  }

  chrome.runtime.sendMessage({ type: 'ITEM_ADDED' }).catch(() => {});

  if (failed === 0) {
    btn.textContent = `✓ ${added} wine${added !== 1 ? 's' : ''} imported`;
    btn.classList.add('btn-success');
    feedback.textContent = `Successfully added ${added} wine${added !== 1 ? 's' : ''} to your buying plan.`;
    feedback.className = 'feedback feedback-success';
  } else {
    btn.disabled = false;
    btn.textContent = '+ Import All to Plan';
    feedback.textContent = `Added ${added}, failed ${failed}. Check your connection and try again.`;
    feedback.className = 'feedback feedback-error';
  }
}

/**
 * Read and normalize user-confirmed wine details from popup inputs.
 * @returns {{ wine_name: string, producer: string|null, vintage: number|null, region: string|null, country: string|null }}
 */
function getConfirmedWine() {
  const wineName = document.getElementById('confirm-wine-name')?.value?.trim() || '';
  const producer = document.getElementById('confirm-producer')?.value?.trim() || null;
  const region = document.getElementById('confirm-region')?.value?.trim() || null;
  const country = document.getElementById('confirm-country')?.value?.trim() || null;
  const vintageRaw = document.getElementById('confirm-vintage')?.value?.trim() || '';

  let vintage = null;
  if (vintageRaw && !/^NV$/i.test(vintageRaw)) {
    const parsed = parseInt(vintageRaw, 10);
    if (!Number.isInteger(parsed) || parsed < 1900 || parsed > 2100) {
      throw new Error('Vintage must be a year between 1900 and 2100, or NV');
    }
    vintage = parsed;
  }

  return { wine_name: wineName, producer, vintage, region, country };
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

/**
 * Actively query any open cellar.creathyst.com tab for the Supabase session.
 * @returns {Promise<{token: string, expiresAt: number, userId: string|null}|null>}
 */
async function pullAuthFromAppTab() {
  try {
    const appTabs = await chrome.tabs.query({ url: '*://cellar.creathyst.com/*' });
    for (const tab of appTabs) {
      try {
        const resp = await chrome.tabs.sendMessage(tab.id, { type: 'SYNC_AUTH' });
        if (resp?.token) return resp;
      } catch (_) {}
    }
  } catch (_) {}
  return null;
}

// ── Event wiring ──────────────────────────────────────────────────────────────

document.getElementById('add-to-plan-btn').addEventListener('click', handleAddToPlan);
document.getElementById('import-all-btn').addEventListener('click', handleImportAll);

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
