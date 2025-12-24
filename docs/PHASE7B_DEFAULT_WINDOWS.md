# Phase 7b: Default Drinking Window Matrix

## Overview

When no critic or user-defined drinking window exists, the app should estimate a reasonable window based on grape variety, wine style, region, and quality tier. This document provides a comprehensive fallback matrix derived from sommelier expertise.

---

## 1. Database Schema

### 1.1 Migration: Create Default Windows Table

Create file: `migrations/008_default_drinking_windows.sql`

```sql
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

CREATE INDEX idx_dwd_grape ON drinking_window_defaults(grape);
CREATE INDEX idx_dwd_style ON drinking_window_defaults(style);
CREATE INDEX idx_dwd_region ON drinking_window_defaults(region);
CREATE INDEX idx_dwd_colour ON drinking_window_defaults(colour);
CREATE INDEX idx_dwd_priority ON drinking_window_defaults(priority);
```

### 1.2 Seed Data: Core Defaults

```sql
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
('merlot', 'saint_emilion', NULL, 'red', 'premium', 6, 25, 12, 'high', 'Saint-Émilion Grand Cru', 15),
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
('syrah', 'cote_rotie', NULL, 'red', 'premium', 8, 30, 15, 'high', 'Côte-Rôtie', 10),
('syrah', 'cornas', NULL, 'red', 'premium', 6, 25, 12, 'high', 'Cornas', 15),
('syrah', 'rhone', NULL, 'red', 'mid', 3, 12, 6, 'medium', 'Northern Rhône generic', 30),
('shiraz', 'barossa', NULL, 'red', 'icon', 8, 30, 15, 'high', 'Icon Barossa Shiraz', 10),
('shiraz', 'barossa', NULL, 'red', 'premium', 5, 20, 10, 'high', 'Premium Barossa Shiraz', 15),
('shiraz', 'barossa', NULL, 'red', 'mid', 3, 12, 6, 'medium', 'Standard Barossa Shiraz', 25),
('shiraz', 'mclaren_vale', NULL, 'red', 'premium', 4, 18, 8, 'medium', 'McLaren Vale Shiraz', 20),
('shiraz', 'hunter_valley', NULL, 'red', 'premium', 5, 25, 12, 'medium', 'Hunter Valley Shiraz - ages well', 20),
('syrah', NULL, NULL, 'red', NULL, 3, 12, 6, 'low', 'Generic Syrah', 50),
('shiraz', NULL, NULL, 'red', NULL, 2, 10, 5, 'low', 'Generic Shiraz', 50);

-- GRENACHE / GARNACHA
INSERT INTO drinking_window_defaults (grape, region, style, colour, quality_tier, drink_from_offset, drink_by_offset, peak_offset, confidence, notes, priority) VALUES
('grenache', 'chateauneuf', NULL, 'red', 'premium', 5, 20, 10, 'high', 'Châteauneuf-du-Pape', 15),
('grenache', 'rhone', NULL, 'red', 'mid', 3, 12, 6, 'medium', 'Southern Rhône', 25),
('garnacha', 'priorat', NULL, 'red', 'premium', 5, 20, 10, 'high', 'Priorat', 15),
('garnacha', 'carinena', 'gran_reserva', 'red', 'mid', 4, 12, 7, 'medium', 'Cariñena Gran Reserva', 20),
('garnacha', 'carinena', 'reserva', 'red', 'mid', 3, 10, 5, 'medium', 'Cariñena Reserva', 25),
('garnacha', 'carinena', NULL, 'red', 'entry', 1, 6, 3, 'medium', 'Cariñena basic', 30),
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
('carmenere', 'chile', NULL, 'red', 'premium', 3, 12, 6, 'medium', 'Premium Chilean Carménère', 20),
('carmenere', 'chile', NULL, 'red', 'mid', 2, 8, 4, 'medium', 'Standard Carménère', 30),
('carmenere', NULL, NULL, 'red', NULL, 2, 8, 4, 'low', 'Generic Carménère', 50);

-- TOURIGA NACIONAL
INSERT INTO drinking_window_defaults (grape, region, style, colour, quality_tier, drink_from_offset, drink_by_offset, peak_offset, confidence, notes, priority) VALUES
('touriga_nacional', 'douro', NULL, 'red', 'premium', 5, 20, 10, 'medium', 'Douro Touriga Nacional', 20),
('touriga_nacional', 'dao', NULL, 'red', 'premium', 4, 18, 8, 'medium', 'Dão Touriga Nacional', 25),
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
('sauvignon_blanc', 'pouilly_fume', NULL, 'white', 'premium', 2, 8, 4, 'high', 'Pouilly-Fumé', 15),
('sauvignon_blanc', 'bordeaux', NULL, 'white', 'premium', 2, 10, 5, 'medium', 'White Bordeaux (oaked)', 20),
('sauvignon_blanc', 'constantia', NULL, 'white', 'premium', 1, 6, 3, 'medium', 'Constantia Sauvignon Blanc', 20),
('sauvignon_blanc', NULL, NULL, 'white', NULL, 1, 4, 2, 'low', 'Generic Sauvignon Blanc', 50);

-- RIESLING
INSERT INTO drinking_window_defaults (grape, region, style, colour, quality_tier, drink_from_offset, drink_by_offset, peak_offset, confidence, notes, priority) VALUES
('riesling', 'mosel', 'trockenbeerenauslese', 'white', 'icon', 10, 50, 25, 'high', 'TBA - virtually immortal', 5),
('riesling', 'mosel', 'auslese', 'white', 'premium', 5, 30, 15, 'high', 'Auslese - very long-lived', 10),
('riesling', 'mosel', 'spatlese', 'white', 'premium', 3, 20, 10, 'high', 'Spätlese', 15),
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

-- GEWÜRZTRAMINER
INSERT INTO drinking_window_defaults (grape, region, style, colour, quality_tier, drink_from_offset, drink_by_offset, peak_offset, confidence, notes, priority) VALUES
('gewurztraminer', 'alsace', 'vendange_tardive', 'white', 'premium', 5, 20, 10, 'high', 'Alsace VT Gewürztraminer', 10),
('gewurztraminer', 'alsace', NULL, 'white', 'mid', 2, 8, 4, 'high', 'Alsace Gewürztraminer', 15),
('gewurztraminer', NULL, NULL, 'white', NULL, 1, 5, 2, 'low', 'Generic Gewürztraminer', 50);

-- VIOGNIER
INSERT INTO drinking_window_defaults (grape, region, style, colour, quality_tier, drink_from_offset, drink_by_offset, peak_offset, confidence, notes, priority) VALUES
('viognier', 'condrieu', NULL, 'white', 'premium', 2, 8, 4, 'high', 'Condrieu', 10),
('viognier', NULL, NULL, 'white', NULL, 1, 5, 2, 'low', 'Generic Viognier', 50);

-- CHENIN BLANC
INSERT INTO drinking_window_defaults (grape, region, style, colour, quality_tier, drink_from_offset, drink_by_offset, peak_offset, confidence, notes, priority) VALUES
('chenin_blanc', 'vouvray', 'moelleux', 'white', 'premium', 5, 30, 15, 'high', 'Vouvray Moelleux - very long-lived', 10),
('chenin_blanc', 'vouvray', 'sec', 'white', 'mid', 2, 10, 5, 'high', 'Vouvray Sec', 20),
('chenin_blanc', 'savennieres', NULL, 'white', 'premium', 5, 25, 12, 'high', 'Savennières', 15),
('chenin_blanc', 'stellenbosch', NULL, 'white', 'premium', 2, 10, 5, 'medium', 'Old Vine Stellenbosch Chenin', 20),
('chenin_blanc', 'swartland', NULL, 'white', 'premium', 2, 10, 5, 'medium', 'Swartland Chenin Blanc', 20),
('chenin_blanc', NULL, NULL, 'white', NULL, 1, 5, 2, 'low', 'Generic Chenin Blanc', 50);

-- GRÜNER VELTLINER
INSERT INTO drinking_window_defaults (grape, region, style, colour, quality_tier, drink_from_offset, drink_by_offset, peak_offset, confidence, notes, priority) VALUES
('gruner_veltliner', 'wachau', 'smaragd', 'white', 'premium', 3, 15, 7, 'high', 'Wachau Smaragd', 10),
('gruner_veltliner', 'wachau', 'federspiel', 'white', 'mid', 2, 8, 4, 'high', 'Wachau Federspiel', 15),
('gruner_veltliner', 'wachau', 'steinfeder', 'white', 'entry', 1, 3, 1, 'high', 'Wachau Steinfeder', 20),
('gruner_veltliner', NULL, NULL, 'white', NULL, 1, 5, 2, 'low', 'Generic Grüner Veltliner', 50);

-- ALBARIÑO
INSERT INTO drinking_window_defaults (grape, region, style, colour, quality_tier, drink_from_offset, drink_by_offset, peak_offset, confidence, notes, priority) VALUES
('albarino', 'rias_baixas', NULL, 'white', 'premium', 1, 6, 3, 'high', 'Rías Baixas Albariño', 15),
('albarino', NULL, NULL, 'white', NULL, 1, 4, 2, 'low', 'Generic Albariño', 50);

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
-- ROSÉ WINES
-- =============================================================================

INSERT INTO drinking_window_defaults (grape, region, style, colour, quality_tier, drink_from_offset, drink_by_offset, peak_offset, confidence, notes, priority) VALUES
(NULL, 'provence', NULL, 'rose', 'premium', 1, 3, 1, 'high', 'Provence Rosé', 15),
(NULL, 'provence', NULL, 'rose', 'mid', 1, 2, 1, 'high', 'Standard Provence Rosé', 20),
(NULL, 'tavel', NULL, 'rose', 'premium', 1, 5, 2, 'high', 'Tavel - can age slightly', 15),
(NULL, 'navarra', NULL, 'rose', 'mid', 1, 2, 1, 'medium', 'Navarra Rosado', 25),
(NULL, NULL, NULL, 'rose', NULL, 1, 2, 1, 'medium', 'Generic Rosé - drink young', 50);


-- =============================================================================
-- SPARKLING WINES
-- =============================================================================

INSERT INTO drinking_window_defaults (grape, region, style, colour, quality_tier, drink_from_offset, drink_by_offset, peak_offset, confidence, notes, priority) VALUES
(NULL, 'champagne', 'vintage', 'sparkling', 'icon', 10, 30, 18, 'high', 'Prestige Cuvée / Dom Pérignon etc.', 5),
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

INSERT INTO drinking_window_defaults (grape, region, style, colour, quality_tier, drink_from_offset, drink_by_offset, peak_offset, confidence, notes, priority) VALUES
-- Sauternes & sweet Bordeaux
(NULL, 'sauternes', NULL, 'dessert', 'icon', 15, 100, 40, 'high', 'Top Sauternes - essentially immortal', 5),
(NULL, 'sauternes', NULL, 'dessert', 'premium', 10, 50, 25, 'high', 'Quality Sauternes', 10),
(NULL, 'barsac', NULL, 'dessert', 'premium', 8, 40, 20, 'high', 'Barsac', 15),

-- Port
(NULL, 'port', 'vintage', 'dessert', 'premium', 15, 60, 30, 'high', 'Vintage Port', 10),
(NULL, 'port', 'lbv', 'dessert', 'mid', 1, 15, 7, 'high', 'LBV Port', 20),
(NULL, 'port', 'tawny_aged', 'dessert', 'premium', 1, 50, NULL, 'high', 'Aged Tawny - no peak, stable', 15),
(NULL, 'port', 'ruby', 'dessert', 'entry', 1, 5, 2, 'high', 'Ruby Port', 30),

-- Sherry
(NULL, 'sherry', 'fino', 'dessert', 'mid', 1, 2, 1, 'high', 'Fino/Manzanilla - drink immediately', 10),
(NULL, 'sherry', 'amontillado', 'dessert', 'mid', 1, 10, 5, 'high', 'Amontillado', 15),
(NULL, 'sherry', 'oloroso', 'dessert', 'mid', 1, 20, 10, 'high', 'Oloroso', 15),
(NULL, 'sherry', 'px', 'dessert', 'mid', 1, 30, 15, 'high', 'Pedro Ximénez', 15),

-- Madeira
(NULL, 'madeira', NULL, 'dessert', 'premium', 1, 200, NULL, 'high', 'Madeira - virtually indestructible', 10),

-- Vin Santo
(NULL, 'vin_santo', NULL, 'dessert', 'premium', 5, 30, 15, 'medium', 'Vin Santo', 20),

-- Tokaji
(NULL, 'tokaji', 'aszu', 'dessert', 'premium', 10, 50, 25, 'high', 'Tokaji Aszú', 10),

-- Ice Wine
('icewine', NULL, NULL, 'dessert', 'premium', 5, 25, 12, 'medium', 'Ice Wine', 20),

-- Generic dessert
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

(NULL, NULL, NULL, 'rose', NULL, 1, 2, 1, 'low', 'Rosé - always drink young', 98),
(NULL, NULL, NULL, 'sparkling', NULL, 1, 4, 2, 'low', 'Sparkling - generic', 98),
(NULL, NULL, NULL, 'dessert', NULL, 3, 20, 10, 'low', 'Dessert wine - generic', 98);
```

---

## 2. Lookup Function

### 2.1 Backend: `getDefaultDrinkingWindow()`

Add to `drinkingWindows.js` or create `windowDefaults.js`:

```javascript
/**
 * Get estimated drinking window from defaults matrix
 * @param {object} wine - Wine object with grape, region, country, colour, style, price
 * @param {number} vintage - Vintage year
 * @returns {object|null} - { drink_from, drink_by, peak, confidence, source: 'default_matrix' }
 */
async function getDefaultDrinkingWindow(wine, vintage) {
  if (!vintage) return null;
  
  const { grape, region, country, colour, style } = wine;
  const qualityTier = estimateQualityTier(wine);
  
  // Normalise inputs for matching
  const normGrape = normaliseGrape(grape);
  const normRegion = normaliseRegion(region);
  const normStyle = normaliseStyle(style);
  const normColour = normaliseColour(colour);
  
  // Query with fallback matching - most specific first (lowest priority number)
  const defaultWindow = await db.get(`
    SELECT 
      drink_from_offset,
      drink_by_offset,
      peak_offset,
      confidence,
      notes
    FROM drinking_window_defaults
    WHERE 
      (grape = ? OR grape IS NULL)
      AND (region = ? OR region IS NULL)
      AND (style = ? OR style IS NULL)
      AND (colour = ? OR colour IS NULL)
      AND (quality_tier = ? OR quality_tier IS NULL)
      AND (country = ? OR country IS NULL)
    ORDER BY priority ASC
    LIMIT 1
  `, [normGrape, normRegion, normStyle, normColour, qualityTier, country]);
  
  if (!defaultWindow) {
    // Ultimate fallback based on colour only
    return getFallbackByColour(colour, vintage);
  }
  
  return {
    drink_from: vintage + defaultWindow.drink_from_offset,
    drink_by: vintage + defaultWindow.drink_by_offset,
    peak: defaultWindow.peak_offset ? vintage + defaultWindow.peak_offset : null,
    confidence: defaultWindow.confidence,
    source: 'default_matrix',
    notes: defaultWindow.notes
  };
}

/**
 * Estimate quality tier from price and other signals
 */
function estimateQualityTier(wine) {
  const price = wine.price || wine.purchase_price;
  
  if (!price) return null;
  
  // EUR thresholds - adjust for your market
  if (price >= 100) return 'icon';
  if (price >= 30) return 'premium';
  if (price >= 12) return 'mid';
  return 'entry';
}

/**
 * Normalise grape name for matching
 */
function normaliseGrape(grape) {
  if (!grape) return null;
  
  const grapeMap = {
    // Aliases
    'shiraz': 'shiraz',  // Keep separate from syrah for regional matching
    'syrah': 'syrah',
    'pinot noir': 'pinot_noir',
    'pinot nero': 'pinot_noir',
    'cabernet sauvignon': 'cabernet_sauvignon',
    'cab sauv': 'cabernet_sauvignon',
    'sauv blanc': 'sauvignon_blanc',
    'sauvignon blanc': 'sauvignon_blanc',
    'pinot grigio': 'pinot_grigio',
    'pinot gris': 'pinot_gris',
    'grüner veltliner': 'gruner_veltliner',
    'gruner veltliner': 'gruner_veltliner',
    'gewürztraminer': 'gewurztraminer',
    'gewurztraminer': 'gewurztraminer',
    'nero d\'avola': 'nero_davola',
    'nero davola': 'nero_davola',
    'touriga nacional': 'touriga_nacional',
    'chenin blanc': 'chenin_blanc',
    'albarino': 'albarino',
    'albariño': 'albarino'
  };
  
  const lower = grape.toLowerCase().trim();
  return grapeMap[lower] || lower.replace(/\s+/g, '_');
}

/**
 * Normalise region for matching
 */
function normaliseRegion(region) {
  if (!region) return null;
  
  const regionMap = {
    // Italian
    'barolo': 'barolo',
    'barbaresco': 'barbaresco',
    'brunello di montalcino': 'brunello',
    'chianti classico': 'chianti_classico',
    'chianti': 'chianti',
    'romagna': 'romagna',
    'valpolicella': 'valpolicella',
    'amarone': 'amarone',
    'alto adige': 'alto_adige',
    'friuli': 'friuli',
    
    // French
    'bordeaux': 'bordeaux',
    'burgundy': 'burgundy',
    'bourgogne': 'burgundy',
    'chablis': 'chablis',
    'champagne': 'champagne',
    'rhone': 'rhone',
    'rhône': 'rhone',
    'northern rhone': 'rhone',
    'southern rhone': 'rhone',
    'hermitage': 'hermitage',
    'cote rotie': 'cote_rotie',
    'côte-rôtie': 'cote_rotie',
    'chateauneuf du pape': 'chateauneuf',
    'châteauneuf-du-pape': 'chateauneuf',
    'alsace': 'alsace',
    'loire': 'loire',
    'sancerre': 'sancerre',
    'vouvray': 'vouvray',
    'provence': 'provence',
    'sauternes': 'sauternes',
    'pomerol': 'pomerol',
    'saint emilion': 'saint_emilion',
    'saint-émilion': 'saint_emilion',
    
    // Spanish
    'rioja': 'rioja',
    'ribera del duero': 'ribera_del_duero',
    'priorat': 'priorat',
    'carinena': 'carinena',
    'cariñena': 'carinena',
    'rias baixas': 'rias_baixas',
    'rías baixas': 'rias_baixas',
    'rueda': 'rueda',
    'toro': 'toro',
    'navarra': 'navarra',
    
    // Portuguese
    'douro': 'douro',
    'dao': 'dao',
    'dão': 'dao',
    'port': 'port',
    'porto': 'port',
    'madeira': 'madeira',
    
    // German/Austrian
    'mosel': 'mosel',
    'rheingau': 'rheingau',
    'wachau': 'wachau',
    
    // Australian
    'barossa': 'barossa',
    'barossa valley': 'barossa',
    'mclaren vale': 'mclaren_vale',
    'hunter valley': 'hunter_valley',
    'clare valley': 'clare_valley',
    'eden valley': 'eden_valley',
    'margaret river': 'margaret_river',
    'coonawarra': 'coonawarra',
    
    // New Zealand
    'marlborough': 'marlborough',
    'central otago': 'central_otago',
    
    // South African
    'stellenbosch': 'stellenbosch',
    'constantia': 'constantia',
    'swartland': 'swartland',
    
    // American
    'napa': 'napa',
    'napa valley': 'napa',
    'sonoma': 'sonoma',
    'oregon': 'oregon',
    'willamette': 'oregon',
    
    // Argentine
    'mendoza': 'mendoza',
    'uco valley': 'uco_valley',
    
    // Chilean
    'chile': 'chile',
    'maipo': 'chile',
    'colchagua': 'chile'
  };
  
  const lower = region.toLowerCase().trim();
  return regionMap[lower] || lower.replace(/\s+/g, '_');
}

/**
 * Normalise style keywords
 */
function normaliseStyle(style) {
  if (!style) return null;
  
  const styleMap = {
    'riserva': 'riserva',
    'reserva': 'reserva',
    'gran reserva': 'gran_reserva',
    'gran riserva': 'gran_reserva',
    'crianza': 'crianza',
    'joven': 'joven',
    'ripasso': 'ripasso',
    'superiore': 'superiore',
    'appassimento': 'appassimento',
    'passito': 'appassimento',
    'vintage': 'vintage',
    'non vintage': 'nv',
    'nv': 'nv',
    'brut': 'brut',
    'grand cru': 'grand_cru',
    'premier cru': 'premier_cru',
    '1er cru': 'premier_cru',
    'smaragd': 'smaragd',
    'federspiel': 'federspiel',
    'steinfeder': 'steinfeder',
    'kabinett': 'kabinett',
    'spatlese': 'spatlese',
    'spätlese': 'spatlese',
    'auslese': 'auslese',
    'trockenbeerenauslese': 'trockenbeerenauslese',
    'tba': 'trockenbeerenauslese',
    'eiswein': 'eiswein',
    'ice wine': 'icewine',
    'late harvest': 'late_harvest',
    'vendange tardive': 'vendange_tardive',
    'moelleux': 'moelleux',
    'sec': 'sec',
    'unoaked': 'unoaked',
    'oaked': 'oaked'
  };
  
  const lower = style.toLowerCase().trim();
  return styleMap[lower] || lower.replace(/\s+/g, '_');
}

/**
 * Normalise colour
 */
function normaliseColour(colour) {
  if (!colour) return null;
  
  const colourMap = {
    'red': 'red',
    'white': 'white',
    'rose': 'rose',
    'rosé': 'rose',
    'rosado': 'rose',
    'sparkling': 'sparkling',
    'champagne': 'sparkling',
    'dessert': 'dessert',
    'sweet': 'dessert',
    'fortified': 'dessert'
  };
  
  return colourMap[colour.toLowerCase().trim()] || colour.toLowerCase();
}

/**
 * Ultimate fallback by colour
 */
function getFallbackByColour(colour, vintage) {
  const fallbacks = {
    'red': { from: 2, by: 8, peak: 4 },
    'white': { from: 1, by: 5, peak: 2 },
    'rose': { from: 1, by: 2, peak: 1 },
    'sparkling': { from: 1, by: 4, peak: 2 },
    'dessert': { from: 3, by: 20, peak: 10 }
  };
  
  const f = fallbacks[normaliseColour(colour)] || fallbacks['red'];
  
  return {
    drink_from: vintage + f.from,
    drink_by: vintage + f.by,
    peak: vintage + f.peak,
    confidence: 'low',
    source: 'colour_fallback',
    notes: 'Generic fallback by colour - no specific match found'
  };
}

module.exports = { 
  getDefaultDrinkingWindow, 
  estimateQualityTier,
  normaliseGrape,
  normaliseRegion,
  normaliseStyle,
  normaliseColour
};
```

---

## 3. Integration with Reduce-Now

### 3.1 Update Evaluate Endpoint

In `reduceNow.js`, when a wine has no drinking window, call the defaults:

```javascript
const { getDefaultDrinkingWindow } = require('./windowDefaults');

// In the evaluation loop for wines without windows:
if (includeNoWindow) {
  const noWindowWines = await db.all(`
    SELECT w.*
    FROM wines w
    LEFT JOIN drinking_windows dw ON w.id = dw.wine_id
    WHERE w.bottle_count > 0
      AND dw.id IS NULL
      AND w.vintage IS NOT NULL
  `);
  
  for (const wine of noWindowWines) {
    if (seenWineIds.has(wine.id)) continue;
    
    // Try to get a default window estimate
    const defaultWindow = await getDefaultDrinkingWindow(wine, wine.vintage);
    
    if (defaultWindow) {
      const currentYear = new Date().getFullYear();
      const yearsRemaining = defaultWindow.drink_by - currentYear;
      
      if (yearsRemaining <= 0) {
        // Past estimated window
        seenWineIds.add(wine.id);
        candidates.push({
          wine_id: wine.id,
          wine_name: wine.name,
          vintage: wine.vintage,
          priority: 2, // Not as urgent as critic-confirmed
          reason: `Estimated past drinking window (${defaultWindow.drink_by}) based on ${defaultWindow.notes}`,
          drink_by_year: defaultWindow.drink_by,
          window_source: 'default_matrix',
          urgency: 'estimated_critical',
          confidence: defaultWindow.confidence
        });
      } else if (yearsRemaining <= Math.ceil(urgencyMonths / 12)) {
        // Closing estimated window
        seenWineIds.add(wine.id);
        candidates.push({
          wine_id: wine.id,
          wine_name: wine.name,
          vintage: wine.vintage,
          priority: 3,
          reason: `Estimated window closes ${defaultWindow.drink_by} (${yearsRemaining} year${yearsRemaining > 1 ? 's' : ''} left) - ${defaultWindow.notes}`,
          drink_by_year: defaultWindow.drink_by,
          window_source: 'default_matrix',
          urgency: 'estimated_medium',
          confidence: defaultWindow.confidence
        });
      } else if (defaultWindow.peak && defaultWindow.peak === currentYear) {
        // At estimated peak
        seenWineIds.add(wine.id);
        candidates.push({
          wine_id: wine.id,
          wine_name: wine.name,
          vintage: wine.vintage,
          priority: 4,
          reason: `Estimated peak year (${defaultWindow.peak}) - ${defaultWindow.notes}`,
          peak_year: defaultWindow.peak,
          window_source: 'default_matrix',
          urgency: 'estimated_peak',
          confidence: defaultWindow.confidence
        });
      }
    } else {
      // No match even in defaults - truly unknown
      const age = currentYear - wine.vintage;
      if (age >= ageThreshold) {
        seenWineIds.add(wine.id);
        candidates.push({
          wine_id: wine.id,
          wine_name: wine.name,
          vintage: wine.vintage,
          priority: 5,
          reason: `Unknown wine type; vintage ${wine.vintage} is ${age} years old`,
          urgency: 'unknown',
          needs_identification: true
        });
      }
    }
  }
}
```

---

## 4. Wine Type Detection

### 4.1 Extract Grape/Region from Wine Name

Many wines don't have structured grape/region fields. Add a parser:

```javascript
/**
 * Extract grape, region, style from wine name
 * @param {string} wineName - Full wine name
 * @returns {object} - { grape, region, style, detected_from }
 */
function parseWineName(wineName) {
  if (!wineName) return {};
  
  const lower = wineName.toLowerCase();
  const result = { detected_from: [] };
  
  // Grape detection patterns
  const grapePatterns = [
    { pattern: /\bsangiovese\b/i, grape: 'sangiovese' },
    { pattern: /\bnebbiolo\b/i, grape: 'nebbiolo' },
    { pattern: /\bprimitivo\b/i, grape: 'primitivo' },
    { pattern: /\bzinfandel\b/i, grape: 'zinfandel' },
    { pattern: /\bcabernet\s*sauvignon\b/i, grape: 'cabernet_sauvignon' },
    { pattern: /\bmerlot\b/i, grape: 'merlot' },
    { pattern: /\bpinot\s*noir\b/i, grape: 'pinot_noir' },
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
    { pattern: /\bgewürztraminer\b/i, grape: 'gewurztraminer' },
    { pattern: /\bgewurztraminer\b/i, grape: 'gewurztraminer' },
    { pattern: /\balbarino\b/i, grape: 'albarino' },
    { pattern: /\balbariño\b/i, grape: 'albarino' },
    { pattern: /\bverdejo\b/i, grape: 'verdejo' },
    { pattern: /\bvermentino\b/i, grape: 'vermentino' },
    { pattern: /\btouriga\b/i, grape: 'touriga_nacional' },
    { pattern: /\baglianico\b/i, grape: 'aglianico' },
    { pattern: /\bnero\s*d.?avola\b/i, grape: 'nero_davola' },
    { pattern: /\bcorvina\b/i, grape: 'corvina' },
    { pattern: /\bgrüner\s*veltliner\b/i, grape: 'gruner_veltliner' }
  ];
  
  // Region detection patterns
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
    
    // French
    { pattern: /\bbordeaux\b/i, region: 'bordeaux' },
    { pattern: /\bbourgogne\b/i, region: 'burgundy' },
    { pattern: /\bburgund/i, region: 'burgundy' },
    { pattern: /\bchablis\b/i, region: 'chablis', grape: 'chardonnay' },
    { pattern: /\bchampagne\b/i, region: 'champagne' },
    { pattern: /\bsancerre\b/i, region: 'sancerre', grape: 'sauvignon_blanc' },
    { pattern: /\bpouilly[\s-]*fum[eé]\b/i, region: 'pouilly_fume', grape: 'sauvignon_blanc' },
    { pattern: /\bvouvray\b/i, region: 'vouvray', grape: 'chenin_blanc' },
    { pattern: /\bchâteauneuf\b/i, region: 'chateauneuf' },
    { pattern: /\bhermitage\b/i, region: 'hermitage', grape: 'syrah' },
    { pattern: /\bcôte[\s-]*rôtie\b/i, region: 'cote_rotie', grape: 'syrah' },
    { pattern: /\bprovence\b/i, region: 'provence' },
    { pattern: /\bsauternes\b/i, region: 'sauternes' },
    { pattern: /\balsace\b/i, region: 'alsace' },
    
    // Spanish
    { pattern: /\brioja\b/i, region: 'rioja', grape: 'tempranillo' },
    { pattern: /\bribera\s*del\s*duero\b/i, region: 'ribera_del_duero', grape: 'tempranillo' },
    { pattern: /\bpriorat\b/i, region: 'priorat' },
    { pattern: /\bcariñena\b/i, region: 'carinena' },
    { pattern: /\bcarinena\b/i, region: 'carinena' },
    { pattern: /\brías\s*baixas\b/i, region: 'rias_baixas', grape: 'albarino' },
    { pattern: /\brueda\b/i, region: 'rueda', grape: 'verdejo' },
    
    // Australian
    { pattern: /\bbarossa\b/i, region: 'barossa' },
    { pattern: /\bmclaren\s*vale\b/i, region: 'mclaren_vale' },
    { pattern: /\bhunter\s*valley\b/i, region: 'hunter_valley' },
    { pattern: /\bclare\s*valley\b/i, region: 'clare_valley' },
    { pattern: /\bmargaret\s*river\b/i, region: 'margaret_river' },
    { pattern: /\bcoonawarra\b/i, region: 'coonawarra' },
    
    // NZ
    { pattern: /\bmarlborough\b/i, region: 'marlborough' },
    { pattern: /\bcentral\s*otago\b/i, region: 'central_otago' },
    
    // South African
    { pattern: /\bstellenbosch\b/i, region: 'stellenbosch' },
    { pattern: /\bswartland\b/i, region: 'swartland' },
    
    // American
    { pattern: /\bnapa\b/i, region: 'napa' },
    { pattern: /\bsonoma\b/i, region: 'sonoma' },
    { pattern: /\boregon\b/i, region: 'oregon' },
    
    // Argentine
    { pattern: /\bmendoza\b/i, region: 'mendoza' },
    { pattern: /\buco\s*valley\b/i, region: 'uco_valley' }
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
    { pattern: /\bgrand\s*cru\b/i, style: 'grand_cru' },
    { pattern: /\bpremier\s*cru\b/i, style: 'premier_cru' },
    { pattern: /\b1er\s*cru\b/i, style: 'premier_cru' },
    { pattern: /\bgran\s*selezione\b/i, style: 'gran_selezione' }
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

module.exports = { parseWineName };
```

### 4.2 Use Parser in Default Window Lookup

```javascript
async function getDefaultDrinkingWindow(wine, vintage) {
  if (!vintage) return null;
  
  // Start with wine's structured fields
  let { grape, region, country, colour, style } = wine;
  
  // If missing, try to parse from wine name
  if (!grape || !region || !style) {
    const parsed = parseWineName(wine.name);
    grape = grape || parsed.grape;
    region = region || parsed.region;
    style = style || parsed.style;
  }
  
  // Continue with lookup...
}
```

---

## 5. Example: Galante Romagna Sangiovese Appassimento 2018

Given: `Galante Romagna Sangiovese Appassimento 2018`

Parser extracts:
- **Grape:** `sangiovese` (from "Sangiovese")
- **Region:** `romagna` (from "Romagna")
- **Style:** `appassimento` (from "Appassimento")

Lookup matches (in priority order):
1. `sangiovese + appassimento` (priority 20) → drink_from: +2, drink_by: +8, peak: +4

Result:
```json
{
  "drink_from": 2020,
  "drink_by": 2026,
  "peak": 2022,
  "confidence": "medium",
  "source": "default_matrix",
  "notes": "Appassimento style - richer, earlier peak"
}
```

**Assessment for December 2025:** Window closes in ~1 year, peak was 2022. This wine should be flagged as **urgency: medium** with reason "Estimated window closes 2026 (1 year left)".

---

## 6. File Summary

| File | Action |
|------|--------|
| `migrations/008_default_drinking_windows.sql` | Create - schema + seed data |
| `windowDefaults.js` | Create - lookup functions + normalisers |
| `wineNameParser.js` | Create - extract grape/region/style from name |
| `reduceNow.js` | Update - integrate default window lookup |

---

## 7. Testing Checklist

| Wine | Expected Match | Expected Window |
|------|----------------|-----------------|
| "Galante Romagna Sangiovese Appassimento 2018" | sangiovese + appassimento | 2020-2026 |
| "Barolo Riserva 2015" | nebbiolo + barolo + riserva | 2025-2045 |
| "Marlborough Sauvignon Blanc 2023" | sauvignon_blanc + marlborough | 2024-2027 |
| "Rioja Gran Reserva 2012" | tempranillo + rioja + gran_reserva | 2020-2037 |
| "Random Red Wine 2020" | colour fallback (red) | 2022-2028 |
| "Champagne Brut NV" | sparkling + champagne + NV | 2024-2029 |

---

## 8. Future Enhancements

1. **User corrections feed back** - If user overrides a default, learn from it
2. **Vintage variation** - Great vintages drink longer; poor vintages peak earlier
3. **Storage conditions** - Optimal vs suboptimal storage affects window
4. **Producer reputation** - Top producers' wines age longer than entry-level
