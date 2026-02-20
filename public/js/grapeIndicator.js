/**
 * @fileoverview Grape identification status indicator for the cellar grid header.
 * Shows a color-coded pill with percentage + "Identify" button that expands
 * an inline preview panel with grapeAutocomplete for overrides.
 * @module grapeIndicator
 */

import { backfillGrapes, searchGrapes, updateWine } from './api.js';
import { showToast, escapeHtml } from './utils.js';
import { initGrapeAutocomplete } from './grapeAutocomplete.js';

const INDICATOR_CLASS = 'grape-indicator';
const PANEL_CLASS = 'grape-indicator-panel';

/** Track active grapeAutocomplete instances for cleanup. */
let _acInstances = [];

/**
 * Render or update the grape health indicator pill inside a cellar zone-header.
 * Reads grape_total and grape_missing from pre-fetched stats.
 * @param {Object} stats - Stats object from GET /api/stats (contains grape_total, grape_missing)
 */
export function renderGrapeIndicator(stats) {
  const headerEl = findCellarHeader();
  if (!headerEl) return;

  const total = Number(stats?.grape_total ?? 0);
  const missing = Number(stats?.grape_missing ?? 0);

  // Get or create wrapper
  let wrapper = headerEl.querySelector(`.${INDICATOR_CLASS}`);
  if (!wrapper) {
    wrapper = document.createElement('div');
    wrapper.className = INDICATOR_CLASS;
    const zoomControls = headerEl.querySelector('.zoom-controls');
    if (zoomControls) {
      headerEl.insertBefore(wrapper, zoomControls);
    } else {
      headerEl.appendChild(wrapper);
    }
  }

  if (total === 0) {
    wrapper.innerHTML = '';
    return;
  }

  const identifiedPct = Math.round(((total - missing) / total) * 100);
  const confClass = getConfClass(identifiedPct);

  let html = `<span class="grape-indicator-pill grape-conf ${confClass}" title="${total - missing} of ${total} wines have grapes identified">`;
  html += `&#127815; ${identifiedPct}%`;
  html += '</span>';

  if (missing > 0) {
    html += ` <button class="btn btn-small btn-secondary grape-indicator-fix" title="${missing} wine${missing !== 1 ? 's' : ''} missing grape data">Identify</button>`;
  }

  wrapper.innerHTML = html;

  // Wire fix button (CSP-safe)
  const fixBtn = wrapper.querySelector('.grape-indicator-fix');
  if (fixBtn) {
    fixBtn.addEventListener('click', handleIdentifyClick);
  }
}

/**
 * Refresh the indicator by re-fetching stats.
 * Called after grape-health:changed event.
 */
export async function refreshGrapeIndicator() {
  try {
    const { fetchStats } = await import('./api.js');
    const stats = await fetchStats();
    renderGrapeIndicator(stats);
  } catch {
    // Silent — indicator is non-critical
  }
}

/**
 * Find the cellar zone-header element (works for both legacy and dynamic areas).
 * @returns {HTMLElement|null}
 */
function findCellarHeader() {
  // Legacy path: static #cellar-container parent
  const cellarContainer = document.getElementById('cellar-container');
  if (cellarContainer) {
    const zone = cellarContainer.closest('.zone');
    if (zone?.style.display !== 'none') {
      return zone.querySelector('.zone-header');
    }
  }

  // Dynamic areas path: find first visible cellar-type zone-header
  const areasContainer = document.getElementById('storage-areas-container');
  if (areasContainer && areasContainer.style.display !== 'none') {
    const header = areasContainer.querySelector('.zone-header[data-cellar-indicator]');
    if (header) return header;
  }

  return null;
}

/**
 * Get grape-conf CSS class based on identification percentage.
 * @param {number} pct - 0-100
 * @returns {string}
 */
function getConfClass(pct) {
  if (pct >= 100) return 'conf-high';
  if (pct >= 70) return 'conf-medium';
  return 'conf-low';
}

/**
 * Handle "Identify" button click — run full search then show proposals.
 * Step 1: Pattern matching (instant) + web search for undetectable wines.
 * Step 2: Display combined proposals in the preview panel.
 */
async function handleIdentifyClick(e) {
  const btn = e.currentTarget;
  btn.disabled = true;
  btn.textContent = 'Searching…';

  // Show progress panel immediately
  const headerEl = findCellarHeader();
  const zoneEl = headerEl?.closest('.zone');
  let progressEl = null;
  if (zoneEl) {
    closePreviewPanel();
    progressEl = document.createElement('div');
    progressEl.className = PANEL_CLASS;
    progressEl.innerHTML = `
      <div class="grape-indicator-panel-header">
        <strong>Identifying grapes…</strong>
        <span class="grape-search-status">Pattern matching + searching online</span>
      </div>
      <div class="grape-search-progress">
        <div class="grape-search-progress-bar"><div class="grape-search-progress-fill" style="width: 10%"></div></div>
        <span class="grape-search-progress-text">Detecting from wine names…</span>
      </div>`;
    const cellarContainer = zoneEl.querySelector('.cellar-container') || zoneEl.querySelector('.cellar-grid');
    if (cellarContainer) {
      zoneEl.insertBefore(progressEl, cellarContainer);
    } else {
      zoneEl.appendChild(progressEl);
    }
  }

  try {
    // Update progress: searching online
    if (progressEl) {
      const fill = progressEl.querySelector('.grape-search-progress-fill');
      const text = progressEl.querySelector('.grape-search-progress-text');
      if (fill) fill.style.width = '30%';
      if (text) text.textContent = 'Searching online for remaining wines…';
    }

    // Full search: pattern matching + web search in one call
    const result = await searchGrapes({ commit: false });

    if (!result || result.totalMissing === 0) {
      showToast('All wines already have grape data', 'info');
      if (progressEl) progressEl.remove();
      btn.disabled = false;
      btn.textContent = 'Identify';
      return;
    }

    // Remove progress panel, show results
    if (progressEl) progressEl.remove();

    renderPreviewPanel(result);
  } catch (err) {
    if (progressEl) progressEl.remove();
    showToast(`Failed to identify grapes: ${err.message}`, 'error');
    btn.disabled = false;
    btn.textContent = 'Identify';
  }
}

/**
 * Render the inline preview panel below the zone-header.
 * Shows auto-detected grapes and lists undetectable wines with manual input.
 * @param {Object} dryRun - Dry-run result from searchGrapes({ commit: false })
 */
function renderPreviewPanel(dryRun) {
  const { totalMissing, detectable, suggestions, undetectable, webSearched } = dryRun;
  closePreviewPanel(); // Clean up any existing panel

  const headerEl = findCellarHeader();
  if (!headerEl) return;
  const zoneEl = headerEl.closest('.zone');
  if (!zoneEl) return;

  const panel = document.createElement('div');
  panel.className = PANEL_CLASS;

  let html = '<div class="grape-indicator-panel-header">';
  html += `<strong>${totalMissing} wine${totalMissing !== 1 ? 's' : ''}</strong> missing grapes`;
  if (detectable > 0) {
    html += ` &mdash; <strong>${detectable}</strong> identified`;
  }
  if (webSearched > 0) {
    html += ` <span class="grape-ind-web-note">(${webSearched} searched online)</span>`;
  }
  html += '</div>';

  // --- Detected section (pattern match + web search) ---
  if (suggestions && suggestions.length > 0) {
    html += '<div class="grape-indicator-panel-table-wrap">';
    html += '<table class="grape-indicator-panel-table">';
    html += '<thead><tr><th>Wine</th><th>Proposed Grapes</th><th>Source</th><th>Conf.</th></tr></thead>';
    html += '<tbody>';

    for (const s of suggestions) {
      const confClass = s.confidence === 'high' ? 'conf-high' : s.confidence === 'medium' ? 'conf-medium' : 'conf-low';
      const inputId = `grape-ind-ac-${s.wineId}`;
      const sourceLabel = s.source === 'web_search' ? '&#127760; Web' : '&#128269; Name';
      html += `<tr data-wine-id="${s.wineId}">`;
      html += `<td class="grape-ind-wine-name">${escapeHtml(s.wine_name)}</td>`;
      html += `<td><input type="text" id="${inputId}" class="grape-ind-input" value="${escapeHtml(s.grapes || '')}" data-wine-id="${s.wineId}"></td>`;
      html += `<td class="grape-ind-source">${sourceLabel}</td>`;
      html += `<td><span class="grape-conf ${confClass}">${s.confidence}</span></td>`;
      html += '</tr>';
    }

    html += '</tbody></table>';
    html += '</div>';

    html += '<div class="grape-indicator-panel-actions">';
    html += '<button class="btn btn-small btn-primary grape-ind-apply-all">Apply All</button>';
    html += '<button class="btn btn-small btn-secondary grape-ind-cancel">Close</button>';
    html += '</div>';
  }

  // --- Undetectable wines section ---
  const manualWines = undetectable && undetectable.length > 0 ? undetectable : [];
  if (manualWines.length > 0) {
    html += '<div class="grape-indicator-panel-header grape-indicator-panel-manual-header">';
    html += `<strong>${manualWines.length}</strong> wine${manualWines.length !== 1 ? 's' : ''} need manual grape entry`;
    html += '</div>';
    html += '<div class="grape-indicator-panel-table-wrap">';
    html += '<table class="grape-indicator-panel-table">';
    html += '<thead><tr><th>Wine</th><th>Grapes</th><th></th></tr></thead>';
    html += '<tbody>';

    for (const u of manualWines) {
      const inputId = `grape-ind-manual-${u.wineId}`;
      html += `<tr data-wine-id="${u.wineId}">`;
      html += `<td class="grape-ind-wine-name">${escapeHtml(u.wine_name)}</td>`;
      html += `<td><input type="text" id="${inputId}" class="grape-ind-input grape-ind-manual" value="" data-wine-id="${u.wineId}" placeholder="Select grapes…"></td>`;
      html += `<td><button class="btn btn-small btn-secondary grape-ind-save-one" data-wine-id="${u.wineId}" data-input-id="${inputId}">Save</button></td>`;
      html += '</tr>';
    }

    html += '</tbody></table>';
    html += '</div>';
  }

  // If nothing auto-detected and nothing undetectable, show generic close
  if ((!suggestions || suggestions.length === 0) && manualWines.length === 0) {
    html += '<div class="grape-indicator-panel-note">All wines have grape data.</div>';
  }

  if (!suggestions || suggestions.length === 0) {
    html += '<div class="grape-indicator-panel-actions">';
    html += '<button class="btn btn-small btn-secondary grape-ind-cancel">Close</button>';
    html += '</div>';
  }

  panel.innerHTML = html;

  // Insert panel after the zone-header, before the cellar-container
  const cellarContainer = zoneEl.querySelector('.cellar-container') || zoneEl.querySelector('.cellar-grid');
  if (cellarContainer) {
    zoneEl.insertBefore(panel, cellarContainer);
  } else {
    zoneEl.appendChild(panel);
  }

  // Initialize grapeAutocomplete on auto-detected inputs
  _acInstances = [];
  for (const s of (suggestions || [])) {
    const inputId = `grape-ind-ac-${s.wineId}`;
    const ac = initGrapeAutocomplete(inputId);
    if (ac) _acInstances.push(ac);
  }

  // Initialize grapeAutocomplete on manual inputs
  for (const u of manualWines) {
    const inputId = `grape-ind-manual-${u.wineId}`;
    const ac = initGrapeAutocomplete(inputId);
    if (ac) _acInstances.push(ac);
  }

  // Wire individual Save buttons for manual entries
  panel.querySelectorAll('.grape-ind-save-one').forEach(btn => {
    btn.addEventListener('click', (e) => saveManualGrape(e.currentTarget));
  });

  // Wire Apply All
  panel.querySelector('.grape-ind-apply-all')?.addEventListener('click', () => commitFromPanel(panel));

  // Wire Cancel/Close
  panel.querySelectorAll('.grape-ind-cancel').forEach(btn => {
    btn.addEventListener('click', () => closePreviewPanel());
  });
}

/**
 * Save manually entered grape for a single wine.
 * @param {HTMLElement} btn - The Save button element
 */
async function saveManualGrape(btn) {
  const wineId = Number(btn.dataset.wineId);
  const inputId = btn.dataset.inputId;
  const input = document.getElementById(inputId);
  const grapes = input?.value?.trim();

  if (!grapes) {
    showToast('Please select or type grapes first', 'warning');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Saving…';

  try {
    await updateWine(wineId, { grapes });
    // Mark the row as saved
    const row = btn.closest('tr');
    if (row) {
      row.style.opacity = '0.5';
      btn.textContent = 'Saved';
    }
    showToast(`Grapes saved for wine`, 'success');
    document.dispatchEvent(new CustomEvent('grape-health:changed'));
  } catch (err) {
    showToast(`Failed to save: ${err.message}`, 'error');
    btn.disabled = false;
    btn.textContent = 'Save';
  }
}
/**
 * Commit grape changes from the preview panel.
 * Uses the full search endpoint with commit mode.
 * @param {HTMLElement} panel
 */
async function commitFromPanel(panel) {
  const applyBtn = panel.querySelector('.grape-ind-apply-all');
  if (applyBtn) {
    applyBtn.disabled = true;
    applyBtn.textContent = 'Applying...';
  }

  try {
    const result = await searchGrapes({ commit: true });
    const msg = `${result.updated} wine${result.updated !== 1 ? 's' : ''} updated with grape data` +
      (result.reclassified > 0 ? `, ${result.reclassified} reclassified` : '');
    showToast(msg, 'success');

    closePreviewPanel();
    document.dispatchEvent(new CustomEvent('grape-health:changed', {
      detail: { reclassified: result.reclassified || 0 }
    }));
  } catch (err) {
    showToast(`Grape detection failed: ${err.message}`, 'error');
    if (applyBtn) {
      applyBtn.disabled = false;
      applyBtn.textContent = 'Apply All';
    }
  }
}

/**
 * Close and remove the preview panel, cleaning up grapeAutocomplete instances.
 */
function closePreviewPanel() {
  for (const ac of _acInstances) {
    try { ac.destroy(); } catch { /* ignore */ }
  }
  _acInstances = [];

  const panel = document.querySelector(`.${PANEL_CLASS}`);
  if (panel) panel.remove();
}

// Listen for cross-component grape health changes
document.addEventListener('grape-health:changed', () => {
  refreshGrapeIndicator();
});
