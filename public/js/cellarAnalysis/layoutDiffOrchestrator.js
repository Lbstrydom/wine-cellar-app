/**
 * @fileoverview Orchestrator for the unified layout diff view.
 * Ties together rendering (layoutDiffGrid), controls (layoutDiffControls),
 * and drag-drop (layoutDiffDragDrop). Manages the full propose → review →
 * execute flow.
 *
 * @module cellarAnalysis/layoutDiffOrchestrator
 */

import { showToast, shortenWineName, escapeHtml } from '../utils.js';
import { refreshLayout } from '../app.js';
import { executeCellarMoves, validateMoves, getProposedBottleLayout, getZoneMap } from '../api.js';
import {
  getCurrentAnalysis,
  getLayoutProposal, setLayoutProposal,
  getLayoutFlowState, setLayoutFlowState,
  getCurrentLayoutSnapshot, setCurrentLayoutSnapshot
} from './state.js';
import { renderDiffGrid, classifySlot, buildSwapSlotSet, computeDiffStats } from './layoutDiffGrid.js';
import { renderViewToggle, renderDiffSummary, renderApprovalCTA, applyViewMode, updateApplyButtonCount, toggleResetButton, ViewMode } from './layoutDiffControls.js';
import { enableProposedLayoutEditing, disableProposedLayoutEditing, getUndoStack, popUndo, clearUndoStack, hasOverrides } from './layoutDiffDragDrop.js';
import { refreshAnalysis } from './analysis.js';

const DIFF_CONTAINER_ID = 'layout-diff-grid';
let activeZoneMap = {};
let completedMoveSteps = new Set();

function getStepKey(from, to) {
  return `${from}->${to}`;
}

function setDiffFocusMode(enabled) {
  const summaryEl = document.getElementById('analysis-summary');
  const alertsEl = document.getElementById('analysis-alerts');
  const zonesEl = document.getElementById('analysis-zones');
  const compactionEl = document.getElementById('analysis-compaction');

  if (summaryEl) summaryEl.style.display = enabled ? 'none' : '';
  if (alertsEl) alertsEl.style.display = enabled ? 'none' : '';
  if (zonesEl) zonesEl.style.display = enabled ? 'none' : '';
  if (compactionEl) compactionEl.style.display = enabled ? 'none' : '';
}

/**
 * Simple hash of a layout object for stale detection.
 * @param {Object} layout - Map of slotId → wineId
 * @returns {string}
 */
function hashLayout(layout) {
  const entries = Object.entries(layout || {}).sort(([a], [b]) => a.localeCompare(b));
  return entries.map(([k, v]) => `${k}:${v}`).join('|');
}

/**
 * Show the layout proposal CTA in the Cellar Placement workspace.
 * This is the entry point — called from analysis.js when rendering.
 * @param {Object} analysis - Analysis report with layoutProposal
 */
export function renderLayoutProposalCTA(analysis) {
  const ctaEl = document.getElementById('layout-proposal-cta');
  if (!ctaEl) return;

  const proposal = analysis?.layoutProposal;

  if (!proposal) {
    ctaEl.innerHTML = '';
    ctaEl.style.display = 'none';
    return;
  }

  const moveCount = proposal.sortPlan?.length || 0;
  const stayCount = proposal.stats?.stayInPlace ?? 0;

  if (moveCount === 0) {
    ctaEl.innerHTML = `
      <div class="layout-proposal-cta">
        <div class="layout-proposal-icon">\u2713</div>
        <div class="layout-proposal-text">
          <strong>Cellar is optimally organised</strong>
          <p>All ${stayCount} bottles are in their correct zone positions. No moves needed.</p>
        </div>
      </div>
    `;
    ctaEl.style.display = 'block';
    return;
  }

  ctaEl.innerHTML = `
    <div class="layout-proposal-cta layout-proposal-cta--actionable">
      <div class="layout-proposal-icon">\u2194</div>
      <div class="layout-proposal-text">
        <strong>${moveCount} move${moveCount === 1 ? '' : 's'} to optimal layout</strong>
        <p>${stayCount} bottles stay in place. View the proposed layout to review and apply changes.</p>
      </div>
      <button class="btn btn-primary layout-proposal-view-btn">View Proposed Layout</button>
    </div>
  `;
  ctaEl.style.display = 'block';

  // Wire CTA button
  ctaEl.querySelector('.layout-proposal-view-btn')?.addEventListener('click', () => {
    openDiffView(proposal);
  });
}

/**
 * Open the full diff view.
 * @param {Object} proposal - Layout proposal data
 */
async function openDiffView(proposal) {
  const diffContainer = document.getElementById('layout-diff-container');
  if (!diffContainer) return;

  completedMoveSteps = new Set();

  setLayoutProposal(proposal);
  setLayoutFlowState('proposed');
  setCurrentLayoutSnapshot(hashLayout(proposal.currentLayout));

  try {
    activeZoneMap = await getZoneMap();
  } catch (_err) {
    activeZoneMap = {};
  }

  setDiffFocusMode(true);

  // Hide old move sections and CTA banner (diff view replaces both)
  const ctaEl = document.getElementById('layout-proposal-cta');
  if (ctaEl) ctaEl.style.display = 'none';
  const oldMoves = document.getElementById('analysis-moves');
  if (oldMoves) oldMoves.style.display = 'none';
  const oldCompaction = document.getElementById('analysis-compaction');
  if (oldCompaction) oldCompaction.style.display = 'none';

  // Show diff container
  diffContainer.style.display = 'block';
  diffContainer.innerHTML = `
    <div class="layout-diff-header">
      <h3>Proposed Layout</h3>
      <p class="section-desc">Review the optimal bottle placement. Drag bottles to adjust, then apply.</p>
    </div>
    <div id="layout-diff-toggle"></div>
    <div id="layout-diff-summary"></div>
    <div class="layout-diff-hint">
      <span class="hint-icon">\u270B</span> Drag bottles to adjust the proposal
    </div>
    <div id="${DIFF_CONTAINER_ID}" class="layout-diff-grid-wrap"></div>
    <div id="layout-diff-move-list"></div>
    <div id="layout-diff-actions"></div>
  `;

  // Render diff grid
  const currentLayout = buildCurrentLayoutMap(proposal);
  const targetLayout = proposal.targetLayout || {};
  const sortPlan = proposal.sortPlan || [];

  const result = renderDiffGrid(DIFF_CONTAINER_ID, currentLayout, targetLayout, sortPlan, activeZoneMap);

  if (!result) return;

  // Render controls
  renderViewToggle(
    document.getElementById('layout-diff-toggle'),
    (mode) => applyViewMode(DIFF_CONTAINER_ID, mode)
  );

  renderDiffSummary(document.getElementById('layout-diff-summary'), result.stats);

  // Render step-by-step move list
  renderMoveList(document.getElementById('layout-diff-move-list'), sortPlan, currentLayout);

  renderApprovalCTA(document.getElementById('layout-diff-actions'), {
    totalMoves: sortPlan.length,
    onApplyAll: handleApplyAll,
    onReset: handleReset,
    onCancel: handleCancel
  });

  // Hide reset button initially (no overrides yet)
  toggleResetButton(document.getElementById('layout-diff-actions'), false);

  // Enable drag-drop
  enableProposedLayoutEditing({
    gridContainerEl: document.getElementById(DIFF_CONTAINER_ID),
    onSlotChanged: handleSlotSwap
  });

  // Scroll into view
  diffContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * Build current layout map (slotId → wineId) from proposal data.
 * The API returns currentLayout as { slotId: { wineId, wineName, ... } };
 * we flatten to { slotId: wineId } so classifySlot() gets plain numbers.
 * @param {Object} proposal
 * @returns {Object<string, number>}
 */
function buildCurrentLayoutMap(proposal) {
  const raw = proposal.currentLayout || {};
  const flat = {};
  for (const [slotId, value] of Object.entries(raw)) {
    if (value && typeof value === 'object' && value.wineId != null) {
      flat[slotId] = value.wineId;
    } else if (typeof value === 'number') {
      flat[slotId] = value;
    }
    // skip null / undefined entries
  }
  return flat;
}

/**
 * Handle a drag-drop slot swap from the user.
 * Recomputes the layout and re-renders affected slots.
 * @param {string} fromSlotId
 * @param {string} toSlotId
 */
function handleSlotSwap(fromSlotId, toSlotId) {
  const proposal = getLayoutProposal();
  if (!proposal) return;

  setLayoutFlowState('adjusting');

  const targetLayout = proposal.targetLayout;

  // Swap the two slots in the target layout
  const fromWine = targetLayout[fromSlotId] || null;
  const toWine = targetLayout[toSlotId] || null;

  if (fromWine) {
    targetLayout[toSlotId] = fromWine;
  } else {
    delete targetLayout[toSlotId];
  }

  if (toWine) {
    targetLayout[fromSlotId] = toWine;
  } else {
    delete targetLayout[fromSlotId];
  }

  // Re-render the full grid (simple approach — for large cellars could optimise to 2 slots)
  const currentLayout = buildCurrentLayoutMap(proposal);
  const swapSlots = buildSwapSlotSet(proposal.sortPlan || []);
  const result = renderDiffGrid(DIFF_CONTAINER_ID, currentLayout, targetLayout, proposal.sortPlan || [], activeZoneMap);

  if (result) {
    // Update summary and button count
    renderDiffSummary(document.getElementById('layout-diff-summary'), result.stats);
    const totalMoves = result.classifiedSlots.filter(s =>
      s.diffType !== 'stay' && s.diffType !== 'empty'
    ).length;
    // Count actual moves (move-in represents each destination)
    const moveCount = result.stats.moveIn + result.stats.swap;
    updateApplyButtonCount(document.getElementById('layout-diff-actions'), moveCount);
  }

  // Show reset button since user has overrides
  toggleResetButton(document.getElementById('layout-diff-actions'), hasOverrides());

  // Re-enable drag-drop on the re-rendered grid
  enableProposedLayoutEditing({
    gridContainerEl: document.getElementById(DIFF_CONTAINER_ID),
    onSlotChanged: handleSlotSwap
  });
}

/**
 * Handle "Apply All Moves" button.
 */
async function handleApplyAll() {
  const proposal = getLayoutProposal();
  if (!proposal?.sortPlan?.length) {
    showToast('No moves to apply', 'info');
    return;
  }

  // Stale detection: compare snapshot with current state
  try {
    const freshData = await getProposedBottleLayout();
    const freshHash = hashLayout(freshData.currentLayout);
    const snapshotHash = getCurrentLayoutSnapshot();

    if (snapshotHash && freshHash !== snapshotHash) {
      showToast('Cellar has changed since this proposal. Re-analysing...', 'info');
      closeDiffView();
      await refreshAnalysis();
      return;
    }
  } catch (err) {
    console.warn('[LayoutDiff] Stale check failed:', err.message);
    // Continue anyway — the validate endpoint will catch conflicts
  }

  // Validate moves
  try {
    const validation = await validateMoves(proposal.sortPlan);
    if (!validation?.validation?.valid) {
      const errorCount = validation?.validation?.errors?.length || 0;
      showToast(`Validation failed: ${errorCount} issue(s). Re-analysing...`, 'error');
      closeDiffView();
      await refreshAnalysis();
      return;
    }
  } catch (err) {
    showToast(`Move validation error: ${err.message}`, 'error');
    return;
  }

  // Confirm
  const moveCount = proposal.sortPlan.length;
  if (!confirm(`Apply ${moveCount} move${moveCount === 1 ? '' : 's'}? This will reorganise your cellar.`)) {
    return;
  }

  // Execute — disable interactions during execution
  setLayoutFlowState('executing');
  disableProposedLayoutEditing();

  const applyBtn = document.querySelector('.diff-apply-all-btn');
  const resetBtn = document.querySelector('.diff-reset-btn');
  const cancelBtn = document.querySelector('.diff-cancel-btn');
  if (applyBtn) { applyBtn.disabled = true; applyBtn.textContent = 'Executing...'; }
  if (resetBtn) resetBtn.disabled = true;
  if (cancelBtn) cancelBtn.disabled = true;

  try {
    await executeCellarMoves(proposal.sortPlan);
    showToast(`${moveCount} move${moveCount === 1 ? '' : 's'} applied successfully!`, 'success');
    closeDiffView();
    await refreshLayout();
    await refreshAnalysis();
  } catch (err) {
    showToast(`Execution failed: ${err.message}`, 'error');
    setLayoutFlowState('proposed');
    if (applyBtn) { applyBtn.disabled = false; applyBtn.textContent = `Apply All Moves (${moveCount})`; }
    if (resetBtn) resetBtn.disabled = false;
    if (cancelBtn) cancelBtn.disabled = false;
    // Re-enable drag-drop after failure
    enableProposedLayoutEditing({
      gridContainerEl: document.getElementById(DIFF_CONTAINER_ID),
      onSlotChanged: handleSlotSwap
    });
  }
}

/**
 * Handle "Reset to Suggested" button.
 * Reverts user drag-drop adjustments to the original algorithm proposal.
 */
async function handleReset() {
  const analysis = getCurrentAnalysis();
  const originalProposal = analysis?.layoutProposal;
  if (!originalProposal) return;

  clearUndoStack();
  setLayoutFlowState('proposed');

  // Re-open with original data (deep clone to avoid mutation)
  const freshProposal = {
    currentLayout: { ...originalProposal.currentLayout },
    targetLayout: JSON.parse(JSON.stringify(originalProposal.targetLayout)),
    sortPlan: [...(originalProposal.sortPlan || [])],
    stats: { ...originalProposal.stats },
    issues: [...(originalProposal.issues || [])]
  };

  setLayoutProposal(freshProposal);
  completedMoveSteps = new Set();

  // Flatten currentLayout (API can return objects or numbers)
  const currentLayout = buildCurrentLayoutMap(freshProposal);

  // Re-render
  const result = renderDiffGrid(
    DIFF_CONTAINER_ID,
    currentLayout,
    freshProposal.targetLayout,
    freshProposal.sortPlan,
    activeZoneMap
  );

  if (result) {
    renderDiffSummary(document.getElementById('layout-diff-summary'), result.stats);
    updateApplyButtonCount(
      document.getElementById('layout-diff-actions'),
      freshProposal.sortPlan.length
    );
  }

  // Re-render step-by-step move list with fresh data
  renderMoveList(document.getElementById('layout-diff-move-list'), freshProposal.sortPlan, currentLayout);

  toggleResetButton(document.getElementById('layout-diff-actions'), false);

  // Re-enable drag-drop
  enableProposedLayoutEditing({
    gridContainerEl: document.getElementById(DIFF_CONTAINER_ID),
    onSlotChanged: handleSlotSwap
  });

  showToast('Reset to suggested layout', 'info');
}

/**
 * Handle "Close" button — close the diff view and return to normal analysis.
 */
function handleCancel() {
  closeDiffView();
}

/**
 * Close the diff view and restore normal analysis display.
 */
export function closeDiffView() {
  disableProposedLayoutEditing();
  setLayoutFlowState('idle');
  completedMoveSteps = new Set();
  activeZoneMap = {};
  setDiffFocusMode(false);

  const diffContainer = document.getElementById('layout-diff-container');
  if (diffContainer) {
    diffContainer.style.display = 'none';
    diffContainer.innerHTML = '';
  }

  // Restore CTA banner and old move sections
  const ctaEl = document.getElementById('layout-proposal-cta');
  if (ctaEl) ctaEl.style.display = '';
  const oldMoves = document.getElementById('analysis-moves');
  if (oldMoves) oldMoves.style.display = '';
  const oldCompaction = document.getElementById('analysis-compaction');
  if (oldCompaction) oldCompaction.style.display = '';
}

// ───────────────────────────────────────────────────────────
// Step-by-step move list
// ───────────────────────────────────────────────────────────

/**
 * Render a collapsible step-by-step move list below the grid.
 * Groups moves by type (swaps first, then direct moves) and shows
 * numbered instructions the user can physically follow.
 * @param {HTMLElement} containerEl - Container element
 * @param {Array} sortPlan - Array of { wineId, wineName, from, to, moveType, zoneId }
 */
function renderMoveList(containerEl, sortPlan, currentLayout) {
  if (!containerEl || !Array.isArray(sortPlan) || sortPlan.length === 0) {
    if (containerEl) containerEl.innerHTML = '';
    return;
  }

  // Deduplicate swap pairs: for swaps (A→B + B→A), show as one instruction
  const swapPairs = [];
  const directMoves = [];
  const seenSwapSlots = new Set();

  for (const move of sortPlan) {
    if (move.moveType === 'swap') {
      const key = [move.from, move.to].sort((a, b) => a.localeCompare(b)).join('|');
      if (seenSwapSlots.has(key)) continue;
      seenSwapSlots.add(key);

      // Find the partner move
      const partner = sortPlan.find(m =>
        m.moveType === 'swap' && m.from === move.to && m.to === move.from
      );
      swapPairs.push({ move, partner });
    } else {
      directMoves.push(move);
    }
  }

  const totalSteps = swapPairs.length + directMoves.length;
  let stepNum = 0;
  const wineNameLookup = buildMoveListWineLookup(currentLayout);

  const swapHtml = swapPairs.map(({ move, partner }) => {
    stepNum++;
    const stepKey = getStepKey(move.from, move.to);
    const isDone = completedMoveSteps.has(stepKey);
    const nameA = move.wineName || `Wine #${move.wineId}`;
    const fallbackWineId = currentLayout?.[move.to] || null;
    const fallbackName = fallbackWineId ? (wineNameLookup[fallbackWineId] || `(Wine #${fallbackWineId})`) : '(other bottle)';
    const nameB = partner?.wineName || fallbackName;
    return `
      <li class="move-list-item move-list-swap ${isDone ? 'move-list-item-done' : ''}" data-from="${escapeHtml(move.from)}" data-to="${escapeHtml(move.to)}" data-step-key="${escapeHtml(stepKey)}">
        <label class="move-list-check-wrap" aria-label="Mark step ${stepNum} done">
          <input type="checkbox" class="move-list-check" ${isDone ? 'checked' : ''}>
        </label>
        <span class="move-list-step">${stepNum}</span>
        <span class="move-list-icon">\u21C4</span>
        <div class="move-list-detail">
          <span class="move-list-label">Swap</span>
          <span class="move-list-wine">${escapeHtml(shortenWineName(nameA))}</span>
          <span class="move-list-route">${escapeHtml(move.from)} \u2194 ${escapeHtml(move.to)}</span>
          <span class="move-list-wine-secondary">${escapeHtml(shortenWineName(nameB))}</span>
        </div>
      </li>
    `;
  }).join('');

  const moveHtml = directMoves.map(move => {
    stepNum++;
    const stepKey = getStepKey(move.from, move.to);
    const isDone = completedMoveSteps.has(stepKey);
    const name = move.wineName || `Wine #${move.wineId}`;
    return `
      <li class="move-list-item move-list-direct ${isDone ? 'move-list-item-done' : ''}" data-from="${escapeHtml(move.from)}" data-to="${escapeHtml(move.to)}" data-step-key="${escapeHtml(stepKey)}">
        <label class="move-list-check-wrap" aria-label="Mark step ${stepNum} done">
          <input type="checkbox" class="move-list-check" ${isDone ? 'checked' : ''}>
        </label>
        <span class="move-list-step">${stepNum}</span>
        <span class="move-list-icon">\u2192</span>
        <div class="move-list-detail">
          <span class="move-list-label">Move</span>
          <span class="move-list-wine">${escapeHtml(shortenWineName(name))}</span>
          <span class="move-list-route">${escapeHtml(move.from)} \u2192 ${escapeHtml(move.to)}</span>
        </div>
      </li>
    `;
  }).join('');

  const doneCount = completedMoveSteps.size;

  containerEl.innerHTML = `
    <details class="move-list-panel" open>
      <summary class="move-list-header">
        <span class="move-list-title">\uD83D\uDCCB Step-by-Step Move Guide</span>
        <span class="move-list-count">${doneCount}/${totalSteps} done</span>
      </summary>
      <p class="move-list-desc">Follow these steps in order to reorganise your cellar. Swaps are listed first.</p>
      <div class="move-list-actions">
        <button type="button" class="btn btn-secondary btn-small" data-action="mark-all-done">Mark all done</button>
        <button type="button" class="btn btn-secondary btn-small" data-action="clear-done">Clear checks</button>
      </div>
      <ol class="move-list">
        ${swapHtml}${moveHtml}
      </ol>
    </details>
  `;

  containerEl.querySelector('[data-action="mark-all-done"]')?.addEventListener('click', () => {
    containerEl.querySelectorAll('.move-list-item').forEach(item => {
      const key = item.dataset.stepKey;
      if (key) completedMoveSteps.add(key);
    });
    renderMoveList(containerEl, sortPlan, currentLayout);
  });

  containerEl.querySelector('[data-action="clear-done"]')?.addEventListener('click', () => {
    completedMoveSteps = new Set();
    renderMoveList(containerEl, sortPlan, currentLayout);
  });

  containerEl.querySelectorAll('.move-list-check').forEach(check => {
    check.addEventListener('change', (e) => {
      const item = e.target.closest('.move-list-item');
      const stepKey = item?.dataset.stepKey;
      if (!stepKey) return;
      if (e.target.checked) completedMoveSteps.add(stepKey);
      else completedMoveSteps.delete(stepKey);
      item.classList.toggle('move-list-item-done', e.target.checked);
      const countEl = containerEl.querySelector('.move-list-count');
      if (countEl) countEl.textContent = `${completedMoveSteps.size}/${totalSteps} done`;
    });
  });

  // Wire hover highlight: hovering a move-list item highlights source + target slots in the grid
  containerEl.querySelectorAll('.move-list-item').forEach(item => {
    item.addEventListener('mouseenter', () => {
      const from = item.dataset.from;
      const to = item.dataset.to;
      highlightSlotPair(from, to, true);
    });
    item.addEventListener('mouseleave', () => {
      const from = item.dataset.from;
      const to = item.dataset.to;
      highlightSlotPair(from, to, false);
    });
  });
}

function buildMoveListWineLookup(currentLayout) {
  const lookup = {};
  const proposal = getLayoutProposal();
  const target = proposal?.targetLayout || {};
  Object.values(target).forEach((w) => {
    if (w?.wineId && w?.wineName && !lookup[w.wineId]) {
      lookup[w.wineId] = w.wineName;
    }
  });
  Object.entries(currentLayout || {}).forEach(([, wineId]) => {
    if (!wineId || lookup[wineId]) return;
    lookup[wineId] = `Wine #${wineId}`;
  });
  return lookup;
}

/**
 * Highlight or unhighlight a source/target slot pair in the diff grid.
 * @param {string} fromSlotId
 * @param {string} toSlotId
 * @param {boolean} highlight - true to add, false to remove
 */
function highlightSlotPair(fromSlotId, toSlotId, highlight) {
  const fromEl = document.querySelector(`.diff-slot[data-location="${fromSlotId}"]`);
  const toEl = document.querySelector(`.diff-slot[data-location="${toSlotId}"]`);
  if (fromEl) fromEl.classList.toggle('diff-highlight-source', highlight);
  if (toEl) toEl.classList.toggle('diff-highlight-target', highlight);
}
