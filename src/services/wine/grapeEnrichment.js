/**
 * @fileoverview Unified grape detection and enrichment service.
 * Merges pattern matching from cellarPlacement.js and grapeDetection.js,
 * adds appellation→grape proxy mappings.
 * @module services/wine/grapeEnrichment
 */

/**
 * Grape variety patterns with regex for robust matching.
 * Covers all varieties from both cellarPlacement.extractGrapesFromText (31 patterns)
 * and grapeDetection.detectGrape (20 regex patterns), unified and deduplicated.
 */
const GRAPE_PATTERNS = [
  // White varieties
  { display: 'Sauvignon Blanc', pattern: /sauvignon\s*blanc/i },
  { display: 'Chenin Blanc', pattern: /chenin\s*blanc/i },
  { display: 'Chardonnay', pattern: /chardonnay/i },
  { display: 'Riesling', pattern: /riesling/i },
  { display: 'Gewürztraminer', pattern: /gew[uü]rztraminer/i },
  { display: 'Viognier', pattern: /viognier/i },
  { display: 'Malvasia', pattern: /malvasia/i },
  { display: 'Albariño', pattern: /albar[ií][nñ]o/i },
  { display: 'Pinot Grigio', pattern: /pinot\s*gri[gs]io/i },
  { display: 'Sémillon', pattern: /s[eé]millon/i },
  { display: 'Verdejo', pattern: /verdejo/i },
  { display: 'Torrontés', pattern: /torront[eé]s/i },
  { display: 'Grüner Veltliner', pattern: /gr[uü]ner\s*veltliner/i },
  { display: 'Marsanne', pattern: /marsanne/i },
  { display: 'Roussanne', pattern: /roussanne/i },

  // Red varieties (longer patterns first to avoid partial matches)
  { display: 'Cabernet Sauvignon', pattern: /cabernet\s*sauvignon/i },
  { display: 'Cabernet Franc', pattern: /cabernet\s*franc/i },
  { display: 'Pinot Noir', pattern: /pinot\s*noir/i },
  { display: 'Touriga Nacional', pattern: /touriga\s*nacional/i },
  { display: 'Petit Verdot', pattern: /petit\s*verdot/i },
  { display: 'Merlot', pattern: /merlot/i },
  { display: 'Shiraz', pattern: /shiraz|syrah/i },
  { display: 'Tempranillo', pattern: /tempranillo/i },
  { display: 'Grenache', pattern: /grenache|garnacha/i },
  { display: 'Sangiovese', pattern: /sangiovese/i },
  { display: 'Nebbiolo', pattern: /nebbiolo/i },
  { display: 'Pinotage', pattern: /pinotage/i },
  { display: 'Malbec', pattern: /malbec/i },
  { display: 'Primitivo', pattern: /primitivo/i },
  { display: 'Zinfandel', pattern: /zinfandel/i },
  { display: 'Negroamaro', pattern: /negroamaro/i },
  { display: 'Corvina', pattern: /corvina/i },
  { display: 'Barbera', pattern: /barbera/i },
  { display: 'Dolcetto', pattern: /dolcetto/i },
  { display: 'Saperavi', pattern: /saperavi/i },
  { display: 'Carmenère', pattern: /carmen[eè]re/i },
  { display: 'Mourvèdre', pattern: /mourv[eè]dre|monastrell/i },
  { display: 'Cinsault', pattern: /cinsault/i },
  { display: 'Petite Sirah', pattern: /petite?\s*sirah/i },
  { display: 'Tannat', pattern: /tannat/i },
  { display: 'Aglianico', pattern: /aglianico/i },
  { display: 'Nero d\'Avola', pattern: /nero\s*d'?\s*avola/i },
];

/**
 * Appellation→grape proxy mappings.
 * When a wine has no grape in its name but its name/region contains a known appellation,
 * we can infer the grape with reasonable confidence.
 */
const APPELLATION_GRAPE_MAP = [
  // Italian
  { pattern: /\bbarolo\b/i, grape: 'Nebbiolo', confidence: 'high' },
  { pattern: /\bbarbaresco\b/i, grape: 'Nebbiolo', confidence: 'high' },
  { pattern: /\bchianti\b/i, grape: 'Sangiovese', confidence: 'high' },
  { pattern: /\bbrunello\b/i, grape: 'Sangiovese', confidence: 'high' },
  { pattern: /\bvino\s*nobile\b/i, grape: 'Sangiovese', confidence: 'high' },
  { pattern: /\bamarone\b/i, grape: 'Corvina', confidence: 'medium' },
  { pattern: /\bvalpolicella\b/i, grape: 'Corvina', confidence: 'medium' },

  // French
  { pattern: /\bchablis\b/i, grape: 'Chardonnay', confidence: 'high' },
  { pattern: /\bmeursault\b/i, grape: 'Chardonnay', confidence: 'high' },
  { pattern: /\bmontrachet\b/i, grape: 'Chardonnay', confidence: 'high' },
  { pattern: /\bpouilly[- ]fuiss[eé]\b/i, grape: 'Chardonnay', confidence: 'high' },
  { pattern: /\bsancerre\b/i, grape: 'Sauvignon Blanc', confidence: 'high' },
  { pattern: /\bpouilly[- ]fum[eé]\b/i, grape: 'Sauvignon Blanc', confidence: 'high' },
  { pattern: /\bvouvray\b/i, grape: 'Chenin Blanc', confidence: 'high' },
  { pattern: /\bsavenni[eè]res\b/i, grape: 'Chenin Blanc', confidence: 'high' },
  { pattern: /\bch[aâ]teauneuf[- ]du[- ]pape\b/i, grape: 'Grenache', confidence: 'medium' },
  { pattern: /\bhermitage\b/i, grape: 'Shiraz', confidence: 'high' },
  { pattern: /\bc[oô]te[- ]r[oô]tie\b/i, grape: 'Shiraz', confidence: 'high' },
  { pattern: /\bcornas\b/i, grape: 'Shiraz', confidence: 'high' },
  { pattern: /\bsaint[- ]joseph\b/i, grape: 'Shiraz', confidence: 'medium' },
  { pattern: /\balsace\b/i, grape: 'Riesling', confidence: 'low' },

  // Spanish
  { pattern: /\brioja\b/i, grape: 'Tempranillo', confidence: 'medium' },
  { pattern: /\bribera\s*del\s*duero\b/i, grape: 'Tempranillo', confidence: 'high' },
  { pattern: /\btoro\b(?!\s*rosso)/i, grape: 'Tempranillo', confidence: 'high' },
  { pattern: /\brias\s*baixas\b/i, grape: 'Albariño', confidence: 'high' },
  { pattern: /\bpriorat\b/i, grape: 'Grenache', confidence: 'medium' },

  // Portuguese
  { pattern: /\bdouro\b/i, grape: 'Touriga Nacional', confidence: 'low' },

  // Argentinian
  { pattern: /\bmendoza\b/i, grape: 'Malbec', confidence: 'low' },
];

/**
 * Detect grape varieties from wine text fields (name, style).
 * @param {string} text - Combined text to search
 * @returns {string[]} Array of detected grape display names
 */
function detectGrapesFromText(text) {
  if (!text) return [];
  const found = [];
  for (const { display, pattern } of GRAPE_PATTERNS) {
    if (pattern.test(text)) {
      found.push(display);
    }
  }
  return found;
}

/**
 * Detect grape via appellation proxy from wine text fields.
 * @param {string} text - Combined text to search
 * @returns {{ grape: string, confidence: string, source: string } | null}
 */
function detectGrapeFromAppellation(text) {
  if (!text) return null;
  for (const { pattern, grape, confidence } of APPELLATION_GRAPE_MAP) {
    if (pattern.test(text)) {
      return { grape, confidence, source: 'appellation' };
    }
  }
  return null;
}

/**
 * Detect grapes from a wine object using all available signals.
 * Checks: wine name, style, region — in that priority order.
 * @param {Object} wine - Wine object with wine_name, style, region, country
 * @returns {{ grapes: string|null, confidence: 'high'|'medium'|'low', source: 'name'|'appellation'|'region' }}
 */
export function detectGrapesFromWine(wine) {
  if (!wine) return { grapes: null, confidence: 'low', source: 'name' };

  // 1. Direct grape name detection from wine name + style
  const nameText = `${wine.wine_name || wine.name || ''} ${wine.style || ''}`;
  const directGrapes = detectGrapesFromText(nameText);

  if (directGrapes.length > 0) {
    return {
      grapes: directGrapes.join(', '),
      confidence: 'high',
      source: 'name'
    };
  }

  // 2. Appellation proxy from wine name
  const nameAppellation = detectGrapeFromAppellation(nameText);
  if (nameAppellation) {
    return {
      grapes: nameAppellation.grape,
      confidence: nameAppellation.confidence,
      source: 'appellation'
    };
  }

  // 3. Appellation proxy from region
  const regionText = wine.region || '';
  const regionAppellation = detectGrapeFromAppellation(regionText);
  if (regionAppellation) {
    return {
      grapes: regionAppellation.grape,
      confidence: regionAppellation.confidence === 'high' ? 'medium' : 'low',
      source: 'region'
    };
  }

  return { grapes: null, confidence: 'low', source: 'name' };
}

/**
 * Batch detect grapes for multiple wines.
 * @param {Object[]} wines - Array of wine objects
 * @returns {Array<{ wineId: number, wine_name: string, detection: { grapes: string|null, confidence: string, source: string } }>}
 */
export function batchDetectGrapes(wines) {
  if (!wines || !Array.isArray(wines)) return [];

  return wines.map(wine => ({
    wineId: wine.id,
    wine_name: wine.wine_name || wine.name || '',
    detection: detectGrapesFromWine(wine)
  }));
}
