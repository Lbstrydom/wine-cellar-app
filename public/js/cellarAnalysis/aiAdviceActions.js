/**
 * @fileoverview Action handlers for AI Cellar Review section.
 * Wires event listeners and handles move execution, zone reassignment,
 * and navigation actions. Separated from aiAdvice.js (view) for SRP.
 * @module cellarAnalysis/aiAdviceActions
 */

import { reassignWineZone } from '../api.js';
import { showToast } from '../utils.js';
import { openReconfigurationModal } from './zoneReconfigurationModal.js';
import { getCurrentAnalysis, switchWorkspace } from './state.js';
import { getOnRenderAnalysis } from './analysis.js';
import { rerenderMovesWithBadges } from './aiAdvice.js';

/**
 * Wire all event listeners for AI advice actions.
 * Called after HTML is rendered (CSP-compliant — no inline handlers).
 * @param {HTMLElement} container - The AI advice container element
 * @param {Object} advice - The enriched AI advice object
 */
function wireAdviceActions(container, advice) {
  // Accept Zones CTA — reveals Stage 2 (user input) or Stage 3 (moves)
  container.querySelector('[data-action="ai-accept-zones"]')?.addEventListener('click', () => {
    handleAcceptZones(container);
  });

  // "Continue to Moves" CTA — reveals Stage 3 (moves) from Stage 2
  container.querySelector('[data-action="ai-show-moves"]')?.addEventListener('click', () => {
    handleShowMoves(container);
  });

  // Reorganise Zones CTA (multiple possible — use querySelectorAll)
  container.querySelectorAll('[data-action="ai-reconfigure-zones"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const callback = getOnRenderAnalysis();
      openReconfigurationModal({ onRenderAnalysis: callback });
    });
  });

  // "View Moves" CTA — switch to placement workspace and scroll
  container.querySelectorAll('[data-action="ai-view-moves"]').forEach(btn => {
    btn.addEventListener('click', () => {
      switchWorkspace('placement');
      const panel = document.getElementById('workspace-placement');
      if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  // Zone choice buttons (ambiguous wines)
  container.querySelectorAll('.ai-zone-choice-btn').forEach(btn => {
    btn.addEventListener('click', () => handleZoneChoice(btn, container));
  });
}

/**
 * Handle "Accept Zones" — reveal Stage 2 (Needs Your Input) if present,
 * otherwise skip to Stage 3 (Tactical Moves).
 * @param {HTMLElement} container - The AI advice container
 */
function handleAcceptZones(container) {
  // Hide the zone gate
  const gate = container.querySelector('.ai-zone-gate');
  if (gate) gate.style.display = 'none';

  // Re-render canonical moves with AI badges (were hidden behind gate)
  const analysis = getCurrentAnalysis();
  rerenderMovesWithBadges(analysis);

  // Stage 2: reveal user input section if present
  const inputContainer = container.querySelector('#ai-input-gated');
  if (inputContainer) {
    inputContainer.style.display = '';
    inputContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return; // Don't show moves yet — user must complete input or click "Continue"
  }

  // No Stage 2 — switch to placement workspace and scroll
  switchWorkspace('placement');
  const panel = document.getElementById('workspace-placement');
  if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * Handle "Continue to Moves" / "View Moves" — switch to placement workspace.
 * Moves are already rendered as canonical cards in Workspace B with AI badges.
 */
function handleShowMoves() {
  switchWorkspace('placement');
  const panel = document.getElementById('workspace-placement');
  if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}


/**
 * Handle zone choice for an ambiguous wine.
 * Persists zone assignment via API, removes card on success.
 * Auto-advances to Stage 3 when all ambiguous wines are resolved.
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

    // Remove card from input section
    const card = btn.closest('.ai-input-card');
    if (card) card.remove();

    // Check if all ambiguous wines are resolved
    const inputContainer = container.querySelector('#ai-input-gated');
    const remaining = inputContainer?.querySelectorAll('.ai-input-card')?.length ?? 0;
    if (remaining === 0) {
      // All resolved — auto-advance to Stage 3
      handleShowMoves(container);
    }
  } catch (err) {
    // R2-9: error handling matching zoneChat.js:184 pattern
    showToast(`Error: ${err.message}`);
  } finally {
    btn.disabled = false;
  }
}

export { wireAdviceActions };
