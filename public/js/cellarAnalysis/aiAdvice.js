/**
 * @fileoverview AI Cellar Review view layer.
 * Handles API call, spinner UI, HTML rendering for AI advice.
 * Action wiring is delegated to aiAdviceActions.js (controller).
 * @module cellarAnalysis/aiAdvice
 */

import { analyseCellarAI } from '../api.js';
import { escapeHtml } from '../utils.js';
import { getCurrentAnalysis, setAIMoveJudgments, switchWorkspace, notifyWorkspaceTab } from './state.js';
import { CTA_AI_RECOMMENDATIONS, CTA_RECONFIGURE_ZONES } from './labels.js';
import { wireAdviceActions } from './aiAdviceActions.js';
import { renderMoves } from './moves.js';
import { renderAIFridgeAnnotations } from './fridge.js';


/** In-flight guard — prevents duplicate concurrent AI runs. */
let _aiInFlight = false;

/**
 * Reset in-flight guard — enables clean state between test suites
 * in --no-isolate mode where the module is shared across all files.
 * @internal Test-only — prefixed with underscore to signal non-public API.
 * Must not be called from production code.
 */
export function _resetAiInFlight() { _aiInFlight = false; }

/**
 * Get AI advice for cellar organisation.
 * @param {Object} [options]
 * @param {boolean} [options.autoTriggered=false] - When true, suppresses scroll-to-advice
 *   so the current workspace focus (e.g. Placement after zone reconfig) is preserved.
 */
export async function handleGetAIAdvice({ autoTriggered = false } = {}) {
  if (_aiInFlight) return; // Prevent duplicate concurrent runs
  _aiInFlight = true;

  const btn = document.getElementById('get-ai-advice-btn');
  const adviceEl = document.getElementById('analysis-ai-advice');
  const statusEl = document.getElementById('ai-advice-status');
  if (!adviceEl) { _aiInFlight = false; return; }

  // Inline button spinner — no page jump
  if (btn) { btn.disabled = true; btn.dataset.originalText = btn.textContent; btn.textContent = 'Analysing\u2026'; }
  if (statusEl) statusEl.textContent = 'AI zone structure analysis in progress (may take up to 2 minutes)...';

  try {
    const result = await analyseCellarAI(true, { clean: true });
    const analysis = getCurrentAnalysis();
    const needsZoneSetup = analysis?.needsZoneSetup ?? false;

    // Enrich all move arrays with wine names (R2-1: schema lacks wineName)
    const enrichedAdvice = {
      ...result.aiAdvice,
      confirmedMoves: enrichMovesWithNames(result.aiAdvice?.confirmedMoves || []),
      modifiedMoves: enrichMovesWithNames(result.aiAdvice?.modifiedMoves || []),
      rejectedMoves: enrichMovesWithNames(result.aiAdvice?.rejectedMoves || []),
    };

    // Store AI move judgments in shared state so canonical move cards can show badges
    const judgments = buildMoveJudgments(enrichedAdvice);
    setAIMoveJudgments(judgments);

    // Zone-related AI content renders in Workspace A (#analysis-ai-advice)
    adviceEl.style.display = 'block';
    adviceEl.innerHTML = `<h3>${escapeHtml(CTA_AI_RECOMMENDATIONS)}</h3>
      <p class="section-desc">AI sommelier's recommendations for your cellar.</p>
      ${formatAIAdvice(enrichedAdvice, needsZoneSetup)}`;

    // Wire event listeners AFTER HTML is in DOM (CSP-compliant)
    wireAdviceActions(adviceEl, enrichedAdvice);

    // Re-render canonical moves with AI badges (Workspace B)
    const zonesGated = enrichedAdvice.zonesNeedReconfiguration === true && !needsZoneSetup;
    if (!zonesGated && !needsZoneSetup) {
      rerenderMovesWithBadges(analysis);
    }

    // Render fridge annotations inline (Workspace C)
    if (enrichedAdvice.fridgePlan?.toAdd?.length > 0) {
      renderAIFridgeAnnotations(enrichedAdvice.fridgePlan.toAdd);
    }

    // Notify workspace tabs that have new AI content (if user is elsewhere)
    notifyWorkspaceTab('zones');
    notifyWorkspaceTab('placement');
    if (enrichedAdvice.fridgePlan?.toAdd?.length > 0) {
      notifyWorkspaceTab('fridge');
    }

    // Only scroll to advice when manually triggered; auto-triggers preserve current focus
    if (!autoTriggered) {
      adviceEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    if (statusEl) statusEl.textContent = '';
  } catch (err) {
    adviceEl.style.display = 'block';
    adviceEl.innerHTML = `<div class="ai-advice-error">Error: ${escapeHtml(err.message)}</div>`;
    if (statusEl) statusEl.textContent = '';
  } finally {
    _aiInFlight = false;
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

    // Wine's physical position — original suggestedMoves is authoritative.
    // AI may return zone names instead of slot coordinates.
    const from = sg?.from || m.from || null;

    // Target slot — prefer AI's value (may be modified), fall back to original
    const to = m.to || sg?.to || null;

    // Zone display name for UI context (e.g. "SA Blends", "Shiraz")
    const toZone = m.toZone || sg?.toZone || null;

    return { ...m, wineName, from, to, toZone };
  });
}

/**
 * Build a Map of wineId -> judgment for annotating canonical move cards.
 * @param {Object} advice - Enriched AI advice
 * @returns {Map<number, Object>}
 */
function buildMoveJudgments(advice) {
  const map = new Map();
  for (const m of (advice.confirmedMoves || [])) {
    map.set(m.wineId, { judgment: 'confirmed', reason: m.reason, to: m.to, toZone: m.toZone });
  }
  for (const m of (advice.modifiedMoves || [])) {
    map.set(m.wineId, { judgment: 'modified', reason: m.reason, to: m.to, toZone: m.toZone });
  }
  for (const m of (advice.rejectedMoves || [])) {
    map.set(m.wineId, { judgment: 'rejected', reason: m.reason, to: m.to, toZone: m.toZone });
  }
  return map;
}

/**
 * Re-render canonical moves with AI badges.
 * @param {Object} analysis - Current analysis
 */
export function rerenderMovesWithBadges(analysis) {
  if (!analysis) return;
  renderMoves(
    analysis.suggestedMoves,
    analysis.needsZoneSetup,
    analysis.movesHaveSwaps
  );
}

/**
 * Format AI advice object into HTML.
 * Renders zone-related content only (summary, verdict, health, proposed changes,
 * zone gate, ambiguous wines). Move and fridge content is rendered as
 * annotations on their canonical workspace sections instead.
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
  const safeZoneAdjustments = (advice.zoneAdjustments || [])
    .map(adj => {
      if (!adj || typeof adj !== 'object') return null;
      const zoneId = typeof adj.zoneId === 'string' ? adj.zoneId.trim() : '';
      const suggestion = typeof adj.suggestion === 'string' ? adj.suggestion.trim() : '';
      if (!zoneId && !suggestion) return null;
      return {
        zoneId: zoneId || 'Zone',
        suggestion: suggestion || 'Review this zone configuration.'
      };
    })
    .filter(Boolean);
  const hasZoneHealthIssues = (advice.zoneHealth || []).some(z => {
    const status = String(z?.status || '').toLowerCase().trim();
    return status && !['healthy', 'good'].includes(status);
  });
  const verdictTextSignalsIssue = typeof advice.zoneVerdict === 'string' &&
    /\b(issue|problem|reconfig|contaminat|over\s*capacity|fragment|misplac|needs?\b)/i.test(advice.zoneVerdict);
  const verdictNeedsAttention =
    zonesNeedReconfig ||
    hasProposedChanges ||
    hasZoneHealthIssues ||
    verdictTextSignalsIssue;
  const normalizeZoneChangeType = (change) => {
    const raw = String(change?.changeType || '').toLowerCase().trim().replace(/[\s_]+/g, '_');
    const reason = String(change?.reason || '').toLowerCase();

    if (['remove', 'retire', 'delete', 'drop'].includes(raw)) return 'remove';
    if (['rename', 'relabel'].includes(raw)) return 'rename';
    if (['enlarge', 'expand', 'grow', 'increase_capacity'].includes(raw)) return 'enlarge';
    if (['merge', 'combine'].includes(raw)) return 'merge';
    if (['split', 'divide'].includes(raw)) return 'split';
    if (['add', 'create', 'new'].includes(raw)) return 'add';
    if (['adjust', 'move', 'reassign', 'reallocate'].includes(raw)) return 'adjust';

    if (/\b(remove|retire|delete|drop)\b/.test(reason)) return 'remove';
    if (/\b(rename|relabel)\b/.test(reason)) return 'rename';
    if (/\b(enlarge|expand|add row|capacity|more space)\b/.test(reason)) return 'enlarge';
    if (/\b(merge|combine)\b/.test(reason)) return 'merge';
    if (/\b(split|divide)\b/.test(reason)) return 'split';
    if (/\b(add|create|new zone)\b/.test(reason)) return 'add';
    return 'adjust';
  };
  const zoneChangeTypeLabel = {
    remove: 'Remove',
    rename: 'Rename',
    enlarge: 'Enlarge',
    merge: 'Merge',
    split: 'Split',
    add: 'Add',
    adjust: 'Adjust'
  };

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
    const verdictClass = verdictNeedsAttention ? 'ai-zone-verdict--reconfig' : 'ai-zone-verdict--good';
    const verdictIcon = verdictNeedsAttention ? '&#9888;' : '&#9989;';
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
      const changeType = normalizeZoneChangeType(change);
      html += `<div class="zone-change-item">
        <span class="zone-change-type-badge zone-change-type-badge--${escapeHtml(changeType)}">${escapeHtml(zoneChangeTypeLabel[changeType] || 'Adjust')}</span>
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
  if (!hasProposedChanges && safeZoneAdjustments.length > 0) {
    html += '<details class="ai-zone-adjustments" open>';
    html += `<summary><h4>Suggested Zone Changes <span class="ai-count-badge">${safeZoneAdjustments.length}</span></h4></summary>`;
    html += '<ul>';
    safeZoneAdjustments.forEach(adj => {
      html += `<li><strong>${escapeHtml(adj.zoneId)}</strong>: ${escapeHtml(adj.suggestion)}</li>`;
    });
    html += '</ul></details>';
  }

  // Zone gate: if zones need reconfiguration, show accept/reconfigure CTAs
  // and hide moves until user decides
  const showZoneGate = zonesNeedReconfig && !needsZoneSetup;
  if (showZoneGate) {
    html += `<div class="ai-zone-gate">
      <p class="ai-zone-gate-message">Review the proposed zone changes above, then accept or adjust the layout before proceeding to bottle placement.</p>
      <div class="ai-zone-gate-actions">
        <button class="btn btn-primary" data-action="ai-accept-zones">Accept Zones \u2014 Continue</button>
        <button class="btn btn-secondary" data-action="ai-reconfigure-zones">${escapeHtml(CTA_RECONFIGURE_ZONES)}</button>
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
    html += `<div class="ai-stage-nav"><button class="btn btn-primary" data-action="ai-show-moves">View Moves</button></div>`;
    html += '</div>';
  }

  // Move and fridge content are now rendered as annotations on their
  // canonical workspace sections (Workspace B and C respectively),
  // not as standalone sections here in Workspace A.

  // Bottom CTAs
  if (!needsZoneSetup && !showZoneGate && !(advice.ambiguousWines?.length > 0)) {
    html += `<div class="ai-advice-cta">
      <button class="btn btn-primary" data-action="ai-reconfigure-zones">${escapeHtml(CTA_RECONFIGURE_ZONES)}</button>
      <button class="btn btn-secondary" data-action="ai-view-moves">View Moves</button>
    </div>`;
  }

  html += '</div>';
  return html;
}

export { formatAIAdvice, enrichMovesWithNames };

