/**
 * @fileoverview Zone classification chat service.
 * Allows users to discuss and challenge wine zone classifications with AI.
 * @module services/zoneChat
 */

import Anthropic from '@anthropic-ai/sdk';
import db from '../db/index.js';
import { CELLAR_ZONES, getZoneById } from '../config/cellarZones.js';
import { getModelForTask } from '../config/aiModels.js';
import { sanitizeChatMessage } from './inputSanitizer.js';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  timeout: 60000
});

/**
 * Discuss wine zone classifications with AI sommelier.
 * @param {string} message - User message/question
 * @param {Array} wines - Current wine collection
 * @param {Object} context - Previous conversation context
 * @returns {Promise<Object>} AI response with suggestions
 */
export async function discussZoneClassification(message, wines, context) {
  // Ensure context is an object (frontend may pass null)
  context = context || {};

  // Build zone summary for context
  const zoneSummary = buildZoneSummary(wines);

  // Build wines list grouped by current classification
  const winesByZone = groupWinesByZone(wines);

  const systemPrompt = `You are an expert sommelier helping organize a personal wine cellar. The user is setting up zones for their collection and may have questions or concerns about how wines are classified.

AVAILABLE ZONES:
${CELLAR_ZONES.zones.map(z => `- ${z.id}: ${z.displayName} - ${z.rules?.grapes?.slice(0, 3).join(', ') || 'Various'}`).join('\n')}

CURRENT CELLAR SUMMARY:
${zoneSummary}

CLASSIFICATION RULES:
- Wines are classified by grape variety first, then by keywords (region, style), then by country
- Appassimento method wines go to 'appassimento' zone regardless of grape
- Dessert/fortified requires explicit markers (port, sherry, madeira, etc.) - normal dry wines never go there
- Priority order prevents ambiguous matches (e.g., Rioja takes precedence over Iberian Fresh for reserva wines)

CURRENT WINES BY ZONE:
${formatWinesByZone(winesByZone)}

When responding:
1. Answer questions about why wines are classified the way they are
2. Suggest reclassifications if the user points out issues
3. Explain the logic behind zone rules
4. If the user wants to move a wine to a different zone, provide the wine ID and new zone ID

For reclassification suggestions, include a JSON block:
\`\`\`json
{
  "reclassifications": [
    {"wineId": 123, "wineName": "Example Wine", "currentZone": "old_zone", "suggestedZone": "new_zone", "reason": "Why this makes sense"}
  ]
}
\`\`\``;

  const messages = [];

  // Add previous context if available
  if (context.history && context.history.length > 0) {
    messages.push(...context.history);
  }

  // Sanitize and add current message
  const sanitizedMessage = sanitizeChatMessage(message);
  messages.push({ role: 'user', content: sanitizedMessage });

  const modelId = getModelForTask('zoneChat');
  const response = await anthropic.messages.create({
    model: modelId,
    max_tokens: 2000,
    system: systemPrompt,
    messages
  });

  const responseText = response.content[0].text;

  // Extract any reclassification suggestions
  let reclassifications = [];
  const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1]);
      if (parsed.reclassifications) {
        reclassifications = parsed.reclassifications;
      }
    } catch (_e) {
      // Ignore parse errors
    }
  }

  // Clean response text (remove JSON blocks for display)
  const cleanResponse = responseText.replace(/```json[\s\S]*?```/g, '').trim();

  return {
    response: cleanResponse,
    reclassifications,
    context: {
      history: [...messages, { role: 'assistant', content: responseText }]
    }
  };
}

/**
 * Reassign a wine to a different zone.
 * @param {number} wineId - Wine ID
 * @param {string} newZoneId - New zone ID
 * @param {string} reason - Reason for reassignment
 * @returns {Promise<Object>} Result
 */
export async function reassignWineZone(wineId, newZoneId, reason = '') {
  // Validate zone exists
  const zone = getZoneById(newZoneId);
  if (!zone && !['white_buffer', 'red_buffer', 'unclassified'].includes(newZoneId)) {
    throw new Error(`Invalid zone: ${newZoneId}`);
  }

  // Get current wine
  const wine = await db.prepare('SELECT * FROM wines WHERE id = ?').get(wineId);
  if (!wine) {
    throw new Error(`Wine not found: ${wineId}`);
  }

  const previousZone = wine.zone_id || 'auto';

  // Update wine zone assignment with high confidence (user override)
  await db.prepare(`
    UPDATE wines
    SET zone_id = ?, zone_confidence = 'high', zone_override_reason = ?
    WHERE id = ?
  `).run(newZoneId, reason || 'User override', wineId);

  return {
    wineId,
    wineName: wine.wine_name,
    previousZone,
    newZone: newZoneId,
    reason
  };
}

/**
 * Build zone summary for context.
 * @param {Array} wines - Wine collection
 * @returns {string} Summary text
 */
function buildZoneSummary(wines) {
  const counts = {};
  wines.forEach(w => {
    const zone = w.zone_id || 'unclassified';
    counts[zone] = (counts[zone] || 0) + 1;
  });

  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([zone, count]) => `${zone}: ${count} wines`)
    .join('\n');
}

/**
 * Group wines by their current zone classification.
 * @param {Array} wines - Wine collection
 * @returns {Object} Wines grouped by zone
 */
function groupWinesByZone(wines) {
  const grouped = {};
  wines.forEach(w => {
    const zone = w.zone_id || 'unclassified';
    if (!grouped[zone]) {
      grouped[zone] = [];
    }
    grouped[zone].push({
      id: w.id,
      name: w.wine_name,
      vintage: w.vintage,
      style: w.style,
      grapes: w.grapes,
      country: w.country,
      slot: w.slot_id || w.location_code
    });
  });
  return grouped;
}

/**
 * Format wines by zone for AI context.
 * @param {Object} winesByZone - Grouped wines
 * @returns {string} Formatted text
 */
function formatWinesByZone(winesByZone) {
  return Object.entries(winesByZone)
    .map(([zone, wines]) => {
      const wineList = wines.slice(0, 10).map(w =>
        `  - [ID:${w.id}] ${w.name} ${w.vintage || ''} (${w.style || 'Unknown style'})`
      ).join('\n');
      const extra = wines.length > 10 ? `\n  ... and ${wines.length - 10} more` : '';
      return `${zone} (${wines.length} wines):\n${wineList}${extra}`;
    })
    .join('\n\n');
}
