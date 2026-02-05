/**
 * @fileoverview Health monitoring, backup, stats, and history API calls.
 * @module api/health
 */

import { API_BASE, apiFetch, handleResponse, downloadBlob } from './base.js';

const fetch = apiFetch;

// ============================================
// Layout, Stats & History
// ============================================

/**
 * Fetch cellar layout.
 * @returns {Promise<Object>}
 */
export async function fetchLayout() {
  const res = await fetch(`${API_BASE}/api/stats/layout`);
  return handleResponse(res, 'Failed to fetch layout');
}

/**
 * Fetch cellar layout in lite mode (structure only).
 * @returns {Promise<Object>}
 */
export async function fetchLayoutLite() {
  const res = await fetch(`${API_BASE}/api/stats/layout?lite=true`);
  return handleResponse(res, 'Failed to fetch layout (lite)');
}

/**
 * Fetch statistics.
 * @returns {Promise<Object>}
 */
export async function fetchStats() {
  const res = await fetch(`${API_BASE}/api/stats`);
  return handleResponse(res, 'Failed to fetch stats');
}

/**
 * Fetch reduce-now list.
 * @returns {Promise<Array>}
 */
export async function fetchReduceNow() {
  const res = await fetch(`${API_BASE}/api/reduce-now`);
  return handleResponse(res, 'Failed to fetch reduce-now list');
}

/**
 * Fetch consumption history.
 * @param {number} limit - Max items to fetch
 * @param {number} offset - Offset for pagination
 * @returns {Promise<{items: Array, total: number}>}
 */
export async function fetchConsumptionHistory(limit = 50, offset = 0) {
  const res = await fetch(`${API_BASE}/api/stats/consumption?limit=${limit}&offset=${offset}`);
  return handleResponse(res, 'Failed to fetch consumption history');
}

// ============================================
// Cellar Health Dashboard
// ============================================

/**
 * Get full cellar health report.
 * @returns {Promise<Object>} Health report with metrics, alerts, and actions
 */
export async function getCellarHealth() {
  const res = await fetch(`${API_BASE}/api/health`);
  return handleResponse(res, 'Failed to get cellar health');
}

/**
 * Get health score only.
 * @returns {Promise<Object>} Health score and breakdown
 */
export async function getCellarHealthScore() {
  const res = await fetch(`${API_BASE}/api/health/score`);
  return handleResponse(res, 'Failed to get health score');
}

/**
 * Get health alerts only.
 * @returns {Promise<Object>} Active alerts
 */
export async function getCellarHealthAlerts() {
  const res = await fetch(`${API_BASE}/api/health/alerts`);
  return handleResponse(res, 'Failed to get health alerts');
}

/**
 * Get at-risk wines (approaching or past drinking windows).
 * @param {number} [limit=20] - Max wines to return
 * @returns {Promise<Object>} At-risk wines list
 */
export async function getAtRiskWines(limit = 20) {
  const res = await fetch(`${API_BASE}/api/health/at-risk?limit=${limit}`);
  return handleResponse(res, 'Failed to get at-risk wines');
}

/**
 * Execute fill fridge action - move ready-to-drink wines to fridge.
 * @param {number} [maxMoves=5] - Maximum wines to move
 * @returns {Promise<Object>} Moves executed
 */
export async function executeFillFridge(maxMoves = 5) {
  const res = await fetch(`${API_BASE}/api/health/fill-fridge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ maxMoves })
  });
  return handleResponse(res, 'Failed to fill fridge');
}

/**
 * Generate shopping list based on cellar gaps.
 * @returns {Promise<Object>} Shopping suggestions
 */
export async function generateShoppingList() {
  const res = await fetch(`${API_BASE}/api/health/shopping-list`);
  return handleResponse(res, 'Failed to generate shopping list');
}

// ============================================
// Backup & Restore
// ============================================

/**
 * Get backup metadata (counts for UI display).
 * @returns {Promise<Object>} Backup info with wine/slot/history counts
 */
export async function getBackupInfo() {
  const res = await fetch(`${API_BASE}/api/backup/info`);
  return handleResponse(res, 'Failed to get backup info');
}

/**
 * Export cellar data as JSON and trigger download.
 * @returns {Promise<void>}
 */
export async function exportBackupJSON() {
  const res = await fetch(`${API_BASE}/api/backup/export/json`);
  if (!res.ok) {
    throw new Error('Failed to export backup');
  }
  const blob = await res.blob();
  const filename = res.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1]
    || `cellar-backup-${new Date().toISOString().split('T')[0]}.json`;
  downloadBlob(blob, filename);
}

/**
 * Export wine list as CSV and trigger download.
 * @returns {Promise<void>}
 */
export async function exportBackupCSV() {
  const res = await fetch(`${API_BASE}/api/backup/export/csv`);
  if (!res.ok) {
    throw new Error('Failed to export CSV');
  }
  const blob = await res.blob();
  const filename = res.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1]
    || `wine-list-${new Date().toISOString().split('T')[0]}.csv`;
  downloadBlob(blob, filename);
}

/**
 * Import cellar data from backup.
 * @param {Object} backup - Backup payload
 * @param {Object} options - Import options
 * @returns {Promise<Object>}
 */
export async function importBackup(backup, options = {}) {
  const res = await fetch(`${API_BASE}/api/backup/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ backup, options })
  });
  return handleResponse(res, 'Failed to import backup');
}
