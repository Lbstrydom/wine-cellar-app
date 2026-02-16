/**
 * @fileoverview Cellar zone management, reconfiguration, and analysis API calls.
 * @module api/cellar
 */

import { API_BASE, apiFetch, handleResponse } from './base.js';

const fetch = apiFetch;

/**
 * Get all zone definitions.
 * @returns {Promise<Object>}
 */
export async function getCellarZones() {
  const res = await fetch(`${API_BASE}/api/cellar/zones`);
  return handleResponse(res, 'Failed to fetch zones');
}

/**
 * Get current zone -> row mapping.
 * @returns {Promise<Object>}
 */
export async function getZoneMap() {
  const res = await fetch(`${API_BASE}/api/cellar/zone-map`);
  return handleResponse(res, 'Failed to fetch zone map');
}

/**
 * Get placement suggestion for a wine.
 * @param {number} wineId - Wine ID
 * @returns {Promise<Object>}
 */
export async function getSuggestedPlacement(wineId) {
  const res = await fetch(`${API_BASE}/api/cellar/suggest-placement/${wineId}`);
  return handleResponse(res, 'Failed to get placement suggestion');
}

/**
 * Get placement suggestion for a new wine (not yet in DB).
 * @param {Object} wine - Wine details
 * @returns {Promise<Object>}
 */
export async function suggestPlacement(wine) {
  const res = await fetch(`${API_BASE}/api/cellar/suggest-placement`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wine })
  });
  return handleResponse(res, 'Failed to get placement suggestion');
}

/**
 * Check if the analysis cache is still valid.
 * Lightweight call — returns cache info without running analysis.
 * @returns {Promise<{cached: boolean, isValid?: boolean, createdAt?: string}>}
 */
export async function checkAnalysisFreshness() {
  const res = await fetch(`${API_BASE}/api/cellar/analyse/cache-info`);
  return handleResponse(res, 'Failed to check analysis freshness');
}

/**
 * Get full cellar analysis.
 * @param {boolean} [forceRefresh=false] - Force fresh analysis ignoring cache
 * @param {Object} [options={}] - Additional options
 * @param {boolean} [options.allowFallback=false] - Allow fallback analysis
 * @returns {Promise<Object>}
 */
export async function analyseCellar(forceRefresh = false, options = {}) {
  const { allowFallback = false } = options;
  const params = new URLSearchParams();
  if (forceRefresh) params.set('refresh', 'true');
  if (allowFallback) params.set('allowFallback', 'true');
  const qs = params.toString();
  const url = qs
    ? `${API_BASE}/api/cellar/analyse?${qs}`
    : `${API_BASE}/api/cellar/analyse`;
  const res = await fetch(url);
  return handleResponse(res, 'Failed to analyse cellar');
}


/**
 * Allocate a new row to a zone.
 * @param {string} zoneId
 * @returns {Promise<Object>}
 */
export async function allocateZoneRow(zoneId) {
  const res = await fetch(`${API_BASE}/api/cellar/zones/allocate-row`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ zoneId })
  });
  return handleResponse(res, 'Failed to allocate row to zone');
}

/**
 * Merge one zone into another.
 * @param {string} sourceZoneId
 * @param {string} targetZoneId
 * @returns {Promise<Object>}
 */
export async function mergeZones(sourceZoneId, targetZoneId) {
  const res = await fetch(`${API_BASE}/api/cellar/zones/merge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sourceZoneId, targetZoneId })
  });
  return handleResponse(res, 'Failed to merge zones');
}

/**
 * Generate a holistic reconfiguration plan.
 * Plan generation involves AI calls that can take 2-3 minutes.
 * @param {{includeRetirements?: boolean, includeNewZones?: boolean, stabilityBias?: 'low'|'moderate'|'high'}} options
 * @returns {Promise<Object>}
 */
export async function getReconfigurationPlan(options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 240000); // 4 minute timeout

  try {
    const res = await fetch(`${API_BASE}/api/cellar/reconfiguration-plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options),
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return handleResponse(res, 'Failed to generate reconfiguration plan');
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error('Reconfiguration plan timed out after 4 minutes. Please try again.');
    }
    throw err;
  }
}

/**
 * Generate a zone reconfiguration plan scoped to a single overflowing zone.
 * Uses the full 3-layer pipeline but filters output to relevant actions.
 * @param {string} zoneId - The overflowing zone to fix
 * @returns {Promise<Object>} { success, planId, plan }
 */
export async function getZoneReconfigurationPlan(zoneId) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 240000);

  try {
    const res = await fetch(`${API_BASE}/api/cellar/reconfiguration-plan/zone/${encodeURIComponent(zoneId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return handleResponse(res, 'Failed to generate zone fix plan');
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error('Zone fix plan timed out. Please try again.');
    }
    throw err;
  }
}

/**
 * Apply a previously generated reconfiguration plan.
 * @param {string} planId
 * @param {number[]} [skipActions]
 * @returns {Promise<Object>}
 */
export async function applyReconfigurationPlan(planId, skipActions = []) {
  const res = await fetch(`${API_BASE}/api/cellar/reconfiguration-plan/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ planId, skipActions })
  });
  return handleResponse(res, 'Failed to apply reconfiguration plan');
}

/**
 * Undo an applied reconfiguration.
 * @param {number} reconfigurationId
 * @returns {Promise<Object>}
 */
export async function undoReconfiguration(reconfigurationId) {
  const res = await fetch(`${API_BASE}/api/cellar/reconfiguration/${reconfigurationId}/undo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });
  return handleResponse(res, 'Failed to undo reconfiguration');
}

/**
 * Get AI-enhanced cellar analysis.
 * AI analysis can take 60-120 seconds, so we use a long timeout.
 * @returns {Promise<Object>}
 */
export async function analyseCellarAI() {
  // Use cache: 'no-store' to bypass service worker caching
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 240000); // 4 minute timeout

  try {
    const res = await fetch(`${API_BASE}/api/cellar/analyse/ai`, {
      cache: 'no-store',
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return handleResponse(res, 'Failed to get AI analysis');
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error('AI analysis timed out. Please try again.');
    }
    throw err;
  }
}

/**
 * Execute wine moves.
 * @param {Array} moves - Array of {wineId, from, to, zoneId}
 * @returns {Promise<Object>}
 */
export async function executeCellarMoves(moves) {
  const res = await fetch(`${API_BASE}/api/cellar/execute-moves`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ moves })
  });
  return handleResponse(res, 'Failed to execute moves');
}

/**
 * Manually assign a wine to a zone.
 * @param {number} wineId - Wine ID
 * @param {string} zoneId - Zone ID
 * @returns {Promise<Object>}
 */
export async function assignWineToZone(wineId, zoneId) {
  const res = await fetch(`${API_BASE}/api/cellar/assign-zone`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wineId, zoneId, confidence: 'manual' })
  });
  return handleResponse(res, 'Failed to assign zone');
}

/**
 * Get suggested moves to organize fridge by category.
 * @returns {Promise<Object>}
 */
export async function getFridgeOrganization() {
  const res = await fetch(`${API_BASE}/api/cellar/fridge-organize`);
  return handleResponse(res, 'Failed to get fridge organization');
}

/**
 * Get proposed zone layout based on collection.
 * @returns {Promise<Object>}
 */
export async function getZoneLayoutProposal() {
  const res = await fetch(`${API_BASE}/api/cellar/zone-layout/propose`);
  return handleResponse(res, 'Failed to get zone layout proposal');
}

/**
 * Get current saved zone layout.
 * @returns {Promise<Object>}
 */
export async function getZoneLayout() {
  const res = await fetch(`${API_BASE}/api/cellar/zone-layout`);
  return handleResponse(res, 'Failed to get zone layout');
}

/**
 * Confirm and save zone layout.
 * @param {Array} assignments - Array of { zoneId, assignedRows, bottleCount }
 * @returns {Promise<Object>}
 */
export async function confirmZoneLayout(assignments) {
  const res = await fetch(`${API_BASE}/api/cellar/zone-layout/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assignments })
  });
  return handleResponse(res, 'Failed to confirm zone layout');
}

/**
 * Get consolidation moves for confirmed zone layout.
 * @returns {Promise<Object>}
 */
export async function getConsolidationMoves() {
  const res = await fetch(`${API_BASE}/api/cellar/zone-layout/moves`);
  return handleResponse(res, 'Failed to get consolidation moves');
}

/**
 * Send zone classification chat message.
 * @param {string} message - User message
 * @param {Object} context - Previous chat context
 * @returns {Promise<Object>} AI response
 */
export async function zoneChatMessage(message, context = null) {
  const res = await fetch(`${API_BASE}/api/cellar/zone-chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, context })
  });
  return handleResponse(res, 'Failed to send zone chat message');
}

/**
 * Reassign a wine to a different zone.
 * @param {number} wineId - Wine ID
 * @param {string} newZoneId - New zone ID
 * @param {string} reason - Reason for reassignment
 * @returns {Promise<Object>}
 */
export async function reassignWineZone(wineId, newZoneId, reason = '') {
  const res = await fetch(`${API_BASE}/api/cellar/zone-reassign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wineId, newZoneId, reason })
  });
  return handleResponse(res, 'Failed to reassign wine zone');
}
