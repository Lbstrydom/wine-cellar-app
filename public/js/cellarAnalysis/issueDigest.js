/**
 * @fileoverview Consolidated issue digest for cellar analysis.
 * Replaces fragmented alert cards with one prioritised MECE digest,
 * grouped by workspace: Structure | Placement | Fridge.
 * @module cellarAnalysis/issueDigest
 */

import { escapeHtml } from '../utils.js';
import { startZoneSetup } from './zones.js';
import { switchWorkspace } from './state.js';
import {
  TAB_CELLAR_PLACEMENT,
  TAB_FRIDGE,
  CAPACITY_ALERT_HOLISTIC_THRESHOLD
} from './labels.js';

/** @type {Function|null} Cached render-analysis callback for CTA wiring */
let _digestOnRenderAnalysis = null;

/** @type {Function|null} Callback to open the reconfiguration modal */
let _openReconfigFn = null;

/**
 * Set the render-analysis callback and reconfig opener for digest CTA wiring.
 * Called from analysis.js when rendering.
 * @param {Function} renderCb - onRenderAnalysis callback
 * @param {Function} reconfigFn - function to open reconfiguration modal
 */
export function setDigestCallback(renderCb, reconfigFn) {
  _digestOnRenderAnalysis = renderCb;
  _openReconfigFn = reconfigFn;
}

/**
 * @typedef {Object} DigestItem
 * @property {'structure'|'placement'|'fridge'} workspace
 * @property {'warning'|'info'} severity
 * @property {string} message - Short one-line issue description
 * @property {string} [cta] - CTA button text (optional)
 * @property {string} [ctaWorkspace] - Workspace tab to switch to on click
 * @property {string} [ctaAction] - Special action identifier
 * @property {Object} [sourceAlert] - Original alert object for action wiring
 */

/**
 * Classify an alert into a workspace-owned digest item.
 * Returns null for alerts that should be suppressed from the digest
 * (rendered in detail elsewhere, e.g. Cellar Review workspace).
 * @param {Object} alert - Raw alert from analysis.alerts
 * @param {Object} summary - Analysis summary for context
 * @returns {DigestItem|null}
 */
function classifyAlert(alert, summary) {
  const type = alert.type;

  // Structure issues
  if (type === 'zone_capacity_issue') {
    const data = alert.data || {};
    const zoneName = data.overflowingZoneName || data.overflowingZoneId || 'zone';
    const wineCount = Array.isArray(data.winesNeedingPlacement) ? data.winesNeedingPlacement.length : 0;
    return {
      workspace: 'structure',
      severity: 'warning',
      message: `${zoneName}: ${wineCount} bottle(s) over capacity`,
      cta: 'Reorganise Zones',
      ctaAction: 'reorganise-zones',
      sourceAlert: alert
    };
  }

  if (type === 'zones_not_configured') {
    return {
      workspace: 'structure',
      severity: 'warning',
      message: 'Zones not configured',
      cta: 'Setup Zones',
      ctaAction: 'setup-zones',
      sourceAlert: alert
    };
  }

  // Color adjacency violations are shown in detail inside Cellar Review
  // workspace (#zone-issue-actions). Suppress from digest to avoid
  // duplicating what the user sees when they navigate there.
  if (type === 'color_adjacency_violation') {
    return null;
  }

  // Colour order violations are shown in detail inside Cellar Review
  // workspace (#zone-issue-actions). Suppress from digest to avoid
  // duplicating what the user sees when they navigate there.
  if (type === 'colour_order_violation') {
    return null;
  }

  // Reorganisation recommended is a meta-alert that restates issues already
  // covered by dedicated alerts (capacity, color boundary, scattered wines).
  // Suppress from digest to avoid duplication.
  if (type === 'reorganisation_recommended') {
    return null;
  }

  if (type === 'scattered_wines') {
    return {
      workspace: 'placement',
      severity: 'warning',
      message: alert.message,
      cta: TAB_CELLAR_PLACEMENT,
      ctaWorkspace: 'placement',
      sourceAlert: alert
    };
  }

  if (type === 'row_gaps') {
    return {
      workspace: 'placement',
      severity: 'info',
      message: alert.message,
      cta: TAB_CELLAR_PLACEMENT,
      ctaWorkspace: 'placement',
      sourceAlert: alert
    };
  }

  if (type === 'unclassified_wines') {
    return {
      workspace: 'structure',
      severity: 'warning',
      message: alert.message,
      cta: 'Reorganise Zones',
      ctaAction: 'reorganise-zones',
      sourceAlert: alert
    };
  }

  // Default: generic placement issue
  return {
    workspace: 'placement',
    severity: alert.severity || 'info',
    message: alert.message,
    sourceAlert: alert
  };
}

/**
 * Build digest items from analysis alerts, grouped and sorted by priority.
 * @param {Object} analysis - Full analysis report
 * @returns {{ structure: DigestItem[], placement: DigestItem[], fridge: DigestItem[] }}
 */
export function buildDigestGroups(analysis) {
  const alerts = Array.isArray(analysis?.alerts) ? analysis.alerts : [];
  const summary = analysis?.summary || {};

  const groups = { structure: [], placement: [], fridge: [] };

  for (const alert of alerts) {
    const item = classifyAlert(alert, summary);
    if (!item) continue; // Suppressed — rendered in detail elsewhere
    groups[item.workspace].push(item);
  }

  // Add color adjacency summary (suppressed from classifyAlert, shown as one line)
  const colorAlerts = alerts.filter(a => a.type === 'color_adjacency_violation');
  if (colorAlerts.length > 0) {
    groups.structure.push({
      workspace: 'structure',
      severity: 'warning',
      message: `${colorAlerts.length} color boundary violation(s)`,
      cta: 'Reorganise Zones',
      ctaAction: 'reorganise-zones'
    });
  }

  // Add colour order violation summary (suppressed from classifyAlert, shown as one line)
  const colourOrderAlerts = alerts.filter(a => a.type === 'colour_order_violation');
  if (colourOrderAlerts.length > 0) {
    const issueCount = colourOrderAlerts[0]?.data?.issues?.length || colourOrderAlerts.length;
    groups.structure.push({
      workspace: 'structure',
      severity: 'warning',
      message: `${issueCount} colour order violation(s)`,
      cta: 'Reorganise Zones',
      ctaAction: 'reorganise-zones'
    });
  }

  // Add fridge readiness issues from fridgeStatus (not in alerts array)
  const fridge = analysis?.fridgeStatus;
  if (fridge) {
    const gaps = fridge.parLevelGaps ? Object.keys(fridge.parLevelGaps) : [];
    if (gaps.length > 0) {
      groups.fridge.push({
        workspace: 'fridge',
        severity: 'info',
        message: `${gaps.length} category gap(s) in fridge`,
        cta: TAB_FRIDGE,
        ctaWorkspace: 'fridge'
      });
    }
  }

  // Consolidate capacity issues when threshold met (holistic summary)
  if (groups.structure.filter(i => i.sourceAlert?.type === 'zone_capacity_issue').length >= CAPACITY_ALERT_HOLISTIC_THRESHOLD) {
    const capacityItems = groups.structure.filter(i => i.sourceAlert?.type === 'zone_capacity_issue');
    const totalAffected = capacityItems.reduce((sum, i) => {
      const data = i.sourceAlert?.data || {};
      return sum + (Array.isArray(data.winesNeedingPlacement) ? data.winesNeedingPlacement.length : 0);
    }, 0);
    // Replace individual capacity items with one consolidated item
    groups.structure = groups.structure.filter(i => i.sourceAlert?.type !== 'zone_capacity_issue');
    groups.structure.unshift({
      workspace: 'structure',
      severity: 'warning',
      message: `${capacityItems.length} zones over capacity (${totalAffected} bottles affected)`,
      cta: 'Reorganise Zones',
      ctaAction: 'reorganise-zones'
    });
  }

  // Sort: warnings before info within each group
  const severityOrder = { warning: 0, info: 1 };
  for (const key of Object.keys(groups)) {
    groups[key].sort((a, b) => (severityOrder[a.severity] ?? 2) - (severityOrder[b.severity] ?? 2));
  }

  return groups;
}

const WORKSPACE_LABELS = {
  structure: 'Structure',
  placement: 'Placement',
  fridge: 'Fridge'
};

const WORKSPACE_ICONS = {
  structure: '🏗️',
  placement: '📦',
  fridge: '❄️'
};

/**
 * Render the consolidated issue digest into #analysis-alerts.
 * @param {Object} analysis - Full analysis report
 */
export function renderIssueDigest(analysis) {
  const el = document.getElementById('analysis-alerts');
  if (!el) return;

  const groups = buildDigestGroups(analysis);
  const totalIssues = groups.structure.length + groups.placement.length + groups.fridge.length;

  if (totalIssues === 0) {
    el.innerHTML = '';
    return;
  }

  let html = '<div class="issue-digest">';
  html += `<div class="issue-digest-header">Cellar Issues <span class="issue-digest-count">${totalIssues}</span></div>`;
  html += '<div class="issue-digest-body">';

  for (const [key, items] of Object.entries(groups)) {
    if (items.length === 0) continue;

    // One CTA per group header (from first item that has one)
    const ctaItem = items.find(i => i.cta);
    const groupCtaHtml = ctaItem
      ? ` <button class="btn btn-small btn-secondary digest-cta" ${ctaItem.ctaWorkspace ? `data-digest-workspace="${ctaItem.ctaWorkspace}"` : ''} ${ctaItem.ctaAction ? `data-digest-action="${ctaItem.ctaAction}"` : ''}>${escapeHtml(ctaItem.cta)}</button>`
      : '';

    html += `<div class="issue-digest-group">`;
    html += `<div class="issue-digest-group-label"><span>${WORKSPACE_ICONS[key]} ${WORKSPACE_LABELS[key]}</span>${groupCtaHtml}</div>`;

    for (const item of items) {
      const severityClass = item.severity === 'warning' ? 'digest-warning' : 'digest-info';

      html += `<div class="issue-digest-item ${severityClass}">`;
      html += `<span class="digest-message">${escapeHtml(item.message)}</span>`;
      html += '</div>';
    }

    html += '</div>';
  }

  html += '</div></div>';
  el.innerHTML = html;

  // Wire CTA buttons
  el.addEventListener('click', (e) => {
    const btn = e.target.closest('.digest-cta');
    if (!btn) return;

    const workspace = btn.dataset.digestWorkspace;
    const action = btn.dataset.digestAction;

    if (action === 'setup-zones') {
      startZoneSetup();
      return;
    }

    if (action === 'reorganise-zones') {
      if (_openReconfigFn) _openReconfigFn({ onRenderAnalysis: _digestOnRenderAnalysis });
      return;
    }

    if (workspace) {
      switchWorkspace(workspace);
      // Scroll the target workspace panel into view
      const panel = document.getElementById(`workspace-${workspace}`);
      if (panel) {
        panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  });
}
