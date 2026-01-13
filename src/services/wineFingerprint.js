/**
 * @fileoverview Wine identity fingerprinting for canonical deduplication.
 * Generates normalized wine identities to prevent wrong-vintage/cuvée matches.
 * @module services/wineFingerprint
 */

/**
 * Wine Fingerprinting Service
 * Generates canonical identities for wine deduplication and cache keying
 * Format: producer|cuvee|varietal|vintage|country:appellation
 */
export class WineFingerprint {
  /**
   * Current fingerprint algorithm version.
   */
  static FINGERPRINT_VERSION = 1;

  /**
   * Major wine varietals (don't drop from cuvée)
   */
  static VARIETALS = [
    'cabernet sauvignon', 'cabernet franc', 'merlot', 'shiraz', 'syrah',
    'pinot noir', 'pinot grigio', 'pinot gris', 'chardonnay', 'sauvignon blanc',
    'riesling', 'chenin blanc', 'pinotage', 'malbec', 'tempranillo',
    'sangiovese', 'nebbiolo', 'grenache', 'mourvèdre', 'viognier',
    'barbera', 'dolcetto', 'carmenere', 'petit verdot', 'monastrell',
    'garnacha', 'albarino', 'vermentino', 'greco', 'aglianico',
    'barbera d alba', 'barbera d asti', 'moscato', 'prosecco', 'cava'
  ];

  /**
   * Wine tier/classification markers
   */
  static TIER_MARKERS = [
    'reserve', 'reserva', 'riserva', 'gran reserva', 'single vineyard',
    'grand cru', 'premier cru', 'crianza', 'roble', 'gran roble',
    'trocken', 'auslese', 'estate', 'family', 'vintage selection'
  ];

  /**
   * Country code mapping
   */
  static COUNTRY_CODES = {
    'south africa': 'za', 'australia': 'au', 'new zealand': 'nz',
    'france': 'fr', 'italy': 'it', 'spain': 'es', 'germany': 'de',
    'portugal': 'pt', 'chile': 'cl', 'argentina': 'ar', 'usa': 'us',
    'united states': 'us', 'austria': 'at', 'greece': 'gr',
    'hungary': 'hu', 'romania': 'ro', 'georgia': 'ge', 'lebanon': 'lb',
    'israel': 'il', 'slovenia': 'si', 'croatia': 'hr'
  };

  /**
   * Generate canonical wine identity key
   * @param {Object} wine - Wine object with producer, wine_name, vintage, country, region
   * @returns {string} Canonical fingerprint key
   * @example
   * WineFingerprint.generate({
   *   producer: 'Kanonkop',
   *   wine_name: 'Kanonkop Pinotage 2019',
   *   vintage: 2019,
   *   country: 'South Africa',
   *   region: 'Stellenbosch'
   * })
   * // → "kanonkop|pinotage|pinotage|2019|za:stellenbosch"
   */
  static generate(wine) {
    const result = this.generateWithVersion(wine);
    return result?.fingerprint || null;
  }

  /**
   * Generate canonical wine identity key with version.
   * @param {Object} wine - Wine object with producer, wine_name, vintage, country, region
   * @returns {{fingerprint: string, version: number}|null}
   */
  static generateWithVersion(wine) {
    if (!wine) return null;

    const rawProducer = wine.producer || this.extractProducer(wine.wine_name);
    const producer = this.normalizeProducer(rawProducer);
    const { cuvee, varietal } = this.extractCuveeAndVarietal(wine.wine_name, rawProducer);
    const vintage = this.normalizeVintage(wine.vintage);
    const location = this.normalizeLocation(wine.country, wine.region);

    const fingerprint = `${producer}|${cuvee}|${varietal}|${vintage}|${location}`.toLowerCase();
    return { fingerprint, version: this.FINGERPRINT_VERSION };
  }

  /**
   * Normalize text to lowercase ASCII and remove punctuation (except hyphens).
   * @param {string} value - Raw text
   * @returns {string}
   */
  static normalizeText(value) {
    if (!value) return '';
    return value
      .toString()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9-\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Normalize vintage to a string; NV/null -> "nv".
   * @param {string|number|null} vintage
   * @returns {string}
   */
  static normalizeVintage(vintage) {
    if (!vintage) return 'nv';
    const asString = String(vintage).trim().toLowerCase();
    if (!asString || asString === 'nv' || asString === 'n/v') return 'nv';
    return asString.replace(/[^0-9]/g, '') || 'nv';
  }

  /**
   * Normalize producer name
   * Removes common prefixes (Chateau, Domaine, Bodega, etc.)
   * Normalizes spacing and strips punctuation
   * @param {string} name - Producer name
   * @returns {string} Normalized producer name
   */
  static normalizeProducer(name) {
    if (!name) return 'unknown';

    return this.normalizeText(name)
      // Remove common prefixes (case-insensitive)
      .replace(/^(chateau|domaine|bodega|cantina|weingut|tenuta|mas|cave|clos|quinta|estate|castle|winery)\s+/i, '')
      // Replace whitespace with hyphens
      .replace(/\s+/g, '-')
      // Trim
      .trim();
  }

  /**
   * Extract cuvée and varietal separately
   * IMPORTANT (v1.1 fix): Don't drop varietals - they distinguish wines
   * @param {string} wineName - Full wine name
   * @param {string} rawProducer - Raw (unnormalized) producer name
   * @returns {Object} { cuvee: string, varietal: string }
   */
  static extractCuveeAndVarietal(wineName, rawProducer) {
    if (!wineName) return { cuvee: 'default', varietal: '' };

    // Remove producer using RAW tokens (not normalized slug), case-insensitive
    const producerTokens = rawProducer?.split(/\s+/) || [];
    let remaining = wineName;

    // Remove producer tokens that are 3+ characters
    for (const token of producerTokens) {
      if (token.length >= 3) {
        remaining = remaining.replace(new RegExp(this.escapeRegex(token), 'gi'), '');
      }
    }

    // Extract varietals (keep them, sort blends)
    const remainingLower = remaining.toLowerCase();
    const varietals = [];
    for (const v of this.VARIETALS) {
      if (remainingLower.includes(v)) {
        varietals.push(v);
      }
    }
    const varietal = this.normalizeVarietals(varietals);

    // Normalize tier markers as clean tokens (v1.1 fix: no brackets)
    let cuvee = remaining
      .replace(/\d{4}/g, '')  // Remove vintage years
      .trim();

    // Apply tier marker normalization
    for (const marker of this.TIER_MARKERS) {
      cuvee = cuvee.replace(new RegExp(`\\b${marker}\\b`, 'gi'), marker.toLowerCase());
    }

    // Clean up spacing and hyphens
    cuvee = this.normalizeText(cuvee)
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');

    return {
      cuvee: cuvee || 'default',
      varietal
    };
  }

  /**
   * Normalize varietals and sort blends alphabetically.
   * @param {string[]} varietals - Raw varietal names
   * @returns {string}
   */
  static normalizeVarietals(varietals) {
    if (!varietals || varietals.length === 0) return '';
    const normalized = varietals
      .map(v => this.normalizeText(v).replace(/\s+/g, '-'))
      .filter(Boolean);
    const unique = [...new Set(normalized)];
    return unique.sort().join('-');
  }

  /**
   * Normalize location as country_code:appellation
   * (v1.1 fix: no 2-letter truncation, use full appellation names)
   * @param {string} country - Country name
   * @param {string} region - Region/appellation name
   * @returns {string} Normalized location code
   */
  static normalizeLocation(country, region) {
    const countryKey = this.normalizeText(country);
    const countryCode = this.COUNTRY_CODES[countryKey] || 'xx';

    // If region provided and different from country, use it
    const regionKey = this.normalizeText(region);
    if (regionKey && regionKey !== countryKey) {
      const appellation = regionKey
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '');
      return `${countryCode}:${appellation}`;
    }

    // Default to country code only
    return countryCode;
  }

  /**
   * Extract producer name from wine name (heuristic)
   * Takes first 1-4 words before varietal keywords or vintage
   * @param {string} wineName - Full wine name
   * @returns {string} Extracted producer name
   */
  static extractProducer(wineName) {
    if (!wineName) return 'unknown';

    const words = wineName.split(/\s+/);
    const stopWords = [
      'cabernet', 'merlot', 'shiraz', 'pinot', 'chardonnay',
      'sauvignon', 'riesling', 'reserve', 'reserva', 'riserva',
      '2015', '2016', '2017', '2018', '2019', '2020', '2021', '2022', '2023', '2024', '2025'
    ];

    const producerWords = [];
    for (const word of words) {
      if (stopWords.some(sw => word.toLowerCase().includes(sw))) break;
      producerWords.push(word);
      if (producerWords.length >= 4) break;
    }

    return producerWords.join(' ') || 'unknown';
  }

  /**
   * Escape regex special characters
   * @param {string} string - String to escape
   * @returns {string} Escaped string
   */
  static escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Check if two fingerprints are likely the same wine
   * @param {string} fp1 - First fingerprint
   * @param {string} fp2 - Second fingerprint
   * @returns {boolean} True if fingerprints match
   */
  static matches(fp1, fp2) {
    return fp1 && fp2 && fp1.toLowerCase() === fp2.toLowerCase();
  }
}

/**
 * Known wine name variations and aliases
 * Maps primary fingerprint to alternative fingerprints
 */
export const WINE_ALIASES = {
  // Kanonkop Pinotage variations
  'kanonkop|default|pinotage|2019|za:stellenbosch': [
    'kanonkop|black-label|pinotage|2019|za:stellenbosch',
    'kanonkop|pinotage|pinotage|2019|za:stellenbosch'
  ],
  // Penfolds Grange variations
  'penfolds|grange|shiraz|2019|au': [
    'penfolds|grange-hermitage|shiraz|2019|au',
    'penfolds|bin-95|shiraz|2019|au'
  ],
  // Chateau Margaux
  'margaux|default|cabernet-sauvignon|2015|fr:pauillac': [
    'chateau-margaux|default|cabernet-sauvignon|2015|fr:pauillac',
    'margaux|chateau-margaux|cabernet-sauvignon|2015|fr:pauillac'
  ]
};

/**
 * Find matching aliases for a fingerprint
 * @param {string} fingerprint - Wine fingerprint
 * @returns {Array<string>} Matching fingerprints (including original)
 */
export function findAliases(fingerprint) {
  const results = [fingerprint];

  // Direct aliases
  if (WINE_ALIASES[fingerprint]) {
    results.push(...WINE_ALIASES[fingerprint]);
  }

  // Reverse aliases (find if this fingerprint is an alias)
  Object.entries(WINE_ALIASES).forEach(([primary, aliases]) => {
    if (aliases.includes(fingerprint)) {
      results.push(primary);
    }
  });

  // Remove duplicates
  return [...new Set(results)];
}

export default {
  WineFingerprint,
  WINE_ALIASES,
  findAliases
};
