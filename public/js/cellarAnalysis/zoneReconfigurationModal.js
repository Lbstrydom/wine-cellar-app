/**
 * @fileoverview Modal UI for holistic zone reconfiguration plan.
 * @module cellarAnalysis/zoneReconfigurationModal
 */

import { getReconfigurationPlan, applyReconfigurationPlan, analyseCellar } from '../api.js';
import { escapeHtml, showToast } from '../utils.js';

let current = null; // { planId, plan }

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
}

function renderLoading(message) {
  const { body, subtitle } = getEls();
  if (subtitle) subtitle.textContent = '';
  if (body) body.innerHTML = `<div class="analysis-loading">${escapeHtml(message)}</div>`;
}

function renderPlan(plan) {
  const { subtitle, body } = getEls();
  if (!body) return;

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

  const actionsHtml = actions.length
    ? actions.map((a, idx) => renderAction(a, idx)).join('')
    : '<div class="reconfig-action">No actions suggested.</div>';

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
  const bottles = action?.bottlesAffected != null ? `• Bottles affected: ${escapeHtml(String(action.bottlesAffected))}` : '';

  let title = escapeHtml(String(type || 'action'));

  if (type === 'expand_zone') {
    title = `Expand ${escapeHtml(action.zoneId || '')}`;
  } else if (type === 'merge_zones') {
    title = `Merge ${escapeHtml((action.sourceZones || []).join(', '))} → ${escapeHtml(action.targetZoneId || '')}`;
  } else if (type === 'retire_zone') {
    title = `Retire ${escapeHtml(action.zoneId || '')} → ${escapeHtml(action.mergeIntoZoneId || '')}`;
  }

  return `
    <div class="reconfig-action">
      <div class="reconfig-action-header">
        <div class="reconfig-action-title">${idx + 1}. ${title}</div>
        <label class="reconfig-skip">
          <input type="checkbox" data-reconfig-skip="${idx}">
          <span>Skip</span>
        </label>
      </div>
      ${reason ? `<div class="reconfig-action-reason">${reason}</div>` : ''}
      ${bottles ? `<div class="reconfig-action-meta">${bottles}</div>` : ''}
    </div>
  `;
}

function getSkipIndices() {
  const { body } = getEls();
  if (!body) return [];
  const boxes = body.querySelectorAll('[data-reconfig-skip]');
  const skip = [];
  boxes.forEach(b => {
    if (b.checked) {
      const idx = parseInt(b.getAttribute('data-reconfig-skip'), 10);
      if (Number.isFinite(idx)) skip.push(idx);
    }
  });
  return skip;
}

async function handleApply(onRenderAnalysis) {
  const { applyBtn } = getEls();
  if (!current?.planId) throw new Error('No plan loaded');

  const skipActions = getSkipIndices();

  if (applyBtn) applyBtn.disabled = true;
  try {
    const result = await applyReconfigurationPlan(current.planId, skipActions);
    if (!result?.success) throw new Error(result?.error || 'Failed to apply plan');

    closeOverlay();
    showToast('Applied zone reconfiguration');

    if (typeof onRenderAnalysis === 'function') {
      const refreshed = await analyseCellar(true);
      onRenderAnalysis(refreshed.report);
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
  renderLoading('Generating reconfiguration plan...');

  const { closeBtn, cancelBtn, applyBtn, overlay } = getEls();

  // Wire close buttons once per open.
  closeBtn?.addEventListener('click', closeOverlay, { once: true });
  cancelBtn?.addEventListener('click', closeOverlay, { once: true });

  // Clicking backdrop closes
  overlay?.addEventListener('click', (e) => {
    if (e.target === overlay) closeOverlay();
  }, { once: true });

  const planResult = await getReconfigurationPlan({
    includeRetirements: true,
    includeNewZones: true,
    stabilityBias: 'moderate'
  });

  if (!planResult?.success) {
    throw new Error(planResult?.error || 'Failed to generate plan');
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
}
