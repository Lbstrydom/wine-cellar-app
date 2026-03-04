/**
 * @fileoverview Data-integrity renderer for duplicate slot assignments.
 * Shows wines that are assigned to more cellar slots than their recorded
 * bottle_count — these are data anomalies, not automated-fix candidates.
 * @module cellarAnalysis/placementIssues
 */

import { escapeHtml } from '../utils.js';

/**
 * Render the duplicate slot assignments section.
 * Shows a notice (no execute button) for each wine with more slots than bottles.
 * Container is hidden when there are no duplicates to report.
 *
 * @param {Array|null|undefined} duplicates - From analysis.duplicatePlacements
 *   Each entry: { wineId, wineName, expectedCount, actualSlots, duplicateCount }
 */
export function renderDuplicatePlacements(duplicates) {
  const container = document.getElementById('analysis-duplicates');
  const listEl = document.getElementById('duplicates-list');
  if (!container || !listEl) return;

  if (!duplicates?.length) {
    container.style.display = 'none';
    return;
  }

  container.style.display = 'block';
  listEl.innerHTML = duplicates.map(d => `
    <div class="duplicate-placement-item">
      <div class="duplicate-placement-wine">${escapeHtml(d.wineName)}</div>
      <div class="duplicate-placement-detail">
        <span class="duplicate-badge">⚠ ${d.duplicateCount} extra slot${d.duplicateCount !== 1 ? 's' : ''}</span>
        ${d.actualSlots.length} slot${d.actualSlots.length !== 1 ? 's' : ''} assigned,
        only ${d.expectedCount} bottle${d.expectedCount !== 1 ? 's' : ''} recorded
      </div>
      <div class="duplicate-placement-slots">
        Slots: ${d.actualSlots.map(s => `<code>${escapeHtml(s)}</code>`).join(', ')}
      </div>
      <div class="duplicate-placement-cta">
        Data anomaly — open the wine record to correct the bottle count or remove the extra slot assignment.
      </div>
    </div>
  `).join('');
}
