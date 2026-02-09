/**
 * @fileoverview Country/locale inference from wine style and region names.
 * Maps appellations, regions, and style keywords to countries.
 * @module services/wine/countryInference
 */

/**
 * Region/style patterns to infer country when not explicitly set.
 * Maps region names, appellations, and style keywords to countries.
 */
export const REGION_TO_COUNTRY = {
  // Country names (for styles like "Cabernet Sauvignon (south Africa)")
  'south africa': 'South Africa', 'south african': 'South Africa',
  'chile': 'Chile', 'chilean': 'Chile',
  'argentina': 'Argentina', 'argentinian': 'Argentina', 'argentine': 'Argentina',
  'australia': 'Australia', 'australian': 'Australia',
  'new zealand': 'New Zealand',
  'france': 'France', 'french': 'France',
  'italy': 'Italy', 'italian': 'Italy',
  'spain': 'Spain', 'spanish': 'Spain',
  'portugal': 'Portugal', 'portuguese': 'Portugal',
  'germany': 'Germany', 'german': 'Germany',
  'austria': 'Austria', 'austrian': 'Austria',
  'usa': 'USA', 'united states': 'USA', 'american': 'USA',

  // France - Regions
  'bordeaux': 'France', 'burgundy': 'France', 'bourgogne': 'France', 'champagne': 'France',
  'rhone': 'France', 'loire': 'France', 'alsace': 'France', 'provence': 'France',
  'languedoc': 'France', 'roussillon': 'France', 'cahors': 'France', 'beaujolais': 'France',
  'chablis': 'France', 'sauternes': 'France', 'medoc': 'France', 'pomerol': 'France',
  'saint-emilion': 'France', 'st-emilion': 'France', 'margaux': 'France', 'pauillac': 'France',
  'cabardes': 'France', 'cabardès': 'France', 'minervois': 'France', 'corbieres': 'France',
  'cotes du rhone': 'France', 'chateauneuf': 'France', 'gigondas': 'France', 'bandol': 'France',
  'muscadet': 'France', 'sancerre': 'France', 'vouvray': 'France', 'pouilly': 'France',

  // Italy - Regions
  'tuscany': 'Italy', 'toscana': 'Italy', 'piedmont': 'Italy', 'piemonte': 'Italy',
  'veneto': 'Italy', 'chianti': 'Italy', 'barolo': 'Italy', 'barbaresco': 'Italy',
  'brunello': 'Italy', 'montalcino': 'Italy', 'valpolicella': 'Italy', 'amarone': 'Italy',
  'prosecco': 'Italy', 'soave': 'Italy', 'sicily': 'Italy', 'sicilia': 'Italy',
  'puglia': 'Italy', 'abruzzo': 'Italy', 'friuli': 'Italy', 'alto adige': 'Italy',

  // Spain - Regions
  'rioja': 'Spain', 'ribera del duero': 'Spain', 'priorat': 'Spain', 'rias baixas': 'Spain',
  'jerez': 'Spain', 'sherry': 'Spain', 'cava': 'Spain', 'penedes': 'Spain',
  'rueda': 'Spain', 'toro': 'Spain', 'jumilla': 'Spain', 'navarra': 'Spain',

  // Portugal - Regions
  'douro': 'Portugal', 'porto': 'Portugal', 'port': 'Portugal', 'dao': 'Portugal',
  'alentejo': 'Portugal', 'vinho verde': 'Portugal', 'madeira': 'Portugal',

  // Germany/Austria - Regions
  'mosel': 'Germany', 'rheingau': 'Germany', 'pfalz': 'Germany', 'baden': 'Germany',
  'wachau': 'Austria', 'kamptal': 'Austria', 'burgenland': 'Austria',

  // South Africa - Regions
  'stellenbosch': 'South Africa', 'franschhoek': 'South Africa', 'paarl': 'South Africa',
  'swartland': 'South Africa', 'constantia': 'South Africa', 'elgin': 'South Africa',
  'walker bay': 'South Africa', 'hemel-en-aarde': 'South Africa', 'western cape': 'South Africa',

  // Australia - Regions
  'barossa': 'Australia', 'mclaren vale': 'Australia', 'hunter valley': 'Australia',
  'yarra valley': 'Australia', 'margaret river': 'Australia', 'coonawarra': 'Australia',
  'clare valley': 'Australia', 'eden valley': 'Australia', 'adelaide hills': 'Australia',

  // New Zealand - Regions
  'marlborough': 'New Zealand', 'hawkes bay': 'New Zealand', 'central otago': 'New Zealand',
  'martinborough': 'New Zealand', 'waipara': 'New Zealand', 'gisborne': 'New Zealand',

  // USA - Regions
  'napa': 'USA', 'sonoma': 'USA', 'california': 'USA', 'oregon': 'USA',
  'willamette': 'USA', 'paso robles': 'USA', 'santa barbara': 'USA',

  // Chile - Regions
  'maipo': 'Chile', 'colchagua': 'Chile', 'casablanca': 'Chile', 'aconcagua': 'Chile',
  'maule': 'Chile', 'rapel': 'Chile', 'limari': 'Chile', 'elqui': 'Chile',

  // Argentina - Regions
  'mendoza': 'Argentina', 'uco valley': 'Argentina', 'salta': 'Argentina', 'cafayate': 'Argentina',
  'patagonia': 'Argentina', 'lujan de cuyo': 'Argentina'
};

/**
 * Protected geographical indications that are commonly used as STYLE descriptors
 * in New World wines. These should NOT trigger country inference when they appear
 * as part of a style name (e.g., "Bordeaux Blend" from South Africa).
 *
 * Only infer country from these terms if they appear to be actual appellations,
 * not style descriptors. The heuristic: if "blend", "style", or "method" follows,
 * it's a style descriptor and should be ignored.
 */
const PROTECTED_STYLE_TERMS = [
  'bordeaux', 'burgundy', 'champagne', 'chianti', 'rioja', 'barolo',
  'port', 'sherry', 'chablis', 'rhone', 'beaujolais', 'sauternes'
];

/**
 * Infer country from wine style or region name.
 * Avoids false positives from style descriptors like "Bordeaux Blend".
 * @param {string} style - Wine style (e.g., "Languedoc Red Blend")
 * @param {string} region - Wine region if available
 * @returns {string|null} Inferred country or null
 */
export function inferCountryFromStyle(style, region = null) {
  const textToSearch = `${style || ''} ${region || ''}`.toLowerCase();

  // Check for style descriptor patterns that indicate this is NOT an origin
  // e.g., "Bordeaux Blend", "Champagne Method", "Burgundy Style"
  const styleDescriptorPattern = /\b(bordeaux|burgundy|champagne|chianti|rioja|barolo|port|sherry|chablis|rhone|beaujolais|sauternes)\s+(blend|style|method|type)/i;
  const hasStyleDescriptor = styleDescriptorPattern.test(textToSearch);

  for (const [pattern, country] of Object.entries(REGION_TO_COUNTRY)) {
    if (textToSearch.includes(pattern)) {
      // If this is a protected term and appears to be a style descriptor, skip it
      if (PROTECTED_STYLE_TERMS.includes(pattern) && hasStyleDescriptor) {
        continue;
      }
      return country;
    }
  }

  return null;
}
