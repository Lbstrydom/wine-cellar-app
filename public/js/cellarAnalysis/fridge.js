/**
 * @fileoverview Fridge-specific functionality.
 * @module cellarAnalysis/fridge
 */

import { executeCellarMoves, getFridgeOrganization } from '../api.js';
import { showToast, escapeHtml, getAreaIdForLocation, formatSlotLabel } from '../utils.js';
import { refreshLayout, state } from '../app.js';
import { getCurrentAnalysis } from './state.js';
import { loadAnalysis } from './analysis.js';

/**
 * Legacy category labels — used as fallback when backend response
 * lacks eligibleCategories (cached/pre-migration responses).
 */
const LEGACY_CATEGORY_LABELS = {
  sparkling: 'Sparkling',
  crispWhite: 'Crisp White',
  aromaticWhite: 'Aromatic',
  textureWhite: 'Oaked White',
  rose: 'Rosé',
  chillableRed: 'Light Red',
  dessertFortified: 'Dessert/Fort.',
  flex: 'Flex'
};

/** Temperature context descriptions per storage type. */
const FRIDGE_TYPE_CONTEXT = {
  wine_fridge: '10–14°C — Ideal for all wine types',
  kitchen_fridge: '4–8°C — Pre-serve chilling for whites & sparkling'
};

/** Info note for kitchen fridges explaining excluded categories. */
const KITCHEN_FRIDGE_NOTE = 'Reds and oaked whites need warmer storage (10–14°C). Add a wine fridge for these styles.';

// ---------------------------------------------------------------------------
// Area data lookup
// ---------------------------------------------------------------------------

/**
 * Look up area data by stable areaId instead of brittle array index.
 * @param {string|number} areaId - UUID or numeric ID from backend
 * @returns {Object|undefined} Area analysis data
 */
function getAreaById(areaId) {
  const analysis = getCurrentAnalysis();
  // Primary: multi-area fridgeAnalysis path
  const found = analysis?.fridgeAnalysis?.find(a => String(a.areaId) === String(areaId));
  if (found) return found;
  // Fallback: legacy single-fridge path — fridgeStatus has no areaId, synthetic 'legacy' used
  if (analysis?.fridgeStatus && String(areaId) === 'legacy') {
    return analysis.fridgeStatus;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// NEW: Multi-area entry point
// ---------------------------------------------------------------------------

/**
 * Render all fridge areas from fridgeAnalysis array.
 * Entry point called by analysis.js when backend returns fridgeAnalysis[].
 * Handles per-area sections, transfer suggestions, and 0-capacity filtering.
 * @param {Array} fridgeAnalysis - Per-area analysis objects
 * @param {Array} [transfers=[]] - Cross-area transfer suggestions (fridgeTransfers)
 */
export function renderFridgeAreas(fridgeAnalysis, transfers = []) {
  const container = document.getElementById('analysis-fridge');
  const contentEl = document.getElementById('fridge-status-content');
  if (!container || !contentEl) return;

  container.style.display = 'block';
  contentEl.setAttribute('aria-live', 'polite');

  // Filter out 0-capacity areas (corrupted data safety)
  const validAreas = fridgeAnalysis.filter(a => (a.capacity ?? 0) > 0);
  const isMulti = validAreas.length > 1;

  let html = `<div class="fridge-areas${isMulti ? ' fridge-areas--multi' : ''}">`;

  for (let i = 0; i < validAreas.length; i++) {
    const areaData = validAreas[i];
    const areaLabel = escapeHtml(`${areaData.areaName || 'Fridge'}, ${areaData.occupied} of ${areaData.capacity} slots occupied`);
    html += `<div class="fridge-area" role="region" aria-label="${areaLabel}" data-area-id="${escapeHtml(String(areaData.areaId))}">`;
    html += buildAreaHeaderHtml(areaData);
    html += buildAreaBodyHtml(areaData);
    html += '</div>';
    // Transfer suggestions sit between the first and second area sections (per wireframe)
    if (i === 0 && validAreas.length > 1 && transfers.length > 0) {
      html += buildTransferSuggestionsHtml(transfers);
    }
  }

  // Single-area or no transfers: append after the only area (no-op for multi handled above)
  if (validAreas.length <= 1 && transfers.length > 0) {
    html += buildTransferSuggestionsHtml(transfers);
  }

  html += '</div>';
  contentEl.innerHTML = html;

  // Wire events per-area
  for (const areaData of validAreas) {
    const areaEl = contentEl.querySelector(`.fridge-area[data-area-id="${CSS.escape(String(areaData.areaId))}"]`);
    if (areaEl) {
      wireAreaEvents(areaEl, String(areaData.areaId), areaData);
    }
  }

  // Wire transfer buttons
  contentEl.querySelectorAll('.fridge-transfer-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const transferIndex = Number.parseInt(btn.dataset.transferIndex, 10);
      executeTransfer(transferIndex);
    });
  });
}

/**
 * Render empty state when user has no fridge areas configured.
 * @param {HTMLElement} containerEl - Target container
 */
export function renderNoFridgeState(containerEl) {
  const container = document.getElementById('analysis-fridge');
  if (container) container.style.display = 'block';

  const target = containerEl || document.getElementById('fridge-status-content');
  if (!target) return;

  target.innerHTML = `
    <div class="fridge-empty-state">
      <p>No fridge configured.</p>
      <p>Add a wine fridge or kitchen fridge in Storage Settings to get fridge stocking recommendations.</p>
      <button class="btn btn-secondary btn-small fridge-empty-settings-btn">Go to Storage Settings</button>
    </div>
  `;

  const settingsBtn = target.querySelector('.fridge-empty-settings-btn');
  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
      const settingsTab = document.querySelector('[data-view="settings"]');
      if (settingsTab) settingsTab.click();
      // After tab switch, scroll configure button into view
      setTimeout(() => {
        const configBtn = document.getElementById('configure-storage-areas-btn');
        if (configBtn) configBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 150);
    });
  }
}

// ---------------------------------------------------------------------------
// Area rendering helpers
// ---------------------------------------------------------------------------

/**
 * Build the area header HTML: name, type badge, temperature context.
 * @param {Object} areaData - Area analysis data
 * @returns {string} HTML
 */
function buildAreaHeaderHtml(areaData) {
  const name = escapeHtml(areaData.areaName || 'Fridge');
  const fridgeType = areaData.fridgeType || 'wine_fridge';
  const typeLabel = fridgeType === 'kitchen_fridge' ? 'Kitchen Fridge' : 'Wine Fridge';
  const typeClass = fridgeType === 'kitchen_fridge' ? 'fridge-type-badge--kitchen' : 'fridge-type-badge--wine';
  const tempContext = FRIDGE_TYPE_CONTEXT[fridgeType] || '';

  return `
    <div class="fridge-area-header">
      <div>
        <h5 class="fridge-area-name">${name}</h5>
        ${tempContext ? `<div class="fridge-temp-context">${escapeHtml(tempContext)}</div>` : ''}
      </div>
      <span class="fridge-type-badge ${typeClass}">${typeLabel}</span>
    </div>
  `;
}

/**
 * Build the full area body: capacity bar, category grid, gaps, candidates, organize panel.
 * @param {Object} areaData - Area analysis data
 * @returns {string} HTML
 */
function buildAreaBodyHtml(areaData) {
  const fillPercent = areaData.capacity > 0
    ? Math.round((areaData.occupied / areaData.capacity) * 100)
    : 0;

  const areaIdStr = escapeHtml(String(areaData.areaId));
  const organizeBtn = areaData.occupied >= 2
    ? `<button class="btn btn-secondary btn-small organize-fridge-btn" data-area-id="${areaIdStr}">Organize Fridge</button>`
    : '';

  const mixHtml = buildCategoryGridHtml(
    areaData.eligibleCategories,
    areaData.currentMix,
    areaData.parLevelGaps
  );

  const gapsHtml = buildGapsHtml(areaData);
  const candidatesHtml = buildCandidatesHtml(areaData, areaIdStr);
  const kitchenNote = areaData.fridgeType === 'kitchen_fridge'
    ? `<div class="fridge-info-note">${KITCHEN_FRIDGE_NOTE}</div>`
    : '';

  return `
    <div class="fridge-status-header">
      <div class="fridge-capacity-bar">
        <div class="fridge-capacity-fill" style="width: ${fillPercent}%"></div>
      </div>
      <div class="fridge-capacity-text">${areaData.occupied}/${areaData.capacity} slots ${organizeBtn}</div>
    </div>
    <div class="fridge-mix-grid">${mixHtml}</div>
    ${kitchenNote}
    ${gapsHtml}
    ${candidatesHtml}
    <div class="fridge-organize-panel" data-area-id="${areaIdStr}" style="display: none;"></div>
  `;
}

/**
 * Build category grid HTML from dynamic category list.
 * Falls back to LEGACY_CATEGORY_LABELS when eligibleCategories is missing.
 * @param {Object|null} eligibleCategories - { categoryId: { label, priority, description } }
 * @param {Object} currentMix - Counts by category
 * @param {Object} parLevelGaps - Gap objects by category
 * @returns {string} HTML
 */
function buildCategoryGridHtml(eligibleCategories, currentMix, parLevelGaps) {
  // Determine which categories to show and their labels
  let categoryEntries;
  if (eligibleCategories && Object.keys(eligibleCategories).length > 0) {
    // Sort by priority ascending (backend provides this)
    categoryEntries = Object.entries(eligibleCategories)
      .sort(([, a], [, b]) => (a.priority ?? 99) - (b.priority ?? 99));
  } else {
    // Fallback: use legacy hardcoded list
    categoryEntries = Object.entries(LEGACY_CATEGORY_LABELS)
      .filter(([cat]) => cat !== 'flex')
      .map(([cat, label]) => [cat, { label }]);
  }

  // Always append flex if there's a flex count
  const flexCount = currentMix?.flex ?? 0;
  const hasFlexEntry = categoryEntries.some(([cat]) => cat === 'flex');
  if (flexCount > 0 && !hasFlexEntry) {
    categoryEntries.push(['flex', { label: 'Flex' }]);
  }

  return categoryEntries.map(([cat, meta]) => {
    const count = currentMix?.[cat] ?? 0;
    const hasGap = parLevelGaps?.[cat];
    return `
      <div class="fridge-category ${hasGap ? 'has-gap' : ''}">
        <div class="count">${count}</div>
        <div class="name">${escapeHtml(meta.label || cat)}</div>
      </div>
    `;
  }).join('');
}

/**
 * Build gaps section HTML for an area.
 * @param {Object} areaData
 * @returns {string} HTML
 */
function buildGapsHtml(areaData) {
  if (!areaData.hasGaps || !areaData.parLevelGaps) return '';

  const gaps = Object.entries(areaData.parLevelGaps);
  if (gaps.length === 0) return '';

  const eligibleCategories = areaData.eligibleCategories || {};

  const gapItems = gaps
    .toSorted((a, b) => (a[1].priority ?? 99) - (b[1].priority ?? 99))
    .map(([cat, gap]) => {
      const label = eligibleCategories[cat]?.label || LEGACY_CATEGORY_LABELS[cat] || cat;
      const unfilled = areaData.unfilledGaps?.[cat];
      return `
        <div class="fridge-gap-item">
          <span>${escapeHtml(label)}: ${escapeHtml(gap.description || '')}</span>
          <span class="need">Need ${gap.need}</span>
        </div>
        ${unfilled ? `<div class="fridge-gap-unfilled">${escapeHtml(unfilled.message)}</div>` : ''}
      `;
    }).join('');

  return `
    <div class="fridge-gaps">
      <h5>Par-Level Gaps</h5>
      ${gapItems}
    </div>
  `;
}

/**
 * Build candidates section HTML for an area.
 * @param {Object} areaData
 * @param {string} areaIdStr - Escaped area ID for data attributes
 * @returns {string} HTML
 */
function buildCandidatesHtml(areaData, areaIdStr) {
  if (!areaData.candidates || areaData.candidates.length === 0) return '';

  const isFridgeFull = areaData.emptySlots <= 0;
  const eligibleCategories = areaData.eligibleCategories || {};

  const candidateItems = areaData.candidates.slice(0, 5).map((c, i) => {
    if (isFridgeFull) {
      const swapTarget = identifySwapTarget(areaData, c);
      const swapDetail = swapTarget
        ? `<div class="fridge-swap-detail">
            Swap with <strong>${escapeHtml(swapTarget.wineName || swapTarget.name)}</strong> (${escapeHtml(swapTarget.slot)}) — move back to ${escapeHtml(c.fromSlot)}
            <span class="fridge-swap-why">${escapeHtml(buildSwapOutReason(swapTarget))}</span>
          </div>`
        : '';
      return `
        <div class="fridge-candidate">
          <div class="fridge-candidate-info">
            <div class="fridge-candidate-name">${escapeHtml(c.wineName)} ${escapeHtml(String(c.vintage ?? ''))}</div>
            <div class="fridge-candidate-reason">${escapeHtml(c.reason)}</div>
            ${swapDetail}
          </div>
          <button class="btn btn-secondary btn-small fridge-swap-btn" data-candidate-index="${i}" data-area-id="${areaIdStr}" ${swapTarget ? '' : 'disabled'}>
            Swap
          </button>
        </div>
      `;
    }

    const targetSlot = c.targetSlot || findEmptyFridgeSlot(areaData);
    const hasSource = !!c.fromSlot;
    const catLabel = eligibleCategories[c.category]?.label || LEGACY_CATEGORY_LABELS[c.category] || c.category;

    // Build alternatives HTML for this candidate's category
    const categoryAlts = areaData.alternatives?.[c.category] || [];
    const altsHtml = categoryAlts.length > 0 ? `
      <div class="fridge-alternatives">
        <div class="fridge-alternatives-label">Other options:</div>
        ${categoryAlts.map((alt, ai) => `
          <div class="fridge-alternative">
            <div class="fridge-alternative-info">
              <span class="fridge-alternative-name">${escapeHtml(alt.wineName)} ${escapeHtml(String(alt.vintage ?? ''))}</span>
              ${alt.fromSlot ? `<span class="fridge-alternative-slot">in ${escapeHtml(alt.fromSlot)}</span>` : ''}
            </div>
            <button class="btn btn-small fridge-alt-btn" data-alt-category="${escapeHtml(c.category)}" data-alt-index="${ai}" data-area-id="${areaIdStr}">
              Use this instead
            </button>
          </div>
        `).join('')}
      </div>
    ` : '';

    return `
      <div class="fridge-candidate">
        <div class="fridge-candidate-info">
          <div class="fridge-candidate-name">${escapeHtml(c.wineName)} ${escapeHtml(String(c.vintage ?? ''))}${c.isFlex ? ' <span class="fridge-flex-tag">flex</span>' : ''}</div>
          <div class="fridge-candidate-reason">${escapeHtml(c.reason)}</div>
          <div class="fridge-candidate-category">${escapeHtml(catLabel)}</div>
          ${hasSource ? `<div class="fridge-source-slot">Currently in <strong>${escapeHtml(c.fromSlot)}</strong></div>` : ''}
          ${targetSlot ? `<div class="fridge-target-slot">Add to ${escapeHtml(targetSlot)}</div>` : ''}
        </div>
        <button class="btn btn-secondary btn-small fridge-add-btn" data-candidate-index="${i}" data-area-id="${areaIdStr}" ${hasSource ? '' : 'disabled title="Source location unknown"'}>
          ${targetSlot ? `Add to ${escapeHtml(targetSlot)}` : 'Add'}
        </button>
      </div>
      ${altsHtml}
    `;
  }).join('');

  return `
    <div class="fridge-candidates">
      <h5>${isFridgeFull ? 'Suggested Swaps' : 'Suggested Additions'}</h5>
      ${candidateItems}
    </div>
  `;
}

/**
 * Build transfer suggestions HTML (cross-area section).
 * @param {Array} transfers - fridgeTransfers from backend
 * @returns {string} HTML
 */
function buildTransferSuggestionsHtml(transfers) {
  const cards = transfers.map((t, i) => `
    <div class="fridge-transfer-card">
      <div class="fridge-transfer-info">
        <strong>${escapeHtml(t.wineName)} ${escapeHtml(String(t.vintage ?? ''))}</strong>
        <div class="fridge-transfer-route">
          ${escapeHtml(t.fromAreaName || 'Fridge')}
          <span class="fridge-transfer-arrow">→</span>
          ${escapeHtml(t.toAreaName || 'Fridge')}
        </div>
        <div class="fridge-candidate-reason">${escapeHtml(t.reason || '')}</div>
      </div>
      <button class="btn btn-secondary btn-small fridge-transfer-btn" data-transfer-index="${i}">
        Transfer
      </button>
    </div>
  `).join('');

  return `
    <div class="fridge-transfers">
      <h5>Transfer Suggestions</h5>
      <p class="fridge-transfers-desc">These wines are in the wrong fridge type for their style.</p>
      ${cards}
    </div>
  `;
}

/**
 * Wire event listeners for a single area's action buttons.
 * @param {HTMLElement} areaEl - The .fridge-area element
 * @param {string} areaId - Stable area ID string
 * @param {Object} areaData - Area analysis data
 */
function wireAreaEvents(areaEl, areaId, areaData) {
  areaEl.querySelectorAll('.fridge-add-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const index = Number.parseInt(btn.dataset.candidateIndex, 10);
      moveFridgeCandidate(index, areaId);
    });
  });

  areaEl.querySelectorAll('.fridge-swap-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const index = Number.parseInt(btn.dataset.candidateIndex, 10);
      swapFridgeCandidate(index, areaId);
    });
  });

  areaEl.querySelectorAll('.fridge-alt-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const category = btn.dataset.altCategory;
      const altIndex = Number.parseInt(btn.dataset.altIndex, 10);
      moveAlternativeCandidate(category, altIndex, areaId);
    });
  });

  const organizeBtn = areaEl.querySelector('.organize-fridge-btn');
  if (organizeBtn) {
    organizeBtn.addEventListener('click', () => handleOrganizeFridge(areaId));
  }
}

// ---------------------------------------------------------------------------
// BACKWARD COMPAT: Single-fridge path
// ---------------------------------------------------------------------------

/**
 * Render fridge status with par-level gaps and candidates.
 * Kept for backward compatibility when backend returns legacy fridgeStatus
 * (no fridgeAnalysis array).
 * @param {Object} fridgeStatus
 */
export function renderFridgeStatus(fridgeStatus) {
  const container = document.getElementById('analysis-fridge');

  if (!fridgeStatus) {
    if (container) container.style.display = 'none';
    return;
  }

  // Assign synthetic areaId so action handlers can resolve via getAreaById('legacy')
  const legacyArea = { ...fridgeStatus, areaId: fridgeStatus.areaId ?? 'legacy' };
  renderFridgeAreas([legacyArea], []);
}

// ---------------------------------------------------------------------------
// Action handlers (per-area scoped)
// ---------------------------------------------------------------------------

/**
 * Move a fridge candidate to the fridge.
 * @param {number} index - Candidate index
 * @param {string} areaId - Stable area ID
 */
async function moveFridgeCandidate(index, areaId) {
  const areaData = getAreaById(areaId);
  if (!areaData?.candidates?.[index]) {
    showToast('Error: Candidate not found');
    return;
  }

  const candidate = areaData.candidates[index];

  if ((areaData.emptySlots ?? 0) <= 0) {
    showToast('No empty fridge slots available');
    return;
  }

  const targetSlot = candidate.targetSlot || findEmptyFridgeSlot(areaData);
  if (!targetSlot) {
    showToast('No empty fridge slots available');
    return;
  }

  if (!candidate.fromSlot) {
    showToast('Error: Wine location unknown');
    return;
  }

  try {
    await executeCellarMoves([{
      wineId: candidate.wineId,
      from: candidate.fromSlot,
      to: targetSlot,
      from_storage_area_id: candidate.storageAreaId || null,
      to_storage_area_id: areaData.areaId || null
    }]);
    showToast(`Moved ${candidate.wineName} to ${formatSlotLabel(targetSlot, areaData.areaId || null, state.layout?.areas)}`);
    await loadAnalysis();
    refreshLayout();
  } catch (err) {
    showToast(`Error: ${err.message}`);
  }
}

/**
 * Move an alternative candidate to the fridge (replaces the primary).
 * @param {string} category - Fridge category
 * @param {number} altIndex - Index in the alternatives array
 * @param {string} areaId - Stable area ID
 */
async function moveAlternativeCandidate(category, altIndex, areaId) {
  const areaData = getAreaById(areaId);
  const alt = areaData?.alternatives?.[category]?.[altIndex];
  if (!alt) {
    showToast('Error: Alternative not found');
    return;
  }

  if (!alt.fromSlot) {
    showToast('Error: Wine location unknown');
    return;
  }

  const targetSlot = findEmptyFridgeSlot(areaData);
  if (!targetSlot) {
    showToast('No empty fridge slots available');
    return;
  }

  try {
    await executeCellarMoves([{
      wineId: alt.wineId,
      from: alt.fromSlot,
      to: targetSlot,
      from_storage_area_id: alt.storageAreaId || null,
      to_storage_area_id: areaData.areaId || null
    }]);
    showToast(`Moved ${alt.wineName} to ${formatSlotLabel(targetSlot, areaData.areaId || null, state.layout?.areas)}`);
    await loadAnalysis();
    refreshLayout();
  } catch (err) {
    showToast(`Error: ${err.message}`);
  }
}

/**
 * Execute a swap: candidate wine goes into fridge, fridge wine goes to candidate's cellar slot.
 * @param {number} candidateIndex - Index into area candidates
 * @param {string} areaId - Stable area ID
 */
async function swapFridgeCandidate(candidateIndex, areaId) {
  const areaData = getAreaById(areaId);
  const candidate = areaData?.candidates?.[candidateIndex];
  if (!candidate) { showToast('Error: Candidate not found'); return; }

  const swapOut = identifySwapTarget(areaData, candidate);
  if (!swapOut) { showToast('No suitable swap found'); return; }

  try {
    await executeCellarMoves([
      {
        wineId: swapOut.wineId,
        from: swapOut.slot,
        to: candidate.fromSlot,
        from_storage_area_id: areaData.areaId || null,
        to_storage_area_id: candidate.storageAreaId || null
      },
      {
        wineId: candidate.wineId,
        from: candidate.fromSlot,
        to: swapOut.slot,
        from_storage_area_id: candidate.storageAreaId || null,
        to_storage_area_id: areaData.areaId || null
      }
    ]);
    const swapOutName = swapOut.wineName || swapOut.name;
    showToast(`Swapped: ${candidate.wineName} \u2192 ${formatSlotLabel(swapOut.slot, areaData.areaId || null, state.layout?.areas)}, ${swapOutName} \u2192 ${formatSlotLabel(candidate.fromSlot, candidate.storageAreaId || null, state.layout?.areas)}`);
    await loadAnalysis();
    refreshLayout();
  } catch (err) {
    showToast(`Error: ${err.message}`);
  }
}

/**
 * Execute a cross-area fridge transfer.
 * Moves the wine from source area slot to an available slot in the destination area.
 * @param {number} transferIndex - Index into fridgeTransfers array
 */
async function executeTransfer(transferIndex) {
  const analysis = getCurrentAnalysis();
  const transfer = analysis?.fridgeTransfers?.[transferIndex];
  if (!transfer) {
    showToast('Error: Transfer not found');
    return;
  }

  if (!transfer.fromSlot) {
    showToast('Error: Source slot unknown');
    return;
  }

  // Find an empty slot in the target area
  const targetAreaData = analysis.fridgeAnalysis?.find(a => String(a.areaId) === String(transfer.toAreaId));
  const targetSlot = targetAreaData ? findEmptyFridgeSlot(targetAreaData) : null;

  if (!targetSlot) {
    showToast(`No empty slots in ${transfer.toAreaName || 'target fridge'}`);
    return;
  }

  try {
    await executeCellarMoves([{
      wineId: transfer.wineId,
      from: transfer.fromSlot,
      to: targetSlot,
      from_storage_area_id: transfer.fromAreaId || null,
      to_storage_area_id: transfer.toAreaId || null
    }]);
    showToast(`Transferred ${transfer.wineName} to ${formatSlotLabel(targetSlot, transfer.toAreaId, state.layout?.areas)}`);
    await loadAnalysis();
    refreshLayout();
  } catch (err) {
    showToast(`Error: ${err.message}`);
  }
}

/**
 * Handle the "Organize Fridge" button click for a specific area.
 * @param {string} areaId - Stable area ID
 */
async function handleOrganizeFridge(areaId) {
  const contentEl = document.getElementById('fridge-status-content');
  if (!contentEl) return;

  const panel = contentEl.querySelector(`.fridge-organize-panel[data-area-id="${CSS.escape(areaId)}"]`);
  if (!panel) return;

  // Toggle visibility if already showing
  if (panel.style.display !== 'none') {
    panel.style.display = 'none';
    return;
  }

  panel.style.display = 'block';
  panel.innerHTML = '<div class="analysis-loading">Calculating optimal arrangement...</div>';

  try {
    const result = await getFridgeOrganization(areaId);

    if (!result.moves || result.moves.length === 0) {
      panel.innerHTML = `
        <div class="fridge-organize-result">
          <p class="no-moves">Your fridge is already well-organized by category.</p>
          ${result.summary ? renderFridgeSummary(result.summary) : ''}
        </div>
      `;
      return;
    }

    const hasSwaps = result.hasSwaps || result.mustExecuteAsBatch;
    const swapWarning = hasSwaps
      ? `<div class="swap-warning">
          <strong>Note:</strong> These moves involve swaps - they must be executed together to avoid losing bottles.
         </div>`
      : '';

    panel.innerHTML = `
      <div class="fridge-organize-result">
        <h5>Suggested Reorganization</h5>
        <p class="organize-description">Grouping wines by category (coldest at top):</p>
        ${swapWarning}
        ${renderFridgeSummary(result.summary)}
        <div class="fridge-moves-list">
          ${result.moves.map((m, i) => `
            <div class="fridge-move-item" data-move-index="${i}">
              <span class="move-wine">${escapeHtml(m.wineName)} ${escapeHtml(String(m.vintage ?? ''))}</span>
              <span class="move-category">${escapeHtml(m.category)}</span>
              <span class="move-path">${m.from} → ${m.to}</span>
              ${hasSwaps
                ? '<span class="move-locked" title="Must execute all moves together">🔒</span>'
                : `<button class="btn btn-small btn-primary fridge-move-btn" data-move-index="${i}">Move</button>`
              }
            </div>
          `).join('')}
        </div>
        <div class="fridge-organize-actions">
          <button class="btn btn-primary execute-all-fridge-moves-btn">Execute All ${result.moves.length} Moves</button>
          <button class="btn btn-secondary close-organize-btn">Close</button>
        </div>
      </div>
    `;

    panel.dataset.moves = JSON.stringify(result.moves);

    if (!hasSwaps) {
      panel.querySelectorAll('.fridge-move-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = Number.parseInt(btn.dataset.moveIndex, 10);
          executeFridgeOrganizeMove(idx, panel);
        });
      });
    }

    panel.querySelector('.execute-all-fridge-moves-btn')?.addEventListener('click', () => {
      executeAllFridgeOrganizeMoves(panel);
    });
    panel.querySelector('.close-organize-btn')?.addEventListener('click', () => {
      panel.style.display = 'none';
    });

  } catch (err) {
    panel.innerHTML = `<div class="ai-advice-error">Error: ${err.message}</div>`;
  }
}

// ---------------------------------------------------------------------------
// Organize fridge execution helpers
// ---------------------------------------------------------------------------

/**
 * Render fridge organization summary.
 * @param {Array} summary - Category groups
 * @returns {string} HTML
 */
function renderFridgeSummary(summary) {
  if (!summary || summary.length === 0) return '';

  return `
    <div class="fridge-summary">
      ${summary.map(g => `
        <span class="fridge-summary-item">
          <span class="category-name">${escapeHtml(g.name)}</span>
          <span class="category-slots">${g.startSlot}${g.startSlot === g.endSlot ? '' : '-' + g.endSlot}</span>
        </span>
      `).join('')}
    </div>
  `;
}

/**
 * Execute a single fridge organization move.
 * @param {number} index - Move index
 * @param {HTMLElement} panel - The organize panel element
 */
async function executeFridgeOrganizeMove(index, panel) {
  if (!panel) return;

  const moves = JSON.parse(panel.dataset.moves || '[]');
  const move = moves[index];
  if (!move) return;

  try {
    await executeCellarMoves([{
      wineId: move.wineId,
      from: move.from,
      to: move.to,
      from_storage_area_id: getAreaIdForLocation(state.layout, move.from),
      to_storage_area_id: getAreaIdForLocation(state.layout, move.to),
    }]);
    showToast(`Moved ${move.wineName} to ${formatSlotLabel(move.to, getAreaIdForLocation(state.layout, move.to), state.layout?.areas)}`);

    moves.splice(index, 1);
    panel.dataset.moves = JSON.stringify(moves);

    await loadAnalysis();
    refreshLayout();
  } catch (err) {
    showToast(`Error: ${err.message}`);
  }
}

/**
 * Execute all fridge organization moves.
 * @param {HTMLElement} panel - The organize panel element
 */
async function executeAllFridgeOrganizeMoves(panel) {
  if (!panel) return;

  const moves = JSON.parse(panel.dataset.moves || '[]');
  if (moves.length === 0) {
    showToast('No moves to execute');
    return;
  }

  try {
    const movesToExecute = moves.map(m => ({
      wineId: m.wineId,
      from: m.from,
      to: m.to,
      from_storage_area_id: getAreaIdForLocation(state.layout, m.from),
      to_storage_area_id: getAreaIdForLocation(state.layout, m.to),
    }));

    const result = await executeCellarMoves(movesToExecute);
    showToast(`Executed ${result.moved} moves`);

    panel.style.display = 'none';
    await loadAnalysis();
    refreshLayout();
  } catch (err) {
    showToast(`Error: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Pure helpers (unchanged from original, exported for testing)
// ---------------------------------------------------------------------------

/**
 * Find the best fridge wine to swap out for a given candidate.
 * Priority: doesn't fill a gap category > lowest drinking urgency.
 * @param {Object} areaData - Area analysis data (same shape as fridgeStatus)
 * @param {Object} candidate - The candidate wine to swap in
 * @returns {Object|null} Fridge wine to swap out
 */
function identifySwapTarget(areaData, candidate) {
  const fridgeWines = areaData.wines || [];
  if (fridgeWines.length === 0) return null;

  return fridgeWines
    .filter(w => w.wineId !== candidate.wineId)
    .sort((a, b) => {
      const aMatchesGap = areaData.parLevelGaps?.[a.category] ? 0 : 1;
      const bMatchesGap = areaData.parLevelGaps?.[b.category] ? 0 : 1;
      if (aMatchesGap !== bMatchesGap) return bMatchesGap - aMatchesGap;
      return computeUrgency(a.drinkByYear) - computeUrgency(b.drinkByYear);
    })[0] || null;
}

/**
 * Compute drinking urgency from drinkByYear.
 * Higher = more urgent (should stay in fridge). Lower = can wait (good swap-out).
 * @param {number|null} drinkByYear
 * @returns {number}
 */
function computeUrgency(drinkByYear) {
  if (!drinkByYear) return 2;
  const yearsLeft = drinkByYear - new Date().getFullYear();
  if (yearsLeft <= 0) return 10;
  if (yearsLeft <= 2) return 7;
  if (yearsLeft <= 5) return 4;
  return 1;
}

/**
 * Build a human-readable reason for why a fridge wine should be swapped out.
 * @param {Object} fridgeWine - Wine currently in fridge
 * @returns {string}
 */
function buildSwapOutReason(fridgeWine) {
  const drinkBy = fridgeWine.drinkByYear;
  if (!drinkBy) return 'No rush to chill \u2014 stores well in cellar';
  const yearsLeft = drinkBy - new Date().getFullYear();
  if (yearsLeft > 5) return `Drink by ${drinkBy} \u2014 plenty of time, better stored in cellar`;
  if (yearsLeft > 2) return `Drink by ${drinkBy} \u2014 can wait in cellar for now`;
  return `Drink by ${drinkBy} \u2014 approaching window but OK in cellar short-term`;
}

/**
 * Find an empty fridge slot using the dynamic slot list from area data.
 * Falls back to the legacy hardcoded F1–F9 list for backward compatibility.
 * @param {Object} areaData - Area analysis data
 * @returns {string|null}
 */
function findEmptyFridgeSlot(areaData) {
  const fridgeSlots = areaData.allSlots ?? ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9'];
  const occupiedSlots = new Set(areaData.wines?.map(w => w.slot) || []);
  return fridgeSlots.find(s => !occupiedSlots.has(s)) || null;
}

// ---------------------------------------------------------------------------
// AI annotations (multi-area aware)
// ---------------------------------------------------------------------------

/**
 * Render AI fridge annotations inline on existing fridge candidates.
 * Iterates all areas in fridgeAnalysis[] to find matching candidates.
 * Falls back to fridgeStatus for legacy cached responses.
 * @param {Array} toAdd - AI fridgePlan.toAdd items
 */
export function renderAIFridgeAnnotations(toAdd) {
  if (!toAdd?.length) return;

  const contentEl = document.getElementById('fridge-status-content');
  if (!contentEl) return;

  const analysis = getCurrentAnalysis();

  // Build lookup of AI recommendations by wineId
  const aiRecs = new Map();
  for (const item of toAdd) {
    if (item.wineId) aiRecs.set(item.wineId, item);
  }

  // Build a unified candidate list from all areas (multi-area) or legacy fridgeStatus
  const allCandidates = [];
  if (analysis?.fridgeAnalysis?.length > 0) {
    for (const area of analysis.fridgeAnalysis) {
      for (const candidate of (area.candidates || [])) {
        allCandidates.push(candidate);
      }
    }
  } else if (analysis?.fridgeStatus?.candidates) {
    allCandidates.push(...analysis.fridgeStatus.candidates);
  }

  // Annotate existing candidate cards with AI badges
  contentEl.querySelectorAll('.fridge-candidate').forEach(card => {
    const btn = card.querySelector('[data-candidate-index]');
    if (!btn) return;
    const index = Number.parseInt(btn.dataset.candidateIndex, 10);
    const areaId = btn.dataset.areaId;

    let candidate;
    if (areaId) {
      const areaData = getAreaById(areaId);
      candidate = areaData?.candidates?.[index];
    } else {
      candidate = allCandidates[index];
    }
    if (!candidate) return;

    const aiRec = aiRecs.get(candidate.wineId);
    if (!aiRec) return;

    if (card.querySelector('.ai-fridge-badge')) return;

    const nameEl = card.querySelector('.fridge-candidate-name');
    if (nameEl) {
      const badge = document.createElement('span');
      badge.className = 'ai-badge ai-badge--confirmed ai-fridge-badge';
      badge.title = aiRec.reason || 'AI recommended';
      badge.textContent = 'AI Pick';
      nameEl.appendChild(badge);
    }
  });

  // If AI recommends wines not in any candidate list, add a summary
  const candidateWineIds = new Set(allCandidates.map(c => c.wineId));
  const extraRecs = toAdd.filter(r => !candidateWineIds.has(r.wineId));
  if (extraRecs.length > 0) {
    let extraEl = contentEl.querySelector('.ai-fridge-extras');
    if (!extraEl) {
      extraEl = document.createElement('div');
      extraEl.className = 'ai-fridge-extras';
      contentEl.appendChild(extraEl);
    }
    extraEl.innerHTML = `
      <h5>AI Also Suggests</h5>
      ${extraRecs.map(r => `
        <div class="ai-fridge-extra-item">
          <span class="ai-badge ai-badge--confirmed">AI Pick</span>
          <strong>${escapeHtml(r.wineName || `Wine #${r.wineId}`)}</strong>
          ${r.reason ? `<span class="ai-fridge-extra-reason">${escapeHtml(r.reason)}</span>` : ''}
        </div>
      `).join('')}
    `;
  }
}

// Exported for unit testing
export { identifySwapTarget, computeUrgency, buildSwapOutReason, findEmptyFridgeSlot };
