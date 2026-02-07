/**
 * @fileoverview Grouped banner for systemic zone configuration issues.
 * @module cellarAnalysis/zoneReconfigurationBanner
 */

import { escapeHtml, showToast } from '../utils.js';
import { openReconfigurationModal } from './zoneReconfigurationModal.js';
import { openMoveGuide } from './moveGuide.js';
import { getCurrentAnalysis } from './state.js';

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
 * Shows bottles that need to physically move to their new zones.
 */
function renderPostReconfigBanner(analysis) {
  const result = analysis.__reconfigResult || {};
  const zonesChanged = result.zonesChanged ?? 0;
  const skipped = result.actionsAutoSkipped ?? 0;

  // Get misplaced wines - these need to physically move to their new zones
  const misplacedWines = Array.isArray(analysis?.misplacedWines) ? analysis.misplacedWines : [];

  let contentHtml = '';

  if (misplacedWines.length === 0) {
    contentHtml = `
      <div class="zone-reconfig-banner-message">
        Zone boundaries updated successfully. All bottles are correctly placed.
      </div>
    `;
  } else {
    // Group by suggested zone for cleaner display
    const byTargetZone = new Map();
    for (const wine of misplacedWines) {
      const targetZone = wine.suggestedZone || 'Unknown';
      if (!byTargetZone.has(targetZone)) {
        byTargetZone.set(targetZone, []);
      }
      byTargetZone.get(targetZone).push(wine);
    }

    // Build the move list (show first 8, summarize rest)
    const moveItems = [];
    let shown = 0;
    const maxToShow = 8;

    for (const [targetZone, wines] of byTargetZone) {
      for (const wine of wines) {
        if (shown < maxToShow) {
          moveItems.push(`
            <li>
              <span class="wine-name">${escapeHtml(wine.name)}</span>
              <span class="move-arrow">→</span>
              <span class="target-zone">${escapeHtml(targetZone)}</span>
              <span class="current-slot">(currently ${escapeHtml(wine.currentSlot)})</span>
            </li>
          `);
          shown++;
        }
      }
    }

    const remaining = misplacedWines.length - shown;

    contentHtml = `
      <div class="zone-reconfig-banner-message">
        Zone boundaries updated. <strong>${misplacedWines.length} bottle(s)</strong> should be physically moved to their new zones:
      </div>
      <ul class="zone-reconfig-move-list">
        ${moveItems.join('')}
        ${remaining > 0 ? `<li class="more-items">... and ${remaining} more bottle(s)</li>` : ''}
      </ul>
      <div class="zone-reconfig-banner-hint">
        Use the "Suggested Moves" section below to see all moves and apply them.
      </div>
    `;
  }

  return `
    <div class="zone-reconfig-banner zone-reconfig-banner--success">
      <div class="zone-reconfig-banner-header">Zone Reconfiguration Complete</div>
      <div class="zone-reconfig-banner-body">
        ${contentHtml}
        <div class="zone-reconfig-banner-actions">
          <button class="btn btn-primary" data-action="scroll-to-moves">Review Moves Below</button>
          <button class="btn btn-secondary" data-action="open-move-guide">Visual Guide</button>
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
    // Wire "Review Moves Below" button
    const scrollBtn = el.querySelector('[data-action="scroll-to-moves"]');
    if (scrollBtn) {
      scrollBtn.addEventListener('click', () => {
        document.getElementById('analysis-moves')?.scrollIntoView({ behavior: 'smooth' });
      });
    }
    // Wire "Visual Guide" button
    const guideBtn = el.querySelector('[data-action="open-move-guide"]');
    if (guideBtn) {
      guideBtn.addEventListener('click', () => {
        const currentAnalysis = getCurrentAnalysis();
        if (currentAnalysis?.suggestedMoves) {
          openMoveGuide(currentAnalysis.suggestedMoves);
        }
      });
    }
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
