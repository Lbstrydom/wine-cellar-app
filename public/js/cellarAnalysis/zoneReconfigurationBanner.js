/**
 * @fileoverview Grouped banner for systemic zone configuration issues.
 * @module cellarAnalysis/zoneReconfigurationBanner
 */

import { escapeHtml, showToast } from '../utils.js';
import { openReconfigurationModal } from './zoneReconfigurationModal.js';
import { switchWorkspace } from './state.js';
import {
  CTA_RECONFIGURE_ZONES,
  CAPACITY_ALERT_HOLISTIC_THRESHOLD,
  MISPLACEMENT_RATE_THRESHOLD
} from './labels.js';

function shouldShowHolisticBanner(analysis) {
  const alerts = Array.isArray(analysis?.alerts) ? analysis.alerts : [];
  const capacityAlerts = alerts.filter(a => a.type === 'zone_capacity_issue');

  const total = analysis?.summary?.totalBottles ?? 0;
  const misplaced = analysis?.summary?.misplacedBottles ?? 0;
  const misplacementRate = total > 0 ? misplaced / total : 0;

  return capacityAlerts.length >= CAPACITY_ALERT_HOLISTIC_THRESHOLD || misplacementRate >= MISPLACEMENT_RATE_THRESHOLD;
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
          <button class="btn btn-primary" data-action="zone-reconfig-full">${CTA_RECONFIGURE_ZONES}</button>
        </div>
        <div class="zone-reconfig-banner-details" data-zone-reconfig-details></div>
      </div>
    </div>
  `;
}

/**
 * Render a success banner after reconfiguration was just applied.
 * Shows bottles that need to physically move to their new zones.
 */
function renderPostReconfigBanner(analysis) {
  const result = analysis.__reconfigResult || {};
  const zonesChanged = result.zonesChanged ?? 0;
  const skipped = result.actionsAutoSkipped ?? 0;
  const misplacedCount = analysis?.summary?.misplacedBottles ?? 0;
  const message = misplacedCount > 0
    ? `Zone boundaries updated. <strong>${misplacedCount} bottle(s)</strong> should move to their new zone positions.`
    : 'Zone boundaries updated successfully. All bottles are correctly placed.';

  return `
    <div class="zone-reconfig-banner zone-reconfig-banner--success">
      <div class="zone-reconfig-banner-header">Zone Reconfiguration Complete</div>
      <div class="zone-reconfig-banner-body">
        <div class="zone-reconfig-banner-message">
          ${message}
        </div>
        <div class="zone-reconfig-banner-actions">
          <button class="btn btn-secondary" data-action="view-updated-zones">View Updated Zones</button>
          <button class="btn btn-primary" data-action="review-placement-moves">Review Placement Moves</button>
        </div>
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
    const zonesBtn = el.querySelector('[data-action="view-updated-zones"]');
    if (zonesBtn) {
      zonesBtn.addEventListener('click', () => {
        switchWorkspace('zones');
        document.getElementById('workspace-zones')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }

    const placementBtn = el.querySelector('[data-action="review-placement-moves"]');
    if (placementBtn) {
      placementBtn.addEventListener('click', () => {
        switchWorkspace('placement');

        const diffEl = document.getElementById('layout-diff-container');
        if (diffEl && diffEl.style.display !== 'none') {
          diffEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
          return;
        }

        const ctaEl = document.getElementById('layout-proposal-cta');
        if (ctaEl && ctaEl.style.display !== 'none') {
          ctaEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
          return;
        }

        document.getElementById('analysis-moves')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }

    // Right after reconfiguration, don't append generic alerts under the success
    // banner. The placement workspace already shows exact move actions.
    return { remainingAlerts: [], rendered: true };
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
