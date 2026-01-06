/**
 * @fileoverview Hybrid pairing engine combining deterministic scoring with AI explanation.
 * Generates a shortlist of wines based on food signals, then uses AI to explain choices.
 * @module services/pairingEngine
 */

import Anthropic from '@anthropic-ai/sdk';
import { FOOD_SIGNALS, WINE_STYLES, DEFAULT_HOUSE_STYLE } from '../config/pairingRules.js';
import { getModelForTask, getMaxTokens } from '../config/aiModels.js';
import { sanitizeDishDescription, sanitizeWineList } from './inputSanitizer.js';
import { parseAndValidate, createFallback } from './responseValidator.js';
import { getEffectiveDrinkByYear } from './cellarAnalysis.js';

const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;

/**
 * Match a wine to its best style bucket.
 * @param {Object} wine - Wine object
 * @returns {Object} Best matching style { styleId, confidence, matchedBy }
 */
export function matchWineToStyle(wine) {
  const colour = (wine.colour || '').toLowerCase();
  const grapes = (wine.grapes || '').toLowerCase();
  const wineName = (wine.wine_name || '').toLowerCase();
  const style = (wine.style || '').toLowerCase();
  const winemaking = (wine.winemaking || '').toLowerCase();

  let bestMatch = null;
  let bestScore = 0;

  for (const [styleId, styleDef] of Object.entries(WINE_STYLES)) {
    let score = 0;
    const matchedBy = [];

    // Check colour match
    if (styleDef.colours.length > 0) {
      if (!styleDef.colours.includes(colour)) continue;
      score += 1;
      matchedBy.push('colour');
    }

    // Check grape match (strong indicator)
    if (styleDef.grapes.length > 0) {
      const grapeMatch = styleDef.grapes.some(g =>
        grapes.includes(g) || wineName.includes(g) || style.includes(g)
      );
      if (grapeMatch) {
        score += 3;
        matchedBy.push('grape');
      }
    }

    // Check keyword match
    if (styleDef.keywords.length > 0) {
      const keywordMatch = styleDef.keywords.some(k =>
        wineName.includes(k) || style.includes(k) || winemaking.includes(k)
      );
      if (keywordMatch) {
        score += 2;
        matchedBy.push('keyword');
      }
    }

    // Check exclusion keywords (penalty)
    if (styleDef.excludeKeywords.length > 0) {
      const excludeMatch = styleDef.excludeKeywords.some(k =>
        wineName.includes(k) || style.includes(k) || winemaking.includes(k)
      );
      if (excludeMatch) {
        score -= 5; // Strong penalty for exclusion match
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = {
        styleId,
        styleName: styleDef.description,
        confidence: score >= 4 ? 'high' : score >= 2 ? 'medium' : 'low',
        matchedBy
      };
    }
  }

  // Fallback based on colour if no style match
  if (!bestMatch && colour) {
    const colourDefaults = {
      white: 'white_medium',
      red: 'red_medium',
      rose: 'rose_dry',
      sparkling: 'sparkling_dry'
    };
    const fallbackStyle = colourDefaults[colour];
    if (fallbackStyle && WINE_STYLES[fallbackStyle]) {
      bestMatch = {
        styleId: fallbackStyle,
        styleName: WINE_STYLES[fallbackStyle].description,
        confidence: 'low',
        matchedBy: ['colour_fallback']
      };
    }
  }

  return bestMatch;
}

/**
 * Extract food signals from dish description using simple keyword matching.
 * @param {string} dish - Dish description
 * @returns {string[]} Detected signals
 */
export function extractSignals(dish) {
  const dishLower = dish.toLowerCase();
  const signals = [];

  // Direct keyword matches
  const signalKeywords = {
    chicken: ['chicken', 'poultry', 'turkey', 'duck', 'fowl'],
    pork: ['pork', 'bacon', 'ham', 'sausage', 'pancetta', 'prosciutto'],
    beef: ['beef', 'steak', 'burger', 'ribeye', 'filet', 'brisket', 'short rib'],
    lamb: ['lamb', 'mutton'],
    fish: ['fish', 'salmon', 'trout', 'cod', 'halibut', 'tuna', 'bass', 'sole', 'snapper'],
    shellfish: ['shellfish', 'shrimp', 'prawn', 'lobster', 'crab', 'oyster', 'mussel', 'clam', 'scallop'],
    roasted: ['roasted', 'roast', 'oven'],
    grilled: ['grilled', 'grill', 'bbq', 'barbecue', 'charred'],
    fried: ['fried', 'crispy', 'tempura', 'schnitzel'],
    braised: ['braised', 'slow-cooked', 'stew', 'pot roast'],
    raw: ['raw', 'sushi', 'sashimi', 'tartare', 'ceviche', 'crudo'],
    creamy: ['creamy', 'cream', 'alfredo', 'béchamel', 'carbonara', 'butter'],
    spicy: ['spicy', 'chili', 'jalapeño', 'hot', 'sriracha', 'curry', 'thai', 'szechuan'],
    sweet: ['sweet', 'glazed', 'caramelized', 'honey', 'maple', 'teriyaki'],
    acid: ['lemon', 'lime', 'citrus', 'vinegar', 'pickle', 'acidic'],
    umami: ['umami', 'soy', 'miso', 'parmesan', 'anchovy', 'worcestershire'],
    herbal: ['herb', 'basil', 'rosemary', 'thyme', 'mint', 'cilantro', 'dill', 'parsley'],
    earthy: ['earthy', 'truffle', 'mushroom', 'beet', 'root'],
    smoky: ['smoky', 'smoked', 'bbq', 'chipotle'],
    tomato: ['tomato', 'marinara', 'pomodoro', 'bolognese', 'ragu'],
    cheese: ['cheese', 'cheddar', 'brie', 'goat cheese', 'parmesan', 'gruyere', 'fondue'],
    mushroom: ['mushroom', 'porcini', 'shiitake', 'truffle', 'chanterelle'],
    garlic_onion: ['garlic', 'onion', 'shallot', 'leek', 'scallion'],
    cured_meat: ['cured', 'charcuterie', 'salami', 'prosciutto', 'bresaola', 'jamón'],
    pepper: ['pepper', 'peppercorn', 'au poivre'],
    salty: ['salty', 'brined', 'cured', 'anchovy', 'capers', 'olives']
  };

  for (const [signal, keywords] of Object.entries(signalKeywords)) {
    if (keywords.some(k => dishLower.includes(k))) {
      signals.push(signal);
    }
  }

  return [...new Set(signals)]; // Dedupe
}

/**
 * Score wines against food signals.
 * @param {Object[]} wines - Array of wine objects
 * @param {string[]} signals - Food signals
 * @param {Object} houseStyle - House style preferences
 * @returns {Object[]} Scored wines with pairingScore
 */
export function scoreWines(wines, signals, houseStyle = DEFAULT_HOUSE_STYLE) {
  const currentYear = new Date().getFullYear();
  const scoredWines = [];

  for (const wine of wines) {
    // Match wine to style bucket
    const styleMatch = matchWineToStyle(wine);
    if (!styleMatch) continue;

    let score = 0;
    const matchReasons = [];

    // Score based on signal affinities
    for (const signal of signals) {
      const signalDef = FOOD_SIGNALS[signal];
      if (!signalDef) continue;

      const { wineAffinities } = signalDef;

      if (wineAffinities.primary?.includes(styleMatch.styleId)) {
        score += 3;
        matchReasons.push({ signal, level: 'primary', points: 3 });
      } else if (wineAffinities.good?.includes(styleMatch.styleId)) {
        score += 2;
        matchReasons.push({ signal, level: 'good', points: 2 });
      } else if (wineAffinities.fallback?.includes(styleMatch.styleId)) {
        score += 1;
        matchReasons.push({ signal, level: 'fallback', points: 1 });
      }
    }

    // Skip wines with no signal match
    if (score === 0) continue;

    // Apply house style modifiers
    if (styleMatch.styleId.includes('crisp') || styleMatch.styleId.includes('aromatic')) {
      score *= houseStyle.acidPreference;
    }
    if (styleMatch.styleId.includes('oaked')) {
      score *= houseStyle.oakPreference;
    }
    if (styleMatch.styleId.includes('full') || styleMatch.styleId.includes('tannic')) {
      score *= houseStyle.tanninPreference;
    }

    // Reduce-now bonus
    if (wine.priority || wine.reduce_priority < 99) {
      score *= houseStyle.reduceNowBonus;
      matchReasons.push({ signal: 'reduce_now', level: 'bonus', points: score * 0.5 });
    }

    // Fridge bonus (convenient)
    const slotId = wine.slot_id || wine.location_code;
    if (slotId && slotId.startsWith('F')) {
      score *= houseStyle.fridgeBonus;
      matchReasons.push({ signal: 'in_fridge', level: 'bonus', points: score * 0.2 });
    }

    // Drink-by year urgency bonus
    const drinkByYear = getEffectiveDrinkByYear(wine);
    if (drinkByYear) {
      const yearsLeft = drinkByYear - currentYear;
      if (yearsLeft <= 0) {
        score *= 1.3; // Past due - drink now!
        matchReasons.push({ signal: 'past_optimal', level: 'urgent', points: score * 0.3 });
      } else if (yearsLeft === 1) {
        score *= 1.15;
        matchReasons.push({ signal: 'drink_soon', level: 'bonus', points: score * 0.15 });
      }
    }

    scoredWines.push({
      ...wine,
      pairingScore: Math.round(score * 100) / 100,
      styleMatch,
      matchReasons,
      drinkByYear
    });
  }

  // Sort by score descending
  scoredWines.sort((a, b) => b.pairingScore - a.pairingScore);

  // Apply diversity penalty (reduce score for duplicates of same style)
  const styleCounts = {};
  for (const wine of scoredWines) {
    const styleId = wine.styleMatch.styleId;
    styleCounts[styleId] = (styleCounts[styleId] || 0) + 1;
    if (styleCounts[styleId] > 1) {
      wine.pairingScore *= Math.pow(houseStyle.diversityPenalty, styleCounts[styleId] - 1);
      wine.matchReasons.push({
        signal: 'diversity_penalty',
        level: 'penalty',
        points: -wine.pairingScore * 0.1
      });
    }
  }

  // Re-sort after diversity penalty
  scoredWines.sort((a, b) => b.pairingScore - a.pairingScore);

  return scoredWines;
}

/**
 * Generate deterministic shortlist for a dish.
 * @param {Object[]} wines - Available wines
 * @param {string} dish - Dish description
 * @param {Object} options - Options { colour, source, limit, houseStyle }
 * @returns {Object} Shortlist result
 */
export function generateShortlist(wines, dish, options = {}) {
  const {
    colour = 'any',
    source = 'all',
    limit = 8,
    houseStyle = DEFAULT_HOUSE_STYLE
  } = options;

  // Filter wines by colour preference
  let filteredWines = wines;
  if (colour !== 'any') {
    filteredWines = wines.filter(w => w.colour?.toLowerCase() === colour.toLowerCase());
  }

  // Filter by source
  if (source === 'reduce_now') {
    filteredWines = filteredWines.filter(w => w.priority || w.reduce_priority < 99);
  }

  // Extract signals from dish
  const signals = extractSignals(dish);

  if (signals.length === 0) {
    return {
      success: false,
      error: 'Could not identify food signals from dish description',
      signals: [],
      shortlist: []
    };
  }

  // Score wines
  const scored = scoreWines(filteredWines, signals, houseStyle);

  // Take top N
  const shortlist = scored.slice(0, limit);

  return {
    success: true,
    dish,
    signals,
    totalCandidates: scored.length,
    shortlist: shortlist.map(w => ({
      wine_id: w.id,
      wine_name: w.wine_name,
      vintage: w.vintage,
      colour: w.colour,
      style: w.style,
      grapes: w.grapes,
      location: w.locations || w.location_code || w.slot_id,
      bottle_count: w.bottle_count,
      pairingScore: w.pairingScore,
      styleMatch: w.styleMatch,
      matchReasons: w.matchReasons,
      drinkByYear: w.drinkByYear,
      is_priority: !!(w.priority || w.reduce_priority < 99),
      reduce_reason: w.reduce_reason
    }))
  };
}

/**
 * Get AI explanation for shortlist selections.
 * @param {string} dish - Original dish description
 * @param {Object} shortlistResult - Result from generateShortlist
 * @param {number} topN - Number of wines to explain (default 3)
 * @returns {Promise<Object>} AI explanations
 */
export async function explainShortlist(dish, shortlistResult, topN = 3) {
  if (!anthropic) {
    return {
      success: false,
      error: 'Claude API key not configured',
      fallback: generateFallbackExplanations(shortlistResult, topN)
    };
  }

  const { signals, shortlist } = shortlistResult;
  const topWines = shortlist.slice(0, topN);

  if (topWines.length === 0) {
    return {
      success: false,
      error: 'No wines in shortlist to explain',
      recommendations: []
    };
  }

  // Sanitize inputs
  const sanitizedDish = sanitizeDishDescription(dish);
  const sanitizedWines = sanitizeWineList(topWines);

  // Build prompt - AI can ONLY explain wines from shortlist
  const winesList = sanitizedWines.map((w, i) => {
    const reasons = topWines[i].matchReasons
      .filter(r => r.level !== 'penalty')
      .map(r => `${r.signal}(${r.level})`)
      .join(', ');
    return `[ID:${w.id}] ${w.wine_name} ${w.vintage || 'NV'} | Style: ${topWines[i].styleMatch.styleName} | Score: ${topWines[i].pairingScore} | Match: ${reasons}${topWines[i].is_priority ? ' | ★PRIORITY' : ''}`;
  }).join('\n');

  const prompt = `You are a sommelier explaining wine pairings. The system has pre-selected these wines based on food signal matching. Your job is ONLY to explain WHY each pairing works.

DISH: ${sanitizedDish}

DETECTED SIGNALS: ${signals.join(', ')}

PRE-SELECTED WINES (explain these ONLY - do not suggest other wines):
${winesList}

TASK:
1. Write a brief dish analysis (2-3 sentences)
2. For each wine, explain the pairing logic in 2-3 sentences
3. Include practical tips (serving temp, decanting if needed)

RULES:
- ONLY discuss wines from the list above
- Use wine_id exactly as shown
- Keep explanations concise but educational
- If a wine is marked PRIORITY, mention it should be drunk soon

OUTPUT FORMAT (JSON only):
{
  "dish_analysis": "Brief analysis of the dish's flavour profile",
  "recommendations": [
    {
      "rank": 1,
      "wine_id": 123,
      "wine_name": "Exact name from list",
      "vintage": 2020,
      "pairing_note": "Why this wine works with this dish",
      "serving_temp": "14-16°C",
      "decant_time": "30 min or null",
      "is_priority": true,
      "match_score": 85
    }
  ]
}`;

  try {
    const modelId = getModelForTask('sommelier');
    const maxTokens = Math.min(getMaxTokens(modelId), 1200);

    const message = await anthropic.messages.create({
      model: modelId,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }]
    });

    const responseText = message.content[0].text;
    const validated = parseAndValidate(responseText, 'sommelier');

    let parsed;
    if (validated.success) {
      parsed = validated.data;
    } else {
      // Try manual extraction
      const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/) ||
                        responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const jsonStr = jsonMatch[1] || jsonMatch[0];
        parsed = JSON.parse(jsonStr.trim());
      } else {
        throw new Error('Could not parse AI response');
      }
    }

    // Merge AI explanations with shortlist data
    const recommendations = parsed.recommendations.map(rec => {
      const shortlistWine = topWines.find(w => w.wine_id === rec.wine_id);
      return {
        ...rec,
        location: shortlistWine?.location || 'Unknown',
        bottle_count: shortlistWine?.bottle_count || 0,
        style: shortlistWine?.style || null,
        colour: shortlistWine?.colour || null,
        pairingScore: shortlistWine?.pairingScore || 0,
        styleMatch: shortlistWine?.styleMatch || null,
        drinkByYear: shortlistWine?.drinkByYear || null,
        reduce_reason: shortlistWine?.reduce_reason || null
      };
    });

    return {
      success: true,
      dish_analysis: parsed.dish_analysis,
      signals,
      recommendations
    };

  } catch (err) {
    console.error('[PairingEngine] AI explanation failed:', err.message);
    return {
      success: false,
      error: err.message,
      fallback: generateFallbackExplanations(shortlistResult, topN)
    };
  }
}

/**
 * Generate fallback explanations without AI.
 * @param {Object} shortlistResult - Shortlist result
 * @param {number} topN - Number of wines
 * @returns {Object} Fallback response
 */
function generateFallbackExplanations(shortlistResult, topN) {
  const { signals, shortlist } = shortlistResult;
  const topWines = shortlist.slice(0, topN);

  return {
    dish_analysis: `Based on signals: ${signals.join(', ')}`,
    recommendations: topWines.map((w, i) => {
      const primaryMatches = w.matchReasons
        .filter(r => r.level === 'primary')
        .map(r => r.signal);

      return {
        rank: i + 1,
        wine_id: w.wine_id,
        wine_name: w.wine_name,
        vintage: w.vintage,
        pairing_note: primaryMatches.length > 0
          ? `Strong match for: ${primaryMatches.join(', ')}`
          : `Matches ${w.styleMatch.styleName} style profile`,
        serving_temp: w.colour === 'red' ? '16-18°C' : '8-12°C',
        decant_time: w.colour === 'red' && w.styleMatch.styleId === 'red_full' ? '30 min' : null,
        is_priority: w.is_priority,
        match_score: Math.round(w.pairingScore),
        location: w.location,
        bottle_count: w.bottle_count,
        style: w.style,
        colour: w.colour,
        pairingScore: w.pairingScore,
        drinkByYear: w.drinkByYear,
        reduce_reason: w.reduce_reason
      };
    })
  };
}

/**
 * Full hybrid pairing: deterministic shortlist + AI explanation.
 * @param {Object[]} wines - Available wines
 * @param {string} dish - Dish description
 * @param {Object} options - Options { colour, source, limit, houseStyle }
 * @returns {Promise<Object>} Complete pairing result
 */
export async function getHybridPairing(wines, dish, options = {}) {
  // Step 1: Generate deterministic shortlist
  const shortlistResult = generateShortlist(wines, dish, options);

  if (!shortlistResult.success) {
    return {
      success: false,
      error: shortlistResult.error,
      signals: [],
      recommendations: []
    };
  }

  // Step 2: Get AI explanations for top picks
  const topN = options.topN || 3;
  const explained = await explainShortlist(dish, shortlistResult, topN);

  // Return combined result
  return {
    success: true,
    mode: 'hybrid',
    dish,
    signals: shortlistResult.signals,
    dish_analysis: explained.success ? explained.dish_analysis : explained.fallback?.dish_analysis,
    recommendations: explained.success ? explained.recommendations : explained.fallback?.recommendations || [],
    aiSuccess: explained.success,
    aiError: explained.error || null,
    shortlistSize: shortlistResult.totalCandidates,
    fullShortlist: shortlistResult.shortlist // Include full ranked list
  };
}
