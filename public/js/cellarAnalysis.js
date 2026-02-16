/**
 * @fileoverview Cellar analysis module - main entry point.
 * Handles cellar analysis UI, move suggestions, fridge organization, zone narratives, and AI advice.
 *
 * This module was refactored from 1700+ lines into focused sub-modules:
 * - cellarAnalysis/state.js - Shared module state
 * - cellarAnalysis/analysis.js - Main analysis loading and rendering
 * - cellarAnalysis/moves.js - Move suggestions and execution
 * - cellarAnalysis/fridge.js - Fridge-specific functionality
 * - cellarAnalysis/zones.js - Zone narratives and setup wizard
 * - cellarAnalysis/zoneChat.js - AI zone chat functionality
 * - cellarAnalysis/aiAdvice.js - AI organization advice
 *
 * @module cellarAnalysis
 */

// Re-export state accessors
export {
  getCurrentAnalysis,
  isAnalysisLoaded
} from './cellarAnalysis/state.js';

// Re-export analysis functions
export {
  loadAnalysis,
  refreshAnalysis
} from './cellarAnalysis/analysis.js';

// Import sub-modules for initialization
import { loadAnalysis, refreshAnalysis } from './cellarAnalysis/analysis.js';
import { handleExecuteAllMoves } from './cellarAnalysis/moves.js';
import { handleGetAIAdvice } from './cellarAnalysis/aiAdvice.js';
import { handleConfirmLayout, cancelZoneSetup } from './cellarAnalysis/zones.js';
import { toggleZoneChat, sendZoneChatMessage } from './cellarAnalysis/zoneChat.js';
import { switchWorkspace, getActiveWorkspace, isAnalysisLoaded } from './cellarAnalysis/state.js';
import { initVisibilityRefresh } from './cellarAnalysis/freshness.js';

/**
 * Initialize cellar analysis UI handlers.
 */
export function initCellarAnalysis() {
  const refreshBtn = document.getElementById('refresh-analysis-btn');
  const executeAllBtn = document.getElementById('execute-all-moves-btn');
  const getAIAdviceBtn = document.getElementById('get-ai-advice-btn');
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

  // Workspace toggle tabs
  const workspaceToggle = document.getElementById('analysis-workspace-toggle');
  if (workspaceToggle) {
    workspaceToggle.addEventListener('click', (e) => {
      const tab = e.target.closest('.workspace-tab');
      if (tab && tab.dataset.workspace) {
        switchWorkspace(tab.dataset.workspace);
      }
    });
  }

  // Restore persisted workspace on init (survives page reloads)
  const persisted = getActiveWorkspace();
  if (persisted !== 'zones') {
    switchWorkspace(persisted);
  }

  // Auto-refresh analysis when tab regains focus with stale data
  initVisibilityRefresh();
}

