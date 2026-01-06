/**
 * @fileoverview AI-powered drink-now recommendations.
 * Uses Claude to analyze cellar, consumption patterns, and context
 * to suggest wines to drink.
 * @module services/drinkNowAI
 */

import Anthropic from '@anthropic-ai/sdk';
import db from '../db/index.js';
import { getModelForTask } from '../config/aiModels.js';
import { sanitize, sanitizeContext } from './inputSanitizer.js';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

const DRINK_NOW_SYSTEM_PROMPT = `You are a sommelier AI helping manage a personal wine cellar. Your task is to recommend wines to drink soon based on:

1. URGENCY: Wines past or near peak drinking window should be prioritized
2. BALANCE: Avoid recommending too many wines of the same type
3. CONTEXT: Consider any context provided (weather, occasion, food plans)
4. VALUE: Prioritize drinking expensive wines at their peak; everyday wines are more flexible

You will receive:
- List of wines with urgency status and details
- Recent consumption history (what styles/wines were drunk recently)
- Collection statistics (what's in the cellar)
- Optional context (weather, planned meals, occasions)

Return your recommendations as a JSON object with this exact structure:
{
  "recommendations": [
    {
      "wine_id": <number>,
      "wine_name": "<string>",
      "vintage": <number|null>,
      "reason": "<1-2 sentence explanation>",
      "urgency": "critical" | "high" | "medium",
      "pairing_suggestion": "<optional food pairing if context provided>"
    }
  ],
  "collection_insight": "<1 sentence about cellar balance or trend>",
  "drinking_tip": "<optional seasonal or general tip>"
}

Guidelines:
- Recommend 3-5 wines maximum
- Prioritize wines marked as past_peak or at_peak
- If recent consumption shows a pattern (e.g., all reds), suggest variety
- Be specific in reasons - mention the actual wine characteristics
- Keep pairing suggestions practical and brief`;

/**
 * Get urgent wines that should be considered for drinking.
 * @returns {Array} Wines with urgency information
 */
function getUrgentWines() {
  const currentYear = new Date().getFullYear();

  return db.prepare(`
    SELECT
      w.id,
      w.wine_name,
      w.vintage,
      w.style,
      w.colour,
      w.price_eur,
      w.vivino_rating,
      w.purchase_stars,
      w.drink_from,
      w.drink_peak,
      w.drink_until,
      w.personal_rating,
      w.tasting_notes,
      COUNT(s.id) as bottle_count,
      GROUP_CONCAT(DISTINCT s.location_code) as locations,
      rn.priority as reduce_priority,
      rn.reduce_reason,
      CASE
        WHEN w.drink_until IS NOT NULL AND w.drink_until <= ? THEN 'past_peak'
        WHEN w.drink_peak IS NOT NULL AND w.drink_peak <= ? THEN 'at_peak'
        WHEN w.drink_from IS NOT NULL AND w.drink_from <= ? THEN 'ready'
        WHEN w.drink_from IS NOT NULL AND w.drink_from > ? THEN 'too_young'
        ELSE 'unknown'
      END as drinking_status
    FROM wines w
    LEFT JOIN slots s ON s.wine_id = w.id
    LEFT JOIN reduce_now rn ON rn.wine_id = w.id
    GROUP BY w.id
    HAVING bottle_count > 0
    ORDER BY
      CASE drinking_status
        WHEN 'past_peak' THEN 1
        WHEN 'at_peak' THEN 2
        WHEN 'ready' THEN 3
        ELSE 4
      END,
      reduce_priority NULLS LAST,
      w.purchase_stars DESC NULLS LAST
    LIMIT 30
  `).all(currentYear, currentYear, currentYear, currentYear);
}

/**
 * Get recent consumption history.
 * @param {number} days - Number of days to look back
 * @returns {Array} Recent consumption records
 */
function getRecentConsumption(days = 30) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);

  try {
    return db.prepare(`
      SELECT
        wine_name,
        vintage,
        style,
        colour,
        consumed_at,
        occasion,
        pairing_dish,
        consumption_rating
      FROM consumption_log
      WHERE consumed_at >= ?
      ORDER BY consumed_at DESC
      LIMIT 20
    `).all(cutoffDate.toISOString());
  } catch {
    // Table might not exist
    return [];
  }
}

/**
 * Get collection breakdown by colour and style.
 * @returns {Object} Collection statistics
 */
function getCollectionStats() {
  const colourBreakdown = db.prepare(`
    SELECT
      w.colour,
      COUNT(s.id) as bottle_count,
      COUNT(DISTINCT w.id) as wine_count
    FROM wines w
    JOIN slots s ON s.wine_id = w.id
    GROUP BY w.colour
  `).all();

  const styleBreakdown = db.prepare(`
    SELECT
      w.style,
      w.colour,
      COUNT(s.id) as bottle_count
    FROM wines w
    JOIN slots s ON s.wine_id = w.id
    GROUP BY w.style
    ORDER BY bottle_count DESC
    LIMIT 10
  `).all();

  const totalBottles = db.prepare(`
    SELECT COUNT(*) as count FROM slots WHERE wine_id IS NOT NULL
  `).get().count;

  return {
    total_bottles: totalBottles,
    by_colour: colourBreakdown,
    top_styles: styleBreakdown
  };
}

/**
 * Build the prompt for Claude with all relevant data.
 * @param {Object} data - Aggregated data
 * @returns {string} Formatted prompt
 */
function buildPrompt(data) {
  const { urgentWines, recentConsumption, collectionStats, context } = data;

  let prompt = '## Wines to Consider\n\n';

  for (const wine of urgentWines) {
    prompt += `- ID:${wine.id} | "${wine.wine_name}" ${wine.vintage || 'NV'} | ${wine.colour} ${wine.style || ''}\n`;
    prompt += `  Status: ${wine.drinking_status} | Bottles: ${wine.bottle_count}`;
    if (wine.drink_until) prompt += ` | Drink by: ${wine.drink_until}`;
    if (wine.price_eur) prompt += ` | Price: €${wine.price_eur}`;
    if (wine.purchase_stars) prompt += ` | Stars: ${wine.purchase_stars}`;
    if (wine.reduce_reason) prompt += ` | Note: ${wine.reduce_reason}`;
    prompt += '\n';
  }

  prompt += '\n## Recent Consumption (Last 30 Days)\n\n';
  if (recentConsumption.length === 0) {
    prompt += 'No recent consumption data available.\n';
  } else {
    for (const drink of recentConsumption) {
      prompt += `- ${drink.wine_name} ${drink.vintage || ''} (${drink.colour}) on ${drink.consumed_at?.split('T')[0] || 'unknown'}`;
      if (drink.occasion) prompt += ` - ${drink.occasion}`;
      prompt += '\n';
    }
  }

  prompt += '\n## Collection Overview\n\n';
  prompt += `Total bottles: ${collectionStats.total_bottles}\n`;
  prompt += 'By colour: ' + collectionStats.by_colour.map(c =>
    `${c.colour}: ${c.bottle_count} bottles`
  ).join(', ') + '\n';
  prompt += 'Top styles: ' + collectionStats.top_styles.slice(0, 5).map(s =>
    `${s.style || 'Unknown'} (${s.bottle_count})`
  ).join(', ') + '\n';

  if (context) {
    prompt += '\n## Context\n\n';
    if (context.weather) prompt += `Weather: ${context.weather}\n`;
    if (context.occasion) prompt += `Occasion: ${context.occasion}\n`;
    if (context.food) prompt += `Planned food: ${context.food}\n`;
    if (context.preferences) prompt += `Preferences: ${context.preferences}\n`;
  }

  prompt += '\n## Task\n\nBased on the above, recommend 3-5 wines to drink soon. Focus on urgency first, then variety and value. Return valid JSON only.';

  return prompt;
}

/**
 * Generate AI-powered drink recommendations.
 * @param {Object} options - Options for recommendations
 * @param {number} [options.limit=5] - Max recommendations
 * @param {Object} [options.context] - Context (weather, occasion, food)
 * @returns {Promise<Object>} Recommendations and insights
 */
export async function generateDrinkRecommendations(options = {}) {
  const { limit = 5, context = null } = options;

  // Check if API key is configured
  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      error: 'AI features require Claude API key',
      recommendations: getFallbackRecommendations(limit)
    };
  }

  // Gather data
  const urgentWines = getUrgentWines();
  const recentConsumption = getRecentConsumption(30);
  const collectionStats = getCollectionStats();

  if (urgentWines.length === 0) {
    return {
      recommendations: [],
      collection_insight: 'Your cellar is empty or no wines have bottles in stock.',
      drinking_tip: 'Add some wines to get personalized recommendations!'
    };
  }

  // Build prompt
  const prompt = buildPrompt({
    urgentWines,
    recentConsumption,
    collectionStats,
    context
  });

  try {
    const modelId = getModelForTask('drinkRecommendations');
    const response = await anthropic.messages.create({
      model: modelId,
      max_tokens: 1024,
      system: DRINK_NOW_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }]
    });

    const content = response.content[0].text;

    // Parse JSON response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }

    const result = JSON.parse(jsonMatch[0]);

    // Limit recommendations
    if (result.recommendations) {
      result.recommendations = result.recommendations.slice(0, limit);
    }

    return result;

  } catch (error) {
    console.error('AI recommendation error:', error.message);

    // Return fallback recommendations
    return {
      error: 'AI temporarily unavailable',
      recommendations: getFallbackRecommendations(limit),
      collection_insight: 'Showing wines that need attention based on drinking windows.',
      drinking_tip: 'AI-powered recommendations will be available when the service is restored.'
    };
  }
}

/**
 * Get fallback recommendations when AI is unavailable.
 * Uses simple urgency-based logic.
 * @param {number} limit - Max recommendations
 * @returns {Array} Basic recommendations
 */
function getFallbackRecommendations(limit = 5) {
  const wines = getUrgentWines().slice(0, limit);

  return wines.map(wine => ({
    wine_id: wine.id,
    wine_name: wine.wine_name,
    vintage: wine.vintage,
    reason: getBasicReason(wine),
    urgency: getBasicUrgency(wine.drinking_status),
    pairing_suggestion: null
  }));
}

/**
 * Get a basic reason for recommendation.
 * @param {Object} wine - Wine data
 * @returns {string} Reason text
 */
function getBasicReason(wine) {
  if (wine.drinking_status === 'past_peak') {
    return `Past peak drinking window${wine.drink_until ? ` (was ${wine.drink_until})` : ''}. Drink soon!`;
  }
  if (wine.drinking_status === 'at_peak') {
    return `Currently at peak. Ideal time to enjoy this ${wine.colour || 'wine'}.`;
  }
  if (wine.reduce_reason) {
    return wine.reduce_reason;
  }
  if (wine.drinking_status === 'ready') {
    return 'Ready to drink and showing well.';
  }
  return 'Consider drinking soon based on age and style.';
}

/**
 * Map drinking status to urgency level.
 * @param {string} status - Drinking status
 * @returns {string} Urgency level
 */
function getBasicUrgency(status) {
  const mapping = {
    'past_peak': 'critical',
    'at_peak': 'high',
    'ready': 'medium',
    'too_young': 'low',
    'unknown': 'medium'
  };
  return mapping[status] || 'medium';
}

export default {
  generateDrinkRecommendations
};
