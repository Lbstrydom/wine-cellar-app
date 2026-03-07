-- Migration 066: Add colour_zone column to storage_areas
--
-- WHY: With multiple storage areas per cellar, the white/red row boundary must
-- be computed per area. A garage rack might be all reds while the main cellar
-- is mixed. The colour_zone field lets users designate each area's colour purpose.
--
-- Values: 'white' | 'red' | 'mixed' (default)
-- - 'mixed': proportional split computed from that area's inventory
-- - 'white': all rows unconditionally white-family
-- - 'red':   all rows unconditionally red

ALTER TABLE storage_areas
  ADD COLUMN IF NOT EXISTS colour_zone TEXT NOT NULL DEFAULT 'mixed'
  CONSTRAINT storage_areas_colour_zone_check
    CHECK (colour_zone IN ('white', 'red', 'mixed'));

COMMENT ON COLUMN storage_areas.colour_zone IS
  'Colour family this area is dedicated to. white = white-family only, '
  'red = reds only, mixed = proportional split computed from inventory.';
