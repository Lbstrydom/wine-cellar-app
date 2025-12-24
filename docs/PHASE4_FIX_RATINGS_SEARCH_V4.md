# Fix: Deduplicate Ratings + Improve Search Coverage

## Issues Found

1. **Duplicate Vivino** - Both parallel searches return Vivino, need deduplication
2. **Missing Tim Atkin** - Claude's web search didn't find results that Google finds easily

## Solution

1. Add deduplication before returning results
2. Add a third targeted search specifically for known critics
3. Add logging to diagnose search coverage issues

## Implementation

Replace the rating search functions in `src/services/claude.js`:

```javascript
/**
 * Fetch wine ratings from various sources using Claude web search.
 * Performs parallel searches: Vivino + Professional + Targeted Critics.
 * @param {Object} wine - Wine object with name, vintage, country, style
 * @returns {Promise<Object>} Fetched ratings
 */
export async function fetchWineRatings(wine) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('Claude API key not configured');
  }

  const wineName = wine.wine_name || 'Unknown';
  const vintage = wine.vintage || '';
  const style = wine.style || '';
  const country = wine.country || '';

  console.log(`[Ratings] Searching for: ${wineName} ${vintage}`);

  // Run searches in parallel
  const [vivinoResult, professionalResult, criticResult] = await Promise.all([
    searchVivino(wineName, vintage),
    searchCompetitions(wineName, vintage, country),
    searchCritics(wineName, vintage, country)
  ]);

  console.log(`[Ratings] Vivino found: ${vivinoResult.ratings.length} ratings`);
  console.log(`[Ratings] Competitions found: ${professionalResult.ratings.length} ratings`);
  console.log(`[Ratings] Critics found: ${criticResult.ratings.length} ratings`);

  // Combine and deduplicate
  const allRatings = deduplicateRatings([
    ...vivinoResult.ratings,
    ...professionalResult.ratings,
    ...criticResult.ratings
  ]);

  console.log(`[Ratings] After dedup: ${allRatings.length} ratings`);

  const searchNotes = [
    vivinoResult.search_notes,
    professionalResult.search_notes,
    criticResult.search_notes
  ].filter(Boolean).join(' | ');

  return {
    ratings: allRatings,
    search_notes: searchNotes || 'Search completed'
  };
}

/**
 * Deduplicate ratings by source.
 * If same source appears multiple times, keep the one with higher confidence.
 * @param {Array} ratings - Array of rating objects
 * @returns {Array} Deduplicated ratings
 */
function deduplicateRatings(ratings) {
  const seen = new Map();
  
  for (const rating of ratings) {
    const key = `${rating.source}-${rating.competition_year || 'any'}`;
    const existing = seen.get(key);
    
    if (!existing) {
      seen.set(key, rating);
    } else {
      // Keep the one with higher confidence
      const confidenceOrder = { high: 3, medium: 2, low: 1 };
      const existingConf = confidenceOrder[existing.match_confidence] || 0;
      const newConf = confidenceOrder[rating.match_confidence] || 0;
      
      if (newConf > existingConf) {
        seen.set(key, rating);
      }
    }
  }
  
  return Array.from(seen.values());
}

/**
 * Search specifically for Vivino rating.
 */
async function searchVivino(wineName, vintage) {
  const searchPrompt = `Find the Vivino rating for: ${wineName} ${vintage}

I need the star rating (out of 5) and number of user ratings.
Search Vivino for this wine.`;

  try {
    const searchResponse = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250514',
      max_tokens: 1000,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{ role: 'user', content: searchPrompt }]
    });

    const searchText = extractTextFromResponse(searchResponse);
    console.log(`[Vivino] Raw response length: ${searchText.length}`);

    if (!searchText || searchText.length < 20) {
      return { ratings: [], search_notes: 'Vivino: No results' };
    }

    const formatPrompt = `Extract the Vivino rating as JSON.

Return ONLY valid JSON:
{
  "ratings": [{
    "source": "vivino",
    "lens": "community",
    "score_type": "stars",
    "raw_score": "4.2",
    "competition_year": null,
    "rating_count": 163,
    "match_confidence": "high"
  }],
  "search_notes": "Found on Vivino"
}

If not found: {"ratings": [], "search_notes": "No Vivino rating found"}`;

    const formatResponse = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250514',
      max_tokens: 500,
      messages: [
        { role: 'user', content: searchPrompt },
        { role: 'assistant', content: searchText },
        { role: 'user', content: formatPrompt }
      ]
    });

    return parseRatingResponse(extractTextFromResponse(formatResponse), 'Vivino');

  } catch (error) {
    console.error('[Vivino] Search error:', error.message);
    return { ratings: [], search_notes: 'Vivino search failed' };
  }
}

/**
 * Search for competition medals.
 */
async function searchCompetitions(wineName, vintage, country) {
  const searchPrompt = `Find wine competition medals and awards for: ${wineName} ${vintage}
${country ? `Country: ${country}` : ''}

Search for medals from:
- Decanter World Wine Awards (DWWA)
- International Wine Challenge (IWC)
- International Wine & Spirit Competition (IWSC)
- Concours Mondial de Bruxelles
- Mundus Vini
- Veritas Awards (if South African)
- Any other major wine competition

Report any Gold, Silver, Bronze medals or awards found.`;

  try {
    const searchResponse = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250514',
      max_tokens: 1500,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{ role: 'user', content: searchPrompt }]
    });

    const searchText = extractTextFromResponse(searchResponse);
    console.log(`[Competitions] Raw response length: ${searchText.length}`);

    if (!searchText || searchText.length < 30) {
      return { ratings: [], search_notes: 'Competitions: No results' };
    }

    const formatPrompt = `Extract competition medals as JSON.

Source identifiers: decanter, iwc, iwsc, concours_mondial, mundus_vini, veritas, old_mutual

Return ONLY valid JSON:
{
  "ratings": [{
    "source": "decanter",
    "lens": "competition",
    "score_type": "medal",
    "raw_score": "Gold",
    "competition_year": 2024,
    "rating_count": null,
    "match_confidence": "high"
  }],
  "search_notes": "Found X medals"
}

If not found: {"ratings": [], "search_notes": "No competition medals found"}`;

    const formatResponse = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250514',
      max_tokens: 1000,
      messages: [
        { role: 'user', content: searchPrompt },
        { role: 'assistant', content: searchText },
        { role: 'user', content: formatPrompt }
      ]
    });

    return parseRatingResponse(extractTextFromResponse(formatResponse), 'Competitions');

  } catch (error) {
    console.error('[Competitions] Search error:', error.message);
    return { ratings: [], search_notes: 'Competition search failed' };
  }
}

/**
 * Search for critic scores - more targeted search.
 */
async function searchCritics(wineName, vintage, country) {
  // Build a targeted search for known critics
  const searchPrompt = `Find professional wine critic scores for: ${wineName} ${vintage}

Search specifically for reviews from:
- Tim Atkin (timatkin.com) - especially for South African wines
- Platter's Wine Guide - for South African wines
- Wine Advocate / Robert Parker
- Wine Spectator
- James Suckling
- Jancis Robinson
- Decanter magazine reviews

Search for "${wineName}" combined with each critic name.
Report any scores found (usually out of 100, or out of 20 for Jancis Robinson).`;

  try {
    const searchResponse = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250514',
      max_tokens: 1500,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{ role: 'user', content: searchPrompt }]
    });

    const searchText = extractTextFromResponse(searchResponse);
    console.log(`[Critics] Raw response length: ${searchText.length}`);
    console.log(`[Critics] Raw response preview: ${searchText.substring(0, 500)}`);

    if (!searchText || searchText.length < 30) {
      return { ratings: [], search_notes: 'Critics: No results' };
    }

    const formatPrompt = `Extract critic scores as JSON.

Source identifiers: tim_atkin, platters, wine_advocate, wine_spectator, james_suckling, jancis_robinson, decanter_magazine

Return ONLY valid JSON:
{
  "ratings": [{
    "source": "tim_atkin",
    "lens": "critics",
    "score_type": "points",
    "raw_score": "91",
    "competition_year": 2024,
    "rating_count": null,
    "match_confidence": "high"
  }],
  "search_notes": "Found Tim Atkin 91 points"
}

If not found: {"ratings": [], "search_notes": "No critic scores found"}
Do NOT include Vivino - that's handled separately.`;

    const formatResponse = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250514',
      max_tokens: 1000,
      messages: [
        { role: 'user', content: searchPrompt },
        { role: 'assistant', content: searchText },
        { role: 'user', content: formatPrompt }
      ]
    });

    return parseRatingResponse(extractTextFromResponse(formatResponse), 'Critics');

  } catch (error) {
    console.error('[Critics] Search error:', error.message);
    return { ratings: [], search_notes: 'Critic search failed' };
  }
}

/**
 * Extract text content from Claude response.
 */
function extractTextFromResponse(response) {
  return response.content
    .filter(c => c.type === 'text')
    .map(c => c.text)
    .join('\n');
}

/**
 * Parse rating response with multiple fallback strategies.
 */
function parseRatingResponse(text, source = 'Unknown') {
  // Strategy 1: Direct parse
  try {
    const parsed = JSON.parse(text.trim());
    if (parsed.ratings && Array.isArray(parsed.ratings)) {
      return parsed;
    }
  } catch (e) {
    // Continue
  }

  // Strategy 2: Extract from code block
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (codeBlockMatch) {
    try {
      const parsed = JSON.parse(codeBlockMatch[1].trim());
      if (parsed.ratings && Array.isArray(parsed.ratings)) {
        return parsed;
      }
    } catch (e) {
      // Continue
    }
  }

  // Strategy 3: Find JSON object
  const objectMatch = text.match(/\{[\s\S]*?"ratings"\s*:\s*\[[\s\S]*?\][\s\S]*?\}/);
  if (objectMatch) {
    try {
      const parsed = JSON.parse(objectMatch[0]);
      if (parsed.ratings && Array.isArray(parsed.ratings)) {
        return parsed;
      }
    } catch (e) {
      // Continue
    }
  }

  console.error(`[${source}] Failed to parse:`, text.substring(0, 300));
  return {
    ratings: [],
    search_notes: `${source}: Could not parse results`
  };
}
```

## What Changed

### 1. Three parallel searches instead of two
- `searchVivino()` - Dedicated Vivino search
- `searchCompetitions()` - Medal search
- `searchCritics()` - Critic score search (new, separate)

### 2. Deduplication
New `deduplicateRatings()` function removes duplicates by source, keeping the highest confidence match.

### 3. Better logging
Console logs show what each search found, helping diagnose issues.

### 4. Cleaner critic search prompt
Specifically mentions "timatkin.com" and asks to search for wine name + critic name.

### 5. Explicit "Do NOT include Vivino" in critic search
Prevents duplicate Vivino results.

## Diagnosing the Tim Atkin Issue

After applying this fix, check the server logs when searching. You should see:
```
[Ratings] Searching for: Springfield Estate Special Cuvee Sauvignon Blanc 2024
[Vivino] Raw response length: 450
[Competitions] Raw response length: 380
[Critics] Raw response length: 520
[Critics] Raw response preview: I found that Tim Atkin rated...
```

If the Critics raw response mentions Tim Atkin but it's not in the final results, the JSON parsing is the issue.

If the Critics raw response doesn't mention Tim Atkin at all, Claude's web search isn't finding the page.

## Alternative: Consider Perplexity or OpenAI

If Claude's web search consistently misses results that Google finds, options:

1. **Perplexity API** - Better web search coverage
2. **OpenAI with web browsing** - Different search index
3. **SerpAPI + Claude** - Use Google search API, then Claude to parse
4. **Direct scraping** - For specific sites like timatkin.com (but more fragile)

But first, let's see if the improved prompts help.

## Prompt for Claude in VS Code

```
@PHASE4_FIX_RATINGS_SEARCH_V4.md apply this fix - replace the rating search functions in src/services/claude.js with the new three-search approach including deduplication
```
