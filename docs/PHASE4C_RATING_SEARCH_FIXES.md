# Phase 4c: Rating Search Structural Fixes

## Issues Identified from Logs

### Issue 1: Country "Unknown" → Regional Sources Never Searched
```
[Search] Country: Unknown
[Search] Relevant domains: decanter.com, internationalwinechallenge.com, iwsc.net...
```
Tim Atkin is on timatkin.com, but we never search it because the wine has no country set, so only global domains are included.

### Issue 2: DELETE Before INSERT Wipes Ratings on Failure
```
[Ratings] Extracted 1 ratings
[Ratings] Cleared existing ratings for wine 50
[Ratings] Inserting 1 unique ratings
```
If extraction fails or returns 0, we've already deleted the existing ratings.

### Issue 3: Vivino Returns 157 chars (Blocked/Empty)
```
[Fetch] Got 157 chars from vivino.com
[Fetch] Got 157 chars from vivino.com
```
Vivino is blocking or returning consent pages. We're wiping good data with nothing.

---

## Fix A: Include Regional Sources for Unknown Country

When country is unknown, include ALL regional sources at lower relevance (not zero).

### Update src/config/sourceRegistry.js

```javascript
/**
 * Get sources relevant for a given country.
 * If country unknown, include all sources (regional ones at lower relevance).
 * @param {string} country - Wine's country of origin (can be null/empty)
 * @returns {Object[]} Sorted array of source configs with relevance scores
 */
export function getSourcesForCountry(country) {
  const sources = [];
  const countryKnown = country && country.toLowerCase() !== 'unknown';
  
  for (const [id, config] of Object.entries(SOURCE_REGISTRY)) {
    let relevance;
    
    if (config.home_regions.length === 0) {
      // Global source - always fully relevant
      relevance = 1.0;
    } else if (countryKnown && config.home_regions.includes(country)) {
      // Regional source matching wine's country - fully relevant
      relevance = 1.0;
    } else if (countryKnown) {
      // Regional source NOT matching wine's country - low relevance
      relevance = 0.1;
    } else {
      // Country unknown - include regional sources at medium relevance
      // This ensures we search Tim Atkin, Platter's, etc. even without country
      relevance = 0.5;
    }
    
    const credibility = LENS_CREDIBILITY[config.lens] || 1.0;
    const score = credibility * relevance;
    
    sources.push({
      id,
      ...config,
      relevance,
      credibility,
      score
    });
  }
  
  // Sort by score descending (highest value sources first)
  return sources.sort((a, b) => b.score - a.score);
}

/**
 * Get domains to search for a given country.
 * If country unknown, include regional domains too.
 * @param {string} country - Wine's country of origin
 * @returns {string[]} Array of domains
 */
export function getDomainsForCountry(country) {
  const sources = getSourcesForCountry(country);
  const domains = new Set();
  
  for (const source of sources) {
    // Include if relevance >= 0.3 (captures unknown country regional sources)
    if (source.relevance >= 0.3) {
      domains.add(source.domain);
      if (source.alt_domains) {
        source.alt_domains.forEach(d => domains.add(d));
      }
    }
  }
  
  return Array.from(domains);
}
```

---

## Fix B: Transactional Replacement (Don't Delete Unless You Have Replacements)

### Update src/routes/ratings.js

```javascript
/**
 * Fetch ratings from web using multi-provider search.
 * @route POST /api/wines/:wineId/ratings/fetch
 */
router.post('/:wineId/ratings/fetch', async (req, res) => {
  const { wineId } = req.params;

  const wine = db.prepare('SELECT * FROM wines WHERE id = ?').get(wineId);
  if (!wine) {
    return res.status(404).json({ error: 'Wine not found' });
  }

  try {
    const result = await fetchWineRatings(wine);
    
    // Get existing ratings count for comparison
    const existingRatings = db.prepare(
      'SELECT * FROM wine_ratings WHERE wine_id = ? AND is_user_override != 1'
    ).all(wineId);
    
    const newRatings = result.ratings || [];
    
    // ONLY delete if we have valid replacements
    // This prevents losing data when search/extraction fails
    if (newRatings.length === 0) {
      console.log(`[Ratings] No new ratings found, keeping ${existingRatings.length} existing`);
      return res.json({
        message: 'No new ratings found, existing ratings preserved',
        search_notes: result.search_notes,
        ratings_kept: existingRatings.length
      });
    }
    
    // Use transaction for atomic replacement
    const transaction = db.transaction(() => {
      // Delete existing auto-fetched ratings (keep user overrides)
      db.prepare(`
        DELETE FROM wine_ratings 
        WHERE wine_id = ? AND (is_user_override != 1 OR is_user_override IS NULL)
      `).run(wineId);
      
      console.log(`[Ratings] Cleared ${existingRatings.length} existing auto-ratings for wine ${wineId}`);

      // Deduplicate by source before inserting
      const seenSources = new Set();
      const uniqueRatings = [];
      
      for (const rating of newRatings) {
        const key = `${rating.source}-${rating.competition_year || 'any'}`;
        if (!seenSources.has(key)) {
          seenSources.add(key);
          uniqueRatings.push(rating);
        }
      }

      // Insert new ratings
      const insertStmt = db.prepare(`
        INSERT INTO wine_ratings (
          wine_id, vintage, source, source_lens, score_type, raw_score, raw_score_numeric,
          normalized_min, normalized_max, normalized_mid,
          award_name, competition_year, rating_count,
          source_url, evidence_excerpt, matched_wine_label,
          vintage_match, match_confidence, fetched_at, is_user_override
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 0)
      `);

      let insertedCount = 0;
      for (const rating of uniqueRatings) {
        const sourceConfig = RATING_SOURCES[rating.source] || SOURCE_REGISTRY[rating.source];
        if (!sourceConfig) {
          console.warn(`[Ratings] Unknown source: ${rating.source}, skipping`);
          continue;
        }

        try {
          const normalized = normalizeScore(rating.source, rating.score_type, rating.raw_score);
          const numericScore = parseFloat(rating.raw_score) || null;

          insertStmt.run(
            wineId,
            wine.vintage,
            rating.source,
            rating.lens || sourceConfig.lens,
            rating.score_type,
            rating.raw_score,
            numericScore,
            normalized.min,
            normalized.max,
            normalized.mid,
            rating.award_name || null,
            rating.competition_year || null,
            rating.rating_count || null,
            rating.source_url || null,
            rating.evidence_excerpt || null,
            rating.matched_wine_label || null,
            rating.vintage_match || 'inferred',
            rating.match_confidence || 'medium'
          );
          insertedCount++;
        } catch (err) {
          console.error(`[Ratings] Failed to insert rating from ${rating.source}:`, err.message);
        }
      }

      console.log(`[Ratings] Inserted ${insertedCount} ratings for wine ${wineId}`);
      return insertedCount;
    });

    // Execute transaction
    const insertedCount = transaction();

    // Update aggregates
    const ratings = db.prepare('SELECT * FROM wine_ratings WHERE wine_id = ?').all(wineId);
    const prefSetting = db.prepare("SELECT value FROM user_settings WHERE key = 'rating_preference'").get();
    const preference = parseInt(prefSetting?.value || '40');
    const aggregates = calculateWineRatings(ratings, wine, preference);

    const tastingNotes = result.tasting_notes || null;

    db.prepare(`
      UPDATE wines SET
        competition_index = ?, critics_index = ?, community_index = ?,
        purchase_score = ?, purchase_stars = ?, confidence_level = ?,
        tasting_notes = COALESCE(?, tasting_notes),
        ratings_updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      aggregates.competition_index,
      aggregates.critics_index,
      aggregates.community_index,
      aggregates.purchase_score,
      aggregates.purchase_stars,
      aggregates.confidence_level,
      tastingNotes,
      wineId
    );

    res.json({
      message: `Found ${insertedCount} ratings (replaced ${existingRatings.length} existing)`,
      search_notes: result.search_notes,
      tasting_notes: tastingNotes,
      ...aggregates
    });

  } catch (error) {
    console.error('[Ratings] Fetch error:', error);
    res.status(500).json({ error: error.message });
  }
});
```

---

## Fix C: Better Fetch Handling (Log Failures, Keep Existing on Block)

### Update src/services/searchProviders.js

```javascript
/**
 * Fetch page content for parsing.
 * Returns detailed status for observability.
 * @param {string} url - URL to fetch
 * @param {number} maxLength - Maximum content length
 * @returns {Promise<Object>} { content, success, status, blocked, error }
 */
export async function fetchPageContent(url, maxLength = 8000) {
  const domain = extractDomain(url);
  console.log(`[Fetch] Fetching: ${url}`);
  
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      signal: controller.signal,
    });
    
    clearTimeout(timeout);
    
    const status = response.status;
    
    if (!response.ok) {
      console.log(`[Fetch] HTTP ${status} from ${domain}`);
      return { 
        content: '', 
        success: false, 
        status,
        blocked: status === 403 || status === 429,
        error: `HTTP ${status}` 
      };
    }
    
    const html = await response.text();
    
    // Check for blocked/consent indicators
    const isBlocked = 
      html.length < 500 && (
        html.includes('captcha') ||
        html.includes('consent') ||
        html.includes('verify') ||
        html.includes('cloudflare') ||
        html.includes('access denied')
      );
    
    if (isBlocked) {
      console.log(`[Fetch] Blocked/consent page from ${domain} (${html.length} chars)`);
      return {
        content: '',
        success: false,
        status,
        blocked: true,
        error: 'Blocked or consent page'
      };
    }
    
    // Special handling for Vivino (Next.js) - extract JSON data
    let text = '';
    if (domain.includes('vivino')) {
      text = extractVivinoData(html);
    }
    
    // If no special extraction or it failed, use standard HTML stripping
    if (!text) {
      text = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
        .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
        .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }
    
    // Check if we got meaningful content
    if (text.length < 200) {
      console.log(`[Fetch] Short response from ${domain}: ${text.length} chars - "${text.substring(0, 100)}..."`);
      return {
        content: text,
        success: false,
        status,
        blocked: true,
        error: `Too short (${text.length} chars)`
      };
    }
    
    console.log(`[Fetch] Got ${text.length} chars from ${domain}`);
    
    return { 
      content: text.substring(0, maxLength), 
      success: true, 
      status,
      blocked: false,
      error: null 
    };
    
  } catch (error) {
    const errorMsg = error.name === 'AbortError' ? 'Timeout' : error.message;
    console.error(`[Fetch] Failed for ${url}: ${errorMsg}`);
    return { 
      content: '', 
      success: false, 
      status: null,
      blocked: false,
      error: errorMsg 
    };
  }
}

/**
 * Extract rating data from Vivino's Next.js JSON payload.
 * @param {string} html - Raw HTML
 * @returns {string} Extracted text or empty string
 */
function extractVivinoData(html) {
  try {
    // Try __NEXT_DATA__ script
    const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
    if (nextDataMatch) {
      const jsonData = JSON.parse(nextDataMatch[1]);
      const wine = jsonData?.props?.pageProps?.wine;
      if (wine) {
        const parts = [
          `Wine: ${wine.name || ''}`,
          `Rating: ${wine.statistics?.ratings_average || ''} stars`,
          `Ratings count: ${wine.statistics?.ratings_count || ''}`,
          `Region: ${wine.region?.name || ''}`,
          `Country: ${wine.region?.country?.name || ''}`,
        ];
        console.log(`[Fetch] Extracted Vivino data: ${wine.statistics?.ratings_average} stars, ${wine.statistics?.ratings_count} ratings`);
        return parts.join('\n');
      }
    }
    
    // Try ld+json
    const ldJsonMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/i);
    if (ldJsonMatch) {
      const jsonData = JSON.parse(ldJsonMatch[1]);
      if (jsonData.aggregateRating) {
        return `Rating: ${jsonData.aggregateRating.ratingValue} stars (${jsonData.aggregateRating.ratingCount} ratings)`;
      }
    }
    
    // Try meta tags
    const ratingMatch = html.match(/content="(\d+\.?\d*)"[^>]*property="og:rating"/i) ||
                        html.match(/property="og:rating"[^>]*content="(\d+\.?\d*)"/i);
    if (ratingMatch) {
      return `Rating: ${ratingMatch[1]} stars`;
    }
    
  } catch (e) {
    console.log(`[Fetch] Vivino JSON extraction failed: ${e.message}`);
  }
  
  return '';
}

/**
 * Extract domain from URL.
 */
function extractDomain(url) {
  try {
    return new URL(url).hostname.replace('www.', '');
  } catch {
    return url;
  }
}
```

---

## Fix D: Per-Source Targeted Queries (Better Recall)

Instead of one OR query across 10 domains, search high-priority sources individually.

### Update src/services/searchProviders.js

```javascript
/**
 * Multi-tier search for wine ratings.
 * Runs targeted searches for high-value sources first.
 * @param {string} wineName - Wine name
 * @param {string|number} vintage - Vintage year
 * @param {string} country - Country of origin
 * @returns {Promise<Object>} Search results
 */
export async function searchWineRatings(wineName, vintage, country) {
  const sources = getSourcesForCountry(country);
  const topSources = sources.slice(0, 8); // Top 8 by credibility × relevance
  
  console.log(`[Search] Wine: "${wineName}" ${vintage}`);
  console.log(`[Search] Country: ${country || 'Unknown'}`);
  console.log(`[Search] Top sources: ${topSources.map(s => s.id).join(', ')}`);
  
  // Strategy 1: Targeted searches for top 3 sources (highest value)
  const targetedResults = [];
  const prioritySources = topSources.slice(0, 3);
  
  for (const source of prioritySources) {
    const query = buildSourceQuery(source, wineName, vintage);
    console.log(`[Search] Targeted search for ${source.id}: "${query}"`);
    
    const results = await searchGoogle(query, [source.domain]);
    if (results.length > 0) {
      targetedResults.push(...results.map(r => ({
        ...r,
        sourceId: source.id,
        lens: source.lens,
        credibility: source.credibility,
        relevance: source.relevance
      })));
    }
  }
  
  console.log(`[Search] Targeted searches found: ${targetedResults.length} results`);
  
  // Strategy 2: Broad search across remaining domains
  const remainingDomains = topSources.slice(3).map(s => s.domain);
  const broadQuery = `"${wineName}" ${vintage} rating`;
  
  let broadResults = [];
  if (targetedResults.length < 5 && remainingDomains.length > 0) {
    broadResults = await searchGoogle(broadQuery, remainingDomains);
    console.log(`[Search] Broad search found: ${broadResults.length} results`);
  }
  
  // Strategy 3: Brave fallback if still insufficient
  let braveResults = [];
  if (targetedResults.length + broadResults.length < 3) {
    console.log('[Search] Insufficient results, trying Brave fallback');
    braveResults = await searchBrave(`${wineName} ${vintage} wine rating review`);
    console.log(`[Search] Brave found: ${braveResults.length} results`);
  }
  
  // Combine and deduplicate by URL
  const allResults = [...targetedResults, ...broadResults, ...braveResults];
  const seen = new Set();
  const uniqueResults = allResults.filter(r => {
    if (seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  });
  
  // Enrich results without source metadata
  const enrichedResults = uniqueResults.map(r => {
    if (r.sourceId) return r; // Already enriched
    
    const matchedSource = sources.find(s => 
      r.source?.includes(s.domain) || 
      s.alt_domains?.some(d => r.source?.includes(d))
    );
    
    return {
      ...r,
      sourceId: matchedSource?.id || 'unknown',
      lens: matchedSource?.lens || 'unknown',
      credibility: matchedSource?.credibility || 0.5,
      relevance: matchedSource?.relevance || 0.5
    };
  });
  
  // Sort by credibility × relevance
  enrichedResults.sort((a, b) => (b.credibility * b.relevance) - (a.credibility * a.relevance));
  
  return {
    query: broadQuery,
    country: country || 'Unknown',
    results: enrichedResults.slice(0, 10),
    sources_searched: topSources.length,
    targeted_hits: targetedResults.length,
    broad_hits: broadResults.length,
    brave_hits: braveResults.length
  };
}

/**
 * Build a source-specific search query.
 * @param {Object} source - Source config
 * @param {string} wineName
 * @param {string|number} vintage
 * @returns {string} Search query
 */
function buildSourceQuery(source, wineName, vintage) {
  if (source.query_template) {
    return source.query_template
      .replace('{wine}', `"${wineName}"`)
      .replace('{vintage}', vintage || '');
  }
  return `"${wineName}" ${vintage}`;
}
```

---

## Summary of Changes

| File | Change |
|------|--------|
| `src/config/sourceRegistry.js` | Unknown country includes regional sources at 0.5 relevance |
| `src/routes/ratings.js` | Transactional replacement - only delete if we have replacements |
| `src/services/searchProviders.js` | Better fetch with blocked detection, Vivino JSON extraction |
| `src/services/searchProviders.js` | Per-source targeted queries for top 3 sources |

## Expected Results After Fix

For Springfield Estate (country unknown):
```
[Search] Country: Unknown
[Search] Top sources: vivino, decanter, iwc, tim_atkin, platters, james_suckling...
[Search] Targeted search for vivino: "Springfield Estate Special Cuvee" 2024 site:vivino.com
[Search] Targeted search for decanter: "Springfield Estate Special Cuvee" 2024 site:decanter.com
[Search] Targeted search for tim_atkin: "Springfield Estate Special Cuvee" 2024 site:timatkin.com
[Search] Targeted searches found: 5 results
```

Tim Atkin should now appear because:
1. `timatkin.com` is included even without country
2. We do a dedicated search for it (not buried in a 10-domain OR query)

---

## Prompt for Claude in VS Code

```
Apply the structural fixes from @PHASE4C_RATING_SEARCH_FIXES.md:

1. In src/config/sourceRegistry.js:
   - Update getSourcesForCountry() to include regional sources at 0.5 relevance when country is unknown
   - Update getDomainsForCountry() to include domains with relevance >= 0.3

2. In src/routes/ratings.js:
   - Wrap DELETE/INSERT in a transaction
   - Only delete if we have valid replacements (newRatings.length > 0)
   - If no new ratings found, preserve existing and return early

3. In src/services/searchProviders.js:
   - Update fetchPageContent() to detect blocked pages and log details
   - Add extractVivinoData() function for Next.js JSON extraction
   - Update searchWineRatings() to do targeted per-source queries for top 3 sources
   - Add buildSourceQuery() helper function
```
