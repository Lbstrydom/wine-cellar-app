/**
 * @fileoverview Shared state for cellar analysis module.
 * @module cellarAnalysis/state
 */

/**
 * Module state for cellar analysis.
 */
export const analysisState = {
  currentAnalysis: null,
  analysisLoaded: false,
  currentProposal: null,
  currentZoneMoves: null,
  currentZoneIndex: 0,
  zoneChatContext: null,
  fridgeOrganizeMoves: null
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
 * Reset zone chat state.
 */
export function resetZoneChatState() {
  analysisState.zoneChatContext = null;
}

/**
 * Reset all analysis state.
 */
export function resetAnalysisState() {
  analysisState.currentAnalysis = null;
  analysisState.analysisLoaded = false;
  analysisState.currentProposal = null;
  analysisState.currentZoneMoves = null;
  analysisState.currentZoneIndex = 0;
  analysisState.zoneChatContext = null;
  analysisState.fridgeOrganizeMoves = null;
}
