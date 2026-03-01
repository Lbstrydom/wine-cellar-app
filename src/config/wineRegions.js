/**
 * @fileoverview Comprehensive wine country and region data.
 * Single source of truth — served to frontend via GET /api/config/wine-regions.
 * @module config/wineRegions
 */

export const COUNTRY_REGIONS = {
  'Argentina': ['Mendoza', 'Uco Valley', 'Salta', 'Cafayate', 'Patagonia', 'Lujan de Cuyo', 'San Juan'],
  'Armenia': ['Areni', 'Aragatsotn', 'Ararat Valley', 'Vayots Dzor'],
  'Australia': ['Barossa Valley', 'McLaren Vale', 'Hunter Valley', 'Yarra Valley', 'Margaret River', 'Coonawarra', 'Clare Valley', 'Eden Valley', 'Adelaide Hills', 'Tasmania', 'Rutherglen'],
  'Austria': ['Wachau', 'Kamptal', 'Kremstal', 'Burgenland', 'Wien', 'Steiermark', 'Thermenregion', 'Neusiedlersee'],
  'Brazil': ['Serra Gaucha', 'Vale dos Vinhedos', 'Campanha'],
  'Bulgaria': ['Thracian Valley', 'Danubian Plain', 'Rose Valley'],
  'Canada': ['Okanagan Valley', 'Niagara Peninsula', 'Prince Edward County', 'Nova Scotia'],
  'Chile': ['Maipo Valley', 'Colchagua Valley', 'Casablanca Valley', 'Aconcagua Valley', 'Maule Valley', 'Rapel Valley', 'Limari Valley', 'Elqui Valley', 'Bio Bio Valley', 'Itata Valley'],
  'China': ['Ningxia', 'Shandong', 'Hebei', 'Xinjiang', 'Yunnan'],
  'Croatia': ['Istria', 'Dalmatia', 'Slavonia', 'Croatian Uplands'],
  'Cyprus': ['Commandaria', 'Troodos Mountains', 'Paphos'],
  'Czech Republic': ['Moravia', 'Bohemia'],
  'England': ['Sussex', 'Kent', 'Hampshire', 'Surrey', 'Essex', 'Cornwall'],
  'France': ['Bordeaux', 'Burgundy', 'Champagne', 'Rhone', 'Loire', 'Alsace', 'Provence', 'Languedoc', 'Roussillon', 'Beaujolais', 'Chablis', 'Sauternes', 'Medoc', 'Pomerol', 'Saint-Emilion', 'Margaux', 'Pauillac', 'Gigondas', 'Bandol', 'Cahors', 'Jura', 'Savoie', 'Corsica', 'Minervois', 'Corbieres', 'Cotes du Rhone', 'Chateauneuf-du-Pape', 'Muscadet', 'Sancerre', 'Vouvray', 'Pouilly-Fume'],
  'Georgia': ['Kakheti', 'Kartli', 'Imereti', 'Racha-Lechkhumi'],
  'Germany': ['Mosel', 'Rheingau', 'Pfalz', 'Baden', 'Rheinhessen', 'Franken', 'Nahe', 'Wurttemberg', 'Ahr', 'Sachsen'],
  'Greece': ['Santorini', 'Nemea', 'Naoussa', 'Crete', 'Macedonia', 'Peloponnese', 'Cephalonia'],
  'Hungary': ['Tokaj', 'Eger', 'Villany', 'Szekszard', 'Somlo', 'Badacsony'],
  'India': ['Nashik', 'Karnataka', 'Nandi Hills'],
  'Israel': ['Galilee', 'Golan Heights', 'Judean Hills', 'Negev', 'Shomron'],
  'Italy': ['Tuscany', 'Piedmont', 'Veneto', 'Sicily', 'Puglia', 'Abruzzo', 'Friuli', 'Alto Adige', 'Lombardy', 'Sardinia', 'Campania', 'Emilia-Romagna', 'Umbria', 'Marche', 'Liguria', 'Chianti', 'Barolo', 'Barbaresco', 'Brunello di Montalcino', 'Valpolicella', 'Amarone', 'Prosecco', 'Soave', 'Franciacorta'],
  'Japan': ['Yamanashi', 'Nagano', 'Hokkaido'],
  'Lebanon': ['Bekaa Valley', 'Batroun', 'Mount Lebanon', 'Chouf'],
  'Mexico': ['Baja California', 'Valle de Guadalupe', 'Queretaro'],
  'Moldova': ['Codru', 'Valul lui Traian', 'Stefan Voda'],
  'Morocco': ['Meknes', 'Guerrouane', 'Beni Mellal'],
  'Netherlands': ['Limburg', 'Gelderland', 'Brabant'],
  'New Zealand': ['Marlborough', 'Hawkes Bay', 'Central Otago', 'Martinborough', 'Waipara', 'Gisborne', 'Nelson', 'Canterbury'],
  'North Macedonia': ['Tikves', 'Povardarie', 'Skopje'],
  'Portugal': ['Douro', 'Dao', 'Alentejo', 'Vinho Verde', 'Bairrada', 'Lisboa', 'Setubal', 'Madeira', 'Azores', 'Tejo'],
  'Romania': ['Dealu Mare', 'Murfatlar', 'Recas', 'Transylvania', 'Moldova'],
  'Serbia': ['Fruska Gora', 'Sumadija', 'Negotin', 'Zupa'],
  'Slovenia': ['Goriska Brda', 'Vipava Valley', 'Podravje', 'Posavje'],
  'South Africa': ['Stellenbosch', 'Franschhoek', 'Paarl', 'Swartland', 'Constantia', 'Elgin', 'Walker Bay', 'Hemel-en-Aarde', 'Western Cape', 'Robertson', 'Darling', 'Tulbagh', 'Olifants River', 'Klein Karoo'],
  'Spain': ['Rioja', 'Ribera del Duero', 'Priorat', 'Rias Baixas', 'Jerez', 'Penedes', 'Rueda', 'Toro', 'Jumilla', 'Navarra', 'Carinena', 'Somontano', 'La Mancha', 'Galicia', 'Monterrei', 'Bierzo'],
  'Switzerland': ['Valais', 'Vaud', 'Geneva', 'Ticino', 'Zurich'],
  'Tunisia': ['Mornag', 'Grombalia'],
  'Turkey': ['Thrace', 'Cappadocia', 'Aegean', 'Eastern Anatolia'],
  'Ukraine': ['Odessa', 'Crimea', 'Transcarpathia'],
  'Uruguay': ['Canelones', 'Maldonado', 'Rivera', 'Colonia'],
  'USA': ['Napa Valley', 'Sonoma', 'Willamette Valley', 'Paso Robles', 'Santa Barbara', 'Central Coast', 'Russian River Valley', 'Alexander Valley', 'Walla Walla', 'Columbia Valley', 'Finger Lakes', 'Long Island', 'Virginia', 'Texas Hill Country', 'Dry Creek Valley', 'Lodi', 'Mendocino', 'Santa Cruz Mountains', 'Temecula Valley', 'Livermore Valley']
};

/**
 * Sorted list of all wine-producing countries.
 * @type {string[]}
 */
export const WINE_COUNTRIES = Object.keys(COUNTRY_REGIONS).sort();

/**
 * Get regions for a specific country.
 * @param {string} country - Country name
 * @returns {string[]} Sorted array of region names (empty if unknown country)
 */
export function getRegionsForCountry(country) {
  return (COUNTRY_REGIONS[country] || []).slice().sort();
}
