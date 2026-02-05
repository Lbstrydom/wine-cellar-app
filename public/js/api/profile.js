/**
 * @fileoverview Profile and cellar management API calls.
 * @module api/profile
 */

import { API_BASE, apiFetch, handleResponse } from './base.js';

const fetch = apiFetch;

/**
 * Get current user profile.
 * @returns {Promise<Object>}
 */
export async function getProfile() {
  const res = await fetch(`${API_BASE}/api/profile`);
  return handleResponse(res, 'Failed to fetch profile');
}

/**
 * Get all cellars for the current user.
 * @returns {Promise<Object>}
 */
export async function getCellars() {
  const res = await fetch(`${API_BASE}/api/cellars`);
  return handleResponse(res, 'Failed to fetch cellars');
}

/**
 * Storage Areas API
 * All calls include auth and X-Cellar-ID headers via api.js wrapper.
 */
export async function getStorageAreas() {
  const res = await fetch(`${API_BASE}/api/storage-areas`);
  return handleResponse(res, 'Failed to fetch storage areas');
}

export async function getStorageAreaById(id) {
  const res = await fetch(`${API_BASE}/api/storage-areas/${encodeURIComponent(id)}`);
  return handleResponse(res, 'Failed to fetch storage area');
}

export async function createStorageArea(area) {
  const res = await fetch(`${API_BASE}/api/storage-areas`, {
    method: 'POST',
    body: JSON.stringify(area)
  });
  return handleResponse(res, 'Failed to create storage area');
}

export async function updateStorageArea(id, updates) {
  const res = await fetch(`${API_BASE}/api/storage-areas/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(updates)
  });
  return handleResponse(res, 'Failed to update storage area');
}

export async function updateStorageAreaLayout(id, rows) {
  const res = await fetch(`${API_BASE}/api/storage-areas/${encodeURIComponent(id)}/layout`, {
    method: 'PUT',
    body: JSON.stringify({ rows })
  });
  return handleResponse(res, 'Failed to update storage layout');
}

export async function deleteStorageArea(id) {
  const res = await fetch(`${API_BASE}/api/storage-areas/${encodeURIComponent(id)}`, {
    method: 'DELETE'
  });
  return handleResponse(res, 'Failed to delete storage area');
}

export async function createStorageAreaFromTemplate(template, overrides = {}) {
  const res = await fetch(`${API_BASE}/api/storage-areas/from-template`, {
    method: 'POST',
    body: JSON.stringify({ template, ...overrides })
  });
  return handleResponse(res, 'Failed to create storage area from template');
}

/**
 * Set the active cellar for the current user.
 * @param {string} cellarId
 * @returns {Promise<Object>}
 */
export async function setActiveCellar(cellarId) {
  const res = await fetch(`${API_BASE}/api/cellars/active`, {
    method: 'POST',
    body: JSON.stringify({ cellar_id: cellarId })
  });
  return handleResponse(res, 'Failed to set active cellar');
}
