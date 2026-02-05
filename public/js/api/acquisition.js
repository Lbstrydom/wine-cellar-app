/**
 * @fileoverview Acquisition workflow API calls.
 * @module api/acquisition
 */

import { API_BASE, apiFetch, handleResponse } from './base.js';

const fetch = apiFetch;

/**
 * Parse wine from image with per-field confidence.
 * @param {string} base64Image - Base64 encoded image
 * @param {string} mediaType - MIME type
 * @returns {Promise<Object>} Parsed wines with confidence data
 */
export async function parseWineImageWithConfidence(base64Image, mediaType) {
  const res = await fetch(`${API_BASE}/api/acquisition/parse-image`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: base64Image, mediaType })
  });
  return handleResponse(res, 'Failed to parse image');
}

/**
 * Get placement suggestion for a wine.
 * @param {Object} wine - Wine data
 * @returns {Promise<Object>} Placement suggestions
 */
export async function getAcquisitionPlacement(wine) {
  const res = await fetch(`${API_BASE}/api/acquisition/suggest-placement`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wine })
  });
  return handleResponse(res, 'Failed to get placement suggestion');
}

/**
 * Enrich wine with ratings and drinking windows.
 * @param {Object} wine - Wine data
 * @returns {Promise<Object>} Enrichment data
 */
export async function enrichWine(wine) {
  const res = await fetch(`${API_BASE}/api/acquisition/enrich`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wine })
  });
  return handleResponse(res, 'Failed to enrich wine');
}

/**
 * Run complete acquisition workflow.
 * @param {Object} options - Workflow options
 * @returns {Promise<Object>} Workflow result
 */
export async function runAcquisitionWorkflow(options) {
  const res = await fetch(`${API_BASE}/api/acquisition/workflow`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options)
  });
  return handleResponse(res, 'Acquisition workflow failed');
}

/**
 * Save wine from acquisition workflow.
 * @param {Object} wine - Wine data
 * @param {Object} options - Save options (slot, quantity, addToFridge)
 * @returns {Promise<Object>} Save result
 */
export async function saveAcquiredWine(wine, options = {}) {
  const res = await fetch(`${API_BASE}/api/acquisition/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wine, ...options })
  });
  return handleResponse(res, 'Failed to save wine');
}

/**
 * Get confidence level definitions.
 * @returns {Promise<Object>} Confidence levels
 */
export async function getConfidenceLevels() {
  const res = await fetch(`${API_BASE}/api/acquisition/confidence-levels`);
  return handleResponse(res, 'Failed to get confidence levels');
}
