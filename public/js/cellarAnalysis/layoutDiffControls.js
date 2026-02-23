/**
 * @fileoverview Controls for the layout diff view: view toggle, summary stats,
 * approval CTAs (Apply All, Apply Selected, Reset, Cancel).
 *
 * Separated from grid rendering (SRP).
 * @module cellarAnalysis/layoutDiffControls
 */

import { escapeHtml } from '../utils.js';
import { DiffType } from './layoutDiffGrid.js';

/**
 * View mode enum.
 * @enum {string}
 */
export const ViewMode = {
  PROPOSED: 'proposed',
  CURRENT:  'current',
  CHANGES:  'changes'
};

/**
 * Render the view mode toggle (radio buttons).
 * @param {HTMLElement} containerEl - Container element
 * @param {Function} onToggle - Callback: (viewMode: string) => void
 */
export function renderViewToggle(containerEl, onToggle) {
  if (!containerEl) return;

  const modes = [
    { value: ViewMode.PROPOSED, label: 'Proposed', checked: true },
    { value: ViewMode.CURRENT,  label: 'Current',  checked: false },
    { value: ViewMode.CHANGES,  label: 'Changes Only', checked: false }
  ];

  const html = `
    <div class="diff-view-toggle" role="radiogroup" aria-label="View mode">
      ${modes.map(m => `
        <label class="diff-view-option${m.checked ? ' active' : ''}">
          <input type="radio" name="diff-view-mode" value="${m.value}"
                 ${m.checked ? 'checked' : ''} class="sr-only">
          <span>${escapeHtml(m.label)}</span>
        </label>
      `).join('')}
    </div>
  `;

  containerEl.innerHTML = html;

  // Wire radio change events
  containerEl.querySelectorAll('input[name="diff-view-mode"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      // Update active state
      containerEl.querySelectorAll('.diff-view-option').forEach(opt => {
        opt.classList.toggle('active', opt.querySelector('input').value === e.target.value);
      });
      if (typeof onToggle === 'function') {
        onToggle(e.target.value);
      }
    });
  });
}

/**
 * Apply a view mode to the diff grid container.
 * @param {string} containerId - Diff grid container ID
 * @param {string} viewMode - One of ViewMode values
 */
export function applyViewMode(containerId, viewMode) {
  const container = document.getElementById(containerId);
  if (!container) return;

  // Remove all view mode classes
  container.classList.remove('diff-view-proposed', 'diff-view-current', 'diff-view-changes');
  container.classList.add(`diff-view-${viewMode}`);
}

/**
 * Render the summary stats bar.
 * @param {HTMLElement} containerEl - Container element
 * @param {{ stay: number, moveIn: number, moveOut: number, swap: number, swapPairs: number, empty: number, unplaceable: number }} stats
 */
export function renderDiffSummary(containerEl, stats) {
  if (!containerEl) return;

  const items = [
    { icon: '\u2713', label: 'stay',    count: stats.stay,       cssClass: 'diff-stat-stay' },
    { icon: '\u2192', label: 'move',    count: stats.moveIn,     cssClass: 'diff-stat-move' },
    { icon: '\u21C4', label: 'swaps',   count: stats.swapPairs,  cssClass: 'diff-stat-swap' },
    { icon: '\u26A0', label: 'issue',   count: stats.unplaceable, cssClass: 'diff-stat-issue' },
    { icon: '\u25CB', label: 'empty',   count: stats.empty,      cssClass: 'diff-stat-empty' }
  ];

  const html = `
    <div class="diff-summary-bar">
      ${items.map(item => `
        <span class="diff-stat ${item.cssClass}">
          <span class="diff-stat-icon">${item.icon}</span>
          <span class="diff-stat-count">${item.count}</span>
          <span class="diff-stat-label">${item.label}</span>
        </span>
      `).join('<span class="diff-stat-sep">|</span>')}
    </div>
  `;

  containerEl.innerHTML = html;
}

/**
 * Render approval CTA buttons.
 * @param {HTMLElement} containerEl - Container element
 * @param {Object} options
 * @param {number} options.totalMoves - Total number of moves in the sort plan
 * @param {Function} options.onApplyAll - Handler for "Apply All Moves"
 * @param {Function} options.onReset - Handler for "Reset to Suggested"
 * @param {Function} options.onCancel - Handler for "Close"
 */
export function renderApprovalCTA(containerEl, { totalMoves, onApplyAll, onReset, onCancel }) {
  if (!containerEl) return;

  const html = `
    <div class="diff-approval-cta">
      <button class="btn btn-primary diff-apply-all-btn"
              ${totalMoves === 0 ? 'disabled' : ''}>
        Apply All Moves (${totalMoves})
      </button>
      <button class="btn btn-secondary diff-reset-btn">
        Reset to Suggested
      </button>
      <button class="btn btn-ghost diff-cancel-btn">
        Close
      </button>
    </div>
  `;

  containerEl.innerHTML = html;

  // Wire button handlers
  const applyBtn = containerEl.querySelector('.diff-apply-all-btn');
  const resetBtn = containerEl.querySelector('.diff-reset-btn');
  const cancelBtn = containerEl.querySelector('.diff-cancel-btn');

  if (applyBtn && typeof onApplyAll === 'function') {
    applyBtn.addEventListener('click', onApplyAll);
  }
  if (resetBtn && typeof onReset === 'function') {
    resetBtn.addEventListener('click', onReset);
  }
  if (cancelBtn && typeof onCancel === 'function') {
    cancelBtn.addEventListener('click', onCancel);
  }
}

/**
 * Update the "Apply All" button label with a new move count.
 * @param {HTMLElement} containerEl
 * @param {number} totalMoves
 */
export function updateApplyButtonCount(containerEl, totalMoves) {
  if (!containerEl) return;
  const btn = containerEl.querySelector('.diff-apply-all-btn');
  if (btn) {
    btn.textContent = `Apply All Moves (${totalMoves})`;
    btn.disabled = totalMoves === 0;
  }
}

/**
 * Show/hide the "Reset to Suggested" button based on whether user has overrides.
 * @param {HTMLElement} containerEl
 * @param {boolean} hasOverrides
 */
export function toggleResetButton(containerEl, hasOverrides) {
  if (!containerEl) return;
  const btn = containerEl.querySelector('.diff-reset-btn');
  if (btn) {
    btn.style.display = hasOverrides ? '' : 'none';
  }
}
