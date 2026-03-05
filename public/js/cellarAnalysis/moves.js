/**
 * @fileoverview Move suggestions and execution.
 * @module cellarAnalysis/moves
 */

import { executeCellarMoves } from '../api.js';
import { showToast, escapeHtml } from '../utils.js';
import { refreshLayout } from '../app.js';
import { getCurrentAnalysis, getAIMoveJudgments } from './state.js';
import { openMoveGuide, detectSwapPairs } from './moveGuide.js';

/**
 * Detect circular move chains (A→B→C→A) among moves that aren't simple swaps.
 * @param {Array} moves - Actionable moves (type === 'move')
 * @param {Set} swapIndices - Indices already identified as pairwise swaps
 * @returns {Array<Array<Object>>} Array of cycle arrays, each cycle is an ordered list of moves
 */
function detectCycles(moves, swapIndices) {
  // Build adjacency: from → move (only non-swap moves)
  const adj = new Map();
  for (let i = 0; i < moves.length; i++) {
    if (swapIndices.has(i)) continue;
    const m = moves[i];
    if (m.from && m.to) adj.set(m.from, { move: m, to: m.to, index: i });
  }

  const visited = new Set();
  const cycles = [];

  for (const [startSlot] of adj) {
    if (visited.has(startSlot)) continue;
    const chain = [];
    let current = startSlot;
    const path = new Set();

    while (current && adj.has(current) && !path.has(current) && !visited.has(current)) {
      path.add(current);
      const edge = adj.get(current);
      chain.push(edge.move);
      current = edge.to;
    }

    // If we looped back to the start, it's a cycle
    if (current === startSlot && chain.length >= 3) {
      cycles.push(chain);
    }
    // Mark all nodes in this path as visited
    for (const slot of path) visited.add(slot);
  }

  return cycles;
}

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

  // Phase 3.2: zone-grouped headers when moves have toZone set (sortPlan source)
  const useZoneGroups = moves.some(m => m.toZone);

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

  // Detect cycles (A→B→C→A) — chains of 3+ moves that aren't simple swaps
  const cycles = detectCycles(actionableMoves, swapIndices);

  // Check for empty buffer slot availability (needed for cycle resolution)
  const emptySlots = actionableMoves.filter(m => !sources.has(m.to) && !swapIndices.has(actionableMoves.indexOf(m)));
  const hasBufferSlot = emptySlots.length > 0 || actionableMoves.some(m => m.to && !sources.has(m.to));

  // If moves depend on each other, show warning and lock only the dependent ones
  let swapWarning = '';
  if (hasSwaps) {
    if (swapPairs > 0) {
      swapWarning += `<div class="swap-warning swap-info-notice">
        <strong>Note:</strong> ${swapPairs} swap${swapPlural} detected — paired bottles shown together for easy swapping.
        Use the <strong>Swap</strong> buttons to execute each pair safely, or use <strong>Execute All</strong>.
      </div>`;
    }
    if (cycles.length > 0) {
      const cycleWarning = hasBufferSlot
        ? `${cycles.length} circular move chain${cycles.length > 1 ? 's' : ''} detected — these require a temporary empty slot. Use <strong>Execute All</strong> to resolve safely.`
        : `${cycles.length} circular move chain${cycles.length > 1 ? 's' : ''} detected — please empty one slot first to use as a temporary buffer.`;
      swapWarning += `<div class="swap-warning${hasBufferSlot ? ' swap-info-notice' : ''}">${cycleWarning}</div>`;
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

  // Zone section header tracking (for zone-grouped rendering)
  let lastRenderedZone = null;

  listEl.innerHTML = swapWarning + moves.map((move, index) => {
    // Skip moves already rendered as part of a swap group
    if (renderedAsSwapGroup.has(index)) return '';

    // Zone section header — emitted once per destination zone transition
    let zoneHeader = '';
    if (useZoneGroups && move.toZone && move.toZone !== lastRenderedZone) {
      lastRenderedZone = move.toZone;
      // Count visible move items in this zone (approximate — some may later be grouped)
      const zoneCount = moves.filter(m => m.toZone === move.toZone).length;
      zoneHeader = `<div class="move-zone-header"><span class="move-zone-arrow">→</span> ${escapeHtml(move.toZone)} <span class="move-zone-count">(${zoneCount})</span></div>`;
    }

    if (move.type === 'manual') {
      const zoneFullMsg = move.zoneFullReason
        ? escapeHtml(move.zoneFullReason)
        : `The ${escapeHtml(move.suggestedZone)} zone is full. Use Find Slot to search overflow areas, or run AI Zone Structuring to rebalance.`;
      return zoneHeader + `
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
            <button class="btn btn-primary btn-small move-findslot-btn" data-move-index="${index}" data-wine-id="${move.wineId}" title="Re-analyse with overflow to find a slot">Find Slot</button>
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

      return zoneHeader + `
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

    return zoneHeader + `
      <div class="move-item priority-${move.priority}" data-move-index="${index}">
        <div class="move-details">
          <div class="move-wine-name">${escapeHtml(move.wineName)}${aiBadge}</div>
          <div class="move-path">
            <span class="from">${move.from}</span>
            <span class="arrow">→</span>
            <span class="to">${move.to}</span>
            ${move.toZone && !useZoneGroups ? `<span class="move-zone-label">(${escapeHtml(move.toZone)})</span>` : ''}
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
      const wineId = Number(btn.dataset.wineId);
      btn.disabled = true;
      btn.textContent = 'Searching...';
      try {
        const { loadAnalysis } = await import('./analysis.js');
        const { getCurrentAnalysis } = await import('./state.js');

        // Count manual items before re-analysis
        const before = getCurrentAnalysis();
        const manualBefore = (before?.suggestedMoves || []).filter(m => m.type === 'manual').length;

        await loadAnalysis(true, { allowFallback: true });

        // Compare: did the clicked wine get a concrete move?
        const after = getCurrentAnalysis();
        const manualAfter = (after?.suggestedMoves || []).filter(m => m.type === 'manual').length;
        const wineNowHasMove = wineId && (after?.suggestedMoves || []).some(
          m => m.type === 'move' && m.wineId === wineId
        );

        if (wineNowHasMove) {
          showToast('Slot found — review the move suggestion above');
        } else if (manualAfter < manualBefore) {
          showToast('Overflow search found slots for some wines');
        } else {
          showToast('No available slots found — consider zone reconfiguration');
        }
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
    to: m.to,
    ...(m.toZoneId ? { zoneId: m.toZoneId, confidence: m.confidence } : {})
  }));

  try {
    const result = await executeCellarMoves(movesToExecute);
    if (result && result.success === false) {
      showValidationErrorModal(result.validation);
      return;
    }

    showToast(`Swapped: ${moveA.wineName} (${moveA.from} → ${moveA.to}) ↔ ${moveB.wineName} (${moveB.from} → ${moveB.to})`);

    // Remove both moves from list (remove higher index first)
    const indices = [index, partnerIndex].sort((a, b) => b - a);
    indices.forEach(i => currentAnalysis.suggestedMoves.splice(i, 1));

    // Re-check if remaining moves have swaps/dependencies
    recheckSwapsAndRerender();
    refreshLayout();
  } catch (err) {
    // Show validation modal for structured errors (400 validation failures)
    if (err.validation) {
      showValidationErrorModal(err.validation);
    } else {
      showToast(`Error: ${err.message}`);
    }
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
    const result = await executeCellarMoves([{
      wineId: move.wineId,
      from: move.from,
      to: move.to,
      ...(move.toZoneId ? { zoneId: move.toZoneId, confidence: move.confidence } : {})
    }]);

    if (result && result.success === false) {
      if (result.validation) {
        showValidationErrorModal(result.validation);
      } else {
        showToast('Move execution failed');
      }
      return;
    }

    showToast(`Moved ${move.wineName} to ${move.to}`);

    // Remove move from list and refresh
    currentAnalysis.suggestedMoves.splice(index, 1);
    recheckSwapsAndRerender();
    refreshLayout();
  } catch (err) {
    if (err.validation) {
      showValidationErrorModal(err.validation);
    } else {
      showToast(`Error: ${err.message}`);
    }
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
      to: m.to,
      ...(m.toZoneId ? { zoneId: m.toZoneId, confidence: m.confidence } : {})
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
    
    // Check if validation failed (reachable if server returns 200 with success: false)
    if (!result.success) {
      if (result.validation) {
        showValidationErrorModal(result.validation);
      } else {
        showToast('Move execution failed');
      }
      return;
    }
    
    showToast(`Successfully executed ${result.moved} moves`);

    // Re-analyse to show updated state (dynamic import breaks analysis↔moves cycle)
    const { loadAnalysis } = await import('./analysis.js');
    await loadAnalysis();
    refreshLayout();
  } catch (err) {
    // Show validation modal for structured errors (400 validation failures)
    if (err.validation) {
      showValidationErrorModal(err.validation);
    } else {
      showToast(`Error: ${err.message}`);
    }
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
  
  if (errorsByType.slot_not_found) {
    errorsHtml += `
      <div class="validation-error-section">
        <h4>📍 Missing Slots (${errorsByType.slot_not_found.length})</h4>
        <ul>
          ${errorsByType.slot_not_found.map(e => `
            <li>${escapeHtml(e.message)}</li>
          `).join('')}
        </ul>
        <p class="error-explanation">Slot locations referenced in moves no longer exist. The cellar layout may have changed since this analysis was generated.</p>
      </div>
    `;
  }
  
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

  if (errorsByType.duplicate_move_instance) {
    errorsHtml += `
      <div class="validation-error-section">
        <h4>🔁 Duplicate Move Instances (${errorsByType.duplicate_move_instance.length})</h4>
        <ul>
          ${errorsByType.duplicate_move_instance.map(e => `
            <li>${escapeHtml(e.message)}</li>
          `).join('')}
        </ul>
        <p class="error-explanation">The same bottle (same slot) appears in multiple moves.</p>
      </div>
    `;
  }

  if (errorsByType.noop_move) {
    errorsHtml += `
      <div class="validation-error-section">
        <h4>⏸️ No-op Moves (${errorsByType.noop_move.length})</h4>
        <ul>
          ${errorsByType.noop_move.map(e => `
            <li>${escapeHtml(e.message)}</li>
          `).join('')}
        </ul>
        <p class="error-explanation">Move source and target are the same slot — nothing would change.</p>
      </div>
    `;
  }
  
  if (errorsByType.zone_colour_violation) {
    errorsHtml += `
      <div class="validation-error-section">
        <h4>🎨 Zone Colour Violations (${errorsByType.zone_colour_violation.length})</h4>
        <ul>
          ${errorsByType.zone_colour_violation.map(e => `
            <li>${escapeHtml(e.message)}</li>
          `).join('')}
        </ul>
        <p class="error-explanation">Wine colour doesn't match the target zone's colour policy.</p>
      </div>
    `;
  }

  // Catch-all for any unrecognised error types
  const knownTypes = new Set([
    'slot_not_found', 'duplicate_target', 'target_occupied',
    'source_mismatch', 'duplicate_wine', 'duplicate_move_instance',
    'noop_move', 'zone_colour_violation'
  ]);
  const unknownErrors = validation.errors.filter(e => !knownTypes.has(e.type));
  if (unknownErrors.length > 0) {
    errorsHtml += `
      <div class="validation-error-section">
        <h4>⚠️ Other Errors (${unknownErrors.length})</h4>
        <ul>
          ${unknownErrors.map(e => `
            <li>${escapeHtml(e.message || e.type)}</li>
          `).join('')}
        </ul>
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
 * Create a reusable diagnostic section renderer from a configuration object.
 * Handles container show/hide, HTML rendering, execute UX, and dismiss behaviour.
 *
 * Config shape:
 *   containerId      {string}   Element ID of the section wrapper
 *   listId           {string}   Element ID of the list container
 *   itemClass        {string}   CSS class prefix, e.g. 'compaction' → 'compaction-execute-btn'
 *   indexAttr        {string}   dataset key for item index (camelCase), e.g. 'compactionIndex'
 *   preprocessItems  {Function} Optional: (rawItems) => { items, context } — filter/prepare items
 *   renderItemHtml   {Function} (item, index, context) => HTML string
 *   getExecuteMoves  {Function} (item, rawItems, context) => [{wineId, from, to}]
 *   getToastMsg      {Function} (item, context) => string
 *   getButtonLabel   {Function} Optional: (item, context) => string for restore-on-error label
 *
 * @param {Object} config
 * @returns {Function} renderSection(rawItems)
 */
function makeDiagnosticRenderer({
  containerId, listId, itemClass, indexAttr,
  preprocessItems, renderItemHtml, getExecuteMoves, getToastMsg, getButtonLabel,
}) {
  return function renderSection(rawItems) {
    const container = document.getElementById(containerId);
    const listEl = document.getElementById(listId);
    if (!container || !listEl) return;

    const { items = rawItems ?? [], context = {} } = preprocessItems
      ? preprocessItems(rawItems ?? [])
      : { items: rawItems ?? [] };

    if (items.length === 0) { container.style.display = 'none'; return; }
    container.style.display = 'block';

    listEl.innerHTML = items.map((item, i) => renderItemHtml(item, i, context)).join('');

    listEl.querySelectorAll(`.${itemClass}-execute-btn`).forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const idx = Number.parseInt(btn.dataset[indexAttr], 10);
        const item = items[idx];
        if (!item) return;
        const movesToExecute = getExecuteMoves(item, rawItems, context);
        const toastMsg = getToastMsg(item, context);
        const buttonLabel = getButtonLabel ? getButtonLabel(item, context) : 'Move';
        try {
          btn.disabled = true;
          btn.textContent = 'Working...';
          await executeCellarMoves(movesToExecute);
          showToast(toastMsg);
          await refreshLayout();
          const { loadAnalysis } = await import('./analysis.js');
          await loadAnalysis(true);
        } catch (err) {
          if (err.validation) showValidationErrorModal(err.validation);
          else showToast(`Error: ${err.message}`);
          btn.disabled = false;
          btn.textContent = buttonLabel;
        }
      });
    });

    listEl.querySelectorAll(`.${itemClass}-dismiss-btn`).forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const item = btn.closest(`.${itemClass}-item`);
        if (item) item.remove();
        if (listEl.querySelectorAll(`.${itemClass}-item`).length === 0) {
          container.style.display = 'none';
        }
      });
    });
  };
}

/**
 * Render compaction moves (row gap fills).
 * @param {Array} compactionMoves - Array of compaction move objects
 */
export const renderCompactionMoves = makeDiagnosticRenderer({
  containerId: 'analysis-compaction',
  listId: 'compaction-list',
  itemClass: 'compaction',
  indexAttr: 'compactionIndex',
  renderItemHtml: (move, index) => `
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
    </div>`,
  getExecuteMoves: (move) => [{ wineId: move.wineId, from: move.from, to: move.to }],
  getToastMsg: (move) => `Moved to ${move.to}`,
});

/**
 * Render grouping moves (same-wine intra-row bottle grouping swaps).
 * @param {Array} groupingMoves - Array of grouping move objects from the analysis
 */
export const renderGroupingMoves = makeDiagnosticRenderer({
  containerId: 'analysis-grouping',
  listId: 'grouping-list',
  itemClass: 'grouping',
  indexAttr: 'groupingIndex',
  preprocessItems: (rawItems) => {
    // isDisplacement marks the "make room" half of a grouping swap — hide it from the
    // primary list but expose its source slot so the UI can show ↔ for swap pairs.
    const items = rawItems.filter(m => !m.isDisplacement);
    const swapTargets = new Set(
      rawItems.filter(m => m.isDisplacement).map(m => m.from)
    );
    return { items, context: { swapTargets, rawItems } };
  },
  renderItemHtml: (move, index, { swapTargets }) => {
    const isSwap = swapTargets.has(move.to);
    const actionLabel = isSwap ? 'Swap' : 'Move';
    const actionTitle = isSwap
      ? `Swap ${move.from} ↔ ${move.to} to group ${escapeHtml(move.wineName)} bottles`
      : `Move ${move.from} → ${move.to} to group ${escapeHtml(move.wineName)} bottles`;
    return `
    <div class="move-item grouping-item priority-5" data-grouping-index="${index}">
      <div class="move-details">
        <div class="move-wine-name">${escapeHtml(move.wineName || 'Unknown')}</div>
        <div class="move-path">
          <span class="from">${move.from}</span>
          <span class="arrow">${isSwap ? '↔' : '→'}</span>
          <span class="to">${move.to}</span>
        </div>
        <div class="move-reason">${escapeHtml(move.reason || 'Group bottles')}</div>
      </div>
      <div class="move-actions">
        <button class="btn btn-primary btn-small grouping-execute-btn"
                data-grouping-index="${index}"
                title="${actionTitle}">${actionLabel}</button>
        <button class="btn btn-secondary btn-small grouping-dismiss-btn"
                data-grouping-index="${index}"
                title="Ignore this suggestion">Ignore</button>
      </div>
    </div>`;
  },
  getExecuteMoves: (move, rawItems) => {
    const movesToExecute = [{ wineId: move.wineId, from: move.from, to: move.to }];
    const partner = rawItems.find(
      m => m.isDisplacement && m.from === move.to && m.to === move.from
    );
    if (partner) movesToExecute.push({ wineId: partner.wineId, from: partner.from, to: partner.to });
    return movesToExecute;
  },
  getToastMsg: (move, { swapTargets }) =>
    swapTargets.has(move.to) ? `Swapped ${move.from} ↔ ${move.to}` : `Moved to ${move.to}`,
  getButtonLabel: (move, { swapTargets }) => swapTargets.has(move.to) ? 'Swap' : 'Move',
});

// ── Phase 1.7: Structured grouping step UI ────────────────────────────────

/**
 * Local progress state for grouping steps.
 * Keys: `${rowId}:${stepNumber}` — cleared on each fresh renderGroupingSteps call.
 * @type {Set<string>}
 */
const _groupingStepsDone = new Set();

/**
 * Render a single grouping step's move details as HTML.
 * @param {string} rowId - Row identifier, e.g. 'R3'
 * @param {Object} step - Step object from planRowGrouping
 * @returns {string} HTML string
 */
function renderStepMovesHtml(rowId, step) {
  const { stepType, moves } = step;

  if (stepType === 'move') {
    const m = moves[0];
    return `
      <span class="move-step-type-badge move-step-type--move">Move</span>
      <div class="move-step-detail">
        <span class="move-wine-name">${escapeHtml(m.wineName)}</span>
        <span class="move-step-slots"><span class="from">${rowId}C${m.from}</span> <span class="arrow">→</span> <span class="to">${rowId}C${m.to}</span></span>
      </div>`;
  }

  if (stepType === 'swap') {
    const primary = moves.find(m => !m.isDisplacement) ?? moves[0];
    const displaced = moves.find(m => m.isDisplacement) ?? moves[1];
    return `
      <span class="move-step-type-badge move-step-type--swap">Swap</span>
      <div class="move-step-detail">
        <div class="swap-step-line">
          <span class="move-wine-name">${escapeHtml(primary.wineName)}</span>
          <span class="swap-arrow">↔</span>
          <span class="move-wine-name">${escapeHtml(displaced.wineName)}</span>
        </div>
        <span class="move-step-slots">${rowId}C${primary.from} ↔ ${rowId}C${primary.to}</span>
      </div>`;
  }

  if (stepType === 'rotation') {
    const lines = moves.map(m =>
      `<div class="rotation-move-line">
         <span class="move-wine-name">${escapeHtml(m.wineName)}</span>
         <span class="from">${rowId}C${m.from}</span><span class="arrow">→</span><span class="to">${rowId}C${m.to}</span>
       </div>`
    ).join('');
    return `
      <span class="move-step-type-badge move-step-type--rotation">Rotation (${moves.length})</span>
      <div class="move-step-detail rotation-detail">${lines}</div>`;
  }

  return '';
}

/**
 * Update the progress bar and step card states after a step is completed.
 * @param {Array} groupingSteps
 * @param {HTMLElement} listEl
 * @param {number} totalSteps
 */
function updateGroupingProgress(groupingSteps, listEl, totalSteps) {
  const doneCount = _groupingStepsDone.size;
  const pct = totalSteps > 0 ? Math.round((doneCount / totalSteps) * 100) : 0;

  const fill = document.getElementById('grouping-progress-fill');
  const label = document.getElementById('grouping-progress-label');
  if (fill) fill.style.width = `${pct}%`;
  if (label) label.textContent = `${doneCount} / ${totalSteps} steps done`;

  // Update card states
  listEl.querySelectorAll('.grouping-step-card').forEach(card => {
    const rowId = card.dataset.rowId;
    const stepNum = Number.parseInt(card.dataset.stepNum, 10);
    const key = `${rowId}:${stepNum}`;
    if (_groupingStepsDone.has(key)) {
      card.classList.add('move-step--completed');
      card.classList.remove('move-step--next');
    }
  });

  // Mark first non-done step in each row section as "next"
  listEl.querySelectorAll('.grouping-row-section').forEach(section => {
    const rowId = section.dataset.rowId;
    let markedNext = false;
    section.querySelectorAll('.grouping-step-card').forEach(card => {
      const stepNum = Number.parseInt(card.dataset.stepNum, 10);
      if (!_groupingStepsDone.has(`${rowId}:${stepNum}`) && !markedNext) {
        card.classList.add('move-step--next');
        markedNext = true;
      } else {
        card.classList.remove('move-step--next');
      }
    });
  });
}

/**
 * Execute one atomic step from a grouping plan.
 * @param {string} rowId
 * @param {Object} step
 * @param {Array} allGroupingSteps
 * @param {HTMLElement} listEl
 * @param {number} totalSteps
 */
async function executeGroupingStep(rowId, step, allGroupingSteps, listEl, totalSteps) {
  const movesToExecute = step.moves.map(m => ({
    wineId: m.wineId,
    wineName: m.wineName,
    from: `${rowId}C${m.from}`,
    to: `${rowId}C${m.to}`,
  }));

  const result = await executeCellarMoves(movesToExecute);
  if (result?.success === false) {
    if (result.validation) showValidationErrorModal(result.validation);
    else showToast('Step execution failed');
    return false;
  }

  _groupingStepsDone.add(`${rowId}:${step.stepNumber}`);
  await refreshLayout();
  updateGroupingProgress(allGroupingSteps, listEl, totalSteps);

  // Disable the executed button and show done label on the card
  const card = listEl.querySelector(
    `.grouping-step-card[data-row-id="${CSS.escape(rowId)}"][data-step-num="${step.stepNumber}"]`
  );
  if (card) {
    card.querySelector('.grouping-step-execute-btn')?.remove();
    if (!card.querySelector('.move-step-done-label')) {
      const doneLabel = document.createElement('span');
      doneLabel.className = 'move-step-done-label';
      doneLabel.textContent = 'Done';
      card.appendChild(doneLabel);
    }
  }

  // When all steps are done, reload analysis
  if (_groupingStepsDone.size >= totalSteps) {
    const { loadAnalysis } = await import('./analysis.js');
    await loadAnalysis(true);
  }

  return true;
}

/** @param {boolean} disabled @param {string} label */
function setExecAllBtnState(disabled, label) {
  const btn = document.getElementById('grouping-execute-all-btn');
  if (!btn) return;
  btn.disabled = disabled;
  btn.textContent = label;
}

/**
 * Execute all pending grouping steps sequentially.
 * @param {Array} groupingSteps
 * @param {HTMLElement} listEl
 */
async function executeAllGroupingSteps(groupingSteps, listEl) {
  const totalSteps = groupingSteps.reduce((s, r) => s + r.steps.length, 0);
  setExecAllBtnState(true, 'Running...');

  try {
    for (const rowPlan of groupingSteps) {
      const aborted = await runRowSteps(rowPlan, groupingSteps, listEl, totalSteps);
      if (aborted) { setExecAllBtnState(false, 'Execute All'); return; }
    }
  } catch (err) {
    if (err.validation) showValidationErrorModal(err.validation);
    else showToast(`Error: ${err.message}`);
    setExecAllBtnState(false, 'Execute All');
  }
}

/**
 * Run all pending steps for one row plan. Returns true if aborted on failure.
 * @returns {Promise<boolean>}
 */
async function runRowSteps(rowPlan, groupingSteps, listEl, totalSteps) {
  for (const step of rowPlan.steps) {
    if (_groupingStepsDone.has(`${rowPlan.rowId}:${step.stepNumber}`)) continue;
    const card = listEl.querySelector(
      `.grouping-step-card[data-row-id="${CSS.escape(rowPlan.rowId)}"][data-step-num="${step.stepNumber}"]`
    );
    const btn = card?.querySelector('.grouping-step-execute-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Working...'; }

    const ok = await executeGroupingStep(rowPlan.rowId, step, groupingSteps, listEl, totalSteps);
    if (!ok) {
      if (btn) { btn.disabled = false; btn.textContent = btn.dataset.label ?? 'Execute'; }
      return true; // aborted
    }
  }
  return false;
}

/**
 * Render grouping steps as numbered atomic step cards with local progress tracking.
 * Falls back to renderGroupingMoves when no structured step data is available.
 *
 * @param {Array} groupingSteps - [{rowId, steps: [{stepNumber, stepType, moves}], cost}]
 * @param {Array} groupingMoves - Flat move list (used for cross-row moves + fallback)
 */
/** @param {string} stepType @returns {string} */
function stepActionLabel(stepType) {
  if (stepType === 'swap') return 'Swap';
  if (stepType === 'rotation') return 'Rotate';
  return 'Move';
}

/** Build HTML for the step cards section of groupingSteps. */
function buildGroupingStepsHtml(groupingSteps, totalSteps) {
  let html = `
    <div class="grouping-steps-header">
      <div class="grouping-steps-meta">
        <span class="move-progress-label" id="grouping-progress-label">0 / ${totalSteps} steps done</span>
        <div class="move-progress-bar">
          <div class="move-progress-fill" id="grouping-progress-fill" style="width:0%"></div>
        </div>
      </div>
      <button class="btn btn-primary btn-small" id="grouping-execute-all-btn">Execute All</button>
    </div>`;

  for (const rowPlan of groupingSteps) {
    html += `<div class="grouping-row-section" data-row-id="${escapeHtml(rowPlan.rowId)}">`;
    html += `<div class="grouping-row-header">Row ${escapeHtml(rowPlan.rowId.slice(1))}</div>`;
    for (const step of rowPlan.steps) {
      const label = stepActionLabel(step.stepType);
      html += `
        <div class="grouping-step-card" data-row-id="${escapeHtml(rowPlan.rowId)}" data-step-num="${step.stepNumber}">
          <span class="move-step-badge">${step.stepNumber}</span>
          <div class="move-step-body">${renderStepMovesHtml(rowPlan.rowId, step)}</div>
          <button class="btn btn-primary btn-small grouping-step-execute-btn" data-label="${label}">${label}</button>
        </div>`;
    }
    html += '</div>';
  }
  return html;
}

/** Build HTML for the cross-row moves section. */
function buildCrossRowMovesHtml(crossRowMoves, showHeader) {
  let html = '<div class="grouping-cross-row-section">';
  if (showHeader) html += '<div class="grouping-row-header">Cross-row moves</div>';
  html += crossRowMoves.map((move, i) => `
    <div class="move-item grouping-item priority-5" data-cross-row-index="${i}">
      <div class="move-details">
        <div class="move-wine-name">${escapeHtml(move.wineName || 'Unknown')}</div>
        <div class="move-path">
          <span class="from">${move.from}</span>
          <span class="arrow">→</span>
          <span class="to">${move.to}</span>
        </div>
        <div class="move-reason">${escapeHtml(move.reason || 'Group bottles')}</div>
      </div>
      <div class="move-actions">
        <button class="btn btn-primary btn-small cross-row-execute-btn" data-cross-row-index="${i}">Move</button>
        <button class="btn btn-secondary btn-small cross-row-dismiss-btn" data-cross-row-index="${i}">Ignore</button>
      </div>
    </div>`).join('');
  return html + '</div>';
}

/** Wire event handlers for step execute buttons. */
function wireStepButtons(groupingSteps, listEl, totalSteps) {
  listEl.querySelectorAll('.grouping-row-section').forEach(section => {
    section.querySelector('.grouping-step-card')?.classList.add('move-step--next');
  });

  listEl.querySelectorAll('.grouping-step-execute-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const card = btn.closest('.grouping-step-card');
      const rowId = card.dataset.rowId;
      const stepNum = Number.parseInt(card.dataset.stepNum, 10);
      const step = groupingSteps.find(r => r.rowId === rowId)?.steps.find(s => s.stepNumber === stepNum);
      if (!step) return;
      btn.disabled = true;
      btn.textContent = 'Working...';
      try {
        const ok = await executeGroupingStep(rowId, step, groupingSteps, listEl, totalSteps);
        if (!ok) { btn.disabled = false; btn.textContent = btn.dataset.label ?? 'Execute'; }
      } catch (err) {
        if (err.validation) showValidationErrorModal(err.validation);
        else showToast(`Error: ${err.message}`);
        btn.disabled = false;
        btn.textContent = btn.dataset.label ?? 'Execute';
      }
    });
  });

  document.getElementById('grouping-execute-all-btn')
    ?.addEventListener('click', () => executeAllGroupingSteps(groupingSteps, listEl));
}

/** Wire event handlers for cross-row move buttons. */
function wireCrossRowButtons(crossRowMoves, listEl, container) {
  listEl.querySelectorAll('.cross-row-execute-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const move = crossRowMoves[Number.parseInt(btn.dataset.crossRowIndex, 10)];
      if (!move) return;
      btn.disabled = true;
      btn.textContent = 'Working...';
      try {
        await executeCellarMoves([{ wineId: move.wineId, from: move.from, to: move.to }]);
        showToast(`Moved to ${move.to}`);
        removeCrossRowItem(btn, listEl, container);
        await refreshLayout();
      } catch (err) {
        if (err.validation) showValidationErrorModal(err.validation);
        else showToast(`Error: ${err.message}`);
        btn.disabled = false;
        btn.textContent = 'Move';
      }
    });
  });

  listEl.querySelectorAll('.cross-row-dismiss-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeCrossRowItem(btn, listEl, container);
    });
  });
}

function removeCrossRowItem(btn, listEl, container) {
  btn.closest('.grouping-item')?.remove();
  if (!listEl.querySelector('.grouping-item')) {
    listEl.querySelector('.grouping-cross-row-section')?.remove();
    if (!listEl.querySelector('.grouping-row-section')) container.style.display = 'none';
  }
}

/**
 * Render grouping steps as numbered atomic step cards with local progress tracking.
 * Falls back to renderGroupingMoves when no structured step data is available.
 *
 * When groupingByArea is provided (multiple storage areas), renders a labelled
 * section header per area before its step cards.
 *
 * @param {Array} groupingSteps - [{rowId, steps: [{stepNumber, stepType, moves}], cost}]
 * @param {Array} groupingMoves - Flat move list (used for cross-row moves + fallback)
 * @param {Object} [groupingByArea] - Per-area plans: { [areaId]: { areaName, steps, groupingMoves } }
 */
export function renderGroupingSteps(groupingSteps, groupingMoves, groupingByArea) {
  const container = document.getElementById('analysis-grouping');
  const listEl = document.getElementById('grouping-list');
  if (!container || !listEl) return;

  _groupingStepsDone.clear();

  // Multi-area mode: render each area's steps under a labelled header
  const areaEntries = groupingByArea ? Object.values(groupingByArea) : [];
  if (areaEntries.length > 0) {
    container.style.display = 'block';
    let html = '';
    for (const area of areaEntries) {
      if (!area.steps || area.steps.length === 0) continue;
      const totalAreaSteps = area.steps.reduce((s, r) => s + r.steps.length, 0);
      html += `<div class="grouping-area-section" data-area-id="${escapeHtml(area.areaId)}">`;
      html += `<div class="grouping-area-header">${escapeHtml(area.areaName)}</div>`;
      html += buildGroupingStepsHtml(area.steps, totalAreaSteps);
      html += '</div>';
    }
    listEl.innerHTML = html;
    for (const area of areaEntries) {
      if (!area.steps || area.steps.length === 0) continue;
      const totalAreaSteps = area.steps.reduce((s, r) => s + r.steps.length, 0);
      wireStepButtons(area.steps, listEl, totalAreaSteps);
    }
    return;
  }

  const hasSteps = Array.isArray(groupingSteps) && groupingSteps.length > 0;
  const crossRowMoves = (groupingMoves || []).filter(m => {
    const fromRow = (m.from ?? '').match(/^(R\d+)/)?.[1];
    const toRow = (m.to ?? '').match(/^(R\d+)/)?.[1];
    return fromRow && toRow && fromRow !== toRow;
  });

  if (!hasSteps && crossRowMoves.length === 0) {
    // Fallback to flat list for backwards compat (e.g., old cached analysis)
    renderGroupingMoves(groupingMoves ?? []);
    return;
  }

  container.style.display = 'block';
  const totalSteps = hasSteps ? groupingSteps.reduce((s, r) => s + r.steps.length, 0) : 0;

  let html = '';
  if (hasSteps) html += buildGroupingStepsHtml(groupingSteps, totalSteps);
  if (crossRowMoves.length > 0) html += buildCrossRowMovesHtml(crossRowMoves, hasSteps);

  listEl.innerHTML = html;

  if (hasSteps) wireStepButtons(groupingSteps, listEl, totalSteps);
  if (crossRowMoves.length > 0) wireCrossRowButtons(crossRowMoves, listEl, container);
}

/**
 * Render cross-area move suggestions (cellar↔fridge).
 * Each suggestion gets a Move and Ignore button; Move executes immediately via the
 * standard executeCellarMoves flow, Ignore removes the card.
 *
 * @param {Array} suggestions - [{type, direction, wineId, wineName, vintage, from, reason}]
 */
export function renderCrossAreaSuggestions(suggestions) {
  const container = document.getElementById('analysis-cross-area');
  const listEl = document.getElementById('cross-area-list');
  if (!container || !listEl) return;

  if (!Array.isArray(suggestions) || suggestions.length === 0) {
    container.style.display = 'none';
    listEl.innerHTML = '';
    return;
  }

  container.style.display = 'block';

  listEl.innerHTML = suggestions.map((s, i) => {
    const dirLabel = s.direction === 'cellar_to_fridge' ? '→ Fridge' : '→ Cellar';
    const vintage = s.vintage ? ` ${s.vintage}` : '';
    return `
      <div class="move-item cross-area-item" data-cross-area-index="${i}">
        <div class="move-details">
          <div class="move-wine-name">${escapeHtml(s.wineName || 'Unknown')}${escapeHtml(vintage)}</div>
          <div class="move-path">
            <span class="from">${escapeHtml(s.from || '—')}</span>
            <span class="arrow">${escapeHtml(dirLabel)}</span>
          </div>
          <div class="move-reason">${escapeHtml(s.reason || '')}</div>
        </div>
        <div class="move-actions">
          <button class="btn btn-primary btn-small cross-area-move-btn" data-index="${i}">Move</button>
          <button class="btn btn-secondary btn-small cross-area-ignore-btn" data-index="${i}">Ignore</button>
        </div>
      </div>`;
  }).join('');

  listEl.querySelectorAll('.cross-area-move-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const s = suggestions[Number.parseInt(btn.dataset.index, 10)];
      if (!s || !s.from) return;
      btn.disabled = true;
      btn.textContent = 'Working...';
      try {
        // For cellar→fridge the API needs a target slot; use null to let the server pick.
        // For fridge→cellar the server similarly finds the best row.
        await executeCellarMoves([{ wineId: s.wineId, from: s.from, to: null }]);
        showToast(`Moved ${s.wineName}`);
        btn.closest('.cross-area-item')?.remove();
        if (!listEl.querySelector('.cross-area-item')) container.style.display = 'none';
        await refreshLayout();
      } catch (err) {
        showToast(`Error: ${err.message}`);
        btn.disabled = false;
        btn.textContent = 'Move';
      }
    });
  });

  listEl.querySelectorAll('.cross-area-ignore-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      btn.closest('.cross-area-item')?.remove();
      if (!listEl.querySelector('.cross-area-item')) container.style.display = 'none';
    });
  });
}
