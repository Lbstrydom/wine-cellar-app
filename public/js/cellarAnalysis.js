/**
 * @fileoverview Cellar analysis UI module.
 * @module cellarAnalysis
 */

import {
  analyseCellar,
  analyseCellarAI,
  executeCellarMoves,
  getZoneLayoutProposal,
  confirmZoneLayout,
  getConsolidationMoves,
  zoneChatMessage,
  reassignWineZone,
  getFridgeOrganization
} from './api.js';
import { showToast, escapeHtml } from './utils.js';
import { refreshLayout } from './app.js';

let currentAnalysis = null;
let analysisLoaded = false;
let currentProposal = null;
let currentZoneMoves = null;
let currentZoneIndex = 0;
let zoneChatContext = null;

/**
 * Initialize cellar analysis UI handlers.
 */
export function initCellarAnalysis() {
  const refreshBtn = document.getElementById('refresh-analysis-btn');
  const executeAllBtn = document.getElementById('execute-all-moves-btn');
  const getAIAdviceBtn = document.getElementById('get-ai-advice-btn');
  const setupZonesBtn = document.getElementById('setup-zones-btn');
  const confirmLayoutBtn = document.getElementById('confirm-layout-btn');
  const cancelSetupBtn = document.getElementById('cancel-setup-btn');
  const toggleZoneChatBtn = document.getElementById('toggle-zone-chat-btn');
  const closeZoneChatBtn = document.getElementById('zone-chat-close-btn');
  const zoneChatSendBtn = document.getElementById('zone-chat-send-btn');
  const zoneChatInput = document.getElementById('zone-chat-input');

  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => refreshAnalysis());
  }

  if (executeAllBtn) {
    executeAllBtn.addEventListener('click', handleExecuteAllMoves);
  }

  if (getAIAdviceBtn) {
    getAIAdviceBtn.addEventListener('click', handleGetAIAdvice);
  }

  if (setupZonesBtn) {
    setupZonesBtn.addEventListener('click', startZoneSetup);
  }

  if (confirmLayoutBtn) {
    confirmLayoutBtn.addEventListener('click', handleConfirmLayout);
  }

  if (cancelSetupBtn) {
    cancelSetupBtn.addEventListener('click', cancelZoneSetup);
  }

  if (toggleZoneChatBtn) {
    toggleZoneChatBtn.addEventListener('click', toggleZoneChat);
  }

  if (closeZoneChatBtn) {
    closeZoneChatBtn.addEventListener('click', toggleZoneChat);
  }

  if (zoneChatSendBtn) {
    zoneChatSendBtn.addEventListener('click', sendZoneChatMessage);
  }

  if (zoneChatInput) {
    zoneChatInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        sendZoneChatMessage();
      }
    });
  }
}

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
    currentAnalysis = response.report;
    analysisLoaded = true;
    renderAnalysis(currentAnalysis);

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
          <div class="fridge-candidate-name">${escapeHtml(c.wineName)} ${c.vintage || ''}</div>
          <div class="fridge-candidate-reason">${escapeHtml(c.reason)}</div>
        </div>
        <button class="btn btn-secondary btn-small fridge-add-btn" data-candidate-index="${i}">
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

  // Organize button (only show if 2+ wines in fridge)
  const organizeBtn = fridgeStatus.occupied >= 2
    ? '<button class="btn btn-secondary btn-small organize-fridge-btn">Organize Fridge</button>'
    : '';

  contentEl.innerHTML = `
    <div class="fridge-status-header">
      <div class="fridge-capacity-bar">
        <div class="fridge-capacity-fill" style="width: ${fillPercent}%"></div>
      </div>
      <div class="fridge-capacity-text">${fridgeStatus.occupied}/${fridgeStatus.capacity} slots ${organizeBtn}</div>
    </div>
    <div class="fridge-mix-grid">${mixHtml}</div>
    ${gapsHtml}
    ${candidatesHtml}
    <div id="fridge-organize-panel" style="display: none;"></div>
  `;

  // Attach event listeners for fridge candidate add buttons (CSP-compliant)
  contentEl.querySelectorAll('.fridge-add-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const index = Number.parseInt(btn.dataset.candidateIndex, 10);
      moveFridgeCandidate(index);
    });
  });

  // Attach organize fridge button handler
  const organizeButton = contentEl.querySelector('.organize-fridge-btn');
  if (organizeButton) {
    organizeButton.addEventListener('click', handleOrganizeFridge);
  }
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
  if (!currentAnalysis?.fridgeStatus?.candidates?.[index]) {
    showToast('Error: Candidate not found');
    return;
  }

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

  if (!candidate.fromSlot) {
    showToast('Error: Wine location unknown');
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
 * Handle the "Organize Fridge" button click.
 * Shows suggested moves to group wines by category.
 */
async function handleOrganizeFridge() {
  const panel = document.getElementById('fridge-organize-panel');
  if (!panel) return;

  // Toggle visibility if already showing
  if (panel.style.display !== 'none') {
    panel.style.display = 'none';
    return;
  }

  panel.style.display = 'block';
  panel.innerHTML = '<div class="analysis-loading">Calculating optimal arrangement...</div>';

  try {
    const result = await getFridgeOrganization();

    if (!result.moves || result.moves.length === 0) {
      panel.innerHTML = `
        <div class="fridge-organize-result">
          <p class="no-moves">Your fridge is already well-organized by category.</p>
          ${result.summary ? renderFridgeSummary(result.summary) : ''}
        </div>
      `;
      return;
    }

    // If moves involve swaps, individual moves would cause data loss
    const hasSwaps = result.hasSwaps || result.mustExecuteAsBatch;
    const swapWarning = hasSwaps
      ? `<div class="swap-warning">
          <strong>Note:</strong> These moves involve swaps - they must be executed together to avoid losing bottles.
         </div>`
      : '';

    panel.innerHTML = `
      <div class="fridge-organize-result">
        <h5>Suggested Reorganization</h5>
        <p class="organize-description">Grouping wines by category (coldest at top):</p>
        ${swapWarning}
        ${renderFridgeSummary(result.summary)}
        <div class="fridge-moves-list">
          ${result.moves.map((m, i) => `
            <div class="fridge-move-item" data-move-index="${i}">
              <span class="move-wine">${escapeHtml(m.wineName)} ${m.vintage || ''}</span>
              <span class="move-category">${escapeHtml(m.category)}</span>
              <span class="move-path">${m.from} → ${m.to}</span>
              ${hasSwaps
                ? '<span class="move-locked" title="Must execute all moves together">🔒</span>'
                : `<button class="btn btn-small btn-primary fridge-move-btn" data-move-index="${i}">Move</button>`
              }
            </div>
          `).join('')}
        </div>
        <div class="fridge-organize-actions">
          <button class="btn btn-primary execute-all-fridge-moves-btn">Execute All ${result.moves.length} Moves</button>
          <button class="btn btn-secondary close-organize-btn">Close</button>
        </div>
      </div>
    `;

    // Store moves for execution
    panel.dataset.moves = JSON.stringify(result.moves);

    // Attach event listeners (only for individual moves if no swaps)
    if (!hasSwaps) {
      panel.querySelectorAll('.fridge-move-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = Number.parseInt(btn.dataset.moveIndex, 10);
          executeFridgeOrganizeMove(idx);
        });
      });
    }

    panel.querySelector('.execute-all-fridge-moves-btn')?.addEventListener('click', executeAllFridgeOrganizeMoves);
    panel.querySelector('.close-organize-btn')?.addEventListener('click', () => {
      panel.style.display = 'none';
    });

  } catch (err) {
    panel.innerHTML = `<div class="ai-advice-error">Error: ${err.message}</div>`;
  }
}

/**
 * Render fridge organization summary.
 * @param {Array} summary - Category groups
 * @returns {string} HTML
 */
function renderFridgeSummary(summary) {
  if (!summary || summary.length === 0) return '';

  return `
    <div class="fridge-summary">
      ${summary.map(g => `
        <span class="fridge-summary-item">
          <span class="category-name">${escapeHtml(g.name)}</span>
          <span class="category-slots">${g.startSlot}${g.startSlot !== g.endSlot ? '-' + g.endSlot : ''}</span>
        </span>
      `).join('')}
    </div>
  `;
}

/**
 * Execute a single fridge organization move.
 * @param {number} index - Move index
 */
async function executeFridgeOrganizeMove(index) {
  const panel = document.getElementById('fridge-organize-panel');
  if (!panel) return;

  const moves = JSON.parse(panel.dataset.moves || '[]');
  const move = moves[index];
  if (!move) return;

  try {
    await executeCellarMoves([{
      wineId: move.wineId,
      from: move.from,
      to: move.to
    }]);
    showToast(`Moved ${move.wineName} to ${move.to}`);

    // Remove from list and refresh
    moves.splice(index, 1);
    panel.dataset.moves = JSON.stringify(moves);

    // Refresh UI
    await loadAnalysis();
    refreshLayout();
  } catch (err) {
    showToast(`Error: ${err.message}`);
  }
}

/**
 * Execute all fridge organization moves.
 */
async function executeAllFridgeOrganizeMoves() {
  const panel = document.getElementById('fridge-organize-panel');
  if (!panel) return;

  const moves = JSON.parse(panel.dataset.moves || '[]');
  if (moves.length === 0) {
    showToast('No moves to execute');
    return;
  }

  try {
    const movesToExecute = moves.map(m => ({
      wineId: m.wineId,
      from: m.from,
      to: m.to
    }));

    const result = await executeCellarMoves(movesToExecute);
    showToast(`Executed ${result.moved} moves`);

    // Clear and refresh
    panel.style.display = 'none';
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
 * @param {boolean} hasSwaps - True if moves involve swaps that require batch execution
 */
function renderMoves(moves, needsZoneSetup, hasSwaps = false) {
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

  // If moves have swaps, show warning and disable individual moves
  const swapWarning = hasSwaps
    ? `<div class="swap-warning">
        <strong>Note:</strong> These moves involve swaps - execute them together to avoid losing bottles.
       </div>`
    : '';

  listEl.innerHTML = swapWarning + moves.map((move, index) => {
    if (move.type === 'manual') {
      return `
        <div class="move-item priority-3">
          <div class="move-details">
            <div class="move-wine-name">${escapeHtml(move.wineName)}</div>
            <div class="move-path">
              <span class="from">${move.currentSlot}</span>
              <span class="arrow">→</span>
              <span class="to">${move.suggestedZone} (full)</span>
            </div>
            <div class="move-reason">${escapeHtml(move.reason)}</div>
          </div>
          <span class="move-confidence ${move.confidence}">${move.confidence}</span>
        </div>
      `;
    }

    // For swap scenarios, show lock icon instead of individual move button
    const moveButton = hasSwaps
      ? '<span class="move-locked" title="Execute all moves together">🔒</span>'
      : `<button class="btn btn-primary btn-small move-execute-btn" data-move-index="${index}">Move</button>`;

    return `
      <div class="move-item priority-${move.priority}" data-move-index="${index}">
        <div class="move-details">
          <div class="move-wine-name">${escapeHtml(move.wineName)}</div>
          <div class="move-path">
            <span class="from">${move.from}</span>
            <span class="arrow">→</span>
            <span class="to">${move.to}</span>
          </div>
          <div class="move-reason">${escapeHtml(move.reason)}</div>
        </div>
        <span class="move-confidence ${move.confidence}">${move.confidence}</span>
        <div class="move-actions">
          ${moveButton}
          <button class="btn btn-secondary btn-small move-dismiss-btn" data-move-index="${index}">Dismiss</button>
        </div>
      </div>
    `;
  }).join('');

  // Attach event listeners for move buttons (CSP-compliant)
  // Only enable individual moves if no swaps
  if (!hasSwaps) {
    listEl.querySelectorAll('.move-execute-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const index = Number.parseInt(btn.dataset.moveIndex, 10);
        executeMove(index);
      });
    });
  }
  listEl.querySelectorAll('.move-dismiss-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const index = Number.parseInt(btn.dataset.moveIndex, 10);
      dismissMove(index);
    });
  });

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
    // Re-check if remaining moves have swaps
    const sources = new Set(currentAnalysis.suggestedMoves.filter(m => m.type === 'move').map(m => m.from));
    const targets = new Set(currentAnalysis.suggestedMoves.filter(m => m.type === 'move').map(m => m.to));
    currentAnalysis.movesHaveSwaps = [...sources].some(s => targets.has(s));
    renderMoves(currentAnalysis.suggestedMoves, currentAnalysis.needsZoneSetup, currentAnalysis.movesHaveSwaps);
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
  // Re-check if remaining moves have swaps
  const sources = new Set(currentAnalysis.suggestedMoves.filter(m => m.type === 'move').map(m => m.from));
  const targets = new Set(currentAnalysis.suggestedMoves.filter(m => m.type === 'move').map(m => m.to));
  currentAnalysis.movesHaveSwaps = [...sources].some(s => targets.has(s));
  renderMoves(currentAnalysis.suggestedMoves, currentAnalysis.needsZoneSetup, currentAnalysis.movesHaveSwaps);
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
      wineName: m.wineName, // Include wine name for validation messages
      from: m.from,
      to: m.to
    }));

  if (movesToExecute.length === 0) {
    showToast('No moves to execute');
    return;
  }

  // Show preview modal with move details
  const confirmed = await showMovePreviewModal(movesToExecute);
  if (!confirmed) {
    return;
  }

  try {
    const result = await executeCellarMoves(movesToExecute);
    
    // Check if validation failed
    if (!result.success) {
      showValidationErrorModal(result.validation);
      return;
    }
    
    showToast(`Successfully executed ${result.moved} moves`);

    // Re-analyse to show updated state
    await loadAnalysis();
    refreshLayout();
  } catch (err) {
    showToast(`Error: ${err.message}`);
  }
}

/**
 * Show move preview modal before execution.
 * @param {Array} moves - Array of move objects
 * @returns {Promise<boolean>} True if user confirms
 */
function showMovePreviewModal(moves) {
  return new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal move-preview-modal">
        <div class="modal-header">
          <h3>Confirm Bottle Moves</h3>
          <button class="close-btn">&times;</button>
        </div>
        <div class="modal-body">
          <p class="preview-summary">About to move <strong>${moves.length}</strong> bottle(s):</p>
          <div class="move-preview-list">
            ${moves.map(m => `
              <div class="move-preview-item">
                <div class="move-wine">${escapeHtml(m.wineName || `Wine ${m.wineId}`)}</div>
                <div class="move-path">${escapeHtml(m.from)} → ${escapeHtml(m.to)}</div>
              </div>
            `).join('')}
          </div>
          <p class="preview-warning">
            <strong>⚠️ Important:</strong> All moves will be executed atomically. 
            If validation fails, no bottles will be moved.
          </p>
        </div>
        <div class="modal-footer">
          <button class="btn-secondary cancel-btn">Cancel</button>
          <button class="btn-primary confirm-btn">Execute Moves</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
    
    const confirmBtn = modal.querySelector('.confirm-btn');
    const cancelBtn = modal.querySelector('.cancel-btn');
    const closeBtn = modal.querySelector('.close-btn');
    
    const handleConfirm = () => {
      modal.remove();
      resolve(true);
    };
    
    const handleCancel = () => {
      modal.remove();
      resolve(false);
    };
    
    confirmBtn.addEventListener('click', handleConfirm);
    cancelBtn.addEventListener('click', handleCancel);
    closeBtn.addEventListener('click', handleCancel);
    
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.remove();
        resolve(false);
      }
    });
  });
}

/**
 * Show validation error modal with detailed error information.
 * @param {Object} validation - Validation result from API
 */
function showValidationErrorModal(validation) {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  
  const errorsByType = {};
  validation.errors.forEach(err => {
    if (!errorsByType[err.type]) {
      errorsByType[err.type] = [];
    }
    errorsByType[err.type].push(err);
  });
  
  let errorsHtml = '';
  
  if (errorsByType.duplicate_target) {
    errorsHtml += `
      <div class="validation-error-section">
        <h4>🚫 Duplicate Target Slots (${errorsByType.duplicate_target.length})</h4>
        <ul>
          ${errorsByType.duplicate_target.map(e => `
            <li>${escapeHtml(e.message)}</li>
          `).join('')}
        </ul>
        <p class="error-explanation">Multiple bottles would be moved to the same slot, causing data loss.</p>
      </div>
    `;
  }
  
  if (errorsByType.target_occupied) {
    errorsHtml += `
      <div class="validation-error-section">
        <h4>⚠️ Occupied Target Slots (${errorsByType.target_occupied.length})</h4>
        <ul>
          ${errorsByType.target_occupied.map(e => `
            <li>${escapeHtml(e.message)}</li>
          `).join('')}
        </ul>
        <p class="error-explanation">Target slots already contain bottles that aren't being moved.</p>
      </div>
    `;
  }
  
  if (errorsByType.source_mismatch) {
    errorsHtml += `
      <div class="validation-error-section">
        <h4>❌ Source Slot Mismatches (${errorsByType.source_mismatch.length})</h4>
        <ul>
          ${errorsByType.source_mismatch.map(e => `
            <li>${escapeHtml(e.message)}</li>
          `).join('')}
        </ul>
        <p class="error-explanation">Expected wines not found at source locations (bottles may have been moved already).</p>
      </div>
    `;
  }
  
  if (errorsByType.duplicate_wine) {
    errorsHtml += `
      <div class="validation-error-section">
        <h4>🔁 Duplicate Wine Moves (${errorsByType.duplicate_wine.length})</h4>
        <ul>
          ${errorsByType.duplicate_wine.map(e => `
            <li>${escapeHtml(e.message)}</li>
          `).join('')}
        </ul>
        <p class="error-explanation">Same wine appears in multiple moves.</p>
      </div>
    `;
  }
  
  modal.innerHTML = `
    <div class="modal validation-error-modal">
      <div class="modal-header error">
        <h3>❌ Move Validation Failed</h3>
        <button class="close-btn">&times;</button>
      </div>
      <div class="modal-body">
        <p class="validation-summary">
          <strong>${validation.summary.errorCount}</strong> validation error(s) prevented execution.
          No bottles were moved.
        </p>
        ${errorsHtml}
        <div class="validation-advice">
          <strong>What to do:</strong>
          <p>Refresh the analysis to get an updated view of the cellar. 
          The suggested moves may be stale if bottles were recently moved.</p>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-primary close-btn-footer">Close</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  const closeBtn = modal.querySelector('.close-btn');
  const closeFooterBtn = modal.querySelector('.close-btn-footer');
  
  const handleClose = () => modal.remove();
  
  closeBtn.addEventListener('click', handleClose);
  closeFooterBtn.addEventListener('click', handleClose);
  
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  });
}


/**
 * Get AI advice for cellar organisation.
 */
async function handleGetAIAdvice() {
  const adviceEl = document.getElementById('analysis-ai-advice');
  if (!adviceEl) return;

  adviceEl.style.display = 'block';
  adviceEl.innerHTML = '<div class="analysis-loading">Getting AI advice... (this may take up to 2 minutes)</div>';

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

// ============================================================
// Zone Setup Wizard Functions
// ============================================================

/**
 * Start the zone setup wizard.
 */
async function startZoneSetup() {
  const wizard = document.getElementById('zone-setup-wizard');
  const proposalList = document.getElementById('zone-proposal-list');
  const step1 = document.getElementById('wizard-step-1');
  const step2 = document.getElementById('wizard-step-2');

  if (!wizard || !proposalList) return;

  // Show wizard, hide other sections
  wizard.style.display = 'block';
  step1.style.display = 'block';
  step2.style.display = 'none';
  document.getElementById('analysis-fridge')?.style.setProperty('display', 'none');
  document.getElementById('analysis-zones')?.style.setProperty('display', 'none');
  document.getElementById('analysis-moves')?.style.setProperty('display', 'none');
  document.getElementById('analysis-ai-advice')?.style.setProperty('display', 'none');

  proposalList.innerHTML = '<div class="analysis-loading">Generating zone layout proposal...</div>';

  try {
    currentProposal = await getZoneLayoutProposal();
    proposalList.innerHTML = renderZoneProposal(currentProposal);
  } catch (err) {
    proposalList.innerHTML = `<div class="ai-advice-error">Error: ${err.message}</div>`;
  }
}

/**
 * Render zone layout proposal as HTML.
 */
function renderZoneProposal(proposal) {
  if (!proposal.proposals || proposal.proposals.length === 0) {
    return '<p>No zones to configure - your cellar appears to be empty.</p>';
  }

  let html = `
    <div class="proposal-summary">
      <strong>${proposal.totalBottles} bottles</strong> across <strong>${proposal.proposals.length} zones</strong>
      using <strong>${proposal.totalRows} rows</strong>
    </div>
    <div class="proposal-zones">
  `;

  proposal.proposals.forEach((zone, idx) => {
    html += `
      <div class="proposal-zone-card">
        <div class="zone-card-header">
          <span class="zone-order">${idx + 1}</span>
          <span class="zone-name">${zone.displayName}</span>
          <span class="zone-rows">${zone.assignedRows.join(', ')}</span>
        </div>
        <div class="zone-card-stats">
          <span>${zone.bottleCount} bottles</span>
          <span>${zone.totalCapacity} slots</span>
          <span>${zone.utilizationPercent}% full</span>
        </div>
        <div class="zone-card-wines">
          ${zone.wines.slice(0, 3).map(w => `<small>${w.name} ${w.vintage || ''}</small>`).join(', ')}
          ${zone.wines.length > 3 ? `<small>+${zone.wines.length - 3} more</small>` : ''}
        </div>
      </div>
    `;
  });

  html += '</div>';

  if (proposal.unassignedRows?.length > 0) {
    html += `<p class="proposal-note">Unassigned rows: ${proposal.unassignedRows.join(', ')} (available for future growth)</p>`;
  }

  return html;
}

/**
 * Handle confirming the zone layout.
 */
async function handleConfirmLayout() {
  if (!currentProposal?.proposals) {
    showToast('No proposal to confirm');
    return;
  }

  const assignments = currentProposal.proposals.map(p => ({
    zoneId: p.zoneId,
    assignedRows: p.assignedRows,
    bottleCount: p.bottleCount
  }));

  try {
    await confirmZoneLayout(assignments);
    showToast('Zone layout confirmed! Generating moves...');

    // Move to step 2
    document.getElementById('wizard-step-1').style.display = 'none';
    document.getElementById('wizard-step-2').style.display = 'block';

    await loadZoneMoves();
  } catch (err) {
    showToast(`Error: ${err.message}`);
  }
}

/**
 * Load and display zone consolidation moves.
 */
async function loadZoneMoves() {
  const movesContainer = document.getElementById('zone-moves-wizard');
  if (!movesContainer) return;

  movesContainer.innerHTML = '<div class="analysis-loading">Calculating moves...</div>';

  try {
    currentZoneMoves = await getConsolidationMoves();
    currentZoneIndex = 0;
    renderZoneMovesList();
  } catch (err) {
    movesContainer.innerHTML = `<div class="ai-advice-error">Error: ${err.message}</div>`;
  }
}

/**
 * Render the zone-by-zone moves interface.
 */
function renderZoneMovesList() {
  const container = document.getElementById('zone-moves-wizard');
  if (!container || !currentZoneMoves) return;

  const { movesByZone, totalMoves } = currentZoneMoves;
  const zoneIds = Object.keys(movesByZone);

  if (totalMoves === 0) {
    container.innerHTML = `
      <div class="moves-complete">
        <h4>All bottles are already in their correct zones!</h4>
        <p>No moves needed. Your cellar is organized.</p>
        <button class="btn btn-primary finish-setup-btn">Finish</button>
      </div>
    `;
    container.querySelector('.finish-setup-btn')?.addEventListener('click', finishZoneSetup);
    return;
  }

  let html = `
    <div class="moves-summary">
      <strong>${totalMoves} moves</strong> needed across <strong>${zoneIds.length} zones</strong>
    </div>
    <div class="zone-moves-list">
  `;

  zoneIds.forEach((zoneId, idx) => {
    const moves = movesByZone[zoneId];
    const isActive = idx === currentZoneIndex;
    const isComplete = idx < currentZoneIndex;

    html += `
      <div class="zone-moves-section ${isActive ? 'active' : ''} ${isComplete ? 'complete' : ''}" data-zone="${escapeHtml(zoneId)}" data-zone-idx="${idx}">
        <div class="zone-moves-header expand-zone-btn" data-zone="${escapeHtml(zoneId)}" data-zone-idx="${idx}">
          <span class="zone-status-icon">${isComplete ? '✓' : isActive ? '→' : '○'}</span>
          <span class="zone-name">${escapeHtml(zoneId)}</span>
          <span class="zone-move-count">${moves.length} moves</span>
        </div>
        <div class="zone-moves-body" style="display: ${isActive ? 'block' : 'none'}">
          ${moves.map((m, mIdx) => `
            <div class="move-item" data-move-idx="${mIdx}">
              <span class="move-wine">${escapeHtml(m.wineName)} ${m.vintage || ''}</span>
              <span class="move-arrow">→</span>
              <span class="move-from">${m.fromSlot}</span>
              <span class="move-to">${m.toSlot}</span>
              <button class="btn btn-small btn-primary zone-move-btn" data-zone="${escapeHtml(zoneId)}" data-move-idx="${mIdx}">Move</button>
            </div>
          `).join('')}
          <div class="zone-moves-actions">
            <button class="btn btn-primary zone-execute-all-btn" data-zone="${escapeHtml(zoneId)}" data-move-count="${moves.length}">Execute All ${moves.length} Moves</button>
            <button class="btn btn-secondary skip-zone-btn">Skip Zone</button>
          </div>
        </div>
      </div>
    `;
  });

  html += `
    </div>
    <div class="wizard-footer">
      <button class="btn btn-secondary finish-setup-btn">Finish Setup</button>
    </div>
  `;

  container.innerHTML = html;

  // Attach event listeners (CSP-compliant)
  container.querySelectorAll('.expand-zone-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const zoneId = btn.dataset.zone;
      const idx = Number.parseInt(btn.dataset.zoneIdx, 10);
      expandZone(zoneId, idx);
    });
  });
  container.querySelectorAll('.zone-move-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const zoneId = btn.dataset.zone;
      const moveIdx = Number.parseInt(btn.dataset.moveIdx, 10);
      executeZoneMove(zoneId, moveIdx);
    });
  });
  container.querySelectorAll('.zone-execute-all-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const zoneId = btn.dataset.zone;
      executeAllZoneMoves(zoneId);
    });
  });
  container.querySelectorAll('.skip-zone-btn').forEach(btn => {
    btn.addEventListener('click', skipZone);
  });
  container.querySelectorAll('.finish-setup-btn').forEach(btn => {
    btn.addEventListener('click', finishZoneSetup);
  });
}

/**
 * Execute a single move within a zone.
 */
async function executeZoneMove(zoneId, moveIdx) {
  const moves = currentZoneMoves?.movesByZone?.[zoneId];
  if (!moves || !moves[moveIdx]) return;

  const move = moves[moveIdx];

  try {
    await executeCellarMoves([{
      wineId: move.wineId,
      from: move.fromSlot,
      to: move.toSlot,
      zoneId: move.zoneId
    }]);

    // Remove from list
    moves.splice(moveIdx, 1);
    currentZoneMoves.totalMoves--;

    showToast(`Moved ${move.wineName} to ${move.toSlot}`);
    renderZoneMovesList();
    refreshLayout();
  } catch (err) {
    showToast(`Error: ${err.message}`);
  }
}

/**
 * Execute all moves for a zone.
 */
async function executeAllZoneMoves(zoneId) {
  const moves = currentZoneMoves?.movesByZone?.[zoneId];
  if (!moves || moves.length === 0) return;

  const movesToExecute = moves.map(m => ({
    wineId: m.wineId,
    from: m.fromSlot,
    to: m.toSlot,
    zoneId: m.zoneId
  }));

  try {
    const result = await executeCellarMoves(movesToExecute);
    showToast(`Executed ${result.moved} moves for ${zoneId}`);

    // Clear moves and advance
    currentZoneMoves.totalMoves -= moves.length;
    currentZoneMoves.movesByZone[zoneId] = [];
    currentZoneIndex++;

    renderZoneMovesList();
    refreshLayout();
  } catch (err) {
    showToast(`Error: ${err.message}`);
  }
}

/**
 * Skip to next zone.
 */
function skipZone() {
  const zoneIds = Object.keys(currentZoneMoves?.movesByZone || {});
  if (currentZoneIndex < zoneIds.length - 1) {
    currentZoneIndex++;
    renderZoneMovesList();
  }
}

/**
 * Expand a specific zone section.
 */
function expandZone(zoneId, idx) {
  currentZoneIndex = idx;
  renderZoneMovesList();
}

/**
 * Cancel zone setup and return to normal view.
 */
function cancelZoneSetup() {
  document.getElementById('zone-setup-wizard').style.display = 'none';
  currentProposal = null;
  loadAnalysis();
}

/**
 * Finish zone setup wizard.
 */
function finishZoneSetup() {
  document.getElementById('zone-setup-wizard').style.display = 'none';
  currentProposal = null;
  currentZoneMoves = null;
  showToast('Zone setup complete!');
  loadAnalysis();
}

// ============================================================
// Zone Classification Chat Functions
// ============================================================

/**
 * Toggle zone chat panel visibility.
 */
function toggleZoneChat() {
  const chatPanel = document.getElementById('zone-chat-panel');
  if (!chatPanel) return;

  const isVisible = chatPanel.style.display !== 'none';
  chatPanel.style.display = isVisible ? 'none' : 'block';

  if (!isVisible) {
    // Focus input when opening
    document.getElementById('zone-chat-input')?.focus();
  }
}

/**
 * Send a zone chat message.
 */
async function sendZoneChatMessage() {
  const input = document.getElementById('zone-chat-input');
  const messagesEl = document.getElementById('zone-chat-messages');
  const sendBtn = document.getElementById('zone-chat-send-btn');

  if (!input || !messagesEl) return;

  const message = input.value.trim();
  if (!message) return;

  // Add user message to chat
  const userMsg = document.createElement('div');
  userMsg.className = 'chat-message user';
  userMsg.innerHTML = `<div class="chat-content">${escapeHtml(message)}</div>`;
  messagesEl.appendChild(userMsg);

  input.value = '';
  input.disabled = true;
  if (sendBtn) sendBtn.disabled = true;

  // Add thinking indicator
  const thinkingMsg = document.createElement('div');
  thinkingMsg.className = 'chat-message assistant thinking';
  thinkingMsg.innerHTML = '<div class="chat-content"><div class="chat-typing"><span></span><span></span><span></span></div></div>';
  messagesEl.appendChild(thinkingMsg);
  messagesEl.scrollTop = messagesEl.scrollHeight;

  try {
    const result = await zoneChatMessage(message, zoneChatContext);

    // Remove thinking indicator
    thinkingMsg.remove();

    // Add AI response
    const aiMsg = document.createElement('div');
    aiMsg.className = 'chat-message assistant';
    aiMsg.innerHTML = `<div class="chat-content">${formatZoneChatResponse(result)}</div>`;
    messagesEl.appendChild(aiMsg);

    // Store context for follow-up
    zoneChatContext = result.context;

    // If there are reclassifications, show action buttons
    if (result.reclassifications && result.reclassifications.length > 0) {
      const actionsEl = renderReclassificationActions(result.reclassifications);
      messagesEl.appendChild(actionsEl);
    }

    messagesEl.scrollTop = messagesEl.scrollHeight;
  } catch (err) {
    thinkingMsg.remove();
    const errMsg = document.createElement('div');
    errMsg.className = 'chat-message assistant error';
    errMsg.innerHTML = `<div class="chat-content">Error: ${escapeHtml(err.message)}</div>`;
    messagesEl.appendChild(errMsg);
  } finally {
    input.disabled = false;
    if (sendBtn) sendBtn.disabled = false;
    input.focus();
  }
}

/**
 * Format zone chat response for display.
 * @param {Object} result - Chat result
 * @returns {string} Formatted HTML
 */
function formatZoneChatResponse(result) {
  // Convert newlines to <br> and paragraphs
  return result.response
    .split('\n\n')
    .map(p => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

/**
 * Render reclassification action buttons.
 * @param {Array} reclassifications - Suggested reclassifications
 * @returns {HTMLElement} Actions element with event listeners attached
 */
function renderReclassificationActions(reclassifications) {
  const container = document.createElement('div');
  container.className = 'zone-chat-actions';
  container.innerHTML = '<p class="actions-title">Suggested zone changes:</p>';

  reclassifications.forEach((r) => {
    const itemEl = document.createElement('div');
    itemEl.className = 'reclassification-item';
    itemEl.dataset.wineId = r.wineId;
    itemEl.dataset.suggestedZone = r.suggestedZone;
    itemEl.dataset.reason = r.reason || '';

    itemEl.innerHTML = `
      <div class="reclassification-info">
        <span class="wine-name">${escapeHtml(r.wineName)}</span>
        <span class="zone-change">${escapeHtml(r.currentZone)} → ${escapeHtml(r.suggestedZone)}</span>
        ${r.reason ? `<span class="reclassification-reason">${escapeHtml(r.reason)}</span>` : ''}
      </div>
      <button class="btn btn-small btn-primary apply-btn">Apply</button>
    `;

    // Attach event listener for apply button
    const applyBtn = itemEl.querySelector('.apply-btn');
    applyBtn.addEventListener('click', () => {
      applyReclassification(r.wineId, r.suggestedZone, r.reason || '', applyBtn);
    });

    container.appendChild(itemEl);
  });

  const applyAllBtn = document.createElement('button');
  applyAllBtn.className = 'btn btn-secondary apply-all-btn';
  applyAllBtn.textContent = `Apply All (${reclassifications.length})`;
  applyAllBtn.addEventListener('click', applyAllReclassifications);
  container.appendChild(applyAllBtn);

  return container;
}

/**
 * Apply a single reclassification.
 * @param {number} wineId - Wine ID
 * @param {string} newZoneId - New zone ID
 * @param {string} reason - Reason for change
 * @param {HTMLElement} buttonEl - The button that was clicked
 */
async function applyReclassification(wineId, newZoneId, reason, buttonEl) {
  try {
    const result = await reassignWineZone(wineId, newZoneId, reason);
    showToast(`Reclassified "${result.wineName}" to ${result.newZone} zone`);

    // Mark this item as applied in the UI
    if (buttonEl) {
      const itemEl = buttonEl.closest('.reclassification-item');
      if (itemEl) {
        itemEl.classList.add('applied');
        buttonEl.textContent = 'Applied';
        buttonEl.disabled = true;
      }
    }

    // Update "Apply All" button count
    updateApplyAllCount();

    // Refresh analysis if we have one
    if (currentProposal) {
      currentProposal = await getZoneLayoutProposal();
      const proposalEl = document.getElementById('zone-proposal-list');
      if (proposalEl) {
        proposalEl.innerHTML = renderZoneProposal(currentProposal);
      }
    }
  } catch (err) {
    showToast(`Error: ${err.message}`);
  }
}

/**
 * Update the "Apply All" button to reflect remaining items.
 */
function updateApplyAllCount() {
  const actionsEl = document.querySelector('.zone-chat-actions');
  if (!actionsEl) return;

  const remaining = actionsEl.querySelectorAll('.reclassification-item:not(.applied)').length;
  const applyAllBtn = actionsEl.querySelector('.apply-all-btn');

  if (applyAllBtn) {
    if (remaining === 0) {
      applyAllBtn.textContent = 'All Applied';
      applyAllBtn.disabled = true;
    } else {
      applyAllBtn.textContent = `Apply All (${remaining})`;
    }
  }
}

/**
 * Apply all suggested reclassifications.
 */
async function applyAllReclassifications() {
  // Extract reclassifications from last chat message
  if (!zoneChatContext?.history) return;

  // Get the last assistant message with reclassifications
  const lastMsg = [...zoneChatContext.history].reverse().find(m => m.role === 'assistant');
  if (!lastMsg) return;

  const jsonMatch = lastMsg.content.match(/```json\s*([\s\S]*?)\s*```/);
  if (!jsonMatch) return;

  try {
    const parsed = JSON.parse(jsonMatch[1]);
    if (!parsed.reclassifications || parsed.reclassifications.length === 0) {
      showToast('No reclassifications to apply');
      return;
    }

    let applied = 0;
    for (const r of parsed.reclassifications) {
      try {
        await reassignWineZone(r.wineId, r.suggestedZone, r.reason || 'Chat suggestion');
        applied++;

        // Mark item as applied in UI
        const itemEl = document.querySelector(`.reclassification-item[data-wine-id="${r.wineId}"]`);
        if (itemEl) {
          itemEl.classList.add('applied');
          const btn = itemEl.querySelector('.apply-btn');
          if (btn) {
            btn.textContent = 'Applied';
            btn.disabled = true;
          }
        }
      } catch (itemErr) {
        console.error(`Failed to reclassify wine ${r.wineId}:`, itemErr);
      }
    }

    showToast(`Reclassified ${applied} wine${applied !== 1 ? 's' : ''}`);

    // Update Apply All button
    const applyAllBtn = document.querySelector('.apply-all-btn');
    if (applyAllBtn) {
      applyAllBtn.textContent = 'All Applied';
      applyAllBtn.disabled = true;
    }

    // Refresh proposal if showing
    if (currentProposal) {
      currentProposal = await getZoneLayoutProposal();
      const proposalEl = document.getElementById('zone-proposal-list');
      if (proposalEl) {
        proposalEl.innerHTML = renderZoneProposal(currentProposal);
      }
    }
  } catch (err) {
    showToast(`Error: ${err.message}`);
  }
}

/**
 * Clear zone chat history.
 */
function clearZoneChat() {
  const messagesEl = document.getElementById('zone-chat-messages');
  if (messagesEl) {
    messagesEl.innerHTML = '<div class="zone-chat-welcome">Ask me about wine zone classifications. For example: "Why is my Appassimento in the dessert zone?" or "Move Cabernet wines to a different zone."</div>';
  }
  zoneChatContext = null;
}

// Note: All onclick handlers have been refactored to use addEventListener
// for CSP compliance. The window.cellarAnalysis object is no longer needed.
