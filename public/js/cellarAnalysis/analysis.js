/**
 * @fileoverview Main analysis loading and rendering.
 * @module cellarAnalysis/analysis
 */

import { analyseCellar } from '../api.js';
import { setCurrentAnalysis, setAnalysisLoaded, getCurrentAnalysis, switchWorkspace } from './state.js';
import { renderMoves, renderCompactionMoves, renderRowAllocationInfo } from './moves.js';
import { renderFridgeStatus } from './fridge.js';
import { renderZoneNarratives } from './zones.js';
import { renderZoneCapacityAlert } from './zoneCapacityAlert.js';
import { renderZoneReconfigurationBanner } from './zoneReconfigurationBanner.js';
import { renderIssueDigest, setDigestCallback } from './issueDigest.js';
import { deriveState, AnalysisState } from './analysisState.js';
import { startZoneSetup } from './zones.js';
import { openReconfigurationModal } from './zoneReconfigurationModal.js';
import { openMoveGuide } from './moveGuide.js';
import { CTA_RECONFIGURE_ZONES, CTA_SETUP_ZONES, CTA_GUIDE_MOVES } from './labels.js';
import { escapeHtml, showToast } from '../utils.js';
import { renderGrapeHealthBanner } from './grapeHealth.js';
import { renderConsolidationCards } from './consolidation.js';
import { renderLayoutProposalCTA } from './layoutDiffOrchestrator.js';

let _onRenderAnalysis = null;

/**
 * Get the current render-analysis callback.
 * Called by aiAdviceActions.js at action time — always returns fresh callback.
 * @returns {Function|null} Current render-analysis callback
 */
export function getOnRenderAnalysis() {
  return _onRenderAnalysis;
}

/**
 * Load analysis when tab is opened.
 * Called by app.js when switching to analysis tab.
 * @param {boolean} [forceRefresh=false] - Force fresh analysis ignoring cache
 */
export async function loadAnalysis(forceRefresh = false, options = {}) {
  const summaryEl = document.getElementById('analysis-summary');
  const alertsEl = document.getElementById('analysis-alerts');
  const movesListEl = document.getElementById('moves-list');
  const movesActionsEl = document.getElementById('moves-actions');
  const cacheStatusEl = document.getElementById('analysis-cache-status');

  // Show appropriate loading message based on whether we're forcing refresh
  const loadingMessage = forceRefresh
    ? 'Analysing cellar organisation...'
    : 'Loading cellar analysis...';
  summaryEl.innerHTML = `<div class="analysis-loading">${loadingMessage}</div>`;
  alertsEl.innerHTML = '';
  movesListEl.innerHTML = '';
  movesActionsEl.style.display = 'none';
  if (cacheStatusEl) cacheStatusEl.textContent = '';

  // Pre-check offline state
  if (!navigator.onLine) {
    const cachedAnalysis = getCurrentAnalysis();
    if (cachedAnalysis) {
      const onRenderAnalysis = (report) => {
        setCurrentAnalysis(report);
        renderAnalysis(report, onRenderAnalysis);
      };
      renderAnalysis(cachedAnalysis, onRenderAnalysis);
      if (cacheStatusEl) cacheStatusEl.textContent = 'Offline — showing cached analysis';
      return;
    }
    renderOfflineState(summaryEl);
    return;
  }

  try {
    const response = await analyseCellar(forceRefresh, options);
    setCurrentAnalysis(response.report);
    setAnalysisLoaded(true);

    const onRenderAnalysis = (report) => {
      setCurrentAnalysis(report);
      renderAnalysis(report, onRenderAnalysis);
    };

    renderAnalysis(response.report, onRenderAnalysis);

    // Show cache status
    if (cacheStatusEl) {
      if (response.fromCache && response.cachedAt) {
        const cacheDate = new Date(response.cachedAt);
        const now = new Date();
        const diffMs = now - cacheDate;
        const diffMins = Math.round(diffMs / 60000);
        const timeAgo = diffMins < 1 ? 'just now' :
          diffMins < 60 ? `${diffMins}m ago` :
          `${Math.round(diffMins / 60)}h ago`;
        cacheStatusEl.textContent = `Cached ${timeAgo}`;
        cacheStatusEl.title = `Analysis cached at ${cacheDate.toLocaleTimeString()}. Click refresh to update.`;
      } else {
        cacheStatusEl.textContent = 'Fresh analysis';
      }
    }
  } catch (err) {
    // Detect offline/network errors — fall back to cached analysis if available
    const isOffline = !navigator.onLine ||
      err.message === 'Offline' ||
      err.message?.includes('fetch') ||
      err.message?.includes('network') ||
      err.name === 'TypeError';

    if (isOffline) {
      const cachedAnalysis = getCurrentAnalysis();
      if (cachedAnalysis) {
        const onRenderAnalysis = (report) => {
          setCurrentAnalysis(report);
          renderAnalysis(report, onRenderAnalysis);
        };
        renderAnalysis(cachedAnalysis, onRenderAnalysis);
        if (cacheStatusEl) cacheStatusEl.textContent = 'Offline — showing cached analysis';
        return;
      }
      renderOfflineState(summaryEl);
    } else {
      summaryEl.innerHTML = `<div class="analysis-loading">Error: ${err.message}</div>`;
    }
  }
}

/**
 * Render offline state — clear stale sections and show friendly banner.
 * @param {HTMLElement} summaryEl - Summary element to show banner in
 */
function renderOfflineState(summaryEl) {
  summaryEl.innerHTML = `
    <div class="analysis-offline-banner">
      You're offline. Connect to the internet to load cellar analysis.
    </div>
  `;
  // Clear all analysis subsections to avoid stale data
  const sectionIds = [
    'analysis-alerts', 'zone-cards-grid', 'moves-list',
    'fridge-status-content', 'analysis-ai-advice', 'zone-consolidation'
  ];
  for (const id of sectionIds) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '';
  }
  const movesActions = document.getElementById('moves-actions');
  if (movesActions) movesActions.style.display = 'none';
  const fridgeEl = document.getElementById('analysis-fridge');
  if (fridgeEl) fridgeEl.style.display = 'none';
  const zonesEl = document.getElementById('analysis-zones');
  if (zonesEl) zonesEl.style.display = 'none';
  const aiAdviceEl = document.getElementById('analysis-ai-advice');
  if (aiAdviceEl) aiAdviceEl.style.display = 'none';
  const wizardEl = document.getElementById('zone-setup-wizard');
  if (wizardEl) wizardEl.style.display = 'none';
}

/**
 * Force refresh analysis (ignore cache).
 */
export async function refreshAnalysis() {
  return loadAnalysis(true);
}

/**
 * Render actionable zone issue alerts inside the Cellar Review workspace.
 * Surfaces capacity alerts and color adjacency violations so the Cellar Review
 * tab has actionable content — not just the read-only Zone Overview.
 * @param {Object} analysis - Analysis report
 * @param {Function} onRenderAnalysis - Re-render callback
 */
function renderZoneIssueActions(analysis, onRenderAnalysis) {
  const el = document.getElementById('zone-issue-actions');
  if (!el) return;

  el.innerHTML = '';

  const alerts = Array.isArray(analysis?.alerts) ? analysis.alerts : [];
  const capacityAlerts = alerts.filter(a => a.type === 'zone_capacity_issue');
  const adjacencyAlerts = alerts.filter(a => a.type === 'color_adjacency_violation');
  const colourOrderAlerts = alerts.filter(a => a.type === 'colour_order_violation');

  if (capacityAlerts.length === 0 && adjacencyAlerts.length === 0 && colourOrderAlerts.length === 0) return;

  // ── Build ONE consolidated issue list ───────────────────
  const issueLines = [];

  if (capacityAlerts.length > 0) {
    const totalBottles = capacityAlerts.reduce((sum, a) => {
      const wines = a.data?.winesNeedingPlacement;
      return sum + (Array.isArray(wines) ? wines.length : 0);
    }, 0);
    const zoneNames = capacityAlerts
      .map(a => a.data?.overflowingZoneName || a.data?.overflowingZoneId || 'zone')
      .filter(Boolean);
    issueLines.push(`<strong>${capacityAlerts.length} zone${capacityAlerts.length > 1 ? 's' : ''}</strong> over capacity (${totalBottles} bottle${totalBottles !== 1 ? 's' : ''} affected: ${zoneNames.map(n => escapeHtml(n)).join(', ')})`);
  }

  if (adjacencyAlerts.length > 0) {
    issueLines.push(`<strong>${adjacencyAlerts.length}</strong> color boundary violation${adjacencyAlerts.length > 1 ? 's' : ''} — reds and whites should be in separate row regions`);
  }

  if (colourOrderAlerts.length > 0) {
    const issues = colourOrderAlerts.flatMap(a => a.data?.issues || []);
    const count = issues.length || colourOrderAlerts.length;
    issueLines.push(`<strong>${count}</strong> colour order violation${count > 1 ? 's' : ''} — zones in the wrong vertical region`);
  }

  // ── Render single consolidated banner ───────────────────
  const totalIssueCount = capacityAlerts.length + adjacencyAlerts.length + colourOrderAlerts.length;
  el.innerHTML = `
    <div class="zone-issues-consolidated">
      <div class="zone-issues-consolidated-header">
        ⚠️ Zone ${totalIssueCount === 1 ? 'Issue' : 'Issues'} Detected
      </div>
      <div class="zone-issues-consolidated-body">
        <ul class="zone-issues-consolidated-list">
          ${issueLines.map(line => `<li>${line}</li>`).join('')}
        </ul>
        <p class="zone-issues-consolidated-hint">
          Zone reconfiguration will reassign rows to fix these issues, then provide a
          move guide for your bottles.
        </p>
        <div class="zone-issues-consolidated-actions">
          <button class="btn btn-primary" data-action="fix-all-zones">Reorganise Zones</button>
          <button class="btn btn-secondary" data-action="ignore-zone-issues">Ignore &amp; Continue</button>
        </div>
      </div>
    </div>
  `;

  // Wire actions
  el.querySelector('[data-action="fix-all-zones"]')?.addEventListener('click', () => {
    openReconfigurationModal({ onRenderAnalysis });
  });

  el.querySelector('[data-action="ignore-zone-issues"]')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const response = await analyseCellar(true, { allowFallback: true });
      onRenderAnalysis(response.report);
      showToast('Using fallback placement — zone issues ignored for this run');
    } catch (err) {
      showToast(`Error: ${err.message}`);
    } finally {
      btn.disabled = false;
    }
  });
}

/**
 * Render analysis results.
 * @param {Object} analysis - Analysis report from API
 */
function renderAnalysis(analysis, onRenderAnalysis) {
  renderSummary(analysis.summary, analysis.needsZoneSetup);

  // Special cases: post-reconfig success banner and per-zone quick-fix view
  // use the existing renderers. Normal path uses the consolidated issue digest.
  if (analysis?.__justReconfigured || analysis?.__showQuickFixZones) {
    const bannerResult = renderZoneReconfigurationBanner(analysis, { onRenderAnalysis });
    if (bannerResult.rendered) {
      renderAlerts(bannerResult.remainingAlerts, { append: true });
    } else {
      const { remainingAlerts, rendered } = renderZoneCapacityAlert(analysis, { onRenderAnalysis });
      renderAlerts(remainingAlerts, { append: rendered });
    }
  } else {
    setDigestCallback(onRenderAnalysis, openReconfigurationModal);
    renderIssueDigest(analysis);
  }

  renderGrapeHealthBanner(analysis, { onRenderAnalysis });

  renderFridgeStatus(analysis.fridgeStatus);
  renderZoneNarratives(analysis.zoneNarratives);
  // Suppress capacity/colour alerts right after reconfiguration — the zone layout
  // just changed and bottles haven't moved yet. Showing "zone full" or "colour
  // violation" immediately after a reconfig is confusing; the Placement workspace
  // already shows the moves the user needs to execute.
  if (!analysis?.__justReconfigured) {
    renderZoneIssueActions(analysis, onRenderAnalysis);
  }
  renderConsolidationCards(analysis);
  renderLayoutProposalCTA(analysis);

  // Phase 3.1: Prefer sortPlan as the primary move list when available.
  // sortPlan comes from the optimal layout solver and is more precise than
  // the greedy suggestedMoves. Map to suggestedMoves format so all execution
  // code (executeMove, executeSwap, dismiss, recheckSwaps) remains unchanged.
  if (Array.isArray(analysis.layoutProposal?.sortPlan) && analysis.layoutProposal.sortPlan.length > 0) {
    analysis.suggestedMoves = analysis.layoutProposal.sortPlan.map(m => ({
      type: 'move',
      wineId: m.wineId,
      wineName: m.wineName,
      from: m.from,
      to: m.to,
      toZone: m.zoneId || null,
      toZoneId: m.zoneId || null,
      reason: 'Optimal placement',
      confidence: m.confidence || 'high',
      priority: 1
    }));
    // Recalculate the swap flag for the updated move list
    const _src = new Set(analysis.suggestedMoves.map(m => m.from));
    const _dst = new Set(analysis.suggestedMoves.map(m => m.to));
    analysis.movesHaveSwaps = [..._src].some(s => _dst.has(s));
  }

  renderMoves(analysis.suggestedMoves, analysis.needsZoneSetup, analysis.movesHaveSwaps);
  renderCompactionMoves(analysis.compactionMoves);
  renderRowAllocationInfo(analysis.layoutSettings);
  updateActionButton(analysis, onRenderAnalysis);

  // After reconfiguration, auto-switch to Placement workspace so the user
  // sees the moves they need to execute, then auto-trigger AI review.
  if (analysis?.__justReconfigured) {
    switchWorkspace('placement');
    const panel = document.getElementById('workspace-placement');
    if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });

    // Auto-trigger AI review since zone structure changed.
    // Dynamic import avoids circular deps; rAF fires after current paint.
    requestAnimationFrame(() => {
      import('./aiAdvice.js')
        .then(m => m.handleGetAIAdvice({ autoTriggered: true }))
        .catch(err => console.warn('[Analysis] auto AI review failed:', err));
    });
  }

  // Accept an optional report parameter so callers (e.g. zone reconfig modal)
  // can pass a report with flags like __justReconfigured and skip a redundant
  // API call.  When called without an argument, do a full refresh.
  _onRenderAnalysis = (report) => {
    if (report && typeof report === 'object') {
      setCurrentAnalysis(report);
      renderAnalysis(report, _onRenderAnalysis);
    } else {
      loadAnalysis(true);
    }
  };
}

/**
 * Update the single primary CTA button based on analysis state.
 * @param {Object} analysis - Analysis report
 * @param {Function} onRenderAnalysis - Re-render callback
 */
function updateActionButton(analysis, onRenderAnalysis) {
  const btn = document.getElementById('cellar-action-btn');
  if (!btn) return;

  const state = deriveState(analysis);
  const config = {
    [AnalysisState.NO_ZONES]:          { label: CTA_SETUP_ZONES,    hint: 'Create zone definitions for your cellar rows.', handler: () => startZoneSetup() },
    [AnalysisState.ZONES_DEGRADED]:    { label: CTA_RECONFIGURE_ZONES, hint: 'Zones need attention — adjust which rows belong to which zones.', handler: () => openReconfigurationModal({ onRenderAnalysis }) },
    [AnalysisState.ZONES_HEALTHY]:     { label: CTA_RECONFIGURE_ZONES, hint: 'Adjust which rows belong to which zones.', handler: () => openReconfigurationModal({ onRenderAnalysis }) },
    [AnalysisState.JUST_RECONFIGURED]: {
      label: CTA_GUIDE_MOVES,
      hint: 'Walk through the moves needed after reconfiguration.',
      handler: () => {
        const currentAnalysis = getCurrentAnalysis();
        // Prefer unified layout proposal CTA (Phase 4-7)
        const ctaEl = document.getElementById('layout-proposal-cta');
        if (ctaEl && ctaEl.style.display !== 'none' && currentAnalysis?.layoutProposal?.sortPlan?.length) {
          ctaEl.scrollIntoView({ behavior: 'smooth' });
          return;
        }
        if (currentAnalysis?.suggestedMoves?.some(m => m.type === 'move')) {
          openMoveGuide(currentAnalysis.suggestedMoves);
        } else {
          document.getElementById('analysis-moves')?.scrollIntoView({ behavior: 'smooth' });
        }
      }
    },
  };

  const { label, hint, handler } = config[state];
  btn.textContent = label;

  // Update helper microcopy below the CTA button
  const hintEl = document.getElementById('cellar-action-hint');
  if (hintEl) hintEl.textContent = hint;

  // Replace handler (clone to remove old listener)
  const newBtn = btn.cloneNode(true);
  btn.parentNode.replaceChild(newBtn, btn);
  newBtn.addEventListener('click', handler);
}

/**
 * Render summary statistics.
 * @param {Object} summary
 * @param {boolean} needsZoneSetup
 */
function renderSummary(summary, needsZoneSetup) {
  const el = document.getElementById('analysis-summary');

  // When zones aren't configured, show different stats
  if (needsZoneSetup) {
    el.innerHTML = `
      <div class="summary-stat">
        <div class="value">${summary.totalBottles}</div>
        <div class="label">Total Bottles</div>
      </div>
      <div class="summary-stat warning">
        <div class="value">-</div>
        <div class="label">Correctly Placed</div>
      </div>
      <div class="summary-stat warning">
        <div class="value">-</div>
        <div class="label">Misplaced</div>
      </div>
      <div class="summary-stat">
        <div class="value">${summary.zonesUsed}</div>
        <div class="label">Zones Detected</div>
      </div>
    `;
    return;
  }

  const misplacedClass = summary.misplacedBottles > 5 ? 'bad' : summary.misplacedBottles > 0 ? 'warning' : 'good';
  const correctPct = summary.totalBottles > 0
    ? Math.round((summary.correctlyPlaced / summary.totalBottles) * 100)
    : 100;

  el.innerHTML = `
    <div class="summary-stat">
      <div class="value">${summary.totalBottles}</div>
      <div class="label">Total Bottles</div>
    </div>
    <div class="summary-stat good">
      <div class="value">${correctPct}%</div>
      <div class="label">Correctly Placed</div>
    </div>
    <div class="summary-stat ${misplacedClass}">
      <div class="value">${summary.misplacedBottles}</div>
      <div class="label">Misplaced</div>
    </div>
    <div class="summary-stat">
      <div class="value">${summary.zonesUsed}</div>
      <div class="label">Zones Active</div>
    </div>
  `;
}

/**
 * Render alerts.
 * @param {Array} alerts
 */
function renderAlerts(alerts, { append = false } = {}) {
  const el = document.getElementById('analysis-alerts');

  if (!alerts || alerts.length === 0) {
    if (!append) el.innerHTML = '';
    return;
  }

  const html = alerts.map(alert => {
    const icon = alert.severity === 'warning' ? '⚠️' : 'ℹ️';
    const inlineCta = alert.type === 'zones_not_configured'
      ? ' <button class="btn btn-primary btn-small" data-action="inline-setup-zones">Setup Zones</button>'
      : '';
    return `
      <div class="alert-item ${alert.severity}">
        <span class="alert-icon">${icon}</span>
        <span>${alert.message}</span>${inlineCta}
      </div>
    `;
  }).join('');

  if (append) {
    el.insertAdjacentHTML('beforeend', html);
  } else {
    el.innerHTML = html;
  }

  // Wire inline Setup Zones CTA
  const inlineSetupBtn = el.querySelector('[data-action="inline-setup-zones"]');
  if (inlineSetupBtn) {
    inlineSetupBtn.addEventListener('click', () => startZoneSetup());
  }
}
