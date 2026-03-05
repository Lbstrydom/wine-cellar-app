/**
 * @fileoverview Zone auto-discovery proposal modal.
 * Displays the collection-aware zone proposal and lets the user apply it.
 * @module cellarAnalysis/zoneProposal
 */

import { apiFetch, API_BASE } from '../api/base.js';
import { escapeHtml, showToast } from '../utils.js';

const fetch = apiFetch;

// ── API helpers ────────────────────────────────────────────

async function fetchZoneProposal(minBottlesPerZone) {
  const body = minBottlesPerZone != null ? JSON.stringify({ minBottlesPerZone }) : '{}';
  const res = await fetch(`${API_BASE}/api/cellar/zones/propose`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to fetch zone proposal');
  }
  return res.json();
}

async function applyZoneProposal(assignments) {
  const res = await fetch(`${API_BASE}/api/cellar/zones/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assignments })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to apply zone proposal');
  }
  return res.json();
}

// ── Rendering helpers ──────────────────────────────────────

function renderConfidenceSummary(summary) {
  if (!summary || summary.total === 0) return '';
  const { high = 0, medium = 0, low = 0, total } = summary;
  const pct = n => Math.round((n / total) * 100);
  return `
    <div class="zone-proposal-confidence">
      <span class="conf-high">${pct(high)}% high confidence</span>
      <span class="conf-medium">${pct(medium)}% medium</span>
      <span class="conf-low">${pct(low)}% low</span>
    </div>
  `;
}

function renderMergedZones(mergedZones) {
  if (!Array.isArray(mergedZones) || mergedZones.length === 0) return '';
  const items = mergedZones.map(m => `
    <li>
      <strong>${escapeHtml(m.displayName)}</strong> (${m.bottleCount} bottle${m.bottleCount !== 1 ? 's' : ''})
      — merged into <em>${escapeHtml(m.mergedIntoDisplayName || m.mergedInto)}</em>
      <span class="merge-reason">${escapeHtml(m.reason)}</span>
    </li>
  `).join('');
  return `
    <div class="zone-proposal-merged">
      <h5>Merged into buffer zones</h5>
      <ul>${items}</ul>
    </div>
  `;
}

function renderProposalZones(proposals) {
  if (!Array.isArray(proposals) || proposals.length === 0) {
    return '<p class="zone-proposal-empty">No zones meet the bottle threshold yet.</p>';
  }
  return proposals.map((p, idx) => {
    const wines = Array.isArray(p.wines) ? p.wines : [];
    const rows = Array.isArray(p.assignedRows) ? p.assignedRows.join(', ') : '—';
    const cc = p.confidenceCounts || {};
    const confHint = cc.low > 0 ? ` · ${cc.low} low-confidence` : '';
    return `
      <div class="zone-proposal-card">
        <div class="zone-proposal-card-header">
          <span class="zone-proposal-order">${idx + 1}</span>
          <span class="zone-proposal-name">${escapeHtml(p.displayName || p.zoneId)}</span>
          <span class="zone-proposal-rows">${escapeHtml(rows)}</span>
        </div>
        <div class="zone-proposal-card-stats">
          <span>${p.bottleCount} bottles</span>
          <span>${p.totalCapacity} slots</span>
          <span>${p.utilizationPercent}% full${confHint}</span>
        </div>
        ${wines.length > 0 ? `<div class="zone-proposal-card-wines">${
          wines.slice(0, 3).map(w => `<small>${escapeHtml(w.name || '')} ${w.vintage || ''}</small>`).join(', ')
        }${wines.length > 3 ? `, <small>+${wines.length - 3} more</small>` : ''}</div>` : ''}
      </div>
    `;
  }).join('');
}

// ── Modal lifecycle ────────────────────────────────────────

let _activeModal = null;
let _onApplied = null;

function closeModal() {
  if (_activeModal) {
    _activeModal.remove();
    _activeModal = null;
  }
}

/**
 * Open the zone proposal modal.
 * @param {Object} [options]
 * @param {Function} [options.onApplied] - Callback fired after proposal is applied
 * @param {number}   [options.minBottlesPerZone] - Override threshold
 */
export function openZoneProposalModal(options = {}) {
  _onApplied = options.onApplied || null;

  // Prevent duplicate modals
  closeModal();

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay zone-proposal-overlay';
  overlay.innerHTML = `
    <div class="modal-content zone-proposal-modal" role="dialog" aria-modal="true" aria-label="Zone proposal">
      <div class="modal-header">
        <h3>Proposed Zone Layout</h3>
        <button class="modal-close" aria-label="Close">&times;</button>
      </div>
      <div class="modal-body zone-proposal-body">
        <div class="zone-proposal-loading">Analysing your collection…</div>
      </div>
      <div class="modal-footer zone-proposal-footer" style="display:none">
        <button class="btn btn-secondary zone-proposal-cancel">Cancel</button>
        <button class="btn btn-primary zone-proposal-apply" disabled>Apply Layout</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  _activeModal = overlay;

  overlay.querySelector('.modal-close').addEventListener('click', closeModal);
  overlay.querySelector('.zone-proposal-cancel')?.addEventListener('click', closeModal);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });

  _loadProposal(overlay, options.minBottlesPerZone);
}

async function _loadProposal(overlay, minBottlesPerZone) {
  const body = overlay.querySelector('.zone-proposal-body');
  const footer = overlay.querySelector('.zone-proposal-footer');
  const applyBtn = overlay.querySelector('.zone-proposal-apply');

  let proposalData = null;

  try {
    proposalData = await fetchZoneProposal(minBottlesPerZone);

    const { proposals = [], mergedZones = [], confidenceSummary, totalBottles = 0 } = proposalData;

    body.innerHTML = `
      <div class="zone-proposal-summary">
        <strong>${totalBottles}</strong> bottles across
        <strong>${proposals.length}</strong> zone${proposals.length !== 1 ? 's' : ''}
        ${confidenceSummary ? renderConfidenceSummary(confidenceSummary) : ''}
      </div>
      <div class="zone-proposal-zones">${renderProposalZones(proposals)}</div>
      ${renderMergedZones(mergedZones)}
      ${proposalData.unassignedRows?.length ? `
        <p class="zone-proposal-spare">
          Spare rows after allocation: ${proposalData.unassignedRows.join(', ')}
        </p>
      ` : ''}
    `;

    if (proposals.length > 0) {
      applyBtn.disabled = false;
    }
  } catch (err) {
    body.innerHTML = `<p class="zone-proposal-error">Error: ${escapeHtml(err.message)}</p>`;
  }

  footer.style.display = '';

  applyBtn.addEventListener('click', async () => {
    if (!proposalData?.proposals?.length) return;
    applyBtn.disabled = true;
    applyBtn.textContent = 'Applying…';

    try {
      const assignments = proposalData.proposals.map(p => ({
        zoneId: p.zoneId,
        assignedRows: p.assignedRows,
        bottleCount: p.bottleCount
      }));
      await applyZoneProposal(assignments);
      showToast('Zone layout applied successfully');
      closeModal();
      if (typeof _onApplied === 'function') _onApplied();
    } catch (err) {
      showToast(`Error: ${err.message}`);
      applyBtn.disabled = false;
      applyBtn.textContent = 'Apply Layout';
    }
  });
}
