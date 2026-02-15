/**
 * @fileoverview Action handlers for AI Recommendations section.
 * Wires event listeners and handles move execution, zone reassignment,
 * and navigation actions. Separated from aiAdvice.js (view) for SRP.
 * @module cellarAnalysis/aiAdviceActions
 */

import { executeCellarMoves, reassignWineZone } from '../api.js';
import { showToast } from '../utils.js';
import { openReconfigurationModal } from './zoneReconfigurationModal.js';
import { getCurrentAnalysis } from './state.js';
import { getOnRenderAnalysis } from './analysis.js';
import { renderMoves } from './moves.js';
import { refreshLayout } from '../app.js';

/**
 * Wire all event listeners for AI advice actions.
 * Called after HTML is rendered (CSP-compliant — no inline handlers).
 * @param {HTMLElement} container - The AI advice container element
 * @param {Object} advice - The enriched AI advice object
 */
function wireAdviceActions(container, advice) {
  // Reconfigure Zones CTA
  container.querySelector('[data-action="ai-reconfigure-zones"]')?.addEventListener('click', () => {
    const callback = getOnRenderAnalysis();
    openReconfigurationModal({ onRenderAnalysis: callback });
  });

  // Scroll to Moves CTA
  container.querySelector('[data-action="ai-scroll-to-moves"]')?.addEventListener('click', () => {
    document.getElementById('analysis-moves')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  // Move execute buttons
  container.querySelectorAll('.ai-move-execute-btn').forEach(btn => {
    btn.addEventListener('click', () => handleAIMoveExecute(btn, container));
  });

  // Move dismiss buttons
  container.querySelectorAll('.ai-move-dismiss-btn').forEach(btn => {
    btn.addEventListener('click', () => handleDismiss(btn, container));
  });

  // Zone choice buttons (ambiguous wines)
  container.querySelectorAll('.ai-zone-choice-btn').forEach(btn => {
    btn.addEventListener('click', () => handleZoneChoice(btn, container));
  });
}

/**
 * Update count badge after card removal. Hide section if count reaches 0.
 * @param {HTMLElement} container - The AI advice container
 * @param {HTMLElement} detailsEl - The <details> element containing the card
 */
function updateSectionCount(container, detailsEl) {
  if (!detailsEl) return;
  const remaining = detailsEl.querySelectorAll('.move-item').length;
  const badge = detailsEl.querySelector('.ai-count-badge');
  if (badge) badge.textContent = remaining;
  if (remaining === 0) detailsEl.style.display = 'none';
}

/**
 * Flash-highlight the Suggested Moves section to signal it was updated.
 * Called after an AI move is executed and suggestedMoves is re-rendered.
 */
function flashSuggestedMoves() {
  const movesSection = document.getElementById('analysis-moves');
  if (!movesSection) return;
  movesSection.classList.add('flash-highlight');
  movesSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  setTimeout(() => movesSection.classList.remove('flash-highlight'), 1500);
}

/**
 * Execute an AI-confirmed or AI-modified move.
 * After success: remove card, sync suggestedMoves state, re-render, refresh grid.
 * @param {HTMLElement} btn - The clicked "Move" button
 * @param {HTMLElement} container - The AI advice container
 */
async function handleAIMoveExecute(btn, container) {
  const card = btn.closest('.move-item');
  const wineId = Number(btn.dataset.wineId);
  const from = btn.dataset.from;
  const to = btn.dataset.to;

  btn.disabled = true;
  try {
    const result = await executeCellarMoves([{ wineId, from, to }]);
    if (result?.success === false) {
      showToast(`Move failed: ${result.error || 'validation error'}`);
      return;
    }

    showToast('Move executed');

    // 1. Remove card from AI section
    const detailsEl = card?.closest('details');
    if (card) card.remove();
    updateSectionCount(container, detailsEl);

    // 2. Sync Suggested Moves state (R1-1)
    // Match on wineId + from only (R2-2: intentional — for modifiedMoves,
    // the AI changed the 'to' field, so the original suggestedMoves entry
    // has a different 'to'. We match on wineId + from because those identify
    // the wine's current position, which is what matters for deduplication.)
    const analysis = getCurrentAnalysis();
    if (analysis?.suggestedMoves) {
      const idx = analysis.suggestedMoves.findIndex(
        m => m.wineId === wineId && m.from === from
      );
      if (idx !== -1) analysis.suggestedMoves.splice(idx, 1);

      // Recalculate swap flags (mirrors moves.js:294-297 pattern)
      const sources = new Set(analysis.suggestedMoves.filter(m => m.type === 'move').map(m => m.from));
      const targets = new Set(analysis.suggestedMoves.filter(m => m.type === 'move').map(m => m.to));
      analysis.movesHaveSwaps = [...sources].some(s => targets.has(s));

      // 3. Re-render Suggested Moves section
      renderMoves(analysis.suggestedMoves, false, analysis.movesHaveSwaps);
    }

    // 4. Refresh grid layout
    refreshLayout();

    // 5. Flash-highlight Suggested Moves section (R2-6: visual sync cue)
    flashSuggestedMoves();
  } catch (err) {
    showToast(`Error: ${err.message}`);
  } finally {
    btn.disabled = false;
  }
}

/**
 * Handle zone choice for an ambiguous wine.
 * Persists zone assignment via API, removes card on success.
 * @param {HTMLElement} btn - The clicked zone choice button
 * @param {HTMLElement} container - The AI advice container
 */
async function handleZoneChoice(btn, container) {
  const wineId = Number(btn.dataset.wineId);
  const zone = btn.dataset.zone;
  const wineName = btn.dataset.wineName || `Wine #${wineId}`;

  btn.disabled = true;
  try {
    // Persist zone assignment via existing API (R1-3: real action)
    await reassignWineZone(wineId, zone, 'AI recommendation');
    showToast(`Assigned ${wineName} to ${zone}`);

    // Remove card from AI section
    const card = btn.closest('.move-item');
    const detailsEl = card?.closest('details');
    if (card) card.remove();
    updateSectionCount(container, detailsEl);
  } catch (err) {
    // R2-9: error handling matching zoneChat.js:184 pattern
    showToast(`Error: ${err.message}`);
  } finally {
    btn.disabled = false;
  }
}

/**
 * Dismiss a move card from the AI section (no API call).
 * @param {HTMLElement} btn - The clicked "Dismiss" button
 * @param {HTMLElement} container - The AI advice container
 */
function handleDismiss(btn, container) {
  const card = btn.closest('.move-item');
  const detailsEl = card?.closest('details');
  if (card) card.remove();
  updateSectionCount(container, detailsEl);
}

export { wireAdviceActions };
