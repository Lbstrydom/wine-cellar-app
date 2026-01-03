# Wine Serving Temperature Database

Comprehensive reference table for optimal wine serving temperatures, compiled from sommelier guides, wine publications, and producer recommendations.

---

## Quick Reference Summary

| Category | Temperature Range (°C) | Temperature Range (°F) |
|----------|----------------------|----------------------|
| Sparkling (standard) | 5-8 | 41-46 |
| Sparkling (vintage/prestige) | 8-10 | 46-50 |
| Light white wines | 7-10 | 45-50 |
| Full-bodied white wines | 10-13 | 50-55 |
| Rosé wines | 8-12 | 46-54 |
| Orange/skin-contact wines | 10-16 | 50-61 |
| Light red wines | 12-15 | 54-59 |
| Medium-bodied red wines | 14-17 | 57-63 |
| Full-bodied red wines | 16-19 | 61-66 |
| Dessert wines | 6-14 | 43-57 |
| Fortified wines (light) | 7-12 | 45-54 |
| Fortified wines (rich) | 14-18 | 57-64 |

---

## SQL Schema

```sql
CREATE TABLE wine_serving_temperatures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wine_type TEXT NOT NULL,
  category TEXT NOT NULL,
  subcategory TEXT,
  grape_varieties TEXT,
  regions TEXT,
  body TEXT,
  temp_min_celsius INTEGER NOT NULL,
  temp_max_celsius INTEGER NOT NULL,
  temp_min_fahrenheit INTEGER NOT NULL,
  temp_max_fahrenheit INTEGER NOT NULL,
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_wine_type ON wine_serving_temperatures(wine_type);
CREATE INDEX idx_category ON wine_serving_temperatures(category);
CREATE INDEX idx_grape_varieties ON wine_serving_temperatures(grape_varieties);
```

---

## Complete Data Insert Script

```sql
-- =============================================
-- SPARKLING WINES
-- =============================================

INSERT INTO wine_serving_temperatures (wine_type, category, subcategory, grape_varieties, regions, body, temp_min_celsius, temp_max_celsius, temp_min_fahrenheit, temp_max_fahrenheit, notes) VALUES
('Prosecco', 'sparkling', 'charmat_method', 'Glera', 'Veneto, Italy', 'light', 5, 7, 41, 45, 'Serve very cold to preserve bubbles and fresh fruit character'),
('Cava', 'sparkling', 'traditional_method', 'Macabeo, Parellada, Xarel-lo', 'Catalonia, Spain', 'light-medium', 6, 8, 43, 46, 'Slightly warmer than Prosecco for traditional method complexity'),
('Crémant', 'sparkling', 'traditional_method', 'Various', 'France (Alsace, Loire, Burgundy)', 'light-medium', 6, 8, 43, 46, 'Traditional method sparkling, similar to Champagne service'),
('Champagne (NV)', 'sparkling', 'traditional_method', 'Chardonnay, Pinot Noir, Pinot Meunier', 'Champagne, France', 'medium', 6, 8, 43, 46, 'Non-vintage Champagne served cold to highlight freshness'),
('Champagne (Vintage)', 'sparkling', 'traditional_method', 'Chardonnay, Pinot Noir, Pinot Meunier', 'Champagne, France', 'medium-full', 8, 10, 46, 50, 'Vintage Champagne served slightly warmer to reveal complexity'),
('Champagne (Prestige Cuvée)', 'sparkling', 'traditional_method', 'Chardonnay, Pinot Noir, Pinot Meunier', 'Champagne, France', 'full', 10, 12, 50, 54, 'Dom Pérignon, Krug etc. - warmer to express toast and biscuit notes'),
('Blanc de Blancs', 'sparkling', 'traditional_method', 'Chardonnay', 'Champagne, France', 'light-medium', 7, 9, 45, 48, '100% Chardonnay, served slightly cooler for acidity'),
('Blanc de Noirs', 'sparkling', 'traditional_method', 'Pinot Noir, Pinot Meunier', 'Champagne, France', 'medium', 8, 10, 46, 50, 'Fuller body from red grapes, slightly warmer service'),
('Franciacorta', 'sparkling', 'traditional_method', 'Chardonnay, Pinot Noir, Pinot Bianco', 'Lombardy, Italy', 'medium', 6, 8, 43, 46, 'Italian traditional method, similar to Champagne'),
('Sekt', 'sparkling', 'various', 'Riesling, Pinot Blanc, Pinot Noir', 'Germany, Austria', 'light-medium', 6, 8, 43, 46, 'German/Austrian sparkling wine'),
('Pét-Nat', 'sparkling', 'ancestral_method', 'Various', 'Various', 'light', 6, 9, 43, 48, 'Natural sparkling, serve cold but not ice cold'),
('Asti/Moscato d''Asti', 'sparkling', 'charmat_method', 'Moscato Bianco', 'Piedmont, Italy', 'light', 5, 7, 41, 45, 'Sweet sparkling, serve very cold'),
('Lambrusco', 'sparkling', 'charmat_method', 'Lambrusco varieties', 'Emilia-Romagna, Italy', 'light-medium', 8, 12, 46, 54, 'Red sparkling, can be served slightly warmer');

-- =============================================
-- WHITE WINES - LIGHT BODIED
-- =============================================

INSERT INTO wine_serving_temperatures (wine_type, category, subcategory, grape_varieties, regions, body, temp_min_celsius, temp_max_celsius, temp_min_fahrenheit, temp_max_fahrenheit, notes) VALUES
('Sauvignon Blanc', 'white', 'light_crisp', 'Sauvignon Blanc', 'Loire, New Zealand, South Africa', 'light', 7, 10, 45, 50, 'Serve cold to preserve acidity and citrus/herbaceous notes'),
('Sancerre', 'white', 'light_crisp', 'Sauvignon Blanc', 'Loire, France', 'light-medium', 8, 10, 46, 50, 'Top Loire Sauvignon, slightly warmer for minerality'),
('Pouilly-Fumé', 'white', 'light_crisp', 'Sauvignon Blanc', 'Loire, France', 'light-medium', 8, 10, 46, 50, 'Smoky Sauvignon, similar to Sancerre'),
('Marlborough Sauvignon Blanc', 'white', 'light_crisp', 'Sauvignon Blanc', 'Marlborough, New Zealand', 'light', 7, 9, 45, 48, 'Very aromatic, serve cold to preserve tropical fruit'),
('Pinot Grigio', 'white', 'light_crisp', 'Pinot Grigio', 'Northern Italy, Alsace', 'light', 7, 9, 45, 48, 'Light and refreshing, serve cold'),
('Muscadet', 'white', 'light_crisp', 'Melon de Bourgogne', 'Loire, France', 'light', 7, 9, 45, 48, 'Bone dry, serve cold with shellfish'),
('Vinho Verde', 'white', 'light_crisp', 'Alvarinho, Loureiro, Arinto', 'Minho, Portugal', 'light', 6, 8, 43, 46, 'Often slightly sparkling, serve very cold'),
('Albariño', 'white', 'light_crisp', 'Albariño', 'Rías Baixas, Spain', 'light-medium', 7, 10, 45, 50, 'Aromatic Spanish white, cold service'),
('Picpoul de Pinet', 'white', 'light_crisp', 'Picpoul', 'Languedoc, France', 'light', 7, 9, 45, 48, 'Crisp Mediterranean white'),
('Vermentino', 'white', 'light_crisp', 'Vermentino', 'Sardinia, Liguria, Provence', 'light', 7, 10, 45, 50, 'Herbal and saline notes'),
('Verdejo', 'white', 'light_crisp', 'Verdejo', 'Rueda, Spain', 'light', 7, 9, 45, 48, 'Spanish alternative to Sauvignon Blanc'),
('Grüner Veltliner', 'white', 'light_crisp', 'Grüner Veltliner', 'Austria', 'light-medium', 8, 10, 46, 50, 'Peppery Austrian white'),
('Assyrtiko', 'white', 'light_crisp', 'Assyrtiko', 'Santorini, Greece', 'light-medium', 8, 10, 46, 50, 'High acid Greek white, volcanic minerality');

-- =============================================
-- WHITE WINES - AROMATIC
-- =============================================

INSERT INTO wine_serving_temperatures (wine_type, category, subcategory, grape_varieties, regions, body, temp_min_celsius, temp_max_celsius, temp_min_fahrenheit, temp_max_fahrenheit, notes) VALUES
('Riesling (Dry)', 'white', 'aromatic', 'Riesling', 'Germany, Alsace, Austria', 'light-medium', 8, 10, 46, 50, 'Trocken/dry Riesling, cold to highlight acidity'),
('Riesling (Off-Dry)', 'white', 'aromatic', 'Riesling', 'Germany (Kabinett, Spätlese)', 'light-medium', 6, 8, 43, 46, 'Slightly sweet, serve colder to balance sweetness'),
('Gewürztraminer', 'white', 'aromatic', 'Gewürztraminer', 'Alsace, Germany, Alto Adige', 'medium', 8, 11, 46, 52, 'Highly aromatic, not too cold to express lychee/rose'),
('Torrontés', 'white', 'aromatic', 'Torrontés', 'Argentina', 'light-medium', 7, 10, 45, 50, 'Floral Argentine white'),
('Muscat (Dry)', 'white', 'aromatic', 'Muscat varieties', 'Alsace, Australia', 'light', 7, 9, 45, 48, 'Grapey and floral, serve cold'),
('Viognier', 'white', 'aromatic', 'Viognier', 'Rhône, California, Australia', 'medium-full', 10, 13, 50, 55, 'Rich and aromatic, warmer to express apricot/peach'),
('Malvasia', 'white', 'aromatic', 'Malvasia varieties', 'Italy, Portugal, Spain', 'medium', 9, 12, 48, 54, 'Aromatic Mediterranean grape');

-- =============================================
-- WHITE WINES - FULL BODIED
-- =============================================

INSERT INTO wine_serving_temperatures (wine_type, category, subcategory, grape_varieties, regions, body, temp_min_celsius, temp_max_celsius, temp_min_fahrenheit, temp_max_fahrenheit, notes) VALUES
('Chardonnay (Unoaked)', 'white', 'full_bodied', 'Chardonnay', 'Chablis, Mâcon, Australia', 'medium', 9, 11, 48, 52, 'Unoaked style, cooler to preserve freshness'),
('Chardonnay (Oaked)', 'white', 'full_bodied', 'Chardonnay', 'Burgundy, California, Australia', 'full', 11, 14, 52, 57, 'Barrel-aged Chardonnay, warmer to express oak and butter'),
('White Burgundy (Village)', 'white', 'full_bodied', 'Chardonnay', 'Burgundy, France', 'medium-full', 10, 12, 50, 54, 'Village level Burgundy'),
('White Burgundy (Premier/Grand Cru)', 'white', 'full_bodied', 'Chardonnay', 'Burgundy, France', 'full', 12, 14, 54, 57, 'Top Burgundy whites need warmth for complexity'),
('Meursault', 'white', 'full_bodied', 'Chardonnay', 'Burgundy, France', 'full', 12, 14, 54, 57, 'Rich and nutty, serve at higher end'),
('Montrachet', 'white', 'full_bodied', 'Chardonnay', 'Burgundy, France', 'full', 12, 14, 54, 57, 'Grand Cru, maximum complexity at warmer temps'),
('Pouilly-Fuissé', 'white', 'full_bodied', 'Chardonnay', 'Burgundy, France', 'medium-full', 10, 13, 50, 55, 'Southern Burgundy Chardonnay'),
('Châteauneuf-du-Pape Blanc', 'white', 'full_bodied', 'Roussanne, Grenache Blanc', 'Rhône, France', 'full', 11, 13, 52, 55, 'Rich southern Rhône white'),
('White Rioja', 'white', 'full_bodied', 'Viura, Malvasía', 'Rioja, Spain', 'medium-full', 10, 13, 50, 55, 'Oaked style served warmer'),
('Chenin Blanc (Dry)', 'white', 'full_bodied', 'Chenin Blanc', 'Loire, South Africa', 'medium', 9, 12, 48, 54, 'Dry style Chenin'),
('Chenin Blanc (Oaked)', 'white', 'full_bodied', 'Chenin Blanc', 'South Africa', 'full', 11, 14, 52, 57, 'Barrel-fermented SA Chenin'),
('Semillon', 'white', 'full_bodied', 'Semillon', 'Hunter Valley, Bordeaux', 'medium-full', 10, 13, 50, 55, 'Ages beautifully, serve warmer when mature'),
('Fiano', 'white', 'full_bodied', 'Fiano', 'Campania, Italy', 'medium', 9, 12, 48, 54, 'Italian white with texture'),
('Greco di Tufo', 'white', 'full_bodied', 'Greco', 'Campania, Italy', 'medium', 9, 12, 48, 54, 'Mineral southern Italian white'),
('Arinto', 'white', 'full_bodied', 'Arinto', 'Portugal', 'medium', 9, 11, 48, 52, 'Crisp Portuguese white, ages well');

-- =============================================
-- ROSÉ WINES
-- =============================================

INSERT INTO wine_serving_temperatures (wine_type, category, subcategory, grape_varieties, regions, body, temp_min_celsius, temp_max_celsius, temp_min_fahrenheit, temp_max_fahrenheit, notes) VALUES
('Provence Rosé', 'rosé', 'pale_dry', 'Grenache, Cinsault, Syrah', 'Provence, France', 'light', 8, 10, 46, 50, 'Pale and delicate, serve cold'),
('Côtes de Provence', 'rosé', 'pale_dry', 'Grenache, Cinsault, Syrah, Mourvèdre', 'Provence, France', 'light', 8, 10, 46, 50, 'Classic Provençal rosé'),
('Tavel', 'rosé', 'full_bodied', 'Grenache, Cinsault, Mourvèdre', 'Rhône, France', 'medium-full', 10, 13, 50, 55, 'Full-bodied rosé, can be served warmer'),
('Spanish Rosado', 'rosé', 'medium', 'Garnacha, Tempranillo', 'Spain', 'medium', 9, 12, 48, 54, 'Darker Spanish rosé'),
('Cerasuolo d''Abruzzo', 'rosé', 'full_bodied', 'Montepulciano', 'Abruzzo, Italy', 'medium-full', 10, 13, 50, 55, 'Structured Italian rosé, warmer service'),
('Bandol Rosé', 'rosé', 'medium', 'Mourvèdre, Grenache, Cinsault', 'Provence, France', 'medium', 9, 12, 48, 54, 'More structured Provence rosé'),
('White Zinfandel', 'rosé', 'sweet', 'Zinfandel', 'California', 'light', 7, 9, 45, 48, 'Sweet rosé, serve cold to balance sugar'),
('Rosé Champagne', 'rosé', 'sparkling', 'Pinot Noir, Chardonnay, Pinot Meunier', 'Champagne, France', 'medium', 7, 9, 45, 48, 'Pink Champagne, serve cold');

-- =============================================
-- ORANGE / SKIN-CONTACT WINES
-- =============================================

INSERT INTO wine_serving_temperatures (wine_type, category, subcategory, grape_varieties, regions, body, temp_min_celsius, temp_max_celsius, temp_min_fahrenheit, temp_max_fahrenheit, notes) VALUES
('Orange Wine (Light)', 'orange', 'short_maceration', 'Various white grapes', 'Various', 'light-medium', 10, 12, 50, 54, 'Short skin contact (3-7 days), serve cooler'),
('Orange Wine (Medium)', 'orange', 'medium_maceration', 'Various white grapes', 'Italy, Slovenia, Georgia', 'medium', 12, 14, 54, 57, 'Medium skin contact (1-3 weeks)'),
('Orange Wine (Full/Tannic)', 'orange', 'long_maceration', 'Ribolla Gialla, Rkatsiteli', 'Friuli, Georgia', 'full', 14, 18, 57, 64, 'Extended maceration, treat like light red'),
('Georgian Amber Wine', 'orange', 'qvevri', 'Rkatsiteli, Mtsvane, Kisi', 'Georgia', 'medium-full', 12, 16, 54, 61, 'Traditional qvevri wines, warmer service'),
('Ramato (Pinot Grigio)', 'orange', 'skin_contact', 'Pinot Grigio', 'Friuli, Italy', 'light-medium', 10, 13, 50, 55, 'Copper-colored Pinot Grigio'),
('Ribolla Gialla (Skin Contact)', 'orange', 'long_maceration', 'Ribolla Gialla', 'Friuli, Italy', 'medium-full', 13, 16, 55, 61, 'Gravner/Radikon style, serve like light red');

-- =============================================
-- RED WINES - LIGHT BODIED
-- =============================================

INSERT INTO wine_serving_temperatures (wine_type, category, subcategory, grape_varieties, regions, body, temp_min_celsius, temp_max_celsius, temp_min_fahrenheit, temp_max_fahrenheit, notes) VALUES
('Beaujolais', 'red', 'light_fruity', 'Gamay', 'Beaujolais, France', 'light', 12, 14, 54, 57, 'Light, fruity red, can be slightly chilled'),
('Beaujolais Nouveau', 'red', 'light_fruity', 'Gamay', 'Beaujolais, France', 'light', 10, 13, 50, 55, 'Very young wine, serve cool'),
('Beaujolais Cru', 'red', 'light_fruity', 'Gamay', 'Morgon, Fleurie, Moulin-à-Vent', 'light-medium', 13, 15, 55, 59, 'More structured Beaujolais, slightly warmer'),
('Valpolicella (Classico)', 'red', 'light_fruity', 'Corvina, Rondinella, Molinara', 'Veneto, Italy', 'light', 12, 14, 54, 57, 'Fresh, cherry-driven, serve cool'),
('Bardolino', 'red', 'light_fruity', 'Corvina, Rondinella, Molinara', 'Veneto, Italy', 'light', 12, 14, 54, 57, 'Light Lake Garda red'),
('Dolcetto', 'red', 'light_fruity', 'Dolcetto', 'Piedmont, Italy', 'light-medium', 13, 15, 55, 59, 'Soft tannins, fruity, serve cool'),
('Schiava', 'red', 'light_fruity', 'Schiava', 'Alto Adige, Italy', 'light', 12, 14, 54, 57, 'Very light, almost rosé-like'),
('Zweigelt', 'red', 'light_fruity', 'Zweigelt', 'Austria', 'light-medium', 13, 15, 55, 59, 'Austrian red, cherry and spice'),
('Frappato', 'red', 'light_fruity', 'Frappato', 'Sicily, Italy', 'light', 12, 14, 54, 57, 'Light Sicilian red, serve cool'),
('Mencía', 'red', 'light_fruity', 'Mencía', 'Bierzo, Spain', 'light-medium', 13, 15, 55, 59, 'Spanish light red, floral notes'),
('Cinsault', 'red', 'light_fruity', 'Cinsault', 'South Africa, France', 'light', 12, 14, 54, 57, 'Light, refreshing red'),
('Tempranillo Joven', 'red', 'light_fruity', 'Tempranillo', 'Spain', 'light-medium', 12, 14, 54, 57, 'Young unoaked Tempranillo, serve cool'),
('Garnacha Joven', 'red', 'light_fruity', 'Garnacha', 'Spain', 'light-medium', 12, 14, 54, 57, 'Young Grenache, serve cool');

-- =============================================
-- RED WINES - MEDIUM BODIED
-- =============================================

INSERT INTO wine_serving_temperatures (wine_type, category, subcategory, grape_varieties, regions, body, temp_min_celsius, temp_max_celsius, temp_min_fahrenheit, temp_max_fahrenheit, notes) VALUES
('Pinot Noir (Burgundy)', 'red', 'medium_elegant', 'Pinot Noir', 'Burgundy, France', 'medium', 14, 17, 57, 63, 'Red Burgundy, serve slightly cool to preserve elegance'),
('Pinot Noir (New World)', 'red', 'medium_elegant', 'Pinot Noir', 'California, Oregon, New Zealand', 'medium', 14, 16, 57, 61, 'Riper style Pinot, slightly cooler than Burgundy'),
('Red Burgundy (Village)', 'red', 'medium_elegant', 'Pinot Noir', 'Burgundy, France', 'medium', 14, 16, 57, 61, 'Village level Burgundy'),
('Red Burgundy (Premier/Grand Cru)', 'red', 'medium_elegant', 'Pinot Noir', 'Burgundy, France', 'medium-full', 15, 17, 59, 63, 'Top Burgundy needs warmth for complexity'),
('Chianti', 'red', 'medium_structured', 'Sangiovese', 'Tuscany, Italy', 'medium', 14, 16, 57, 61, 'Classic Tuscan red'),
('Chianti Classico', 'red', 'medium_structured', 'Sangiovese', 'Tuscany, Italy', 'medium', 14, 16, 57, 61, 'Higher quality Chianti'),
('Chianti Classico Riserva', 'red', 'medium_structured', 'Sangiovese', 'Tuscany, Italy', 'medium-full', 16, 18, 61, 64, 'Aged Chianti, warmer service'),
('Rosso di Montalcino', 'red', 'medium_structured', 'Sangiovese Grosso', 'Tuscany, Italy', 'medium', 14, 16, 57, 61, 'Baby Brunello'),
('Vino Nobile di Montepulciano', 'red', 'medium_structured', 'Sangiovese', 'Tuscany, Italy', 'medium-full', 15, 17, 59, 63, 'Noble Tuscan wine'),
('Morellino di Scansano', 'red', 'medium_structured', 'Sangiovese', 'Tuscany, Italy', 'medium', 14, 16, 57, 61, 'Coastal Tuscan Sangiovese'),
('Sangiovese di Romagna', 'red', 'medium_structured', 'Sangiovese', 'Emilia-Romagna, Italy', 'medium', 14, 16, 57, 61, 'Romagna-style Sangiovese'),
('Barbera', 'red', 'medium_structured', 'Barbera', 'Piedmont, Italy', 'medium', 14, 16, 57, 61, 'High acid Piedmont red'),
('Barbera d''Asti', 'red', 'medium_structured', 'Barbera', 'Piedmont, Italy', 'medium', 14, 16, 57, 61, 'From Asti zone'),
('Barbera d''Alba', 'red', 'medium_structured', 'Barbera', 'Piedmont, Italy', 'medium-full', 15, 17, 59, 63, 'Often more structured than Asti'),
('Côtes du Rhône', 'red', 'medium_structured', 'Grenache, Syrah, Mourvèdre', 'Rhône, France', 'medium', 14, 17, 57, 63, 'Southern Rhône blend'),
('Rioja Crianza', 'red', 'medium_structured', 'Tempranillo', 'Rioja, Spain', 'medium', 14, 17, 57, 63, 'Young oaked Rioja'),
('Rioja Reserva', 'red', 'medium_structured', 'Tempranillo', 'Rioja, Spain', 'medium-full', 16, 18, 61, 64, 'Aged Rioja needs warmth'),
('Rioja Gran Reserva', 'red', 'full_bodied', 'Tempranillo', 'Rioja, Spain', 'full', 17, 18, 63, 64, 'Long-aged Rioja, warmer service'),
('Merlot', 'red', 'medium_structured', 'Merlot', 'Bordeaux, California, Chile', 'medium', 14, 17, 57, 63, 'Soft and approachable'),
('Zinfandel (Red)', 'red', 'medium_structured', 'Zinfandel', 'California', 'medium-full', 16, 18, 61, 64, 'Fruit-forward, can handle warmth'),
('Grenache/Garnacha', 'red', 'medium_structured', 'Grenache', 'Spain, Rhône, Australia', 'medium', 14, 17, 57, 63, 'Spicy and fruity'),
('Nero d''Avola', 'red', 'medium_structured', 'Nero d''Avola', 'Sicily, Italy', 'medium-full', 15, 17, 59, 63, 'Sicilian flagship red'),
('Montepulciano d''Abruzzo', 'red', 'medium_structured', 'Montepulciano', 'Abruzzo, Italy', 'medium', 14, 16, 57, 61, 'Soft central Italian red'),
('Carmenère', 'red', 'medium_structured', 'Carmenère', 'Chile', 'medium', 15, 17, 59, 63, 'Chilean signature red'),
('Portuguese Red (Light)', 'red', 'medium_structured', 'Various Portuguese grapes', 'Dão, Bairrada', 'medium', 14, 16, 57, 61, 'Lighter Portuguese styles'),
('Pinotage', 'red', 'medium_structured', 'Pinotage', 'South Africa', 'medium-full', 15, 17, 59, 63, 'SA signature grape'),
('Bobal', 'red', 'medium_structured', 'Bobal', 'Valencia, Spain', 'medium', 14, 16, 57, 61, 'Spanish native variety');

-- =============================================
-- RED WINES - FULL BODIED
-- =============================================

INSERT INTO wine_serving_temperatures (wine_type, category, subcategory, grape_varieties, regions, body, temp_min_celsius, temp_max_celsius, temp_min_fahrenheit, temp_max_fahrenheit, notes) VALUES
('Cabernet Sauvignon', 'red', 'full_tannic', 'Cabernet Sauvignon', 'Bordeaux, Napa, Australia', 'full', 16, 18, 61, 64, 'Classic full-bodied red, serve just below room temp'),
('Bordeaux (Left Bank)', 'red', 'full_tannic', 'Cabernet Sauvignon, Merlot', 'Médoc, Graves, Pauillac', 'full', 17, 18, 63, 64, 'Cab-dominant Bordeaux'),
('Bordeaux (Right Bank)', 'red', 'full_tannic', 'Merlot, Cabernet Franc', 'Saint-Émilion, Pomerol', 'full', 16, 18, 61, 64, 'Merlot-dominant, slightly softer'),
('Napa Valley Cabernet', 'red', 'full_tannic', 'Cabernet Sauvignon', 'Napa Valley, California', 'full', 16, 18, 61, 64, 'Rich New World Cabernet'),
('Barolo', 'red', 'full_tannic', 'Nebbiolo', 'Piedmont, Italy', 'full', 16, 18, 61, 64, 'King of wines, needs warmth for aromatics'),
('Barolo Riserva', 'red', 'full_tannic', 'Nebbiolo', 'Piedmont, Italy', 'full', 17, 19, 63, 66, 'Long-aged Barolo, higher temp'),
('Barbaresco', 'red', 'full_tannic', 'Nebbiolo', 'Piedmont, Italy', 'full', 16, 18, 61, 64, 'Slightly more elegant than Barolo'),
('Brunello di Montalcino', 'red', 'full_tannic', 'Sangiovese Grosso', 'Tuscany, Italy', 'full', 16, 18, 61, 64, 'Top Tuscan Sangiovese'),
('Brunello di Montalcino Riserva', 'red', 'full_tannic', 'Sangiovese Grosso', 'Tuscany, Italy', 'full', 17, 19, 63, 66, 'Extended aging, warmer'),
('Super Tuscan', 'red', 'full_tannic', 'Sangiovese, Cabernet, Merlot', 'Tuscany, Italy', 'full', 16, 18, 61, 64, 'International-style Tuscan blends'),
('Amarone della Valpolicella', 'red', 'full_rich', 'Corvina, Rondinella, Molinara', 'Veneto, Italy', 'full', 16, 18, 61, 64, 'Dried grape wine, rich and powerful'),
('Ripasso', 'red', 'full_rich', 'Corvina, Rondinella', 'Veneto, Italy', 'medium-full', 15, 17, 59, 63, 'Baby Amarone style'),
('Primitivo', 'red', 'full_rich', 'Primitivo', 'Puglia, Italy', 'full', 16, 18, 61, 64, 'Southern Italian Zinfandel relative'),
('Appassimento', 'red', 'full_rich', 'Various', 'Italy', 'full', 16, 18, 61, 64, 'Dried grape wines from various regions'),
('Negroamaro', 'red', 'full_rich', 'Negroamaro', 'Puglia, Italy', 'full', 16, 18, 61, 64, 'Dark Puglian red'),
('Salice Salentino', 'red', 'full_rich', 'Negroamaro', 'Puglia, Italy', 'medium-full', 15, 17, 59, 63, 'Salento appellation'),
('Shiraz/Syrah', 'red', 'full_rich', 'Shiraz/Syrah', 'Australia, Rhône, South Africa', 'full', 16, 18, 61, 64, 'Bold and spicy'),
('Barossa Shiraz', 'red', 'full_rich', 'Shiraz', 'Barossa Valley, Australia', 'full', 17, 19, 63, 66, 'Very ripe, full Aussie Shiraz'),
('Northern Rhône Syrah', 'red', 'full_rich', 'Syrah', 'Hermitage, Côte-Rôtie', 'full', 16, 18, 61, 64, 'Elegant and peppery'),
('Châteauneuf-du-Pape', 'red', 'full_rich', 'Grenache, Syrah, Mourvèdre', 'Rhône, France', 'full', 16, 18, 61, 64, 'Southern Rhône flagship'),
('Gigondas', 'red', 'full_rich', 'Grenache, Syrah, Mourvèdre', 'Rhône, France', 'full', 16, 18, 61, 64, 'Mini Châteauneuf'),
('Vacqueyras', 'red', 'full_rich', 'Grenache, Syrah, Mourvèdre', 'Rhône, France', 'full', 16, 18, 61, 64, 'Southern Rhône Cru'),
('Ribera del Duero', 'red', 'full_tannic', 'Tempranillo (Tinto Fino)', 'Ribera del Duero, Spain', 'full', 16, 18, 61, 64, 'Powerful Spanish Tempranillo'),
('Ribera del Duero Reserva', 'red', 'full_tannic', 'Tempranillo', 'Ribera del Duero, Spain', 'full', 17, 18, 63, 64, 'Aged Ribera'),
('Toro', 'red', 'full_tannic', 'Tinta de Toro (Tempranillo)', 'Toro, Spain', 'full', 16, 18, 61, 64, 'Powerful, high alcohol Tempranillo'),
('Priorat', 'red', 'full_tannic', 'Garnacha, Cariñena', 'Catalonia, Spain', 'full', 16, 18, 61, 64, 'Concentrated Catalan red'),
('Douro Red', 'red', 'full_rich', 'Touriga Nacional, Tinta Roriz', 'Douro, Portugal', 'full', 16, 18, 61, 64, 'Port grape red wine'),
('Alentejo Red', 'red', 'full_rich', 'Various Portuguese', 'Alentejo, Portugal', 'full', 16, 18, 61, 64, 'Southern Portuguese reds'),
('Dão Red', 'red', 'medium_structured', 'Touriga Nacional, Alfrocheiro', 'Dão, Portugal', 'medium-full', 15, 17, 59, 63, 'Elegant Portuguese reds'),
('Malbec', 'red', 'full_rich', 'Malbec', 'Argentina, Cahors', 'full', 16, 18, 61, 64, 'Argentine signature red'),
('Mendoza Malbec', 'red', 'full_rich', 'Malbec', 'Mendoza, Argentina', 'full', 16, 18, 61, 64, 'High altitude Malbec'),
('South African Bordeaux Blend', 'red', 'full_tannic', 'Cabernet, Merlot, Cab Franc', 'Stellenbosch, South Africa', 'full', 16, 18, 61, 64, 'Cape blends'),
('Petite Sirah', 'red', 'full_tannic', 'Petite Sirah', 'California', 'full', 16, 18, 61, 64, 'Very dark and tannic'),
('Tannat', 'red', 'full_tannic', 'Tannat', 'Uruguay, Madiran', 'full', 16, 18, 61, 64, 'Extremely tannic'),
('Aglianico', 'red', 'full_tannic', 'Aglianico', 'Campania, Basilicata', 'full', 16, 18, 61, 64, 'Taurasi, Aglianico del Vulture'),
('Sagrantino di Montefalco', 'red', 'full_tannic', 'Sagrantino', 'Umbria, Italy', 'full', 16, 18, 61, 64, 'Most tannic Italian grape');

-- =============================================
-- RED WINES - UNUSUAL/CURIOSITIES
-- =============================================

INSERT INTO wine_serving_temperatures (wine_type, category, subcategory, grape_varieties, regions, body, temp_min_celsius, temp_max_celsius, temp_min_fahrenheit, temp_max_fahrenheit, notes) VALUES
('Saperavi', 'red', 'full_rich', 'Saperavi', 'Georgia', 'full', 16, 18, 61, 64, 'Georgian teinturier grape'),
('Xinomavro', 'red', 'full_tannic', 'Xinomavro', 'Naoussa, Greece', 'full', 16, 18, 61, 64, 'Greek Nebbiolo equivalent'),
('Agiorgitiko', 'red', 'medium_structured', 'Agiorgitiko', 'Nemea, Greece', 'medium', 14, 17, 57, 63, 'Greek St. George grape'),
('Blaufränkisch', 'red', 'medium_structured', 'Blaufränkisch', 'Austria, Hungary', 'medium', 14, 17, 57, 63, 'Austrian/Hungarian red'),
('Kadarka', 'red', 'medium_structured', 'Kadarka', 'Hungary', 'medium', 14, 16, 57, 61, 'Hungarian native'),
('Plavac Mali', 'red', 'full_rich', 'Plavac Mali', 'Croatia', 'full', 16, 18, 61, 64, 'Croatian relative of Zinfandel');

-- =============================================
-- DESSERT WINES
-- =============================================

INSERT INTO wine_serving_temperatures (wine_type, category, subcategory, grape_varieties, regions, body, temp_min_celsius, temp_max_celsius, temp_min_fahrenheit, temp_max_fahrenheit, notes) VALUES
('Sauternes', 'dessert', 'botrytis', 'Semillon, Sauvignon Blanc', 'Bordeaux, France', 'full', 8, 10, 46, 50, 'Noble rot wine, cold to balance sweetness'),
('Barsac', 'dessert', 'botrytis', 'Semillon, Sauvignon Blanc', 'Bordeaux, France', 'full', 8, 10, 46, 50, 'Sauternes neighbor'),
('Tokaji Aszú', 'dessert', 'botrytis', 'Furmint, Hárslevelű', 'Tokaj, Hungary', 'full', 10, 12, 50, 54, 'Hungarian noble rot, serve cool'),
('Trockenbeerenauslese (TBA)', 'dessert', 'botrytis', 'Riesling, other', 'Germany, Austria', 'full', 8, 10, 46, 50, 'Ultra-sweet German wine'),
('Beerenauslese (BA)', 'dessert', 'botrytis', 'Riesling, other', 'Germany, Austria', 'full', 8, 10, 46, 50, 'Sweet German wine'),
('Auslese', 'dessert', 'late_harvest', 'Riesling', 'Germany', 'medium', 8, 10, 46, 50, 'Late harvest, varying sweetness'),
('Ice Wine/Eiswein', 'dessert', 'ice_wine', 'Riesling, Vidal', 'Canada, Germany', 'full', 8, 10, 46, 50, 'Frozen grape wine, serve cold'),
('Vin Santo', 'dessert', 'dried_grape', 'Trebbiano, Malvasia', 'Tuscany, Italy', 'full', 12, 14, 54, 57, 'Italian dried grape dessert wine'),
('Passito', 'dessert', 'dried_grape', 'Various', 'Italy', 'full', 10, 14, 50, 57, 'Dried grape wines'),
('Muscat de Beaumes-de-Venise', 'dessert', 'vin_doux_naturel', 'Muscat', 'Rhône, France', 'medium', 8, 10, 46, 50, 'Sweet fortified Muscat'),
('Moscatel de Setúbal', 'dessert', 'fortified', 'Moscatel', 'Setúbal, Portugal', 'full', 10, 12, 50, 54, 'Portuguese Muscat'),
('Late Harvest Riesling', 'dessert', 'late_harvest', 'Riesling', 'Various', 'medium', 8, 10, 46, 50, 'Sweet Riesling'),
('Pedro Ximénez (PX)', 'dessert', 'fortified', 'Pedro Ximénez', 'Jerez, Spain', 'full', 12, 14, 54, 57, 'Extremely sweet sherry'),
('Recioto della Valpolicella', 'dessert', 'dried_grape', 'Corvina', 'Veneto, Italy', 'full', 12, 14, 54, 57, 'Sweet Amarone style'),
('Recioto di Soave', 'dessert', 'dried_grape', 'Garganega', 'Veneto, Italy', 'medium', 10, 12, 50, 54, 'Sweet white Veneto wine');

-- =============================================
-- FORTIFIED WINES
-- =============================================

INSERT INTO wine_serving_temperatures (wine_type, category, subcategory, grape_varieties, regions, body, temp_min_celsius, temp_max_celsius, temp_min_fahrenheit, temp_max_fahrenheit, notes) VALUES
('Fino Sherry', 'fortified', 'dry', 'Palomino', 'Jerez, Spain', 'light', 7, 9, 45, 48, 'Dry sherry, serve very cold like white wine'),
('Manzanilla', 'fortified', 'dry', 'Palomino', 'Sanlúcar, Spain', 'light', 7, 9, 45, 48, 'Coastal fino style'),
('Amontillado', 'fortified', 'medium', 'Palomino', 'Jerez, Spain', 'medium', 10, 13, 50, 55, 'Aged fino, slightly warmer'),
('Oloroso', 'fortified', 'medium', 'Palomino', 'Jerez, Spain', 'full', 12, 14, 54, 57, 'Rich oxidative sherry'),
('Palo Cortado', 'fortified', 'medium', 'Palomino', 'Jerez, Spain', 'full', 12, 14, 54, 57, 'Rare sherry style'),
('Cream Sherry', 'fortified', 'sweet', 'Palomino, PX', 'Jerez, Spain', 'full', 10, 12, 50, 54, 'Sweet sherry'),
('Ruby Port', 'fortified', 'sweet', 'Touriga Nacional, etc.', 'Douro, Portugal', 'full', 14, 16, 57, 61, 'Young sweet Port'),
('Tawny Port (10-20 year)', 'fortified', 'sweet', 'Touriga Nacional, etc.', 'Douro, Portugal', 'full', 12, 14, 54, 57, 'Aged tawny, serve cool'),
('Tawny Port (30-40 year)', 'fortified', 'sweet', 'Touriga Nacional, etc.', 'Douro, Portugal', 'full', 14, 16, 57, 61, 'Very old tawny, slightly warmer'),
('Vintage/Vintage Port', 'fortified', 'sweet', 'Touriga Nacional, etc.', 'Douro, Portugal', 'full', 16, 18, 63, 64, 'Vintage declared Port, serve like red'),
('Late Bottled Vintage (LBV) Port', 'fortified', 'sweet', 'Touriga Nacional, etc.', 'Douro, Portugal', 'full', 14, 16, 57, 61, 'Ready-to-drink vintage style'),
('White Port', 'fortified', 'various', 'White grapes', 'Douro, Portugal', 'light-medium', 8, 10, 46, 50, 'Aperitif style, serve cold'),
('Rosé Port', 'fortified', 'sweet', 'Red grapes', 'Douro, Portugal', 'light-medium', 8, 10, 46, 50, 'Pink Port, serve cold'),
('Madeira (Sercial)', 'fortified', 'dry', 'Sercial', 'Madeira, Portugal', 'medium', 10, 13, 50, 55, 'Driest Madeira'),
('Madeira (Verdelho)', 'fortified', 'medium_dry', 'Verdelho', 'Madeira, Portugal', 'medium', 12, 14, 54, 57, 'Off-dry Madeira'),
('Madeira (Bual/Boal)', 'fortified', 'medium_sweet', 'Bual', 'Madeira, Portugal', 'full', 14, 16, 57, 61, 'Medium-sweet Madeira'),
('Madeira (Malmsey/Malvasia)', 'fortified', 'sweet', 'Malvasia', 'Madeira, Portugal', 'full', 14, 16, 57, 61, 'Sweetest Madeira'),
('Marsala (Dry)', 'fortified', 'dry', 'Grillo, Catarratto', 'Sicily, Italy', 'medium', 10, 12, 50, 54, 'Dry Sicilian fortified'),
('Marsala (Sweet)', 'fortified', 'sweet', 'Grillo, Catarratto', 'Sicily, Italy', 'full', 12, 14, 54, 57, 'Sweet Marsala'),
('Banyuls', 'fortified', 'sweet', 'Grenache', 'Roussillon, France', 'full', 14, 16, 57, 61, 'French sweet fortified'),
('Maury', 'fortified', 'sweet', 'Grenache', 'Roussillon, France', 'full', 14, 16, 57, 61, 'French vin doux naturel'),
('Rutherglen Muscat', 'fortified', 'sweet', 'Muscat', 'Victoria, Australia', 'full', 14, 16, 57, 61, 'Australian fortified Muscat'),
('Commandaria', 'fortified', 'sweet', 'Xynisteri, Mavro', 'Cyprus', 'full', 12, 14, 54, 57, 'Ancient Cypriot wine');
```

---

## Temperature Conversion Reference

| Celsius | Fahrenheit |
|---------|------------|
| 5°C | 41°F |
| 6°C | 43°F |
| 7°C | 45°F |
| 8°C | 46°F |
| 9°C | 48°F |
| 10°C | 50°F |
| 11°C | 52°F |
| 12°C | 54°F |
| 13°C | 55°F |
| 14°C | 57°F |
| 15°C | 59°F |
| 16°C | 61°F |
| 17°C | 63°F |
| 18°C | 64°F |
| 19°C | 66°F |
| 20°C | 68°F |

---

## Key Principles

1. **Never serve wine too cold** - Below 5°C (41°F) mutes aromas and emphasises tannins/acidity
2. **Never serve wine too warm** - Above 20°C (68°F) makes alcohol dominate and wine taste flat
3. **"Room temperature" is 15-18°C** - Based on European cellars, not modern heated rooms
4. **Lighter wines = cooler service** - Acidity and freshness shine at lower temps
5. **Fuller wines = warmer service** - Complexity and aromatics need warmth to express
6. **Tannins feel harsher when cold** - Warm up tannic wines for smoother texture
7. **Sweetness is balanced by cold** - Sweet wines benefit from chilling
8. **Wine warms in the glass** - Serve 2°C cooler than ideal drinking temp

---

## Practical Chilling Times

| Starting Point | Target | Method | Time |
|---------------|--------|--------|------|
| Room temp (22°C) | Sparkling (7°C) | Fridge | 2-3 hours |
| Room temp (22°C) | Sparkling (7°C) | Ice bucket | 20-30 min |
| Room temp (22°C) | White (10°C) | Fridge | 1.5-2 hours |
| Room temp (22°C) | White (10°C) | Ice bucket | 15-20 min |
| Room temp (22°C) | Red (16°C) | Fridge | 20-30 min |
| Cellar temp (12°C) | Red (16°C) | Room | 15-20 min |
| Fridge (4°C) | White (10°C) | Room | 10-15 min |

---

## Sources

- Wine Enthusiast
- Decanter
- Gambero Rosso International
- Wine Folly
- Vintec
- Coravin
- Regional producer guidelines (Rioja DOCa, Barolo DOCG, Champagne)
- Sommelier associations
- Wine & More
- Expert Wine Storage UK
