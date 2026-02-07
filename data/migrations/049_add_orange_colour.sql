-- Migration 049: Add 'orange' to wine colour enum
-- Also adds 'dessert' and 'fortified' which were in Zod schema but missing from DB constraint

-- PostgreSQL: drop and recreate CHECK constraint
ALTER TABLE wines DROP CONSTRAINT IF EXISTS wines_colour_check;
ALTER TABLE wines ADD CONSTRAINT wines_colour_check
  CHECK (colour IN ('red', 'white', 'rose', 'orange', 'sparkling', 'dessert', 'fortified'));
