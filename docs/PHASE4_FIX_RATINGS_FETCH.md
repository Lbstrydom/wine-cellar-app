# Fix: Claude Web Search Rating Fetch

## Problem

When using Claude with web_search tool, Claude narrates what it's doing before returning results. The prompt asks for "ONLY valid JSON" but Claude responds conversationally first, causing JSON parsing to fail.

## Solution

Use a **two-step conversation approach**:

1. **First message**: Ask Claude to search and gather information (allow natural response)
2. **Second message**: Ask Claude to format the findings as JSON

This works because Claude maintains context within the conversation and can structure previously gathered information.

## Implementation

Replace the `fetchWineRatings` function in `src/services/claude.js` with:

```javascript
/**
 * Fetch wine ratings from various sources using Claude web search.
 * Uses two-step approach: search first, then format as JSON.
 * @param {Object} wine - Wine object with name, vintage, country, style
 * @returns {Promise<Object>} Fetched ratings
 */
export async function fetchWineRatings(wine) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('Claude API key not configured');
  }

  const searchPrompt = `Search for professional wine ratings and competition results for:

Wine: ${wine.wine_name}
Vintage: ${wine.vintage || 'NV'}
Style/Grape: ${wine.style || 'Unknown'}
Country: ${wine.country || 'Unknown'}

Search for ratings from these sources:
- Decanter World Wine Awards (DWWA)
- International Wine Challenge (IWC)
- International Wine & Spirit Competition (IWSC)
- Concours Mondial de Bruxelles
- Mundus Vini
${wine.country === 'South Africa' ? '- Veritas Awards\n- Old Mutual Trophy Wine Show\n- Platter\'s Wine Guide\n- Tim Atkin SA Report' : ''}
${wine.style?.toLowerCase().includes('chardonnay') ? '- Chardonnay du Monde' : ''}
${wine.style?.toLowerCase().includes('syrah') || wine.style?.toLowerCase().includes('shiraz') ? '- Syrah du Monde' : ''}
- Vivino (include the star rating and number of ratings)

Please search and tell me what ratings you find for this specific wine and vintage.`;

  // Step 1: Search and gather information
  const searchResponse = await anthropic.messages.create({
    model: 'claude-sonnet-4-5-20250514',
    max_tokens: 2000,
    tools: [{ type: 'web_search_20250305', name: 'web_search' }],
    messages: [{ role: 'user', content: searchPrompt }]
  });

  // Extract the text response from search
  const searchText = searchResponse.content
    .filter(c => c.type === 'text')
    .map(c => c.text)
    .join('\n');

  if (!searchText || searchText.length < 50) {
    return { ratings: [], search_notes: 'No search results found' };
  }

  // Step 2: Ask for structured JSON format
  const formatPrompt = `Based on the ratings you just found, format them as JSON.

For EACH rating found, include:
- source: source identifier (e.g., "decanter", "iwc", "veritas", "vivino", "platters", "tim_atkin")
- lens: "competition" for competitions, "critics" for critics/guides, "community" for Vivino
- score_type: "medal" for medals, "points" for numeric scores, "stars" for star ratings
- raw_score: the actual score (e.g., "Gold", "92", "4.1")
- competition_year: year of the competition/review (if known)
- award_name: any special award like "Trophy" or "Best in Show" (or null)
- rating_count: number of ratings (for Vivino only)
- source_url: URL where you found this (if available)
- vintage_match: "exact" if vintage matches, "non_vintage" if rating is for the wine generally
- match_confidence: "high" if certain, "medium" if likely, "low" if uncertain

Respond with ONLY this JSON structure, no other text:
{
  "ratings": [
    {
      "source": "veritas",
      "lens": "competition",
      "score_type": "medal",
      "raw_score": "Double Gold",
      "competition_year": 2023,
      "award_name": null,
      "rating_count": null,
      "source_url": "https://...",
      "vintage_match": "exact",
      "match_confidence": "high"
    }
  ],
  "search_notes": "Brief summary of what was found"
}

If no ratings were found, return: {"ratings": [], "search_notes": "No ratings found for this wine"}`;

  const formatResponse = await anthropic.messages.create({
    model: 'claude-sonnet-4-5-20250514',
    max_tokens: 1500,
    messages: [
      { role: 'user', content: searchPrompt },
      { role: 'assistant', content: searchText },
      { role: 'user', content: formatPrompt }
    ]
  });

  // Extract JSON from format response
  const formatText = formatResponse.content
    .filter(c => c.type === 'text')
    .map(c => c.text)
    .join('\n');

  // Try to parse JSON - be flexible about format
  try {
    // Try direct parse first
    return JSON.parse(formatText.trim());
  } catch (e1) {
    // Try to find JSON in code blocks
    const jsonMatch = formatText.match(/```json\s*([\s\S]*?)\s*```/) || 
                      formatText.match(/```\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[1].trim());
      } catch (e2) {
        // Continue to next attempt
      }
    }
    
    // Try to find JSON object anywhere in text
    const objectMatch = formatText.match(/\{[\s\S]*"ratings"[\s\S]*\}/);
    if (objectMatch) {
      try {
        return JSON.parse(objectMatch[0]);
      } catch (e3) {
        // Continue to fallback
      }
    }
    
    // Fallback: return empty with notes
    console.error('Failed to parse rating response:', formatText);
    return {
      ratings: [],
      search_notes: 'Found information but could not parse structured ratings. Raw response available in logs.'
    };
  }
}
```

## Why This Works

1. **First API call** with web_search tool - Claude searches freely and returns natural language summary of what it found
2. **Second API call** without tools - Claude formats the already-gathered information as JSON (no need to search again)
3. **Robust parsing** - Multiple fallback attempts to extract JSON from various formats

## Alternative: Single-call with better prompt (if two calls is too slow)

If performance is a concern, try this single-call variant with a more explicit prompt:

```javascript
const prompt = `You are a wine rating data extraction API. Search for ratings for this wine and return ONLY JSON.

Wine: ${wine.wine_name}
Vintage: ${wine.vintage || 'NV'}
Country: ${wine.country || 'Unknown'}

IMPORTANT: Your entire response must be valid JSON. Do not include any text before or after the JSON.
Do not say "I'll search" or explain what you're doing. Just return the JSON.

Required JSON format:
{"ratings": [...], "search_notes": "..."}

Search these sources: Decanter, IWC, Veritas, Vivino, Platter's`;
```

But the two-step approach is more reliable.

## Testing

After applying the fix, test with:
- De Grendel Koetshuis Sauvignon Blanc 2022 (should find Veritas, Platter's)
- Any well-known wine with Decanter awards
- A wine with only Vivino ratings

## Prompt for Claude in VS Code

```
Replace the fetchWineRatings function in src/services/claude.js with the two-step approach from this document. The current implementation fails because Claude narrates before returning JSON when using web search.
```
