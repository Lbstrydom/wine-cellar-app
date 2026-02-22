/**
 * @fileoverview Modal UI for holistic zone reconfiguration plan.
 * @module cellarAnalysis/zoneReconfigurationModal
 */

import { getReconfigurationPlan, applyReconfigurationPlan, analyseCellar } from '../api.js';
import { escapeHtml, showToast } from '../utils.js';
import { refreshLayout } from '../app.js';

let current = null;

function setApplyReadyState(isReady) {
  const { applyBtn } = getEls();
  if (!applyBtn) return;

  // During loading, don't show an action that can't be taken yet.
  applyBtn.style.display = isReady ? '' : 'none';
  applyBtn.disabled = !isReady;
}

function getEls() {
  const overlay = document.getElementById('reconfig-modal-overlay');
  const title = document.getElementById('reconfig-modal-title');
  const subtitle = document.getElementById('reconfig-modal-subtitle');
  const body = document.getElementById('reconfig-modal-body');
  const closeBtn = document.getElementById('reconfig-modal-close');
  const cancelBtn = document.getElementById('reconfig-modal-cancel');
  const applyBtn = document.getElementById('reconfig-modal-apply');

  return { overlay, title, subtitle, body, closeBtn, cancelBtn, applyBtn };
}

function openOverlay() {
  const { overlay } = getEls();
  if (!overlay) throw new Error('Reconfiguration modal not found');
  overlay.classList.add('active');
}

function closeOverlay() {
  const { overlay } = getEls();
  overlay?.classList.remove('active');
  current = null;
  setApplyReadyState(false);
}

function renderLoading(message) {
  const { body, subtitle } = getEls();
  if (subtitle) subtitle.textContent = '';
  if (body) body.innerHTML = `<div class="analysis-loading">${escapeHtml(message)}</div>`;
  setApplyReadyState(false);
}

/**
 * Show an error state in the modal instead of infinite spinner.
 * @param {string} message - Error message to display
 */
function renderError(message) {
  const { body, subtitle } = getEls();
  if (subtitle) subtitle.textContent = 'Plan generation failed';
  if (body) {
    body.innerHTML = `
      <div class="reconfig-error">
        <div class="reconfig-error-icon">⚠️</div>
        <p>${escapeHtml(message)}</p>
        <p class="reconfig-error-hint">Close this dialog and try again, or use AI Cellar Review for analysis.</p>
      </div>
    `;
  }
  setApplyReadyState(false);
}

function renderPlan(plan) {
  const { subtitle, body } = getEls();
  if (!body) return;

  setApplyReadyState(true);

  const summary = plan?.summary || {};

  if (subtitle) {
    subtitle.textContent = plan?.reasoning ? plan.reasoning : 'Review the proposed changes before applying.';
  }

  const actions = Array.isArray(plan?.actions) ? plan.actions : [];

  const summaryHtml = `
    <div class="reconfig-summary">
      <div><strong>Summary</strong></div>
      <div>• Zones changed: ${escapeHtml(String(summary.zonesChanged ?? actions.length))}</div>
      <div>• Bottles affected: ${escapeHtml(String(summary.bottlesAffected ?? 0))}</div>
      <div>• Misplaced reduced (estimate): ${escapeHtml(String(summary.misplacedBefore ?? 0))} → ${escapeHtml(String(summary.misplacedAfter ?? 0))}</div>
    </div>
  `;

  let actionsHtml = '<div class="reconfig-action">No actions suggested.</div>';
  if (actions.length > 0) {
    actionsHtml = actions.map((a, idx) => renderAction(a, idx)).join('');
  }

  body.innerHTML = `
    ${summaryHtml}
    <div class="reconfig-actions">
      ${actionsHtml}
    </div>
  `;
}

function renderAction(action, idx) {
  const type = action?.type;
  const reason = escapeHtml(action?.reason || '');
  const bottlesAffected = action?.bottlesAffected;

  let title = escapeHtml(String(type || 'action'));

  if (type === 'reallocate_row') {
    title = `Reallocate Row ${escapeHtml(String(action.rowNumber || '?'))} from ${escapeHtml(action.fromZoneId || '')} → ${escapeHtml(action.toZoneId || '')}`;
  } else if (type === 'expand_zone') {
    title = `Expand ${escapeHtml(action.zoneId || '')}`;
  } else if (type === 'merge_zones') {
    title = `Merge ${escapeHtml((action.sourceZones || []).join(', '))} → ${escapeHtml(action.targetZoneId || '')}`;
  } else if (type === 'retire_zone') {
    title = `Retire ${escapeHtml(action.zoneId || '')} → ${escapeHtml(action.mergeIntoZoneId || '')}`;
  }

  const reasonHtml = reason ? `<div class="reconfig-action-reason">${reason}</div>` : '';
  const bottlesAffectedNumber = typeof bottlesAffected === 'number'
    ? bottlesAffected
    : Number(bottlesAffected);
  const hasBottlesAffected = Number.isFinite(bottlesAffectedNumber);
  const bottlesHtml = hasBottlesAffected
    ? `<div class="reconfig-action-meta">• Bottles affected: ${escapeHtml(String(bottlesAffectedNumber))}</div>`
    : '';

  return `
    <div class="reconfig-action">
      <div class="reconfig-action-header">
        <div class="reconfig-action-title">${idx + 1}. ${title}</div>
        <label class="reconfig-skip">
          <input type="checkbox" data-reconfig-skip="${idx}">
          <span>Skip</span>
        </label>
      </div>
      ${reasonHtml}
      ${bottlesHtml}
    </div>
  `;
}

function getSkipIndices() {
  const { body } = getEls();
  if (!body) return [];

  const boxes = body.querySelectorAll('input[data-reconfig-skip]');
  const skip = [];
  boxes.forEach((input) => {
    if (!input.checked) return;
    const idx = Number.parseInt(input.dataset.reconfigSkip, 10);
    if (Number.isFinite(idx)) skip.push(idx);
  });
  return skip;
}

async function handleApply(onRenderAnalysis) {
  const { applyBtn } = getEls();
  const planId = current?.planId;
  if (planId == null || planId === '') throw new Error('No plan loaded');

  const skipActions = getSkipIndices();

  if (applyBtn) applyBtn.disabled = true;
  try {
    const result = await applyReconfigurationPlan(planId, skipActions);
    if (result?.success !== true) throw new Error(result?.error || 'Failed to apply plan');

    closeOverlay();

    const skippedMsg = result.applied?.actionsAutoSkipped > 0
      ? ` (${result.applied.actionsAutoSkipped} action(s) skipped due to stale data)`
      : '';
    showToast(`Applied zone reconfiguration${skippedMsg}`);

    // Surface colour order warnings if any zones ended up in the wrong vertical region
    if (Array.isArray(result.warnings) && result.warnings.length > 0) {
      setTimeout(() => {
        // Extract zone names from warning messages for actionable detail.
        // Warning format: "ZoneName (colour) in R# is in the ... section"
        const zoneNames = result.warnings
          .map(w => { const m = w.match(/^(.+?)\s*\(/); return m ? m[1].trim() : null; })
          .filter(Boolean);
        const unique = [...new Set(zoneNames)];

        let detail;
        if (unique.length === 0) {
          detail = `${result.warnings.length} zone(s) in unexpected region`;
        } else if (unique.length <= 2) {
          detail = `${unique.join(', ')} in unexpected region`;
        } else {
          detail = `${unique.slice(0, 2).join(', ')} +${unique.length - 2} more in unexpected region`;
        }
        showToast(`Colour order: ${detail}`, 'error', 6000);
      }, 1200);
    }

    // Refresh the cellar grid so zone labels update immediately
    await refreshLayout().catch(err => console.warn('[ZoneReconfig] grid refresh failed:', err));

    if (typeof onRenderAnalysis === 'function') {
      const refreshed = await analyseCellar(true);
      // Mark that we just reconfigured - the banner should show a different message
      const reportWithFlag = {
        ...refreshed.report,
        __justReconfigured: true,
        __reconfigResult: result.applied
      };
      onRenderAnalysis(reportWithFlag);
      // Scroll to the success banner so user sees the result
      document.getElementById('analysis-alerts')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  } finally {
    if (applyBtn) applyBtn.disabled = false;
  }
}

/**
 * Open modal and load plan.
 */
export async function openReconfigurationModal({ onRenderAnalysis } = {}) {
  openOverlay();
  renderLoading('Generating reconfiguration plan... This may take 2-3 minutes.');

  const { closeBtn, cancelBtn, applyBtn, overlay } = getEls();

  // Wire close buttons once per open.
  closeBtn?.addEventListener('click', closeOverlay, { once: true });
  cancelBtn?.addEventListener('click', closeOverlay, { once: true });

  // Clicking backdrop closes
  overlay?.addEventListener('click', (e) => {
    if (e.target === overlay) closeOverlay();
  }, { once: true });

  try {
    const planResult = await getReconfigurationPlan({
      includeRetirements: true,
      includeNewZones: true,
      stabilityBias: 'moderate'
    });

    if (planResult?.success !== true) {
      renderError(planResult?.error || 'Failed to generate plan');
      return;
    }

    current = { planId: planResult.planId, plan: planResult.plan };
    renderPlan(planResult.plan);

    applyBtn?.addEventListener('click', async () => {
      try {
        await handleApply(onRenderAnalysis);
      } catch (err) {
        showToast(`Error: ${err.message}`);
      }
    }, { once: true });
  } catch (err) {
    renderError(err.message || 'An unexpected error occurred');
  }
}
