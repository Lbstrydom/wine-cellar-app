/**
 * @fileoverview Zone narratives, intent editing, and zone setup wizard.
 * @module cellarAnalysis/zones
 */

import {
  executeCellarMoves,
  getZoneLayoutProposal,
  confirmZoneLayout,
  getConsolidationMoves
} from '../api.js';
import { showToast, escapeHtml } from '../utils.js';
import { refreshLayout } from '../app.js';
import {
  getCurrentProposal,
  setCurrentProposal,
  getCurrentZoneMoves,
  setCurrentZoneMoves,
  getCurrentZoneIndex,
  setCurrentZoneIndex
} from './state.js';
import { loadAnalysis } from './analysis.js';
import { renderZoneProposal } from './zoneProposalView.js';

/**
 * Render zone narratives as cards.
 * @param {Array} narratives
 */
export function renderZoneNarratives(narratives) {
  const container = document.getElementById('analysis-zones');
  const gridEl = document.getElementById('zone-cards-grid');

  if (!narratives || narratives.length === 0) {
    container.style.display = 'none';
    return;
  }

  container.style.display = 'block';

  const cards = narratives.map(zone => {
    const status = zone.health?.status || 'healthy';
    const purpose = zone.intent?.purpose || 'Mixed wines';
    const pairingHints = zone.intent?.pairingHints?.slice(0, 3) || [];
    const rows = zone.rows?.join(', ') || 'N/A';
    const bottles = zone.currentComposition?.bottleCount || 0;
    const utilization = zone.health?.utilizationPercent || 0;
    const topGrapes = zone.currentComposition?.topGrapes?.slice(0, 2) || [];
    const topCountries = zone.currentComposition?.topCountries?.slice(0, 2) || [];

    const compositionParts = [];
    if (topGrapes.length > 0) compositionParts.push(topGrapes.join(', '));
    if (topCountries.length > 0 && topCountries[0] !== 'Unknown') {
      compositionParts.push(`from ${topCountries.join(', ')}`);
    }

    return `
      <div class="zone-card ${status}">
        <div class="zone-card-header">
          <span class="zone-card-title">${zone.displayName}</span>
          <span class="zone-card-status ${status}">${status}</span>
        </div>
        <div class="zone-card-purpose">${purpose}</div>
        <div class="zone-card-stats">
          <span>${bottles} bottles</span>
          <span>${utilization}% full</span>
          <span>Rows: ${rows}</span>
        </div>
        ${compositionParts.length > 0 ? `
          <div class="zone-card-composition">
            Currently: ${compositionParts.join(' ')}
          </div>
        ` : `
          <div class="zone-card-composition">
            Currently: empty
          </div>
        `}
        ${pairingHints.length > 0 ? `
          <div class="zone-card-pairing">
            <strong>Pairs with:</strong> ${pairingHints.join(', ')}
          </div>
        ` : ''}
      </div>
    `;
  }).filter(Boolean).join('');

  gridEl.innerHTML = cards || '<p class="no-moves">No zones with bottles found.</p>';
}

/**
 * Start the zone setup wizard.
 */
export async function startZoneSetup() {
  const wizard = document.getElementById('zone-setup-wizard');
  const proposalList = document.getElementById('zone-proposal-list');
  const step1 = document.getElementById('wizard-step-1');
  const step2 = document.getElementById('wizard-step-2');
  const confirmLayoutBtn = document.getElementById('confirm-layout-btn');

  if (!wizard || !proposalList) return;

  // Show wizard, hide other sections
  wizard.style.display = 'block';
  step1.style.display = 'block';
  step2.style.display = 'none';
  document.getElementById('analysis-fridge')?.style.setProperty('display', 'none');
  document.getElementById('analysis-zones')?.style.setProperty('display', 'none');
  document.getElementById('analysis-moves')?.style.setProperty('display', 'none');
  document.getElementById('layout-proposal-cta')?.style.setProperty('display', 'none');
  document.getElementById('layout-diff-container')?.style.setProperty('display', 'none');
  document.getElementById('analysis-ai-advice')?.style.setProperty('display', 'none');

  proposalList.innerHTML = '<div class="analysis-loading">Generating zone layout proposal...</div>';
  if (confirmLayoutBtn) confirmLayoutBtn.disabled = true;

  try {
    const proposal = await getZoneLayoutProposal();
    setCurrentProposal(proposal);
    proposalList.innerHTML = renderZoneProposal(proposal);
    if (confirmLayoutBtn) {
      const hasAllocations = Array.isArray(proposal?.proposals) && proposal.proposals.length > 0;
      confirmLayoutBtn.disabled = !hasAllocations;
    }
  } catch (err) {
    proposalList.innerHTML = `<div class="ai-advice-error">Error: ${err.message}</div>`;
    if (confirmLayoutBtn) confirmLayoutBtn.disabled = true;
  }
}

/**
 * Handle confirming the zone layout.
 */
export async function handleConfirmLayout() {
  const currentProposal = getCurrentProposal();
  const proposals = Array.isArray(currentProposal?.proposals) ? currentProposal.proposals : [];
  if (proposals.length === 0) {
    showToast('No dedicated rows to confirm yet');
    return;
  }

  const assignments = proposals.map(p => ({
    zoneId: p.zoneId,
    assignedRows: p.assignedRows,
    bottleCount: p.bottleCount
  }));

  try {
    await confirmZoneLayout(assignments);
    showToast('Zone layout confirmed! Generating moves...');

    // Move to step 2
    document.getElementById('wizard-step-1').style.display = 'none';
    document.getElementById('wizard-step-2').style.display = 'block';

    await loadZoneMoves();
  } catch (err) {
    showToast(`Error: ${err.message}`);
  }
}

/**
 * Load and display zone consolidation moves.
 */
async function loadZoneMoves() {
  const movesContainer = document.getElementById('zone-moves-wizard');
  if (!movesContainer) return;

  movesContainer.innerHTML = '<div class="analysis-loading">Calculating moves...</div>';

  try {
    const zoneMoves = await getConsolidationMoves();
    setCurrentZoneMoves(zoneMoves);
    setCurrentZoneIndex(0);
    renderZoneMovesList();
  } catch (err) {
    movesContainer.innerHTML = `<div class="ai-advice-error">Error: ${err.message}</div>`;
  }
}

/**
 * Render the zone-by-zone moves interface.
 */
function renderZoneMovesList() {
  const container = document.getElementById('zone-moves-wizard');
  const currentZoneMoves = getCurrentZoneMoves();
  const currentZoneIndex = getCurrentZoneIndex();
  
  if (!container || !currentZoneMoves) return;

  const { movesByZone, totalMoves } = currentZoneMoves;
  const zoneIds = Object.keys(movesByZone);

  if (totalMoves === 0) {
    container.innerHTML = `
      <div class="moves-complete">
        <h4>All bottles are already in their correct zones!</h4>
        <p>No moves needed. Your cellar is organized.</p>
        <button class="btn btn-primary finish-setup-btn">Finish</button>
      </div>
    `;
    container.querySelector('.finish-setup-btn')?.addEventListener('click', finishZoneSetup);
    return;
  }

  let html = `
    <div class="moves-summary">
      <strong>${totalMoves} moves</strong> needed across <strong>${zoneIds.length} zones</strong>
    </div>
    <div class="zone-moves-list">
  `;

  zoneIds.forEach((zoneId, idx) => {
    const moves = movesByZone[zoneId];
    const isActive = idx === currentZoneIndex;
    const isComplete = idx < currentZoneIndex;
    let statusIcon = '○';
    if (isComplete) {
      statusIcon = '✓';
    } else if (isActive) {
      statusIcon = '→';
    }

    html += `
      <div class="zone-moves-section ${isActive ? 'active' : ''} ${isComplete ? 'complete' : ''}" data-zone="${escapeHtml(zoneId)}" data-zone-idx="${idx}">
        <div class="zone-moves-header expand-zone-btn" data-zone="${escapeHtml(zoneId)}" data-zone-idx="${idx}">
          <span class="zone-status-icon">${statusIcon}</span>
          <span class="zone-name">${escapeHtml(zoneId)}</span>
          <span class="zone-move-count">${moves.length} moves</span>
        </div>
        <div class="zone-moves-body" style="display: ${isActive ? 'block' : 'none'}">
          ${moves.map((m, mIdx) => `
            <div class="move-item" data-move-idx="${mIdx}">
              <span class="move-wine">${escapeHtml(m.wineName)} ${m.vintage || ''}</span>
              <span class="move-arrow">→</span>
              <span class="move-from">${m.fromSlot}</span>
              <span class="move-to">${m.toSlot}</span>
              <button class="btn btn-small btn-primary zone-move-btn" data-zone="${escapeHtml(zoneId)}" data-move-idx="${mIdx}">Move</button>
            </div>
          `).join('')}
          <div class="zone-moves-actions">
            <button class="btn btn-primary zone-execute-all-btn" data-zone="${escapeHtml(zoneId)}" data-move-count="${moves.length}">Execute All ${moves.length} Moves</button>
            <button class="btn btn-secondary skip-zone-btn">Skip Zone</button>
          </div>
        </div>
      </div>
    `;
  });

  html += `
    </div>
    <div class="wizard-footer">
      <button class="btn btn-secondary finish-setup-btn">Finish Setup</button>
    </div>
  `;

  container.innerHTML = html;

  // Attach event listeners (CSP-compliant)
  container.querySelectorAll('.expand-zone-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = Number.parseInt(btn.dataset.zoneIdx, 10);
      expandZone(idx);
    });
  });
  container.querySelectorAll('.zone-move-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const zoneId = btn.dataset.zone;
      const moveIdx = Number.parseInt(btn.dataset.moveIdx, 10);
      executeZoneMove(zoneId, moveIdx);
    });
  });
  container.querySelectorAll('.zone-execute-all-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const zoneId = btn.dataset.zone;
      executeAllZoneMoves(zoneId);
    });
  });
  container.querySelectorAll('.skip-zone-btn').forEach(btn => {
    btn.addEventListener('click', skipZone);
  });
  container.querySelectorAll('.finish-setup-btn').forEach(btn => {
    btn.addEventListener('click', finishZoneSetup);
  });
}

/**
 * Execute a single move within a zone.
 * @param {string} zoneId - Zone ID
 * @param {number} moveIdx - Move index
 */
async function executeZoneMove(zoneId, moveIdx) {
  const currentZoneMoves = getCurrentZoneMoves();
  const moves = currentZoneMoves?.movesByZone?.[zoneId];
  if (!moves?.[moveIdx]) return;

  const move = moves[moveIdx];

  try {
    await executeCellarMoves([{
      wineId: move.wineId,
      from: move.fromSlot,
      to: move.toSlot,
      zoneId: move.zoneId
    }]);

    // Remove from list
    moves.splice(moveIdx, 1);
    currentZoneMoves.totalMoves--;

    showToast(`Moved ${move.wineName} to ${move.toSlot}`);
    renderZoneMovesList();
    refreshLayout();
  } catch (err) {
    showToast(`Error: ${err.message}`);
  }
}

/**
 * Execute all moves for a zone.
 * @param {string} zoneId - Zone ID
 */
async function executeAllZoneMoves(zoneId) {
  const currentZoneMoves = getCurrentZoneMoves();
  const moves = currentZoneMoves?.movesByZone?.[zoneId];
  if (!moves || moves.length === 0) return;

  const movesToExecute = moves.map(m => ({
    wineId: m.wineId,
    from: m.fromSlot,
    to: m.toSlot,
    zoneId: m.zoneId
  }));

  try {
    const result = await executeCellarMoves(movesToExecute);
    showToast(`Executed ${result.moved} moves for ${zoneId}`);

    // Clear moves and advance
    currentZoneMoves.totalMoves -= moves.length;
    currentZoneMoves.movesByZone[zoneId] = [];
    setCurrentZoneIndex(getCurrentZoneIndex() + 1);

    renderZoneMovesList();
    refreshLayout();
  } catch (err) {
    showToast(`Error: ${err.message}`);
  }
}

/**
 * Skip to next zone.
 */
function skipZone() {
  const currentZoneMoves = getCurrentZoneMoves();
  const currentZoneIndex = getCurrentZoneIndex();
  const zoneIds = Object.keys(currentZoneMoves?.movesByZone || {});
  if (currentZoneIndex < zoneIds.length - 1) {
    setCurrentZoneIndex(currentZoneIndex + 1);
    renderZoneMovesList();
  }
}

/**
 * Expand a specific zone section.
 * @param {number} idx - Zone index
 */
function expandZone(idx) {
  setCurrentZoneIndex(idx);
  renderZoneMovesList();
}

/**
 * Cancel zone setup and return to normal view.
 */
export function cancelZoneSetup() {
  document.getElementById('zone-setup-wizard').style.display = 'none';
  setCurrentProposal(null);
  loadAnalysis();
}

/**
 * Finish zone setup wizard.
 */
function finishZoneSetup() {
  document.getElementById('zone-setup-wizard').style.display = 'none';
  setCurrentProposal(null);
  setCurrentZoneMoves(null);
  showToast('Zone setup complete!');
  loadAnalysis();
}
