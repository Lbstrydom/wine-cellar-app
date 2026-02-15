/**
 * @fileoverview AI Zone Structure view layer.
 * Handles API call, spinner UI, HTML rendering for AI advice.
 * Action wiring is delegated to aiAdviceActions.js (controller).
 * @module cellarAnalysis/aiAdvice
 */

import { analyseCellarAI } from '../api.js';
import { escapeHtml } from '../utils.js';
import { getCurrentAnalysis } from './state.js';
import { CTA_AI_RECOMMENDATIONS, CTA_RECONFIGURE_ZONES } from './labels.js';
import { wireAdviceActions } from './aiAdviceActions.js';

/** Configuration for the 3 move section types — DRY rendering via renderMoveSection() */
const SECTION_CONFIG = {
  confirmed: {
    cssClass: 'ai-confirmed-moves',
    badge: 'CONFIRMED',
    badgeVariant: 'confirmed',
    cardVariant: 'ai-confirmed',
    hint: 'The AI agrees with these suggested moves.',
    showActions: true,
    defaultOpen: true,
  },
  modified: {
    cssClass: 'ai-modified-moves',
    badge: 'MODIFIED',
    badgeVariant: 'modified',
    cardVariant: 'ai-modified',
    hint: 'The AI suggests a different target for these moves.',
    showActions: true,
    defaultOpen: true,
  },
  rejected: {
    cssClass: 'ai-rejected-moves',
    badge: 'KEEP',
    badgeVariant: 'rejected',
    cardVariant: 'ai-rejected',
    hint: 'The AI recommends keeping these wines where they are.',
    showActions: false,
    defaultOpen: false,
  },
};

/**
 * Get AI advice for cellar organisation.
 */
export async function handleGetAIAdvice() {
  const btn = document.getElementById('get-ai-advice-btn');
  const adviceEl = document.getElementById('analysis-ai-advice');
  const statusEl = document.getElementById('ai-advice-status');
  if (!adviceEl) return;

  // Inline button spinner — no page jump
  if (btn) { btn.disabled = true; btn.dataset.originalText = btn.textContent; btn.textContent = 'Analysing\u2026'; }
  if (statusEl) statusEl.textContent = 'AI zone structure analysis in progress (may take up to 2 minutes)...';

  try {
    const result = await analyseCellarAI();
    const analysis = getCurrentAnalysis();
    const needsZoneSetup = analysis?.needsZoneSetup ?? false;

    // Enrich all move arrays with wine names (R2-1: schema lacks wineName)
    const enrichedAdvice = {
      ...result.aiAdvice,
      confirmedMoves: enrichMovesWithNames(result.aiAdvice?.confirmedMoves || []),
      modifiedMoves: enrichMovesWithNames(result.aiAdvice?.modifiedMoves || []),
      rejectedMoves: enrichMovesWithNames(result.aiAdvice?.rejectedMoves || []),
    };

    adviceEl.style.display = 'block';
    adviceEl.innerHTML = `<h3>${escapeHtml(CTA_AI_RECOMMENDATIONS)}</h3>
      <p class="section-desc">AI sommelier's recommendations for your cellar.</p>
      ${formatAIAdvice(enrichedAdvice, needsZoneSetup)}`;

    // Wire event listeners AFTER HTML is in DOM (CSP-compliant)
    wireAdviceActions(adviceEl, enrichedAdvice);

    adviceEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (statusEl) statusEl.textContent = '';
  } catch (err) {
    adviceEl.style.display = 'block';
    adviceEl.innerHTML = `<div class="ai-advice-error">Error: ${escapeHtml(err.message)}</div>`;
    if (statusEl) statusEl.textContent = '';
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = btn.dataset.originalText || CTA_AI_RECOMMENDATIONS; }
  }
}

/**
 * Enrich AI move objects with wine names and locations from analysis state.
 * @param {Array} moves - AI move objects (may lack wineName, from, to)
 * @returns {Array} Enriched move objects with wineName, from, to populated
 */
function enrichMovesWithNames(moves) {
  if (!moves?.length) return [];
  const analysis = getCurrentAnalysis();
  const misplaced = analysis?.misplacedWines || [];
  const suggested = analysis?.suggestedMoves || [];

  return moves.map(m => {
    // Name lookup: misplacedWines first, then suggestedMoves
    const mp = misplaced.find(w => w.wineId === m.wineId);
    const sg = suggested.find(s => s.wineId === m.wineId);
    const wineName = m.wineName || mp?.name || sg?.wineName || `Wine #${m.wineId}`;

    // For rejectedMoves (no from/to), try to fill from suggestedMoves
    const from = m.from || sg?.from || null;
    const to = m.to || sg?.to || null;

    return { ...m, wineName, from, to };
  });
}

/**
 * Format AI advice object into HTML.
 * Implements zone-first flow: if zones need reconfiguration, the user must
 * accept or reorganise zones before move sections are revealed.
 * @param {Object} advice - AI advice object (enriched)
 * @param {boolean} needsZoneSetup - Whether zones need setup
 * @returns {string} HTML formatted advice
 */
function formatAIAdvice(advice, needsZoneSetup = false) {
  if (!advice) return '<p>No advice available.</p>';

  // Legacy string mode — split on \n\n, escape each paragraph
  if (typeof advice === 'string') {
    const paragraphs = advice.split('\n\n').map(p => {
      return `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`;
    }).join('');
    return `<div class="ai-advice-content">${paragraphs}</div>`;
  }

  const zonesNeedReconfig = advice.zonesNeedReconfiguration === true;
  const hasProposedChanges = advice.proposedZoneChanges?.length > 0;

  let html = '<div class="ai-advice-structured">';

  // 1. Summary
  if (advice.summary) {
    html += `<div class="ai-summary"><h4>Summary</h4><p>${escapeHtml(advice.summary)}</p></div>`;
  }

  // 2. Layout Narrative
  if (advice.layoutNarrative) {
    html += `<div class="ai-narrative"><h4>Cellar Layout</h4><p>${escapeHtml(advice.layoutNarrative)}</p></div>`;
  }

  // 3. Zone Verdict — always shown when present
  if (advice.zoneVerdict) {
    const verdictClass = zonesNeedReconfig ? 'ai-zone-verdict--reconfig' : 'ai-zone-verdict--good';
    const verdictIcon = zonesNeedReconfig ? '⚠️' : '✅';
    html += `<div class="ai-zone-verdict ${verdictClass}">
      <h4>${verdictIcon} Zone Assessment</h4>
      <p>${escapeHtml(advice.zoneVerdict)}</p>
    </div>`;
  }

  // 4. Zone Health
  if (advice.zoneHealth?.length > 0) {
    html += '<details class="ai-zone-health" open>';
    html += `<summary><h4>Zone Health <span class="ai-count-badge">${advice.zoneHealth.length}</span></h4></summary>`;
    advice.zoneHealth.forEach(z => {
      let statusClass = 'bad';
      if (z.status === 'healthy') statusClass = 'good';
      else if (z.status === 'fragmented') statusClass = 'warning';
      html += `<div class="zone-health-item ${statusClass}">
        <span class="zone-name">${escapeHtml(z.zone)}</span>
        <span class="zone-status">${escapeHtml(z.status)}</span>
        <p class="zone-recommendation">${escapeHtml(z.recommendation)}</p>
      </div>`;
    });
    html += '</details>';
  }

  // ─── STAGE 1: Zone Structure ───────────────────────────────────────
  // 5. Proposed Zone Changes (zone-first gate)
  if (hasProposedChanges) {
    html += `<div class="ai-stage-header"><span class="ai-stage-number">1</span><h4>Zone Structure</h4></div>`;
    html += '<details class="ai-proposed-zone-changes" open>';
    html += `<summary><h4>Proposed Zone Changes <span class="ai-count-badge">${advice.proposedZoneChanges.length}</span></h4></summary>`;
    html += '<p class="ai-section-hint">The AI recommends updating these zones before moving bottles.</p>';
    advice.proposedZoneChanges.forEach(change => {
      html += `<div class="zone-change-item">
        <span class="zone-change-id">${escapeHtml(change.zoneId)}</span>`;
      if (change.currentLabel && change.proposedLabel) {
        html += ` <span class="zone-change-arrow">${escapeHtml(change.currentLabel)} &rarr; ${escapeHtml(change.proposedLabel)}</span>`;
      }
      html += `<p class="zone-change-reason">${escapeHtml(change.reason || '')}</p>
      </div>`;
    });
    html += '</details>';
  }

  // 5b. Zone Adjustments (legacy format — when no proposedZoneChanges)
  if (!hasProposedChanges && advice.zoneAdjustments?.length > 0) {
    html += '<details class="ai-zone-adjustments" open>';
    html += `<summary><h4>Suggested Zone Changes <span class="ai-count-badge">${advice.zoneAdjustments.length}</span></h4></summary>`;
    html += '<ul>';
    advice.zoneAdjustments.forEach(adj => {
      html += `<li><strong>${escapeHtml(adj.zoneId)}</strong>: ${escapeHtml(adj.suggestion)}</li>`;
    });
    html += '</ul></details>';
  }

  // Zone gate: if zones need reconfiguration, show accept/reconfigure CTAs
  // and hide moves until user decides
  const showZoneGate = zonesNeedReconfig && !needsZoneSetup;
  if (showZoneGate) {
    html += `<div class="ai-zone-gate">
      <p class="ai-zone-gate-message">Review the proposed zone changes above, then accept or reorganise before proceeding.</p>
      <div class="ai-zone-gate-actions">
        <button class="btn btn-primary" data-action="ai-accept-zones">Accept Zones \u2014 Continue</button>
        <button class="btn btn-secondary" data-action="ai-reconfigure-zones">Reorganise Instead</button>
      </div>
    </div>`;
  }

  // ─── STAGE 2: Needs Your Input (ambiguous wines) ─────────────────
  // Gated behind zone acceptance when zonesNeedReconfiguration
  const inputHiddenClass = showZoneGate ? ' style="display:none"' : '';

  if (!needsZoneSetup && advice.ambiguousWines?.length > 0) {
    html += `<div class="ai-input-container" id="ai-input-gated"${inputHiddenClass}>`;
    html += `<div class="ai-stage-header"><span class="ai-stage-number">2</span><h4>Needs Your Input</h4></div>`;
    html += '<p class="ai-section-hint">These wines could belong to multiple zones. Choose the best fit.</p>';
    advice.ambiguousWines.forEach(w => {
      html += `<div class="ai-input-card" data-wine-id="${w.wineId}">`;
      html += `<div class="ai-input-card-body">`;
      html += `<span class="ai-move-badge ai-move-badge--ambiguous">REVIEW</span>`;
      html += `<strong class="ai-input-wine-name">${escapeHtml(w.name)}</strong>`;
      if (w.recommendation) html += `<p class="ai-input-recommendation">${escapeHtml(w.recommendation)}</p>`;
      html += '</div>';
      html += '<div class="ai-zone-choices">';
      (w.options || []).forEach(zone => {
        html += `<button class="btn btn-small btn-secondary ai-zone-choice-btn" data-wine-id="${w.wineId}" data-zone="${escapeHtml(zone)}" data-wine-name="${escapeHtml(w.name)}">${escapeHtml(zone)}</button>`;
      });
      html += '</div></div>';
    });
    html += `<div class="ai-stage-nav"><button class="btn btn-primary" data-action="ai-show-moves">Continue to Moves</button></div>`;
    html += '</div>';
  }

  // ─── STAGE 3: Tactical Moves ───────────────────────────────────────
  // Gated: hidden until zones accepted (and optionally user input done)
  const movesHiddenClass = (showZoneGate || (advice.ambiguousWines?.length > 0)) ? ' style="display:none"' : '';

  if (!needsZoneSetup) {
    html += `<div class="ai-moves-container" id="ai-moves-gated"${movesHiddenClass}>`;
    html += `<div class="ai-stage-header"><span class="ai-stage-number">3</span><h4>Tactical Moves</h4></div>`;
    html += '<p class="ai-section-hint">Confirmed and adjusted bottle moves based on the zone structure above.</p>';

    // 6. Confirmed Moves
    html += renderMoveSection(advice.confirmedMoves, SECTION_CONFIG.confirmed);

    // 7. Modified Moves
    html += renderMoveSection(advice.modifiedMoves, SECTION_CONFIG.modified);

    // 8. Rejected Moves
    html += renderMoveSection(advice.rejectedMoves, SECTION_CONFIG.rejected);

    html += '</div>'; // close ai-moves-container
  }

  // 10. Fridge Plan (always rendered)
  if (advice.fridgePlan?.toAdd?.length > 0) {
    html += '<details class="ai-fridge-plan">';
    html += `<summary><h4>Fridge Recommendations <span class="ai-count-badge">${advice.fridgePlan.toAdd.length}</span></h4></summary>`;
    html += '<ul>';
    advice.fridgePlan.toAdd.forEach(item => {
      html += `<li><strong>${escapeHtml(item.category)}</strong>: ${escapeHtml(item.reason)}</li>`;
    });
    html += '</ul></details>';
  }

  // Bottom CTAs — only when all stages are visible (not gated) and not needsZoneSetup
  if (!needsZoneSetup && !showZoneGate && !(advice.ambiguousWines?.length > 0)) {
    html += `<div class="ai-advice-cta">
      <button class="btn btn-primary" data-action="ai-reconfigure-zones">${escapeHtml(CTA_RECONFIGURE_ZONES)}</button>
      <button class="btn btn-secondary" data-action="ai-scroll-to-moves">Scroll to Suggested Moves</button>
    </div>`;
  }

  html += '</div>';
  return html;
}

/**
 * Render a move section using SECTION_CONFIG. Returns HTML string.
 * @param {Array} moves - Enriched move objects
 * @param {Object} config - Entry from SECTION_CONFIG
 * @returns {string} HTML string (empty string if no moves)
 */
function renderMoveSection(moves, config) {
  if (!moves?.length) return '';
  const openAttr = config.defaultOpen ? ' open' : '';
  let html = `<details class="${config.cssClass}"${openAttr}>`;
  html += `<summary><h4>${config.badge} <span class="ai-count-badge">${moves.length}</span></h4></summary>`;
  html += `<p class="ai-section-hint">${config.hint}</p>`;

  moves.forEach(m => {
    const hasLocation = m.from || m.to;
    html += `<div class="move-item move-item--${config.cardVariant}" data-wine-id="${m.wineId}">`;
    html += '<div class="move-details">';
    html += `<div class="move-header"><span class="ai-move-badge ai-move-badge--${config.badgeVariant}">${config.badge}</span></div>`;
    html += `<div class="move-wine-name">${escapeHtml(m.wineName)}</div>`;
    if (hasLocation) {
      html += '<div class="move-path">';
      html += `<span class="from">${escapeHtml(m.from || '?')}</span>`;
      html += '<span class="arrow">→</span>';
      html += `<span class="to">${escapeHtml(m.to || '?')}</span>`;
      html += '</div>';
    }
    if (m.reason) html += `<div class="move-reason">${escapeHtml(m.reason)}</div>`;
    html += '</div>'; // close move-details
    if (config.showActions) {
      html += '<div class="move-actions">';
      html += `<button class="btn btn-small btn-primary ai-move-execute-btn" data-wine-id="${m.wineId}" data-from="${escapeHtml(m.from || '')}" data-to="${escapeHtml(m.to || '')}">Move</button>`;
      html += '<button class="btn btn-small btn-secondary ai-move-dismiss-btn">Dismiss</button>';
      html += '</div>';
    }
    html += '</div>';
  });

  html += '</details>';
  return html;
}

export { formatAIAdvice, enrichMovesWithNames };
