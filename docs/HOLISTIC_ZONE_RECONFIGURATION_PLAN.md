# Holistic Zone Reconfiguration - Implementation Plan

## Date: 8 January 2026
## Priority: High
## Status: Planning

---

## Problem Statement

The current zone capacity management handles issues **piecemeal** - each zone overflow triggers a separate alert with isolated suggestions. When multiple zones have issues (as shown in user testing with 6 alerts), this creates:

1. **Alert spam** - Overwhelming user with individual alerts
2. **Local optimization** - Each fix ignores the broader cellar state
3. **Suboptimal outcomes** - Solving one zone may worsen another
4. **User fatigue** - Clicking through 6+ alerts is tedious

**The user experience is global, but the model optimizes locally.**

---

## Solution: Two-Path Approach

### Path 1: Quick Fix (Minor Issues)
- **When**: 1-2 zone issues, affecting ≤5 bottles total
- **UX**: Current per-zone alerts with "Get AI Suggestions"
- **Scope**: Single zone expansion/merge

### Path 2: Full Reconfiguration (Systemic Issues)
- **When**: 3+ zone issues OR misplacement ≥10-15%
- **UX**: Single grouped banner with unified plan
- **Scope**: Cellar-wide zone restructuring

---

## Trigger Logic

### Always Available
- Manual **"Reconfigure Zones"** button in Cellar Analysis header
- User's explicit "make it right" action

### Auto-Suggest Banner
Display "Holistic plan available" when ANY of:

| Condition | Threshold | Rationale |
|-----------|-----------|-----------|
| Alert count | ≥3 in one analysis | Current pain point |
| Misplacement rate | ≥10-15% of total bottles | Systemic issue indicator |
| Repeated overflow | Same zone overflows within 14 days | Pattern detection |
| Bulk change event | Import, bulk add, large move plan | Layout likely needs adjustment |

### Suppress Holistic for
- 1-2 zones with minor overflow (1-2 bottles each)
- Single zone issues that resolve cleanly

---

## AI Autonomy Levels

### AI CAN Propose (High Autonomy)
- Merging zones (especially micro-zones with <3 bottles)
- Expanding zones by allocating additional rows
- Shrinking zones by deallocating underutilized rows
- Creating new zones (when a style is dominant and repeatedly overflowing)
- Retiring underutilized zones (merge candidates)

### AI MUST NOT Do Without Approval
- Apply any changes automatically
- Delete user-pinned zones
- Remove zones marked as "Keep at least 1 row"
- Make changes that would lose bottles

### User Guardrails
- **Pin zones**: "Never merge this zone"
- **Minimum rows**: "Keep at least N rows for this zone"
- **Discovery zone**: Always maintain one "Curiosities" catch-all zone
- **Stability preference**: User can set "prefer fewer changes" vs "optimize fully"

---

## UI/UX Design

### Grouped Alert Banner (Replaces Multiple Alerts)

```
┌─────────────────────────────────────────────────────────────────┐
│  ⚠️ Zone Configuration Issues Detected                          │
│                                                                 │
│  6 zones have capacity issues affecting 38 bottles.             │
│  • Sauvignon Blanc: 21 bottles overflow                        │
│  • Appassimento: 9 bottles overflow                            │
│  • Rioja & Ribera: 5 bottles overflow                          │
│  • ... and 3 more zones                                        │
│                                                                 │
│  [Quick Fix Individual Zones]    [Full Reconfiguration] (Recommended) │
└─────────────────────────────────────────────────────────────────┘
```

### Full Reconfiguration Flow

```
┌─────────────────────────────────────────────────────────────────┐
│  🍷 Cellar Zone Reconfiguration Plan                            │
│                                                                 │
│  Based on your collection of 121 bottles, I recommend:          │
│                                                                 │
│  Summary:                                                       │
│  • Rows changed: 4                                              │
│  • Bottles affected: 38                                         │
│  • Misplaced reduced: 57 → 8                                   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 1. Expand Sauvignon Blanc: R2 → R2-R3                   │   │
│  │    Reason: 21 bottles overflow, high-frequency style    │   │
│  │    [Preview] [Skip]                                     │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 2. Create "Italian Reds" zone: Merge Appassimento +     │   │
│  │    Primitivo → R10-R11                                   │   │
│  │    Reason: Related styles, combined 15 bottles          │   │
│  │    [Preview] [Skip]                                     │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 3. Retire "Chile & Argentina": Merge into New World Reds│   │
│  │    Reason: Only 1 bottle, underutilized for 30+ days    │   │
│  │    [Preview] [Skip]                                     │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  [Apply All Changes]                              [Cancel]      │
└─────────────────────────────────────────────────────────────────┘
```

### Before/After Preview Modal

```
┌─────────────────────────────────────────────────────────────────┐
│  📊 Reconfiguration Preview                                     │
│                                                                 │
│  CURRENT                      PROPOSED                          │
│  ─────────────────────────    ─────────────────────────        │
│  14 zones active              11 zones active                   │
│  57 misplaced (47%)           8 misplaced (7%)                 │
│  6 zones overflowing          0 zones overflowing              │
│                                                                 │
│  Row Changes:                                                   │
│  R2:  Sauvignon Blanc (1 row) → Sauvignon Blanc (2 rows)       │
│  R3:  [unallocated]           → Sauvignon Blanc                │
│  R10: Appassimento            → Italian Reds                    │
│  R11: Primitivo               → Italian Reds                    │
│                                                                 │
│  Bottles to Move: 18                                            │
│                                                                 │
│  [Confirm & Apply]                                   [Back]     │
└─────────────────────────────────────────────────────────────────┘
```

---

## Data Model Changes

### New: Zone Pins Table
```sql
CREATE TABLE zone_pins (
  zone_id TEXT PRIMARY KEY,
  pin_type TEXT CHECK(pin_type IN ('never_merge', 'minimum_rows', 'never_delete')),
  minimum_rows INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  notes TEXT
);
```

### New: Reconfiguration History
```sql
CREATE TABLE zone_reconfigurations (
  id INTEGER PRIMARY KEY,
  applied_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  plan_json TEXT,           -- Full plan for undo
  changes_summary TEXT,     -- Human-readable summary
  bottles_affected INTEGER,
  misplaced_before INTEGER,
  misplaced_after INTEGER,
  undone_at DATETIME        -- NULL if still active
);
```

---

## API Design

### New Endpoint: Generate Holistic Plan

`POST /api/cellar/reconfiguration-plan`

**Request:**
```json
{
  "includeRetirements": true,
  "includeNewZones": true,
  "stabilityBias": "moderate"  // "low" | "moderate" | "high"
}
```

**Response:**
```json
{
  "success": true,
  "plan": {
    "summary": {
      "zonesChanged": 4,
      "bottlesAffected": 38,
      "misplacedBefore": 57,
      "misplacedAfter": 8
    },
    "reasoning": "Your collection has grown significantly in Italian reds...",
    "actions": [
      {
        "type": "expand_zone",
        "zoneId": "sauvignon_blanc",
        "currentRows": ["R2"],
        "proposedRows": ["R2", "R3"],
        "reason": "21 bottles overflow, high-frequency style",
        "bottlesAffected": 21
      },
      {
        "type": "merge_zones",
        "sourceZones": ["appassimento", "puglia_primitivo"],
        "targetZoneId": "italian_reds",
        "targetZoneName": "Italian Reds",
        "proposedRows": ["R10", "R11"],
        "reason": "Related dried-grape and southern Italian styles",
        "bottlesAffected": 15
      },
      {
        "type": "retire_zone",
        "zoneId": "chile_argentina",
        "mergeIntoZoneId": "new_world_reds",
        "reason": "Only 1 bottle, underutilized",
        "bottlesAffected": 1
      }
    ]
  }
}
```

### New Endpoint: Apply Reconfiguration Plan

`POST /api/cellar/reconfiguration-plan/apply`

**Request:**
```json
{
  "planId": "uuid-from-generation",
  "skipActions": [1, 2]  // Optional: indices of actions to skip
}
```

**Response:**
```json
{
  "success": true,
  "reconfigurationId": 42,
  "applied": {
    "zonesChanged": 2,
    "bottlesMoved": 22
  },
  "canUndo": true
}
```

### New Endpoint: Undo Reconfiguration

`POST /api/cellar/reconfiguration/:id/undo`

---

## Implementation Phases

### Phase 1: Grouped Alert Banner
- Replace multiple alerts with single grouped banner
- Show "Quick Fix" vs "Full Reconfiguration" buttons
- Quick Fix expands to current per-zone flow

### Phase 2: Holistic Plan Generation
- New service: `zoneReconfigurationPlanner.js`
- Claude integration for cellar-wide analysis
- Plan generation with action list

### Phase 3: Plan Preview & Apply
- Before/after preview modal
- Transactional plan application
- Reconfiguration history table

### Phase 4: Undo & Guardrails
- Undo last reconfiguration
- Zone pinning UI
- Stability bias setting

---

## Claude Prompt Structure

```
You are a sommelier reorganizing a wine cellar. Analyze the current state and propose a comprehensive zone reconfiguration plan.

CURRENT STATE:
- Total bottles: {count}
- Zones active: {zones_summary}
- Misplaced bottles: {misplaced_count} ({percent}%)
- Zone capacity issues: {issues_list}

COLLECTION COMPOSITION:
{style_breakdown}

AVAILABLE ROWS:
{unallocated_rows}

CONSTRAINTS:
- Pinned zones (never merge): {pinned_zones}
- Minimum row zones: {min_row_zones}
- Stability preference: {stability_bias}

GOALS:
1. Minimize misplaced bottles
2. Group related wine styles logically
3. Prefer fewer changes over marginal improvements
4. Never lose bottles or create orphans

Return JSON with this schema:
{
  "reasoning": "Sommelier explanation of the overall strategy",
  "actions": [
    {
      "type": "expand_zone" | "merge_zones" | "create_zone" | "retire_zone" | "shrink_zone",
      "priority": 1-5,
      "reason": "One-line explanation",
      ...action-specific fields
    }
  ]
}
```

---

## Success Criteria

- [ ] Single grouped banner replaces multiple alerts
- [ ] "Full Reconfiguration" generates cellar-wide plan
- [ ] Before/after preview shows clear improvement metrics
- [ ] All changes applied transactionally (all or nothing)
- [ ] Undo reverts last reconfiguration
- [ ] Pinned zones respected in AI suggestions
- [ ] Misplacement rate drops significantly after reconfiguration
- [ ] User can skip individual actions while applying rest

---

## Key Principles

1. **Global UX, Global Optimization** - User sees one plan, not N alerts
2. **High Autonomy in Proposing, Low in Executing** - AI suggests freely, applies only with approval
3. **Stability Over Perfection** - Prefer fewer changes unless benefit is clear
4. **Trust Through Transparency** - Show before/after, explain each change
5. **Safety Through Undo** - Easy reversal increases willingness to apply

---

## Notes

- This supersedes per-zone alerts for systemic issues
- Keep per-zone quick fix for minor (1-2 bottle) overflows
- Zone pins are a power-user feature, default to no pins
- Reconfiguration history enables learning from what worked
