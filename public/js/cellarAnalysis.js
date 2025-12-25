/**
 * @fileoverview Cellar analysis UI module.
 * @module cellarAnalysis
 */

import { analyseCellar, analyseCellarAI, executeCellarMoves } from './api.js';
import { showToast } from './utils.js';
import { refreshLayout } from './app.js';

let currentAnalysis = null;

/**
 * Initialize cellar analysis UI handlers.
 */
export function initCellarAnalysis() {
  const analyseBtn = document.getElementById('analyse-cellar-btn');
  const closeBtn = document.getElementById('close-analysis-btn');
  const executeAllBtn = document.getElementById('execute-all-moves-btn');
  const getAIAdviceBtn = document.getElementById('get-ai-advice-btn');

  if (analyseBtn) {
    analyseBtn.addEventListener('click', handleAnalyseClick);
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', hideAnalysisPanel);
  }

  if (executeAllBtn) {
    executeAllBtn.addEventListener('click', handleExecuteAllMoves);
  }

  if (getAIAdviceBtn) {
    getAIAdviceBtn.addEventListener('click', handleGetAIAdvice);
  }
}

/**
 * Handle analyse button click.
 */
async function handleAnalyseClick() {
  const panel = document.getElementById('cellar-analysis-panel');
  const summaryEl = document.getElementById('analysis-summary');
  const alertsEl = document.getElementById('analysis-alerts');
  const movesListEl = document.getElementById('moves-list');
  const movesActionsEl = document.getElementById('moves-actions');

  // Show panel with loading state
  panel.style.display = 'block';
  summaryEl.innerHTML = '<div class="analysis-loading">Analysing cellar organisation...</div>';
  alertsEl.innerHTML = '';
  movesListEl.innerHTML = '';
  movesActionsEl.style.display = 'none';

  try {
    currentAnalysis = await analyseCellar();
    renderAnalysis(currentAnalysis);
  } catch (err) {
    summaryEl.innerHTML = `<div class="analysis-loading">Error: ${err.message}</div>`;
  }
}

/**
 * Render analysis results.
 * @param {Object} analysis - Analysis report from API
 */
function renderAnalysis(analysis) {
  renderSummary(analysis.summary);
  renderAlerts(analysis.alerts);
  renderMoves(analysis.suggestedMoves);
}

/**
 * Render summary statistics.
 * @param {Object} summary
 */
function renderSummary(summary) {
  const el = document.getElementById('analysis-summary');
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

/**
 * Render suggested moves.
 * @param {Array} moves
 */
function renderMoves(moves) {
  const listEl = document.getElementById('moves-list');
  const actionsEl = document.getElementById('moves-actions');

  if (!moves || moves.length === 0) {
    listEl.innerHTML = '<div class="no-moves">All bottles are well-organised!</div>';
    actionsEl.style.display = 'none';
    return;
  }

  listEl.innerHTML = moves.map((move, index) => {
    if (move.type === 'manual') {
      return `
        <div class="move-item priority-3">
          <div class="move-details">
            <div class="move-wine-name">${move.wineName}</div>
            <div class="move-path">
              <span class="from">${move.currentSlot}</span>
              <span class="arrow">→</span>
              <span class="to">${move.suggestedZone} (full)</span>
            </div>
            <div class="move-reason">${move.reason}</div>
          </div>
          <span class="move-confidence ${move.confidence}">${move.confidence}</span>
        </div>
      `;
    }

    return `
      <div class="move-item priority-${move.priority}" data-move-index="${index}">
        <div class="move-details">
          <div class="move-wine-name">${move.wineName}</div>
          <div class="move-path">
            <span class="from">${move.from}</span>
            <span class="arrow">→</span>
            <span class="to">${move.to}</span>
          </div>
          <div class="move-reason">${move.reason}</div>
        </div>
        <span class="move-confidence ${move.confidence}">${move.confidence}</span>
        <div class="move-actions">
          <button class="btn btn-primary btn-small" onclick="window.cellarAnalysis.executeMove(${index})">Move</button>
          <button class="btn btn-secondary btn-small" onclick="window.cellarAnalysis.dismissMove(${index})">Dismiss</button>
        </div>
      </div>
    `;
  }).join('');

  const actionableMoves = moves.filter(m => m.type === 'move');
  actionsEl.style.display = actionableMoves.length > 0 ? 'flex' : 'none';
}

/**
 * Execute a single move.
 * @param {number} index - Move index
 */
async function executeMove(index) {
  if (!currentAnalysis?.suggestedMoves?.[index]) return;

  const move = currentAnalysis.suggestedMoves[index];
  if (move.type !== 'move') return;

  try {
    await executeCellarMoves([{
      wineId: move.wineId,
      from: move.from,
      to: move.to
    }]);
    showToast(`Moved ${move.wineName} to ${move.to}`);

    // Remove move from list and refresh
    currentAnalysis.suggestedMoves.splice(index, 1);
    renderMoves(currentAnalysis.suggestedMoves);
    refreshLayout();
  } catch (err) {
    showToast(`Error: ${err.message}`);
  }
}

/**
 * Dismiss a move suggestion.
 * @param {number} index - Move index
 */
function dismissMove(index) {
  if (!currentAnalysis?.suggestedMoves?.[index]) return;

  currentAnalysis.suggestedMoves.splice(index, 1);
  renderMoves(currentAnalysis.suggestedMoves);
}

/**
 * Execute all suggested moves.
 */
async function handleExecuteAllMoves() {
  if (!currentAnalysis?.suggestedMoves) return;

  const movesToExecute = currentAnalysis.suggestedMoves
    .filter(m => m.type === 'move')
    .map(m => ({
      wineId: m.wineId,
      from: m.from,
      to: m.to
    }));

  if (movesToExecute.length === 0) {
    showToast('No moves to execute');
    return;
  }

  try {
    const result = await executeCellarMoves(movesToExecute);
    showToast(`Executed ${result.executed} moves`);

    // Re-analyse to show updated state
    currentAnalysis = await analyseCellar();
    renderAnalysis(currentAnalysis);
    refreshLayout();
  } catch (err) {
    showToast(`Error: ${err.message}`);
  }
}

/**
 * Get AI advice for cellar organisation.
 */
async function handleGetAIAdvice() {
  const adviceEl = document.getElementById('analysis-ai-advice');
  adviceEl.style.display = 'block';
  adviceEl.innerHTML = '<div class="analysis-loading">Getting AI advice...</div>';

  try {
    const result = await analyseCellarAI();
    adviceEl.innerHTML = `
      <h4>AI Sommelier Advice</h4>
      <div class="ai-advice-content">${formatAIAdvice(result.advice)}</div>
    `;
  } catch (err) {
    adviceEl.innerHTML = `<p>Error: ${err.message}</p>`;
  }
}

/**
 * Format AI advice text with paragraphs.
 * @param {string} advice
 * @returns {string} HTML formatted advice
 */
function formatAIAdvice(advice) {
  return advice
    .split('\n\n')
    .map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`)
    .join('');
}

/**
 * Hide the analysis panel.
 */
function hideAnalysisPanel() {
  const panel = document.getElementById('cellar-analysis-panel');
  panel.style.display = 'none';
  currentAnalysis = null;
}

// Expose functions for inline onclick handlers
window.cellarAnalysis = {
  executeMove,
  dismissMove
};
