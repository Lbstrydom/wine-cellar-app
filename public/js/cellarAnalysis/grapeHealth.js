/**
 * @fileoverview Grape health banner for cellar analysis.
 * Shows wines with missing grape data and offers detection + backfill.
 * @module cellarAnalysis/grapeHealth
 */

import { backfillGrapes, updateWine } from '../api.js';
import { escapeHtml } from '../utils.js';
import { initGrapeAutocomplete } from '../grapeAutocomplete.js';

let _onRefreshAnalysis = null;
/** @type {Map<string, { destroy: Function, commitPending: Function }>} */
let _grapeAcInstances = new Map();

/**
 * Render the grape health banner in the analysis panel.
 * Calls the backfill dry-run endpoint to discover missing grapes.
 * @param {Object} _analysis - Current analysis report (reserved for future contextual filtering)
 * @param {Object} [options]
 * @param {Function} [options.onRenderAnalysis] - Callback to refresh analysis after commit
 */
export async function renderGrapeHealthBanner(_analysis, options = {}) {
  _onRefreshAnalysis = options.onRenderAnalysis || null;
  const el = document.getElementById('grape-health-banner');
  if (!el) return;

  try {
    const result = await backfillGrapes({ commit: false });
    if (!result || result.totalMissing === 0) {
      el.innerHTML = '';
      return;
    }

    renderBannerSummary(el, result);
  } catch {
    el.innerHTML = '';
  }
}

/**
 * Render the summary banner with detect button.
 * @param {HTMLElement} el - Container element
 * @param {Object} dryRun - Dry-run result from backfill API
 */
function renderBannerSummary(el, dryRun) {
  const { totalMissing, detectable, suggestions, undetectable } = dryRun;

  let html = '<div class="grape-health-banner">';
  html += '<div class="grape-health-header">';
  html += `<span class="grape-health-icon">&#127815;</span> `;
  html += `<strong>${totalMissing} wine${totalMissing !== 1 ? 's' : ''}</strong> missing grape data`;
  if (detectable > 0) {
    html += ` &mdash; <strong>${detectable}</strong> can be auto-detected`;
  }
  html += '</div>';

  if (detectable > 0) {
    html += '<div class="grape-health-actions">';
    html += '<button class="btn btn-small btn-secondary" id="grape-health-preview-btn">Detect Grapes</button>';
    html += '</div>';
  }

  // Show undetectable wines with manual input
  const manualWines = undetectable && undetectable.length > 0 ? undetectable : [];
  if (manualWines.length > 0) {
    html += '<div class="grape-health-manual-section">';
    html += `<div class="grape-health-subheader"><strong>${manualWines.length}</strong> wine${manualWines.length !== 1 ? 's' : ''} need manual grape entry</div>`;
    html += '<div class="grape-health-table-wrap">';
    html += '<table class="grape-health-table">';
    html += '<thead><tr><th>Wine</th><th>Grapes</th><th></th></tr></thead>';
    html += '<tbody>';
    for (const u of manualWines) {
      const inputId = `grape-health-manual-${u.wineId}`;
      html += `<tr data-wine-id="${u.wineId}">`;
      html += `<td>${escapeHtml(u.wine_name)}</td>`;
      html += `<td><input type="text" id="${inputId}" class="grape-health-manual-input" value="" data-wine-id="${u.wineId}" placeholder="Select grapes…"></td>`;
      html += `<td><button class="btn btn-small btn-secondary grape-health-save-one" data-wine-id="${u.wineId}" data-input-id="${inputId}">Save</button></td>`;
      html += '</tr>';
    }
    html += '</tbody></table>';
    html += '</div>';
    html += '</div>';
  }

  html += '</div>';
  el.innerHTML = html;

  // Clean up previous autocomplete instances
  for (const ac of _grapeAcInstances.values()) {
    try { ac.destroy(); } catch { /* ignore */ }
  }
  _grapeAcInstances = new Map();

  // Wire preview button
  const previewBtn = document.getElementById('grape-health-preview-btn');
  if (previewBtn) {
    previewBtn.addEventListener('click', () => renderPreviewTable(el, suggestions, undetectable));
  }

  // Initialize grapeAutocomplete on manual inputs
  for (const u of manualWines) {
    const inputId = `grape-health-manual-${u.wineId}`;
    const ac = initGrapeAutocomplete(inputId);
    if (ac) _grapeAcInstances.set(inputId, ac);
  }

  // Wire individual Save buttons
  el.querySelectorAll('.grape-health-save-one').forEach(btn => {
    btn.addEventListener('click', (e) => saveManualGrapeHealth(e.currentTarget, el));
  });
}

/**
 * Render the preview table with per-row and apply-all controls.
 * @param {HTMLElement} el - Container element
 * @param {Array} suggestions - Detection suggestions from dry-run
 * @param {Array} [undetectable] - Wines that couldn't be auto-detected
 */
function renderPreviewTable(el, suggestions, undetectable) {
  // Clean up previous autocomplete instances
  for (const ac of _grapeAcInstances.values()) {
    try { ac.destroy(); } catch { /* ignore */ }
  }
  _grapeAcInstances = new Map();

  let html = '<div class="grape-health-banner">';
  html += '<div class="grape-health-header">';
  html += `<span class="grape-health-icon">&#127815;</span> `;
  html += `<strong>Grape Detection Preview</strong> &mdash; ${suggestions.length} wine${suggestions.length !== 1 ? 's' : ''}`;
  html += '</div>';

  html += '<div class="grape-health-table-wrap">';
  html += '<table class="grape-health-table">';
  html += '<thead><tr><th>Wine</th><th>Detected Grapes</th><th>Confidence</th><th></th></tr></thead>';
  html += '<tbody>';

  for (const s of suggestions) {
    const confClass = s.confidence === 'high' ? 'conf-high' : s.confidence === 'medium' ? 'conf-medium' : 'conf-low';
    html += `<tr data-wine-id="${s.wineId}">`;
    html += `<td>${escapeHtml(s.wine_name)}</td>`;
    html += `<td>${escapeHtml(s.grapes)}</td>`;
    html += `<td><span class="grape-conf ${confClass}">${s.confidence}</span></td>`;
    html += `<td><button class="btn btn-small btn-secondary grape-apply-one" data-wine-id="${s.wineId}">Apply</button></td>`;
    html += '</tr>';
  }

  html += '</tbody></table>';
  html += '</div>';

  html += '<div class="grape-health-actions">';
  html += '<button class="btn btn-small btn-primary" id="grape-health-apply-all-btn">Apply All</button>';
  html += '<button class="btn btn-small btn-secondary" id="grape-health-cancel-btn">Cancel</button>';
  html += '</div>';

  // Undetectable wines with manual input
  const manualWines = undetectable && undetectable.length > 0 ? undetectable : [];
  if (manualWines.length > 0) {
    html += '<div class="grape-health-manual-section">';
    html += `<div class="grape-health-subheader"><strong>${manualWines.length}</strong> wine${manualWines.length !== 1 ? 's' : ''} need manual grape entry</div>`;
    html += '<div class="grape-health-table-wrap">';
    html += '<table class="grape-health-table">';
    html += '<thead><tr><th>Wine</th><th>Grapes</th><th></th></tr></thead>';
    html += '<tbody>';
    for (const u of manualWines) {
      const inputId = `grape-health-preview-manual-${u.wineId}`;
      html += `<tr data-wine-id="${u.wineId}">`;
      html += `<td>${escapeHtml(u.wine_name)}</td>`;
      html += `<td><input type="text" id="${inputId}" class="grape-health-manual-input" value="" data-wine-id="${u.wineId}" placeholder="Select grapes…"></td>`;
      html += `<td><button class="btn btn-small btn-secondary grape-health-save-one" data-wine-id="${u.wineId}" data-input-id="${inputId}">Save</button></td>`;
      html += '</tr>';
    }
    html += '</tbody></table>';
    html += '</div>';
    html += '</div>';
  }

  html += '</div>';

  el.innerHTML = html;

  // Wire apply-all
  document.getElementById('grape-health-apply-all-btn')?.addEventListener('click', async () => {
    await commitBackfill(el);
  });

  // Wire cancel
  document.getElementById('grape-health-cancel-btn')?.addEventListener('click', async () => {
    const result = await backfillGrapes({ commit: false });
    renderBannerSummary(el, result);
  });

  // Wire per-row apply
  el.querySelectorAll('.grape-apply-one').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const wineId = Number(e.target.dataset.wineId);
      await commitBackfill(el, [wineId]);
    });
  });

  // Initialize grapeAutocomplete on manual inputs
  for (const u of manualWines) {
    const inputId = `grape-health-preview-manual-${u.wineId}`;
    const ac = initGrapeAutocomplete(inputId);
    if (ac) _grapeAcInstances.set(inputId, ac);
  }

  // Wire individual Save buttons for manual entries
  el.querySelectorAll('.grape-health-save-one').forEach(btn => {
    btn.addEventListener('click', (e) => saveManualGrapeHealth(e.currentTarget, el));
  });
}

/**
 * Commit grape backfill and refresh analysis.
 * @param {HTMLElement} el - Container element
 * @param {number[]} [wineIds] - Optional subset of wine IDs
 */
async function commitBackfill(el, wineIds) {
  try {
    const options = { commit: true };
    if (wineIds) options.wineIds = wineIds;

    const result = await backfillGrapes(options);

    // Show success message
    el.innerHTML = `<div class="grape-health-banner grape-health-success">` +
      `<strong>${result.updated}</strong> wine${result.updated !== 1 ? 's' : ''} updated with grape data` +
      (result.reclassified > 0 ? `, <strong>${result.reclassified}</strong> reclassified to new zones` : '') +
      `</div>`;

    // Notify grid indicator and other components
    document.dispatchEvent(new CustomEvent('grape-health:changed', {
      detail: { reclassified: result.reclassified || 0 }
    }));

    // Refresh analysis to reflect changes
    if (_onRefreshAnalysis) {
      setTimeout(() => _onRefreshAnalysis(), 500);
    }
  } catch (err) {
    el.innerHTML = `<div class="grape-health-banner grape-health-error">Failed to backfill grapes: ${escapeHtml(err.message)}</div>`;
  }
}

/**
 * Save manually entered grapes for a single wine (used in preview table).
 * @param {HTMLElement} btn - The Save button that was clicked
 * @param {HTMLElement} el - Parent container element for refresh
 */
async function saveManualGrapeHealth(btn, el) {
  const wineId = Number(btn.dataset.wineId);
  const inputId = btn.dataset.inputId;
  const input = document.getElementById(inputId);
  if (!input) return;

  // Auto-commit any text the user typed but didn't confirm via Enter/dropdown
  const acInstance = _grapeAcInstances.get(inputId);
  if (acInstance?.commitPending) acInstance.commitPending();

  const grapes = input.value.trim();
  if (!grapes) {
    // Briefly flash the autocomplete wrapper to draw attention
    const wrapper = input.nextElementSibling;
    if (wrapper?.classList.contains('grape-ac-wrapper')) {
      wrapper.classList.add('grape-ac-shake');
      setTimeout(() => wrapper.classList.remove('grape-ac-shake'), 600);
    }
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Saving…';

  try {
    await updateWine(wineId, { grapes });
    const row = btn.closest('tr');
    if (row) {
      row.innerHTML = `<td colspan="3" class="grape-health-saved">&#10003; Saved: ${escapeHtml(grapes)}</td>`;
    }

    document.dispatchEvent(new CustomEvent('grape-health:changed', {
      detail: { reclassified: 0 }
    }));
  } catch (err) {
    btn.disabled = false;
    btn.textContent = 'Save';
    const row = btn.closest('tr');
    if (row) {
      const td = row.querySelector('td:last-child');
      if (td) td.innerHTML += ` <span class="grape-health-error-inline">${escapeHtml(err.message)}</span>`;
    }
  }
}
