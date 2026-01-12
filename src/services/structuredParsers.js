/**
 * @fileoverview Deterministic parsers for structured wine data extraction.
 * Implements Phase 5 of Wine Search Implementation Plan v1.1.
 * Reduces Claude API dependency by extracting from JSON-LD, microdata, and embedded JSON.
 * @module services/structuredParsers
 */

/**
 * Vivino Parser - Extracts from __NEXT_DATA__ embedded JSON
 * @param {string} html - Raw HTML content
 * @returns {Object|null} Extracted data or null
 */
function parseVivino(html) {
  if (!html || typeof html !== 'string') return null;

  try {
    const match = html.match(/<script id="__NEXT_DATA__"[^>]*>(.+?)<\/script>/s);
    if (!match) return null;

    const data = JSON.parse(match[1]);
    const wine = data?.props?.pageProps?.wine;
    if (!wine) return null;

    const result = {
      source: 'vivino',
      extractionMethod: '__NEXT_DATA__',
      confidence: 'high'
    };

    // Extract rating
    if (wine.statistics?.ratings_average) {
      result.rating = Number.parseFloat(wine.statistics.ratings_average);
    }

    // Extract rating count
    if (wine.statistics?.ratings_count) {
      result.ratingCount = Number.parseInt(wine.statistics.ratings_count, 10);
    }

    // Extract vintage
    if (wine.vintage?.year) {
      result.vintage = Number.parseInt(wine.vintage.year, 10);
    }

    // Extract wine name
    if (wine.name) {
      result.wineName = wine.name;
    }

    // Extract producer
    if (wine.winery?.name) {
      result.producer = wine.winery.name;
    }

    // Extract price
    if (wine.price?.amount) {
      result.price = {
        amount: Number.parseFloat(wine.price.amount),
        currency: wine.price.currency || 'USD'
      };
    }

    // Only return if we got at least a rating
    return result.rating ? result : null;
  } catch (_error) {
    // Parse failure - return null to try next parser
    return null;
  }
}

/**
 * JSON-LD Parser - Extracts from structured data script tags
 * @param {string} html - Raw HTML content
 * @returns {Object|null} Extracted data or null
 */
function parseJsonLd(html) {
  if (!html || typeof html !== 'string') return null;

  try {
    const matches = html.match(/<script type="application\/ld\+json"[^>]*>(.+?)<\/script>/gs);
    if (!matches) return null;

    for (const scriptTag of matches) {
      try {
        // Extract JSON content
        const jsonContent = scriptTag.replace(/<script[^>]*>|<\/script>/g, '');
        const data = JSON.parse(jsonContent);

        // Handle both single object and array of objects
        const items = Array.isArray(data) ? data : [data];

        for (const item of items) {
          // Look for Product type with aggregateRating
          if (item['@type'] === 'Product' && item.aggregateRating) {
            const result = {
              source: 'structured',
              extractionMethod: 'json-ld',
              confidence: 'high'
            };

            // Extract rating
            if (item.aggregateRating.ratingValue) {
              result.rating = Number.parseFloat(item.aggregateRating.ratingValue);
            }

            // Extract rating count
            if (item.aggregateRating.reviewCount) {
              result.ratingCount = Number.parseInt(item.aggregateRating.reviewCount, 10);
            } else if (item.aggregateRating.ratingCount) {
              result.ratingCount = Number.parseInt(item.aggregateRating.ratingCount, 10);
            }

            // Extract best/worst ratings for scale context
            if (item.aggregateRating.bestRating) {
              result.bestRating = Number.parseFloat(item.aggregateRating.bestRating);
            }
            if (item.aggregateRating.worstRating) {
              result.worstRating = Number.parseFloat(item.aggregateRating.worstRating);
            }

            // Extract product name
            if (item.name) {
              result.wineName = item.name;
            }

            // Extract price
            if (item.offers) {
              const offer = Array.isArray(item.offers) ? item.offers[0] : item.offers;
              if (offer.price) {
                result.price = {
                  amount: Number.parseFloat(offer.price),
                  currency: offer.priceCurrency || 'USD'
                };
              }
            }

            // Only return if we got a rating
            if (result.rating) return result;
          }
        }
      } catch (_e) {
        // JSON parse failed for this tag, try next one
        continue;
      }
    }

    return null;
  } catch (_error) {
    return null;
  }
}

/**
 * Microdata Parser - Extracts from HTML microdata attributes
 * @param {string} html - Raw HTML content
 * @returns {Object|null} Extracted data or null
 */
function parseMicrodata(html) {
  if (!html || typeof html !== 'string') return null;

  try {
    const result = {
      source: 'microdata',
      extractionMethod: 'microdata',
      confidence: 'medium'
    };

    // Extract rating value - try content attribute first, then text content
    const ratingMatch = html.match(/itemprop=["']ratingValue["'](?:[^>]*content=["']([^"']+)["']|[^>]*>([^<]+)<)/i);
    if (ratingMatch) {
      const value = ratingMatch[1] || ratingMatch[2];
      if (value) {
        const numValue = Number.parseFloat(value.trim());
        if (!Number.isNaN(numValue)) {
          result.rating = numValue;
        }
      }
    }

    // Extract review/rating count
    const countPatterns = [
      /itemprop=["']reviewCount["'][^>]*(?:content=["']([^"']+)["']|>([^<]+)<)/i,
      /itemprop=["']ratingCount["'][^>]*(?:content=["']([^"']+)["']|>([^<]+)<)/i
    ];

    for (const pattern of countPatterns) {
      const countMatch = html.match(pattern);
      if (countMatch) {
        const value = countMatch[1] || countMatch[2];
        if (value) {
          result.ratingCount = Number.parseInt(value.trim().replace(/,/g, ''), 10);
          break;
        }
      }
    }

    // Extract best rating for scale context
    const bestRatingMatch = html.match(/itemprop=["']bestRating["'][^>]*(?:content=["']([^"']+)["']|>([^<]+)<)/i);
    if (bestRatingMatch) {
      const value = bestRatingMatch[1] || bestRatingMatch[2];
      if (value) {
        result.bestRating = Number.parseFloat(value.trim());
      }
    }

    // Extract worst rating
    const worstRatingMatch = html.match(/itemprop=["']worstRating["'][^>]*(?:content=["']([^"']+)["']|>([^<]+)<)/i);
    if (worstRatingMatch) {
      const value = worstRatingMatch[1] || worstRatingMatch[2];
      if (value) {
        result.worstRating = Number.parseFloat(value.trim());
      }
    }

    // Extract product name
    const nameMatch = html.match(/itemprop=["']name["'][^>]*(?:content=["']([^"']+)["']|>([^<]+)<)/i);
    if (nameMatch) {
      const value = nameMatch[1] || nameMatch[2];
      if (value) {
        result.wineName = value.trim();
      }
    }

    // Only return if we got a rating
    return result.rating ? result : null;
  } catch (_error) {
    return null;
  }
}

/**
 * Wine-Searcher Parser - Extracts from Wine-Searcher specific structure
 * @param {string} html - Raw HTML content
 * @returns {Object|null} Extracted data or null
 */
function parseWineSearcher(html) {
  if (!html || typeof html !== 'string') return null;

  try {
    const result = {
      source: 'wine-searcher',
      extractionMethod: 'wine-searcher',
      confidence: 'high'
    };

    // Try JSON-LD first (Wine-Searcher often has this)
    const jsonLdResult = parseJsonLd(html);
    if (jsonLdResult) {
      return { ...jsonLdResult, source: 'wine-searcher', extractionMethod: 'wine-searcher' };
    }

    // Fallback to Wine-Searcher specific patterns
    // Average rating pattern: <span class="review-score">96</span>
    const scoreMatch = html.match(/<span[^>]*class=["'][^"']*review-score[^"']*["'][^>]*>(\d+(?:\.\d+)?)<\/span>/i);
    if (scoreMatch) {
      result.rating = Number.parseFloat(scoreMatch[1]);
    }

    // Review count pattern
    const countMatch = html.match(/(\d+)\s+reviews?/i);
    if (countMatch) {
      result.ratingCount = Number.parseInt(countMatch[1], 10);
    }

    return result.rating ? result : null;
  } catch (_error) {
    return null;
  }
}

/**
 * All available parsers
 */
export const STRUCTURED_PARSERS = {
  vivino: parseVivino,
  jsonld: parseJsonLd,
  microdata: parseMicrodata,
  wineSearcher: parseWineSearcher
};

/**
 * Domain to parser priority mapping
 * Parsers tried in order - first success wins
 */
export const DOMAIN_PARSERS = {
  'vivino.com': ['vivino', 'jsonld'],
  'totalwine.com': ['jsonld', 'microdata'],
  'wine.com': ['jsonld'],
  'klwines.com': ['microdata', 'jsonld'],
  'lcbo.com': ['jsonld'],
  'wine-searcher.com': ['wineSearcher', 'jsonld'],
  'gall.nl': ['jsonld', 'microdata'],
  'wijnvoordeel.nl': ['jsonld', 'microdata'],
  'saq.com': ['jsonld']
};

/**
 * Try structured extraction for a given domain and HTML
 * @param {string} html - Raw HTML content
 * @param {string} domain - Domain name (e.g., 'vivino.com')
 * @returns {Object|null} Extracted data with extractionMethod, or null if all parsers failed
 */
export function tryStructuredExtraction(html, domain) {
  if (!html || !domain) return null;

  // Normalize domain (remove www. prefix)
  const normalizedDomain = domain.replace(/^www\./, '');

  // Get parser list for this domain, fallback to generic parsers
  const parserNames = DOMAIN_PARSERS[normalizedDomain] || ['jsonld', 'microdata'];

  // Try each parser in order
  for (const parserName of parserNames) {
    const parser = STRUCTURED_PARSERS[parserName];
    if (!parser) continue;

    const result = parser(html);
    if (result) {
      // Add domain context
      return {
        ...result,
        domain: normalizedDomain,
        timestamp: new Date().toISOString()
      };
    }
  }

  // All parsers failed
  return null;
}

/**
 * Get parser names for a domain (useful for debugging)
 * @param {string} domain - Domain name
 * @returns {string[]} List of parser names that will be tried
 */
export function getParsersForDomain(domain) {
  const normalizedDomain = domain.replace(/^www\./, '');
  return DOMAIN_PARSERS[normalizedDomain] || ['jsonld', 'microdata'];
}

/**
 * Check if a domain has specific parsers configured
 * @param {string} domain - Domain name
 * @returns {boolean}
 */
export function hasDomainParser(domain) {
  const normalizedDomain = domain.replace(/^www\./, '');
  return normalizedDomain in DOMAIN_PARSERS;
}
