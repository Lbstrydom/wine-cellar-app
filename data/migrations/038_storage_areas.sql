-- Migration 038: Storage Areas
-- Replaces hardcoded fridge/cellar with user-definable storage areas
-- Each area has custom layout (variable rows/columns), storage type, and temperature zone

-- ============================================================================
-- PHASE 1: Create new tables
-- ============================================================================

-- Storage areas table: defines storage locations (wine fridge, cellar, rack, etc.)
-- Note: "is_for_chilling" is derived in application code from storage_type = 'kitchen_fridge'
CREATE TABLE IF NOT EXISTS storage_areas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cellar_id UUID NOT NULL REFERENCES cellars(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    storage_type TEXT NOT NULL CHECK (storage_type IN (
        'wine_fridge',      -- Temperature-controlled wine fridge (10-14°C)
        'kitchen_fridge',   -- Regular kitchen fridge (4-8°C) - chilling only, not storage
        'cellar',           -- Underground/temperature-stable cellar (12-16°C)
        'rack',             -- Wine rack at ambient temperature (18-25°C)
        'other'             -- Custom storage type
    )),
    temp_zone TEXT NOT NULL CHECK (temp_zone IN (
        'cold',             -- 4-8°C (kitchen fridge - chilling only)
        'cool',             -- 10-14°C (wine fridge)
        'cellar',           -- 12-16°C (stable cellar)
        'ambient'           -- 18-25°C (room temperature)
    )),
    display_order INTEGER NOT NULL DEFAULT 0,
    icon TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(cellar_id, name)
);

CREATE INDEX IF NOT EXISTS idx_storage_areas_cellar ON storage_areas(cellar_id);

-- Trigger to auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_storage_areas_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_storage_areas_updated_at ON storage_areas;
CREATE TRIGGER trigger_storage_areas_updated_at
    BEFORE UPDATE ON storage_areas
    FOR EACH ROW
    EXECUTE FUNCTION update_storage_areas_updated_at();

-- Storage area rows: supports variable column counts per row
CREATE TABLE IF NOT EXISTS storage_area_rows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    storage_area_id UUID NOT NULL REFERENCES storage_areas(id) ON DELETE CASCADE,
    row_num INTEGER NOT NULL CHECK (row_num >= 1 AND row_num <= 100),
    col_count INTEGER NOT NULL DEFAULT 9 CHECK (col_count >= 1 AND col_count <= 20),
    label TEXT,

    UNIQUE(storage_area_id, row_num)
);

CREATE INDEX IF NOT EXISTS idx_storage_area_rows_area ON storage_area_rows(storage_area_id);

-- ============================================================================
-- PHASE 2: Add storage_area_id and chilled_since to slots table
-- ============================================================================

-- Add the new columns (nullable initially for migration)
ALTER TABLE slots ADD COLUMN IF NOT EXISTS storage_area_id UUID REFERENCES storage_areas(id) ON DELETE CASCADE;

-- Track when wine entered kitchen fridge for time-based warnings
-- Only populated when slot is in a kitchen_fridge storage area
ALTER TABLE slots ADD COLUMN IF NOT EXISTS chilled_since TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_slots_storage_area ON slots(storage_area_id);

-- Trigger to manage chilled_since automatically based on storage area type
-- Sets timestamp when moving INTO kitchen fridge, clears when moving OUT
CREATE OR REPLACE FUNCTION manage_chilled_since()
RETURNS TRIGGER AS $$
DECLARE
    old_area_type TEXT;
    new_area_type TEXT;
BEGIN
    -- Get old storage area type (if any)
    IF OLD.storage_area_id IS NOT NULL THEN
        SELECT storage_type INTO old_area_type
        FROM storage_areas WHERE id = OLD.storage_area_id;
    END IF;

    -- Get new storage area type (if any)
    IF NEW.storage_area_id IS NOT NULL THEN
        SELECT storage_type INTO new_area_type
        FROM storage_areas WHERE id = NEW.storage_area_id;
    END IF;

    -- Moving INTO kitchen fridge: set timestamp if not already set
    IF new_area_type = 'kitchen_fridge' AND (old_area_type IS NULL OR old_area_type != 'kitchen_fridge') THEN
        NEW.chilled_since = COALESCE(NEW.chilled_since, NOW());
    -- Moving OUT OF kitchen fridge: clear timestamp
    ELSIF old_area_type = 'kitchen_fridge' AND (new_area_type IS NULL OR new_area_type != 'kitchen_fridge') THEN
        NEW.chilled_since = NULL;
    END IF;
    -- Moving WITHIN kitchen fridge: keep existing timestamp (no change)

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_manage_chilled_since ON slots;
CREATE TRIGGER trigger_manage_chilled_since
    BEFORE UPDATE ON slots
    FOR EACH ROW
    WHEN (OLD.storage_area_id IS DISTINCT FROM NEW.storage_area_id)
    EXECUTE FUNCTION manage_chilled_since();

-- ============================================================================
-- PHASE 3: Create default storage areas for existing cellars
-- ============================================================================

-- For each existing cellar, create "Wine Fridge" and "Main Cellar" storage areas
-- matching the current hardcoded layout

-- Create Wine Fridge areas
INSERT INTO storage_areas (cellar_id, name, storage_type, temp_zone, display_order, icon)
SELECT
    c.id,
    'Wine Fridge',
    'wine_fridge',
    'cool',
    0,
    '🍷'
FROM cellars c
WHERE NOT EXISTS (
    SELECT 1 FROM storage_areas sa
    WHERE sa.cellar_id = c.id AND sa.name = 'Wine Fridge'
);

-- Create Main Cellar areas
INSERT INTO storage_areas (cellar_id, name, storage_type, temp_zone, display_order, icon)
SELECT
    c.id,
    'Main Cellar',
    'cellar',
    'cellar',
    1,
    '🏠'
FROM cellars c
WHERE NOT EXISTS (
    SELECT 1 FROM storage_areas sa
    WHERE sa.cellar_id = c.id AND sa.name = 'Main Cellar'
);

-- ============================================================================
-- PHASE 4: Create rows for storage areas
-- ============================================================================

-- Wine Fridge: 2 rows (row 1 = 4 cols, row 2 = 5 cols) = 9 slots total (F1-F9)
INSERT INTO storage_area_rows (storage_area_id, row_num, col_count, label)
SELECT sa.id, 1, 4, 'Top'
FROM storage_areas sa
WHERE sa.name = 'Wine Fridge'
AND NOT EXISTS (
    SELECT 1 FROM storage_area_rows sar
    WHERE sar.storage_area_id = sa.id AND sar.row_num = 1
);

INSERT INTO storage_area_rows (storage_area_id, row_num, col_count, label)
SELECT sa.id, 2, 5, 'Bottom'
FROM storage_areas sa
WHERE sa.name = 'Wine Fridge'
AND NOT EXISTS (
    SELECT 1 FROM storage_area_rows sar
    WHERE sar.storage_area_id = sa.id AND sar.row_num = 2
);

-- Main Cellar: 19 rows (row 1 = 7 cols, rows 2-19 = 9 cols)
-- Row 1 with 7 columns
INSERT INTO storage_area_rows (storage_area_id, row_num, col_count)
SELECT sa.id, 1, 7
FROM storage_areas sa
WHERE sa.name = 'Main Cellar'
AND NOT EXISTS (
    SELECT 1 FROM storage_area_rows sar
    WHERE sar.storage_area_id = sa.id AND sar.row_num = 1
);

-- Rows 2-19 with 9 columns each
INSERT INTO storage_area_rows (storage_area_id, row_num, col_count)
SELECT sa.id, gs.row_num, 9
FROM storage_areas sa
CROSS JOIN generate_series(2, 19) AS gs(row_num)
WHERE sa.name = 'Main Cellar'
AND NOT EXISTS (
    SELECT 1 FROM storage_area_rows sar
    WHERE sar.storage_area_id = sa.id AND sar.row_num = gs.row_num
);

-- ============================================================================
-- PHASE 5: Map existing slots to storage areas
-- ============================================================================

-- Map fridge slots (zone = 'fridge') to Wine Fridge storage area
UPDATE slots s
SET storage_area_id = sa.id
FROM storage_areas sa
WHERE s.cellar_id = sa.cellar_id
  AND s.zone = 'fridge'
  AND sa.name = 'Wine Fridge'
  AND s.storage_area_id IS NULL;

-- Map cellar slots (zone = 'cellar') to Main Cellar storage area
UPDATE slots s
SET storage_area_id = sa.id
FROM storage_areas sa
WHERE s.cellar_id = sa.cellar_id
  AND s.zone = 'cellar'
  AND sa.name = 'Main Cellar'
  AND s.storage_area_id IS NULL;

-- ============================================================================
-- PHASE 6: Verify migration and add constraints
-- ============================================================================

-- Count check: ensure all slots have storage_area_id
-- FAIL migration if any slots are unmapped (data integrity requirement)
DO $$
DECLARE
    orphan_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO orphan_count FROM slots WHERE storage_area_id IS NULL;
    IF orphan_count > 0 THEN
        RAISE EXCEPTION 'Migration failed: % slots without storage_area_id. Fix data before proceeding.', orphan_count;
    ELSE
        RAISE NOTICE 'Migration complete: all slots have storage_area_id';
    END IF;
END $$;

-- Note: NOT NULL constraint will be added in a separate migration after verification
-- ALTER TABLE slots ALTER COLUMN storage_area_id SET NOT NULL;

-- ============================================================================
-- PHASE 7: Helper views for backward compatibility
-- ============================================================================

-- View that provides the old zone-based layout format for backward compatibility
-- Note: is_for_chilling is derived from storage_type = 'kitchen_fridge'
-- Note: chilling_days calculated for kitchen fridge warnings
CREATE OR REPLACE VIEW v_slots_with_zone AS
SELECT
    s.*,
    sa.name AS storage_area_name,
    sa.storage_type,
    sa.temp_zone,
    (sa.storage_type = 'kitchen_fridge') AS is_for_chilling,
    CASE
        WHEN sa.storage_type IN ('wine_fridge', 'kitchen_fridge') THEN 'fridge'
        ELSE 'cellar'
    END AS legacy_zone,
    -- Calculate days chilling for warning thresholds
    CASE
        WHEN s.chilled_since IS NOT NULL
        THEN EXTRACT(DAY FROM (NOW() - s.chilled_since))::INTEGER
        ELSE NULL
    END AS chilling_days
FROM slots s
JOIN storage_areas sa ON sa.id = s.storage_area_id;

-- ============================================================================
-- Done
-- ============================================================================
