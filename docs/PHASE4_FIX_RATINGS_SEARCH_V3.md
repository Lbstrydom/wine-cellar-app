# Fix: Guaranteed Vivino + Professional Ratings Search

## Design Principle

**Three-lens scoring requires three lenses:**
1. **Community (Vivino)** - Always search, always available as baseline
2. **Competition** - Search for medals from blind panels
3. **Critics** - Search for scores from professionals

The previous approach relied on Claude to search Vivino as part of a broad search. This was unreliable. 

**New approach**: Explicitly search Vivino first, then search for professional ratings separately.

## Implementation

Replace `fetchWineRatings` in `src/services/claude.js`:

```javascript
/**
 * Fetch wine ratings from various sources using Claude web search.
 * Performs two searches: Vivino (guaranteed baseline) + Professional ratings.
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

  // Run both searches in parallel for speed
  const [vivinoResult, professionalResult] = await Promise.all([
    searchVivino(wineName, vintage),
    searchProfessionalRatings(wineName, vintage, style, country)
  ]);

  // Combine results
  const allRatings = [
    ...vivinoResult.ratings,
    ...professionalResult.ratings
  ];

  const searchNotes = [
    vivinoResult.search_notes,
    professionalResult.search_notes
  ].filter(Boolean).join(' | ');

  return {
    ratings: allRatings,
    search_notes: searchNotes || 'Search completed'
  };
}

/**
 * Search specifically for Vivino rating.
 * @param {string} wineName
 * @param {string|number} vintage
 * @returns {Promise<Object>}
 */
async function searchVivino(wineName, vintage) {
  const searchPrompt = `Find the Vivino rating for this wine:

**${wineName}${vintage ? ` ${vintage}` : ''}**

I need:
1. The star rating (out of 5, e.g., 4.2)
2. The number of user ratings/reviews (e.g., 1,500 ratings)

Search Vivino for this specific wine and vintage.`;

  try {
    const searchResponse = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250514',
      max_tokens: 1000,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{ role: 'user', content: searchPrompt }]
    });

    const searchText = searchResponse.content
      .filter(c => c.type === 'text')
      .map(c => c.text)
      .join('\n');

    if (!searchText || searchText.length < 20) {
      return { ratings: [], search_notes: 'Vivino: No results' };
    }

    // Format response
    const formatPrompt = `Based on what you found, extract the Vivino rating.

Return ONLY this JSON (no other text):
{
  "ratings": [
    {
      "source": "vivino",
      "lens": "community",
      "score_type": "stars",
      "raw_score": "4.2",
      "competition_year": null,
      "rating_count": 1500,
      "match_confidence": "high"
    }
  ],
  "search_notes": "Found on Vivino with X ratings"
}

If no Vivino rating was found:
{"ratings": [], "search_notes": "No Vivino rating found"}

Rules:
- raw_score should be the star rating as a string (e.g., "4.2", "3.8")
- rating_count should be a number (e.g., 1500, not "1,500")
- match_confidence: "high" if exact wine/vintage, "medium" if wine matches but vintage differs, "low" if uncertain`;

    const formatResponse = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250514',
      max_tokens: 500,
      messages: [
        { role: 'user', content: searchPrompt },
        { role: 'assistant', content: searchText },
        { role: 'user', content: formatPrompt }
      ]
    });

    const formatText = formatResponse.content
      .filter(c => c.type === 'text')
      .map(c => c.text)
      .join('\n');

    return parseRatingResponse(formatText, 'Vivino');

  } catch (error) {
    console.error('Vivino search error:', error);
    return { ratings: [], search_notes: 'Vivino search failed' };
  }
}

/**
 * Search for professional ratings (competitions + critics).
 * @param {string} wineName
 * @param {string|number} vintage
 * @param {string} style
 * @param {string} country
 * @returns {Promise<Object>}
 */
async function searchProfessionalRatings(wineName, vintage, style, country) {
  // Build country-aware prompt
  const countryContext = country 
    ? `Country: ${country}` 
    : 'Country: Unknown (infer from wine name if possible)';

  const searchPrompt = `Find professional wine ratings and competition results for:

**${wineName}${vintage ? ` ${vintage}` : ''}**
${style ? `Style: ${style}` : ''}
${countryContext}

Search for:

**Competition medals** (blind panel tastings):
- Decanter World Wine Awards (DWWA)
- International Wine Challenge (IWC)
- International Wine & Spirit Competition (IWSC)
- Concours Mondial de Bruxelles
- Mundus Vini
- Regional competitions if relevant (e.g., Veritas for South Africa, Wines of Argentina awards, etc.)

**Critic scores** (professional reviews):
- Tim Atkin MW (especially South Africa, Argentina)
- Platter's Wine Guide (South Africa)
- Wine Advocate / Robert Parker
- Wine Spectator
- James Suckling
- Jancis Robinson
- Decanter magazine
- Regional critics relevant to the wine's origin

Report any medals, scores, or awards you find for this specific wine and vintage.`;

  try {
    const searchResponse = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250514',
      max_tokens: 2000,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{ role: 'user', content: searchPrompt }]
    });

    const searchText = searchResponse.content
      .filter(c => c.type === 'text')
      .map(c => c.text)
      .join('\n');

    if (!searchText || searchText.length < 30) {
      return { ratings: [], search_notes: 'Professional: No results' };
    }

    // Format response
    const formatPrompt = `Based on the ratings you found, format them as JSON.

Source identifiers to use:
- Competitions: decanter, iwc, iwsc, concours_mondial, mundus_vini, veritas, old_mutual
- Critics: tim_atkin, platters, wine_advocate, wine_spectator, james_suckling, jancis_robinson, decanter_magazine

Return ONLY this JSON (no other text):
{
  "ratings": [
    {
      "source": "decanter",
      "lens": "competition",
      "score_type": "medal",
      "raw_score": "Gold",
      "competition_year": 2023,
      "rating_count": null,
      "match_confidence": "high"
    },
    {
      "source": "tim_atkin",
      "lens": "critics",
      "score_type": "points",
      "raw_score": "92",
      "competition_year": 2023,
      "rating_count": null,
      "match_confidence": "high"
    }
  ],
  "search_notes": "Found X competition medals and Y critic scores"
}

If no professional ratings found:
{"ratings": [], "search_notes": "No professional ratings found"}

Rules:
- For medals: raw_score should be "Grand Gold", "Gold", "Silver", "Bronze", or "Commended"
- For points: raw_score should be the numeric score as string (e.g., "92", "95")
- competition_year: the year of the competition or review
- match_confidence: "high" if exact wine/vintage match, "medium" if close, "low" if uncertain
- Only include ratings you actually found - do not fabricate`;

    const formatResponse = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250514',
      max_tokens: 1500,
      messages: [
        { role: 'user', content: searchPrompt },
        { role: 'assistant', content: searchText },
        { role: 'user', content: formatPrompt }
      ]
    });

    const formatText = formatResponse.content
      .filter(c => c.type === 'text')
      .map(c => c.text)
      .join('\n');

    return parseRatingResponse(formatText, 'Professional');

  } catch (error) {
    console.error('Professional ratings search error:', error);
    return { ratings: [], search_notes: 'Professional search failed' };
  }
}

/**
 * Parse rating response with multiple fallback strategies.
 * @param {string} text - Response text
 * @param {string} source - Source label for logging
 * @returns {Object} Parsed ratings
 */
function parseRatingResponse(text, source = 'Unknown') {
  // Strategy 1: Direct parse
  try {
    const parsed = JSON.parse(text.trim());
    if (parsed.ratings && Array.isArray(parsed.ratings)) {
      return parsed;
    }
  } catch (e) {
    // Continue to fallbacks
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
      // Continue to fallbacks
    }
  }

  // Strategy 3: Find JSON object in text
  const objectMatch = text.match(/\{[\s\S]*?"ratings"\s*:\s*\[[\s\S]*?\][\s\S]*?\}/);
  if (objectMatch) {
    try {
      const parsed = JSON.parse(objectMatch[0]);
      if (parsed.ratings && Array.isArray(parsed.ratings)) {
        return parsed;
      }
    } catch (e) {
      // Continue to fallback
    }
  }

  // Final fallback
  console.error(`Failed to parse ${source} rating response:`, text.substring(0, 300));
  return {
    ratings: [],
    search_notes: `${source}: Could not parse results`
  };
}
```

## Update Rating Sources Config

Add new sources to `src/config/ratingSources.js`:

```javascript
// Add these to the RATING_SOURCES object:

wine_advocate: {
  name: 'Wine Advocate / Robert Parker',
  short_name: 'Wine Advocate',
  lens: 'critics',
  credibility: 0.75,
  scope: 'global',
  home_regions: [],
  score_type: 'points',
  points_scale: { min: 50, max: 100 }
},

wine_spectator: {
  name: 'Wine Spectator',
  short_name: 'Wine Spectator',
  lens: 'critics',
  credibility: 0.70,
  scope: 'global',
  home_regions: [],
  score_type: 'points',
  points_scale: { min: 50, max: 100 }
},

james_suckling: {
  name: 'James Suckling',
  short_name: 'Suckling',
  lens: 'critics',
  credibility: 0.65,
  scope: 'global',
  home_regions: [],
  score_type: 'points',
  points_scale: { min: 50, max: 100 }
},

jancis_robinson: {
  name: 'Jancis Robinson',
  short_name: 'Jancis Robinson',
  lens: 'critics',
  credibility: 0.80,
  scope: 'global',
  home_regions: [],
  score_type: 'points',
  points_scale: { min: 12, max: 20 }  // Uses 20-point scale
},

decanter_magazine: {
  name: 'Decanter Magazine',
  short_name: 'Decanter Mag',
  lens: 'critics',
  credibility: 0.75,
  scope: 'global',
  home_regions: [],
  score_type: 'points',
  points_scale: { min: 0, max: 100 }
},
```

## Update Normalization for Jancis Robinson's 20-point Scale

In `src/services/ratings.js`, update `normalizeScore`:

```javascript
// Add handling for Jancis Robinson's 20-point scale
if (source === 'jancis_robinson' && scoreType === 'points') {
  const points = parseFloat(rawScore);
  // Convert 20-point scale to 100-point scale
  // 20 = 100, 18 = 90, 16 = 80, etc.
  const normalized = (points / 20) * 100;
  return { min: normalized, max: normalized, mid: normalized };
}
```

## How This Works

```
User clicks "Search Ratings"
        ↓
fetchWineRatings(wine)
        ↓
    ┌───────────────────────────────────────┐
    │         Promise.all (parallel)         │
    ├───────────────┬───────────────────────┤
    │               │                       │
    ▼               ▼                       
searchVivino()   searchProfessionalRatings()
    │               │
    │  Search #1    │  Search #2
    │  Format #1    │  Format #2
    │               │
    ▼               ▼
 Vivino rating    Competition medals
 + rating count   + Critic scores
    │               │
    └───────┬───────┘
            │
            ▼
    Combine results
            │
            ▼
    Return to UI
```

## Benefits

1. **Vivino always searched** - Guaranteed baseline for every wine
2. **Parallel execution** - Both searches run simultaneously (faster)
3. **Separation of concerns** - Vivino search is simple and focused
4. **Country-aware professionals** - Mentions regional critics/competitions
5. **Works for any country** - Not SA-specific, Claude infers relevance

## Expected Results

| Wine | Expected Vivino | Expected Professional |
|------|-----------------|----------------------|
| SA Sauvignon Blanc | ★4.1 (2,000 ratings) | Veritas Gold, Tim Atkin 92, Platter's 4.5 |
| NZ Sauvignon Blanc | ★4.0 (5,000 ratings) | IWC Silver, Decanter 90 |
| Argentine Malbec | ★4.2 (3,000 ratings) | Tim Atkin 94, Suckling 92 |
| Spanish Rioja | ★3.9 (8,000 ratings) | Decanter Gold, Parker 91 |
| Unknown wine | ★3.5 (50 ratings) | None found |

## Prompt for Claude in VS Code

```
@PHASE4_FIX_RATINGS_SEARCH_V3.md apply this fix - replace the entire fetchWineRatings function and add helper functions searchVivino, searchProfessionalRatings, parseRatingResponse in src/services/claude.js. Also add new critic sources to src/config/ratingSources.js and update normalization for Jancis Robinson's 20-point scale in src/services/ratings.js
```
