/**
 * @fileoverview Move suggestions and execution.
 * @module cellarAnalysis/moves
 */

import { executeCellarMoves } from '../api.js';
import { showToast, escapeHtml } from '../utils.js';
import { refreshLayout } from '../app.js';
import { getCurrentAnalysis, getAIMoveJudgments } from './state.js';
import { openMoveGuide, detectSwapPairs } from './moveGuide.js';

const AI_BADGE_CONFIG = {
  confirmed: { label: 'AI Confirmed', cssClass: 'ai-badge--confirmed' },
  modified:  { label: 'AI Modified',  cssClass: 'ai-badge--modified' },
  rejected:  { label: 'AI: Keep',     cssClass: 'ai-badge--rejected' },
};

/**
 * Render an inline AI judgment badge for a move card.
 * @param {Map|null} aiJudgments - Map of wineId -> judgment
 * @param {number} wineId
 * @returns {string} HTML string (empty if no judgment)
 */
function renderAIBadge(aiJudgments, wineId) {
  if (!aiJudgments) return '';
  const j = aiJudgments.get(wineId);
  if (!j) return '';
  const cfg = AI_BADGE_CONFIG[j.judgment];
  if (!cfg) return '';
  return ` <span class="ai-badge ${cfg.cssClass}" title="${escapeHtml(j.reason || '')}">${cfg.label}</span>`;
}

/**
 * Recalculate swap flags on current analysis and re-render moves.
 * Centralised to avoid duplicating the swap-recheck pattern.
 */
function recheckSwapsAndRerender() {
  const currentAnalysis = getCurrentAnalysis();
  if (!currentAnalysis?.suggestedMoves) return;
  const sources = new Set(currentAnalysis.suggestedMoves.filter(m => m.type === 'move').map(m => m.from));
  const targets = new Set(currentAnalysis.suggestedMoves.filter(m => m.type === 'move').map(m => m.to));
  currentAnalysis.movesHaveSwaps = [...sources].some(s => targets.has(s));
  renderMoves(currentAnalysis.suggestedMoves, currentAnalysis.needsZoneSetup, currentAnalysis.movesHaveSwaps);
}

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

  // AI judgment badges (when AI advice has been loaded)
  const aiJudgments = getAIMoveJudgments();

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
    if (swapPairs > 0) {
      swapWarning += `<div class="swap-warning swap-info-notice">
        <strong>Note:</strong> ${swapPairs} swap${swapPlural} detected — paired bottles shown together for easy swapping.
        Use the <strong>Swap</strong> buttons to execute each pair safely, or use <strong>Execute All</strong>.
      </div>`;
    }
    if (dependentNonSwapCount > 0) {
      swapWarning += `<div class="swap-warning">
        <strong>Note:</strong> Some moves depend on other moves (${dependentNonSwapCount} move${dependentPlural} target occupied slots that are being vacated).
        Execute all moves together to avoid losing bottles.
      </div>`;
    }
  }

  // Track swap partners already rendered as grouped cards
  const renderedAsSwapGroup = new Set();

  listEl.innerHTML = swapWarning + moves.map((move, index) => {
    // Skip moves already rendered as part of a swap group
    if (renderedAsSwapGroup.has(index)) return '';

    if (move.type === 'manual') {
      const zoneFullMsg = move.zoneFullReason
        ? escapeHtml(move.zoneFullReason)
        : `The ${escapeHtml(move.suggestedZone)} zone is full. Use Find Slot to search overflow areas, or run AI Zone Structuring to rebalance.`;
      return `
        <div class="move-item move-item-manual priority-3" data-move-index="${index}">
          <div class="move-details">
            <div class="move-wine-name">${escapeHtml(move.wineName)}</div>
            <div class="move-path">
              <span class="from">${move.currentSlot}</span>
              <span class="arrow">→</span>
              <span class="to">${escapeHtml(move.suggestedZone)}</span>
            </div>
            <div class="move-reason">${escapeHtml(move.reason)}</div>
            <div class="move-zone-full-hint">${zoneFullMsg}</div>
          </div>
          <span class="move-confidence ${move.confidence}">${move.confidence}</span>
          <div class="move-actions">
            <button class="btn btn-primary btn-small move-findslot-btn" data-move-index="${index}" title="Re-analyse with overflow to find a slot">Find Slot</button>
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

    // ── Grouped swap card ─────────────────────────────────
    if (isSwap) {
      const partner = moves[partnerIndex];
      renderedAsSwapGroup.add(partnerIndex); // Skip partner in later iteration

      let bestConf = 'low';
      if (move.confidence === 'high' || partner.confidence === 'high') bestConf = 'high';
      else if (move.confidence === 'medium' || partner.confidence === 'medium') bestConf = 'medium';

      // AI badges for swap wines
      const aiBadgeA = renderAIBadge(aiJudgments, move.wineId);
      const aiBadgeB = renderAIBadge(aiJudgments, partner.wineId);

      return `
        <div class="move-item is-swap-group priority-${move.priority}" data-move-index="${index}" data-swap-partner="${partnerIndex}">
          <div class="move-details">
            <span class="swap-badge">SWAP</span>
            <div class="swap-pair-wines">
              <div class="swap-wine-info">
                <div class="move-wine-name">${escapeHtml(move.wineName)}${aiBadgeA}</div>
                <div class="move-slot"><span class="from">${move.from}</span>  →  ${move.toZone}</div>
              </div>
              <span class="swap-arrow">↔</span>
              <div class="swap-wine-info">
                <div class="move-wine-name">${escapeHtml(partner.wineName)}${aiBadgeB}</div>
                <div class="move-slot"><span class="from">${partner.from}</span>  →  ${partner.toZone}</div>
              </div>
            </div>
            <div class="move-reason">${escapeHtml(move.reason)}</div>
          </div>
          <span class="move-confidence ${bestConf}">${bestConf}</span>
          <div class="move-actions">
            <button class="btn btn-primary btn-small move-swap-btn" data-move-index="${index}" title="Swap these two bottles safely">Swap</button>
            <button class="btn btn-secondary btn-small move-dismiss-swap-btn" data-move-index="${index}" title="Dismiss both moves">Ignore</button>
          </div>
        </div>
      `;
    }

    // ── Individual move card ──────────────────────────────
    let primaryAction = '';
    if (isLocked) {
      primaryAction = `<span class="move-locked" title="${escapeHtml(lockTitle)}">🔒</span>`;
    } else {
      primaryAction = `<button class="btn btn-primary btn-small move-execute-btn" data-move-index="${index}" title="Move this bottle now">Move</button>`;
    }

    // AI judgment badge
    const aiBadge = renderAIBadge(aiJudgments, move.wineId);

    return `
      <div class="move-item priority-${move.priority}" data-move-index="${index}">
        <div class="move-details">
          <div class="move-wine-name">${escapeHtml(move.wineName)}${aiBadge}</div>
          <div class="move-path">
            <span class="from">${move.from}</span>
            <span class="arrow">→</span>
            <span class="to">${move.to}</span>
            ${move.toZone ? `<span class="move-zone-label">(${escapeHtml(move.toZone)})</span>` : ''}
          </div>
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
  listEl.querySelectorAll('.move-dismiss-swap-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const index = Number.parseInt(btn.dataset.moveIndex, 10);
      dismissSwapGroup(index);
    });
  });

  // "Find Slot" button on manual (zone-full) moves → re-analyse with overflow
  listEl.querySelectorAll('.move-findslot-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      btn.disabled = true;
      btn.textContent = 'Searching...';
      try {
        const { loadAnalysis } = await import('./analysis.js');
        await loadAnalysis(true, { allowFallback: true });
        showToast('Re-analysed with overflow slots enabled');
      } catch (err) {
        showToast(`Error: ${err.message}`);
        btn.disabled = false;
        btn.textContent = 'Find Slot';
      }
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
        // For manual items, trigger Find Slot (re-analyse with fallback)
        const findSlotBtn = item.querySelector('.move-findslot-btn');
        if (findSlotBtn) findSlotBtn.click();
        else dismissMove(index);
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
    recheckSwapsAndRerender();
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
    recheckSwapsAndRerender();
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
  recheckSwapsAndRerender();
}

/**
 * Dismiss both moves in a swap group.
 * @param {number} index - Move index of one swap partner
 */
function dismissSwapGroup(index) {
  const currentAnalysis = getCurrentAnalysis();
  if (!currentAnalysis?.suggestedMoves?.[index]) return;

  const moveA = currentAnalysis.suggestedMoves[index];
  const partnerIndex = currentAnalysis.suggestedMoves.findIndex((m, idx) => {
    if (idx === index) return false;
    return m?.type === 'move' && m.from === moveA.to && m.to === moveA.from;
  });

  // Remove both — splice higher index first to avoid shifting
  const indices = [index];
  if (partnerIndex !== -1) indices.push(partnerIndex);
  indices.sort((a, b) => b - a);
  indices.forEach(i => currentAnalysis.suggestedMoves.splice(i, 1));

  recheckSwapsAndRerender();
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

    // Re-analyse to show updated state (dynamic import breaks analysis↔moves cycle)
    const { loadAnalysis } = await import('./analysis.js');
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

/**
 * Render the dynamic row allocation info bar.
 * @param {Object} layoutSettings - Layout settings from analysis report
 */
export function renderRowAllocationInfo(layoutSettings) {
  const el = document.getElementById('row-allocation-info');
  if (!el) return;

  if (!layoutSettings || typeof layoutSettings.whiteRows !== 'number') {
    el.style.display = 'none';
    return;
  }

  const { whiteRows, redRows, whiteCount, redCount, colourOrder } = layoutSettings;
  const topLabel = colourOrder === 'reds-top' ? 'Red' : 'White-family';
  const bottomLabel = colourOrder === 'reds-top' ? 'White-family' : 'Red';
  const topRows = colourOrder === 'reds-top' ? redRows : whiteRows;
  const bottomRows = colourOrder === 'reds-top' ? whiteRows : redRows;
  const topCount = colourOrder === 'reds-top' ? redCount : whiteCount;
  const bottomCount = colourOrder === 'reds-top' ? whiteCount : redCount;

  el.style.display = 'block';
  el.innerHTML = `
    <div class="row-alloc-bar">
      <span class="row-alloc-label">${topLabel}: ${topRows} rows (${topCount} bottles)</span>
      <span class="row-alloc-sep">|</span>
      <span class="row-alloc-label">${bottomLabel}: ${bottomRows} rows (${bottomCount} bottles)</span>
    </div>
  `;
}

/**
 * Render compaction moves (row gap fills).
 * @param {Array} compactionMoves - Array of compaction move objects
 */
export function renderCompactionMoves(compactionMoves) {
  const container = document.getElementById('analysis-compaction');
  const listEl = document.getElementById('compaction-list');
  if (!container || !listEl) return;

  if (!compactionMoves || compactionMoves.length === 0) {
    container.style.display = 'none';
    return;
  }

  container.style.display = 'block';

  listEl.innerHTML = compactionMoves.map((move, index) => `
    <div class="move-item compaction-item priority-4" data-compaction-index="${index}">
      <div class="move-details">
        <div class="move-wine-name">${escapeHtml(move.wineName || 'Unknown')}</div>
        <div class="move-path">
          <span class="from">${move.from}</span>
          <span class="arrow">→</span>
          <span class="to">${move.to}</span>
        </div>
        <div class="move-reason">${escapeHtml(move.reason || 'Fill gap')}</div>
      </div>
      <div class="move-actions">
        <button class="btn btn-primary btn-small compaction-execute-btn" data-compaction-index="${index}" title="Move this bottle to fill the gap">Move</button>
        <button class="btn btn-secondary btn-small compaction-dismiss-btn" data-compaction-index="${index}" title="Ignore">Ignore</button>
      </div>
    </div>
  `).join('');

  // Wire up execute buttons
  listEl.querySelectorAll('.compaction-execute-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const idx = Number.parseInt(btn.dataset.compactionIndex, 10);
      const move = compactionMoves[idx];
      if (!move) return;
      try {
        btn.disabled = true;
        btn.textContent = 'Moving...';
        await executeCellarMoves([{ wineId: move.wineId, from: move.from, to: move.to }]);
        showToast(`Moved to ${move.to}`);
        await refreshLayout();
        const { loadAnalysis } = await import('./analysis.js');
        await loadAnalysis(true);
      } catch (err) {
        showToast(`Error: ${err.message}`);
        btn.disabled = false;
        btn.textContent = 'Move';
      }
    });
  });

  // Wire up dismiss buttons
  listEl.querySelectorAll('.compaction-dismiss-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const item = btn.closest('.compaction-item');
      if (item) item.remove();
      // Hide section if all dismissed
      if (listEl.querySelectorAll('.compaction-item').length === 0) {
        container.style.display = 'none';
      }
    });
  });
}
