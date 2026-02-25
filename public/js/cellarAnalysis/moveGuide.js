/**
 * @fileoverview Visual grid move guide for cellar analysis.
 * Provides step-by-step guided execution of suggested moves
 * with grid annotations highlighting source/target slots.
 * @module cellarAnalysis/moveGuide
 */

import { executeCellarMoves } from '../api.js';
import { refreshLayout } from '../app.js';
import { showToast, escapeHtml } from '../utils.js';
import { addTrackedListener, cleanupNamespace } from '../eventManager.js';
import { getCurrentAnalysis } from './state.js';
import { loadAnalysis } from './analysis.js';
import { showValidationErrorModal } from './moves.js';

const NAMESPACE = 'moveGuide';

/**
 * Guide state (in-memory only — lost on page refresh).
 */
const guideState = {
  active: false,
  executing: false,
  moves: [],
  currentIndex: 0,
  completedIndices: new Set(),
  dismissedIndices: new Set(),
  swapPartners: new Map(),
  panelElement: null
};

// ============================================================
// Shared swap detection (also used by moves.js via export)
// ============================================================

/**
 * Detect swap pairs (A→B + B→A) in moves.
 * @param {Array} moves - Array of move objects with from/to properties
 * @param {Object} [options]
 * @param {string} [options.typeFilter] - Only consider moves with this type (e.g., 'move')
 * @returns {Map<number, number>} Map of index → partner index
 */
export function detectSwapPairs(moves, { typeFilter = null } = {}) {
  const partners = new Map();
  for (let i = 0; i < moves.length; i++) {
    if (partners.has(i)) continue;
    if (typeFilter && moves[i]?.type !== typeFilter) continue;
    for (let j = i + 1; j < moves.length; j++) {
      if (partners.has(j)) continue;
      if (typeFilter && moves[j]?.type !== typeFilter) continue;
      if (moves[i].from === moves[j].to && moves[i].to === moves[j].from) {
        partners.set(i, j);
        partners.set(j, i);
        break;
      }
    }
  }
  return partners;
}

/**
 * Open the move guide panel and annotate the grid.
 * @param {Array} allMoves - All suggested moves (including manual type)
 */
export function openMoveGuide(allMoves) {
  const actionableMoves = (allMoves || []).filter(m => m.type === 'move');

  if (actionableMoves.length === 0) {
    showToast('No moves to guide');
    return;
  }

  // Reset state
  guideState.active = true;
  guideState.executing = false;
  guideState.moves = actionableMoves;
  guideState.currentIndex = 0;
  guideState.completedIndices = new Set();
  guideState.dismissedIndices = new Set();
  guideState.swapPartners = detectSwapPairs(actionableMoves);

  // Switch to cellar grid tab
  switchToCellarTab();

  // Create panel and annotate
  createPanel();
  updatePanel();
  applyAnnotations();
  scrollToActiveSlot();

  // Register annotation hook for grid re-renders
  window.__moveGuideAnnotate = applyAnnotations;

  // Listen for tab switches to close guide
  listenForTabSwitch();
}

/**
 * Close the move guide and clean up.
 * @internal — exported for unit tests only
 */
export function closeMoveGuide() {
  guideState.active = false;
  guideState.executing = false;
  guideState.moves = [];
  guideState.currentIndex = 0;
  guideState.completedIndices.clear();
  guideState.dismissedIndices.clear();
  guideState.swapPartners.clear();

  clearAnnotations();
  removePanel();
  cleanupNamespace(NAMESPACE);

  // Remove grid re-render hook
  delete window.__moveGuideAnnotate;

  // Remove body class and dynamic offset
  document.body.classList.remove('move-guide-active');
  const gridView = document.getElementById('view-grid');
  if (gridView) gridView.style.paddingTop = '';
}

/**
 * Check if the move guide is currently active.
 * @internal — exported for unit tests only
 * @returns {boolean}
 */
export function isMoveGuideActive() {
  return guideState.active;
}

/**
 * Re-apply CSS classes to grid slots (called after grid re-renders).
 */
function annotateGrid() {
  if (!guideState.active) return;
  applyAnnotations();
}

// ============================================================
// Panel management
// ============================================================

/**
 * Create the fixed-position guide panel.
 */
function createPanel() {
  removePanel();

  const panel = document.createElement('div');
  panel.className = 'move-guide-panel';
  panel.setAttribute('role', 'region');
  panel.setAttribute('aria-label', 'Move guide');
  panel.innerHTML = `
    <div class="move-guide-header">
      <div class="move-guide-title">Move Guide</div>
      <div class="move-guide-step"></div>
      <button class="move-guide-close" aria-label="Close guide">&times;</button>
    </div>
    <div class="move-guide-progress">
      <div class="move-guide-progress-fill" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"></div>
    </div>
    <div class="move-guide-instruction"></div>
    <div class="move-guide-status" aria-live="polite" aria-atomic="true"></div>
    <div class="move-guide-actions">
      <button class="btn btn-primary btn-small move-guide-execute">Execute Move</button>
      <button class="btn btn-secondary btn-small move-guide-skip">Skip</button>
      <button class="btn btn-secondary btn-small move-guide-recalculate">Recalculate</button>
    </div>
  `;

  document.body.appendChild(panel);
  document.body.classList.add('move-guide-active');
  guideState.panelElement = panel;

  // Wire button handlers
  const closeBtn = panel.querySelector('.move-guide-close');
  const executeBtn = panel.querySelector('.move-guide-execute');
  const skipBtn = panel.querySelector('.move-guide-skip');
  const recalcBtn = panel.querySelector('.move-guide-recalculate');

  addTrackedListener(NAMESPACE, closeBtn, 'click', () => closeMoveGuide());
  addTrackedListener(NAMESPACE, executeBtn, 'click', () => executeCurrentMove());
  addTrackedListener(NAMESPACE, skipBtn, 'click', () => skipCurrentMove());
  addTrackedListener(NAMESPACE, recalcBtn, 'click', () => handleRecalculate());

  // Esc key closes guide
  addTrackedListener(NAMESPACE, document, 'keydown', (e) => {
    if (e.key === 'Escape' && guideState.active) {
      closeMoveGuide();
    }
  });

  // Measure panel and apply dynamic offset
  requestAnimationFrame(() => applyDynamicOffset());
}

/**
 * Measure panel height and apply as padding-top to the grid view.
 */
function applyDynamicOffset() {
  if (!guideState.panelElement) return;
  const height = guideState.panelElement.offsetHeight;
  const gridView = document.getElementById('view-grid');
  if (gridView) {
    gridView.style.paddingTop = `${height + 8}px`;
  }
}

/**
 * Update panel content for current step.
 */
function updatePanel() {
  if (!guideState.panelElement) return;

  const total = guideState.moves.length;
  const completed = guideState.completedIndices.size + guideState.dismissedIndices.size;
  const remaining = total - completed;

  // Step counter
  const stepEl = guideState.panelElement.querySelector('.move-guide-step');
  if (stepEl) {
    stepEl.textContent = `Step ${guideState.currentIndex + 1} of ${total}`;
  }

  // Progress bar
  const progressFill = guideState.panelElement.querySelector('.move-guide-progress-fill');
  if (progressFill) {
    const pct = total > 0 ? (completed / total) * 100 : 0;
    progressFill.style.width = `${pct}%`;
    progressFill.setAttribute('aria-valuenow', String(Math.round(pct)));
  }

  // Instruction
  const instructionEl = guideState.panelElement.querySelector('.move-guide-instruction');
  if (instructionEl && guideState.currentIndex < total) {
    const move = guideState.moves[guideState.currentIndex];
    const isSwap = guideState.swapPartners.has(guideState.currentIndex);
    const swapBadge = isSwap ? ' <span class="move-guide-swap-badge">SWAP</span>' : '';

    instructionEl.innerHTML = `
      <div class="move-guide-wine">${escapeHtml(move.wineName)}${swapBadge}</div>
      <div class="move-guide-path">
        <span class="move-guide-from">${escapeHtml(move.from)}</span>
        <span class="move-guide-arrow">${isSwap ? '↔' : '→'}</span>
        <span class="move-guide-to">${escapeHtml(move.to)}</span>
      </div>
      ${move.reason ? `<div class="move-guide-reason">${escapeHtml(move.reason)}</div>` : ''}
    `;
  }

  // Show/hide action buttons
  const executeBtn = guideState.panelElement.querySelector('.move-guide-execute');
  const skipBtn = guideState.panelElement.querySelector('.move-guide-skip');
  if (executeBtn) executeBtn.style.display = remaining > 0 ? '' : 'none';
  if (skipBtn) skipBtn.style.display = remaining > 0 ? '' : 'none';

  // Announce step to screen readers
  announceStatus(`Step ${guideState.currentIndex + 1} of ${total}`);

  // Re-measure panel height (content may have changed)
  requestAnimationFrame(() => applyDynamicOffset());
}

/**
 * Remove panel from DOM.
 */
function removePanel() {
  if (guideState.panelElement) {
    guideState.panelElement.remove();
    guideState.panelElement = null;
  }
}

/**
 * Show completion message in the panel.
 */
function showCompletion() {
  if (!guideState.panelElement) return;

  const completed = guideState.completedIndices.size;
  const skipped = guideState.dismissedIndices.size;

  const instructionEl = guideState.panelElement.querySelector('.move-guide-instruction');
  if (instructionEl) {
    instructionEl.innerHTML = `
      <div class="move-guide-complete">
        All moves processed! ${completed} executed, ${skipped} skipped.
      </div>
    `;
  }

  // Replace action buttons with Done + Recalculate
  const actionsEl = guideState.panelElement.querySelector('.move-guide-actions');
  if (actionsEl) {
    actionsEl.innerHTML = `
      <button class="btn btn-primary btn-small move-guide-done">Done</button>
      <button class="btn btn-secondary btn-small move-guide-recalculate-final">Recalculate</button>
    `;
    const doneBtn = actionsEl.querySelector('.move-guide-done');
    const recalcBtn = actionsEl.querySelector('.move-guide-recalculate-final');
    addTrackedListener(NAMESPACE, doneBtn, 'click', () => closeMoveGuide());
    addTrackedListener(NAMESPACE, recalcBtn, 'click', () => handleRecalculate());
  }

  // Update progress to 100%
  const progressFill = guideState.panelElement.querySelector('.move-guide-progress-fill');
  if (progressFill) {
    progressFill.style.width = '100%';
    progressFill.setAttribute('aria-valuenow', '100');
  }

  const stepEl = guideState.panelElement.querySelector('.move-guide-step');
  if (stepEl) {
    stepEl.textContent = 'Complete';
  }

  // Clear active annotations, keep completed dimmed
  applyAnnotations();

  announceStatus(`Move guide complete. ${completed} executed, ${skipped} skipped.`);
}

/**
 * Announce a status message for screen readers via aria-live region.
 * @param {string} message
 */
function announceStatus(message) {
  if (!guideState.panelElement) return;
  const statusEl = guideState.panelElement.querySelector('.move-guide-status');
  if (statusEl) {
    statusEl.textContent = message;
  }
}

// ============================================================
// Grid annotations
// ============================================================

/**
 * Apply CSS annotations to grid slots for current guide state.
 */
function applyAnnotations() {
  clearAnnotations();
  if (!guideState.active || guideState.moves.length === 0) return;

  const currentIdx = guideState.currentIndex;

  for (let i = 0; i < guideState.moves.length; i++) {
    if (guideState.completedIndices.has(i) || guideState.dismissedIndices.has(i)) {
      // Completed/skipped — dim them
      annotateSlot(guideState.moves[i].from, 'move-guide-completed');
      annotateSlot(guideState.moves[i].to, 'move-guide-completed');
      continue;
    }

    if (i === currentIdx) {
      // Current move — highlight source and target
      annotateSlot(guideState.moves[i].from, 'move-guide-source');
      annotateSlot(guideState.moves[i].to, 'move-guide-target');

      // If swap, also highlight partner
      const partnerIdx = guideState.swapPartners.get(i);
      if (partnerIdx !== undefined && partnerIdx !== i) {
        annotateSlot(guideState.moves[partnerIdx].from, 'move-guide-source');
        annotateSlot(guideState.moves[partnerIdx].to, 'move-guide-target');
      }
    } else {
      // Pending — subtle highlight
      annotateSlot(guideState.moves[i].from, 'move-guide-pending-source');
      annotateSlot(guideState.moves[i].to, 'move-guide-pending-target');
    }
  }
}

/**
 * Add a CSS class to a slot by location code.
 * @param {string} location - Slot location code (e.g., "R3C1")
 * @param {string} className - CSS class to add
 */
function annotateSlot(location, className) {
  const slot = document.querySelector(`.slot[data-location="${location}"]`);
  if (slot) {
    slot.classList.add(className);
  }
}

/**
 * Remove all move-guide annotation classes from all slots.
 */
function clearAnnotations() {
  const classes = [
    'move-guide-source', 'move-guide-target',
    'move-guide-pending-source', 'move-guide-pending-target',
    'move-guide-completed'
  ];
  document.querySelectorAll('.slot').forEach(slot => {
    slot.classList.remove(...classes);
  });
}

/**
 * Scroll the active source slot into view.
 */
function scrollToActiveSlot() {
  if (!guideState.active || guideState.currentIndex >= guideState.moves.length) return;
  const move = guideState.moves[guideState.currentIndex];
  const slot = document.querySelector(`.slot[data-location="${move.from}"]`);
  if (slot) {
    slot.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

// ============================================================
// Move execution
// ============================================================

/**
 * Execute the current move (or swap pair atomically).
 */
async function executeCurrentMove() {
  if (guideState.executing) return; // In-flight lock
  const idx = guideState.currentIndex;
  const move = guideState.moves[idx];
  if (!move) return;

  guideState.executing = true;
  setExecuteButtonBusy(true);

  const partnerIdx = guideState.swapPartners.get(idx);
  const isSwap = partnerIdx !== undefined;

  // Build moves array (single or swap pair)
  const movesToExecute = [{
    wineId: move.wineId,
    wineName: move.wineName,
    from: move.from,
    to: move.to,
    ...(move.toZoneId ? { zoneId: move.toZoneId, confidence: move.confidence } : {})
  }];

  if (isSwap) {
    const partner = guideState.moves[partnerIdx];
    movesToExecute.push({
      wineId: partner.wineId,
      wineName: partner.wineName,
      from: partner.from,
      to: partner.to,
      ...(partner.toZoneId ? { zoneId: partner.toZoneId, confidence: partner.confidence } : {})
    });
  }

  try {
    const result = await executeCellarMoves(movesToExecute);
    if (result && result.success === false) {
      if (result.validation) {
        showValidationErrorModal(result.validation);
      } else {
        showToast(`Move failed: ${result.validation?.errors?.[0]?.message || 'Validation error'}`);
      }
      return;
    }

    // Mark completed
    guideState.completedIndices.add(idx);
    if (isSwap) {
      guideState.completedIndices.add(partnerIdx);
      showToast(`Swapped: ${move.wineName} (${move.from} → ${move.to}) ↔ ${guideState.moves[partnerIdx].wineName} (${guideState.moves[partnerIdx].from} → ${guideState.moves[partnerIdx].to})`);
    } else {
      showToast(`Moved ${move.wineName} to ${move.to}`);
    }

    // Refresh grid
    await refreshLayout();

    // Advance to next
    if (!advanceToNext()) {
      showCompletion();
    } else {
      updatePanel();
      applyAnnotations();
      scrollToActiveSlot();
    }
  } catch (err) {
    // Show validation modal for structured errors (400 validation failures)
    if (err.validation) {
      showValidationErrorModal(err.validation);
    } else if (err.stateConflict) {
      // 409 Conflict: slot state changed since analysis was generated
      showToast('Slot state has changed — refreshing. Please re-run analysis.', 'warning');
      await refreshLayout();
    } else {
      showToast(`Error: ${err.message}`);
    }
  } finally {
    guideState.executing = false;
    setExecuteButtonBusy(false);
  }
}

/**
 * Set the execute button disabled/enabled state during in-flight requests.
 * @param {boolean} busy
 */
function setExecuteButtonBusy(busy) {
  if (!guideState.panelElement) return;
  const btn = guideState.panelElement.querySelector('.move-guide-execute');
  if (btn) {
    btn.disabled = busy;
    btn.textContent = busy ? 'Moving...' : 'Execute Move';
  }
}

/**
 * Skip the current move.
 */
function skipCurrentMove() {
  const idx = guideState.currentIndex;
  guideState.dismissedIndices.add(idx);

  // If swap, also skip partner
  const partnerIdx = guideState.swapPartners.get(idx);
  if (partnerIdx !== undefined) {
    guideState.dismissedIndices.add(partnerIdx);
  }

  if (!advanceToNext()) {
    showCompletion();
  } else {
    updatePanel();
    applyAnnotations();
    scrollToActiveSlot();
  }
}

/**
 * Advance currentIndex to the next non-completed/non-dismissed move.
 * @returns {boolean} True if there is a next move, false if all done
 */
function advanceToNext() {
  for (let i = 0; i < guideState.moves.length; i++) {
    if (!guideState.completedIndices.has(i) && !guideState.dismissedIndices.has(i)) {
      guideState.currentIndex = i;
      return true;
    }
  }
  return false;
}

/**
 * Recalculate analysis and restart guide with fresh moves.
 */
async function handleRecalculate() {
  showToast('Recalculating analysis...');

  try {
    await loadAnalysis(true);
    const analysis = getCurrentAnalysis();
    const freshMoves = analysis?.suggestedMoves || [];

    closeMoveGuide();

    if (freshMoves.some(m => m.type === 'move')) {
      openMoveGuide(freshMoves);
    } else {
      showToast('No more moves needed!');
    }
  } catch (err) {
    showToast(`Error: ${err.message}`);
  }
}

// ============================================================
// Navigation helpers
// ============================================================

/**
 * Switch to the cellar grid tab.
 */
function switchToCellarTab() {
  const gridTab = document.querySelector('[data-view="grid"]');
  if (gridTab) {
    gridTab.click();
  }
}

/**
 * Listen for tab switch events and close the guide if user leaves grid tab.
 */
function listenForTabSwitch() {
  document.querySelectorAll('.tab[data-view]').forEach(tab => {
    if (tab.dataset.view === 'grid') return; // Ignore grid tab clicks
    addTrackedListener(NAMESPACE, tab, 'click', () => {
      if (guideState.active) {
        closeMoveGuide();
      }
    });
  });
}
