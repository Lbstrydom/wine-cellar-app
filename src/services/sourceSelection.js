/**
 * @fileoverview Source ranking and selection for wine searches.
 * Prioritizes region-specific sources and adds grape-specific competitions.
 * @module services/sourceSelection
 */

import { getSourcesForCountry, SOURCES as SOURCE_REGISTRY, REGION_SOURCE_PRIORITY, LENS } from '../config/unifiedSources.js';

/**
 * Get sources for a wine based on country and detected grape.
 * Prioritizes region-specific sources and adds grape-specific competitions.
 * @param {string} country - Wine's country of origin
 * @param {string|null} grape - Detected grape variety
 * @returns {Object[]} Array of source configs sorted by priority
 */
export function getSourcesForWine(country, grape = null) {
  // Get base sources using region priority mapping
  const countryKey = country && REGION_SOURCE_PRIORITY[country] ? country : '_default';
  const prioritySourceIds = REGION_SOURCE_PRIORITY[countryKey] || REGION_SOURCE_PRIORITY['_default'];

  // Build source list from priority IDs
  let sources = prioritySourceIds
    .map(id => {
      const config = SOURCE_REGISTRY[id];
      if (!config) return null;
      return { id, ...config, relevance: 1.0 };
    })
    .filter(Boolean);

  // Add grape-specific competitions if grape is known
  if (grape) {
    const grapeNormalised = grape.toLowerCase();
    const grapeCompetitions = [];

    for (const [id, config] of Object.entries(SOURCE_REGISTRY)) {
      if (
        config.lens === LENS.COMPETITION &&
        config.grape_affinity &&
        config.grape_affinity.some(g =>
          grapeNormalised.includes(g) || g.includes(grapeNormalised)
        )
      ) {
        // Don't add if already in sources
        if (!sources.some(s => s.id === id)) {
          grapeCompetitions.push({ id, ...config, relevance: 1.0 });
        }
      }
    }

    // Prepend grape competitions (highest priority)
    sources = [...grapeCompetitions, ...sources];
  }

  // Add global competitions that aren't already included
  for (const [id, config] of Object.entries(SOURCE_REGISTRY)) {
    if (
      config.lens === LENS.COMPETITION &&
      config.grape_affinity === null &&
      config.home_regions.length === 0 &&
      !sources.some(s => s.id === id)
    ) {
      sources.push({ id, ...config, relevance: 0.8 });
    }
  }

  // Fill in remaining sources from getSourcesForCountry for completeness
  const countrySources = getSourcesForCountry(country);
  for (const source of countrySources) {
    if (!sources.some(s => s.id === source.id)) {
      sources.push(source);
    }
  }

  return sources;
}
