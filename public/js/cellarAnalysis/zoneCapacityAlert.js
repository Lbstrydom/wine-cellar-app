/**
 * @fileoverview Zone capacity alert UI and zone reconfiguration workflow.
 * When a zone is at capacity, "Suggest Fix" generates a scoped zone reconfiguration
 * plan (row reallocations, merges) instead of individual bottle moves.
 * Bottle moves are handled in the Cellar Placement workspace after zone changes.
 * @module cellarAnalysis/zoneCapacityAlert
 */

import {
  getZoneReconfigurationPlan,
  applyReconfigurationPlan,
  analyseCellar
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
  // Remove previous listener to prevent stacking on re-render (can happen
  // when __showQuickFixZones re-renders the same el multiple times).
  if (el._capacityClickHandler) {
    el.removeEventListener('click', el._capacityClickHandler);
  }
  el._capacityClickHandler = async (event) => {
    const target = event.target.closest('[data-action]');
    if (!target) return;

    const action = target.getAttribute('data-action');
    const idxStr = target.getAttribute('data-alert-index');
    const idx = idxStr ? parseInt(idxStr, 10) : NaN;
    const alert = Number.isFinite(idx) ? capacityAlerts[idx] : null;
    const alertRoot = target.closest('.zone-capacity-alert');
    if (!alert || !alertRoot) return;

    if (action === 'zone-capacity-get-ai') {
      if (target.disabled) return; // Guard against duplicate invocations
      target.disabled = true;
      try {
        await handleSuggestFix(alert, alertRoot, onRenderAnalysis);
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
  };
  el.addEventListener('click', el._capacityClickHandler);

  return { remainingAlerts, rendered: true };
}

function renderAlertMarkup(alert, index) {
  const data = alert.data || {};
  const zoneName = escapeHtml(data.overflowingZoneName || data.overflowingZoneId || 'zone');
  const wines = Array.isArray(data.winesNeedingPlacement) ? data.winesNeedingPlacement : [];

  const wineList = wines.length
    ? `<ul class="zone-capacity-wines">${wines.map(w => (
      `<li>${escapeHtml(w.wineName || w.wine_name || 'Wine')} (${escapeHtml(w.currentSlot || 'Unknown')})</li>`
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

// ───────────────────────────────────────────────────────────
// Suggest Fix: scoped zone reconfiguration
// ───────────────────────────────────────────────────────────

/**
 * Handle "Suggest Fix" — calls the scoped zone reconfiguration endpoint
 * instead of the old per-zone AI advisor.
 */
async function handleSuggestFix(alert, rootEl, onRenderAnalysis) {
  const adviceEl = rootEl.querySelector('[data-zone-capacity-advice]');
  if (!adviceEl) return;

  const data = alert.data || {};
  const zoneId = data.overflowingZoneId;
  if (!zoneId) {
    showToast('Error: missing zone identifier');
    return;
  }

  adviceEl.innerHTML = '<div class="analysis-loading">Analysing zone structure...</div>';

  try {
    const result = await getZoneReconfigurationPlan(zoneId);
    if (!result?.success) {
      throw new Error(result?.error || 'Failed to generate zone fix plan');
    }

    const plan = result.plan;
    const planId = result.planId;
    const actions = Array.isArray(plan?.actions) ? plan.actions : [];

    if (actions.length === 0) {
      adviceEl.innerHTML = renderNoActionsMarkup(plan?.reasoning);
      return;
    }

    adviceEl.innerHTML = renderReconfigPlanMarkup(plan);
    wireReconfigActions(adviceEl, plan, planId, onRenderAnalysis);
  } catch (err) {
    adviceEl.innerHTML = '';
    showToast(`Error: ${err.message}`);
  }
}

// ───────────────────────────────────────────────────────────
// Rendering
// ───────────────────────────────────────────────────────────

function renderNoActionsMarkup(reasoning) {
  const text = escapeHtml(reasoning || 'No zone structure changes are possible within current constraints. Consider a full zone reorganisation.');
  return `
    <div class="zone-capacity-advice-panel">
      <div class="zone-capacity-advice-header">Zone Structure Analysis</div>
      <div class="zone-capacity-advice-reasoning">${text}</div>
    </div>
  `;
}

function renderReconfigPlanMarkup(plan) {
  const reasoning = escapeHtml(plan?.reasoning || '');
  const actions = Array.isArray(plan?.actions) ? plan.actions : [];

  const actionsHtml = actions.map((a, idx) => renderReconfigAction(a, idx)).join('');

  return `
    <div class="zone-capacity-advice-panel">
      <div class="zone-capacity-advice-header">Suggested Zone Changes</div>
      ${reasoning ? `<div class="zone-capacity-advice-reasoning">${reasoning}</div>` : ''}
      <div class="zone-capacity-advice-actions">
        ${actionsHtml}
      </div>
      <div class="zone-capacity-reconfig-footer">
        <button class="btn btn-primary" data-zone-reconfig-apply>Apply Selected</button>
      </div>
    </div>
  `;
}

function renderReconfigAction(action, idx) {
  const type = action?.type;
  const reason = escapeHtml(action?.reason || '');

  let title = escapeHtml(String(type || 'action'));

  if (type === 'reallocate_row') {
    const row = escapeHtml(String(action.rowNumber || '?'));
    const from = escapeHtml(action.fromZoneName || action.fromZoneId || '?');
    const to = escapeHtml(action.toZoneName || action.toZoneId || '?');
    title = `Reallocate Row ${row}: ${from} → ${to}`;
  } else if (type === 'expand_zone') {
    title = `Expand ${escapeHtml(action.zoneName || action.zoneId || '?')}`;
  } else if (type === 'merge_zones') {
    const sources = (action.sourceZones || []).map(z => escapeHtml(z)).join(', ');
    const target = escapeHtml(action.targetZoneName || action.targetZoneId || '?');
    title = `Merge ${sources} → ${target}`;
  } else if (type === 'retire_zone') {
    const zone = escapeHtml(action.zoneName || action.zoneId || '?');
    const into = escapeHtml(action.mergeIntoZoneName || action.mergeIntoZoneId || '?');
    title = `Retire ${zone} → ${into}`;
  }

  const reasonHtml = reason ? `<div class="zone-capacity-action-reason">${reason}</div>` : '';
  const bottlesAffected = typeof action?.bottlesAffected === 'number' ? action.bottlesAffected : null;
  const bottlesHtml = bottlesAffected !== null
    ? `<div class="zone-capacity-action-meta">Bottles affected: ${bottlesAffected}</div>`
    : '';

  return `
    <div class="zone-capacity-action">
      <div class="zone-capacity-action-header">
        <div class="zone-capacity-action-title">${idx + 1}. ${title}</div>
        <label class="zone-capacity-skip">
          <input type="checkbox" data-zone-reconfig-skip="${idx}">
          <span>Skip</span>
        </label>
      </div>
      ${reasonHtml}
      ${bottlesHtml}
    </div>
  `;
}

// ───────────────────────────────────────────────────────────
// Apply logic
// ───────────────────────────────────────────────────────────

function wireReconfigActions(containerEl, plan, planId, onRenderAnalysis) {
  const applyBtn = containerEl.querySelector('[data-zone-reconfig-apply]');
  if (!applyBtn) return;

  applyBtn.addEventListener('click', async () => {
    if (applyBtn.disabled) return; // Guard against duplicate listener invocations
    applyBtn.disabled = true;
    applyBtn.textContent = 'Applying...';

    try {
      // Collect skip indices
      const skipIndices = [];
      containerEl.querySelectorAll('[data-zone-reconfig-skip]').forEach(cb => {
        if (cb.checked) {
          skipIndices.push(parseInt(cb.getAttribute('data-zone-reconfig-skip'), 10));
        }
      });

      const result = await applyReconfigurationPlan(planId, skipIndices);
      if (result?.success !== true) {
        throw new Error(result?.error || 'Failed to apply zone changes');
      }

      showToast('Zone structure updated. Review bottle moves in Cellar Placement.');

      // Re-run analysis and render — the updated zone structure will generate
      // new suggested moves that appear in the Cellar Placement workspace.
      if (typeof onRenderAnalysis === 'function') {
        const refreshed = await analyseCellar(true);
        const report = refreshed.report || refreshed;
        report.__justReconfigured = true;
        report.__reconfigResult = result.applied || {};
        onRenderAnalysis(report);
        // switchWorkspace('placement') + scrollIntoView handled inside
        // renderAnalysis when __justReconfigured is set — no need to repeat here.
      }
    } catch (err) {
      applyBtn.disabled = false;
      applyBtn.textContent = 'Apply Selected';
      showToast(`Error: ${err.message}`);
    }
  });
}
