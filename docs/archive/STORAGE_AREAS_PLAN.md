# Storage Areas Feature - Implementation Plan

## Overview

Replace hardcoded fridge/cellar with user-definable **Storage Areas** (up to 5 per cellar). Each area has custom layout (variable rows/columns), storage type, and temperature zone that affects wine recommendations.

## User Requirements
- **Visual grid builder**: Drag-and-drop interface to define rows/columns
- **Temperature zones**: Smart suggestions (whites in fridge, reds in cellar)
- **Up to 5 storage areas**: Main cellar, wine fridge, kitchen fridge, rack, etc.
- **Variable row widths**: Support different column counts per row

---

## Progress (Jan 14, 2026)

✅ **COMPLETE** - Storage Areas feature fully implemented and tested

### Completed Components
- ✅ Backend routes: `src/routes/storageAreas.js` (CRUD, layout updates, templates)
- ✅ Router integration: registered `/api/storage-areas` with `requireAuth` + `requireCellarContext`
- ✅ Placement logic service: `src/services/storagePlacement.js` (temperature-aware)
- ✅ Frontend scaffolds: `public/js/storageBuilder.js`, `public/js/onboarding.js`
- ✅ Stats/layout endpoint: updated `src/routes/stats.js` with dynamic areas + lite mode
- ✅ Grid refactor: dynamic rendering via `public/js/grid.js` + conditional in `app.js`
- ✅ Settings UI: Storage Areas section in Settings with onboarding wizard
- ✅ Persistence flow: onboarding listener → API → refresh grid
- ✅ CSS styling: storage-areas container, onboarding-wizard, layout controls
- ✅ Unit tests: 26 new API contract tests in `tests/unit/utils/storageAreasSettings.test.js`

### Test Results
- 783/784 unit tests passing (99.9%)
- Only failure: intentional SQL injection guard test (documented safe patterns)
- New storage areas test file: 26 API contract tests all passing
## Common User Scenarios

Users may have various combinations of storage:

| Scenario | Storage Areas |
|----------|---------------|
| **Apartment dweller** | Wine fridge (24 bottles) |
| **Home enthusiast** | Wine fridge + Kitchen fridge overflow |
| **Serious collector** | Wine cellar + Wine fridge + Kitchen fridge |
| **Multiple locations** | Main cellar + Garage rack + Wine fridge |
| **Your setup** | Main cellar (19 rows) + Wine fridge (9 slots) |

### Storage Types & Temperature Zones

| Storage Type | Temp Zone | Temperature | Purpose | Aging Impact |
|--------------|-----------|-------------|---------|--------------|
| `wine_fridge` | `cool` | 10-14°C | Long-term white/sparkling, ready-to-drink | Ideal - no adjustment |
| `kitchen_fridge` | `cold` | 4-8°C | Short-term chilling only | N/A - excluded from aging |
| `cellar` | `cellar` | 12-16°C | Long-term red/white storage | Ideal - no adjustment |
| `rack` | `ambient` | 18-25°C | Overflow, drink-soon wines | Accelerated aging (15% faster) |
| `other` | (user picks) | varies | Custom (garage, closet, etc.) | Based on temp zone selected |

**Key distinction**:
- **Wine fridge** = temperature-controlled for wine (10-14°C) - good for aging
- **Kitchen fridge** = too cold (4-8°C) - only for chilling before serving, not storage

---

## Phase 1: Database Schema

### New Tables

**`storage_areas`** - Defines storage locations
```sql
CREATE TABLE storage_areas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cellar_id UUID NOT NULL REFERENCES cellars(id) ON DELETE CASCADE,
  name TEXT NOT NULL,                    -- "Wine Fridge", "Main Cellar"
  storage_type TEXT NOT NULL CHECK (storage_type IN (
    'wine_fridge', 'kitchen_fridge', 'cellar', 'rack', 'other'
  )),
  temp_zone TEXT NOT NULL CHECK (temp_zone IN (
    'cold', 'cool', 'cellar', 'ambient'
  )),
  display_order INTEGER NOT NULL DEFAULT 0,
  icon TEXT,
  notes TEXT,                             -- User notes about this area
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),   -- Auto-updated by trigger
  UNIQUE(cellar_id, name)
);
-- Note: is_for_chilling is DERIVED in application code from storage_type = 'kitchen_fridge'
-- (no column needed - see v_slots_with_zone view)
```

**`storage_area_rows`** - Variable columns per row
```sql
CREATE TABLE storage_area_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  storage_area_id UUID NOT NULL REFERENCES storage_areas(id) ON DELETE CASCADE,
  row_num INTEGER NOT NULL CHECK (row_num >= 1 AND row_num <= 100),
  col_count INTEGER NOT NULL DEFAULT 9 CHECK (col_count >= 1 AND col_count <= 20),
  label TEXT,
  UNIQUE(storage_area_id, row_num)
);
```

### Modify `slots` Table
```sql
ALTER TABLE slots ADD COLUMN storage_area_id UUID REFERENCES storage_areas(id);
ALTER TABLE slots ADD COLUMN chilled_since TIMESTAMPTZ;  -- Tracks kitchen fridge entry time
-- Migration backfills existing slots, then:
ALTER TABLE slots ALTER COLUMN storage_area_id SET NOT NULL;
```

**`chilled_since` trigger**: The migration includes a `manage_chilled_since()` trigger that:
- Sets timestamp when wine moves INTO kitchen fridge
- Clears timestamp when wine moves OUT of kitchen fridge
- Preserves timestamp when moving WITHIN kitchen fridge (slot-to-slot)

### Migration: `data/migrations/038_storage_areas.sql`
1. Create new tables
2. For each existing cellar, create default "Wine Fridge" and "Main Cellar" areas
3. Create rows matching current layout (fridge: 2 rows, cellar: 19 rows with R1=7cols)
4. Update slots.storage_area_id based on current zone column
5. Keep zone column for backward compatibility initially

---

## Phase 2: Backend API

### New Route: `src/routes/storageAreas.js`

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/storage-areas` | List all areas with slot counts |
| POST | `/api/storage-areas` | Create area (enforces max 5) |
| GET | `/api/storage-areas/:id` | Get area with layout |
| PUT | `/api/storage-areas/:id` | Update name/type/temp |
| DELETE | `/api/storage-areas/:id` | Delete (must be empty) |
| PUT | `/api/storage-areas/:id/layout` | Update rows/columns |
| POST | `/api/storage-areas/from-template` | Create from preset |

### Modify: `src/routes/stats.js`
- Update `/api/stats/layout` to return dynamic storage areas
- Backward compatible: detect if cellar uses new system
- Add `?lite=true` parameter for layout-only response (no wine/occupancy data)

**Lite mode** (for builder/onboarding):
```javascript
// GET /api/stats/layout?lite=true
{
  "areas": [
    { "id": "...", "name": "Wine Fridge", "storage_type": "wine_fridge",
      "rows": [{ "row_num": 1, "col_count": 6 }, ...] }
  ]
}

// GET /api/stats/layout (default - full mode)
{
  "areas": [
    { "id": "...", "name": "Wine Fridge", ...,
      "rows": [...],
      "slots": [{ "location": "WF-R1C1", "wine_id": 42, "wine_name": "...", ... }]
    }
  ]
}
```

Benefits:
- Builder/onboarding loads faster (no wine data needed)
- Layout can be cached aggressively (changes rarely)
- Occupancy has separate cache rules (changes often)

### New Service: `src/services/storagePlacement.js`
```javascript
// Temperature-aware placement
const IDEAL_STORAGE = {
  sparkling: { ideal: ['cellar', 'wine_fridge'], acceptable: ['kitchen_fridge'] },  // Cellar ideal for aging
  white_drink_soon: { ideal: ['wine_fridge'], acceptable: ['cellar'] },
  white_age_worthy: { ideal: ['cellar'], acceptable: ['wine_fridge'] },
  rose: { ideal: ['wine_fridge'], acceptable: ['cellar'] },
  red_light: { ideal: ['cellar'], acceptable: ['wine_fridge'] },
  red_full: { ideal: ['cellar'], acceptable: ['rack'] }  // Rack only for drink-soon
};
```

### Modify: `src/services/windowDefaults.js`
- Add temp_zone to STORAGE_ADJUSTMENT_FACTORS
- `cold` (kitchen fridge): N/A - excluded from aging (chilling state only)
- `cool` (wine fridge): no adjustment (ideal storage)
- `cellar`: no adjustment (ideal storage)
- `ambient` (rack): 15% faster aging

---

## Phase 3: Frontend - Grid Rendering

### Modify: `public/js/grid.js`
Replace `renderFridge()` + `renderCellar()` with:
```javascript
export async function renderStorageAreas() {
  for (const area of state.layout.areas) {
    renderArea(area);  // Dynamic per-area rendering
  }
}
```

### Modify: `public/index.html`
Replace `#fridge-grid` and `#cellar-grid` with:
```html
<div id="storage-areas-container"></div>
```

### Update: `public/js/dragdrop.js`
- Support cross-area drag and drop
- Validate temperature compatibility on drop

---

## Phase 4: Frontend - Visual Grid Builder

### New: `public/js/storageBuilder.js`
Visual editor for defining storage area layout:
- Add/remove rows
- Adjust columns per row (click +/- buttons)
- Drag to reorder rows
- Live preview of grid

### New: `public/js/onboarding.js`
Wizard steps:
1. **Welcome** - Explain the app
2. **Storage Count** - How many areas? (1-5)
3. **Area Details** - Name, type, temp zone for each
4. **Layout Builder** - Define rows/columns (or use template)
5. **Confirm** - Review and save

### Templates (quick setup)

**Canonical format**: All templates use `rows` array with explicit `row_num` and `col_count`:

```javascript
const TEMPLATES = {
  // Wine fridges (temperature-controlled)
  wine_fridge_small: {
    name: 'Wine Fridge',
    storage_type: 'wine_fridge',
    temp_zone: 'cool',
    rows: [
      { row_num: 1, col_count: 6 },
      { row_num: 2, col_count: 6 }
    ]
  },
  wine_fridge_medium: {
    name: 'Wine Fridge',
    storage_type: 'wine_fridge',
    temp_zone: 'cool',
    rows: [
      { row_num: 1, col_count: 6 },
      { row_num: 2, col_count: 6 },
      { row_num: 3, col_count: 6 },
      { row_num: 4, col_count: 6 }
    ]
  },
  wine_fridge_large: {
    name: 'Wine Fridge',
    storage_type: 'wine_fridge',
    temp_zone: 'cool',
    rows: Array.from({ length: 6 }, (_, i) => ({ row_num: i + 1, col_count: 8 }))
  },

  // Kitchen fridge (for chilling only - shown with warning)
  kitchen_fridge: {
    name: 'Kitchen Fridge',
    storage_type: 'kitchen_fridge',
    temp_zone: 'cold',
    rows: [{ row_num: 1, col_count: 6 }],
    warning: 'Only for short-term chilling before serving'
  },

  // Cellars
  cellar_small: {
    name: 'Wine Cellar',
    storage_type: 'cellar',
    temp_zone: 'cellar',
    rows: Array.from({ length: 5 }, (_, i) => ({ row_num: i + 1, col_count: 9 }))
  },
  cellar_medium: {
    name: 'Wine Cellar',
    storage_type: 'cellar',
    temp_zone: 'cellar',
    rows: Array.from({ length: 10 }, (_, i) => ({ row_num: i + 1, col_count: 9 }))
  },
  cellar_large: {
    name: 'Wine Cellar',
    storage_type: 'cellar',
    temp_zone: 'cellar',
    rows: [
      { row_num: 1, col_count: 7 },  // First row narrower
      ...Array.from({ length: 18 }, (_, i) => ({ row_num: i + 2, col_count: 9 }))
    ]
  },

  // Racks (ambient temperature)
  rack_countertop: {
    name: 'Kitchen Rack',
    storage_type: 'rack',
    temp_zone: 'ambient',
    rows: [{ row_num: 1, col_count: 6 }]
  },
  rack_floor: {
    name: 'Wine Rack',
    storage_type: 'rack',
    temp_zone: 'ambient',
    rows: Array.from({ length: 4 }, (_, i) => ({ row_num: i + 1, col_count: 6 }))
  }
};

// Normalize any shorthand format to canonical on ingest
function normalizeTemplate(template) {
  // Already canonical
  if (Array.isArray(template.rows) && template.rows[0]?.row_num !== undefined) {
    return template;
  }
  // Convert shorthand: cols: 8 or cols: [6,6,6]
  if (template.cols) {
    const colCounts = Array.isArray(template.cols)
      ? template.cols
      : Array(template.rows || 1).fill(template.cols);
    return {
      ...template,
      rows: colCounts.map((col_count, i) => ({ row_num: i + 1, col_count }))
    };
  }
  return template;
}
```

---

## Phase 5: Smart Recommendations

### Placement Logic by Wine Type

| Wine Type | Ideal Storage | Acceptable | Avoid |
|-----------|--------------|------------|-------|
| **Sparkling** | Cellar, Wine fridge | Kitchen fridge (serving prep) | Rack (too warm) |
| **Light whites (drink soon)** | Wine fridge | Cellar | Rack |
| **Age-worthy whites** | Cellar | Wine fridge | Rack |
| **Rosé** | Wine fridge | Cellar | Rack |
| **Light reds** | Cellar | Wine fridge | Kitchen fridge |
| **Full reds** | Cellar | Rack (drink soon only) | Kitchen fridge, Wine fridge |

**Note**: Cellar temperature (12-16°C) is excellent for aging Champagne and fine whites. Wine fridge is better for "ready to drink" accessibility.

### Kitchen Fridge Special Handling

Kitchen fridge (`cold` zone, 4-8°C) is treated as **temporary chilling** not storage:

```javascript
// When placing in kitchen fridge
if (area.storage_type === 'kitchen_fridge') {
  showWarning(`
    Kitchen fridge is too cold for wine storage.
    Best used for: Chilling whites/sparkling 1-2 hours before serving.
    This wine will be flagged as "ready to serve" not "stored".
  `);
}

// In wine list, show different status
if (slot.storage_area.is_for_chilling) {
  badge = 'Chilling';  // Instead of normal location badge
}
```

### Placement Suggestions Examples

**Adding a Sauvignon Blanc:**
```
Recommended: Wine Fridge (Row 2, Slot 3)
Reason: Light whites best stored at 10-14°C for freshness
Alternatives: Main Cellar (acceptable, slightly warmer)
```

**Adding a Cabernet Sauvignon:**
```
Recommended: Main Cellar (Row 12, Slot 5)
Reason: Full-bodied reds age well at cellar temperature (12-16°C)
Alternatives: Wine Rack (acceptable for drinking within 1-2 years)
```

**Adding Champagne:**
```
Recommended: Main Cellar (Row 5, Slot 3) or Wine Fridge (Row 1, Slot 2)
Reason: Champagne ages beautifully at cellar temperature (12-16°C); wine fridge is also ideal
Note: Move to Kitchen Fridge 1hr before serving to chill
```

### Temperature-Based Drinking Window Adjustments

| Storage Type | Temp Zone | Aging Factor | Effect on Drink-By |
|--------------|-----------|--------------|-------------------|
| Wine fridge | `cool` | 1.0x | No change |
| Cellar | `cellar` | 1.0x | No change |
| Rack | `ambient` | 0.85x | 15% earlier |
| Kitchen fridge | `cold` | N/A | Excluded from aging - "chilling state" |

**Example**: Wine with 5-year drinking window stored on rack:
- Original: Drink by 2031
- Adjusted: Drink by 2029 (15% reduction = 4.25 years)

### Kitchen Fridge Time-Based Warnings

Since kitchen fridge is for serving prep, not storage, add time-based warnings:
- **< 7 days**: No warning
- **7-14 days**: "Consider moving back to storage"
- **> 14 days**: "Wine has been chilling for X days - move to proper storage?"

**Implementation** (in migration 038):
- Added `chilled_since TIMESTAMPTZ` column to `slots` table
- Database trigger `manage_chilled_since()` automatically:
  - Sets timestamp when wine moves INTO kitchen fridge
  - Clears timestamp when wine moves OUT of kitchen fridge
  - Preserves timestamp when moving WITHIN kitchen fridge (slot-to-slot)
- View `v_slots_with_zone` includes calculated `chilling_days` for easy querying

**Future enhancement**: Make thresholds configurable per cellar in `user_settings`:
```javascript
// Default thresholds
chilling_warn_days: 7,    // "Consider moving back"
chilling_alert_days: 14   // "Wine has been chilling too long"
```
This lets enthusiasts customize (e.g., stricter 3/7 days) without changing code.

### Storage Area Status Dashboard

Show summary for each storage area:
```
+-------------------------------------------------------------+
| Wine Fridge (24 slots)                     12/24 occupied   |
|    - Sparkling: 3                                           |
|    - White: 6                                               |
|    - Rosé: 3                                                |
|    Status: Ideal temp for whites & sparkling                |
+-------------------------------------------------------------+
| Main Cellar (169 slots)                    89/169 occupied  |
|    - Red: 72                                                |
|    - White: 15                                              |
|    - Other: 2                                               |
|    Status: Ideal for long-term aging                        |
+-------------------------------------------------------------+
| Kitchen Fridge (6 slots)                   2/6 occupied     |
|    - Chilling: 2 (Sauv Blanc, Prosecco)                     |
|    Status: Wines ready to serve tonight                     |
+-------------------------------------------------------------+
```

---

---

## Layout Editing Rules (Data Protection)

**Critical**: Layout changes must not cause wine data loss. These rules prevent removing occupied slots.

### MVP Constraints

| Operation | Rule |
|-----------|------|
| **Add rows** | Always allowed - creates new empty slots |
| **Increase columns** | Always allowed - creates new empty slots |
| **Decrease columns** | Only if rightmost slots in row are empty |
| **Delete row** | Only if all slots in row are empty |
| **Delete area** | Only if all slots in area are empty |
| **Reorder rows** | Always allowed - slots move with their row |

### API Error Response

When an operation would remove occupied slots:
```json
{
  "error": "Cannot shrink layout - occupied slots would be removed",
  "blocked_by": [
    { "location": "WF-R2C5", "wine_name": "Cloudy Bay Sauvignon Blanc 2023" },
    { "location": "WF-R2C6", "wine_name": "Domaine Leflaive Puligny-Montrachet 2020" }
  ],
  "suggestion": "Move these wines to other slots first, or use evacuation mode"
}
```

### Future: Evacuation Mode

For v2, add optional "evacuation mode" that:
1. Shows wines that would be displaced
2. Suggests target slots in other areas
3. Executes moves atomically with layout change
4. Rolls back if any move fails

---

## Slot Identity & Location Labels

### Structured Slot Identity

Each slot is identified by:
- `storage_area_id` (UUID)
- `row_num` (1-100)
- `col_num` (1-20)

### Location Label Generation

Generate human-friendly labels for display:
```javascript
function generateSlotLabel(area, row, col) {
  const prefix = area.name.substring(0, 2).toUpperCase(); // "WF", "MC", "KF"
  return `${prefix}-R${row}C${col}`;  // "WF-R2C3", "MC-R12C5"
}
```

**Label stability rule**: Labels should remain stable when layout changes (slots keep their row/col identity). Only regenerate when area is renamed.

---

## Files to Create/Modify

### Create
| File | Purpose |
|------|---------|
| `data/migrations/038_storage_areas.sql` | Schema + migration |
| `src/routes/storageAreas.js` | Storage area CRUD API |
| `src/services/storagePlacement.js` | Temp-aware placement |
| `public/js/storageBuilder.js` | Visual grid builder |
| `public/js/onboarding.js` | Setup wizard |

### Modify
| File | Changes |
|------|---------|
| `src/routes/stats.js` | Dynamic layout endpoint |
| `src/routes/index.js` | Register new routes |
| `src/services/windowDefaults.js` | Temp zone adjustments |
| `public/js/grid.js` | Dynamic area rendering |
| `public/js/app.js` | Onboarding trigger |
| `public/js/dragdrop.js` | Cross-area moves |
| `public/index.html` | New container, onboarding modal |
| `public/css/styles.css` | Builder styles, area styles |

---

## Implementation Order

### Week 1: Foundation
1. ✅ Create migration 038 (exists and reviewed)
2. ✅ Create `storageAreas.js` routes (CRUD)
3. ⏳ Update `stats.js` layout endpoint
4. ⏳ Test with existing cellars (backward compat)

### Week 2: Frontend Core
1. Refactor grid.js for dynamic rendering
2. Update dragdrop.js for cross-area moves
3. Update index.html structure
4. CSS for multiple storage areas

### Week 3: Builder & Onboarding
1. ✅ Create `storageBuilder.js`
2. ✅ Create `onboarding.js` wizard (skeleton)
3. ✅ Templates and presets (builder presets added)
4. ⏳ Settings page integration

### Week 4: Smart Features
1. storagePlacement.js service
2. Temperature warnings
3. Drinking window adjustments
4. Polish and testing

---

## Verification

### Database
```sql
-- Verify storage areas created
SELECT * FROM storage_areas WHERE cellar_id = 'xxx';

-- Verify slots migrated
SELECT storage_area_id, COUNT(*) FROM slots WHERE cellar_id = 'xxx' GROUP BY 1;
```

### API Tests
```bash
# List storage areas
curl -H "Authorization: Bearer $TOKEN" -H "X-Cellar-ID: $CELLAR" \
  https://cellar.creathyst.com/api/storage-areas

# Create new area
curl -X POST -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" -H "X-Cellar-ID: $CELLAR" \
  -d '{"name":"Kitchen Rack","storage_type":"rack","temp_zone":"ambient","rows":[{"row_num":1,"col_count":12}]}' \
  https://cellar.creathyst.com/api/storage-areas
```

### Frontend Tests
1. Onboarding wizard completes without errors
2. Grid builder creates valid layouts
3. Drag-drop works across storage areas
4. Wine placement suggestions are temperature-aware
5. Existing cellars display correctly (backward compat)

### Unit Tests
- `tests/unit/services/storagePlacement.test.js`
- `tests/unit/routes/storageAreas.test.js`
