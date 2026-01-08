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
 * @returns {{ remainingAlerts: Array }}
 */
export function renderZoneCapacityAlert(analysis, { onRenderAnalysis }) {
  const el = document.getElementById('analysis-alerts');
  const alerts = Array.isArray(analysis.alerts) ? analysis.alerts : [];

  const capacityAlert = alerts.find(a => a.type === 'zone_capacity_issue');
  if (!capacityAlert) {
    return { remainingAlerts: alerts, rendered: false };
  }

  const remainingAlerts = alerts.filter(a => a !== capacityAlert);

  el.innerHTML = renderAlertMarkup(capacityAlert);

  const getAiBtn = el.querySelector('[data-action="zone-capacity-get-ai"]');
  const fallbackBtn = el.querySelector('[data-action="zone-capacity-use-fallback"]');

  if (getAiBtn) {
    getAiBtn.addEventListener('click', async () => {
      await handleGetAi(capacityAlert, el, onRenderAnalysis);
    });
  }

  if (fallbackBtn) {
    fallbackBtn.addEventListener('click', async () => {
      try {
        const response = await analyseCellar(true, { allowFallback: true });
        onRenderAnalysis(response.report);
        showToast('Using fallback placement for this analysis run');
      } catch (err) {
        showToast(`Error: ${err.message}`);
      }
    });
  }

  return { remainingAlerts, rendered: true };
}

function renderAlertMarkup(alert) {
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
          <button class="btn btn-primary" data-action="zone-capacity-get-ai">Get AI Suggestions</button>
          <button class="btn btn-secondary" data-action="zone-capacity-use-fallback">Ignore &amp; Use Fallback</button>
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

  adviceEl.innerHTML = '<div class="analysis-loading">Getting AI recommendations...</div>';

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

  const actionsHtml = actions.length
    ? actions.map((a, idx) => renderActionMarkup(a, idx)).join('')
    : '<div class="zone-capacity-action">No actions suggested.</div>';

  return `
    <div class="zone-capacity-advice-panel">
      <div class="zone-capacity-advice-header">🍷 Sommelier Zone Recommendation</div>
      ${recommendation ? `<div class="zone-capacity-advice-recommendation">Suggested: <strong>${recommendation}</strong></div>` : ''}
      ${reasoning ? `<div class="zone-capacity-advice-reasoning">${reasoning}</div>` : ''}
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
    const wineId = escapeHtml(String(action.wineId || ''));
    const fromZone = escapeHtml(action.fromZone || '');
    const toZone = escapeHtml(action.toZone || '');
    const canApply = !!(action.from && action.to);
    const disabledReason = escapeHtml(action.error || 'No slot available for this move');
    return `
      <div class="zone-capacity-action">
        <div class="zone-capacity-action-title">Move wine ${wineId}: ${fromZone} → ${toZone}</div>
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
          showToast(`Moved wine ${action.wineId} to ${action.to}`);
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
