/**
 * @fileoverview Feature flags for Phase 6 wine search integration.
 * @module config/featureFlags
 */

/**
 * Read boolean feature flag from env with default.
 * @param {string} key - Env var name
 * @param {boolean} defaultValue - Default flag value
 * @returns {boolean}
 */
function readFlag(key, defaultValue) {
  const raw = process.env[key];
  if (raw === undefined) return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(String(raw).toLowerCase());
}

export const FEATURE_FLAGS = {
  WINE_ADD_ORCHESTRATOR_ENABLED: readFlag('WINE_ADD_ORCHESTRATOR_ENABLED', true),
  SEARCH_CACHE_ENABLED: readFlag('SEARCH_CACHE_ENABLED', true),
  STRUCTURED_EXTRACTION_ENABLED: readFlag('STRUCTURED_EXTRACTION_ENABLED', true),
  DISAMBIGUATION_UI_ENABLED: readFlag('DISAMBIGUATION_UI_ENABLED', true)
};

export default FEATURE_FLAGS;
