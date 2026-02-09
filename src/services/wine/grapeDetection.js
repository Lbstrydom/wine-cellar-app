/**
 * @fileoverview Grape variety detection from wine names.
 * @module services/wine/grapeDetection
 */

/**
 * Grape variety patterns for detection from wine names.
 */
const GRAPE_PATTERNS = {
  chardonnay: /chardonnay/i,
  syrah: /syrah|shiraz/i,
  grenache: /grenache|garnacha/i,
  cabernet_sauvignon: /cabernet\s*sauvignon/i,
  merlot: /merlot/i,
  pinot_noir: /pinot\s*noir/i,
  sauvignon_blanc: /sauvignon\s*blanc/i,
  riesling: /riesling/i,
  malbec: /malbec/i,
  tempranillo: /tempranillo/i,
  nebbiolo: /nebbiolo|barolo|barbaresco/i,
  sangiovese: /sangiovese|chianti|brunello/i,
  pinotage: /pinotage/i,
  chenin_blanc: /chenin\s*blanc/i,
  viognier: /viognier/i,
  mourvedre: /mourv[eè]dre|monastrell/i,
  cabernet_franc: /cabernet\s*franc/i,
  gewurztraminer: /gew[uü]rztraminer/i,
  pinot_grigio: /pinot\s*gri[gs]io/i,
  zinfandel: /zinfandel|primitivo/i
};

/**
 * Detect grape variety from wine name.
 * @param {string} wineName - Wine name to analyze
 * @returns {string|null} Detected grape variety or null
 */
export function detectGrape(wineName) {
  if (!wineName) return null;

  for (const [grape, pattern] of Object.entries(GRAPE_PATTERNS)) {
    if (pattern.test(wineName)) {
      return grape;
    }
  }
  return null;
}
