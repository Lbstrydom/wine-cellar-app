/**
 * Wine Name Parser
 *
 * Extracts grape variety, region, and style from wine names
 * when structured data is not available.
 */

/**
 * Extract grape, region, style from wine name
 * @param {string} wineName - Full wine name
 * @returns {object} - { grape, region, style, detected_from }
 */
export function parseWineName(wineName) {
  if (!wineName) return {};

  const result = { detected_from: [] };

  // Grape detection patterns
  const grapePatterns = [
    { pattern: /\bsangiovese\b/i, grape: 'sangiovese' },
    { pattern: /\bnebbiolo\b/i, grape: 'nebbiolo' },
    { pattern: /\bprimitivo\b/i, grape: 'primitivo' },
    { pattern: /\bzinfandel\b/i, grape: 'zinfandel' },
    { pattern: /\bcabernet\s*sauvignon\b/i, grape: 'cabernet_sauvignon' },
    { pattern: /\bcabernet\b(?!\s*franc)/i, grape: 'cabernet_sauvignon' }, // Cabernet alone (not Franc)
    { pattern: /\bmerlot\b/i, grape: 'merlot' },
    { pattern: /\bpinot\s*noir\b/i, grape: 'pinot_noir' },
    { pattern: /\bpinot\s*nero\b/i, grape: 'pinot_noir' },
    { pattern: /\bpinot\s*grigio\b/i, grape: 'pinot_grigio' },
    { pattern: /\bpinot\s*gris\b/i, grape: 'pinot_gris' },
    { pattern: /\bchardonnay\b/i, grape: 'chardonnay' },
    { pattern: /\bsauvignon\s*blanc\b/i, grape: 'sauvignon_blanc' },
    { pattern: /\briesling\b/i, grape: 'riesling' },
    { pattern: /\bshiraz\b/i, grape: 'shiraz' },
    { pattern: /\bsyrah\b/i, grape: 'syrah' },
    { pattern: /\bgrenache\b/i, grape: 'grenache' },
    { pattern: /\bgarnacha\b/i, grape: 'garnacha' },
    { pattern: /\btempranillo\b/i, grape: 'tempranillo' },
    { pattern: /\bmalbec\b/i, grape: 'malbec' },
    { pattern: /\bpinotage\b/i, grape: 'pinotage' },
    { pattern: /\bchenin\s*blanc\b/i, grape: 'chenin_blanc' },
    { pattern: /\bviognier\b/i, grape: 'viognier' },
    { pattern: /\bgew[uü]rztraminer\b/i, grape: 'gewurztraminer' },
    { pattern: /\balbarino\b/i, grape: 'albarino' },
    { pattern: /\balba[rñ][iíî][nñ]o\b/i, grape: 'albarino' },
    { pattern: /\bverdejo\b/i, grape: 'verdejo' },
    { pattern: /\bvermentino\b/i, grape: 'vermentino' },
    { pattern: /\btouriga\b/i, grape: 'touriga_nacional' },
    { pattern: /\baglianico\b/i, grape: 'aglianico' },
    { pattern: /\bnero\s*d.?avola\b/i, grape: 'nero_davola' },
    { pattern: /\bcorvina\b/i, grape: 'corvina' },
    { pattern: /\bgr[uü]ner\s*veltliner\b/i, grape: 'gruner_veltliner' },
    { pattern: /\bsemillon\b/i, grape: 'semillon' },
    { pattern: /\bs[eé]millon\b/i, grape: 'semillon' },
    { pattern: /\bcarm[eé]n[eè]re\b/i, grape: 'carmenere' },
    { pattern: /\bcava\b/i, grape: 'cava' },
    { pattern: /\bprosecco\b/i, grape: 'prosecco' }
  ];

  // Region detection patterns (may also set grape for regional specialties)
  const regionPatterns = [
    // Italian
    { pattern: /\bbarolo\b/i, region: 'barolo', grape: 'nebbiolo' },
    { pattern: /\bbarbaresco\b/i, region: 'barbaresco', grape: 'nebbiolo' },
    { pattern: /\bbrunello\b/i, region: 'brunello', grape: 'sangiovese' },
    { pattern: /\bchianti\s*classico\b/i, region: 'chianti_classico', grape: 'sangiovese' },
    { pattern: /\bchianti\b/i, region: 'chianti', grape: 'sangiovese' },
    { pattern: /\bvalpolicella\b/i, region: 'valpolicella', grape: 'corvina' },
    { pattern: /\bamarone\b/i, region: 'amarone', grape: 'corvina' },
    { pattern: /\btaurasi\b/i, region: 'taurasi', grape: 'aglianico' },
    { pattern: /\bmanduria\b/i, region: 'manduria', grape: 'primitivo' },
    { pattern: /\bromagna\b/i, region: 'romagna' },
    { pattern: /\bsicily\b/i, region: 'sicily' },
    { pattern: /\bsicilia\b/i, region: 'sicily' },
    { pattern: /\bfranciacorta\b/i, region: 'franciacorta' },
    { pattern: /\balto\s*adige\b/i, region: 'alto_adige' },
    { pattern: /\bfriuli\b/i, region: 'friuli' },
    { pattern: /\blanghe\b/i, region: 'langhe', grape: 'nebbiolo' },

    // French
    { pattern: /\bbordeaux\b/i, region: 'bordeaux' },
    { pattern: /\bbourgogne\b/i, region: 'burgundy' },
    { pattern: /\bburgund/i, region: 'burgundy' },
    { pattern: /\bchablis\b/i, region: 'chablis', grape: 'chardonnay' },
    { pattern: /\bchampagne\b/i, region: 'champagne' },
    { pattern: /\bsancerre\b/i, region: 'sancerre', grape: 'sauvignon_blanc' },
    { pattern: /\bpouilly[\s-]*fum[eé]\b/i, region: 'pouilly_fume', grape: 'sauvignon_blanc' },
    { pattern: /\bvouvray\b/i, region: 'vouvray', grape: 'chenin_blanc' },
    { pattern: /\bsavenni[eè]res\b/i, region: 'savennieres', grape: 'chenin_blanc' },
    { pattern: /\bch[aâ]teauneuf/i, region: 'chateauneuf' },
    { pattern: /\bhermitage\b/i, region: 'hermitage', grape: 'syrah' },
    { pattern: /\bc[oô]te[\s-]*r[oô]tie\b/i, region: 'cote_rotie', grape: 'syrah' },
    { pattern: /\bcornas\b/i, region: 'cornas', grape: 'syrah' },
    { pattern: /\bcondrieu\b/i, region: 'condrieu', grape: 'viognier' },
    { pattern: /\bprovence\b/i, region: 'provence' },
    { pattern: /\btavel\b/i, region: 'tavel' },
    { pattern: /\bsauternes\b/i, region: 'sauternes' },
    { pattern: /\bbarsac\b/i, region: 'barsac' },
    { pattern: /\balsace\b/i, region: 'alsace' },
    { pattern: /\bloire\b/i, region: 'loire' },
    { pattern: /\bpomerol\b/i, region: 'pomerol', grape: 'merlot' },
    { pattern: /\bsaint[\s-]*[eé]milion\b/i, region: 'saint_emilion', grape: 'merlot' },
    { pattern: /\brh[oô]ne\b/i, region: 'rhone' },

    // Spanish
    { pattern: /\brioja\b/i, region: 'rioja', grape: 'tempranillo' },
    { pattern: /\bribera\s*del\s*duero\b/i, region: 'ribera_del_duero', grape: 'tempranillo' },
    { pattern: /\bpriorat\b/i, region: 'priorat' },
    { pattern: /\bcari[nñ]ena\b/i, region: 'carinena' },
    { pattern: /\br[ií]as\s*baixas\b/i, region: 'rias_baixas', grape: 'albarino' },
    { pattern: /\brueda\b/i, region: 'rueda', grape: 'verdejo' },
    { pattern: /\btoro\b/i, region: 'toro', grape: 'tempranillo' },
    { pattern: /\bnavarra\b/i, region: 'navarra' },
    { pattern: /\bjerez\b/i, region: 'sherry' },
    { pattern: /\bsherry\b/i, region: 'sherry' },

    // Portuguese
    { pattern: /\bdouro\b/i, region: 'douro' },
    { pattern: /\bd[aã]o\b/i, region: 'dao' },
    { pattern: /\bport\b/i, region: 'port' },
    { pattern: /\bporto\b/i, region: 'port' },
    { pattern: /\bmadeira\b/i, region: 'madeira' },
    { pattern: /\bvin\s*santo\b/i, region: 'vin_santo' },

    // German/Austrian
    { pattern: /\bmosel\b/i, region: 'mosel', grape: 'riesling' },
    { pattern: /\brheingau\b/i, region: 'rheingau', grape: 'riesling' },
    { pattern: /\bwachau\b/i, region: 'wachau' },
    { pattern: /\bpfalz\b/i, region: 'pfalz' },

    // Australian
    { pattern: /\bbarossa\b/i, region: 'barossa' },
    { pattern: /\bmclaren\s*vale\b/i, region: 'mclaren_vale' },
    { pattern: /\bhunter\s*valley\b/i, region: 'hunter_valley' },
    { pattern: /\bclare\s*valley\b/i, region: 'clare_valley', grape: 'riesling' },
    { pattern: /\beden\s*valley\b/i, region: 'eden_valley', grape: 'riesling' },
    { pattern: /\bmargaret\s*river\b/i, region: 'margaret_river' },
    { pattern: /\bcoonawarra\b/i, region: 'coonawarra', grape: 'cabernet_sauvignon' },

    // New Zealand
    { pattern: /\bmarlborough\b/i, region: 'marlborough' },
    { pattern: /\bcentral\s*otago\b/i, region: 'central_otago', grape: 'pinot_noir' },
    { pattern: /\bhawke'?s?\s*bay\b/i, region: 'hawkes_bay' },

    // South African
    { pattern: /\bstellenbosch\b/i, region: 'stellenbosch' },
    { pattern: /\bconstantia\b/i, region: 'constantia' },
    { pattern: /\bswartland\b/i, region: 'swartland' },
    { pattern: /\bfranschhoek\b/i, region: 'franschhoek' },

    // American
    { pattern: /\bnapa\b/i, region: 'napa' },
    { pattern: /\bsonoma\b/i, region: 'sonoma' },
    { pattern: /\boregon\b/i, region: 'oregon' },
    { pattern: /\bwillamette\b/i, region: 'oregon', grape: 'pinot_noir' },
    { pattern: /\bpaso\s*robles\b/i, region: 'paso_robles' },
    { pattern: /\bsanta\s*barbara\b/i, region: 'santa_barbara' },

    // Argentine
    { pattern: /\bmendoza\b/i, region: 'mendoza' },
    { pattern: /\buco\s*valley\b/i, region: 'uco_valley' },

    // Chilean
    { pattern: /\bmaipo\b/i, region: 'chile' },
    { pattern: /\bcolchagua\b/i, region: 'chile' },
    { pattern: /\bcasablanca\b/i, region: 'casablanca' },

    // Hungarian
    { pattern: /\btokaji?\b/i, region: 'tokaji' }
  ];

  // Style detection patterns
  const stylePatterns = [
    { pattern: /\briserva\b/i, style: 'riserva' },
    { pattern: /\breserva\b/i, style: 'reserva' },
    { pattern: /\bgran\s*reserva\b/i, style: 'gran_reserva' },
    { pattern: /\bcrianza\b/i, style: 'crianza' },
    { pattern: /\bjoven\b/i, style: 'joven' },
    { pattern: /\bripasso\b/i, style: 'ripasso' },
    { pattern: /\bsuperiore\b/i, style: 'superiore' },
    { pattern: /\bappassimento\b/i, style: 'appassimento' },
    { pattern: /\bpassito\b/i, style: 'appassimento' },
    { pattern: /\bgrand\s*cru\b/i, style: 'grand_cru' },
    { pattern: /\bpremier\s*cru\b/i, style: 'premier_cru' },
    { pattern: /\b1er\s*cru\b/i, style: 'premier_cru' },
    { pattern: /\bgran\s*selezione\b/i, style: 'gran_selezione' },
    { pattern: /\bsmaragd\b/i, style: 'smaragd' },
    { pattern: /\bfederspiel\b/i, style: 'federspiel' },
    { pattern: /\bsteinfeder\b/i, style: 'steinfeder' },
    { pattern: /\bkabinett\b/i, style: 'kabinett' },
    { pattern: /\bsp[aä]tlese\b/i, style: 'spatlese' },
    { pattern: /\bauslese\b/i, style: 'auslese' },
    { pattern: /\btrockenbeerenauslese\b/i, style: 'trockenbeerenauslese' },
    { pattern: /\btba\b/i, style: 'trockenbeerenauslese' },
    { pattern: /\beisw[ie][ie]n\b/i, style: 'eiswein' },
    { pattern: /\bice\s*wine\b/i, style: 'icewine' },
    { pattern: /\blate\s*harvest\b/i, style: 'late_harvest' },
    { pattern: /\bvendange\s*tardive\b/i, style: 'vendange_tardive' },
    { pattern: /\bmoelleux\b/i, style: 'moelleux' },
    { pattern: /\bsec\b/i, style: 'sec' },
    { pattern: /\bbrut\b/i, style: 'brut' },
    { pattern: /\bvintage\b/i, style: 'vintage' },
    { pattern: /\baszu\b/i, style: 'aszu' },
    { pattern: /\basz[uú]\b/i, style: 'aszu' },
    { pattern: /\blbv\b/i, style: 'lbv' },
    { pattern: /\blate\s*bottled\s*vintage\b/i, style: 'lbv' },
    { pattern: /\btawny\b/i, style: 'tawny_aged' },
    { pattern: /\bruby\b/i, style: 'ruby' },
    { pattern: /\bfino\b/i, style: 'fino' },
    { pattern: /\bmanzanilla\b/i, style: 'fino' },
    { pattern: /\bamontillado\b/i, style: 'amontillado' },
    { pattern: /\boloroso\b/i, style: 'oloroso' },
    { pattern: /\bpedro\s*xim[eé]nez\b/i, style: 'px' },
    { pattern: /\bpx\b/i, style: 'px' }
  ];

  // Match grapes
  for (const { pattern, grape } of grapePatterns) {
    if (pattern.test(wineName)) {
      result.grape = grape;
      result.detected_from.push('grape_in_name');
      break;
    }
  }

  // Match regions (may also set grape)
  for (const { pattern, region, grape } of regionPatterns) {
    if (pattern.test(wineName)) {
      result.region = region;
      result.detected_from.push('region_in_name');
      if (grape && !result.grape) {
        result.grape = grape;
        result.detected_from.push('grape_from_region');
      }
      break;
    }
  }

  // Match styles
  for (const { pattern, style } of stylePatterns) {
    if (pattern.test(wineName)) {
      result.style = style;
      result.detected_from.push('style_in_name');
      break;
    }
  }

  return result;
}
