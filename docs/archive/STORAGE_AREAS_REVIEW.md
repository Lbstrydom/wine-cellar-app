# Storage Areas Feature - Developer Review Document

## Documents to Share for Review

Share these documents with the independent developer for a complete review:

| Document | Purpose | Priority |
|----------|---------|----------|
| **[STORAGE_AREAS_REVIEW.md](./STORAGE_AREAS_REVIEW.md)** (this file) | High-level summary, key decisions, questions | Must read |
| **[STORAGE_AREAS_PLAN.md](./STORAGE_AREAS_PLAN.md)** | Detailed implementation plan with code examples | Must read |
| **[038_storage_areas.sql](../data/migrations/038_storage_areas.sql)** | Database migration (already created) | Review schema |
| **[CLAUDE.md](../CLAUDE.md)** | Project coding standards and conventions | Reference |
| **[STATUS.md](./STATUS.md)** | Current project status and architecture | Optional context |

### What NOT to Share (Unless Requested)
- The full plan file in `.claude/plans/` (duplicated in STORAGE_AREAS_PLAN.md)
- Individual source files unless reviewer wants to dive deeper

---

## Problem Statement

### Current Limitations

The wine cellar app currently has a **hardcoded storage layout** that assumes all users have:
- A wine fridge with 2 rows (4 + 5 = 9 slots, labeled F1-F9)
- A main cellar with 19 rows (first row has 7 columns, rows 2-19 have 9 columns = 169 slots)

This rigid structure doesn't accommodate real-world scenarios where users may have:
- Only a small wine fridge (apartment dweller with 12-24 bottles)
- Multiple storage locations (wine fridge + kitchen fridge + rack)
- Different-sized cellars (5 rows vs 50 rows)
- No cellar at all (just a countertop rack)

### User Onboarding Gap

When new users sign up, they're presented with a fixed layout that doesn't match their actual storage. There's no wizard or setup process to configure their storage areas.

### Temperature Zone Intelligence

The app already has temperature-based drinking window adjustments in `windowDefaults.js`, but the current implementation doesn't distinguish between:
- **Wine fridge** (10-14°C) - proper wine storage temperature
- **Kitchen fridge** (4-8°C) - too cold for storage, only for chilling before serving
- **Ambient rack** (18-25°C) - accelerates aging

---

## Proposed Solution

### Storage Areas System

Replace the hardcoded fridge/cellar with user-definable **Storage Areas** (up to 5 per cellar). Each area has:
- Custom name (e.g., "Wine Fridge", "Garage Rack", "Kitchen Overflow")
- Storage type (`wine_fridge`, `kitchen_fridge`, `cellar`, `rack`, `other`)
- Temperature zone (`cold`, `cool`, `cellar`, `ambient`)
- Variable row/column configuration per row
- Display order for UI rendering

### Key Distinction: Wine Fridge vs Kitchen Fridge

| Storage Type | Temp Zone | Temperature | Purpose |
|--------------|-----------|-------------|---------|
| `wine_fridge` | `cool` | 10-14°C | Long-term storage for whites/sparkling |
| `kitchen_fridge` | `cold` | 4-8°C | **Chilling only** - wines shouldn't stay here |
| `cellar` | `cellar` | 12-16°C | Long-term storage for reds/whites |
| `rack` | `ambient` | 18-25°C | Drink-soon wines, overflow storage |

Kitchen fridge entries get flagged as "chilling" rather than "stored" and display warnings about not being suitable for long-term storage.

### Visual Grid Builder

New users (and existing users) can use a visual builder to:
- Add/remove storage areas
- Define rows and columns per row (variable widths supported)
- Select from templates (small/medium/large wine fridge, cellar presets)
- Drag to reorder storage areas

---

## Files to Review

### Existing Architecture (Read These First)

| File | Purpose | Key Code |
|------|---------|----------|
| [src/routes/stats.js](../src/routes/stats.js) | Layout endpoint | Lines 50-120: hardcoded fridge/cellar generation |
| [src/services/windowDefaults.js](../src/services/windowDefaults.js) | Drinking window logic | `STORAGE_ADJUSTMENT_FACTORS` object |
| [src/config/cellarZones.js](../src/config/cellarZones.js) | Zone configuration | Fridge slots F1-F9 definition |
| [public/js/grid.js](../public/js/grid.js) | Grid rendering | `renderFridge()` and `renderCellar()` functions |
| [public/js/dragdrop.js](../public/js/dragdrop.js) | Drag and drop | Cross-slot movement logic |

### Database Schema

| File | Purpose |
|------|---------|
| [data/migrations/038_storage_areas.sql](../data/migrations/038_storage_areas.sql) | New tables and migration |

Review the migration for:
- `storage_areas` table structure
- `storage_area_rows` table for variable column counts
- Migration logic for existing slots
- Backward compatibility view `v_slots_with_zone`

### Plan Document

| File | Purpose |
|------|---------|
| [.claude/plans/zany-twirling-platypus.md](../.claude/plans/zany-twirling-platypus.md) | Full implementation plan |

---

## Database Schema Changes

### New Tables

```sql
-- Storage areas: defines storage locations
storage_areas (
    id UUID PRIMARY KEY,
    cellar_id UUID REFERENCES cellars(id),
    name TEXT NOT NULL,                    -- "Wine Fridge", "Main Cellar"
    storage_type TEXT NOT NULL,            -- 'wine_fridge', 'kitchen_fridge', 'cellar', 'rack', 'other'
    temp_zone TEXT NOT NULL,               -- 'cold', 'cool', 'cellar', 'ambient'
    display_order INTEGER,
    icon TEXT,
    is_for_chilling BOOLEAN,               -- TRUE for kitchen fridge
    notes TEXT,
    UNIQUE(cellar_id, name)
)

-- Storage area rows: variable columns per row
storage_area_rows (
    id UUID PRIMARY KEY,
    storage_area_id UUID REFERENCES storage_areas(id),
    row_num INTEGER NOT NULL,
    col_count INTEGER NOT NULL,            -- 1-20 columns per row
    label TEXT,                            -- "Top shelf", "Bottom"
    UNIQUE(storage_area_id, row_num)
)
```

### Modified Tables

```sql
-- Slots table gets new column
ALTER TABLE slots ADD COLUMN storage_area_id UUID REFERENCES storage_areas(id);
```

### Migration Strategy

1. Create new tables
2. For each existing cellar, create default "Wine Fridge" and "Main Cellar" areas
3. Create rows matching current hardcoded layout
4. Update `slots.storage_area_id` based on existing `zone` column
5. Backward compatibility view provides `legacy_zone` for old code

---

## API Changes

### New Endpoints (src/routes/storageAreas.js)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/storage-areas` | List all areas for current cellar |
| POST | `/api/storage-areas` | Create new area (max 5 enforced) |
| GET | `/api/storage-areas/:id` | Get area with layout |
| PUT | `/api/storage-areas/:id` | Update name/type/temp |
| DELETE | `/api/storage-areas/:id` | Delete (must be empty) |
| PUT | `/api/storage-areas/:id/layout` | Update rows/columns |
| POST | `/api/storage-areas/from-template` | Create from preset |

### Modified Endpoints

| Endpoint | Changes |
|----------|---------|
| `GET /api/stats/layout` | Return dynamic storage areas instead of hardcoded layout |

---

## Frontend Changes

### New Files

| File | Purpose |
|------|---------|
| `public/js/storageBuilder.js` | Visual grid builder component |
| `public/js/onboarding.js` | New user setup wizard |

### Modified Files

| File | Changes |
|------|---------|
| `public/js/grid.js` | Replace `renderFridge()`/`renderCellar()` with dynamic `renderStorageAreas()` |
| `public/js/dragdrop.js` | Support cross-area moves with temperature validation |
| `public/index.html` | Replace `#fridge-grid`/`#cellar-grid` with `#storage-areas-container` |
| `public/css/styles.css` | Add builder styles, area cards, temperature badges |

---

## Key Design Decisions

### 1. Variable Columns Per Row

Each row can have a different column count (1-20). This supports real-world scenarios:
- Wine fridge Row 1: 4 bottles (narrower shelf)
- Wine fridge Row 2: 5 bottles (wider shelf)
- Cellar Row 1: 7 bottles (angled top row)
- Cellar Rows 2-19: 9 bottles (standard shelves)

### 2. Kitchen Fridge Warning

When a user places wine in a `kitchen_fridge` area:
- Display warning: "Kitchen fridge is too cold for wine storage"
- Mark wine as "chilling" status instead of "stored"
- Don't apply aging calculations (it's temporary)

### 3. Backward Compatibility

- The `v_slots_with_zone` view provides `legacy_zone` field
- Existing code using `zone = 'fridge'` continues to work during transition
- Migration preserves all existing slot data

### 4. Maximum 5 Areas

Enforced at API level to prevent UI clutter and database bloat. Covers most realistic scenarios:
- Main cellar + wine fridge + kitchen fridge + rack + overflow

### 5. Template System

Pre-built configurations for common setups:
- Small wine fridge (12 bottles)
- Medium wine fridge (24 bottles)
- Large wine fridge (48 bottles)
- Small cellar (45 bottles)
- Large cellar (169 bottles - matches current layout)

---

## Testing Checklist

### Database Migration

- [ ] Migration runs successfully on empty database
- [ ] Migration runs successfully with existing data
- [ ] All existing slots get `storage_area_id` assigned
- [ ] Existing fridge slots map to "Wine Fridge" area
- [ ] Existing cellar slots map to "Main Cellar" area
- [ ] `v_slots_with_zone` view returns correct `legacy_zone`

### API Endpoints

- [ ] Create storage area respects max 5 limit
- [ ] Delete storage area fails if contains wines
- [ ] Layout update validates column counts (1-20)
- [ ] All endpoints properly scope to `req.cellarId`

### Frontend

- [ ] Existing cellars display correctly (backward compat)
- [ ] Grid builder creates valid layouts
- [ ] Drag-drop works across storage areas
- [ ] Temperature warnings show for kitchen fridge
- [ ] Onboarding wizard completes without errors

---

## Questions for Reviewer (ANSWERED)

1. **Schema Design**: Does the separation of `storage_areas` and `storage_area_rows` make sense, or should row configs be stored as JSONB on the area?

   **Answer**: Keep `storage_area_rows` table. Relational is better for validation, querying, and per-row updates.

2. **Migration Safety**: Should we add more validation checks during the slot-to-storage-area migration?

   **Answer**: Yes. Changed from WARNING to EXCEPTION if slots remain unmapped. Migration should fail explicitly.

3. **Max Areas**: Is 5 the right limit? Should it be configurable per cellar tier (free vs premium)?

   **Answer**: 5 is fine for MVP. Defined as constant `MAX_STORAGE_AREAS` for easy adjustment later.

4. **Template Expansion**: Are the proposed templates sufficient for MVP, or should we add more regional variations?

   **Answer**: Sufficient for MVP. Normalized template format to use array for `cols` consistently.

5. **Chilling Flag**: Is `is_for_chilling` the right approach for kitchen fridge distinction, or should we derive it from `temp_zone = 'cold'`?

   **Answer**: **Removed `is_for_chilling` column**. Derived in application code from `storage_type = 'kitchen_fridge'`. Backward-compat view includes derived column.

---

## Changes Made Based on Review (13 Jan 2026)

### Technical Fixes Applied

| Issue | Fix |
|-------|-----|
| **SQL bug in migration** | Fixed invalid `storage_area_rows.row_num` reference → `gs.row_num` |
| **Missing row_num constraint** | Added `CHECK (row_num >= 1 AND row_num <= 100)` |
| **Redundant is_for_chilling** | Removed column; derived in view from `storage_type = 'kitchen_fridge'` |
| **updated_at trigger missing** | Added PostgreSQL trigger function |

### Wine-Domain Corrections

| Original | Corrected |
|----------|-----------|
| Sparkling: avoid cellar (too warm) | Sparkling: cellar OR wine fridge are both ideal |
| Kitchen fridge: 5% faster aging | Kitchen fridge: excluded from aging (chilling state only) |
| Wine fridge best for all whites | Wine fridge for "drink soon"; cellar for age-worthy whites |

### New Sections Added to Plan

1. **Layout Editing Rules** - MVP constraints to prevent data loss when resizing
2. **Slot Identity & Labels** - Stable location labels (WF-R2C3 format)
3. **Kitchen Fridge Time Warnings** - Track `chilled_since`, warn after 7-14 days

### Database Changes for Chilling Tracking

Added to migration 038:
- `slots.chilled_since TIMESTAMPTZ` column
- `manage_chilled_since()` trigger function (auto-sets/clears on area change)
- `v_slots_with_zone.chilling_days` calculated field for easy warning queries

### Still To Implement (from review)

- [x] Split layout vs occupancy API responses for performance → Added `?lite=true` parameter
- [ ] Cache layout structure (changes rarely) → Will implement in stats.js
- [x] Fail migration with EXCEPTION not WARNING for unmapped slots
- [x] Normalize templates to canonical row format → Added `normalizeTemplate()` function
- [ ] Configurable chilling thresholds per cellar (future enhancement)

---

## Related Documentation

- [CLAUDE.md](../CLAUDE.md) - Project coding standards and conventions
- [STATUS.md](./STATUS.md) - Current project status and recent changes
- [Plan File](../.claude/plans/zany-twirling-platypus.md) - Full implementation plan with code examples
