/**
 * @fileoverview Visibility-based freshness checker for cellar analysis.
 * When the browser tab regains focus (visibilitychange) or the user returns
 * from another device, this module checks whether the cached analysis is stale
 * and silently refreshes it if needed.
 *
 * This prevents the user from seeing outdated misplacement counts or zone
 * suggestions after editing wines on another device/tab.
 *
 * @module cellarAnalysis/freshness
 */

import { checkAnalysisFreshness } from '../api.js';
import { isAnalysisLoaded } from './state.js';

/** Minimum interval between freshness checks (ms) — avoid hammering the API. */
const CHECK_COOLDOWN_MS = 30_000; // 30 seconds

/** Last time we checked freshness. */
let lastCheckAt = 0;

/** Whether a check is currently in flight. */
let checking = false;

/**
 * Check if the cached analysis is still valid and refresh if stale.
 * Only runs when the analysis tab has been loaded at least once.
 */
async function checkAndRefresh() {
  // Guard: don't check if analysis hasn't been loaded yet
  if (!isAnalysisLoaded()) return;

  // Guard: don't check if we're offline
  if (!navigator.onLine) return;

  // Guard: cooldown to avoid rapid re-checks
  const now = Date.now();
  if (now - lastCheckAt < CHECK_COOLDOWN_MS) return;

  // Guard: prevent concurrent checks
  if (checking) return;

  checking = true;
  lastCheckAt = now;

  try {
    const info = await checkAnalysisFreshness();

    // If the cache is invalid (slot hash mismatch), the analysis is stale
    if (info && info.cached && info.isValid === false) {
      // Dynamically import to avoid circular dependency
      const { loadAnalysis } = await import('./analysis.js');

      // Show subtle cache status update
      const cacheStatusEl = document.getElementById('analysis-cache-status');
      if (cacheStatusEl) {
        cacheStatusEl.textContent = 'Refreshing...';
      }

      await loadAnalysis(true);
    }
  } catch {
    // Fail silently — this is a background optimisation, not critical
  } finally {
    checking = false;
  }
}

/**
 * Initialise the visibility-change listener.
 * Called once during cellar analysis module init.
 */
export function initVisibilityRefresh() {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      checkAndRefresh();
    }
  });

  // Also check on window focus (some mobile browsers don't fire visibilitychange)
  window.addEventListener('focus', () => {
    checkAndRefresh();
  });
}
