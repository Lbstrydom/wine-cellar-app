/**
 * @fileoverview Wine identity token generation and validation.
 * Generates strict identity tokens for wine validation and generic tokens for discovery ranking.
 * @module services/wine/wineIdentity
 */

// logger reserved for future use

/**
 * Generate identity tokens from wine data.
 * Creates two distinct token sets:
 * 1. Wine Identity Score tokens - for strict validation
 * 2. Generic Token Overlap tokens - for discovery ranking
 *
 * @param {Object} wine - Wine object with producer, vintage, range, grape, region
 * @returns {Object} Identity tokens for validation
 */
export function generateIdentityTokens(wine) {
  const {
    winery = {},
    producer_name = null,
    vintage = null,
    range_name = null,
    grape_variety = null,
    country = null,
    region = null
  } = wine;

  const producerName = (typeof winery === 'string' ? winery : winery.name) || producer_name || '';
  const vintageSafe = parseInt(vintage) || null;
  const rangeName = range_name || '';
  const grapeName = grape_variety || '';
  const regionName = region || '';
  const countryName = country || '';

  // Tokenize and normalize strings
  const tokenize = (str) => {
    if (!str) return [];
    const normalized = normalizeText(str);
    return normalized
      .split(/\s+/)
      .filter(t => t.length > 1 && !isStopWord(t));
  };

  // Producer tokens (required for identity match)
  const producerTokens = tokenize(producerName);
  const producerAliases = getProducerAliases(producerName).map(tokenize).filter(a => a.length > 0);

  // Range/Cuvee tokens (optional match)
  const rangeTokens = tokenize(rangeName);

  // Grape tokens (optional match)
  const grapeTokens = tokenize(grapeName);

  // Region tokens (for discovery ranking)
  const regionTokens = tokenize(regionName);

  // Country tokens (for discovery ranking)
  const countryTokens = tokenize(countryName);

  // All name tokens combined (for generic overlap)
  const allNameTokens = [
    ...producerTokens,
    ...rangeTokens,
    ...grapeTokens
  ];

  // Negative tokens - reject if present in URL/content
  const negativeTokens = [
    // Competing wines often have similar producer but different descriptor
    // e.g., "Margaux du Tertre" when searching "Chateau Margaux"
    ...getCompetingProducerTokens(producerName)
  ];

  return {
    // Identity validation (strict matching)
    identity: {
      producer: producerTokens,
      producerAliases,
      producerRequired: true, // Must match for valid rating
      vintage: vintageSafe,
      vintageRequired: true, // Must match for valid rating
      range: rangeTokens,
      rangeOptional: true, // +2 if matches
      grape: grapeTokens,
      grapeOptional: true, // +1 if matches
      region: regionTokens,
      regionOptional: true // +1 if matches
    },

    // Discovery ranking (loose matching)
    discovery: {
      allTokens: allNameTokens,
      regionTokens,
      countryTokens,
      vintage: vintageSafe,
      vineyard: producerTokens[0] || '' // Primary vineyard identifier
    },

    // Rejection criteria
    negative: {
      producerCompeting: negativeTokens,
      vintageForbidden: getWrongVintagePatterns(vintageSafe),
      typeForbidden: getWineTypeForbidden(wine.wine_type || 'unknown')
    },

    // Raw data for debugging
    _raw: {
      producer: producerName,
      vintage: vintageSafe,
      range: rangeName,
      grape: grapeName,
      region: regionName,
      country: countryName
    }
  };
}

/**
 * Calculate identity score for URL/content against wine tokens.
 * Identity score determines if a rating belongs to this specific wine.
 * Threshold: 4 points (producer 2 + vintage 2 required minimum)
 *
 * @param {string} text - URL/title/snippet to score
 * @param {Object} identityTokens - Token object from generateIdentityTokens()
 * @returns {Object} Score and validation result
 */
export function calculateIdentityScore(text, identityTokens) {
  if (!text || !identityTokens) {
    return { score: 0, valid: false, reason: 'missing_input' };
  }

  const normalizedText = normalizeText(text);
  const tokens = normalizedText.split(/\s+/);

  const { identity, negative } = identityTokens;

  let score = 0;
  const matches = {
    producerMatch: false,
    vintageMatch: false,
    rangeMatch: false,
    grapeMatch: false,
    regionMatch: false
  };

  // Check negative tokens first - instant rejection if found
  if (matchesNegativeTokens(normalizedText, negative)) {
    return {
      score: -10,
      valid: false,
      reason: 'negative_token_match',
      matches
    };
  }

  // Required: Producer match
  if (identity.producerRequired && identity.producer.length > 0) {
    if (matchesTokens(tokens, identity.producer) || matchesAnyTokenSet(tokens, identity.producerAliases)) {
      score += 2;
      matches.producerMatch = true;
    } else {
      return {
        score: 0,
        valid: false,
        reason: 'producer_missing',
        matches
      };
    }
  }

  // Required: Vintage match
  if (identity.vintageRequired && identity.vintage) {
    if (matchesVintage(normalizedText, identity.vintage)) {
      score += 2;
      matches.vintageMatch = true;
    } else {
      return {
        score: score,
        valid: false,
        reason: 'vintage_missing_or_wrong',
        matches
      };
    }
  }

  // Optional: Range match
  if (identity.rangeOptional && identity.range.length > 0) {
    if (matchesTokens(tokens, identity.range)) {
      score += 1;
      matches.rangeMatch = true;
    }
  }

  // Optional: Grape match
  if (identity.grapeOptional && identity.grape.length > 0) {
    if (matchesTokens(tokens, identity.grape)) {
      score += 1;
      matches.grapeMatch = true;
    }
  }

  // Optional: Region match
  if (identity.regionOptional && identity.region.length > 0) {
    if (matchesTokens(tokens, identity.region)) {
      score += 1;
      matches.regionMatch = true;
    }
  }

  const valid = score >= 4; // Minimum threshold

  return {
    score,
    valid,
    reason: valid ? 'valid' : 'below_threshold',
    matches
  };
}

/**
 * Match text against a set of tokens.
 * @param {string[]} tokens - Tokenized text
 * @param {string[]} targetTokens - Target tokens to find
 * @returns {boolean} True if all target tokens found
 */
function matchesTokens(tokens, targetTokens) {
  if (!targetTokens || targetTokens.length === 0) return false;
  return targetTokens.every(t => tokens.includes(t));
}

/**
 * Match text tokens against any token set.
 * @param {string[]} tokens - Tokenized text
 * @param {string[][]} tokenSets - List of token arrays to match
 * @returns {boolean} True if any token set fully matches
 */
function matchesAnyTokenSet(tokens, tokenSets) {
  if (!tokenSets || tokenSets.length === 0) return false;
  return tokenSets.some(set => matchesTokens(tokens, set));
}

/**
 * Match vintage in text.
 * @param {string} text - Normalized text
 * @param {number} targetVintage - Target vintage year
 * @returns {boolean} True if vintage found
 */
function matchesVintage(text, targetVintage) {
  if (!targetVintage) return false;

  // Look for 4-digit year
  const vintagePattern = new RegExp(`\\b${targetVintage}\\b`);
  return vintagePattern.test(text);
}

/**
 * Check if text contains negative tokens.
 * @param {string} text - Normalized text
 * @param {Object} negative - Negative token set
 * @returns {boolean} True if negative tokens found
 */
function matchesNegativeTokens(text, negative) {
  if (!negative) return false;

  // Check competing producer tokens
  if (negative.producerCompeting && negative.producerCompeting.length > 0) {
    const tokens = text.split(/\s+/);
    if (negative.producerCompeting.some(t => tokens.includes(t))) {
      return true;
    }
  }

  // Check wrong vintage patterns
  if (negative.vintageForbidden && negative.vintageForbidden.length > 0) {
    if (negative.vintageForbidden.some(p => new RegExp(`\\b${p}\\b`).test(text))) {
      return true;
    }
  }

  // Check wrong wine type
  if (negative.typeForbidden && negative.typeForbidden.length > 0) {
    if (negative.typeForbidden.some(t => text.includes(t))) {
      return true;
    }
  }

  return false;
}

/**
 * Get competing producer tokens (usually additional descriptors).
 * @param {string} producerName - Primary producer name
 * @returns {string[]} Competing producer tokens
 */
function getCompetingProducerTokens(producerName) {
  // Common competing descriptors for famous names
  const competitors = {
    'margaux': ['tertre', 'bord', 'fontainebleau'],
    'pauillac': ['belgrave', 'lynch', 'latour'],
    'bordeaux': ['nuits', 'graves'],
    'burgundy': ['alsace', 'loire']
  };

  const normalized = normalizeText(producerName).split(/\s+/)[0];
  return competitors[normalized] || [];
}

/**
 * Get producer aliases for matching using algorithmic generation.
 * Instead of hardcoding specific producer aliases (which leads to overfitting),
 * we generate common alias patterns algorithmically.
 *
 * @param {string} producerName - Primary producer name
 * @returns {string[]} Alias names to match
 */
function getProducerAliases(producerName) {
  if (!producerName) return [];

  const normalized = normalizeText(producerName);
  const tokens = normalized.split(/\s+/).filter(t => t.length > 1);
  const aliases = [];

  // Pattern 1: If name starts with common prefixes, create alias without prefix
  // e.g., "Bodegas Vega Sicilia" -> "Vega Sicilia"
  // e.g., "Maison Louis Roederer" -> "Louis Roederer"
  const companyPrefixes = ['bodegas', 'bodega', 'maison', 'domaine', 'chateau', 'castello',
                           'tenuta', 'cantina', 'cave', 'weingut', 'schloss', 'casa'];
  if (tokens.length > 1 && companyPrefixes.includes(tokens[0])) {
    aliases.push(tokens.slice(1).join(' '));
  }

  // Pattern 2: If name ends with common suffixes, create alias without suffix
  // e.g., "Ridge Vineyards" -> "Ridge"
  // e.g., "Backsberg Estate" -> "Backsberg"
  const companySuffixes = ['vineyards', 'vineyard', 'estate', 'estates', 'winery',
                           'wines', 'cellars', 'cellar'];
  if (tokens.length > 1 && companySuffixes.includes(tokens[tokens.length - 1])) {
    aliases.push(tokens.slice(0, -1).join(' '));
  }

  // Pattern 3: For multi-word names, try last name only if 2+ words
  // e.g., "Louis Roederer" -> "Roederer" (common shorthand)
  if (tokens.length === 2 && !companyPrefixes.includes(tokens[0]) && !companySuffixes.includes(tokens[1])) {
    aliases.push(tokens[1]); // Last name only
  }

  // Pattern 4: For names with "and" or "&", try each part
  // e.g., "Smith and Hook" -> "Smith", "Hook"
  if (normalized.includes(' and ')) {
    const parts = normalized.split(' and ');
    aliases.push(...parts.map(p => p.trim()).filter(p => p.length > 2));
  }

  return aliases;
}

/**
 * Get wrong vintage patterns to reject.
 * DEPRECATED: Don't use this - check vintage separately in calculateIdentityScore
 * @param {number} targetVintage - Target vintage year
 * @returns {string[]} Vintage patterns to reject
 */
function getWrongVintagePatterns(_targetVintage) {
  // Don't return vintage patterns here - they're checked separately in calculateIdentityScore
  // to avoid false rejections on text containing multiple vintages
  return [];
}
/**
 * Get wine type forbidden patterns.
 * @param {string} wineType - Wine type (red, white, rosé, etc.)
 * @returns {string[]} Type patterns to reject
 */
function getWineTypeForbidden(wineType) {
  const forbidden = {
    red: ['rosé', 'white', 'sparkling'],
    white: ['red', 'rosé', 'sparkling'],
    rosé: ['red', 'white', 'sparkling'],
    sparkling: ['red', 'white', 'rosé', 'still']
  };

  return forbidden[wineType] || [];
}

/**
 * Normalize text for token matching.
 * @param {string} text - Text to normalize
 * @returns {string} Normalized text
 */
function normalizeText(text) {
  if (!text) return '';
  return text
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['’`]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Check if a word is a common stop word.
 * @param {string} word - Word to check
 * @returns {boolean} True if stop word
 */
function isStopWord(word) {
  const stopWords = new Set([
    'and', 'the', 'a', 'an', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'from', 'with', 'by', 'is', 'are', 'was', 'were', 'be', 'been',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'must', 'can', 'www', 'com', 'co', 'uk',
    'de', 'del', 'da', 'di', 'du', 'la', 'le', 'les', 'los', 'las', 'el',
    'von', 'van', 'der', 'den', 'st'
  ]);
  return stopWords.has(word.toLowerCase());
}

/**
 * Calculate generic token overlap for discovery ranking.
 * Used to prioritize which URLs to fetch based on how well they match the wine.
 *
 * @param {string} urlTitle - URL title or snippet
 * @param {Object} discoveryTokens - Discovery tokens from generateIdentityTokens()
 * @returns {number} Overlap score 0-100
 */
export function calculateDiscoveryTokenOverlap(urlTitle, discoveryTokens) {
  if (!urlTitle || !discoveryTokens) return 0;

  const normalizedUrl = normalizeText(urlTitle);
  const urlTokens = normalizedUrl.split(/\s+/);

  const { allTokens, regionTokens, countryTokens, vintage } = discoveryTokens;

  let matches = 0;
  let totalPossible = 0;

  // Count name token matches (highest weight)
  if (allTokens && allTokens.length > 0) {
    const nameMatches = allTokens.filter(t => urlTokens.includes(t)).length;
    matches += nameMatches * 2;
    totalPossible += allTokens.length * 2;
  }

  // Count region matches (medium weight)
  if (regionTokens && regionTokens.length > 0) {
    const regionMatches = regionTokens.filter(t => urlTokens.includes(t)).length;
    matches += regionMatches;
    totalPossible += regionTokens.length;
  }

  // Count country matches (lower weight)
  if (countryTokens && countryTokens.length > 0) {
    const countryMatches = countryTokens.filter(t => urlTokens.includes(t)).length;
    matches += Math.ceil(countryMatches * 0.5);
    totalPossible += Math.ceil(countryTokens.length * 0.5);
  }

  const baseScore = totalPossible > 0 ? Math.round((matches / totalPossible) * 100) : 0;
  let bonus = 0;

  if (allTokens && allTokens.length > 0) {
    const allNamePresent = allTokens.every(t => urlTokens.includes(t));
    if (allNamePresent) bonus += 10;
    if (vintage && urlTokens.includes(vintage.toString())) {
      bonus += allNamePresent ? 10 : 5;
    }
  }

  return Math.min(100, baseScore + bonus);
}
