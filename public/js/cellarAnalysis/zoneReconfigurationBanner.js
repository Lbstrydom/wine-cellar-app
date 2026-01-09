/**
 * @fileoverview Grouped banner for systemic zone configuration issues.
 * @module cellarAnalysis/zoneReconfigurationBanner
 */

import { escapeHtml, showToast } from '../utils.js';
import { openReconfigurationModal } from './zoneReconfigurationModal.js';

function shouldShowHolisticBanner(analysis) {
  const alerts = Array.isArray(analysis?.alerts) ? analysis.alerts : [];
  const capacityAlerts = alerts.filter(a => a.type === 'zone_capacity_issue');

  const total = analysis?.summary?.totalBottles ?? 0;
  const misplaced = analysis?.summary?.misplacedBottles ?? 0;
  const misplacementRate = total > 0 ? misplaced / total : 0;

  // Spec thresholds: alert spam (>=3) OR misplacement >=10-15%
  return capacityAlerts.length >= 3 || misplacementRate >= 0.10;
}

function summarizeCapacityAlerts(analysis) {
  const alerts = Array.isArray(analysis?.alerts) ? analysis.alerts : [];
  const capacityAlerts = alerts.filter(a => a.type === 'zone_capacity_issue');

  const byZone = new Map();
  for (const alert of capacityAlerts) {
    const data = alert.data || {};
    const zoneId = data.overflowingZoneId;
    if (!zoneId) continue;
    const wines = Array.isArray(data.winesNeedingPlacement) ? data.winesNeedingPlacement : [];

    if (!byZone.has(zoneId)) {
      byZone.set(zoneId, {
        zoneId,
        zoneName: data.overflowingZoneName || zoneId,
        affected: 0
      });
    }

    byZone.get(zoneId).affected += wines.length;
  }

  const zones = Array.from(byZone.values()).sort((a, b) => b.affected - a.affected);
  const totalAffected = zones.reduce((sum, z) => sum + z.affected, 0);
  return { zones, totalAffected, alertCount: capacityAlerts.length };
}

function renderBannerMarkup(summary) {
  const { zones, totalAffected } = summary;
  const zoneCount = zones.length;

  const bullets = zones.slice(0, 4).map(z => (
    `<li>• ${escapeHtml(z.zoneName)}: ${z.affected} bottle(s) overflow</li>`
  )).join('');

  const moreCount = Math.max(0, zoneCount - 4);

  return `
    <div class="zone-reconfig-banner">
      <div class="zone-reconfig-banner-header">⚠️ Zone Configuration Issues Detected</div>
      <div class="zone-reconfig-banner-body">
        <div class="zone-reconfig-banner-message">
          ${zoneCount} zone(s) have capacity issues affecting ${totalAffected} bottle(s).
        </div>
        ${bullets ? `<ul class="zone-reconfig-banner-list">${bullets}${moreCount ? `<li>• ... and ${moreCount} more zone(s)</li>` : ''}</ul>` : ''}
        <div class="zone-reconfig-banner-actions">
          <button class="btn btn-secondary" data-action="zone-reconfig-quick-fix">Quick Fix Individual Zones</button>
          <button class="btn btn-primary" data-action="zone-reconfig-full">Full Reconfiguration</button>
        </div>
        <div class="zone-reconfig-banner-details" data-zone-reconfig-details></div>
      </div>
    </div>
  `;
}

/**
 * Render a success banner after reconfiguration was just applied.
 */
function renderPostReconfigBanner(analysis) {
  const result = analysis.__reconfigResult || {};
  const zonesChanged = result.zonesChanged ?? 0;
  const skipped = result.actionsAutoSkipped ?? 0;

  const alerts = Array.isArray(analysis?.alerts) ? analysis.alerts : [];
  const capacityAlerts = alerts.filter(a => a.type === 'zone_capacity_issue');
  const bottlesNeedMove = capacityAlerts.reduce((sum, a) => {
    const wines = Array.isArray(a.data?.winesNeedingPlacement) ? a.data.winesNeedingPlacement : [];
    return sum + wines.length;
  }, 0);

  let statusMsg = '';
  if (bottlesNeedMove > 0) {
    statusMsg = `<div class="zone-reconfig-banner-message">Zone boundaries updated. ${bottlesNeedMove} bottle(s) may need to be physically moved to their new zones.</div>`;
  } else {
    statusMsg = `<div class="zone-reconfig-banner-message">Zone boundaries updated successfully. All bottles are correctly placed.</div>`;
  }

  return `
    <div class="zone-reconfig-banner zone-reconfig-banner--success">
      <div class="zone-reconfig-banner-header">Zone Reconfiguration Applied</div>
      <div class="zone-reconfig-banner-body">
        ${statusMsg}
        <div class="zone-reconfig-banner-details">
          <div>• Zones changed: ${zonesChanged}</div>
          ${skipped > 0 ? `<div>• Actions skipped (stale data): ${skipped}</div>` : ''}
        </div>
      </div>
    </div>
  `;
}

/**
 * Render grouped banner if systemic issues are detected.
 * Returns remaining alerts and whether it rendered.
 */
export function renderZoneReconfigurationBanner(analysis, { onRenderAnalysis } = {}) {
  const el = document.getElementById('analysis-alerts');
  if (!el) return { remainingAlerts: analysis?.alerts || [], rendered: false };

  // User explicitly requested per-zone quick fix view.
  if (analysis?.__showQuickFixZones) {
    return { remainingAlerts: analysis?.alerts || [], rendered: false };
  }

  // Just applied a reconfiguration - show success banner instead of issues
  if (analysis?.__justReconfigured) {
    el.innerHTML = renderPostReconfigBanner(analysis);
    // Filter out capacity alerts from remaining since we're handling them
    const alerts = Array.isArray(analysis?.alerts) ? analysis.alerts : [];
    const remainingAlerts = alerts.filter(a => a.type !== 'zone_capacity_issue');
    return { remainingAlerts, rendered: true };
  }

  if (!shouldShowHolisticBanner(analysis)) {
    return { remainingAlerts: analysis?.alerts || [], rendered: false };
  }

  const summary = summarizeCapacityAlerts(analysis);
  if (summary.zones.length === 0) {
    return { remainingAlerts: analysis?.alerts || [], rendered: false };
  }

  const alerts = Array.isArray(analysis?.alerts) ? analysis.alerts : [];
  const remainingAlerts = alerts.filter(a => a.type !== 'zone_capacity_issue');

  el.innerHTML = renderBannerMarkup(summary);

  const quickFixBtn = el.querySelector('[data-action="zone-reconfig-quick-fix"]');
  const fullBtn = el.querySelector('[data-action="zone-reconfig-full"]');
  const detailsEl = el.querySelector('[data-zone-reconfig-details]');

  if (quickFixBtn && detailsEl) {
    quickFixBtn.addEventListener('click', () => {
      showToast('Showing individual zone fixes');
      // The per-zone panels are supported by the normal renderer; re-render with a bypass flag.
      if (typeof onRenderAnalysis === 'function') {
        onRenderAnalysis({ ...analysis, __showQuickFixZones: true });
      }
    });
  }

  if (fullBtn) {
    fullBtn.addEventListener('click', async () => {
      try {
        await openReconfigurationModal({ onRenderAnalysis });
      } catch (err) {
        showToast(`Error: ${err.message}`);
      }
    });
  }

  return { remainingAlerts, rendered: true };
}
