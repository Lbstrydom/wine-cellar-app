-- Migration 017: Zone Metadata
-- Adds human-readable intent descriptions for cellar zones.
-- These are AI-suggested and user-editable.

CREATE TABLE IF NOT EXISTS zone_metadata (
  zone_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  purpose TEXT,                    -- "Crisp whites for weeknight cooking"
  style_range TEXT,                -- "Light to medium body, high acid, minimal oak"
  serving_temp TEXT,               -- "Well chilled (7-10°C)"
  aging_advice TEXT,               -- "Drink within 2-3 years of vintage"
  pairing_hints TEXT,              -- JSON array: ["Seafood", "Salads", "Light pasta"]
  example_wines TEXT,              -- JSON array: ["Sancerre", "Marlborough Sauvignon"]
  family TEXT,                     -- "white_crisp", "red_mediterranean", etc.
  seasonal_notes TEXT,             -- "More popular in summer"
  ai_suggested_at DATETIME,        -- When AI last suggested updates
  user_confirmed_at DATETIME,      -- When user confirmed/edited
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Seed with initial data for all zones
-- WHITE WINES
INSERT OR REPLACE INTO zone_metadata (zone_id, display_name, purpose, style_range, serving_temp, aging_advice, pairing_hints, example_wines, family) VALUES
  ('sauvignon_blanc', 'Sauvignon Blanc', 'Zesty, herbaceous whites for seafood and salads', 'Light to medium body, high acidity, grassy/citrus notes, unoaked', 'Well chilled (7-10°C)', 'Drink within 2-3 years of vintage', '["Oysters", "Goat cheese", "Asparagus", "Sushi", "Green salads"]', '["Sancerre", "Pouilly-Fumé", "Marlborough Sauvignon Blanc", "Cape Coast Sauvignon"]', 'white_crisp'),

  ('chenin_blanc', 'Chenin Blanc', 'Versatile whites ranging from bone-dry to lusciously sweet', 'Light to full body, high acidity, can show honey/lanolin with age', 'Chilled (8-12°C)', 'Simple: 2-3 years. Quality: 5-15+ years', '["Pork belly", "Thai cuisine", "Roast chicken", "Soft cheese", "Apple tart"]', '["Vouvray", "Savennières", "Swartland Chenin", "Stellenbosch Old Vine"]', 'white_aromatic'),

  ('aromatic_whites', 'Aromatic Whites', 'Perfumed, expressive whites for spiced and Asian cuisine', 'Light to medium body, varying sweetness, floral/stone fruit aromas', 'Well chilled (6-10°C)', 'Riesling: 5-20 years. Others: 2-5 years', '["Spicy Asian", "Indian curries", "Smoked fish", "Blue cheese", "Fruit desserts"]', '["Alsace Riesling", "German Spätlese", "Gewürztraminer", "Clare Valley Riesling"]', 'white_aromatic'),

  ('chardonnay', 'Chardonnay', 'Elegant whites from steely to rich and buttery', 'Light to full body, varying oak influence, can develop nutty notes', 'Lightly chilled (10-13°C)', 'Unoaked: 2-4 years. Oaked: 5-10+ years', '["Lobster", "Creamy pasta", "Roast chicken", "Grilled fish", "Mild cheese"]', '["Chablis", "Meursault", "Puligny-Montrachet", "Burgundy", "Margaret River"]', 'white_textured'),

  ('loire_light', 'Loire & Light', 'Crisp, mineral-driven whites for everyday drinking', 'Light body, high acidity, subtle fruit, often briny/mineral', 'Well chilled (7-10°C)', 'Drink within 2-3 years of vintage', '["Shellfish", "Light salads", "Seafood pasta", "Aperitif", "Summer picnics"]', '["Muscadet", "Picpoul de Pinet", "Vinho Verde", "Grüner Veltliner", "Assyrtiko"]', 'white_crisp');

-- ROSÉ & SPARKLING
INSERT OR REPLACE INTO zone_metadata (zone_id, display_name, purpose, style_range, serving_temp, aging_advice, pairing_hints, example_wines, family) VALUES
  ('rose_sparkling', 'Rosé & Sparkling', 'Celebration wines and refreshing rosés for any occasion', 'Light to medium body, fresh acidity, red berry notes (rosé); fine bubbles (sparkling)', 'Well chilled (6-10°C)', 'Rosé: 1-2 years. NV Champagne: 3-5 years. Vintage: 10+ years', '["Aperitif", "Salmon", "Charcuterie", "Light appetizers", "Celebrations"]', '["Provence Rosé", "Champagne", "Crémant", "Cava", "Prosecco"]', 'rose_sparkling');

-- DESSERT & FORTIFIED
INSERT OR REPLACE INTO zone_metadata (zone_id, display_name, purpose, style_range, serving_temp, aging_advice, pairing_hints, example_wines, family) VALUES
  ('dessert_fortified', 'Dessert & Fortified', 'Rich, sweet wines for special occasions and after dinner', 'Full body, high residual sugar, often high alcohol, complex aged flavours', 'Varies: Port (16-18°C), Sauternes (8-10°C)', 'Can age 20-50+ years', '["Blue cheese", "Chocolate", "Fruit tarts", "Foie gras", "Nuts", "Christmas pudding"]', '["Port", "Sauternes", "Tokaji", "Sherry", "Madeira", "Rutherglen Muscat"]', 'dessert_fortified');

-- IBERIAN REDS
INSERT OR REPLACE INTO zone_metadata (zone_id, display_name, purpose, style_range, serving_temp, aging_advice, pairing_hints, example_wines, family) VALUES
  ('iberian_fresh', 'Iberian Fresh', 'Juicy, vibrant Spanish reds for casual dining', 'Medium body, bright fruit, soft tannins, minimal oak', 'Slightly cool (14-16°C)', 'Drink within 2-4 years', '["Tapas", "Grilled vegetables", "Pizza", "Chorizo", "Paella"]', '["Garnacha", "Tinto Joven", "Bobal", "Mencía", "Young Monastrell"]', 'red_mediterranean'),

  ('rioja_ribera', 'Rioja & Ribera', 'Elegant, age-worthy Spanish classics', 'Medium to full body, fine tannins, vanilla/oak notes, earthy', 'Room temp (16-18°C)', 'Crianza: 5-10 years. Reserva: 10-20 years. Gran Reserva: 15-30 years', '["Lamb", "Roast pork", "Aged cheese", "Game birds", "Stews"]', '["Rioja Reserva", "Ribera del Duero", "Toro", "Gran Reserva"]', 'red_traditional'),

  ('portugal', 'Portugal', 'Bold, characterful Portuguese reds with unique grape varieties', 'Full body, firm tannins, dark fruit, often herbal notes', 'Room temp (16-18°C)', '5-15 years depending on quality', '["Grilled meats", "Bacalhau", "Bean stews", "Hard cheese", "Charcuterie"]', '["Douro Red", "Dão", "Alentejo", "Bairrada", "Touriga Nacional"]', 'red_bold');

-- FRENCH REDS
INSERT OR REPLACE INTO zone_metadata (zone_id, display_name, purpose, style_range, serving_temp, aging_advice, pairing_hints, example_wines, family) VALUES
  ('southern_france', 'Southern France', 'Sun-drenched, spicy reds from the Mediterranean', 'Medium to full body, ripe fruit, garrigue herbs, supple tannins', 'Room temp (16-18°C)', 'Simple: 3-5 years. Cru: 10-20 years', '["Lamb", "Cassoulet", "Grilled meats", "Mediterranean vegetables", "Herbs"]', '["Châteauneuf-du-Pape", "Côtes du Rhône", "Minervois", "Corbières", "Cahors"]', 'red_mediterranean');

-- ITALIAN REDS
INSERT OR REPLACE INTO zone_metadata (zone_id, display_name, purpose, style_range, serving_temp, aging_advice, pairing_hints, example_wines, family) VALUES
  ('puglia_primitivo', 'Puglia & Primitivo', 'Generous, fruit-forward Southern Italian reds', 'Full body, ripe dark fruit, soft tannins, often high alcohol', 'Room temp (16-18°C)', 'Drink within 3-6 years', '["Pizza", "Grilled sausages", "Pasta with meat sauce", "BBQ", "Hard cheese"]', '["Primitivo di Manduria", "Salice Salentino", "Negroamaro", "Nero di Troia"]', 'red_bold'),

  ('appassimento', 'Appassimento', 'Rich, concentrated wines from dried grapes', 'Full body, dried fruit, chocolate, velvety texture, high alcohol', 'Room temp (16-18°C)', 'Ripasso: 5-10 years. Amarone: 15-30+ years', '["Braised beef", "Aged cheese", "Rich stews", "Dark chocolate", "Game"]', '["Amarone della Valpolicella", "Ripasso", "Appassimento", "Recioto"]', 'red_bold'),

  ('piedmont', 'Piedmont', 'Noble, terroir-driven wines with exceptional aging potential', 'Medium to full body, high acidity, firm tannins, tar/roses/truffle', 'Room temp (17-19°C)', 'Dolcetto: 3-5 years. Barbera: 5-10 years. Barolo/Barbaresco: 15-40 years', '["Truffle pasta", "Braised meats", "Risotto", "Aged cheese", "Game"]', '["Barolo", "Barbaresco", "Barbera d''Alba", "Langhe Nebbiolo", "Roero"]', 'red_traditional'),

  ('romagna_tuscany', 'Romagna & Tuscany', 'Food-friendly Sangiovese-based wines with bright acidity', 'Medium body, high acidity, cherry fruit, earthy, firm tannins', 'Slightly cool (15-17°C)', 'Chianti: 5-10 years. Brunello: 15-30 years', '["Tomato-based pasta", "Grilled steak", "Hard cheese", "Pizza", "Roast pork"]', '["Chianti Classico", "Brunello di Montalcino", "Vino Nobile", "Rosso di Montalcino"]', 'red_traditional');

-- NEW WORLD REDS
INSERT OR REPLACE INTO zone_metadata (zone_id, display_name, purpose, style_range, serving_temp, aging_advice, pairing_hints, example_wines, family) VALUES
  ('cabernet', 'Cabernet Sauvignon', 'Bold, structured reds for serious occasions', 'Full body, firm tannins, blackcurrant/cedar, often oaked', 'Room temp (17-19°C)', '5-20+ years depending on quality', '["Grilled steak", "Lamb", "Hard aged cheese", "Game", "Rich stews"]', '["Napa Valley Cabernet", "Stellenbosch Cabernet", "Coonawarra", "Maipo Valley"]', 'red_bold'),

  ('sa_blends', 'SA Blends', 'South African Bordeaux-style blends with Cape character', 'Full body, integrated tannins, complex fruit, often mineral', 'Room temp (17-19°C)', '5-15 years', '["Braai (BBQ)", "Lamb", "Game", "Bobotie", "Rich stews"]', '["Cape Blend", "Stellenbosch Bordeaux Blend", "Swartland Red", "Franschhoek Blend"]', 'red_bold'),

  ('shiraz', 'Shiraz / Syrah', 'Powerful, spicy reds with dark fruit intensity', 'Full body, bold tannins, black fruit, pepper/smoke, often oaked', 'Room temp (17-19°C)', 'Simple: 3-5 years. Premium: 10-20 years', '["BBQ", "Peppered steak", "Game", "Strong cheese", "Lamb"]', '["Barossa Shiraz", "McLaren Vale", "Stellenbosch Shiraz", "Swartland Syrah"]', 'red_bold'),

  ('pinot_noir', 'Pinot Noir', 'Elegant, silky reds with delicate aromatics', 'Light to medium body, fine tannins, red fruit, earthy complexity', 'Slightly cool (14-16°C)', 'Simple: 3-5 years. Burgundy: 10-20+ years', '["Duck", "Salmon", "Mushrooms", "Soft cheese", "Game birds"]', '["Burgundy", "Oregon Pinot", "Central Otago", "Walker Bay", "Elgin"]', 'red_elegant'),

  ('chile_argentina', 'Chile & Argentina', 'Value-driven South American reds with character', 'Medium to full body, soft tannins, ripe fruit, often spicy', 'Room temp (16-18°C)', '3-10 years depending on quality', '["Steak", "Empanadas", "Grilled meats", "Chorizo", "BBQ"]', '["Mendoza Malbec", "Colchagua Carmenère", "Maipo Cabernet", "Uco Valley Malbec"]', 'red_bold');

-- BUFFER & SPECIAL ZONES
INSERT OR REPLACE INTO zone_metadata (zone_id, display_name, purpose, style_range, serving_temp, aging_advice, pairing_hints, example_wines, family) VALUES
  ('white_buffer', 'White Reserve', 'Overflow space for white wines awaiting zone assignment', 'Various white wine styles', 'Varies by style', 'Check individual bottles', '[]', '[]', 'buffer'),

  ('red_buffer', 'Red Reserve', 'Overflow space for red wines awaiting zone assignment', 'Various red wine styles', 'Varies by style', 'Check individual bottles', '[]', '[]', 'buffer'),

  ('curiosities', 'Curiosities', 'Unusual and exotic wines from lesser-known regions', 'Highly variable - from delicate to bold, often unique characteristics', 'Varies by style', 'Varies - research individual wines', '["Adventurous dining", "Wine tastings", "Cultural exploration"]', '["Georgian Qvevri wines", "Greek Xinomavro", "Hungarian Furmint", "Croatian Plavac Mali"]', 'special'),

  ('unclassified', 'Unclassified', 'Wines requiring manual categorisation', 'Unknown or mixed styles', 'Varies', 'Review and assign to appropriate zone', '[]', '[]', 'unclassified'),

  ('fridge', 'Fridge', 'Ready-to-drink wines for immediate consumption', 'Various - curated for current drinking', 'Already chilled', 'Drink within 1-2 weeks', '["Weeknight dinners", "Impromptu entertaining", "Current cravings"]', '[]', 'special');
