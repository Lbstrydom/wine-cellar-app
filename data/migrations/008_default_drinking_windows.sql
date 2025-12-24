-- Migration 008: Default Drinking Windows Matrix
-- Provides fallback drinking windows based on grape variety, region, style, and quality tier
-- when no critic or user-defined window exists

-- Default drinking windows by grape, style, region, and quality tier
CREATE TABLE IF NOT EXISTS drinking_window_defaults (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- Matching criteria (NULL = wildcard)
  grape TEXT,                              -- 'sangiovese', 'chardonnay', NULL for any
  style TEXT,                              -- 'appassimento', 'riserva', 'gran_reserva', NULL
  region TEXT,                             -- 'barolo', 'bordeaux', 'napa', NULL
  country TEXT,                            -- 'IT', 'FR', 'US', NULL
  colour TEXT,                             -- 'red', 'white', 'rose', 'sparkling', 'dessert'
  quality_tier TEXT,                       -- 'entry', 'mid', 'premium', 'icon', NULL

  -- Window parameters (years from vintage)
  drink_from_offset INTEGER NOT NULL,      -- years after vintage before ready
  drink_by_offset INTEGER NOT NULL,        -- years after vintage to consume by
  peak_offset INTEGER,                     -- years after vintage for peak (optional)

  -- Metadata
  confidence TEXT DEFAULT 'medium',        -- 'high', 'medium', 'low'
  notes TEXT,                              -- explanation
  priority INTEGER DEFAULT 100,            -- lower = more specific, matched first

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_dwd_grape ON drinking_window_defaults(grape);
CREATE INDEX IF NOT EXISTS idx_dwd_style ON drinking_window_defaults(style);
CREATE INDEX IF NOT EXISTS idx_dwd_region ON drinking_window_defaults(region);
CREATE INDEX IF NOT EXISTS idx_dwd_colour ON drinking_window_defaults(colour);
CREATE INDEX IF NOT EXISTS idx_dwd_priority ON drinking_window_defaults(priority);


-- =============================================================================
-- RED GRAPES - SPECIFIC VARIETIES
-- =============================================================================

-- NEBBIOLO (Barolo, Barbaresco)
INSERT INTO drinking_window_defaults (grape, region, style, colour, quality_tier, drink_from_offset, drink_by_offset, peak_offset, confidence, notes, priority) VALUES
('nebbiolo', 'barolo', 'riserva', 'red', 'premium', 10, 30, 18, 'high', 'Top Barolo Riserva needs decades', 10),
('nebbiolo', 'barolo', NULL, 'red', 'premium', 8, 25, 15, 'high', 'Barolo DOCG - classic development', 15),
('nebbiolo', 'barolo', NULL, 'red', 'mid', 5, 18, 10, 'high', 'Entry Barolo - earlier drinking', 20),
('nebbiolo', 'barbaresco', NULL, 'red', 'premium', 6, 20, 12, 'high', 'Barbaresco - slightly earlier than Barolo', 15),
('nebbiolo', 'barbaresco', NULL, 'red', 'mid', 4, 15, 8, 'high', 'Entry Barbaresco', 20),
('nebbiolo', 'langhe', NULL, 'red', NULL, 2, 8, 4, 'medium', 'Langhe Nebbiolo - drink younger', 25),
('nebbiolo', NULL, NULL, 'red', NULL, 3, 12, 6, 'medium', 'Generic Nebbiolo', 50);

-- SANGIOVESE (Chianti, Brunello, etc.)
INSERT INTO drinking_window_defaults (grape, region, style, colour, quality_tier, drink_from_offset, drink_by_offset, peak_offset, confidence, notes, priority) VALUES
('sangiovese', 'brunello', 'riserva', 'red', 'premium', 10, 30, 18, 'high', 'Brunello Riserva - long-lived', 10),
('sangiovese', 'brunello', NULL, 'red', 'premium', 8, 25, 15, 'high', 'Brunello di Montalcino DOCG', 15),
('sangiovese', 'chianti_classico', 'gran_selezione', 'red', 'premium', 5, 18, 10, 'high', 'Chianti Classico Gran Selezione', 15),
('sangiovese', 'chianti_classico', 'riserva', 'red', 'mid', 4, 15, 8, 'high', 'Chianti Classico Riserva', 20),
('sangiovese', 'chianti_classico', NULL, 'red', 'mid', 2, 10, 5, 'high', 'Chianti Classico', 25),
('sangiovese', 'chianti', NULL, 'red', 'entry', 1, 5, 2, 'high', 'Basic Chianti - drink young', 30),
('sangiovese', 'romagna', 'riserva', 'red', 'mid', 3, 10, 5, 'medium', 'Romagna Sangiovese Riserva', 25),
('sangiovese', 'romagna', NULL, 'red', 'entry', 1, 6, 3, 'medium', 'Romagna Sangiovese', 30),
('sangiovese', NULL, 'appassimento', 'red', NULL, 2, 8, 4, 'medium', 'Appassimento style - richer, earlier peak', 20),
('sangiovese', NULL, NULL, 'red', NULL, 2, 8, 4, 'medium', 'Generic Sangiovese', 50);

-- PRIMITIVO / ZINFANDEL
INSERT INTO drinking_window_defaults (grape, region, style, colour, quality_tier, drink_from_offset, drink_by_offset, peak_offset, confidence, notes, priority) VALUES
('primitivo', 'manduria', NULL, 'red', 'premium', 3, 12, 6, 'high', 'Primitivo di Manduria - structured', 15),
('primitivo', 'manduria', NULL, 'red', 'mid', 2, 8, 4, 'high', 'Standard Manduria', 20),
('primitivo', NULL, 'appassimento', 'red', NULL, 2, 10, 5, 'medium', 'Appassimento Primitivo', 20),
('primitivo', NULL, NULL, 'red', NULL, 1, 6, 3, 'medium', 'Generic Primitivo', 50),
('zinfandel', 'napa', NULL, 'red', 'premium', 3, 12, 6, 'medium', 'Napa Zinfandel', 20),
('zinfandel', 'sonoma', NULL, 'red', 'mid', 2, 10, 5, 'medium', 'Sonoma Zinfandel', 25),
('zinfandel', NULL, NULL, 'red', NULL, 1, 7, 3, 'medium', 'Generic Zinfandel', 50);

-- CABERNET SAUVIGNON
INSERT INTO drinking_window_defaults (grape, region, style, colour, quality_tier, drink_from_offset, drink_by_offset, peak_offset, confidence, notes, priority) VALUES
('cabernet_sauvignon', 'bordeaux', NULL, 'red', 'icon', 15, 50, 25, 'high', 'First Growth / classified Bordeaux', 5),
('cabernet_sauvignon', 'bordeaux', NULL, 'red', 'premium', 8, 30, 15, 'high', 'Cru Bourgeois / quality Bordeaux', 15),
('cabernet_sauvignon', 'bordeaux', NULL, 'red', 'mid', 5, 15, 8, 'high', 'Generic Bordeaux', 25),
('cabernet_sauvignon', 'napa', NULL, 'red', 'icon', 10, 35, 18, 'high', 'Cult Napa Cabernet', 10),
('cabernet_sauvignon', 'napa', NULL, 'red', 'premium', 5, 20, 10, 'high', 'Premium Napa Cabernet', 20),
('cabernet_sauvignon', 'napa', NULL, 'red', 'mid', 3, 12, 6, 'medium', 'Standard Napa Cabernet', 30),
('cabernet_sauvignon', 'stellenbosch', NULL, 'red', 'premium', 5, 18, 10, 'medium', 'Premium Stellenbosch Cab', 20),
('cabernet_sauvignon', 'stellenbosch', NULL, 'red', 'mid', 3, 12, 6, 'medium', 'Standard Stellenbosch Cab', 30),
('cabernet_sauvignon', 'coonawarra', NULL, 'red', 'premium', 5, 20, 10, 'medium', 'Coonawarra Cabernet', 20),
('cabernet_sauvignon', 'margaret_river', NULL, 'red', 'premium', 5, 18, 10, 'medium', 'Margaret River Cabernet', 20),
('cabernet_sauvignon', NULL, NULL, 'red', 'premium', 5, 18, 10, 'medium', 'Premium Cabernet generic', 40),
('cabernet_sauvignon', NULL, NULL, 'red', 'mid', 3, 10, 5, 'medium', 'Mid-tier Cabernet', 45),
('cabernet_sauvignon', NULL, NULL, 'red', NULL, 2, 10, 5, 'low', 'Generic Cabernet Sauvignon', 50);

-- MERLOT
INSERT INTO drinking_window_defaults (grape, region, style, colour, quality_tier, drink_from_offset, drink_by_offset, peak_offset, confidence, notes, priority) VALUES
('merlot', 'pomerol', NULL, 'red', 'icon', 10, 40, 20, 'high', 'Top Pomerol', 10),
('merlot', 'pomerol', NULL, 'red', 'premium', 6, 25, 12, 'high', 'Quality Pomerol', 15),
('merlot', 'saint_emilion', NULL, 'red', 'premium', 6, 25, 12, 'high', 'Saint-Emilion Grand Cru', 15),
('merlot', 'bordeaux', NULL, 'red', 'mid', 3, 12, 6, 'medium', 'Generic Bordeaux Merlot', 30),
('merlot', NULL, NULL, 'red', 'premium', 4, 15, 8, 'medium', 'Premium Merlot', 40),
('merlot', NULL, NULL, 'red', NULL, 2, 8, 4, 'low', 'Generic Merlot', 50);

-- PINOT NOIR
INSERT INTO drinking_window_defaults (grape, region, style, colour, quality_tier, drink_from_offset, drink_by_offset, peak_offset, confidence, notes, priority) VALUES
('pinot_noir', 'burgundy', NULL, 'red', 'icon', 10, 30, 18, 'high', 'Grand Cru Burgundy', 5),
('pinot_noir', 'burgundy', NULL, 'red', 'premium', 6, 20, 12, 'high', 'Premier Cru / Village Burgundy', 15),
('pinot_noir', 'burgundy', NULL, 'red', 'mid', 3, 12, 6, 'high', 'Bourgogne / Regional', 25),
('pinot_noir', 'oregon', NULL, 'red', 'premium', 4, 15, 8, 'medium', 'Oregon Pinot Noir', 20),
('pinot_noir', 'central_otago', NULL, 'red', 'premium', 3, 12, 6, 'medium', 'Central Otago Pinot', 20),
('pinot_noir', 'marlborough', NULL, 'red', 'mid', 2, 8, 4, 'medium', 'Marlborough Pinot', 25),
('pinot_noir', 'sonoma', NULL, 'red', 'premium', 3, 12, 6, 'medium', 'Sonoma Coast Pinot', 20),
('pinot_noir', NULL, NULL, 'red', NULL, 2, 8, 4, 'low', 'Generic Pinot Noir', 50);

-- SYRAH / SHIRAZ
INSERT INTO drinking_window_defaults (grape, region, style, colour, quality_tier, drink_from_offset, drink_by_offset, peak_offset, confidence, notes, priority) VALUES
('syrah', 'hermitage', NULL, 'red', 'icon', 10, 40, 20, 'high', 'Hermitage - extremely long-lived', 5),
('syrah', 'cote_rotie', NULL, 'red', 'premium', 8, 30, 15, 'high', 'Cote-Rotie', 10),
('syrah', 'cornas', NULL, 'red', 'premium', 6, 25, 12, 'high', 'Cornas', 15),
('syrah', 'rhone', NULL, 'red', 'mid', 3, 12, 6, 'medium', 'Northern Rhone generic', 30),
('shiraz', 'barossa', NULL, 'red', 'icon', 8, 30, 15, 'high', 'Icon Barossa Shiraz', 10),
('shiraz', 'barossa', NULL, 'red', 'premium', 5, 20, 10, 'high', 'Premium Barossa Shiraz', 15),
('shiraz', 'barossa', NULL, 'red', 'mid', 3, 12, 6, 'medium', 'Standard Barossa Shiraz', 25),
('shiraz', 'mclaren_vale', NULL, 'red', 'premium', 4, 18, 8, 'medium', 'McLaren Vale Shiraz', 20),
('shiraz', 'hunter_valley', NULL, 'red', 'premium', 5, 25, 12, 'medium', 'Hunter Valley Shiraz - ages well', 20),
('syrah', NULL, NULL, 'red', NULL, 3, 12, 6, 'low', 'Generic Syrah', 50),
('shiraz', NULL, NULL, 'red', NULL, 2, 10, 5, 'low', 'Generic Shiraz', 50);

-- GRENACHE / GARNACHA
INSERT INTO drinking_window_defaults (grape, region, style, colour, quality_tier, drink_from_offset, drink_by_offset, peak_offset, confidence, notes, priority) VALUES
('grenache', 'chateauneuf', NULL, 'red', 'premium', 5, 20, 10, 'high', 'Chateauneuf-du-Pape', 15),
('grenache', 'rhone', NULL, 'red', 'mid', 3, 12, 6, 'medium', 'Southern Rhone', 25),
('garnacha', 'priorat', NULL, 'red', 'premium', 5, 20, 10, 'high', 'Priorat', 15),
('garnacha', 'carinena', 'gran_reserva', 'red', 'mid', 4, 12, 7, 'medium', 'Carinena Gran Reserva', 20),
('garnacha', 'carinena', 'reserva', 'red', 'mid', 3, 10, 5, 'medium', 'Carinena Reserva', 25),
('garnacha', 'carinena', NULL, 'red', 'entry', 1, 6, 3, 'medium', 'Carinena basic', 30),
('grenache', NULL, NULL, 'red', NULL, 2, 8, 4, 'low', 'Generic Grenache', 50),
('garnacha', NULL, NULL, 'red', NULL, 2, 8, 4, 'low', 'Generic Garnacha', 50);

-- TEMPRANILLO
INSERT INTO drinking_window_defaults (grape, region, style, colour, quality_tier, drink_from_offset, drink_by_offset, peak_offset, confidence, notes, priority) VALUES
('tempranillo', 'rioja', 'gran_reserva', 'red', 'premium', 8, 25, 15, 'high', 'Rioja Gran Reserva', 10),
('tempranillo', 'rioja', 'reserva', 'red', 'mid', 5, 18, 10, 'high', 'Rioja Reserva', 15),
('tempranillo', 'rioja', 'crianza', 'red', 'mid', 3, 12, 6, 'high', 'Rioja Crianza', 20),
('tempranillo', 'rioja', 'joven', 'red', 'entry', 1, 4, 2, 'high', 'Rioja Joven - drink young', 25),
('tempranillo', 'ribera_del_duero', 'gran_reserva', 'red', 'premium', 8, 25, 15, 'high', 'Ribera Gran Reserva', 10),
('tempranillo', 'ribera_del_duero', 'reserva', 'red', 'mid', 5, 18, 10, 'high', 'Ribera Reserva', 15),
('tempranillo', 'ribera_del_duero', 'crianza', 'red', 'mid', 3, 12, 6, 'high', 'Ribera Crianza', 20),
('tempranillo', 'toro', NULL, 'red', 'premium', 5, 20, 10, 'medium', 'Toro - powerful Tempranillo', 20),
('tempranillo', NULL, NULL, 'red', NULL, 2, 10, 5, 'low', 'Generic Tempranillo', 50);

-- MALBEC
INSERT INTO drinking_window_defaults (grape, region, style, colour, quality_tier, drink_from_offset, drink_by_offset, peak_offset, confidence, notes, priority) VALUES
('malbec', 'mendoza', NULL, 'red', 'icon', 5, 20, 10, 'high', 'Icon Mendoza Malbec', 10),
('malbec', 'mendoza', NULL, 'red', 'premium', 3, 15, 7, 'high', 'Premium Mendoza Malbec', 15),
('malbec', 'mendoza', NULL, 'red', 'mid', 2, 10, 5, 'high', 'Standard Mendoza Malbec', 25),
('malbec', 'uco_valley', NULL, 'red', 'premium', 4, 18, 8, 'high', 'Uco Valley - high altitude', 15),
('malbec', 'cahors', NULL, 'red', 'premium', 5, 20, 10, 'medium', 'Cahors Malbec', 20),
('malbec', NULL, NULL, 'red', NULL, 2, 10, 5, 'low', 'Generic Malbec', 50);

-- PINOTAGE
INSERT INTO drinking_window_defaults (grape, region, style, colour, quality_tier, drink_from_offset, drink_by_offset, peak_offset, confidence, notes, priority) VALUES
('pinotage', 'stellenbosch', NULL, 'red', 'premium', 3, 15, 7, 'medium', 'Premium Stellenbosch Pinotage', 20),
('pinotage', 'stellenbosch', NULL, 'red', 'mid', 2, 10, 5, 'medium', 'Standard Pinotage', 30),
('pinotage', NULL, NULL, 'red', NULL, 2, 8, 4, 'low', 'Generic Pinotage', 50);

-- CARMENERE
INSERT INTO drinking_window_defaults (grape, region, style, colour, quality_tier, drink_from_offset, drink_by_offset, peak_offset, confidence, notes, priority) VALUES
('carmenere', 'chile', NULL, 'red', 'premium', 3, 12, 6, 'medium', 'Premium Chilean Carmenere', 20),
('carmenere', 'chile', NULL, 'red', 'mid', 2, 8, 4, 'medium', 'Standard Carmenere', 30),
('carmenere', NULL, NULL, 'red', NULL, 2, 8, 4, 'low', 'Generic Carmenere', 50);

-- TOURIGA NACIONAL
INSERT INTO drinking_window_defaults (grape, region, style, colour, quality_tier, drink_from_offset, drink_by_offset, peak_offset, confidence, notes, priority) VALUES
('touriga_nacional', 'douro', NULL, 'red', 'premium', 5, 20, 10, 'medium', 'Douro Touriga Nacional', 20),
('touriga_nacional', 'dao', NULL, 'red', 'premium', 4, 18, 8, 'medium', 'Dao Touriga Nacional', 25),
('touriga_nacional', NULL, NULL, 'red', NULL, 3, 12, 6, 'low', 'Generic Touriga Nacional', 50);

-- AGLIANICO
INSERT INTO drinking_window_defaults (grape, region, style, colour, quality_tier, drink_from_offset, drink_by_offset, peak_offset, confidence, notes, priority) VALUES
('aglianico', 'taurasi', NULL, 'red', 'premium', 8, 25, 15, 'high', 'Taurasi DOCG - very tannic', 15),
('aglianico', 'aglianico_del_vulture', NULL, 'red', 'premium', 5, 20, 10, 'medium', 'Aglianico del Vulture', 20),
('aglianico', NULL, NULL, 'red', NULL, 4, 15, 8, 'low', 'Generic Aglianico', 50);

-- NERO D'AVOLA
INSERT INTO drinking_window_defaults (grape, region, style, colour, quality_tier, drink_from_offset, drink_by_offset, peak_offset, confidence, notes, priority) VALUES
('nero_davola', 'sicily', NULL, 'red', 'premium', 3, 12, 6, 'medium', 'Premium Sicilian Nero d''Avola', 20),
('nero_davola', 'sicily', NULL, 'red', 'mid', 2, 8, 4, 'medium', 'Standard Nero d''Avola', 30),
('nero_davola', NULL, NULL, 'red', NULL, 2, 8, 4, 'low', 'Generic Nero d''Avola', 50);

-- CORVINA (Amarone, Valpolicella)
INSERT INTO drinking_window_defaults (grape, region, style, colour, quality_tier, drink_from_offset, drink_by_offset, peak_offset, confidence, notes, priority) VALUES
('corvina', 'amarone', NULL, 'red', 'premium', 8, 30, 15, 'high', 'Amarone della Valpolicella', 10),
('corvina', 'valpolicella', 'ripasso', 'red', 'mid', 3, 12, 6, 'high', 'Valpolicella Ripasso', 20),
('corvina', 'valpolicella', 'superiore', 'red', 'mid', 2, 10, 5, 'medium', 'Valpolicella Superiore', 25),
('corvina', 'valpolicella', NULL, 'red', 'entry', 1, 5, 2, 'medium', 'Basic Valpolicella', 30),
('corvina', NULL, NULL, 'red', NULL, 2, 8, 4, 'low', 'Generic Corvina', 50);


-- =============================================================================
-- WHITE GRAPES - SPECIFIC VARIETIES
-- =============================================================================

-- CHARDONNAY
INSERT INTO drinking_window_defaults (grape, region, style, colour, quality_tier, drink_from_offset, drink_by_offset, peak_offset, confidence, notes, priority) VALUES
('chardonnay', 'burgundy', NULL, 'white', 'icon', 5, 20, 10, 'high', 'Grand Cru White Burgundy', 5),
('chardonnay', 'burgundy', NULL, 'white', 'premium', 3, 12, 6, 'high', 'Premier Cru / Village Burgundy', 15),
('chardonnay', 'burgundy', NULL, 'white', 'mid', 2, 7, 4, 'high', 'Bourgogne Blanc', 25),
('chardonnay', 'chablis', 'grand_cru', 'white', 'premium', 5, 18, 10, 'high', 'Chablis Grand Cru', 10),
('chardonnay', 'chablis', 'premier_cru', 'white', 'mid', 3, 12, 6, 'high', 'Chablis Premier Cru', 15),
('chardonnay', 'chablis', NULL, 'white', 'mid', 2, 8, 4, 'high', 'Chablis Village', 20),
('chardonnay', 'napa', NULL, 'white', 'premium', 2, 8, 4, 'medium', 'Napa Chardonnay - oaked', 20),
('chardonnay', 'sonoma', NULL, 'white', 'mid', 2, 7, 3, 'medium', 'Sonoma Chardonnay', 25),
('chardonnay', 'margaret_river', NULL, 'white', 'premium', 2, 10, 5, 'medium', 'Margaret River Chardonnay', 20),
('chardonnay', NULL, 'unoaked', 'white', NULL, 1, 4, 2, 'medium', 'Unoaked Chardonnay - drink young', 30),
('chardonnay', NULL, NULL, 'white', NULL, 1, 5, 2, 'low', 'Generic Chardonnay', 50);

-- SAUVIGNON BLANC
INSERT INTO drinking_window_defaults (grape, region, style, colour, quality_tier, drink_from_offset, drink_by_offset, peak_offset, confidence, notes, priority) VALUES
('sauvignon_blanc', 'marlborough', NULL, 'white', 'mid', 1, 4, 2, 'high', 'Marlborough Sauvignon Blanc', 15),
('sauvignon_blanc', 'sancerre', NULL, 'white', 'premium', 1, 6, 3, 'high', 'Sancerre', 15),
('sauvignon_blanc', 'pouilly_fume', NULL, 'white', 'premium', 2, 8, 4, 'high', 'Pouilly-Fume', 15),
('sauvignon_blanc', 'bordeaux', NULL, 'white', 'premium', 2, 10, 5, 'medium', 'White Bordeaux (oaked)', 20),
('sauvignon_blanc', 'constantia', NULL, 'white', 'premium', 1, 6, 3, 'medium', 'Constantia Sauvignon Blanc', 20),
('sauvignon_blanc', NULL, NULL, 'white', NULL, 1, 4, 2, 'low', 'Generic Sauvignon Blanc', 50);

-- RIESLING
INSERT INTO drinking_window_defaults (grape, region, style, colour, quality_tier, drink_from_offset, drink_by_offset, peak_offset, confidence, notes, priority) VALUES
('riesling', 'mosel', 'trockenbeerenauslese', 'white', 'icon', 10, 50, 25, 'high', 'TBA - virtually immortal', 5),
('riesling', 'mosel', 'auslese', 'white', 'premium', 5, 30, 15, 'high', 'Auslese - very long-lived', 10),
('riesling', 'mosel', 'spatlese', 'white', 'premium', 3, 20, 10, 'high', 'Spatlese', 15),
('riesling', 'mosel', 'kabinett', 'white', 'mid', 2, 12, 5, 'high', 'Kabinett', 20),
('riesling', 'rheingau', NULL, 'white', 'premium', 3, 18, 8, 'high', 'Rheingau Riesling', 15),
('riesling', 'alsace', 'grand_cru', 'white', 'premium', 5, 25, 12, 'high', 'Alsace Grand Cru', 10),
('riesling', 'alsace', NULL, 'white', 'mid', 2, 12, 5, 'high', 'Alsace Riesling', 20),
('riesling', 'clare_valley', NULL, 'white', 'premium', 3, 15, 7, 'medium', 'Clare Valley Riesling', 20),
('riesling', 'eden_valley', NULL, 'white', 'premium', 3, 15, 7, 'medium', 'Eden Valley Riesling', 20),
('riesling', NULL, 'dry', 'white', NULL, 2, 10, 5, 'medium', 'Dry Riesling generic', 40),
('riesling', NULL, 'sweet', 'white', NULL, 5, 25, 12, 'medium', 'Sweet Riesling generic', 40),
('riesling', NULL, NULL, 'white', NULL, 2, 10, 5, 'low', 'Generic Riesling', 50);

-- PINOT GRIGIO / PINOT GRIS
INSERT INTO drinking_window_defaults (grape, region, style, colour, quality_tier, drink_from_offset, drink_by_offset, peak_offset, confidence, notes, priority) VALUES
('pinot_grigio', 'alto_adige', NULL, 'white', 'premium', 1, 5, 2, 'high', 'Alto Adige Pinot Grigio', 15),
('pinot_grigio', 'friuli', NULL, 'white', 'mid', 1, 4, 2, 'medium', 'Friuli Pinot Grigio', 20),
('pinot_gris', 'alsace', NULL, 'white', 'premium', 2, 10, 5, 'high', 'Alsace Pinot Gris - richer style', 15),
('pinot_gris', 'oregon', NULL, 'white', 'mid', 1, 5, 2, 'medium', 'Oregon Pinot Gris', 25),
('pinot_grigio', NULL, NULL, 'white', NULL, 1, 3, 1, 'low', 'Generic Pinot Grigio', 50),
('pinot_gris', NULL, NULL, 'white', NULL, 1, 5, 2, 'low', 'Generic Pinot Gris', 50);

-- GEWURZTRAMINER
INSERT INTO drinking_window_defaults (grape, region, style, colour, quality_tier, drink_from_offset, drink_by_offset, peak_offset, confidence, notes, priority) VALUES
('gewurztraminer', 'alsace', 'vendange_tardive', 'white', 'premium', 5, 20, 10, 'high', 'Alsace VT Gewurztraminer', 10),
('gewurztraminer', 'alsace', NULL, 'white', 'mid', 2, 8, 4, 'high', 'Alsace Gewurztraminer', 15),
('gewurztraminer', NULL, NULL, 'white', NULL, 1, 5, 2, 'low', 'Generic Gewurztraminer', 50);

-- VIOGNIER
INSERT INTO drinking_window_defaults (grape, region, style, colour, quality_tier, drink_from_offset, drink_by_offset, peak_offset, confidence, notes, priority) VALUES
('viognier', 'condrieu', NULL, 'white', 'premium', 2, 8, 4, 'high', 'Condrieu', 10),
('viognier', NULL, NULL, 'white', NULL, 1, 5, 2, 'low', 'Generic Viognier', 50);

-- CHENIN BLANC
INSERT INTO drinking_window_defaults (grape, region, style, colour, quality_tier, drink_from_offset, drink_by_offset, peak_offset, confidence, notes, priority) VALUES
('chenin_blanc', 'vouvray', 'moelleux', 'white', 'premium', 5, 30, 15, 'high', 'Vouvray Moelleux - very long-lived', 10),
('chenin_blanc', 'vouvray', 'sec', 'white', 'mid', 2, 10, 5, 'high', 'Vouvray Sec', 20),
('chenin_blanc', 'savennieres', NULL, 'white', 'premium', 5, 25, 12, 'high', 'Savennieres', 15),
('chenin_blanc', 'stellenbosch', NULL, 'white', 'premium', 2, 10, 5, 'medium', 'Old Vine Stellenbosch Chenin', 20),
('chenin_blanc', 'swartland', NULL, 'white', 'premium', 2, 10, 5, 'medium', 'Swartland Chenin Blanc', 20),
('chenin_blanc', NULL, NULL, 'white', NULL, 1, 5, 2, 'low', 'Generic Chenin Blanc', 50);

-- GRUNER VELTLINER
INSERT INTO drinking_window_defaults (grape, region, style, colour, quality_tier, drink_from_offset, drink_by_offset, peak_offset, confidence, notes, priority) VALUES
('gruner_veltliner', 'wachau', 'smaragd', 'white', 'premium', 3, 15, 7, 'high', 'Wachau Smaragd', 10),
('gruner_veltliner', 'wachau', 'federspiel', 'white', 'mid', 2, 8, 4, 'high', 'Wachau Federspiel', 15),
('gruner_veltliner', 'wachau', 'steinfeder', 'white', 'entry', 1, 3, 1, 'high', 'Wachau Steinfeder', 20),
('gruner_veltliner', NULL, NULL, 'white', NULL, 1, 5, 2, 'low', 'Generic Gruner Veltliner', 50);

-- ALBARINO
INSERT INTO drinking_window_defaults (grape, region, style, colour, quality_tier, drink_from_offset, drink_by_offset, peak_offset, confidence, notes, priority) VALUES
('albarino', 'rias_baixas', NULL, 'white', 'premium', 1, 6, 3, 'high', 'Rias Baixas Albarino', 15),
('albarino', NULL, NULL, 'white', NULL, 1, 4, 2, 'low', 'Generic Albarino', 50);

-- VERDEJO
INSERT INTO drinking_window_defaults (grape, region, style, colour, quality_tier, drink_from_offset, drink_by_offset, peak_offset, confidence, notes, priority) VALUES
('verdejo', 'rueda', NULL, 'white', 'mid', 1, 5, 2, 'high', 'Rueda Verdejo', 15),
('verdejo', NULL, NULL, 'white', NULL, 1, 4, 2, 'low', 'Generic Verdejo', 50);

-- VERMENTINO
INSERT INTO drinking_window_defaults (grape, region, style, colour, quality_tier, drink_from_offset, drink_by_offset, peak_offset, confidence, notes, priority) VALUES
('vermentino', 'sardinia', NULL, 'white', 'mid', 1, 5, 2, 'medium', 'Sardinian Vermentino', 20),
('vermentino', 'liguria', NULL, 'white', 'mid', 1, 4, 2, 'medium', 'Ligurian Vermentino', 25),
('vermentino', NULL, NULL, 'white', NULL, 1, 4, 2, 'low', 'Generic Vermentino', 50);

-- SEMILLON
INSERT INTO drinking_window_defaults (grape, region, style, colour, quality_tier, drink_from_offset, drink_by_offset, peak_offset, confidence, notes, priority) VALUES
('semillon', 'hunter_valley', NULL, 'white', 'premium', 5, 25, 12, 'high', 'Hunter Valley Semillon - ages remarkably', 10),
('semillon', 'bordeaux', NULL, 'white', 'premium', 3, 15, 7, 'medium', 'White Bordeaux Semillon blend', 20),
('semillon', NULL, NULL, 'white', NULL, 1, 6, 3, 'low', 'Generic Semillon', 50);


-- =============================================================================
-- ROSE WINES
-- =============================================================================

INSERT INTO drinking_window_defaults (grape, region, style, colour, quality_tier, drink_from_offset, drink_by_offset, peak_offset, confidence, notes, priority) VALUES
(NULL, 'provence', NULL, 'rose', 'premium', 1, 3, 1, 'high', 'Provence Rose', 15),
(NULL, 'provence', NULL, 'rose', 'mid', 1, 2, 1, 'high', 'Standard Provence Rose', 20),
(NULL, 'tavel', NULL, 'rose', 'premium', 1, 5, 2, 'high', 'Tavel - can age slightly', 15),
(NULL, 'navarra', NULL, 'rose', 'mid', 1, 2, 1, 'medium', 'Navarra Rosado', 25),
(NULL, NULL, NULL, 'rose', NULL, 1, 2, 1, 'medium', 'Generic Rose - drink young', 50);


-- =============================================================================
-- SPARKLING WINES
-- =============================================================================

INSERT INTO drinking_window_defaults (grape, region, style, colour, quality_tier, drink_from_offset, drink_by_offset, peak_offset, confidence, notes, priority) VALUES
(NULL, 'champagne', 'vintage', 'sparkling', 'icon', 10, 30, 18, 'high', 'Prestige Cuvee / Dom Perignon etc.', 5),
(NULL, 'champagne', 'vintage', 'sparkling', 'premium', 5, 20, 10, 'high', 'Vintage Champagne', 10),
(NULL, 'champagne', NULL, 'sparkling', 'mid', 1, 5, 2, 'high', 'NV Champagne', 20),
(NULL, 'franciacorta', 'riserva', 'sparkling', 'premium', 5, 15, 8, 'medium', 'Franciacorta Riserva', 15),
(NULL, 'franciacorta', NULL, 'sparkling', 'mid', 2, 8, 4, 'medium', 'Franciacorta', 25),
(NULL, 'english_sparkling', NULL, 'sparkling', 'premium', 3, 12, 6, 'medium', 'English Sparkling Wine', 20),
('cava', NULL, 'gran_reserva', 'sparkling', 'mid', 3, 10, 5, 'medium', 'Cava Gran Reserva', 20),
('cava', NULL, 'reserva', 'sparkling', 'mid', 2, 6, 3, 'medium', 'Cava Reserva', 25),
('cava', NULL, NULL, 'sparkling', 'entry', 1, 3, 1, 'medium', 'Basic Cava', 30),
(NULL, 'prosecco', NULL, 'sparkling', 'mid', 1, 2, 1, 'high', 'Prosecco - drink very young', 20),
(NULL, NULL, NULL, 'sparkling', NULL, 1, 4, 2, 'low', 'Generic Sparkling', 50);


-- =============================================================================
-- DESSERT / FORTIFIED WINES
-- =============================================================================

-- Sauternes & sweet Bordeaux
INSERT INTO drinking_window_defaults (grape, region, style, colour, quality_tier, drink_from_offset, drink_by_offset, peak_offset, confidence, notes, priority) VALUES
(NULL, 'sauternes', NULL, 'dessert', 'icon', 15, 100, 40, 'high', 'Top Sauternes - essentially immortal', 5),
(NULL, 'sauternes', NULL, 'dessert', 'premium', 10, 50, 25, 'high', 'Quality Sauternes', 10),
(NULL, 'barsac', NULL, 'dessert', 'premium', 8, 40, 20, 'high', 'Barsac', 15);

-- Port
INSERT INTO drinking_window_defaults (grape, region, style, colour, quality_tier, drink_from_offset, drink_by_offset, peak_offset, confidence, notes, priority) VALUES
(NULL, 'port', 'vintage', 'dessert', 'premium', 15, 60, 30, 'high', 'Vintage Port', 10),
(NULL, 'port', 'lbv', 'dessert', 'mid', 1, 15, 7, 'high', 'LBV Port', 20),
(NULL, 'port', 'tawny_aged', 'dessert', 'premium', 1, 50, NULL, 'high', 'Aged Tawny - no peak, stable', 15),
(NULL, 'port', 'ruby', 'dessert', 'entry', 1, 5, 2, 'high', 'Ruby Port', 30);

-- Sherry
INSERT INTO drinking_window_defaults (grape, region, style, colour, quality_tier, drink_from_offset, drink_by_offset, peak_offset, confidence, notes, priority) VALUES
(NULL, 'sherry', 'fino', 'dessert', 'mid', 1, 2, 1, 'high', 'Fino/Manzanilla - drink immediately', 10),
(NULL, 'sherry', 'amontillado', 'dessert', 'mid', 1, 10, 5, 'high', 'Amontillado', 15),
(NULL, 'sherry', 'oloroso', 'dessert', 'mid', 1, 20, 10, 'high', 'Oloroso', 15),
(NULL, 'sherry', 'px', 'dessert', 'mid', 1, 30, 15, 'high', 'Pedro Ximenez', 15);

-- Madeira
INSERT INTO drinking_window_defaults (grape, region, style, colour, quality_tier, drink_from_offset, drink_by_offset, peak_offset, confidence, notes, priority) VALUES
(NULL, 'madeira', NULL, 'dessert', 'premium', 1, 200, NULL, 'high', 'Madeira - virtually indestructible', 10);

-- Vin Santo
INSERT INTO drinking_window_defaults (grape, region, style, colour, quality_tier, drink_from_offset, drink_by_offset, peak_offset, confidence, notes, priority) VALUES
(NULL, 'vin_santo', NULL, 'dessert', 'premium', 5, 30, 15, 'medium', 'Vin Santo', 20);

-- Tokaji
INSERT INTO drinking_window_defaults (grape, region, style, colour, quality_tier, drink_from_offset, drink_by_offset, peak_offset, confidence, notes, priority) VALUES
(NULL, 'tokaji', 'aszu', 'dessert', 'premium', 10, 50, 25, 'high', 'Tokaji Aszu', 10);

-- Ice Wine
INSERT INTO drinking_window_defaults (grape, region, style, colour, quality_tier, drink_from_offset, drink_by_offset, peak_offset, confidence, notes, priority) VALUES
('icewine', NULL, NULL, 'dessert', 'premium', 5, 25, 12, 'medium', 'Ice Wine', 20);

-- Generic dessert
INSERT INTO drinking_window_defaults (grape, region, style, colour, quality_tier, drink_from_offset, drink_by_offset, peak_offset, confidence, notes, priority) VALUES
(NULL, NULL, NULL, 'dessert', NULL, 3, 20, 10, 'low', 'Generic Dessert Wine', 50);


-- =============================================================================
-- GENERIC FALLBACKS BY COLOUR (lowest priority)
-- =============================================================================

INSERT INTO drinking_window_defaults (grape, region, style, colour, quality_tier, drink_from_offset, drink_by_offset, peak_offset, confidence, notes, priority) VALUES
(NULL, NULL, NULL, 'red', 'icon', 8, 30, 15, 'low', 'Icon red wine - generic', 90),
(NULL, NULL, NULL, 'red', 'premium', 4, 15, 8, 'low', 'Premium red wine - generic', 92),
(NULL, NULL, NULL, 'red', 'mid', 2, 10, 5, 'low', 'Mid-tier red wine - generic', 94),
(NULL, NULL, NULL, 'red', 'entry', 1, 5, 2, 'low', 'Entry red wine - generic', 96),
(NULL, NULL, NULL, 'red', NULL, 2, 8, 4, 'low', 'Red wine - unknown tier', 98),

(NULL, NULL, NULL, 'white', 'icon', 5, 20, 10, 'low', 'Icon white wine - generic', 90),
(NULL, NULL, NULL, 'white', 'premium', 2, 10, 5, 'low', 'Premium white wine - generic', 92),
(NULL, NULL, NULL, 'white', 'mid', 1, 6, 3, 'low', 'Mid-tier white wine - generic', 94),
(NULL, NULL, NULL, 'white', 'entry', 1, 3, 1, 'low', 'Entry white wine - generic', 96),
(NULL, NULL, NULL, 'white', NULL, 1, 5, 2, 'low', 'White wine - unknown tier', 98),

(NULL, NULL, NULL, 'rose', NULL, 1, 2, 1, 'low', 'Rose - always drink young', 98),
(NULL, NULL, NULL, 'sparkling', NULL, 1, 4, 2, 'low', 'Sparkling - generic', 98),
(NULL, NULL, NULL, 'dessert', NULL, 3, 20, 10, 'low', 'Dessert wine - generic', 98);
