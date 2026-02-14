/**
 * @fileoverview Move suggestions and execution.
 * @module cellarAnalysis/moves
 */

import { executeCellarMoves } from '../api.js';
import { showToast, escapeHtml } from '../utils.js';
import { refreshLayout } from '../app.js';
import { getCurrentAnalysis } from './state.js';
import { loadAnalysis } from './analysis.js';
import { openMoveGuide, detectSwapPairs } from './moveGuide.js';

/**
 * Render suggested moves.
 * @param {Array} moves
 * @param {boolean} needsZoneSetup
 * @param {boolean} hasSwaps - True if moves involve swaps that require batch execution
 */
export function renderMoves(moves, needsZoneSetup, hasSwaps = false) {
  const listEl = document.getElementById('moves-list');
  const actionsEl = document.getElementById('moves-actions');

  // When zones aren't configured, show explanation
  if (needsZoneSetup) {
    listEl.innerHTML = `
      <div class="no-moves">
        <p>Zone allocations haven't been configured yet.</p>
        <p>Tap <strong>"Setup Zones"</strong> above to have AI propose a zone layout and guide you through organising your bottles.</p>
      </div>
    `;
    actionsEl.style.display = 'none';
    return;
  }

  if (!moves || moves.length === 0) {
    listEl.innerHTML = '<div class="no-moves">All bottles are well-organised!</div>';
    actionsEl.style.display = 'none';
    return;
  }

  const actionableMoves = moves.filter(m => m.type === 'move');
  const sources = new Set(actionableMoves.map(m => m.from));

  // Use shared swap detection (typeFilter skips non-move entries)
  const swapPartnerByIndex = detectSwapPairs(moves, { typeFilter: 'move' });

  const swapIndices = new Set();
  let swapPairs = 0;
  for (const [idx, partnerIdx] of swapPartnerByIndex.entries()) {
    if (swapIndices.has(idx) || swapIndices.has(partnerIdx)) continue;
    if (idx < partnerIdx && swapPartnerByIndex.get(partnerIdx) === idx) {
      swapPairs++;
      swapIndices.add(idx);
      swapIndices.add(partnerIdx);
    }
  }

  const dependentNonSwapCount = moves.filter((m, idx) => {
    if (!m || m.type !== 'move') return false;
    if (swapIndices.has(idx)) return false;
    return sources.has(m.to);
  }).length;

  const swapPlural = swapPairs === 1 ? '' : 's';
  const dependentPlural = dependentNonSwapCount === 1 ? '' : 's';

  // If moves depend on each other, show warning and lock only the dependent ones
  let swapWarning = '';
  if (hasSwaps) {
    if (dependentNonSwapCount > 0) {
      swapWarning = `<div class="swap-warning">
        <strong>Note:</strong> Some moves depend on other moves (${dependentNonSwapCount} move${dependentPlural} target occupied slots that are being vacated).
        Execute all moves together to avoid losing bottles.
      </div>`;
    } else if (swapPairs > 0) {
      swapWarning = `<div class="swap-warning">
        <strong>Note:</strong> ${swapPairs} swap${swapPlural} detected (marked with <span class="swap-badge">SWAP</span>).
        Use the <strong>Swap</strong> buttons to execute each pair safely, or use <strong>Execute All</strong>.
      </div>`;
    }
  }

  listEl.innerHTML = swapWarning + moves.map((move, index) => {
    if (move.type === 'manual') {
      return `
        <div class="move-item move-item-manual priority-3" data-move-index="${index}">
          <div class="move-details">
            <div class="move-wine-name">${escapeHtml(move.wineName)}</div>
            <div class="move-path">
              <span class="from">${move.currentSlot}</span>
              <span class="arrow">→</span>
              <span class="to">${move.suggestedZone} (full)</span>
            </div>
            <div class="move-reason">${escapeHtml(move.reason)}</div>
          </div>
          <span class="move-confidence ${move.confidence}">${move.confidence}</span>
          <div class="move-actions">
            <button class="btn btn-secondary btn-small move-dismiss-btn" data-move-index="${index}" title="Dismiss this suggestion">Dismiss</button>
          </div>
        </div>
      `;
    }

    const partnerIndex = swapPartnerByIndex.get(index) ?? -1;
    const isSwap = partnerIndex !== -1 && swapPartnerByIndex.get(partnerIndex) === index;
    const isDependent = sources.has(move.to);
    const isLocked = hasSwaps && !isSwap && isDependent;
    const lockTitle = 'This target slot is occupied by a bottle that is also being moved — execute all moves together to avoid losing bottles';

    let primaryAction = '';
    if (isSwap) {
      primaryAction = `<button class="btn btn-primary btn-small move-swap-btn" data-move-index="${index}" title="Swap these two bottles safely">Swap</button>`;
    } else if (isLocked) {
      primaryAction = `<span class="move-locked" title="${escapeHtml(lockTitle)}">🔒</span>`;
    } else {
      primaryAction = `<button class="btn btn-primary btn-small move-execute-btn" data-move-index="${index}" title="Move this bottle now">Move</button>`;
    }

    // Show swap indicator and bidirectional arrow for swaps
    const arrow = isSwap ? '↔' : '→';
    const swapBadge = isSwap ? '<span class="swap-badge">SWAP</span>' : '';
    const swapPartner = isSwap ? moves[partnerIndex] : null;
    const swapInfo = isSwap && swapPartner?.wineName
      ? `<div class="swap-info">Swapping with: ${escapeHtml(swapPartner.wineName)} (${swapPartner.from})</div>`
      : '';

    return `
      <div class="move-item priority-${move.priority}${isSwap ? ' is-swap' : ''}" data-move-index="${index}">
        <div class="move-details">
          <div class="move-wine-name">${escapeHtml(move.wineName)}${swapBadge}</div>
          <div class="move-path">
            <span class="from">${move.from}</span>
            <span class="arrow${isSwap ? ' swap-arrow' : ''}">${arrow}</span>
            <span class="to">${move.to}</span>
          </div>
          ${swapInfo}
          <div class="move-reason">${escapeHtml(move.reason)}</div>
        </div>
        <span class="move-confidence ${move.confidence}">${move.confidence}</span>
        <div class="move-actions">
          ${primaryAction}
          <button class="btn btn-secondary btn-small move-dismiss-btn" data-move-index="${index}" title="Ignore this suggestion (does not move the bottle)">Ignore</button>
        </div>
      </div>
    `;
  }).join('');

  // Attach event listeners for move buttons (CSP-compliant)
  // Only enabled buttons exist in the DOM (locked items render no button)
  listEl.querySelectorAll('.move-execute-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const index = Number.parseInt(btn.dataset.moveIndex, 10);
      executeMove(index);
    });
  });
  listEl.querySelectorAll('.move-swap-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const index = Number.parseInt(btn.dataset.moveIndex, 10);
      executeSwap(index);
    });
  });
  listEl.querySelectorAll('.move-dismiss-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const index = Number.parseInt(btn.dataset.moveIndex, 10);
      dismissMove(index);
    });
  });

  // Make move item card bodies clickable (triggers primary action)
  listEl.querySelectorAll('.move-item[data-move-index]').forEach(item => {
    item.addEventListener('click', (e) => {
      // Don't trigger if they clicked a button inside
      if (e.target.closest('button')) return;
      const index = Number.parseInt(item.dataset.moveIndex, 10);
      const move = moves[index];
      if (!move) return;

      if (move.type === 'manual') {
        // For manual items, dismiss on tap
        dismissMove(index);
      } else if (move.type === 'move') {
        // For actionable moves, trigger the primary action
        const swapBtn = item.querySelector('.move-swap-btn');
        const moveBtn = item.querySelector('.move-execute-btn');
        if (swapBtn) {
          executeSwap(index);
        } else if (moveBtn) {
          executeMove(index);
        }
        // If locked, do nothing (user needs to use Execute All)
      }
    });
  });

  // Add "Visual Guide" button (idempotent — remove existing first)
  actionsEl.querySelector('.move-guide-btn')?.remove();
  if (actionableMoves.length > 0) {
    const guideBtn = document.createElement('button');
    guideBtn.className = 'btn btn-secondary btn-small move-guide-btn';
    guideBtn.textContent = 'Visual Guide';
    actionsEl.appendChild(guideBtn);
    guideBtn.addEventListener('click', () => openMoveGuide(moves));
  }

  actionsEl.style.display = actionableMoves.length > 0 ? 'flex' : 'none';
}

/**
 * Execute a swap (pair of moves) atomically.
 * @param {number} index - Move index
 */
async function executeSwap(index) {
  const currentAnalysis = getCurrentAnalysis();
  if (!currentAnalysis?.suggestedMoves?.[index]) return;

  const moveA = currentAnalysis.suggestedMoves[index];
  if (!moveA || moveA.type !== 'move') return;

  const partnerIndex = currentAnalysis.suggestedMoves.findIndex((m, idx) => {
    if (idx === index) return false;
    if (!m || m.type !== 'move') return false;
    return m.from === moveA.to && m.to === moveA.from;
  });

  if (partnerIndex === -1) {
    showToast('Swap partner not found. Try refreshing analysis.');
    return;
  }

  const moveB = currentAnalysis.suggestedMoves[partnerIndex];
  const movesToExecute = [moveA, moveB].map(m => ({
    wineId: m.wineId,
    wineName: m.wineName,
    from: m.from,
    to: m.to
  }));

  try {
    const result = await executeCellarMoves(movesToExecute);
    if (result && result.success === false) {
      showValidationErrorModal(result.validation);
      return;
    }

    showToast(`Swapped ${moveA.wineName} with ${moveB.wineName}`);

    // Remove both moves from list (remove higher index first)
    const indices = [index, partnerIndex].sort((a, b) => b - a);
    indices.forEach(i => currentAnalysis.suggestedMoves.splice(i, 1));

    // Re-check if remaining moves have swaps/dependencies
    const sources = new Set(currentAnalysis.suggestedMoves.filter(m => m.type === 'move').map(m => m.from));
    const targets = new Set(currentAnalysis.suggestedMoves.filter(m => m.type === 'move').map(m => m.to));
    currentAnalysis.movesHaveSwaps = [...sources].some(s => targets.has(s));
    renderMoves(currentAnalysis.suggestedMoves, currentAnalysis.needsZoneSetup, currentAnalysis.movesHaveSwaps);
    refreshLayout();
  } catch (err) {
    showToast(`Error: ${err.message}`);
  }
}

/**
 * Execute a single move.
 * @param {number} index - Move index
 */
async function executeMove(index) {
  const currentAnalysis = getCurrentAnalysis();
  if (!currentAnalysis?.suggestedMoves?.[index]) return;

  const move = currentAnalysis.suggestedMoves[index];
  if (move.type !== 'move') return;

  try {
    await executeCellarMoves([{
      wineId: move.wineId,
      from: move.from,
      to: move.to
    }]);
    showToast(`Moved ${move.wineName} to ${move.to}`);

    // Remove move from list and refresh
    currentAnalysis.suggestedMoves.splice(index, 1);
    // Re-check if remaining moves have swaps
    const sources = new Set(currentAnalysis.suggestedMoves.filter(m => m.type === 'move').map(m => m.from));
    const targets = new Set(currentAnalysis.suggestedMoves.filter(m => m.type === 'move').map(m => m.to));
    currentAnalysis.movesHaveSwaps = [...sources].some(s => targets.has(s));
    renderMoves(currentAnalysis.suggestedMoves, currentAnalysis.needsZoneSetup, currentAnalysis.movesHaveSwaps);
    refreshLayout();
  } catch (err) {
    showToast(`Error: ${err.message}`);
  }
}

/**
 * Dismiss a move suggestion.
 * @param {number} index - Move index
 */
function dismissMove(index) {
  const currentAnalysis = getCurrentAnalysis();
  if (!currentAnalysis?.suggestedMoves?.[index]) return;

  currentAnalysis.suggestedMoves.splice(index, 1);
  // Re-check if remaining moves have swaps
  const sources = new Set(currentAnalysis.suggestedMoves.filter(m => m.type === 'move').map(m => m.from));
  const targets = new Set(currentAnalysis.suggestedMoves.filter(m => m.type === 'move').map(m => m.to));
  currentAnalysis.movesHaveSwaps = [...sources].some(s => targets.has(s));
  renderMoves(currentAnalysis.suggestedMoves, currentAnalysis.needsZoneSetup, currentAnalysis.movesHaveSwaps);
}

/**
 * Execute all suggested moves.
 */
export async function handleExecuteAllMoves() {
  const currentAnalysis = getCurrentAnalysis();
  if (!currentAnalysis?.suggestedMoves) return;

  const movesToExecute = currentAnalysis.suggestedMoves
    .filter(m => m.type === 'move')
    .map(m => ({
      wineId: m.wineId,
      wineName: m.wineName, // Include wine name for validation messages
      from: m.from,
      to: m.to
    }));

  if (movesToExecute.length === 0) {
    showToast('No moves to execute');
    return;
  }

  // Show preview modal with move details
  const confirmed = await showMovePreviewModal(movesToExecute);
  if (!confirmed) {
    return;
  }

  try {
    const result = await executeCellarMoves(movesToExecute);
    
    // Check if validation failed
    if (!result.success) {
      showValidationErrorModal(result.validation);
      return;
    }
    
    showToast(`Successfully executed ${result.moved} moves`);

    // Re-analyse to show updated state
    await loadAnalysis();
    refreshLayout();
  } catch (err) {
    showToast(`Error: ${err.message}`);
  }
}

/**
 * Show move preview modal before execution.
 * @param {Array} moves - Array of move objects
 * @returns {Promise<boolean>} True if user confirms
 */
export function showMovePreviewModal(moves) {
  return new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal move-preview-modal">
        <div class="modal-header">
          <h3>Confirm Bottle Moves</h3>
          <button class="close-btn">&times;</button>
        </div>
        <div class="modal-body">
          <p class="preview-summary">About to move <strong>${moves.length}</strong> bottle(s):</p>
          <div class="move-preview-list">
            ${moves.map(m => `
              <div class="move-preview-item">
                <div class="move-wine">${escapeHtml(m.wineName || `Wine ${m.wineId}`)}</div>
                <div class="move-path">${escapeHtml(m.from)} → ${escapeHtml(m.to)}</div>
              </div>
            `).join('')}
          </div>
          <p class="preview-warning">
            <strong>⚠️ Important:</strong> All moves will be executed atomically. 
            If validation fails, no bottles will be moved.
          </p>
        </div>
        <div class="modal-footer">
          <button class="btn-secondary cancel-btn">Cancel</button>
          <button class="btn-primary confirm-btn">Execute Moves</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
    
    const confirmBtn = modal.querySelector('.confirm-btn');
    const cancelBtn = modal.querySelector('.cancel-btn');
    const closeBtn = modal.querySelector('.close-btn');
    
    const handleConfirm = () => {
      modal.remove();
      resolve(true);
    };
    
    const handleCancel = () => {
      modal.remove();
      resolve(false);
    };
    
    confirmBtn.addEventListener('click', handleConfirm);
    cancelBtn.addEventListener('click', handleCancel);
    closeBtn.addEventListener('click', handleCancel);
    
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.remove();
        resolve(false);
      }
    });
  });
}

/**
 * Show validation error modal with detailed error information.
 * @param {Object} validation - Validation result from API
 */
export function showValidationErrorModal(validation) {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  
  const errorsByType = {};
  validation.errors.forEach(err => {
    if (!errorsByType[err.type]) {
      errorsByType[err.type] = [];
    }
    errorsByType[err.type].push(err);
  });
  
  let errorsHtml = '';
  
  if (errorsByType.duplicate_target) {
    errorsHtml += `
      <div class="validation-error-section">
        <h4>🚫 Duplicate Target Slots (${errorsByType.duplicate_target.length})</h4>
        <ul>
          ${errorsByType.duplicate_target.map(e => `
            <li>${escapeHtml(e.message)}</li>
          `).join('')}
        </ul>
        <p class="error-explanation">Multiple bottles would be moved to the same slot, causing data loss.</p>
      </div>
    `;
  }
  
  if (errorsByType.target_occupied) {
    errorsHtml += `
      <div class="validation-error-section">
        <h4>⚠️ Occupied Target Slots (${errorsByType.target_occupied.length})</h4>
        <ul>
          ${errorsByType.target_occupied.map(e => `
            <li>${escapeHtml(e.message)}</li>
          `).join('')}
        </ul>
        <p class="error-explanation">Target slots already contain bottles that aren't being moved.</p>
      </div>
    `;
  }
  
  if (errorsByType.source_mismatch) {
    errorsHtml += `
      <div class="validation-error-section">
        <h4>❌ Source Slot Mismatches (${errorsByType.source_mismatch.length})</h4>
        <ul>
          ${errorsByType.source_mismatch.map(e => `
            <li>${escapeHtml(e.message)}</li>
          `).join('')}
        </ul>
        <p class="error-explanation">Expected wines not found at source locations (bottles may have been moved already).</p>
      </div>
    `;
  }
  
  if (errorsByType.duplicate_wine) {
    errorsHtml += `
      <div class="validation-error-section">
        <h4>🔁 Duplicate Wine Moves (${errorsByType.duplicate_wine.length})</h4>
        <ul>
          ${errorsByType.duplicate_wine.map(e => `
            <li>${escapeHtml(e.message)}</li>
          `).join('')}
        </ul>
        <p class="error-explanation">Same wine appears in multiple moves.</p>
      </div>
    `;
  }
  
  modal.innerHTML = `
    <div class="modal validation-error-modal">
      <div class="modal-header error">
        <h3>❌ Move Validation Failed</h3>
        <button class="close-btn">&times;</button>
      </div>
      <div class="modal-body">
        <p class="validation-summary">
          <strong>${validation.summary.errorCount}</strong> validation error(s) prevented execution.
          No bottles were moved.
        </p>
        ${errorsHtml}
        <div class="validation-advice">
          <strong>What to do:</strong>
          <p>Refresh the analysis to get an updated view of the cellar. 
          The suggested moves may be stale if bottles were recently moved.</p>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-primary close-btn-footer">Close</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  const closeBtn = modal.querySelector('.close-btn');
  const closeFooterBtn = modal.querySelector('.close-btn-footer');
  
  const handleClose = () => modal.remove();
  
  closeBtn.addEventListener('click', handleClose);
  closeFooterBtn.addEventListener('click', handleClose);
  
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  });
}
