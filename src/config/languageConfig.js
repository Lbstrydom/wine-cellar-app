/**
 * @fileoverview Language-specific query templates and locale configuration for wine search.
 * Maps languages to their native query templates and search parameters.
 * @module config/languageConfig
 */

/**
 * Query templates by language and source
 * Each template uses {wine}, {vintage} placeholders
 */
export const LANGUAGE_QUERY_TEMPLATES = {
  // French sources
  fr: {
    guide_hachette: '"{wine}" {vintage} Guide Hachette étoiles OR "coup de coeur"',
    rvf: '"{wine}" {vintage} RVF note /20 OR "Revue du Vin de France"',
    bettane_desseauve: '"{wine}" {vintage} Bettane Desseauve note',
    larevueduvin: '"{wine}" {vintage} "La Revue du Vin" puntos OR puntuación'
  },

  // Italian sources
  it: {
    gambero_rosso: '"{wine}" {vintage} Gambero Rosso "tre bicchieri" OR bicchieri',
    bibenda: '"{wine}" {vintage} Bibenda grappoli OR "cinque grappoli"',
    doctor_wine: '"{wine}" {vintage} Doctor Wine voto',
    gallinapappante: '"{wine}" {vintage} Gallina Pappante votazione'
  },

  // Spanish sources
  es: {
    guia_penin: '"{wine}" {vintage} Guía Peñín puntos OR puntuación',
    descorchados: '"{wine}" {vintage} Descorchados puntos',
    bodeboca: '"{wine}" {vintage} bodeboca puntuación',
    vinomanos: '"{wine}" {vintage} viñomanos puntuación'
  },

  // German sources
  de: {
    falstaff: '"{wine}" {vintage} Falstaff Punkte OR Bewertung',
    vinum: '"{wine}" {vintage} Vinum Punkte /20',
    weinwisser: '"{wine}" {vintage} Weinwisser Bewertung',
    eichelmann: '"{wine}" {vintage} Eichelmann Gault Millau'
  },

  // Portuguese sources
  pt: {
    revista_vinhos: '"{wine}" {vintage} Revista Vinhos pontos OR pontuação',
    grande_enciclopedia: '"{wine}" {vintage} "Grande Enciclopédia" vinho'
  },

  // Dutch sources (v1.1 addition)
  nl: {
    hamersma: '"{wine}" {vintage} Hamersma beoordeling OR sterren',
    perswijn: '"{wine}" {vintage} Perswijn proefnotitie OR punten',
    wijnvoordeel: '"{wine}" {vintage} wijnvoordeel beoordeling',
    gall_gall: '"{wine}" {vintage} "Gall & Gall" score OR beoordeling',
    vivino_nl: '"{wine}" {vintage} Vivino Nederland beoordeling'
  },

  // English sources (baseline)
  en: {
    vivino: '"{wine}" {vintage} vivino rating stars',
    wine_searcher: '"{wine}" {vintage} wine-searcher rating',
    wine_com: '"{wine}" {vintage} wine.com rating',
    jancis_robinson: '"{wine}" {vintage} Jancis Robinson rating',
    parker: '"{wine}" {vintage} Robert Parker wine advocate',
    decanter: '"{wine}" {vintage} Decanter rating',
    james_suckling: '"{wine}" {vintage} James Suckling rating'
  }
};

/**
 * Locale configuration per language
 * Maps languages to SERP locale parameters and HTTP headers
 */
export const LOCALE_CONFIG = {
  fr: {
    name: 'French',
    serpLang: 'fr',
    serpCountry: 'fr',
    acceptLanguage: 'fr-FR,fr;q=0.9,en;q=0.5',
    timeZone: 'Europe/Paris'
  },

  it: {
    name: 'Italian',
    serpLang: 'it',
    serpCountry: 'it',
    acceptLanguage: 'it-IT,it;q=0.9,en;q=0.5',
    timeZone: 'Europe/Rome'
  },

  es: {
    name: 'Spanish',
    serpLang: 'es',
    serpCountry: 'es',
    acceptLanguage: 'es-ES,es;q=0.9,en;q=0.5',
    timeZone: 'Europe/Madrid'
  },

  de: {
    name: 'German',
    serpLang: 'de',
    serpCountry: 'de',
    acceptLanguage: 'de-DE,de;q=0.9,en;q=0.5',
    timeZone: 'Europe/Berlin'
  },

  pt: {
    name: 'Portuguese',
    serpLang: 'pt',
    serpCountry: 'pt',
    acceptLanguage: 'pt-PT,pt;q=0.9,en;q=0.5',
    timeZone: 'Europe/Lisbon'
  },

  nl: {
    name: 'Dutch',
    serpLang: 'nl',
    serpCountry: 'nl',
    acceptLanguage: 'nl-NL,nl;q=0.9,en;q=0.5',
    timeZone: 'Europe/Amsterdam'
  },

  en: {
    name: 'English',
    serpLang: 'en',
    serpCountry: 'us',
    acceptLanguage: 'en-US,en;q=0.9',
    timeZone: 'America/New_York'
  }
};

/**
 * Maps source ID to language
 * Used to select appropriate query templates and locale
 */
export const SOURCE_LANGUAGE_MAP = {
  // French
  guide_hachette: 'fr',
  rvf: 'fr',
  bettane_desseauve: 'fr',
  larevueduvin: 'fr',

  // Italian
  gambero_rosso: 'it',
  bibenda: 'it',
  doctor_wine: 'it',
  gallinapappante: 'it',

  // Spanish
  guia_penin: 'es',
  descorchados: 'es',
  bodeboca: 'es',
  vinomanos: 'es',

  // German
  falstaff: 'de',
  vinum: 'de',
  weinwisser: 'de',
  eichelmann: 'de',

  // Portuguese
  revista_vinhos: 'pt',
  grande_enciclopedia: 'pt',

  // Dutch
  hamersma: 'nl',
  perswijn: 'nl',
  wijnvoordeel: 'nl',
  gall_gall: 'nl',
  vivino_nl: 'nl',

  // English (default)
  vivino: 'en',
  wine_searcher: 'en',
  wine_com: 'en',
  jancis_robinson: 'en',
  parker: 'en',
  decanter: 'en',
  james_suckling: 'en'
};

/**
 * Get query template for a source
 * @param {string} sourceId - Source identifier
 * @param {string} wine - Wine name
 * @param {number|string} vintage - Vintage year
 * @returns {string|null} Formatted query template or null if not found
 */
export function getQueryTemplate(sourceId, wine, vintage = 'NV') {
  const language = SOURCE_LANGUAGE_MAP[sourceId] || 'en';
  const templates = LANGUAGE_QUERY_TEMPLATES[language] || LANGUAGE_QUERY_TEMPLATES.en;
  const template = templates[sourceId];

  if (!template) {
    return null;
  }

  return template
    .replace(/{wine}/g, wine)
    .replace(/{vintage}/g, String(vintage));
}

/**
 * Get locale configuration for a source
 * @param {string} sourceId - Source identifier
 * @returns {Object} Locale configuration
 */
export function getLocaleConfig(sourceId) {
  const language = SOURCE_LANGUAGE_MAP[sourceId] || 'en';
  return LOCALE_CONFIG[language] || LOCALE_CONFIG.en;
}

/**
 * Get all available languages
 * @returns {Array<string>} Language codes
 */
export function getAvailableLanguages() {
  return Object.keys(LOCALE_CONFIG);
}

/**
 * Get all sources for a language
 * @param {string} language - Language code (e.g., 'fr', 'it')
 * @returns {Array<string>} Source IDs
 */
export function getSourcesByLanguage(language) {
  return Object.entries(SOURCE_LANGUAGE_MAP)
    .filter(([_, lang]) => lang === language)
    .map(([sourceId, _]) => sourceId);
}

export default {
  LANGUAGE_QUERY_TEMPLATES,
  LOCALE_CONFIG,
  SOURCE_LANGUAGE_MAP,
  getQueryTemplate,
  getLocaleConfig,
  getAvailableLanguages,
  getSourcesByLanguage
};
