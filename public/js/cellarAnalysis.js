/**
 * @fileoverview Cellar analysis UI module.
 * @module cellarAnalysis
 */

import { analyseCellar, analyseCellarAI, executeCellarMoves } from './api.js';
import { showToast } from './utils.js';
import { refreshLayout } from './app.js';

let currentAnalysis = null;
let analysisLoaded = false;

/**
 * Initialize cellar analysis UI handlers.
 */
export function initCellarAnalysis() {
  const refreshBtn = document.getElementById('refresh-analysis-btn');
  const executeAllBtn = document.getElementById('execute-all-moves-btn');
  const getAIAdviceBtn = document.getElementById('get-ai-advice-btn');

  console.log('[CellarAnalysis] Init - refreshBtn:', !!refreshBtn, 'getAIAdviceBtn:', !!getAIAdviceBtn);

  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      console.log('[CellarAnalysis] Refresh clicked');
      loadAnalysis();
    });
  }

  if (executeAllBtn) {
    executeAllBtn.addEventListener('click', handleExecuteAllMoves);
  }

  if (getAIAdviceBtn) {
    getAIAdviceBtn.addEventListener('click', () => {
      console.log('[CellarAnalysis] AI Advice clicked');
      handleGetAIAdvice();
    });
  }
}

/**
 * Load analysis when tab is opened.
 * Called by app.js when switching to analysis tab.
 */
export async function loadAnalysis() {
  const summaryEl = document.getElementById('analysis-summary');
  const alertsEl = document.getElementById('analysis-alerts');
  const movesListEl = document.getElementById('moves-list');
  const movesActionsEl = document.getElementById('moves-actions');

  // Show loading state
  summaryEl.innerHTML = '<div class="analysis-loading">Analysing cellar organisation...</div>';
  alertsEl.innerHTML = '';
  movesListEl.innerHTML = '';
  movesActionsEl.style.display = 'none';

  try {
    const response = await analyseCellar();
    currentAnalysis = response.report;
    analysisLoaded = true;
    renderAnalysis(currentAnalysis);
  } catch (err) {
    summaryEl.innerHTML = `<div class="analysis-loading">Error: ${err.message}</div>`;
  }
}

/**
 * Check if analysis has been loaded.
 */
export function isAnalysisLoaded() {
  return analysisLoaded;
}

/**
 * Get current analysis data.
 */
export function getCurrentAnalysis() {
  return currentAnalysis;
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
  renderMoves(analysis.suggestedMoves, analysis.needsZoneSetup);
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

/**
 * Render fridge status with par-level gaps and candidates.
 * @param {Object} fridgeStatus
 */
function renderFridgeStatus(fridgeStatus) {
  const container = document.getElementById('analysis-fridge');
  const contentEl = document.getElementById('fridge-status-content');

  if (!fridgeStatus) {
    container.style.display = 'none';
    return;
  }

  container.style.display = 'block';
  const fillPercent = Math.round((fridgeStatus.occupied / fridgeStatus.capacity) * 100);

  // Build current mix display
  const categories = ['sparkling', 'crispWhite', 'aromaticWhite', 'textureWhite', 'rose', 'chillableRed', 'flex'];
  const categoryLabels = {
    sparkling: 'Sparkling',
    crispWhite: 'Crisp White',
    aromaticWhite: 'Aromatic',
    textureWhite: 'Oaked White',
    rose: 'Rosé',
    chillableRed: 'Light Red',
    flex: 'Flex'
  };

  const mixHtml = categories.map(cat => {
    const count = fridgeStatus.currentMix?.[cat] || 0;
    const hasGap = fridgeStatus.parLevelGaps?.[cat];
    return `
      <div class="fridge-category ${hasGap ? 'has-gap' : ''}">
        <div class="count">${count}</div>
        <div class="name">${categoryLabels[cat]}</div>
      </div>
    `;
  }).join('');

  // Build gaps display
  let gapsHtml = '';
  if (fridgeStatus.hasGaps && Object.keys(fridgeStatus.parLevelGaps).length > 0) {
    const gapItems = Object.entries(fridgeStatus.parLevelGaps)
      .sort((a, b) => a[1].priority - b[1].priority)
      .map(([cat, gap]) => `
        <div class="fridge-gap-item">
          <span>${categoryLabels[cat] || cat}: ${gap.description}</span>
          <span class="need">Need ${gap.need}</span>
        </div>
      `).join('');

    gapsHtml = `
      <div class="fridge-gaps">
        <h5>Par-Level Gaps</h5>
        ${gapItems}
      </div>
    `;
  }

  // Build candidates display
  let candidatesHtml = '';
  if (fridgeStatus.candidates && fridgeStatus.candidates.length > 0) {
    const candidateItems = fridgeStatus.candidates.slice(0, 5).map((c, i) => `
      <div class="fridge-candidate">
        <div class="fridge-candidate-info">
          <div class="fridge-candidate-name">${c.wineName} ${c.vintage || ''}</div>
          <div class="fridge-candidate-reason">${c.reason}</div>
        </div>
        <button class="btn btn-secondary btn-small" onclick="window.cellarAnalysis.moveFridgeCandidate(${i})">
          Add
        </button>
      </div>
    `).join('');

    candidatesHtml = `
      <div class="fridge-candidates">
        <h5>Suggested Additions</h5>
        ${candidateItems}
      </div>
    `;
  }

  contentEl.innerHTML = `
    <div class="fridge-status-header">
      <div class="fridge-capacity-bar">
        <div class="fridge-capacity-fill" style="width: ${fillPercent}%"></div>
      </div>
      <div class="fridge-capacity-text">${fridgeStatus.occupied}/${fridgeStatus.capacity} slots</div>
    </div>
    <div class="fridge-mix-grid">${mixHtml}</div>
    ${gapsHtml}
    ${candidatesHtml}
  `;
}

/**
 * Render zone narratives as cards.
 * @param {Array} narratives
 */
function renderZoneNarratives(narratives) {
  const container = document.getElementById('analysis-zones');
  const gridEl = document.getElementById('zone-cards-grid');

  if (!narratives || narratives.length === 0) {
    container.style.display = 'none';
    return;
  }

  container.style.display = 'block';

  const cards = narratives.map(zone => {
    const status = zone.health?.status || 'healthy';
    const purpose = zone.intent?.purpose || 'Mixed wines';
    const pairingHints = zone.intent?.pairingHints?.slice(0, 3) || [];
    const rows = zone.rows?.join(', ') || 'N/A';
    const bottles = zone.currentComposition?.bottleCount || 0;
    const utilization = zone.health?.utilizationPercent || 0;
    const topGrapes = zone.currentComposition?.topGrapes?.slice(0, 2) || [];
    const topCountries = zone.currentComposition?.topCountries?.slice(0, 2) || [];

    // Only show zones with bottles
    if (bottles === 0) return '';

    const compositionParts = [];
    if (topGrapes.length > 0) compositionParts.push(topGrapes.join(', '));
    if (topCountries.length > 0 && topCountries[0] !== 'Unknown') {
      compositionParts.push(`from ${topCountries.join(', ')}`);
    }

    return `
      <div class="zone-card ${status}">
        <div class="zone-card-header">
          <span class="zone-card-title">${zone.displayName}</span>
          <span class="zone-card-status ${status}">${status}</span>
        </div>
        <div class="zone-card-purpose">${purpose}</div>
        <div class="zone-card-stats">
          <span>${bottles} bottles</span>
          <span>${utilization}% full</span>
          <span>Rows: ${rows}</span>
        </div>
        ${compositionParts.length > 0 ? `
          <div class="zone-card-composition">
            Currently: ${compositionParts.join(' ')}
          </div>
        ` : ''}
        ${pairingHints.length > 0 ? `
          <div class="zone-card-pairing">
            <strong>Pairs with:</strong> ${pairingHints.join(', ')}
          </div>
        ` : ''}
      </div>
    `;
  }).filter(Boolean).join('');

  gridEl.innerHTML = cards || '<p class="no-moves">No zones with bottles found.</p>';
}

/**
 * Move a fridge candidate to the fridge.
 * @param {number} index - Candidate index
 */
async function moveFridgeCandidate(index) {
  if (!currentAnalysis?.fridgeStatus?.candidates?.[index]) return;

  const candidate = currentAnalysis.fridgeStatus.candidates[index];
  const emptySlots = currentAnalysis.fridgeStatus.emptySlots;

  if (emptySlots <= 0) {
    showToast('No empty fridge slots available');
    return;
  }

  // Find an empty fridge slot
  const fridgeSlots = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9'];
  const occupiedSlots = new Set(currentAnalysis.fridgeStatus.wines?.map(w => w.slot) || []);
  const targetSlot = fridgeSlots.find(s => !occupiedSlots.has(s));

  if (!targetSlot) {
    showToast('No empty fridge slots available');
    return;
  }

  try {
    await executeCellarMoves([{
      wineId: candidate.wineId,
      from: candidate.fromSlot,
      to: targetSlot
    }]);
    showToast(`Moved ${candidate.wineName} to ${targetSlot}`);

    // Re-analyse to show updated state
    await loadAnalysis();
    refreshLayout();
  } catch (err) {
    showToast(`Error: ${err.message}`);
  }
}

/**
 * Render suggested moves.
 * @param {Array} moves
 * @param {boolean} needsZoneSetup
 */
function renderMoves(moves, needsZoneSetup) {
  const listEl = document.getElementById('moves-list');
  const actionsEl = document.getElementById('moves-actions');

  // When zones aren't configured, show explanation
  if (needsZoneSetup) {
    listEl.innerHTML = `
      <div class="no-moves">
        <p>Zone allocations haven't been configured yet.</p>
        <p>Click <strong>"Get AI Advice"</strong> to have AI propose a zone structure based on your collection.</p>
      </div>
    `;
    actionsEl.style.display = 'none';
    return;
  }

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
    renderMoves(currentAnalysis.suggestedMoves, currentAnalysis.needsZoneSetup);
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
  renderMoves(currentAnalysis.suggestedMoves, currentAnalysis.needsZoneSetup);
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
    await loadAnalysis();
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
    adviceEl.innerHTML = formatAIAdvice(result.aiAdvice);
  } catch (err) {
    adviceEl.innerHTML = `<div class="ai-advice-error">Error: ${err.message}</div>`;
  }
}

/**
 * Format AI advice object into HTML.
 * @param {Object} advice - AI advice object
 * @returns {string} HTML formatted advice
 */
function formatAIAdvice(advice) {
  if (!advice) return '<p>No advice available.</p>';

  // If it's a string (legacy), just format as paragraphs
  if (typeof advice === 'string') {
    return `<h4>AI Sommelier Advice</h4><div class="ai-advice-content">${advice.split('\n\n').map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('')}</div>`;
  }

  // Format structured advice object
  let html = '<div class="ai-advice-structured">';

  // Summary
  if (advice.summary) {
    html += `<div class="ai-summary"><h4>Summary</h4><p>${advice.summary}</p></div>`;
  }

  // Layout narrative
  if (advice.layoutNarrative) {
    html += `<div class="ai-narrative"><h4>Cellar Layout</h4><p>${advice.layoutNarrative}</p></div>`;
  }

  // Zone adjustments
  if (advice.zoneAdjustments && advice.zoneAdjustments.length > 0) {
    html += '<div class="ai-zone-adjustments"><h4>Suggested Zone Changes</h4><ul>';
    advice.zoneAdjustments.forEach(adj => {
      html += `<li><strong>${adj.zoneId}</strong>: ${adj.suggestion}</li>`;
    });
    html += '</ul></div>';
  }

  // Zone health
  if (advice.zoneHealth && advice.zoneHealth.length > 0) {
    html += '<div class="ai-zone-health"><h4>Zone Health</h4>';
    advice.zoneHealth.forEach(z => {
      const statusClass = z.status === 'healthy' ? 'good' : z.status === 'fragmented' ? 'warning' : 'bad';
      html += `<div class="zone-health-item ${statusClass}">
        <span class="zone-name">${z.zone}</span>
        <span class="zone-status">${z.status}</span>
        <p class="zone-recommendation">${z.recommendation}</p>
      </div>`;
    });
    html += '</div>';
  }

  // Fridge plan
  if (advice.fridgePlan && advice.fridgePlan.toAdd && advice.fridgePlan.toAdd.length > 0) {
    html += '<div class="ai-fridge-plan"><h4>Fridge Recommendations</h4><ul>';
    advice.fridgePlan.toAdd.forEach(item => {
      html += `<li><strong>${item.category}</strong>: ${item.reason}</li>`;
    });
    html += '</ul></div>';
  }

  html += '</div>';
  return html;
}

// Expose functions for inline onclick handlers
window.cellarAnalysis = {
  executeMove,
  dismissMove,
  moveFridgeCandidate
};
