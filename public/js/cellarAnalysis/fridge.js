/**
 * @fileoverview Fridge-specific functionality.
 * @module cellarAnalysis/fridge
 */

import { executeCellarMoves, getFridgeOrganization } from '../api.js';
import { showToast, escapeHtml } from '../utils.js';
import { refreshLayout } from '../app.js';
import { getCurrentAnalysis } from './state.js';
import { loadAnalysis } from './analysis.js';

/**
 * Render fridge status with par-level gaps and candidates.
 * @param {Object} fridgeStatus
 */
export function renderFridgeStatus(fridgeStatus) {
  const container = document.getElementById('analysis-fridge');
  const contentEl = document.getElementById('fridge-status-content');

  if (!fridgeStatus) {
    container.style.display = 'none';
    return;
  }

  container.style.display = 'block';
  const fillPercent = Math.round((fridgeStatus.occupied / fridgeStatus.capacity) * 100);

  // Build current mix display
  const categories = ['sparkling', 'crispWhite', 'aromaticWhite', 'textureWhite', 'rose', 'chillableRed', 'flex'];
  const categoryLabels = {
    sparkling: 'Sparkling',
    crispWhite: 'Crisp White',
    aromaticWhite: 'Aromatic',
    textureWhite: 'Oaked White',
    rose: 'Rosé',
    chillableRed: 'Light Red',
    flex: 'Flex'
  };

  const mixHtml = categories.map(cat => {
    const count = fridgeStatus.currentMix?.[cat] || 0;
    const hasGap = fridgeStatus.parLevelGaps?.[cat];
    return `
      <div class="fridge-category ${hasGap ? 'has-gap' : ''}">
        <div class="count">${count}</div>
        <div class="name">${categoryLabels[cat]}</div>
      </div>
    `;
  }).join('');

  // Build gaps display
  let gapsHtml = '';
  if (fridgeStatus.hasGaps && Object.keys(fridgeStatus.parLevelGaps).length > 0) {
    const gapItems = Object.entries(fridgeStatus.parLevelGaps)
      .sort((a, b) => a[1].priority - b[1].priority)
      .map(([cat, gap]) => `
        <div class="fridge-gap-item">
          <span>${categoryLabels[cat] || cat}: ${gap.description}</span>
          <span class="need">Need ${gap.need}</span>
        </div>
      `).join('');

    gapsHtml = `
      <div class="fridge-gaps">
        <h5>Par-Level Gaps</h5>
        ${gapItems}
      </div>
    `;
  }

  // Build candidates display — "Add" when empty slots, "Swap" when fridge is full
  let candidatesHtml = '';
  const isFridgeFull = fridgeStatus.emptySlots <= 0;
  if (fridgeStatus.candidates && fridgeStatus.candidates.length > 0) {
    const candidateItems = fridgeStatus.candidates.slice(0, 5).map((c, i) => {
      if (isFridgeFull) {
        const swapTarget = identifySwapTarget(fridgeStatus, c);
        const swapDetail = swapTarget
          ? `<div class="fridge-swap-detail">
              Swap with <strong>${escapeHtml(swapTarget.wineName || swapTarget.name)}</strong> (${escapeHtml(swapTarget.slot)}) — move back to ${escapeHtml(c.fromSlot)}
              <span class="fridge-swap-why">${escapeHtml(buildSwapOutReason(swapTarget))}</span>
            </div>`
          : '';
        return `
          <div class="fridge-candidate">
            <div class="fridge-candidate-info">
              <div class="fridge-candidate-name">${escapeHtml(c.wineName)} ${c.vintage || ''}</div>
              <div class="fridge-candidate-reason">${escapeHtml(c.reason)}</div>
              ${swapDetail}
            </div>
            <button class="btn btn-secondary btn-small fridge-swap-btn" data-candidate-index="${i}" ${!swapTarget ? 'disabled' : ''}>
              Swap
            </button>
          </div>
        `;
      }
      // Empty slot available — simple "Add" button with target slot
      const targetSlot = findEmptyFridgeSlot(fridgeStatus);
      return `
        <div class="fridge-candidate">
          <div class="fridge-candidate-info">
            <div class="fridge-candidate-name">${escapeHtml(c.wineName)} ${c.vintage || ''}</div>
            <div class="fridge-candidate-reason">${escapeHtml(c.reason)}</div>
            ${targetSlot ? `<div class="fridge-target-slot">Add to ${escapeHtml(targetSlot)}</div>` : ''}
          </div>
          <button class="btn btn-secondary btn-small fridge-add-btn" data-candidate-index="${i}">
            ${targetSlot ? `Add to ${escapeHtml(targetSlot)}` : 'Add'}
          </button>
        </div>
      `;
    }).join('');

    candidatesHtml = `
      <div class="fridge-candidates">
        <h5>${isFridgeFull ? 'Suggested Swaps' : 'Suggested Additions'}</h5>
        ${candidateItems}
      </div>
    `;
  }

  // Organize button (only show if 2+ wines in fridge)
  const organizeBtn = fridgeStatus.occupied >= 2
    ? '<button class="btn btn-secondary btn-small organize-fridge-btn">Organize Fridge</button>'
    : '';

  contentEl.innerHTML = `
    <div class="fridge-status-header">
      <div class="fridge-capacity-bar">
        <div class="fridge-capacity-fill" style="width: ${fillPercent}%"></div>
      </div>
      <div class="fridge-capacity-text">${fridgeStatus.occupied}/${fridgeStatus.capacity} slots ${organizeBtn}</div>
    </div>
    <div class="fridge-mix-grid">${mixHtml}</div>
    ${gapsHtml}
    ${candidatesHtml}
    <div id="fridge-organize-panel" style="display: none;"></div>
  `;

  // Attach event listeners for fridge candidate buttons (CSP-compliant)
  contentEl.querySelectorAll('.fridge-add-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const index = Number.parseInt(btn.dataset.candidateIndex, 10);
      moveFridgeCandidate(index);
    });
  });
  contentEl.querySelectorAll('.fridge-swap-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const index = Number.parseInt(btn.dataset.candidateIndex, 10);
      swapFridgeCandidate(index);
    });
  });

  // Attach organize fridge button handler
  const organizeButton = contentEl.querySelector('.organize-fridge-btn');
  if (organizeButton) {
    organizeButton.addEventListener('click', handleOrganizeFridge);
  }
}

/**
 * Move a fridge candidate to the fridge.
 * @param {number} index - Candidate index
 */
async function moveFridgeCandidate(index) {
  const currentAnalysis = getCurrentAnalysis();
  if (!currentAnalysis?.fridgeStatus?.candidates?.[index]) {
    showToast('Error: Candidate not found');
    return;
  }

  const candidate = currentAnalysis.fridgeStatus.candidates[index];
  const emptySlots = currentAnalysis.fridgeStatus.emptySlots;

  if (emptySlots <= 0) {
    showToast('No empty fridge slots available');
    return;
  }

  // Find an empty fridge slot
  const fridgeSlots = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9'];
  const occupiedSlots = new Set(currentAnalysis.fridgeStatus.wines?.map(w => w.slot) || []);
  const targetSlot = fridgeSlots.find(s => !occupiedSlots.has(s));

  if (!targetSlot) {
    showToast('No empty fridge slots available');
    return;
  }

  if (!candidate.fromSlot) {
    showToast('Error: Wine location unknown');
    return;
  }

  try {
    await executeCellarMoves([{
      wineId: candidate.wineId,
      from: candidate.fromSlot,
      to: targetSlot
    }]);
    showToast(`Moved ${candidate.wineName} to ${targetSlot}`);

    // Re-analyse to show updated state
    await loadAnalysis();
    refreshLayout();
  } catch (err) {
    showToast(`Error: ${err.message}`);
  }
}

/**
 * Handle the "Organize Fridge" button click.
 * Shows suggested moves to group wines by category.
 */
async function handleOrganizeFridge() {
  const panel = document.getElementById('fridge-organize-panel');
  if (!panel) return;

  // Toggle visibility if already showing
  if (panel.style.display !== 'none') {
    panel.style.display = 'none';
    return;
  }

  panel.style.display = 'block';
  panel.innerHTML = '<div class="analysis-loading">Calculating optimal arrangement...</div>';

  try {
    const result = await getFridgeOrganization();

    if (!result.moves || result.moves.length === 0) {
      panel.innerHTML = `
        <div class="fridge-organize-result">
          <p class="no-moves">Your fridge is already well-organized by category.</p>
          ${result.summary ? renderFridgeSummary(result.summary) : ''}
        </div>
      `;
      return;
    }

    // If moves involve swaps, individual moves would cause data loss
    const hasSwaps = result.hasSwaps || result.mustExecuteAsBatch;
    const swapWarning = hasSwaps
      ? `<div class="swap-warning">
          <strong>Note:</strong> These moves involve swaps - they must be executed together to avoid losing bottles.
         </div>`
      : '';

    panel.innerHTML = `
      <div class="fridge-organize-result">
        <h5>Suggested Reorganization</h5>
        <p class="organize-description">Grouping wines by category (coldest at top):</p>
        ${swapWarning}
        ${renderFridgeSummary(result.summary)}
        <div class="fridge-moves-list">
          ${result.moves.map((m, i) => `
            <div class="fridge-move-item" data-move-index="${i}">
              <span class="move-wine">${escapeHtml(m.wineName)} ${m.vintage || ''}</span>
              <span class="move-category">${escapeHtml(m.category)}</span>
              <span class="move-path">${m.from} → ${m.to}</span>
              ${hasSwaps
                ? '<span class="move-locked" title="Must execute all moves together">🔒</span>'
                : `<button class="btn btn-small btn-primary fridge-move-btn" data-move-index="${i}">Move</button>`
              }
            </div>
          `).join('')}
        </div>
        <div class="fridge-organize-actions">
          <button class="btn btn-primary execute-all-fridge-moves-btn">Execute All ${result.moves.length} Moves</button>
          <button class="btn btn-secondary close-organize-btn">Close</button>
        </div>
      </div>
    `;

    // Store moves for execution
    panel.dataset.moves = JSON.stringify(result.moves);

    // Attach event listeners (only for individual moves if no swaps)
    if (!hasSwaps) {
      panel.querySelectorAll('.fridge-move-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = Number.parseInt(btn.dataset.moveIndex, 10);
          executeFridgeOrganizeMove(idx);
        });
      });
    }

    panel.querySelector('.execute-all-fridge-moves-btn')?.addEventListener('click', executeAllFridgeOrganizeMoves);
    panel.querySelector('.close-organize-btn')?.addEventListener('click', () => {
      panel.style.display = 'none';
    });

  } catch (err) {
    panel.innerHTML = `<div class="ai-advice-error">Error: ${err.message}</div>`;
  }
}

/**
 * Render fridge organization summary.
 * @param {Array} summary - Category groups
 * @returns {string} HTML
 */
function renderFridgeSummary(summary) {
  if (!summary || summary.length === 0) return '';

  return `
    <div class="fridge-summary">
      ${summary.map(g => `
        <span class="fridge-summary-item">
          <span class="category-name">${escapeHtml(g.name)}</span>
          <span class="category-slots">${g.startSlot}${g.startSlot === g.endSlot ? '' : '-' + g.endSlot}</span>
        </span>
      `).join('')}
    </div>
  `;
}

/**
 * Execute a single fridge organization move.
 * @param {number} index - Move index
 */
async function executeFridgeOrganizeMove(index) {
  const panel = document.getElementById('fridge-organize-panel');
  if (!panel) return;

  const moves = JSON.parse(panel.dataset.moves || '[]');
  const move = moves[index];
  if (!move) return;

  try {
    await executeCellarMoves([{
      wineId: move.wineId,
      from: move.from,
      to: move.to
    }]);
    showToast(`Moved ${move.wineName} to ${move.to}`);

    // Remove from list and refresh
    moves.splice(index, 1);
    panel.dataset.moves = JSON.stringify(moves);

    // Refresh UI
    await loadAnalysis();
    refreshLayout();
  } catch (err) {
    showToast(`Error: ${err.message}`);
  }
}

/**
 * Execute all fridge organization moves.
 */
async function executeAllFridgeOrganizeMoves() {
  const panel = document.getElementById('fridge-organize-panel');
  if (!panel) return;

  const moves = JSON.parse(panel.dataset.moves || '[]');
  if (moves.length === 0) {
    showToast('No moves to execute');
    return;
  }

  try {
    const movesToExecute = moves.map(m => ({
      wineId: m.wineId,
      from: m.from,
      to: m.to
    }));

    const result = await executeCellarMoves(movesToExecute);
    showToast(`Executed ${result.moved} moves`);

    // Clear and refresh
    panel.style.display = 'none';
    await loadAnalysis();
    refreshLayout();
  } catch (err) {
    showToast(`Error: ${err.message}`);
  }
}

/**
 * Find the best fridge wine to swap out for a given candidate.
 * Priority: doesn't fill a gap category > lowest drinking urgency.
 * @param {Object} fridgeStatus - Current fridge status
 * @param {Object} candidate - The candidate wine to swap in
 * @returns {Object|null} Fridge wine to swap out
 */
function identifySwapTarget(fridgeStatus, candidate) {
  const fridgeWines = fridgeStatus.wines || [];
  if (fridgeWines.length === 0) return null;

  return fridgeWines
    .filter(w => w.wineId !== candidate.wineId)
    .sort((a, b) => {
      // 1. Prefer swapping out wines that DON'T fill any gap category
      const aMatchesGap = fridgeStatus.parLevelGaps?.[a.category] ? 0 : 1;
      const bMatchesGap = fridgeStatus.parLevelGaps?.[b.category] ? 0 : 1;
      if (aMatchesGap !== bMatchesGap) return bMatchesGap - aMatchesGap;
      // 2. Lowest drinking urgency first (can wait longest in cellar)
      return computeUrgency(a.drinkByYear) - computeUrgency(b.drinkByYear);
    })[0] || null;
}

/**
 * Compute drinking urgency from drinkByYear.
 * Higher = more urgent (should stay in fridge). Lower = can wait (good swap-out).
 * @param {number|null} drinkByYear
 * @returns {number}
 */
function computeUrgency(drinkByYear) {
  if (!drinkByYear) return 2;
  const yearsLeft = drinkByYear - new Date().getFullYear();
  if (yearsLeft <= 0) return 10;
  if (yearsLeft <= 2) return 7;
  if (yearsLeft <= 5) return 4;
  return 1;
}

/**
 * Build a human-readable reason for why a fridge wine should be swapped out.
 * @param {Object} fridgeWine - Wine currently in fridge
 * @returns {string}
 */
function buildSwapOutReason(fridgeWine) {
  const drinkBy = fridgeWine.drinkByYear;
  if (!drinkBy) return 'No rush to chill \u2014 stores well in cellar';
  const yearsLeft = drinkBy - new Date().getFullYear();
  if (yearsLeft > 5) return `Drink by ${drinkBy} \u2014 plenty of time, better stored in cellar`;
  if (yearsLeft > 2) return `Drink by ${drinkBy} \u2014 can wait in cellar for now`;
  return `Drink by ${drinkBy} \u2014 approaching window but OK in cellar short-term`;
}

/**
 * Execute a swap: candidate wine goes into fridge, fridge wine goes to candidate's cellar slot.
 * @param {number} candidateIndex - Index into fridgeStatus.candidates
 */
async function swapFridgeCandidate(candidateIndex) {
  const analysis = getCurrentAnalysis();
  const candidate = analysis?.fridgeStatus?.candidates?.[candidateIndex];
  if (!candidate) { showToast('Error: Candidate not found'); return; }

  const swapOut = identifySwapTarget(analysis.fridgeStatus, candidate);
  if (!swapOut) { showToast('No suitable swap found'); return; }

  try {
    await executeCellarMoves([
      { wineId: swapOut.wineId, from: swapOut.slot, to: candidate.fromSlot },
      { wineId: candidate.wineId, from: candidate.fromSlot, to: swapOut.slot }
    ]);
    const swapOutName = swapOut.wineName || swapOut.name;
    showToast(`Swapped: ${candidate.wineName} \u2192 ${swapOut.slot}, ${swapOutName} \u2192 ${candidate.fromSlot}`);
    await loadAnalysis();
    refreshLayout();
  } catch (err) {
    showToast(`Error: ${err.message}`);
  }
}

/**
 * Find an empty fridge slot.
 * @param {Object} fridgeStatus
 * @returns {string|null}
 */
function findEmptyFridgeSlot(fridgeStatus) {
  const fridgeSlots = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9'];
  const occupiedSlots = new Set(fridgeStatus.wines?.map(w => w.slot) || []);
  return fridgeSlots.find(s => !occupiedSlots.has(s)) || null;
}

// Exported for unit testing
export { identifySwapTarget, computeUrgency, buildSwapOutReason, findEmptyFridgeSlot };
