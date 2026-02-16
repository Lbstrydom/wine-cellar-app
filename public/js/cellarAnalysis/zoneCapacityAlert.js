/**
 * @fileoverview Zone capacity alert UI and AI advice workflow.
 * @module cellarAnalysis/zoneCapacityAlert
 */

import {
  getZoneCapacityAdvice,
  analyseCellar,
  allocateZoneRow,
  mergeZones,
  executeCellarMoves
} from '../api.js';
import { showToast, escapeHtml } from '../utils.js';

/**
 * Render a prominent zone capacity alert (if present) and return remaining alerts.
 * @param {Object} analysis - Analysis report
 * @param {Object} handlers
 * @param {(analysis: Object) => void} handlers.onRenderAnalysis - Callback to re-render analysis
 * @param {HTMLElement} [handlers.targetEl] - Optional target element (defaults to #analysis-alerts)
 * @returns {{ remainingAlerts: Array, rendered: boolean }}
 */
export function renderZoneCapacityAlert(analysis, { onRenderAnalysis, targetEl = null }) {
  const el = targetEl || document.getElementById('analysis-alerts');
  const alerts = Array.isArray(analysis.alerts) ? analysis.alerts : [];

    const capacityAlerts = alerts.filter(a => a.type === 'zone_capacity_issue');
    if (capacityAlerts.length === 0) {
      return { remainingAlerts: alerts, rendered: false };
    }

    const remainingAlerts = alerts.filter(a => a.type !== 'zone_capacity_issue');

    el.innerHTML = capacityAlerts.map((a, idx) => renderAlertMarkup(a, idx)).join('');

    // Event delegation: handle clicks for any alert panel.
    el.addEventListener('click', async (event) => {
      const target = event.target.closest('[data-action]');
      if (!target) return;

      const action = target.getAttribute('data-action');
      const idxStr = target.getAttribute('data-alert-index');
      const idx = idxStr ? parseInt(idxStr, 10) : NaN;
      const alert = Number.isFinite(idx) ? capacityAlerts[idx] : null;
      const alertRoot = target.closest('.zone-capacity-alert');
      if (!alert || !alertRoot) return;

      if (action === 'zone-capacity-get-ai') {
        target.disabled = true;
        try {
          await handleGetAi(alert, alertRoot, onRenderAnalysis);
        } finally {
          target.disabled = false;
        }
        return;
      }

      if (action === 'zone-capacity-use-fallback') {
        target.disabled = true;
        try {
          const response = await analyseCellar(true, { allowFallback: true });
          onRenderAnalysis(response.report);
          showToast('Using fallback placement for this analysis run');
        } catch (err) {
          showToast(`Error: ${err.message}`);
        } finally {
          target.disabled = false;
        }
      }
    });

    return { remainingAlerts, rendered: true };
}

  function renderAlertMarkup(alert, index) {
  const data = alert.data || {};
  const zoneName = escapeHtml(data.overflowingZoneName || data.overflowingZoneId || 'zone');
  const wines = Array.isArray(data.winesNeedingPlacement) ? data.winesNeedingPlacement : [];

  const wineList = wines.length
    ? `<ul class="zone-capacity-wines">${wines.map(w => (
      `<li>• ${escapeHtml(w.wineName || w.wine_name || 'Wine')} (${escapeHtml(w.currentSlot || 'Unknown')})</li>`
    )).join('')}</ul>`
    : '';

  return `
    <div class="zone-capacity-alert">
      <div class="zone-capacity-alert-header">⚠️ Zone Capacity Issue Detected</div>
      <div class="zone-capacity-alert-body">
        <div class="zone-capacity-alert-message">
          The "${zoneName}" zone is full. These wines need placement but would fall back to unrelated areas.
        </div>
        ${wineList}
        <div class="zone-capacity-alert-actions">
          <button class="btn btn-primary" data-action="zone-capacity-get-ai" data-alert-index="${index}">Suggest Fix</button>
          <button class="btn btn-secondary" data-action="zone-capacity-use-fallback" data-alert-index="${index}">Ignore &amp; Use Fallback</button>
        </div>
        <div class="zone-capacity-advice" data-zone-capacity-advice></div>
      </div>
    </div>
  `;
}

async function handleGetAi(alert, rootEl, onRenderAnalysis) {
  const adviceEl = rootEl.querySelector('[data-zone-capacity-advice]');
  if (!adviceEl) return;

  const data = alert.data || {};

  adviceEl.innerHTML = '<div class="analysis-loading">Getting AI zone structure analysis...</div>';

  try {
    const payload = {
      overflowingZoneId: data.overflowingZoneId,
      winesNeedingPlacement: data.winesNeedingPlacement || [],
      currentZoneAllocation: data.currentZoneAllocation || {},
      availableRows: data.availableRows || [],
      adjacentZones: data.adjacentZones || []
    };

    const result = await getZoneCapacityAdvice(payload);
    if (!result?.success) {
      throw new Error(result?.error || 'Failed to get AI advice');
    }

    adviceEl.innerHTML = renderAdviceMarkup(result.advice);

    wireAdviceActions(adviceEl, result.advice, onRenderAnalysis);
  } catch (err) {
    adviceEl.innerHTML = '';
    showToast(`Error: ${err.message}`);
  }
}

function renderAdviceMarkup(advice) {
  const recommendation = escapeHtml(advice?.recommendation || '');
  const reasoning = escapeHtml(advice?.reasoning || '');
  const actions = Array.isArray(advice?.actions) ? advice.actions : [];
  const warnings = Array.isArray(advice?.warnings) ? advice.warnings : [];

  const warningsHtml = warnings.length
    ? `<div class="zone-capacity-warnings">${warnings.map(w =>
      `<div class="zone-capacity-warning">${escapeHtml(w)}</div>`
    ).join('')}</div>`
    : '';

  const actionsHtml = actions.length
    ? actions.map((a, idx) => renderActionMarkup(a, idx)).join('')
    : '<div class="zone-capacity-action">No actions suggested.</div>';

  return `
    <div class="zone-capacity-advice-panel">
      <div class="zone-capacity-advice-header">Suggested Fix</div>
      ${recommendation ? `<div class="zone-capacity-advice-recommendation">Suggested: <strong>${recommendation}</strong></div>` : ''}
      ${reasoning ? `<div class="zone-capacity-advice-reasoning">${reasoning}</div>` : ''}
      ${warningsHtml}
      <div class="zone-capacity-advice-actions">
        ${actionsHtml}
      </div>
    </div>
  `;
}

function renderActionMarkup(action, index) {
  const type = action?.type;

  if (type === 'allocate_row') {
    const row = escapeHtml(action.row || '');
    const toZone = escapeHtml(action.toZone || '');
    return `
      <div class="zone-capacity-action">
        <div class="zone-capacity-action-title">Allocate ${row} to ${toZone}</div>
        <button class="btn btn-primary" data-zone-capacity-apply="${index}">Apply</button>
      </div>
    `;
  }

  if (type === 'merge_zones') {
    const sourceZone = escapeHtml(action.sourceZone || '');
    const targetZone = escapeHtml(action.targetZone || '');
    return `
      <div class="zone-capacity-action">
        <div class="zone-capacity-action-title">Merge ${sourceZone} → ${targetZone}</div>
        <button class="btn btn-primary" data-zone-capacity-apply="${index}">Apply</button>
      </div>
    `;
  }

  if (type === 'move_wine') {
    const wineName = escapeHtml(action.wineName || `Wine #${action.wineId || '?'}`);
    const fromSlot = escapeHtml(action.from || '?');
    const toSlot = escapeHtml(action.to || '?');
    const canApply = !!(action.from && action.to);
    const disabledReason = escapeHtml(action.error || 'No slot available for this move');
    return `
      <div class="zone-capacity-action">
        <div class="zone-capacity-action-title">${wineName} (${fromSlot}) → ${toSlot}</div>
        <button class="btn btn-primary" ${canApply ? '' : 'disabled'} title="${canApply ? '' : disabledReason}" data-zone-capacity-apply="${index}">Apply</button>
      </div>
    `;
  }

  return `
    <div class="zone-capacity-action">
      <div class="zone-capacity-action-title">Unsupported action type: ${escapeHtml(String(type || 'unknown'))}</div>
    </div>
  `;
}

function wireAdviceActions(containerEl, advice, onRenderAnalysis) {
  const actions = Array.isArray(advice?.actions) ? advice.actions : [];
  const buttons = containerEl.querySelectorAll('[data-zone-capacity-apply]');

  buttons.forEach(btn => {
    btn.addEventListener('click', async () => {
      const idx = parseInt(btn.getAttribute('data-zone-capacity-apply'), 10);
      const action = actions[idx];
      if (!action) return;

      btn.disabled = true;

      try {
        if (action.type === 'allocate_row') {
          const result = await allocateZoneRow(action.toZone);
          if (!result?.success) throw new Error(result?.error || 'Failed to allocate row');
          showToast(`Allocated ${result.row} to ${result.zoneId}`);
        } else if (action.type === 'merge_zones') {
          const result = await mergeZones(action.sourceZone, action.targetZone);
          if (!result?.success) throw new Error(result?.error || 'Failed to merge zones');
          showToast(`Merged ${action.sourceZone} into ${action.targetZone}`);
        } else if (action.type === 'move_wine') {
          if (!action.from || !action.to) {
            throw new Error(action.error || 'Move is missing from/to slots');
          }

          const move = {
            wineId: action.wineId,
            from: action.from,
            to: action.to,
            zoneId: action.toZone,
            confidence: 'manual'
          };

          const result = await executeCellarMoves([move]);
          if (!result?.success) throw new Error(result?.error || 'Failed to execute move');
          const name = action.wineName || `Wine #${action.wineId}`;
          showToast(`Moved ${name} (${action.from}) → ${action.to}`);
        } else {
          throw new Error('Unsupported action');
        }

        if (typeof onRenderAnalysis === 'function') {
          const refreshed = await analyseCellar(true);
          onRenderAnalysis(refreshed.report);
        }
      } catch (err) {
        btn.disabled = false;
        showToast(`Error: ${err.message}`);
      }
    });
  });
}
