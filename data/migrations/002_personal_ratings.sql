-- Migration: Add personal ratings and drink window columns
-- Phase 5: Refinements

-- Personal ratings on wines
ALTER TABLE wines ADD COLUMN personal_rating REAL;
ALTER TABLE wines ADD COLUMN personal_notes TEXT;
ALTER TABLE wines ADD COLUMN personal_rated_at DATETIME;

-- Drink window fields
ALTER TABLE wines ADD COLUMN drink_from INTEGER;
ALTER TABLE wines ADD COLUMN drink_peak INTEGER;
ALTER TABLE wines ADD COLUMN drink_until INTEGER;
