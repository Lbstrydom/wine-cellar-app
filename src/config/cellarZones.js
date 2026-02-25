/**
 * @fileoverview Cellar zone definitions for dynamic clustering system.
 * Zones define rules for grouping wines; rows are allocated on demand.
 * @module config/cellarZones
 */

export const CELLAR_ZONES = {
  fridge: {
    slots: ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9'],
    capacity: 9,
    purpose: 'drink_soon',
    description: 'Chilled wines ready to drink within 1-2 weeks'
  },

  zones: [
    // ========== WHITE WINES ==========
    {
      id: 'sauvignon_blanc',
      displayName: 'Sauvignon Blanc',
      preferredRowRange: [1, 2, 3, 4, 5, 6, 7],
      overflowZoneId: 'white_buffer',
      color: 'white',
      rules: {
        grapes: ['sauvignon blanc'],
        keywords: ['fumé blanc', 'pouilly-fumé', 'sancerre']
      },
      sortPreference: ['country', 'producer', 'vintage']
    },
    {
      id: 'chenin_blanc',
      displayName: 'Chenin Blanc',
      preferredRowRange: [1, 2, 3, 4, 5, 6, 7],
      overflowZoneId: 'white_buffer',
      color: 'white',
      rules: {
        grapes: ['chenin blanc'],
        keywords: ['vouvray', 'savennières', 'steen'],
        appellations: ['Vouvray', 'Savennières', 'Anjou']
      },
      sortPreference: ['sweetness', 'country', 'vintage']
    },
    {
      id: 'aromatic_whites',
      displayName: 'Aromatic Whites',
      preferredRowRange: [1, 2, 3, 4, 5, 6, 7],
      overflowZoneId: 'white_buffer',
      color: 'white',
      rules: {
        grapes: ['riesling', 'gewürztraminer', 'gewurztraminer', 'viognier',
                 'torrontés', 'muscat', 'moscato', 'malvasia', 'albariño', 'albarino'],
        keywords: ['aromatic', 'spätlese', 'auslese', 'kabinett']
      },
      sortPreference: ['grape', 'sweetness', 'country']
    },
    {
      id: 'chardonnay',
      displayName: 'Chardonnay',
      preferredRowRange: [1, 2, 3, 4, 5, 6, 7],
      overflowZoneId: 'white_buffer',
      color: 'white',
      rules: {
        grapes: ['chardonnay'],
        keywords: ['white burgundy', 'chablis', 'meursault', 'pouilly-fuissé', 'montrachet']
      },
      sortPreference: ['winemaking', 'country', 'vintage']
    },
    {
      id: 'loire_light',
      displayName: 'Loire & Light',
      preferredRowRange: [1, 2, 3, 4, 5, 6, 7],
      overflowZoneId: 'white_buffer',
      color: 'white',
      rules: {
        grapes: ['melon de bourgogne', 'picpoul', 'vermentino', 'verdejo',
                 'grüner veltliner', 'gruner veltliner', 'assyrtiko'],
        keywords: ['muscadet', 'côtes de gascogne', 'vinho verde', 'picpoul de pinet'],
        regions: ['Loire', 'Gascony', 'Galicia']
      },
      sortPreference: ['region', 'vintage']
    },

    // ========== ROSÉ & SPARKLING ==========
    {
      id: 'rose_sparkling',
      displayName: 'Rosé & Sparkling',
      preferredRowRange: [1, 2, 3, 4, 5, 6, 7],
      overflowZoneId: 'white_buffer',
      color: ['rose', 'sparkling'],
      rules: {
        grapes: [],
        keywords: ['rosé', 'rose', 'rosado', 'sparkling', 'champagne', 'prosecco',
                   'cava', 'crémant', 'cremant', 'spumante', 'sekt', 'méthode traditionnelle'],
        winemaking: ['méthode champenoise', 'charmat', 'pet-nat']
      },
      sortPreference: ['color', 'country', 'vintage']
    },

    // ========== DESSERT & FORTIFIED ==========
    {
      id: 'dessert_fortified',
      displayName: 'Dessert & Fortified',
      preferredRowRange: [1, 2, 3, 4, 5, 6, 7],
      overflowZoneId: 'white_buffer',
      color: ['dessert', 'fortified'],
      rules: {
        grapes: [],
        keywords: ['port', 'porto', 'sherry', 'madeira', 'marsala', 'vin santo',
                   'sauternes', 'tokaji', 'ice wine', 'eiswein', 'late harvest',
                   'noble rot', 'botrytis', 'passito', 'recioto', 'pedro ximénez', 'px'],
        excludeKeywords: ['portugal', 'portuguese'],
        winemaking: ['fortified', 'late harvest', 'noble rot', 'ice wine']
      },
      sortPreference: ['style', 'country', 'vintage']
    },

    // ========== IBERIAN REDS ==========
    {
      id: 'iberian_fresh',
      displayName: 'Iberian Fresh',
      preferredRowRange: [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19],
      overflowZoneId: 'red_buffer',
      color: 'red',
      rules: {
        grapes: ['tempranillo', 'garnacha', 'grenache', 'bobal', 'mencía', 'mencia',
                 'monastrell', 'cariñena'],
        keywords: ['joven', 'tinto joven', 'garnacha'],
        countries: ['Spain'],
        excludeKeywords: ['reserva', 'gran reserva', 'rioja', 'ribera del duero']
      },
      sortPreference: ['region', 'vintage']
    },
    {
      id: 'rioja_ribera',
      displayName: 'Rioja & Ribera',
      preferredRowRange: [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19],
      overflowZoneId: 'red_buffer',
      color: 'red',
      rules: {
        grapes: ['tempranillo', 'tinto fino', 'tinta del país'],
        keywords: ['rioja', 'ribera del duero', 'reserva', 'gran reserva', 'crianza', 'toro'],
        appellations: ['Rioja', 'Ribera del Duero', 'Toro'],
        countries: ['Spain']
      },
      sortPreference: ['appellation', 'classification', 'vintage']
    },
    {
      id: 'portugal',
      displayName: 'Portugal',
      preferredRowRange: [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19],
      overflowZoneId: 'red_buffer',
      color: 'red',
      rules: {
        grapes: ['touriga nacional', 'touriga franca', 'tinta roriz', 'castelão',
                 'baga', 'trincadeira', 'alicante bouschet'],
        keywords: ['douro', 'dão', 'alentejo', 'bairrada'],
        countries: ['Portugal']
      },
      sortPreference: ['region', 'vintage']
    },

    // ========== FRENCH REDS ==========
    {
      id: 'southern_france',
      displayName: 'Southern France',
      preferredRowRange: [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19],
      overflowZoneId: 'red_buffer',
      color: 'red',
      rules: {
        grapes: ['syrah', 'grenache', 'mourvèdre', 'carignan', 'cinsault', 'malbec'],
        keywords: ['côtes du rhône', 'cotes du rhone', 'languedoc', 'roussillon',
                   'cabardes', 'minervois', 'corbières', 'cahors', 'châteauneuf'],
        regions: ['Rhône', 'Languedoc', 'Roussillon', 'Southwest France'],
        countries: ['France'],
        excludeRegions: ['Bordeaux', 'Burgundy', 'Loire']
      },
      sortPreference: ['region', 'vintage']
    },

    // ========== ITALIAN REDS ==========
    {
      id: 'puglia_primitivo',
      displayName: 'Puglia & Primitivo',
      preferredRowRange: [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19],
      overflowZoneId: 'red_buffer',
      color: 'red',
      rules: {
        grapes: ['primitivo', 'negroamaro', 'susumaniello', 'nero di troia', 'malvasia nera'],
        keywords: ['primitivo', 'salice salentino', 'manduria', 'puglia', 'salento'],
        regions: ['Puglia', 'Apulia', 'Salento'],
        countries: ['Italy'],
        excludeWinemaking: ['appassimento']
      },
      sortPreference: ['grape', 'vintage']
    },
    {
      id: 'appassimento',
      displayName: 'Appassimento',
      preferredRowRange: [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19],
      overflowZoneId: 'red_buffer',
      color: 'red',
      priority: 'high',
      rules: {
        winemaking: ['appassimento', 'dried grape', 'raisined'],
        keywords: ['appassimento', 'amarone', 'ripasso', 'recioto', 'passito']
      },
      sortPreference: ['style', 'vintage']
    },
    {
      id: 'piedmont',
      displayName: 'Piedmont',
      preferredRowRange: [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19],
      overflowZoneId: 'red_buffer',
      color: 'red',
      rules: {
        grapes: ['nebbiolo', 'barbera', 'dolcetto'],
        keywords: ['barolo', 'barbaresco', 'langhe', 'roero', 'gattinara', 'ghemme'],
        appellations: ['Barolo', 'Barbaresco', 'Langhe', 'Roero'],
        regions: ['Piedmont', 'Piemonte'],
        countries: ['Italy']
      },
      sortPreference: ['appellation', 'vintage']
    },
    {
      id: 'romagna_tuscany',
      displayName: 'Romagna & Tuscany',
      preferredRowRange: [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19],
      overflowZoneId: 'red_buffer',
      color: 'red',
      rules: {
        grapes: ['sangiovese', 'montepulciano', 'canaiolo', 'colorino'],
        keywords: ['chianti', 'brunello', 'vino nobile', 'morellino', 'rosso di montalcino'],
        appellations: ['Chianti', 'Brunello di Montalcino', 'Vino Nobile di Montepulciano'],
        regions: ['Tuscany', 'Toscana', 'Romagna', 'Emilia-Romagna', 'Umbria'],
        countries: ['Italy']
      },
      sortPreference: ['appellation', 'vintage']
    },

    // ========== NEW WORLD REDS ==========
    {
      id: 'cabernet',
      displayName: 'Cabernet Sauvignon',
      preferredRowRange: [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19],
      overflowZoneId: 'red_buffer',
      color: 'red',
      rules: {
        grapes: ['cabernet sauvignon'],
        keywords: ['cabernet sauvignon'],
        excludeKeywords: ['bordeaux blend', 'meritage', 'cape blend'],
        minGrapePercent: 85
      },
      sortPreference: ['country', 'producer', 'vintage']
    },
    {
      id: 'sa_blends',
      displayName: 'SA Blends',
      preferredRowRange: [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19],
      overflowZoneId: 'red_buffer',
      color: 'red',
      rules: {
        grapes: ['cabernet sauvignon', 'merlot', 'cabernet franc', 'petit verdot',
                 'malbec', 'pinotage'],
        keywords: ['bordeaux blend', 'meritage', 'cape blend', 'red blend'],
        countries: ['South Africa'],
        minGrapes: 2
      },
      sortPreference: ['producer', 'vintage']
    },
    {
      id: 'shiraz',
      displayName: 'Shiraz / Syrah',
      preferredRowRange: [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19],
      overflowZoneId: 'red_buffer',
      color: 'red',
      rules: {
        grapes: ['shiraz', 'syrah'],
        keywords: ['shiraz', 'syrah'],
        excludeKeywords: ['rhône blend', 'gsm', 'côtes du rhône']
      },
      sortPreference: ['country', 'producer', 'vintage']
    },
    {
      id: 'pinot_noir',
      displayName: 'Pinot Noir',
      preferredRowRange: [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19],
      overflowZoneId: 'red_buffer',
      color: 'red',
      rules: {
        grapes: ['pinot noir'],
        keywords: ['pinot noir', 'red burgundy', 'bourgogne rouge', 'spätburgunder']
      },
      sortPreference: ['country', 'region', 'vintage']
    },
    {
      id: 'chile_argentina',
      displayName: 'Chile & Argentina',
      preferredRowRange: [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19],
      overflowZoneId: 'red_buffer',
      color: 'red',
      rules: {
        grapes: ['carmenere', 'carmenère', 'malbec', 'bonarda'],
        keywords: ['maipo', 'colchagua', 'mendoza', 'uco valley'],
        countries: ['Chile', 'Argentina']
      },
      sortPreference: ['country', 'grape', 'vintage']
    },

    // ========== BUFFER & FALLBACK ZONES ==========
    {
      id: 'white_buffer',
      displayName: 'White Reserve',
      isBufferZone: true,
      overflowZoneId: 'unclassified',
      color: ['white', 'rose', 'sparkling', 'dessert', 'fortified'],
      preferredRowRange: [1, 2, 3, 4, 5, 6, 7],
      rules: {}
    },
    {
      id: 'red_buffer',
      displayName: 'Red Reserve',
      isBufferZone: true,
      overflowZoneId: 'unclassified',
      color: ['red'],
      preferredRowRange: [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19],
      rules: {}
    },
    {
      id: 'curiosities',
      displayName: 'Curiosities',
      isCuratedZone: true,
      overflowZoneId: 'unclassified',
      color: null,
      rules: {
        grapes: ['saperavi', 'xinomavro', 'agiorgitiko', 'plavac mali',
                 'blaufränkisch', 'zweigelt', 'kadarka', 'furmint', 'fetească'],
        countries: ['Georgia', 'Greece', 'Croatia', 'Hungary', 'Austria',
                    'Slovenia', 'Bulgaria', 'Romania', 'Lebanon', 'Israel'],
        keywords: ['orange wine', 'skin contact', 'amphora', 'qvevri']
      },
      sortPreference: ['country', 'grape', 'vintage']
    },
    {
      id: 'unclassified',
      displayName: 'Unclassified',
      isFallbackZone: true,
      alertOnPlacement: true,
      overflowZoneId: null,
      color: null,
      rules: {}
    }
  ]
};

/**
 * Zone evaluation order - specific zones first, fallbacks last
 */
export const ZONE_PRIORITY_ORDER = [
  // High priority - winemaking method zones (check first)
  'appassimento',
  'dessert_fortified',

  // Color-first check
  'rose_sparkling',

  // Region-specific (most specific)
  'piedmont',
  'romagna_tuscany',
  'puglia_primitivo',
  'rioja_ribera',
  'portugal',
  'southern_france',
  'chile_argentina',

  // Country + blend
  'sa_blends',

  // Country + young/fresh
  'iberian_fresh',

  // Single grape varieties (less specific)
  'sauvignon_blanc',
  'chenin_blanc',
  'aromatic_whites',
  'chardonnay',
  'loire_light',
  'cabernet',
  'shiraz',
  'pinot_noir',

  // Curated unusual
  'curiosities',

  // Buffer zones
  'white_buffer',
  'red_buffer',

  // True fallback - always last
  'unclassified'
];

/** Buffer zone IDs — exactly one of each allowed per cellar */
export const BUFFER_ZONE_IDS = new Set(['white_buffer', 'red_buffer']);

/**
 * Check if a zone ID is a buffer zone.
 * @param {string} zoneId
 * @returns {boolean}
 */
export function isBufferZoneId(zoneId) {
  return BUFFER_ZONE_IDS.has(zoneId);
}

/**
 * Get a zone by ID
 * @param {string} zoneId
 * @returns {Object|undefined}
 */
export function getZoneById(zoneId) {
  return CELLAR_ZONES.zones.find(z => z.id === zoneId);
}
