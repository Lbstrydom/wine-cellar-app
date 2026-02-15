/**
 * @fileoverview AI Recommendations view layer.
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
  if (statusEl) statusEl.textContent = 'AI recommendations in progress (may take up to 2 minutes)...';

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

  let html = '<div class="ai-advice-structured">';

  // 1. Summary
  if (advice.summary) {
    html += `<div class="ai-summary"><h4>Summary</h4><p>${escapeHtml(advice.summary)}</p></div>`;
  }

  // 2. Layout Narrative
  if (advice.layoutNarrative) {
    html += `<div class="ai-narrative"><h4>Cellar Layout</h4><p>${escapeHtml(advice.layoutNarrative)}</p></div>`;
  }

  // 3. Zone Health
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

  // 4. Zone Adjustments
  if (advice.zoneAdjustments?.length > 0) {
    html += '<details class="ai-zone-adjustments" open>';
    html += `<summary><h4>Suggested Zone Changes <span class="ai-count-badge">${advice.zoneAdjustments.length}</span></h4></summary>`;
    html += '<ul>';
    advice.zoneAdjustments.forEach(adj => {
      html += `<li><strong>${escapeHtml(adj.zoneId)}</strong>: ${escapeHtml(adj.suggestion)}</li>`;
    });
    html += '</ul></details>';
  }

  // Sections 5-8: Only when needsZoneSetup is false (R1-7)
  if (!needsZoneSetup) {
    // 5. Confirmed Moves
    html += renderMoveSection(advice.confirmedMoves, SECTION_CONFIG.confirmed);

    // 6. Modified Moves
    html += renderMoveSection(advice.modifiedMoves, SECTION_CONFIG.modified);

    // 7. Rejected Moves
    html += renderMoveSection(advice.rejectedMoves, SECTION_CONFIG.rejected);

    // 8. Ambiguous Wines
    if (advice.ambiguousWines?.length > 0) {
      html += '<details class="ai-ambiguous-wines" open>';
      html += `<summary><h4>Needs Your Input <span class="ai-count-badge">${advice.ambiguousWines.length}</span></h4></summary>`;
      html += '<p class="ai-section-hint">These wines could belong to multiple zones. Choose the best fit.</p>';
      advice.ambiguousWines.forEach(w => {
        html += `<div class="move-item move-item--ai-ambiguous" data-wine-id="${w.wineId}">`;
        html += `<span class="ai-move-badge ai-move-badge--ambiguous">REVIEW</span>`;
        html += `<strong>${escapeHtml(w.name)}</strong>`;
        if (w.recommendation) html += `<p class="move-reason">${escapeHtml(w.recommendation)}</p>`;
        html += '<div class="ai-zone-choices">';
        (w.options || []).forEach(zone => {
          html += `<button class="btn btn-small btn-secondary ai-zone-choice-btn" data-wine-id="${w.wineId}" data-zone="${escapeHtml(zone)}" data-wine-name="${escapeHtml(w.name)}">${escapeHtml(zone)}</button>`;
        });
        html += '</div></div>';
      });
      html += '</details>';
    }
  }

  // 9. Fridge Plan (always rendered)
  if (advice.fridgePlan?.toAdd?.length > 0) {
    html += '<details class="ai-fridge-plan">';
    html += `<summary><h4>Fridge Recommendations <span class="ai-count-badge">${advice.fridgePlan.toAdd.length}</span></h4></summary>`;
    html += '<ul>';
    advice.fridgePlan.toAdd.forEach(item => {
      html += `<li><strong>${escapeHtml(item.category)}</strong>: ${escapeHtml(item.reason)}</li>`;
    });
    html += '</ul></details>';
  }

  // Bottom CTAs — only when needsZoneSetup is false (R1-7)
  if (!needsZoneSetup) {
    html += `<div class="ai-advice-cta">
      <button class="btn btn-primary" data-action="ai-reconfigure-zones">${escapeHtml(CTA_RECONFIGURE_ZONES)}</button>
      <button class="btn btn-secondary" data-action="ai-scroll-to-moves">Scroll to Moves</button>
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
    html += `<div class="move-item move-item--${config.cardVariant}" data-wine-id="${m.wineId}">`;
    html += `<span class="ai-move-badge ai-move-badge--${config.badgeVariant}">${config.badge}</span>`;
    html += `<strong>${escapeHtml(m.wineName)}</strong>`;
    if (m.from) html += ` <span class="move-from">${escapeHtml(m.from)}</span>`;
    if (m.to) html += ` &rarr; <span class="move-to">${escapeHtml(m.to)}</span>`;
    if (m.reason) html += `<p class="move-reason">${escapeHtml(m.reason)}</p>`;
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
