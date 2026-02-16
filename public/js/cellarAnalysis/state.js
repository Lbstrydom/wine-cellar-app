/**
 * @fileoverview Shared state for cellar analysis module.
 * @module cellarAnalysis/state
 */

/**
 * Module state for cellar analysis.
 */
/** @type {'zones'|'placement'|'fridge'} */
const DEFAULT_WORKSPACE = 'zones';
const VALID_WORKSPACES = ['zones', 'placement', 'fridge'];
const WORKSPACE_STORAGE_KEY = 'cellar-analysis-workspace';

/**
 * Load persisted workspace from localStorage, falling back to default.
 * @returns {'zones'|'placement'|'fridge'}
 */
function loadPersistedWorkspace() {
  try {
    const stored = localStorage.getItem(WORKSPACE_STORAGE_KEY);
    if (stored && VALID_WORKSPACES.includes(stored)) return stored;
  } catch (_) { /* localStorage unavailable */ }
  return DEFAULT_WORKSPACE;
}

export const analysisState = {
  currentAnalysis: null,
  analysisLoaded: false,
  currentProposal: null,
  currentZoneMoves: null,
  currentZoneIndex: 0,
  zoneChatContext: null,
  fridgeOrganizeMoves: null,
  activeWorkspace: loadPersistedWorkspace(),
  /** @type {Map<number, {judgment: 'confirmed'|'modified'|'rejected', reason?: string, to?: string, toZone?: string}>|null} */
  aiMoveJudgments: null
};

/**
 * Get current analysis data.
 * @returns {Object|null} Current analysis report
 */
export function getCurrentAnalysis() {
  return analysisState.currentAnalysis;
}

/**
 * Set current analysis data.
 * @param {Object} analysis - Analysis report from API
 */
export function setCurrentAnalysis(analysis) {
  analysisState.currentAnalysis = analysis;
}

/**
 * Check if analysis has been loaded.
 * @returns {boolean}
 */
export function isAnalysisLoaded() {
  return analysisState.analysisLoaded;
}

/**
 * Set analysis loaded state.
 * @param {boolean} loaded
 */
export function setAnalysisLoaded(loaded) {
  analysisState.analysisLoaded = loaded;
}

/**
 * Get current zone layout proposal.
 * @returns {Object|null}
 */
export function getCurrentProposal() {
  return analysisState.currentProposal;
}

/**
 * Set current zone layout proposal.
 * @param {Object|null} proposal
 */
export function setCurrentProposal(proposal) {
  analysisState.currentProposal = proposal;
}

/**
 * Get current zone moves.
 * @returns {Object|null}
 */
export function getCurrentZoneMoves() {
  return analysisState.currentZoneMoves;
}

/**
 * Set current zone moves.
 * @param {Object|null} moves
 */
export function setCurrentZoneMoves(moves) {
  analysisState.currentZoneMoves = moves;
}

/**
 * Get current zone index in wizard.
 * @returns {number}
 */
export function getCurrentZoneIndex() {
  return analysisState.currentZoneIndex;
}

/**
 * Set current zone index in wizard.
 * @param {number} index
 */
export function setCurrentZoneIndex(index) {
  analysisState.currentZoneIndex = index;
}

/**
 * Get zone chat context.
 * @returns {Object|null}
 */
export function getZoneChatContext() {
  return analysisState.zoneChatContext;
}

/**
 * Set zone chat context.
 * @param {Object|null} context
 */
export function setZoneChatContext(context) {
  analysisState.zoneChatContext = context;
}

/**
 * Get active workspace tab.
 * @returns {'zones'|'placement'|'fridge'}
 */
export function getActiveWorkspace() {
  return analysisState.activeWorkspace;
}

/**
 * Set active workspace tab (state only, no DOM update).
 * @param {'zones'|'placement'|'fridge'} workspace
 */
export function setActiveWorkspace(workspace) {
  analysisState.activeWorkspace = workspace;
}

/**
 * Switch the active workspace: updates state, tab highlights, and panel visibility.
 * Shared helper so both cellarAnalysis.js (user click) and analysis.js (auto-switch)
 * use the same logic without circular imports.
 * @param {'zones'|'placement'|'fridge'} workspace
 */
export function switchWorkspace(workspace) {
  analysisState.activeWorkspace = workspace;

  // Persist so the workspace survives page reloads
  try { localStorage.setItem(WORKSPACE_STORAGE_KEY, workspace); } catch (_) { /* noop */ }

  const tabs = document.querySelectorAll('.workspace-tab');
  tabs.forEach(tab => {
    tab.classList.toggle('active', tab.dataset.workspace === workspace);
    // Clear notification badge when switching TO that workspace
    if (tab.dataset.workspace === workspace) {
      tab.classList.remove('workspace-tab--notified');
    }
  });

  const panels = document.querySelectorAll('.workspace-panel');
  panels.forEach(panel => {
    panel.style.display = panel.dataset.workspace === workspace ? '' : 'none';
  });
}

/**
 * Show a notification badge on a workspace tab to signal new content.
 * Does nothing if the user is already viewing that workspace.
 * @param {'zones'|'placement'|'fridge'} workspace - Tab to badge
 */
export function notifyWorkspaceTab(workspace) {
  if (analysisState.activeWorkspace === workspace) return;
  const tab = document.querySelector(`.workspace-tab[data-workspace="${workspace}"]`);
  if (tab) tab.classList.add('workspace-tab--notified');
}

/**
 * Get AI move judgments map (wineId -> judgment).
 * @returns {Map|null}
 */
export function getAIMoveJudgments() {
  return analysisState.aiMoveJudgments;
}

/**
 * Set AI move judgments map.
 * @param {Map|null} judgments
 */
export function setAIMoveJudgments(judgments) {
  analysisState.aiMoveJudgments = judgments;
}

/**
 * Reset zone chat state.
 */
function resetZoneChatState() {
  analysisState.zoneChatContext = null;
}

/**
 * Reset all analysis state.
 */
function resetAnalysisState() {
  analysisState.currentAnalysis = null;
  analysisState.analysisLoaded = false;
  analysisState.currentProposal = null;
  analysisState.currentZoneMoves = null;
  analysisState.currentZoneIndex = 0;
  analysisState.zoneChatContext = null;
  analysisState.fridgeOrganizeMoves = null;
  analysisState.activeWorkspace = DEFAULT_WORKSPACE;
  analysisState.aiMoveJudgments = null;
  try { localStorage.removeItem(WORKSPACE_STORAGE_KEY); } catch (_) { /* noop */ }
}
