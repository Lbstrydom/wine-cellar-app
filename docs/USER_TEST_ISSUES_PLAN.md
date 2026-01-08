# User Test Issues - Implementation Plan

## Issue: Dynamic Zone Management with AI Assistance

**Date**: 8 January 2026
**Priority**: High
**Status**: Planning

---

## Problem Statement

When a zone reaches capacity (e.g., Appassimento zone is full), the current system silently falls back to overflow zones which may be completely unrelated (e.g., suggesting Rioja for an Appassimento wine). This creates illogical organization suggestions that confuse users.

**Current Behaviour**:
1. Zone fills up
2. System tries to allocate new row (fails if none available)
3. Falls back to `overflowZoneId` chain
4. Eventually suggests unrelated zone (bad UX)

**Desired Behaviour**:
1. Zone fills up
2. System detects overflow condition
3. **Alerts user immediately** with clear messaging
4. **Claude Opus analyzes** the situation and suggests context-appropriate solutions
5. User reviews and approves AI suggestion
6. System implements the approved change

---

## Solution Architecture

### Phase 1: Detection & Alert

**Goal**: Stop bad suggestions, alert user proactively

**Changes Required**:

1. **`src/services/cellarAnalysis.js`**:
   - When `findAvailableSlot()` returns null for a wine's target zone
   - Instead of falling back to unrelated overflow zones, flag as `zoneCapacityIssue`
   - Return structured alert data with the analysis results

2. **`src/services/cellarPlacement.js`**:
   - Modify `findAvailableSlot()` to distinguish between:
     - "Zone full, sensible overflow available" (OK to suggest)
     - "Zone full, no sensible overflow" (trigger alert)
   - Add zone affinity check - only allow overflow to related zones (same grape family, region, or style)

3. **Frontend Alert UI** (`public/js/cellarAnalysis/`):
   - New component: Zone Capacity Alert
   - Displayed prominently when analysis detects overflow issues
   - Two buttons: "Get AI Suggestions" | "Ignore for now"

### Phase 2: AI Zone Recommendations

**Goal**: Claude Opus provides intelligent, case-by-case suggestions

**New API Endpoint**: `POST /api/cellar/zone-capacity-advice`

**Request**:
```json
{
  "overflowingZoneId": "appassimento",
  "winesNeedingPlacement": [
    { "wineId": 123, "wineName": "Passione Reale Appassimento", "currentSlot": "R10C8" }
  ],
  "currentZoneAllocation": { /* zone → rows mapping */ },
  "availableRows": ["R12", "R15"],
  "adjacentZones": ["amarone", "valpolicella", "italian_reds"]
}
```

**Claude Prompt Structure**:
```
You are a sommelier managing a wine cellar. The "{zoneName}" zone is at capacity
with {count} bottles but {overflow_count} more wines of this type need placement.

Current zone layout:
{zone_layout_summary}

Available options:
1. EXPAND: Allocate one of these available rows: {available_rows}
2. MERGE: Combine with a related zone: {adjacent_zones}
3. REORGANIZE: Suggest moving lower-priority wines out to make room

Consider:
- Wine style compatibility (Appassimento is dried-grape Italian style)
- Physical cellar layout (adjacent rows preferred)
- Collection balance (don't over-allocate to one style)

Respond with JSON:
{
  "recommendation": "expand" | "merge" | "reorganize",
  "reasoning": "string explaining sommelier logic",
  "actions": [
    { "type": "allocate_row", "row": "R12", "toZone": "appassimento" }
    // or
    { "type": "merge_zones", "sourceZone": "appassimento", "targetZone": "italian_dried_grape" }
    // or
    { "type": "move_wine", "wineId": 45, "fromZone": "appassimento", "toZone": "general_reds", "reason": "lowest rated in zone" }
  ]
}
```

**Response UI**:
- Display AI reasoning in sommelier voice
- Show action buttons for each suggested action
- Allow user to approve individual actions or "Apply All"

### Phase 3: Action Execution

**Goal**: Implement approved zone changes

**New API Endpoints**:

1. `POST /api/cellar/zones/allocate-row`
   - Assigns a row to a zone
   - Updates `zone_row_allocation` table

2. `POST /api/cellar/zones/merge`
   - Combines two zones into one
   - Updates wine `zone_id` assignments
   - Optionally creates new zone name

3. Existing `POST /api/cellar/execute-moves`
   - Already handles wine movements
   - Reuse for reorganization suggestions

---

## UI/UX Flow

```
┌─────────────────────────────────────────────────────────────┐
│  ⚠️ Zone Capacity Issue Detected                            │
│                                                             │
│  The "Appassimento" zone is full (9/9 slots).               │
│  3 wines need placement but would be assigned to            │
│  unrelated zones.                                           │
│                                                             │
│  Affected wines:                                            │
│  • Passione Reale Appassimento (R10C8)                     │
│  • Bastioni della Rocca Appassimento (R10C5)               │
│  • Appassimento Puglia IGT Rosso (R10C6)                   │
│                                                             │
│  [Get AI Suggestions]              [Ignore & Use Fallback]  │
└─────────────────────────────────────────────────────────────┘

         ↓ User clicks "Get AI Suggestions"

┌─────────────────────────────────────────────────────────────┐
│  🍷 Sommelier Zone Recommendation                           │
│                                                             │
│  "I recommend expanding the Appassimento zone. Row 12 is   │
│  currently unallocated and adjacent to your Italian reds   │
│  section, making it ideal for maintaining cellar flow.      │
│                                                             │
│  Alternatively, since Appassimento and Amarone are both    │
│  dried-grape styles from Northern Italy, you could merge   │
│  them into a unified 'Italian Dried-Grape Reds' zone."     │
│                                                             │
│  Suggested Action:                                          │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Allocate Row 12 to Appassimento zone                │   │
│  │ [Apply]                                              │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  Alternative:                                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Merge Appassimento + Amarone → "Italian Dried-Grape"│   │
│  │ [Apply]                                              │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  [Reconfigure Zones Manually]                    [Cancel]   │
└─────────────────────────────────────────────────────────────┘
```

---

## Files to Modify/Create

### Backend
| File | Changes |
|------|---------|
| `src/services/cellarAnalysis.js` | Add zone capacity detection, return alert data |
| `src/services/cellarPlacement.js` | Add zone affinity check for overflow |
| `src/routes/cellar.js` | New endpoint: `/api/cellar/zone-capacity-advice` |
| `src/services/zoneCapacityAdvisor.js` | **NEW** - Claude integration for zone advice |
| `src/routes/cellar.js` | New endpoints: `/zones/allocate-row`, `/zones/merge` |

### Frontend
| File | Changes |
|------|---------|
| `public/js/cellarAnalysis/analysis.js` | Detect and display zone capacity alerts |
| `public/js/cellarAnalysis/zoneCapacityAlert.js` | **NEW** - Alert UI component |
| `public/css/styles.css` | Styles for capacity alert and AI recommendation UI |

### Database
| Migration | Purpose |
|-----------|---------|
| `026_zone_row_allocation.sql` | Table to track which rows belong to which zones (if not exists) |

---

## Testing Scenarios

1. **Zone at capacity, adjacent row available** → Should suggest expansion
2. **Zone at capacity, related zone nearby** → Should suggest merge option
3. **Zone at capacity, nothing sensible available** → Should suggest reorganization
4. **Multiple zones overflowing** → Should prioritize and handle sequentially
5. **User ignores alert** → System falls back gracefully (marks as manual)

---

## Success Criteria

- [ ] No more illogical zone suggestions (Appassimento → Rioja)
- [ ] User sees clear alert when zone capacity issue detected
- [ ] AI provides context-aware suggestions in sommelier voice
- [ ] User can approve/reject individual suggestions
- [ ] Zone expansions and merges execute correctly
- [ ] Analysis cache invalidates after zone changes

---

## Notes

- This builds on existing Zone Chat functionality but is **proactive** rather than user-initiated
- Keep the human-in-the-loop - AI suggests, user approves
- Zone affinity logic should consider: grape variety, region, wine style, colour
- Consider adding a "Zone Health" dashboard in future to show capacity across all zones
