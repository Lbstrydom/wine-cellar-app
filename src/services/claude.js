/**
 * @fileoverview Claude API integration for sommelier feature.
 * @module services/claude
 */

import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

/**
 * Get sommelier wine recommendation for a dish.
 * @param {Database} db - Database connection
 * @param {string} dish - Dish description
 * @param {string} source - 'all' or 'reduce_now'
 * @param {string} colour - 'any', 'red', 'white', or 'rose'
 * @returns {Promise<Object>} Sommelier recommendations
 */
export async function getSommelierRecommendation(db, dish, source, colour) {
  // Build wine query based on filters
  let wineQuery;
  const params = [];

  if (source === 'reduce_now') {
    wineQuery = `
      SELECT
        w.id, w.wine_name, w.vintage, w.style, w.colour,
        COUNT(s.id) as bottle_count,
        GROUP_CONCAT(DISTINCT s.location_code) as locations,
        rn.priority, rn.reduce_reason
      FROM reduce_now rn
      JOIN wines w ON w.id = rn.wine_id
      LEFT JOIN slots s ON s.wine_id = w.id
      WHERE 1=1
    `;
    if (colour !== 'any') {
      wineQuery += ` AND w.colour = ?`;
      params.push(colour);
    }
    wineQuery += ` GROUP BY w.id HAVING bottle_count > 0 ORDER BY rn.priority, w.wine_name`;
  } else {
    wineQuery = `
      SELECT
        w.id, w.wine_name, w.vintage, w.style, w.colour,
        COUNT(s.id) as bottle_count,
        GROUP_CONCAT(DISTINCT s.location_code) as locations
      FROM wines w
      LEFT JOIN slots s ON s.wine_id = w.id
      WHERE 1=1
    `;
    if (colour !== 'any') {
      wineQuery += ` AND w.colour = ?`;
      params.push(colour);
    }
    wineQuery += ` GROUP BY w.id HAVING bottle_count > 0 ORDER BY w.colour, w.style`;
  }

  const wines = db.prepare(wineQuery).all(...params);

  if (wines.length === 0) {
    return {
      dish_analysis: "No wines match your filters.",
      recommendations: [],
      no_match_reason: `No ${colour !== 'any' ? colour + ' ' : ''}wines found${source === 'reduce_now' ? ' in reduce-now list' : ''}.`
    };
  }

  // Format wines for prompt
  const winesList = wines.map(w =>
    `- ${w.wine_name} ${w.vintage || 'NV'} (${w.style}, ${w.colour}) - ${w.bottle_count} bottle(s) at ${w.locations}`
  ).join('\n');

  // Get priority wines if source is 'all'
  let prioritySection = '';
  if (source === 'all') {
    const priorityWines = db.prepare(`
      SELECT w.wine_name, w.vintage, rn.reduce_reason
      FROM reduce_now rn
      JOIN wines w ON w.id = rn.wine_id
      JOIN slots s ON s.wine_id = w.id
      ${colour !== 'any' ? 'WHERE w.colour = ?' : ''}
      GROUP BY w.id
      ORDER BY rn.priority
    `).all(colour !== 'any' ? [colour] : []);

    if (priorityWines.length > 0) {
      prioritySection = `\nPRIORITY WINES (these should be drunk soon - prefer if suitable):\n` +
        priorityWines.map(w => `- ${w.wine_name} ${w.vintage || 'NV'}: ${w.reduce_reason}`).join('\n');
    }
  }

  const sourceDesc = source === 'reduce_now'
    ? 'Choosing only from priority wines that should be drunk soon'
    : 'Choosing from full cellar inventory';

  const colourDesc = {
    'any': 'No colour preference - suggest what works best',
    'red': 'Red wines only',
    'white': 'White wines only',
    'rose': 'Rosé wines only'
  }[colour];

  const prompt = buildSommelierPrompt(dish, sourceDesc, colourDesc, winesList, prioritySection);

  // Call Claude API
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 1500,
    messages: [{ role: 'user', content: prompt }]
  });

  // Parse response
  const responseText = message.content[0].text;
  let parsed;

  try {
    const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/) ||
                      responseText.match(/```\s*([\s\S]*?)\s*```/);
    const jsonStr = jsonMatch ? jsonMatch[1] : responseText;
    parsed = JSON.parse(jsonStr.trim());
  } catch (_parseError) {
    console.error('Failed to parse Claude response:', responseText);
    throw new Error('Could not parse sommelier response');
  }

  // Enrich recommendations with locations
  if (parsed.recommendations) {
    parsed.recommendations = parsed.recommendations.map(rec => {
      const wine = wines.find(w =>
        w.wine_name === rec.wine_name &&
        (w.vintage === rec.vintage || (!w.vintage && !rec.vintage))
      );
      return {
        ...rec,
        location: wine?.locations || 'Unknown',
        bottle_count: wine?.bottle_count || 0
      };
    });
  }

  return parsed;
}

/**
 * Parse wine details from text using Claude.
 * @param {string} text - Raw text containing wine information
 * @returns {Promise<Object>} Parsed wine details
 */
export async function parseWineFromText(text) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('Claude API key not configured');
  }

  const prompt = `You are a wine data extraction assistant. Extract wine details from the following text.

TEXT:
${text}

Extract the following fields (use null if not found):
- wine_name: Full name of the wine (producer + wine name, exclude vintage)
- vintage: Year as integer (null if NV or not specified)
- colour: One of "red", "white", "rose", "sparkling" (infer from grape/style if not explicit)
- style: Grape variety or wine style (e.g., "Sauvignon Blanc", "Chianti", "Champagne")
- price_eur: Price as decimal number (convert to EUR if another currency, use approximate rate)
- vivino_rating: Rating as decimal if mentioned (null if not)
- country: Country of origin
- region: Specific region if mentioned
- alcohol_pct: Alcohol percentage as decimal if mentioned
- notes: Any tasting notes or descriptions

If multiple wines are present, return an array. If single wine, still return an array with one element.

Respond ONLY with valid JSON, no other text:
{
  "wines": [
    {
      "wine_name": "Producer Wine Name",
      "vintage": 2022,
      "colour": "white",
      "style": "Sauvignon Blanc",
      "price_eur": 12.99,
      "vivino_rating": null,
      "country": "France",
      "region": "Loire Valley",
      "alcohol_pct": 13.0,
      "notes": "Crisp and citrusy"
    }
  ],
  "confidence": "high",
  "parse_notes": "Any notes about assumptions made"
}

RULES:
- Infer colour from grape variety if not stated (e.g., Merlot → red, Chardonnay → white)
- For blends, use the dominant grape as style
- If price is in another currency, convert to EUR (USD: ×0.92, GBP: ×1.17, ZAR: ×0.05)
- Set confidence to "high", "medium", or "low" based on how much you had to infer
- Be conservative - only include what you can reasonably determine`;

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 1500,
    messages: [{ role: 'user', content: prompt }]
  });

  const responseText = message.content[0].text;

  try {
    // Handle potential markdown code blocks
    const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/) ||
                      responseText.match(/```\s*([\s\S]*?)\s*```/);
    const jsonStr = jsonMatch ? jsonMatch[1] : responseText;
    return JSON.parse(jsonStr.trim());
  } catch (_parseError) {
    console.error('Failed to parse Claude response:', responseText);
    throw new Error('Could not parse wine details from response');
  }
}

/**
 * Parse wine details from an image using Claude Vision.
 * @param {string} base64Image - Base64 encoded image data
 * @param {string} mediaType - Image MIME type (image/jpeg, image/png, image/webp, image/gif)
 * @returns {Promise<Object>} Parsed wine details
 */
export async function parseWineFromImage(base64Image, mediaType) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('Claude API key not configured');
  }

  // Validate media type
  const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  if (!validTypes.includes(mediaType)) {
    throw new Error(`Invalid image type: ${mediaType}. Supported: ${validTypes.join(', ')}`);
  }

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 1500,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mediaType,
              data: base64Image
            }
          },
          {
            type: 'text',
            text: `You are a wine data extraction assistant. Examine this image and extract wine details.

The image may be:
- A wine bottle label
- A wine menu or list
- A receipt or order confirmation
- A screenshot from a wine website or app
- A shelf tag or price label

Extract the following fields (use null if not found or not visible):
- wine_name: Full name of the wine (producer + wine name, exclude vintage)
- vintage: Year as integer (null if NV or not visible)
- colour: One of "red", "white", "rose", "sparkling" (infer from grape/style/bottle colour if not explicit)
- style: Grape variety or wine style (e.g., "Sauvignon Blanc", "Chianti", "Champagne")
- price_eur: Price as decimal number (convert to EUR if another currency, use approximate rate)
- vivino_rating: Rating as decimal if visible (null if not)
- country: Country of origin
- region: Specific region if mentioned
- alcohol_pct: Alcohol percentage as decimal if visible
- notes: Any tasting notes, descriptions, or other relevant text visible

If multiple wines are visible, return an array. If single wine, still return an array with one element.

Respond ONLY with valid JSON, no other text:
{
  "wines": [
    {
      "wine_name": "Producer Wine Name",
      "vintage": 2022,
      "colour": "white",
      "style": "Sauvignon Blanc",
      "price_eur": 12.99,
      "vivino_rating": null,
      "country": "France",
      "region": "Loire Valley",
      "alcohol_pct": 13.0,
      "notes": "Any visible tasting notes"
    }
  ],
  "confidence": "high",
  "parse_notes": "Description of what was visible and any assumptions made"
}

RULES:
- Read all visible text carefully, including small print
- For bottle labels, look for producer name, wine name, vintage, region, alcohol %
- Infer colour from grape variety or bottle appearance if not stated
- If price is in another currency, convert to EUR (USD: ×0.92, GBP: ×1.17, ZAR: ×0.05)
- Set confidence to "high" if clearly legible, "medium" if partially visible, "low" if guessing
- If image is blurry or wine details aren't visible, set confidence to "low" and explain in parse_notes`
          }
        ]
      }
    ]
  });

  const responseText = message.content[0].text;

  try {
    const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/) ||
                      responseText.match(/```\s*([\s\S]*?)\s*```/);
    const jsonStr = jsonMatch ? jsonMatch[1] : responseText;
    return JSON.parse(jsonStr.trim());
  } catch (_parseError) {
    console.error('Failed to parse Claude Vision response:', responseText);
    throw new Error('Could not parse wine details from image');
  }
}

/**
 * Build the sommelier prompt.
 * @private
 */
function buildSommelierPrompt(dish, sourceDesc, colourDesc, winesList, prioritySection) {
  return `You are a sommelier with 20 years in fine dining, now helping a home cook get the most from their personal wine cellar. Your style is warm and educational - you love sharing the "why" behind pairings, not just the "what".

Your approach:
- Match wine weight to dish weight (light with light, rich with rich)
- Balance acid: high-acid foods need high-acid wines
- Use tannins strategically: they cut through fat and protein
- Respect regional wisdom: "what grows together, goes together"
- Consider the full plate: sauces, sides, and seasonings matter
- Work with what's available, prioritising wines that need drinking soon

TASK:
Analyse this dish and extract food signals for wine pairing, then provide your recommendations.

DISH: ${dish}

AVAILABLE SIGNALS (use only these): chicken, pork, beef, lamb, fish, cheese, garlic_onion, roasted, sweet, acid, herbal, umami, creamy

USER CONSTRAINTS:
- Wine source: ${sourceDesc}
- Colour preference: ${colourDesc}

AVAILABLE WINES:
${winesList}
${prioritySection}

Respond in this JSON format only, with no other text:
{
  "signals": ["array", "of", "matching", "signals"],
  "dish_analysis": "Brief description of the dish's character and what to consider for pairing",
  "colour_suggestion": "If user selected 'any', indicate whether red or white would generally suit this dish better and why. If they specified a colour, either null or a diplomatic note if the dish would pair better with another colour.",
  "recommendations": [
    {
      "rank": 1,
      "wine_name": "Exact wine name from available list",
      "vintage": 2020,
      "why": "Detailed explanation of why this pairing works - discuss specific flavour interactions",
      "food_tip": "Optional suggestion to elevate the pairing (or null if none needed)",
      "is_priority": true
    }
  ],
  "no_match_reason": null
}

RULES:
- Only recommend wines from the AVAILABLE WINES list
- If source is "reduce_now only", all wines shown are priority - mention this is a great time to open them
- If fewer than 3 wines are suitable, return fewer recommendations and explain in no_match_reason
- Keep wine_name exactly as shown in the available list`;
}
