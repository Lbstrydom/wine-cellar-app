/**
 * @fileoverview Zone configuration panel — view/edit zone metadata and confirm AI suggestions.
 * Surfaces the zone-metadata, zones-with-intent, and zones-needing-review endpoints.
 * @module cellarAnalysis/zoneManagement
 */

import {
  getZonesWithIntent,
  getZonesNeedingReview,
  updateZoneMetadata,
  confirmZoneMetadata
} from '../api/index.js';
import { escapeHtml, showToast } from '../utils.js';

/** @type {Array|null} Cached zone list */
let _zones = null;
/** @type {Set<string>} Zone IDs needing review */
let _needsReview = new Set();
/** @type {string|null} Zone ID currently being edited */
let _editingZoneId = null;

// ── Public API ────────────────────────────────────────────

/**
 * Load and render zone config when the workspace tab activates.
 */
export async function loadZoneManagement() {
  const grid = document.getElementById('zone-mgmt-grid');
  const loading = document.getElementById('zone-mgmt-loading');
  if (!grid) return;

  // Show loading only on first load
  if (!_zones) {
    loading.style.display = '';
    grid.innerHTML = '';
  }

  try {
    const [intentRes, reviewRes] = await Promise.all([
      getZonesWithIntent(),
      getZonesNeedingReview()
    ]);

    _zones = intentRes.zones || [];
    _needsReview = new Set((reviewRes.zones || []).map(z => z.zone_id));

    renderReviewBanner();
    renderZoneCards();
  } catch (err) {
    grid.innerHTML = `<p class="zone-mgmt-error">Failed to load zones: ${escapeHtml(err.message)}</p>`;
  } finally {
    loading.style.display = 'none';
  }
}

/**
 * Initialize event delegation for the zone management panel.
 */
export function initZoneManagement() {
  const grid = document.getElementById('zone-mgmt-grid');
  if (!grid) return;

  grid.addEventListener('click', (e) => {
    const confirmBtn = e.target.closest('.zone-mgmt-confirm-btn');
    if (confirmBtn) {
      handleConfirm(confirmBtn.dataset.zoneId);
      return;
    }

    const editBtn = e.target.closest('.zone-mgmt-edit-btn');
    if (editBtn) {
      openEditForm(editBtn.dataset.zoneId);
      return;
    }

    const saveBtn = e.target.closest('.zone-mgmt-save-btn');
    if (saveBtn) {
      handleSaveEdit(saveBtn.dataset.zoneId);
      return;
    }

    const cancelBtn = e.target.closest('.zone-mgmt-cancel-btn');
    if (cancelBtn) {
      closeEditForm();
      return;
    }

    // Toggle card detail expansion
    const card = e.target.closest('.zone-mgmt-card');
    if (card && !e.target.closest('.zone-mgmt-actions') && !e.target.closest('.zone-mgmt-edit-form')) {
      card.classList.toggle('expanded');
    }
  });
}

// ── Rendering ─────────────────────────────────────────────

function renderReviewBanner() {
  const banner = document.getElementById('zone-mgmt-review-banner');
  if (!banner) return;

  if (_needsReview.size === 0) {
    banner.style.display = 'none';
    return;
  }

  banner.style.display = '';
  banner.innerHTML = `
    <span class="zone-mgmt-review-icon">!</span>
    <span>${_needsReview.size} zone${_needsReview.size !== 1 ? 's have' : ' has'} unconfirmed AI suggestions. Review and confirm below.</span>
  `;
}

function renderZoneCards() {
  const grid = document.getElementById('zone-mgmt-grid');
  if (!grid || !_zones) return;

  if (_zones.length === 0) {
    grid.innerHTML = '<p class="zone-mgmt-empty">No zones configured yet.</p>';
    return;
  }

  // Sort: needs-review first, then alphabetical
  const sorted = [..._zones].sort((a, b) => {
    const aReview = _needsReview.has(a.id) ? 0 : 1;
    const bReview = _needsReview.has(b.id) ? 0 : 1;
    if (aReview !== bReview) return aReview - bReview;
    return (a.displayName || a.id).localeCompare(b.displayName || b.id);
  });

  grid.innerHTML = sorted.map(zone => renderZoneCard(zone)).join('');
}

function renderZoneCard(zone) {
  const needsReview = _needsReview.has(zone.id);
  const intent = zone.intent || {};
  const isEditing = _editingZoneId === zone.id;

  const purpose = intent.purpose || '';
  const styleRange = intent.styleRange || '';
  const servingTemp = intent.servingTemp || '';
  const agingAdvice = intent.agingAdvice || '';
  const pairingHints = Array.isArray(intent.pairingHints) ? intent.pairingHints : [];
  const exampleWines = Array.isArray(intent.exampleWines) ? intent.exampleWines : [];
  const family = intent.family || '';
  const seasonalNotes = intent.seasonalNotes || '';
  const rows = zone.rows?.join(', ') || 'None';

  const reviewClass = needsReview ? ' needs-review' : '';
  const confirmedLabel = intent.userConfirmedAt
    ? `Confirmed ${new Date(intent.userConfirmedAt).toLocaleDateString()}`
    : (intent.aiSuggestedAt ? 'AI suggested — not yet confirmed' : '');

  if (isEditing) {
    return renderEditForm(zone, intent);
  }

  return `
    <div class="zone-mgmt-card${reviewClass}" data-zone-id="${escapeHtml(zone.id)}">
      <div class="zone-mgmt-card-header">
        <div class="zone-mgmt-card-title-row">
          <span class="zone-mgmt-card-title">${escapeHtml(zone.displayName || zone.id)}</span>
          ${needsReview ? '<span class="zone-mgmt-badge-review">Needs Review</span>' : ''}
          ${family ? `<span class="zone-mgmt-badge-family">${escapeHtml(family)}</span>` : ''}
        </div>
        <div class="zone-mgmt-card-meta">
          <span>Rows: ${escapeHtml(rows)}</span>
          ${confirmedLabel ? `<span class="zone-mgmt-confirmed-label">${escapeHtml(confirmedLabel)}</span>` : ''}
        </div>
      </div>
      ${purpose ? `<div class="zone-mgmt-card-purpose">${escapeHtml(purpose)}</div>` : ''}
      <div class="zone-mgmt-card-details">
        ${styleRange ? `<div class="zone-mgmt-detail"><strong>Style:</strong> ${escapeHtml(styleRange)}</div>` : ''}
        ${servingTemp ? `<div class="zone-mgmt-detail"><strong>Serving:</strong> ${escapeHtml(servingTemp)}</div>` : ''}
        ${agingAdvice ? `<div class="zone-mgmt-detail"><strong>Aging:</strong> ${escapeHtml(agingAdvice)}</div>` : ''}
        ${pairingHints.length > 0 ? `<div class="zone-mgmt-detail"><strong>Pairs with:</strong> ${pairingHints.map(h => escapeHtml(h)).join(', ')}</div>` : ''}
        ${exampleWines.length > 0 ? `<div class="zone-mgmt-detail"><strong>Examples:</strong> ${exampleWines.map(w => escapeHtml(w)).join(', ')}</div>` : ''}
        ${seasonalNotes ? `<div class="zone-mgmt-detail"><strong>Seasonal:</strong> ${escapeHtml(seasonalNotes)}</div>` : ''}
      </div>
      <div class="zone-mgmt-actions">
        <button class="btn btn-small btn-secondary zone-mgmt-edit-btn" data-zone-id="${escapeHtml(zone.id)}">Edit</button>
        ${needsReview ? `<button class="btn btn-small btn-primary zone-mgmt-confirm-btn" data-zone-id="${escapeHtml(zone.id)}">Confirm</button>` : ''}
      </div>
    </div>
  `;
}

function renderEditForm(zone, intent) {
  const purpose = intent.purpose || '';
  const styleRange = intent.styleRange || '';
  const servingTemp = intent.servingTemp || '';
  const agingAdvice = intent.agingAdvice || '';
  const pairingHints = Array.isArray(intent.pairingHints) ? intent.pairingHints.join(', ') : '';
  const seasonalNotes = intent.seasonalNotes || '';

  return `
    <div class="zone-mgmt-card editing" data-zone-id="${escapeHtml(zone.id)}">
      <div class="zone-mgmt-card-header">
        <span class="zone-mgmt-card-title">${escapeHtml(zone.displayName || zone.id)}</span>
      </div>
      <div class="zone-mgmt-edit-form">
        <label class="zone-mgmt-field">
          <span>Purpose</span>
          <input type="text" name="purpose" value="${escapeHtml(purpose)}" placeholder="e.g. Full-bodied reds for aging">
        </label>
        <label class="zone-mgmt-field">
          <span>Style range</span>
          <input type="text" name="style_range" value="${escapeHtml(styleRange)}" placeholder="e.g. Cabernet, Shiraz, Merlot blends">
        </label>
        <label class="zone-mgmt-field">
          <span>Serving temperature</span>
          <input type="text" name="serving_temp" value="${escapeHtml(servingTemp)}" placeholder="e.g. 16-18°C">
        </label>
        <label class="zone-mgmt-field">
          <span>Aging advice</span>
          <input type="text" name="aging_advice" value="${escapeHtml(agingAdvice)}" placeholder="e.g. Best after 5-10 years">
        </label>
        <label class="zone-mgmt-field">
          <span>Pairing hints (comma-separated)</span>
          <input type="text" name="pairing_hints" value="${escapeHtml(pairingHints)}" placeholder="e.g. Grilled lamb, aged cheese, stew">
        </label>
        <label class="zone-mgmt-field">
          <span>Seasonal notes</span>
          <input type="text" name="seasonal_notes" value="${escapeHtml(seasonalNotes)}" placeholder="e.g. Peak winter comfort wines">
        </label>
        <div class="zone-mgmt-form-actions">
          <button class="btn btn-small btn-primary zone-mgmt-save-btn" data-zone-id="${escapeHtml(zone.id)}">Save</button>
          <button class="btn btn-small btn-secondary zone-mgmt-cancel-btn">Cancel</button>
        </div>
      </div>
    </div>
  `;
}

// ── Handlers ──────────────────────────────────────────────

async function handleConfirm(zoneId) {
  try {
    await confirmZoneMetadata(zoneId);
    _needsReview.delete(zoneId);
    showToast('Zone confirmed');
    // Update intent confirmation timestamp in cached data
    const zone = _zones?.find(z => z.id === zoneId);
    if (zone?.intent) {
      zone.intent.userConfirmedAt = new Date().toISOString();
    }
    renderReviewBanner();
    renderZoneCards();
  } catch (err) {
    showToast(`Error: ${err.message}`);
  }
}

function openEditForm(zoneId) {
  _editingZoneId = zoneId;
  renderZoneCards();
  // Focus first input
  const form = document.querySelector(`.zone-mgmt-card[data-zone-id="${zoneId}"] .zone-mgmt-edit-form input`);
  if (form) form.focus();
}

function closeEditForm() {
  _editingZoneId = null;
  renderZoneCards();
}

async function handleSaveEdit(zoneId) {
  const card = document.querySelector(`.zone-mgmt-card[data-zone-id="${zoneId}"]`);
  if (!card) return;

  const getValue = (name) => card.querySelector(`[name="${name}"]`)?.value?.trim() || '';

  const updates = {};
  const purpose = getValue('purpose');
  const styleRange = getValue('style_range');
  const servingTemp = getValue('serving_temp');
  const agingAdvice = getValue('aging_advice');
  const pairingHintsRaw = getValue('pairing_hints');
  const seasonalNotes = getValue('seasonal_notes');

  if (purpose) updates.purpose = purpose;
  if (styleRange) updates.style_range = styleRange;
  if (servingTemp) updates.serving_temp = servingTemp;
  if (agingAdvice) updates.aging_advice = agingAdvice;
  if (pairingHintsRaw) {
    updates.pairing_hints = pairingHintsRaw.split(',').map(s => s.trim()).filter(Boolean);
  }
  if (seasonalNotes) updates.seasonal_notes = seasonalNotes;

  if (Object.keys(updates).length === 0) {
    showToast('No changes to save');
    closeEditForm();
    return;
  }

  const saveBtn = card.querySelector('.zone-mgmt-save-btn');
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
  }

  try {
    await updateZoneMetadata(zoneId, updates);
    showToast('Zone updated');
    _editingZoneId = null;
    // Reload fresh data
    await loadZoneManagement();
  } catch (err) {
    showToast(`Error: ${err.message}`);
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
    }
  }
}
