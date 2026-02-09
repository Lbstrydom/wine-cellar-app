/**
 * @fileoverview Range qualifier metadata registry.
 * Defines wine classifications and product lines with ambiguity levels and locale hints.
 * @module config/rangeQualifiers
 */

/**
 * Registry of wine range qualifiers (classifications, product lines, marketing terms).
 * @internal — exported for unit tests only
 */
export const RANGE_QUALIFIER_REGISTRY = [
  // ===== GERMAN VDP + PRÄDIKAT =====
  {
    term: 'grosses gewächs',
    aliases: ['gg', 'grosse lage'],
    locales: ['de', 'at'],
    ambiguity: 'low',
    type: 'regulated_classification',
    weight_base: 1.0
  },
  {
    term: 'spätlese',
    locales: ['de', 'at'],
    ambiguity: 'low',
    type: 'regulated_classification',
    weight_base: 1.0
  },
  {
    term: 'auslese',
    locales: ['de', 'at'],
    ambiguity: 'low',
    type: 'regulated_classification',
    weight_base: 1.0
  },
  {
    term: 'beerenauslese',
    aliases: ['ba'],
    locales: ['de', 'at'],
    ambiguity: 'low',
    type: 'regulated_classification',
    weight_base: 1.0
  },
  {
    term: 'trockenbeerenauslese',
    aliases: ['tba'],
    locales: ['de', 'at'],
    ambiguity: 'low',
    type: 'regulated_classification',
    weight_base: 1.0
  },
  {
    term: 'kabinett',
    locales: ['de', 'at'],
    ambiguity: 'low',
    type: 'regulated_classification',
    weight_base: 1.0
  },

  // ===== SPANISH CLASSIFICATIONS =====
  {
    term: 'gran reserva',
    locales: ['es'],
    ambiguity: 'low',
    type: 'regulated_classification',
    weight_base: 1.0
  },
  {
    term: 'reserva',
    locales: ['es', 'pt'],
    ambiguity: 'medium',  // Also used loosely in other markets
    type: 'regulated_classification',
    weight_base: 0.8
  },
  {
    term: 'crianza',
    locales: ['es'],
    ambiguity: 'low',
    type: 'regulated_classification',
    weight_base: 1.0
  },

  // ===== FRENCH CLASSIFICATIONS =====
  {
    term: 'premier cru',
    aliases: ['1er cru'],
    locales: ['fr'],
    ambiguity: 'low',
    type: 'regulated_classification',
    weight_base: 1.0
  },
  {
    term: 'grand cru',
    locales: ['fr'],
    ambiguity: 'low',
    type: 'regulated_classification',
    weight_base: 1.0
  },

  // ===== ITALIAN CLASSIFICATIONS =====
  {
    term: 'riserva',
    aliases: ['riserva'],
    locales: ['it'],
    ambiguity: 'low',
    type: 'regulated_classification',
    weight_base: 1.0
  },
  {
    term: 'docg',
    locales: ['it'],
    ambiguity: 'low',
    type: 'regulated_classification',
    weight_base: 0.9
  },

  // ===== PORTUGUESE CLASSIFICATIONS =====
  {
    term: 'garrafeira',
    locales: ['pt'],
    ambiguity: 'low',
    type: 'regulated_classification',
    weight_base: 1.0
  },

  // ===== PRODUCT LINES (Global, Higher Ambiguity) =====
  {
    term: 'vineyard selection',
    locales: ['global'],
    ambiguity: 'medium',
    type: 'product_line',
    weight_base: 0.9
  },
  {
    term: 'cellar selection',
    locales: ['global'],
    ambiguity: 'medium',
    type: 'product_line',
    weight_base: 0.9
  },
  {
    term: 'special release',
    locales: ['global'],
    ambiguity: 'medium',
    type: 'product_line',
    weight_base: 0.8
  },
  {
    term: 'limited edition',
    locales: ['global'],
    ambiguity: 'medium',
    type: 'product_line',
    weight_base: 0.8
  },

  // ===== MARKETING TERMS (High Ambiguity) =====
  {
    term: 'reserve',
    locales: ['global'],
    ambiguity: 'high',  // Often just marketing; regulated in some countries
    type: 'marketing',
    weight_base: 0.5
  },
  {
    term: 'premium',
    locales: ['global'],
    ambiguity: 'high',
    type: 'marketing',
    weight_base: 0.4
  },
  {
    term: 'select',
    locales: ['global'],
    ambiguity: 'high',
    type: 'marketing',
    weight_base: 0.4
  },

  // ===== SPARKLING CLASSIFICATIONS =====
  {
    term: 'blanc de blancs',
    locales: ['fr', 'global'],
    ambiguity: 'low',
    type: 'sparkling',
    weight_base: 1.0
  },
  {
    term: 'blanc de noirs',
    locales: ['fr', 'global'],
    ambiguity: 'low',
    type: 'sparkling',
    weight_base: 1.0
  },
  {
    term: 'brut',
    locales: ['fr', 'global'],
    ambiguity: 'medium',  // Common sweetness designation
    type: 'sparkling',
    weight_base: 0.7
  }
];

/**
 * Detect range qualifiers in a wine name.
 * Returns array of matched qualifiers with metadata.
 * @param {string} wineName - Wine name to analyze
 * @returns {Object[]} Array of { term, aliases, ambiguity, type, weight_base, locale_hints }
 */
export function detectQualifiers(wineName) {
  if (!wineName) return [];

  const wineNameLower = wineName.toLowerCase();
  const detected = [];
  const seen = new Set();

  for (const qualifier of RANGE_QUALIFIER_REGISTRY) {
    // Check primary term
    if (wineNameLower.includes(qualifier.term)) {
      if (!seen.has(qualifier.term)) {
        detected.push({
          ...qualifier,
          matched: qualifier.term
        });
        seen.add(qualifier.term);
      }
      continue;
    }

    // Check aliases
    if (qualifier.aliases) {
      for (const alias of qualifier.aliases) {
        if (wineNameLower.includes(alias)) {
          if (!seen.has(qualifier.term)) {
            detected.push({
              ...qualifier,
              matched: alias
            });
            seen.add(qualifier.term);
          }
          break;
        }
      }
    }
  }

  return detected;
}

/**
 * Detect locale hints from wine name (country/region indicators).
 * Returns map of { locale: confidence } (0-1).
 * High confidence triggers: German/Spanish/French keywords, producer types, etc.
 * @param {string} wineName - Wine name to analyze
 * @returns {Object} Map of locale codes to confidence scores
 */
export function detectLocaleHints(wineName) {
  if (!wineName) return {};

  const wineNameLower = wineName.toLowerCase();
  const hints = {};

  // German indicators (high confidence)
  const germanHighConfidence = ['spätlese', 'auslese', 'beerenauslese', 'kabinett', 'weingut', 'grosses gewächs', 'gg'];
  const germanMedium = ['mosel', 'rheingau', 'rheinpfalz', 'nahe', 'ahr'];
  if (germanHighConfidence.some(term => wineNameLower.includes(term))) {
    hints['de'] = 0.95;
  } else if (germanMedium.some(term => wineNameLower.includes(term))) {
    hints['de'] = 0.75;
  }

  // Spanish indicators
  const spanishHighConfidence = ['gran reserva', 'crianza', 'rioja', 'ribera', 'bodega', 'bodega'];
  const spanishMedium = ['reserva'];  // Ambiguous, but with other cues...
  if (spanishHighConfidence.some(term => wineNameLower.includes(term))) {
    hints['es'] = 0.9;
  } else if (spanishMedium.some(term => wineNameLower.includes(term)) && wineNameLower.includes('rioja')) {
    hints['es'] = 0.8;
  }

  // French indicators
  const frenchHighConfidence = ['château', 'château', 'premier cru', 'grand cru', 'domaine', 'burgundy', 'bordeaux'];
  const frenchMedium = ['cuvée'];
  if (frenchHighConfidence.some(term => wineNameLower.includes(term))) {
    hints['fr'] = 0.9;
  } else if (frenchMedium.some(term => wineNameLower.includes(term))) {
    hints['fr'] = 0.6;
  }

  // Italian indicators
  const italianHighConfidence = ['riserva', 'barolo', 'barbaresco', 'chianti', 'brunello', 'tenuta'];
  const italianMedium = ['docg'];
  if (italianHighConfidence.some(term => wineNameLower.includes(term))) {
    hints['it'] = 0.9;
  } else if (italianMedium.some(term => wineNameLower.includes(term))) {
    hints['it'] = 0.7;
  }

  // Portuguese indicators
  const portugueseHighConfidence = ['garrafeira', 'douro', 'dão'];
  if (portugueseHighConfidence.some(term => wineNameLower.includes(term))) {
    hints['pt'] = 0.85;
  }

  // Austrian indicators (similar to German)
  const austrianHighConfidence = ['spätlese', 'grüner veltliner', 'zweigelt'];
  if (austrianHighConfidence.some(term => wineNameLower.includes(term))) {
    hints['at'] = 0.85;
  }

  return hints;
}

/**
 * Get effective weight for a qualifier, accounting for ambiguity.
 * @internal — exported for unit tests only
 * @param {Object} qualifier - Qualifier object from registry
 * @param {Object} localeHints - Locale hints map from detectLocaleHints
 * @returns {number} Effective weight (0.5 - 1.0)
 */
export function getEffectiveWeight(qualifier, localeHints = {}) {
  let weight = qualifier.weight_base;

  // High-ambiguity terms need locale confirmation
  if (qualifier.ambiguity === 'high') {
    let localeConfirmed = false;

    // Check if any of this qualifier's locales are hinted
    if (qualifier.locales && localeHints) {
      for (const locale of qualifier.locales) {
        if (locale !== 'global' && localeHints[locale] && localeHints[locale] > 0.6) {
          localeConfirmed = true;
          break;
        }
      }
    }

    // Dampen if not locale-confirmed
    if (!localeConfirmed) {
      weight *= 0.6;  // 50% reduction for unconfirmed high-ambiguity
    }
  }

  // Medium-ambiguity terms are slightly dampened if no locale hint
  if (qualifier.ambiguity === 'medium') {
    let localeHinted = false;

    if (qualifier.locales && localeHints) {
      for (const locale of qualifier.locales) {
        if (locale !== 'global' && localeHints[locale] && localeHints[locale] > 0.5) {
          localeHinted = true;
          break;
        }
      }
    }

    if (!localeHinted && qualifier.locales && !qualifier.locales.includes('global')) {
      weight *= 0.8;  // 20% reduction for medium-ambiguity without locale hint
    }
  }

  return Math.max(0.4, Math.min(1.0, weight));
}

