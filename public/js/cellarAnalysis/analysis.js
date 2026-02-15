/**
 * @fileoverview Main analysis loading and rendering.
 * @module cellarAnalysis/analysis
 */

import { analyseCellar } from '../api.js';
import { setCurrentAnalysis, setAnalysisLoaded, getCurrentAnalysis } from './state.js';
import { renderMoves, renderCompactionMoves, renderRowAllocationInfo } from './moves.js';
import { renderFridgeStatus } from './fridge.js';
import { renderZoneNarratives } from './zones.js';
import { renderZoneCapacityAlert } from './zoneCapacityAlert.js';
import { renderZoneReconfigurationBanner } from './zoneReconfigurationBanner.js';
import { deriveState, AnalysisState } from './analysisState.js';
import { startZoneSetup } from './zones.js';
import { openReconfigurationModal } from './zoneReconfigurationModal.js';
import { openMoveGuide } from './moveGuide.js';
import { CTA_RECONFIGURE_ZONES, CTA_SETUP_ZONES, CTA_GUIDE_MOVES } from './labels.js';

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
    'fridge-status-content', 'analysis-ai-advice'
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
 * Render analysis results.
 * @param {Object} analysis - Analysis report from API
 */
function renderAnalysis(analysis, onRenderAnalysis) {
  renderSummary(analysis.summary, analysis.needsZoneSetup);

  const bannerResult = renderZoneReconfigurationBanner(analysis, { onRenderAnalysis });
  if (bannerResult.rendered) {
    renderAlerts(bannerResult.remainingAlerts, { append: true });
  } else {
    const { remainingAlerts, rendered } = renderZoneCapacityAlert(analysis, { onRenderAnalysis });
    renderAlerts(remainingAlerts, { append: rendered });
  }

  renderFridgeStatus(analysis.fridgeStatus);
  renderZoneNarratives(analysis.zoneNarratives);
  renderMoves(analysis.suggestedMoves, analysis.needsZoneSetup, analysis.movesHaveSwaps);
  renderCompactionMoves(analysis.compactionMoves);
  renderRowAllocationInfo(analysis.layoutSettings);
  updateActionButton(analysis, onRenderAnalysis);

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
    [AnalysisState.NO_ZONES]:          { label: CTA_SETUP_ZONES,    handler: () => startZoneSetup() },
    [AnalysisState.ZONES_DEGRADED]:    { label: CTA_RECONFIGURE_ZONES, handler: () => openReconfigurationModal({ onRenderAnalysis }) },
    [AnalysisState.ZONES_HEALTHY]:     { label: CTA_RECONFIGURE_ZONES, handler: () => openReconfigurationModal({ onRenderAnalysis }) },
    [AnalysisState.JUST_RECONFIGURED]: {
      label: CTA_GUIDE_MOVES,
      handler: () => {
        const currentAnalysis = getCurrentAnalysis();
        if (currentAnalysis?.suggestedMoves?.some(m => m.type === 'move')) {
          openMoveGuide(currentAnalysis.suggestedMoves);
        } else {
          document.getElementById('analysis-moves')?.scrollIntoView({ behavior: 'smooth' });
        }
      }
    },
  };

  const { label, handler } = config[state];
  btn.textContent = label;

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
