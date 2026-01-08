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

  // Build candidates display
  let candidatesHtml = '';
  if (fridgeStatus.candidates && fridgeStatus.candidates.length > 0) {
    const candidateItems = fridgeStatus.candidates.slice(0, 5).map((c, i) => `
      <div class="fridge-candidate">
        <div class="fridge-candidate-info">
          <div class="fridge-candidate-name">${escapeHtml(c.wineName)} ${c.vintage || ''}</div>
          <div class="fridge-candidate-reason">${escapeHtml(c.reason)}</div>
        </div>
        <button class="btn btn-secondary btn-small fridge-add-btn" data-candidate-index="${i}">
          Add
        </button>
      </div>
    `).join('');

    candidatesHtml = `
      <div class="fridge-candidates">
        <h5>Suggested Additions</h5>
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

  // Attach event listeners for fridge candidate add buttons (CSP-compliant)
  contentEl.querySelectorAll('.fridge-add-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const index = Number.parseInt(btn.dataset.candidateIndex, 10);
      moveFridgeCandidate(index);
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
