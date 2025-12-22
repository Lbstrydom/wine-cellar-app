-- Migration: Add tasting notes column for professional/critic notes
-- This stores default tasting notes fetched from critics when searching for ratings

ALTER TABLE wines ADD COLUMN tasting_notes TEXT;
