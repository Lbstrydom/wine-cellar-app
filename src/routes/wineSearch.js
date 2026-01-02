/**
 * @fileoverview Wine search endpoints for confirmation workflow.
 * Allows searching Vivino for wine matches before adding to cellar.
 * @module routes/wineSearch
 */

import { Router } from 'express';
import { searchVivinoWines, getVivinoWineDetails } from '../services/vivinoSearch.js';

const router = Router();

/**
 * Country name to Vivino-compatible code mapping.
 */
const COUNTRY_CODES = {
  'South Africa': 'za',
  'France': 'fr',
  'Italy': 'it',
  'Spain': 'es',
  'Portugal': 'pt',
  'Germany': 'de',
  'Austria': 'at',
  'Australia': 'au',
  'New Zealand': 'nz',
  'USA': 'us',
  'United States': 'us',
  'Chile': 'cl',
  'Argentina': 'ar',
  'Greece': 'gr',
  'Lebanon': 'lb',
  'Israel': 'il'
};

/**
 * Convert country name to code.
 * @param {string} country - Country name
 * @returns {string|null} Two-letter country code
 */
function countryToCode(country) {
  if (!country) return null;
  return COUNTRY_CODES[country] || null;
}

/**
 * Extract producer name from wine name.
 * Producer is typically the first 1-3 significant words.
 * @param {string} wineName - Full wine name
 * @returns {string|null} Producer name
 */
function extractProducer(wineName) {
  if (!wineName) return null;

  // Grape varieties - stop here
  const grapeVarieties = new Set([
    'cabernet', 'sauvignon', 'blanc', 'merlot', 'shiraz', 'syrah', 'pinot',
    'chardonnay', 'riesling', 'chenin', 'pinotage', 'malbec', 'tempranillo',
    'sangiovese', 'nebbiolo', 'primitivo', 'grenache', 'mourvedre', 'noir',
    'grigio', 'gris', 'verdejo', 'viognier', 'carmenere', 'tannat'
  ]);

  // Wine type words - stop here
  const wineTypeWords = new Set([
    'red', 'white', 'rose', 'rosé', 'blend', 'reserve', 'reserva', 'gran',
    'selection', 'single', 'barrel', 'limited', 'special', 'cuvee', 'brut'
  ]);

  const words = wineName.split(/\s+/);
  const producerWords = [];

  for (const word of words) {
    const cleaned = word.toLowerCase().replace(/[^a-z]/g, '');
    if (/^\d+$/.test(word)) continue; // Skip numbers
    if (grapeVarieties.has(cleaned)) break;
    if (wineTypeWords.has(cleaned)) break;
    producerWords.push(word);
    if (producerWords.length >= 4) break;
  }

  if (producerWords.length === 0) return null;
  return producerWords.join(' ').replace(/\([^)]*\)/g, '').trim();
}

/**
 * Search for wines (returns candidates for confirmation).
 * @route POST /api/wine-search
 */
router.post('/', async (req, res) => {
  try {
    const { wineName, producer, vintage, country, colour } = req.body;

    if (!wineName && !producer) {
      return res.status(400).json({ error: 'Wine name or producer required' });
    }

    // Build search query - prefer explicit producer, fall back to extraction
    const effectiveProducer = producer || extractProducer(wineName);

    // Search Vivino
    const vivinoResults = await searchVivinoWines({
      query: wineName,
      producer: effectiveProducer,
      vintage: vintage ? parseInt(vintage) : null,
      country: countryToCode(country)
    });

    if (vivinoResults.error) {
      console.warn('Wine search warning:', vivinoResults.error);
    }

    // Format response
    res.json({
      query: { wineName, producer: effectiveProducer, vintage, country, colour },
      matches: vivinoResults.matches.slice(0, 8),
      searchedAt: new Date().toISOString(),
      error: vivinoResults.error
    });

  } catch (error) {
    console.error('Wine search error:', error);
    res.status(500).json({ error: 'Failed to search for wines' });
  }
});

/**
 * Check if wine search feature is available.
 * @route GET /api/wine-search/status
 */
router.get('/status', (req, res) => {
  const available = !!process.env.BRIGHTDATA_API_KEY;
  res.json({
    available,
    message: available ? 'Wine search is available' : 'BRIGHTDATA_API_KEY not configured'
  });
});

/**
 * Get detailed wine info by Vivino ID.
 * @route GET /api/wine-search/vivino/:id
 */
router.get('/vivino/:id', async (req, res) => {
  try {
    const wineId = parseInt(req.params.id);

    if (!wineId || isNaN(wineId)) {
      return res.status(400).json({ error: 'Invalid wine ID' });
    }

    const details = await getVivinoWineDetails(wineId);

    if (!details) {
      return res.status(404).json({ error: 'Wine not found' });
    }

    res.json(details);

  } catch (error) {
    console.error('Wine details error:', error);
    res.status(500).json({ error: 'Failed to fetch wine details' });
  }
});

export default router;
