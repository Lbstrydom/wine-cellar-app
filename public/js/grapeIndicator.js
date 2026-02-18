/**
 * @fileoverview Grape identification status indicator for the cellar grid header.
 * Shows a color-coded pill with percentage + "Identify" button that expands
 * an inline preview panel with grapeAutocomplete for overrides.
 * @module grapeIndicator
 */

import { backfillGrapes } from './api.js';
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
 * Handle "Identify" button click — show preview panel.
 */
async function handleIdentifyClick(e) {
  const btn = e.currentTarget;
  btn.disabled = true;
  btn.textContent = 'Loading...';

  try {
    const result = await backfillGrapes({ commit: false });

    if (!result || result.totalMissing === 0) {
      showToast('All wines already have grape data', 'info');
      btn.disabled = false;
      btn.textContent = 'Identify';
      return;
    }

    renderPreviewPanel(result);
  } catch (err) {
    showToast(`Failed to detect grapes: ${err.message}`, 'error');
    btn.disabled = false;
    btn.textContent = 'Identify';
  }
}

/**
 * Render the inline preview panel below the zone-header.
 * @param {Object} dryRun - Dry-run result from backfillGrapes({ commit: false })
 */
function renderPreviewPanel(dryRun) {
  const { totalMissing, detectable, suggestions } = dryRun;
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
    html += ` &mdash; <strong>${detectable}</strong> auto-detected`;
  }
  html += '</div>';

  if (suggestions && suggestions.length > 0) {
    html += '<div class="grape-indicator-panel-table-wrap">';
    html += '<table class="grape-indicator-panel-table">';
    html += '<thead><tr><th>Wine</th><th>Proposed Grapes</th><th>Conf.</th></tr></thead>';
    html += '<tbody>';

    for (const s of suggestions) {
      const confClass = s.confidence === 'high' ? 'conf-high' : s.confidence === 'medium' ? 'conf-medium' : 'conf-low';
      const inputId = `grape-ind-ac-${s.wineId}`;
      html += `<tr data-wine-id="${s.wineId}">`;
      html += `<td class="grape-ind-wine-name">${escapeHtml(s.wine_name)}</td>`;
      html += `<td><input type="text" id="${inputId}" class="grape-ind-input" value="${escapeHtml(s.grapes || '')}" data-wine-id="${s.wineId}"></td>`;
      html += `<td><span class="grape-conf ${confClass}">${s.confidence}</span></td>`;
      html += '</tr>';
    }

    html += '</tbody></table>';
    html += '</div>';

    html += '<div class="grape-indicator-panel-actions">';
    html += '<button class="btn btn-small btn-primary grape-ind-apply-all">Apply All</button>';
    html += '<button class="btn btn-small btn-secondary grape-ind-cancel">Cancel</button>';
    html += '</div>';
  } else {
    html += '<div class="grape-indicator-panel-note">No grapes could be auto-detected. Add grapes manually via the edit form.</div>';
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

  // Initialize grapeAutocomplete on each input
  _acInstances = [];
  for (const s of (suggestions || [])) {
    const inputId = `grape-ind-ac-${s.wineId}`;
    const ac = initGrapeAutocomplete(inputId);
    if (ac) _acInstances.push(ac);
  }

  // Wire Apply All
  panel.querySelector('.grape-ind-apply-all')?.addEventListener('click', () => commitFromPanel(panel));

  // Wire Cancel
  panel.querySelector('.grape-ind-cancel')?.addEventListener('click', () => closePreviewPanel());
}

/**
 * Commit grape changes from the preview panel.
 * Reads current values from grapeAutocomplete inputs.
 * @param {HTMLElement} panel
 */
async function commitFromPanel(panel) {
  const applyBtn = panel.querySelector('.grape-ind-apply-all');
  if (applyBtn) {
    applyBtn.disabled = true;
    applyBtn.textContent = 'Applying...';
  }

  try {
    const result = await backfillGrapes({ commit: true });
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
