/**
 * @fileoverview Zone consolidation cards for the Cellar Placement workspace.
 * Renders consolidation opportunities from the bottles-first scan (Phase B4):
 * wines that canonically belong to a zone but are physically scattered in
 * other zones' rows.
 * @module cellarAnalysis/consolidation
 */

import { escapeHtml } from '../utils.js';
import { getCurrentAnalysis } from './state.js';
import { openMoveGuide } from './moveGuide.js';

/**
 * Render consolidation opportunity cards.
 * Each card shows a zone with scattered wines and their physical locations.
 *
 * @param {Object} analysis - Full analysis report
 */
export function renderConsolidationCards(analysis) {
  const el = document.getElementById('zone-consolidation');
  if (!el) return;

  const opportunities = analysis?.bottleScan?.consolidationOpportunities;
  if (!Array.isArray(opportunities) || opportunities.length === 0) {
    el.innerHTML = '';
    el.style.display = 'none';
    return;
  }

  const totalScattered = opportunities.reduce((sum, o) => sum + o.scattered.length, 0);

  // Check if there are actionable moves to offer the Visual Guide
  const suggestedMoves = analysis?.suggestedMoves || [];
  const hasActionableMoves = suggestedMoves.some(m => m.type === 'move');

  let html = `
    <div class="consolidation-section">
      <div class="consolidation-header">
        <div>
          <h3>Zone Consolidation</h3>
          <p class="section-desc">${totalScattered} bottle(s) are in non-ideal zones (spread across ${opportunities.length} zone${opportunities.length !== 1 ? 's' : ''}).</p>
        </div>
        ${hasActionableMoves ? '<button class="btn btn-secondary btn-small consolidation-guide-btn">Visual Guide</button>' : ''}
      </div>
      <div class="consolidation-cards">
  `;

  for (const opp of opportunities) {
    const scatteredCount = opp.scattered.length;
    // Group scattered wines by physical row zone for readable summary
    const byPhysicalZone = new Map();
    for (const w of opp.scattered) {
      const key = w.physicalRowZone || 'unallocated';
      if (!byPhysicalZone.has(key)) byPhysicalZone.set(key, []);
      byPhysicalZone.get(key).push(w);
    }

    const summaryParts = [];
    for (const [zone, wines] of byPhysicalZone) {
      summaryParts.push(`${wines.length} in ${zone}`);
    }

    html += `
      <div class="consolidation-card" data-zone-id="${escapeHtml(opp.zoneId)}">
        <div class="consolidation-card-header">
          <span class="consolidation-zone-name">${escapeHtml(opp.displayName)}</span>
          <span class="consolidation-count">${scatteredCount} scattered</span>
        </div>
        <div class="consolidation-card-body">
          <p class="consolidation-summary">${escapeHtml(summaryParts.join(', '))}</p>
          <div class="consolidation-wine-list">
    `;

    // Show up to 5 scattered wines, then a summary for the rest
    const maxShow = 5;
    const wineSlice = opp.scattered.slice(0, maxShow);
    for (const w of wineSlice) {
      html += `
            <div class="consolidation-wine-item">
              <span class="consolidation-wine-name">${escapeHtml(w.wineName)}</span>
              <span class="consolidation-wine-location">${escapeHtml(w.currentSlot)} (${escapeHtml(w.physicalRowZone)})</span>
            </div>
      `;
    }
    if (scatteredCount > maxShow) {
      html += `<div class="consolidation-wine-overflow">+${scatteredCount - maxShow} more</div>`;
    }

    html += `
          </div>
        </div>
        <div class="consolidation-card-actions">
          <button class="btn btn-primary btn-small consolidation-view-moves-btn"
                  data-zone-id="${escapeHtml(opp.zoneId)}"
                  title="View move suggestions for these wines">View Moves</button>
        </div>
      </div>
    `;
  }

  html += '</div></div>';
  el.innerHTML = html;
  el.style.display = 'block';

  // Wire "View Moves" buttons — scroll to layout diff if visible, else Suggested Moves
  el.querySelectorAll('.consolidation-view-moves-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      // Prefer the unified layout diff container (Phase 4-7)
      const diffEl = document.getElementById('layout-diff-container');
      if (diffEl && diffEl.style.display !== 'none') {
        diffEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      // Try the proposal CTA (diff view not yet opened)
      const ctaEl = document.getElementById('layout-proposal-cta');
      if (ctaEl && ctaEl.style.display !== 'none') {
        ctaEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      // Fallback: legacy Suggested Moves section
      const movesEl = document.getElementById('analysis-moves');
      if (movesEl) {
        movesEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

  // Wire "Visual Guide" button — launch move guide with all suggested moves
  const guideBtn = el.querySelector('.consolidation-guide-btn');
  if (guideBtn) {
    guideBtn.addEventListener('click', () => {
      const currentAnalysis = getCurrentAnalysis();
      const moves = currentAnalysis?.suggestedMoves;
      if (moves?.length) {
        openMoveGuide(moves);
      }
    });
  }
}
