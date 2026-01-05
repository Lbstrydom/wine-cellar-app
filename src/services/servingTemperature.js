/**
 * @fileoverview Wine serving temperature lookup service.
 * Matches wines to optimal serving temperatures based on style, grapes, and category.
 * @module services/servingTemperature
 */

import db from '../db/index.js';

/**
 * Get all serving temperature entries for a category.
 * @param {string} category - Wine category (sparkling, white, red, rose, orange, dessert, fortified)
 * @returns {Array} Temperature entries
 */
export function getTemperaturesByCategory(category) {
  return db.prepare(`
    SELECT * FROM wine_serving_temperatures
    WHERE category = ?
    ORDER BY wine_type
  `).all(category);
}

/**
 * Find serving temperature for a wine based on its attributes.
 * Uses fuzzy matching on style, grape varieties, and wine name.
 * @param {Object} wine - Wine object with style, colour, grapes, wine_name, etc.
 * @returns {Object|null} Best matching temperature entry or null
 */
export function findServingTemperature(wine) {
  if (!wine) return null;

  const style = (wine.style || '').toLowerCase();
  const grapes = (wine.grapes || '').toLowerCase();
  const wineName = (wine.wine_name || '').toLowerCase();
  const colour = (wine.colour || '').toLowerCase();
  const sweetness = (wine.sweetness || '').toLowerCase();
  const winemaking = (wine.winemaking || '').toLowerCase();

  // Combine searchable text
  const searchText = `${style} ${grapes} ${wineName} ${winemaking}`.toLowerCase();

  // Determine primary category based on colour
  let primaryCategory = 'red';
  if (colour === 'white' || colour === 'sparkling') {
    primaryCategory = 'white';
  } else if (colour === 'rose' || colour === 'rosé') {
    primaryCategory = 'rose';
  } else if (colour === 'orange') {
    primaryCategory = 'orange';
  } else if (colour === 'dessert' || colour === 'fortified' ||
             sweetness.includes('sweet') || sweetness.includes('dessert')) {
    primaryCategory = 'dessert';
  }

  // Check for sparkling first (can be any colour)
  if (searchText.includes('sparkling') || searchText.includes('champagne') ||
      searchText.includes('prosecco') || searchText.includes('cava') ||
      searchText.includes('cremant') || searchText.includes('franciacorta') ||
      searchText.includes('sekt') || searchText.includes('pet-nat') ||
      searchText.includes('asti') || searchText.includes('moscato d\'asti') ||
      searchText.includes('lambrusco') || colour === 'sparkling') {
    primaryCategory = 'sparkling';
  }

  // Check for fortified
  if (searchText.includes('port') || searchText.includes('porto') ||
      searchText.includes('sherry') || searchText.includes('madeira') ||
      searchText.includes('marsala') || searchText.includes('fortified') ||
      searchText.includes('banyuls') || searchText.includes('maury') ||
      searchText.includes('rutherglen') || searchText.includes('commandaria') ||
      colour === 'fortified') {
    primaryCategory = 'fortified';
  }

  // Check for dessert
  if (searchText.includes('sauternes') || searchText.includes('tokaji') ||
      searchText.includes('eiswein') || searchText.includes('ice wine') ||
      searchText.includes('trockenbeerenauslese') || searchText.includes('beerenauslese') ||
      searchText.includes('auslese') || searchText.includes('vin santo') ||
      searchText.includes('passito') || searchText.includes('recioto') ||
      searchText.includes('late harvest') || searchText.includes('pedro ximenez') ||
      colour === 'dessert') {
    primaryCategory = 'dessert';
  }

  // Get all temperature entries
  const allTemps = db.prepare(`
    SELECT * FROM wine_serving_temperatures
  `).all();

  if (!allTemps || allTemps.length === 0) {
    return null;
  }

  // Score each temperature entry for relevance
  const scored = allTemps.map(temp => {
    let score = 0;
    const tempWineType = (temp.wine_type || '').toLowerCase();
    const tempGrapes = (temp.grape_varieties || '').toLowerCase();
    const tempRegions = (temp.regions || '').toLowerCase();
    const tempCategory = (temp.category || '').toLowerCase();
    const tempSubcategory = (temp.subcategory || '').toLowerCase();

    // Category match (important baseline)
    if (tempCategory === primaryCategory) {
      score += 10;
    }

    // Exact wine type match in wine name (highest priority)
    if (wineName.includes(tempWineType) || tempWineType.includes(wineName.split(' ')[0])) {
      score += 50;
    }

    // Wine type in style
    if (style.includes(tempWineType) || tempWineType.includes(style)) {
      score += 40;
    }

    // Grape variety match
    if (tempGrapes && grapes) {
      const tempGrapeList = tempGrapes.split(/[,/]/).map(g => g.trim().toLowerCase());
      const wineGrapeList = grapes.split(/[,/]/).map(g => g.trim().toLowerCase());

      for (const tg of tempGrapeList) {
        for (const wg of wineGrapeList) {
          if (tg && wg && (tg.includes(wg) || wg.includes(tg))) {
            score += 30;
          }
        }
      }
    }

    // Wine type mentioned in search text
    if (searchText.includes(tempWineType)) {
      score += 25;
    }

    // Subcategory hints
    if (tempSubcategory) {
      if (searchText.includes(tempSubcategory.replace(/_/g, ' '))) {
        score += 15;
      }
    }

    // Region match
    if (tempRegions) {
      const regions = tempRegions.toLowerCase().split(/[,/]/).map(r => r.trim());
      for (const region of regions) {
        if (region && searchText.includes(region)) {
          score += 10;
        }
      }
    }

    // Body match hints from style
    if (temp.body) {
      const body = temp.body.toLowerCase();
      if ((searchText.includes('light') && body.includes('light')) ||
          (searchText.includes('full') && body.includes('full')) ||
          (searchText.includes('medium') && body.includes('medium'))) {
        score += 5;
      }
    }

    return { ...temp, score };
  });

  // Sort by score descending and get best match
  scored.sort((a, b) => b.score - a.score);

  // Return best match if it has a reasonable score
  if (scored[0] && scored[0].score > 5) {
    const best = scored[0];
    return {
      wine_type: best.wine_type,
      category: best.category,
      subcategory: best.subcategory,
      body: best.body,
      temp_min_celsius: best.temp_min_celsius,
      temp_max_celsius: best.temp_max_celsius,
      temp_min_fahrenheit: best.temp_min_fahrenheit,
      temp_max_fahrenheit: best.temp_max_fahrenheit,
      notes: best.notes,
      match_confidence: Math.min(best.score / 100, 1.0)
    };
  }

  // Fall back to generic category-based temperature
  const fallback = getFallbackTemperature(primaryCategory, colour);
  return fallback;
}

/**
 * Get fallback temperature based on category/colour.
 * @param {string} category - Wine category
 * @param {string} colour - Wine colour
 * @returns {Object} Fallback temperature recommendation
 */
function getFallbackTemperature(category, _colour) {
  // Generic recommendations by category
  const fallbacks = {
    sparkling: {
      wine_type: 'Sparkling Wine',
      category: 'sparkling',
      temp_min_celsius: 6,
      temp_max_celsius: 10,
      temp_min_fahrenheit: 43,
      temp_max_fahrenheit: 50,
      notes: 'Serve cold to preserve bubbles. Vintage/prestige cuvees can be served slightly warmer.',
      match_confidence: 0.3
    },
    white: {
      wine_type: 'White Wine',
      category: 'white',
      temp_min_celsius: 8,
      temp_max_celsius: 12,
      temp_min_fahrenheit: 46,
      temp_max_fahrenheit: 54,
      notes: 'Light whites serve colder (7-10C). Fuller oaked whites serve warmer (10-14C).',
      match_confidence: 0.3
    },
    rose: {
      wine_type: 'Rose Wine',
      category: 'rose',
      temp_min_celsius: 8,
      temp_max_celsius: 12,
      temp_min_fahrenheit: 46,
      temp_max_fahrenheit: 54,
      notes: 'Serve chilled like white wine. Fuller roses can be served slightly warmer.',
      match_confidence: 0.3
    },
    orange: {
      wine_type: 'Orange Wine',
      category: 'orange',
      temp_min_celsius: 12,
      temp_max_celsius: 16,
      temp_min_fahrenheit: 54,
      temp_max_fahrenheit: 61,
      notes: 'Skin-contact wines can be served like light reds. Extended maceration wines warmer.',
      match_confidence: 0.3
    },
    red: {
      wine_type: 'Red Wine',
      category: 'red',
      temp_min_celsius: 14,
      temp_max_celsius: 18,
      temp_min_fahrenheit: 57,
      temp_max_fahrenheit: 64,
      notes: 'Light reds serve cooler (12-15C). Full-bodied reds serve warmer (16-18C).',
      match_confidence: 0.3
    },
    dessert: {
      wine_type: 'Dessert Wine',
      category: 'dessert',
      temp_min_celsius: 8,
      temp_max_celsius: 12,
      temp_min_fahrenheit: 46,
      temp_max_fahrenheit: 54,
      notes: 'Serve cold to balance sweetness. Rich dried grape wines can be served warmer.',
      match_confidence: 0.3
    },
    fortified: {
      wine_type: 'Fortified Wine',
      category: 'fortified',
      temp_min_celsius: 10,
      temp_max_celsius: 16,
      temp_min_fahrenheit: 50,
      temp_max_fahrenheit: 61,
      notes: 'Dry styles (Fino, Manzanilla) serve very cold. Rich styles (Port, sweet sherry) warmer.',
      match_confidence: 0.3
    }
  };

  return fallbacks[category] || fallbacks.red;
}

/**
 * Format temperature recommendation for display.
 * @param {Object} temp - Temperature entry
 * @param {string} unit - 'celsius' or 'fahrenheit'
 * @returns {string} Formatted temperature string
 */
export function formatTemperature(temp, unit = 'celsius') {
  if (!temp) return 'Unknown';

  if (unit === 'fahrenheit') {
    return `${temp.temp_min_fahrenheit}-${temp.temp_max_fahrenheit}°F`;
  }
  return `${temp.temp_min_celsius}-${temp.temp_max_celsius}°C`;
}

/**
 * Get serving advice based on current temperature.
 * @param {Object} temp - Temperature recommendation
 * @param {number} currentTemp - Current wine temperature in Celsius
 * @returns {Object} Advice with action and time estimate
 */
export function getServingAdvice(temp, currentTemp) {
  if (!temp || currentTemp === null || currentTemp === undefined) {
    return null;
  }

  const targetTemp = (temp.temp_min_celsius + temp.temp_max_celsius) / 2;
  const diff = currentTemp - targetTemp;

  if (Math.abs(diff) <= 1) {
    return {
      action: 'ready',
      message: 'Wine is at ideal serving temperature'
    };
  }

  if (diff > 0) {
    // Wine is too warm, needs chilling
    const minutes = Math.round(diff * 5); // ~5 min per degree in fridge
    return {
      action: 'chill',
      message: `Wine is too warm. Chill for approximately ${minutes} minutes in fridge.`,
      iceBucketMinutes: Math.round(diff * 2.5) // Faster in ice bucket
    };
  } else {
    // Wine is too cold, needs warming
    const minutes = Math.round(Math.abs(diff) * 3); // ~3 min per degree at room temp
    return {
      action: 'warm',
      message: `Wine is too cold. Let it warm at room temperature for approximately ${minutes} minutes.`
    };
  }
}
