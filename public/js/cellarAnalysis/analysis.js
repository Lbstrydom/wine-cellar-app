/**
 * @fileoverview Main analysis loading and rendering.
 * @module cellarAnalysis/analysis
 */

import { analyseCellar } from '../api.js';
import { setCurrentAnalysis, setAnalysisLoaded } from './state.js';
import { renderMoves } from './moves.js';
import { renderFridgeStatus } from './fridge.js';
import { renderZoneNarratives } from './zones.js';

/**
 * Load analysis when tab is opened.
 * Called by app.js when switching to analysis tab.
 * @param {boolean} [forceRefresh=false] - Force fresh analysis ignoring cache
 */
export async function loadAnalysis(forceRefresh = false) {
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

  try {
    const response = await analyseCellar(forceRefresh);
    setCurrentAnalysis(response.report);
    setAnalysisLoaded(true);
    renderAnalysis(response.report);

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
    summaryEl.innerHTML = `<div class="analysis-loading">Error: ${err.message}</div>`;
  }
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
function renderAnalysis(analysis) {
  renderSummary(analysis.summary, analysis.needsZoneSetup);
  renderAlerts(analysis.alerts);
  renderFridgeStatus(analysis.fridgeStatus);
  renderZoneNarratives(analysis.zoneNarratives);
  renderMoves(analysis.suggestedMoves, analysis.needsZoneSetup, analysis.movesHaveSwaps);
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
function renderAlerts(alerts) {
  const el = document.getElementById('analysis-alerts');

  if (!alerts || alerts.length === 0) {
    el.innerHTML = '';
    return;
  }

  el.innerHTML = alerts.map(alert => {
    const icon = alert.severity === 'warning' ? '⚠️' : 'ℹ️';
    return `
      <div class="alert-item ${alert.severity}">
        <span class="alert-icon">${icon}</span>
        <span>${alert.message}</span>
      </div>
    `;
  }).join('');
}
