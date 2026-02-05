/**
 * @fileoverview Settings, credentials, and reduce-now rules API calls.
 * @module api/settings
 */

import { API_BASE, apiFetch, handleResponse } from './base.js';

const fetch = apiFetch;

/**
 * Get user settings.
 * @returns {Promise<Object>}
 */
export async function getSettings() {
  const res = await fetch(`${API_BASE}/api/settings`);
  return handleResponse(res, 'Failed to get settings');
}

/**
 * Update a setting.
 * @param {string} key - Setting key
 * @param {string} value - Setting value
 * @returns {Promise<Object>}
 */
export async function updateSetting(key, value) {
  const res = await fetch(`${API_BASE}/api/settings/${key}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value })
  });
  return handleResponse(res, 'Failed to update setting');
}

// ============================================
// Credential Management API
// ============================================

/**
 * Get configured credentials (status only, no secrets).
 * @returns {Promise<{encryption_configured: boolean, credentials: Array}>}
 */
export async function getCredentials() {
  const res = await fetch(`${API_BASE}/api/settings/credentials`);
  return handleResponse(res, 'Failed to get credentials');
}

/**
 * Save credentials for a source.
 * @param {string} source - Source ID (vivino, decanter, cellartracker)
 * @param {string} username - Username/email
 * @param {string} password - Password
 * @returns {Promise<Object>}
 */
export async function saveCredentials(source, username, password) {
  const res = await fetch(`${API_BASE}/api/settings/credentials/${source}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  return handleResponse(res, 'Failed to save credentials');
}

/**
 * Delete credentials for a source.
 * @param {string} source - Source ID
 * @returns {Promise<Object>}
 */
export async function deleteCredentials(source) {
  const res = await fetch(`${API_BASE}/api/settings/credentials/${source}`, {
    method: 'DELETE'
  });
  return handleResponse(res, 'Failed to delete credentials');
}

/**
 * Test credentials for a source.
 * @param {string} source - Source ID
 * @returns {Promise<{success: boolean, message: string}>}
 */
export async function testCredentials(source) {
  const res = await fetch(`${API_BASE}/api/settings/credentials/${source}/test`, {
    method: 'POST'
  });
  return handleResponse(res, 'Failed to test credentials');
}

// ============================================
// Reduce-Now Auto Rules API
// ============================================

/**
 * Evaluate wines against auto-rules.
 * @returns {Promise<{enabled: boolean, rules: Object, candidates: Array}>}
 */
export async function evaluateReduceRules() {
  const res = await fetch(`${API_BASE}/api/reduce-now/evaluate`, {
    method: 'POST'
  });
  return handleResponse(res, 'Failed to evaluate rules');
}

/**
 * Batch add wines to reduce-now.
 * @param {number[]} wineIds - Wine IDs to add
 * @param {number} priority - Priority level (1-5)
 * @param {string} reasonPrefix - Reason prefix text
 * @returns {Promise<{message: string, added: number}>}
 */
export async function batchAddReduceNow(wineIds, priority = 3, reasonPrefix = '') {
  const res = await fetch(`${API_BASE}/api/reduce-now/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wine_ids: wineIds, priority, reason_prefix: reasonPrefix })
  });
  return handleResponse(res, 'Failed to add wines');
}
