/**
 * @fileoverview Awards database CRUD API calls.
 * @module api/awards
 */

import { API_BASE, apiFetch, handleResponse } from './base.js';

const fetch = apiFetch;

/**
 * Get all known competitions.
 * @returns {Promise<Object>}
 */
export async function getAwardsCompetitions() {
  const res = await fetch(`${API_BASE}/api/awards/competitions`);
  return handleResponse(res, 'Failed to fetch competitions');
}

/**
 * Create a custom awards competition.
 * @param {Object} data - Competition data
 * @param {string} data.id - Competition ID
 * @param {string} data.name - Competition name
 * @returns {Promise<Object>}
 */
export async function createAwardsCompetition(data) {
  const res = await fetch(`${API_BASE}/api/awards/competitions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  return handleResponse(res, 'Failed to add competition');
}

/**
 * Get all award sources.
 * @returns {Promise<Object>}
 */
export async function getAwardsSources() {
  const res = await fetch(`${API_BASE}/api/awards/sources`);
  return handleResponse(res, 'Failed to fetch award sources');
}

/**
 * Get awards for a specific source.
 * @param {string} sourceId - Source ID
 * @returns {Promise<Object>}
 */
export async function getSourceAwards(sourceId) {
  const res = await fetch(`${API_BASE}/api/awards/sources/${encodeURIComponent(sourceId)}`);
  return handleResponse(res, 'Failed to fetch source awards');
}

/**
 * Import awards from a webpage.
 * @param {string} url - Webpage URL
 * @param {string} competitionId - Competition ID
 * @param {number} year - Competition year
 * @returns {Promise<Object>}
 */
export async function importAwardsFromWebpage(url, competitionId, year) {
  const res = await fetch(`${API_BASE}/api/awards/import/webpage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, competitionId, year })
  });
  return handleResponse(res, 'Failed to import awards from webpage');
}

/**
 * Import awards from a PDF file.
 * @param {File} pdfFile - PDF file
 * @param {string} competitionId - Competition ID
 * @param {number} year - Competition year
 * @returns {Promise<Object>}
 */
export async function importAwardsFromPDF(pdfFile, competitionId, year) {
  const formData = new FormData();
  formData.append('pdf', pdfFile);
  formData.append('competitionId', competitionId);
  formData.append('year', year);

  const res = await fetch(`${API_BASE}/api/awards/import/pdf`, {
    method: 'POST',
    body: formData
  });
  return handleResponse(res, 'Failed to import awards from PDF');
}

/**
 * Import awards from pasted text.
 * @param {string} text - Text content
 * @param {string} competitionId - Competition ID
 * @param {number} year - Competition year
 * @param {string} sourceType - Source type (manual, csv, magazine)
 * @returns {Promise<Object>}
 */
export async function importAwardsFromText(text, competitionId, year, sourceType = 'manual') {
  const res = await fetch(`${API_BASE}/api/awards/import/text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, competitionId, year, sourceType })
  });
  return handleResponse(res, 'Failed to import awards from text');
}

/**
 * Delete an award source.
 * @param {string} sourceId - Source ID
 * @returns {Promise<Object>}
 */
export async function deleteAwardsSource(sourceId) {
  const res = await fetch(`${API_BASE}/api/awards/sources/${encodeURIComponent(sourceId)}`, {
    method: 'DELETE'
  });
  return handleResponse(res, 'Failed to delete source');
}

/**
 * Re-run matching for a source.
 * @param {string} sourceId - Source ID
 * @returns {Promise<Object>}
 */
export async function rematchAwardsSource(sourceId) {
  const res = await fetch(`${API_BASE}/api/awards/sources/${encodeURIComponent(sourceId)}/match`, {
    method: 'POST'
  });
  return handleResponse(res, 'Failed to rematch awards');
}

/**
 * Link an award to a wine.
 * @param {number} awardId - Award ID
 * @param {number} wineId - Wine ID
 * @returns {Promise<Object>}
 */
export async function linkAwardToWine(awardId, wineId) {
  const res = await fetch(`${API_BASE}/api/awards/${awardId}/link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wineId })
  });
  return handleResponse(res, 'Failed to link award');
}

/**
 * Get awards for a wine.
 * @param {number} wineId - Wine ID
 * @returns {Promise<Object>}
 */
export async function getWineAwards(wineId) {
  const res = await fetch(`${API_BASE}/api/awards/wine/${wineId}`);
  return handleResponse(res, 'Failed to fetch wine awards');
}
