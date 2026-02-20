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
  { display: 'Muscadelle', pattern: /muscadelle/i },
  { display: 'Gros Manseng', pattern: /gros\s*manseng/i },
  { display: 'Petit Manseng', pattern: /petit\s*manseng/i },
  { display: 'Macabeo', pattern: /macabeo|macabeu/i },
  { display: 'Viura', pattern: /\bviura\b/i },
  { display: 'Parellada', pattern: /parellada/i },
  { display: 'Xarel·lo', pattern: /xarel[·.]?lo/i },
  { display: 'Trebbiano', pattern: /trebbiano/i },
  { display: 'Vermentino', pattern: /vermentino/i },
  { display: 'Picpoul', pattern: /pic[kp]oul/i },
  { display: 'Clairette', pattern: /clairette/i },
  { display: 'Grenache Blanc', pattern: /grenache\s*blanc/i },
  { display: 'Garganega', pattern: /garganega/i },
  { display: 'Cortese', pattern: /cortese/i },
  { display: 'Fiano', pattern: /\bfiano\b/i },
  { display: 'Greco', pattern: /\bgreco\b/i },
  { display: 'Assyrtiko', pattern: /assyrtiko/i },
  { display: 'Godello', pattern: /godello/i },
  { display: 'Loureiro', pattern: /loureiro/i },
  { display: 'Alvarinho', pattern: /alvarinho/i },

  // Red varieties (longer patterns first to avoid partial matches)
  { display: 'Cabernet Sauvignon', pattern: /cabernet\s*sauvignon/i },
  { display: 'Cabernet Franc', pattern: /cabernet\s*franc/i },
  { display: 'Pinot Noir', pattern: /pinot\s*noir/i },
  { display: 'Touriga Nacional', pattern: /touriga\s*nacional/i },
  { display: 'Touriga Franca', pattern: /touriga\s*fran[cç]a|touriga\s*francesa/i },
  { display: 'Tinta Roriz', pattern: /tinta\s*roriz/i },
  { display: 'Tinta Barroca', pattern: /tinta\s*barroca/i },
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
  { display: 'Cinsault', pattern: /cinsault|cinsaut/i },
  { display: 'Carignan', pattern: /carignan|cari[gñ]ena/i },
  { display: 'Graciano', pattern: /graciano/i },
  { display: 'Pinot Meunier', pattern: /pinot\s*meunier|meunier/i },
  { display: 'Rondinella', pattern: /rondinella/i },
  { display: 'Molinara', pattern: /molinara/i },
  { display: 'Canaiolo', pattern: /canaiolo/i },
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
  // ══════════════════════════════════════════════════════
  // ITALY — Single-grape appellations
  // ══════════════════════════════════════════════════════
  { pattern: /\bbarolo\b/i, grape: 'Nebbiolo', confidence: 'high' },
  { pattern: /\bbarbaresco\b/i, grape: 'Nebbiolo', confidence: 'high' },
  { pattern: /\bbrunello\b/i, grape: 'Sangiovese', confidence: 'high' },
  { pattern: /\bsoave\b/i, grape: 'Garganega', confidence: 'high' },
  { pattern: /\bgavi\b/i, grape: 'Cortese', confidence: 'high' },

  // ITALY — Blend appellations
  { pattern: /\bchianti\b/i, grape: 'Sangiovese, Canaiolo, Merlot', confidence: 'high' },
  { pattern: /\bvino\s*nobile\b/i, grape: 'Sangiovese, Canaiolo', confidence: 'high' },
  { pattern: /\bamarone\b/i, grape: 'Corvina, Rondinella, Molinara', confidence: 'high' },
  { pattern: /\bvalpolicella\b/i, grape: 'Corvina, Rondinella, Molinara', confidence: 'high' },
  { pattern: /\bsuper\s*tuscan\b/i, grape: 'Sangiovese, Cabernet Sauvignon, Merlot', confidence: 'medium' },
  { pattern: /\bbolgheri\b/i, grape: 'Cabernet Sauvignon, Merlot, Cabernet Franc', confidence: 'medium' },

  // ══════════════════════════════════════════════════════
  // FRANCE — Single-grape appellations
  // ══════════════════════════════════════════════════════
  { pattern: /\bchablis\b/i, grape: 'Chardonnay', confidence: 'high' },
  { pattern: /\bmeursault\b/i, grape: 'Chardonnay', confidence: 'high' },
  { pattern: /\bmontrachet\b/i, grape: 'Chardonnay', confidence: 'high' },
  { pattern: /\bpouilly[- ]fuiss[eé]\b/i, grape: 'Chardonnay', confidence: 'high' },
  { pattern: /\bsancerre\b/i, grape: 'Sauvignon Blanc', confidence: 'high' },
  { pattern: /\bpouilly[- ]fum[eé]\b/i, grape: 'Sauvignon Blanc', confidence: 'high' },
  { pattern: /\bvouvray\b/i, grape: 'Chenin Blanc', confidence: 'high' },
  { pattern: /\bsavenni[eè]res\b/i, grape: 'Chenin Blanc', confidence: 'high' },
  { pattern: /\bcornas\b/i, grape: 'Shiraz', confidence: 'high' },
  { pattern: /\bcondrieu\b/i, grape: 'Viognier', confidence: 'high' },
  { pattern: /\bmuscadet\b/i, grape: 'Melon de Bourgogne', confidence: 'high' },

  // FRANCE — Red blend appellations
  { pattern: /\bch[aâ]teauneuf[- ]du[- ]pape\b(?!\s+blanc)/i, grape: 'Grenache, Shiraz, Mourvèdre', confidence: 'high' },
  { pattern: /\bc[oô]tes?\s*du\s*rh[oô]ne\b(?!\s+blanc)/i, grape: 'Grenache, Shiraz, Mourvèdre', confidence: 'medium' },
  { pattern: /\bgigondas\b/i, grape: 'Grenache, Shiraz, Mourvèdre', confidence: 'high' },
  { pattern: /\bvacqueyras\b/i, grape: 'Grenache, Shiraz, Mourvèdre', confidence: 'high' },
  { pattern: /\blirac\b/i, grape: 'Grenache, Shiraz, Mourvèdre', confidence: 'medium' },
  { pattern: /\bhermitage\b(?!\s+blanc)/i, grape: 'Shiraz', confidence: 'high' },
  { pattern: /\bc[oô]te[- ]r[oô]tie\b/i, grape: 'Shiraz, Viognier', confidence: 'high' },
  { pattern: /\bsaint[- ]joseph\b(?!\s+blanc)/i, grape: 'Shiraz', confidence: 'medium' },
  { pattern: /\bcrozes[- ]hermitage\b(?!\s+blanc)/i, grape: 'Shiraz', confidence: 'high' },
  { pattern: /\bbandol\b/i, grape: 'Mourvèdre, Grenache, Cinsault', confidence: 'high' },
  { pattern: /\bmadiran\b/i, grape: 'Tannat, Cabernet Franc', confidence: 'high' },
  { pattern: /\bcahors\b/i, grape: 'Malbec, Merlot', confidence: 'high' },
  { pattern: /\bminervois\b/i, grape: 'Grenache, Shiraz, Mourvèdre, Carignan', confidence: 'medium' },
  { pattern: /\bcorbi[eè]res\b/i, grape: 'Carignan, Grenache, Shiraz, Mourvèdre', confidence: 'medium' },
  { pattern: /\bfitou\b/i, grape: 'Carignan, Grenache, Shiraz', confidence: 'medium' },
  { pattern: /\blanguedoc\b/i, grape: 'Grenache, Shiraz, Mourvèdre, Carignan', confidence: 'low' },

  // FRANCE — Bordeaux red blend appellations (Left Bank = Cab Sauv dominant)
  { pattern: /\bm[eé]doc\b/i, grape: 'Cabernet Sauvignon, Merlot, Cabernet Franc', confidence: 'high' },
  { pattern: /\bmargaux\b/i, grape: 'Cabernet Sauvignon, Merlot, Cabernet Franc, Petit Verdot', confidence: 'high' },
  { pattern: /\bpauillac\b/i, grape: 'Cabernet Sauvignon, Merlot, Cabernet Franc', confidence: 'high' },
  { pattern: /\bsaint[- ]julien\b/i, grape: 'Cabernet Sauvignon, Merlot, Cabernet Franc', confidence: 'high' },
  { pattern: /\bsaint[- ]est[eè]phe\b/i, grape: 'Cabernet Sauvignon, Merlot, Cabernet Franc', confidence: 'high' },
  { pattern: /\bpessac[- ]l[eé]ognan\b/i, grape: 'Cabernet Sauvignon, Merlot, Cabernet Franc', confidence: 'high' },
  { pattern: /\bgraves\b(?!\s*del)/i, grape: 'Cabernet Sauvignon, Merlot, Cabernet Franc', confidence: 'medium' },

  // FRANCE — Bordeaux red blend appellations (Right Bank = Merlot dominant)
  { pattern: /\bsaint[- ][eé]milion\b/i, grape: 'Merlot, Cabernet Franc, Cabernet Sauvignon', confidence: 'high' },
  { pattern: /\bpomerol\b/i, grape: 'Merlot, Cabernet Franc', confidence: 'high' },
  { pattern: /\bfronsac\b/i, grape: 'Merlot, Cabernet Franc, Cabernet Sauvignon', confidence: 'high' },

  // FRANCE — White blend appellations
  { pattern: /\bbordeaux\s*blanc\b/i, grape: 'Sémillon, Sauvignon Blanc, Muscadelle', confidence: 'high' },
  { pattern: /\bsauternes\b/i, grape: 'Sémillon, Sauvignon Blanc', confidence: 'high' },
  { pattern: /\bbarsac\b/i, grape: 'Sémillon, Sauvignon Blanc', confidence: 'high' },
  { pattern: /\bentre[- ]deux[- ]mers\b/i, grape: 'Sauvignon Blanc, Sémillon, Muscadelle', confidence: 'high' },
  { pattern: /\bjuran[çc]on\b/i, grape: 'Gros Manseng, Petit Manseng', confidence: 'high' },
  { pattern: /\bch[aâ]teauneuf[- ]du[- ]pape\s+blanc\b/i, grape: 'Grenache Blanc, Roussanne, Clairette', confidence: 'high' },
  { pattern: /\bc[oô]tes?\s*du\s*rh[oô]ne\s+blanc\b/i, grape: 'Grenache Blanc, Marsanne, Viognier', confidence: 'medium' },
  { pattern: /\bhermitage\s+blanc\b/i, grape: 'Marsanne, Roussanne', confidence: 'high' },
  { pattern: /\bcrozes[- ]hermitage\s+blanc\b/i, grape: 'Marsanne, Roussanne', confidence: 'high' },
  { pattern: /\bsaint[- ]joseph\s+blanc\b/i, grape: 'Marsanne, Roussanne', confidence: 'high' },

  // FRANCE — Rosé appellations
  { pattern: /\btavel\b/i, grape: 'Grenache, Cinsault, Mourvèdre', confidence: 'high' },
  { pattern: /\bprovence\b/i, grape: 'Grenache, Cinsault, Shiraz, Mourvèdre', confidence: 'medium' },

  // FRANCE — Sparkling
  { pattern: /\bchampagne\b/i, grape: 'Chardonnay, Pinot Noir, Pinot Meunier', confidence: 'high' },
  { pattern: /\bcr[eé]mant\b/i, grape: 'Chardonnay, Pinot Noir', confidence: 'medium' },

  // FRANCE — Other
  { pattern: /\balsace\b/i, grape: 'Riesling', confidence: 'low' },

  // ══════════════════════════════════════════════════════
  // SPAIN — Single-grape appellations
  // ══════════════════════════════════════════════════════
  { pattern: /\bribera\s*del\s*duero\b/i, grape: 'Tempranillo', confidence: 'high' },
  { pattern: /\btoro\b(?!\s*rosso)/i, grape: 'Tempranillo', confidence: 'high' },
  { pattern: /\brias\s*baixas\b/i, grape: 'Albariño', confidence: 'high' },
  { pattern: /\bru[eé]da\b/i, grape: 'Verdejo', confidence: 'high' },

  // SPAIN — Blend appellations
  { pattern: /\brioja\b(?!\s+blanco)/i, grape: 'Tempranillo, Garnacha, Graciano', confidence: 'medium' },
  { pattern: /\bpriorat\b/i, grape: 'Grenache, Carignan', confidence: 'high' },
  { pattern: /\bcava\b/i, grape: 'Macabeo, Parellada, Xarel·lo', confidence: 'high' },
  { pattern: /\bnavarra\b/i, grape: 'Tempranillo, Grenache, Cabernet Sauvignon', confidence: 'low' },
  { pattern: /\brioja\s+blanco\b/i, grape: 'Viura, Malvasia', confidence: 'medium' },
  { pattern: /\bjumilla\b/i, grape: 'Mourvèdre', confidence: 'medium' },

  // ══════════════════════════════════════════════════════
  // PORTUGAL — Blend appellations
  // ══════════════════════════════════════════════════════
  { pattern: /\bdouro\b/i, grape: 'Touriga Nacional, Touriga Franca, Tinta Roriz, Tinta Barroca', confidence: 'medium' },
  { pattern: /\bport\b(?!\s*(?:folio|ion|able|al|land))/i, grape: 'Touriga Nacional, Touriga Franca, Tinta Roriz, Tinta Barroca', confidence: 'medium' },
  { pattern: /\bd[aã]o\b/i, grape: 'Touriga Nacional, Tinta Roriz', confidence: 'medium' },
  { pattern: /\balentejo\b/i, grape: 'Touriga Nacional, Trincadeira, Aragonez', confidence: 'low' },
  { pattern: /\bvinho\s*verde\b/i, grape: 'Loureiro, Alvarinho', confidence: 'medium' },

  // ══════════════════════════════════════════════════════
  // SOUTH AFRICA
  // ══════════════════════════════════════════════════════
  { pattern: /\bcape\s*blend\b/i, grape: 'Pinotage, Cabernet Sauvignon, Merlot, Shiraz', confidence: 'high' },

  // ══════════════════════════════════════════════════════
  // AUSTRALIA — Blend styles
  // ══════════════════════════════════════════════════════
  { pattern: /\b(?:barossa|mclaren)\s*(?:vale\s*)?gsm\b/i, grape: 'Grenache, Shiraz, Mourvèdre', confidence: 'high' },
  { pattern: /\bgsm\b/i, grape: 'Grenache, Shiraz, Mourvèdre', confidence: 'high' },
  { pattern: /\bmargaret\s*river\b/i, grape: 'Cabernet Sauvignon, Merlot', confidence: 'low' },

  // ══════════════════════════════════════════════════════
  // USA — Blend styles
  // ══════════════════════════════════════════════════════
  { pattern: /\bmeritage\b/i, grape: 'Cabernet Sauvignon, Merlot, Cabernet Franc, Petit Verdot, Malbec', confidence: 'high' },

  // ══════════════════════════════════════════════════════
  // ARGENTINA
  // ══════════════════════════════════════════════════════
  { pattern: /\bmendoza\b/i, grape: 'Malbec', confidence: 'low' },

  // ══════════════════════════════════════════════════════
  // GREECE
  // ══════════════════════════════════════════════════════
  { pattern: /\bsantorini\b/i, grape: 'Assyrtiko', confidence: 'high' },

  // ══════════════════════════════════════════════════════
  // GENERIC RED BLEND (Bordeaux-style, catch-all — lowest priority)
  // ══════════════════════════════════════════════════════
  { pattern: /\bbordeaux\b(?!\s*blanc)/i, grape: 'Cabernet Sauvignon, Merlot, Cabernet Franc', confidence: 'medium' },
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
