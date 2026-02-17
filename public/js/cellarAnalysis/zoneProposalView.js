/**
 * @fileoverview Shared renderer for zone layout proposals.
 * @module cellarAnalysis/zoneProposalView
 */

import { escapeHtml } from '../utils.js';

/**
 * Render under-threshold zones (zones skipped for dedicated rows).
 * @param {Array<Object>} underThresholdZones
 * @returns {string}
 */
function renderUnderThresholdZones(underThresholdZones) {
  if (!Array.isArray(underThresholdZones) || underThresholdZones.length === 0) {
    return '';
  }

  const items = underThresholdZones.map(zone => `
    <li>
      <strong>${escapeHtml(zone.displayName || zone.zoneId || 'Unknown')}</strong>
      (${zone.bottleCount || 0} bottles) - ${escapeHtml(zone.reason || 'Below threshold')}
    </li>
  `).join('');

  return `
    <div class="proposal-under-threshold">
      <h5>Below Dedicated-Row Threshold</h5>
      <p>These zones stay in buffer/overflow until they have enough bottles:</p>
      <ul>${items}</ul>
    </div>
  `;
}

/**
 * Render zone layout proposal as HTML.
 * @param {Object} proposal
 * @returns {string}
 */
export function renderZoneProposal(proposal) {
  const proposals = Array.isArray(proposal?.proposals) ? proposal.proposals : [];
  const underThresholdZones = Array.isArray(proposal?.underThresholdZones)
    ? proposal.underThresholdZones
    : [];
  const totalBottles = proposal?.totalBottles || 0;
  const totalRows = proposal?.totalRows || 0;

  if (proposals.length === 0) {
    if (underThresholdZones.length === 0) {
      return '<p>No zones to configure - your cellar appears to be empty.</p>';
    }

    return `
      <div class="proposal-summary">
        <strong>${totalBottles} bottles</strong> found, but none meet the minimum for dedicated rows.
      </div>
      ${renderUnderThresholdZones(underThresholdZones)}
      <p class="proposal-note">No row allocation changes are required right now.</p>
    `;
  }

  let html = `
    <div class="proposal-summary">
      <strong>${totalBottles} bottles</strong> across <strong>${proposals.length} zones</strong>
      using <strong>${totalRows} rows</strong>
    </div>
    <div class="proposal-zones">
  `;

  proposals.forEach((zone, idx) => {
    const wines = Array.isArray(zone.wines) ? zone.wines : [];
    html += `
      <div class="proposal-zone-card">
        <div class="zone-card-header">
          <span class="zone-order">${idx + 1}</span>
          <span class="zone-name">${escapeHtml(zone.displayName || zone.zoneId || 'Unknown')}</span>
          <span class="zone-rows">${(zone.assignedRows || []).join(', ')}</span>
        </div>
        <div class="zone-card-stats">
          <span>${zone.bottleCount || 0} bottles</span>
          <span>${zone.totalCapacity || 0} slots</span>
          <span>${zone.utilizationPercent || 0}% full</span>
        </div>
        <div class="zone-card-wines">
          ${wines.slice(0, 3).map(w => `<small>${escapeHtml(w.name || '')} ${w.vintage || ''}</small>`).join(', ')}
          ${wines.length > 3 ? `<small>+${wines.length - 3} more</small>` : ''}
        </div>
      </div>
    `;
  });

  html += '</div>';

  if (proposal?.unassignedRows?.length > 0) {
    html += `<p class="proposal-note">Unassigned rows: ${proposal.unassignedRows.join(', ')} (available for future growth)</p>`;
  }

  html += renderUnderThresholdZones(underThresholdZones);
  return html;
}
